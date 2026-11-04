package main

// Read-only reader for one Firstmate home. It only stats, globs and reads
// files under <home>/state and <home>/data; it never writes, steers, or runs
// fleet scripts.

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Event is one status-log line: `verb [key=..] [at=<epoch>]: text`.
// Lines that do not start a new event are folded into the previous one.
type Event struct {
	Verb string
	Key  string // "default" when the line has no [key=] tag, as Firstmate folds it
	At   time.Time
	Text string
}

// Decision is an open needs-decision or blocked line, or a backlog captain hold.
type Decision struct {
	Key, Verb, Text string
	At              time.Time
}

// Lane is one supervised unit of work: a task or a second mate.
type Lane struct {
	ID, Kind, Title string
	State           string // needs-decision, blocked, working, paused, done, failed, unknown
	UpdatedAt       time.Time
	Events          []Event
	Decisions       []Decision
	Hold            string // backlog hold note, if any
	Home            string // second-mate home, set only when it exists on disk
}

func (l Lane) Latest() (Event, bool) {
	if len(l.Events) == 0 {
		return Event{}, false
	}
	return l.Events[len(l.Events)-1], true
}

func parseLine(s string) (Event, bool) {
	verb := verbRe.FindString(s)
	if verb == "" {
		return Event{}, false
	}
	e := Event{Verb: verb, Key: "default"}
	rest, keyed := s[len(verb):], false
	tags := func() {
		for rest = strings.TrimLeft(rest, " "); strings.HasPrefix(rest, "["); rest = strings.TrimLeft(rest, " ") {
			end := strings.IndexByte(rest, ']')
			if end < 0 {
				return
			}
			name, val, _ := strings.Cut(rest[1:end], "=")
			switch name {
			case "key":
				e.Key, keyed = val, true
			case "at":
				if n, err := strconv.ParseInt(val, 10, 64); err == nil {
					e.At = time.Unix(n, 0)
				}
			}
			rest = rest[end+1:]
		}
	}
	tags()
	switch {
	case strings.HasPrefix(rest, ":") && !strings.HasPrefix(rest, "://"): // a wrapped URL is not a verb
		rest = rest[1:]
		tags() // Firstmate also reads a [key=] at the head of the note
	case !keyed:
		return Event{}, false // prose such as "working on it" continues the previous event
	}
	e.Text = strings.TrimSpace(rest)
	return e, true
}

// clean blanks control characters so a log line cannot drive the terminal.
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 || 0x7f <= r && r < 0xa0 {
			return ' '
		}
		return r
	}, s)
}

// ParseLog splits a status log into events.
func ParseLog(text string) []Event {
	var events []Event
	for _, line := range strings.Split(text, "\n") {
		line = clean(line)
		if e, ok := parseLine(line); ok {
			events = append(events, e)
		} else if n := len(events); n > 0 && strings.TrimSpace(line) != "" {
			events[n-1].Text += " " + strings.TrimSpace(line)
		}
	}
	return events
}

// OpenDecisions folds the whole log the way Firstmate's decision fold does:
// needs-decision and blocked open a key, resolved and captain-held close it, and
// a done or failed line closes everything for a task (ship or scout), never for
// a second mate.
func OpenDecisions(events []Event, kind string) []Decision {
	var open []Decision
	drop := func(key string) {
		kept := open[:0]
		for _, d := range open {
			if d.Key != key {
				kept = append(kept, d)
			}
		}
		open = kept
	}
	for _, e := range events {
		if !slugRe.MatchString(e.Key) && e.Verb != "done" && e.Verb != "failed" {
			continue // a malformed key is not a transition
		}
		if strings.HasPrefix(e.Key, "pending-reply-") && !(strings.HasPrefix(e.Text, "pending-reply-") && strings.Contains(e.Text, ":")) {
			continue // a reserved key moves only by a note in its own vocabulary
		}
		switch e.Verb {
		case "needs-decision", "blocked":
			drop(e.Key)
			open = append(open, Decision{e.Key, e.Verb, e.Text, e.At})
		case "resolved", "captain-held":
			drop(e.Key)
		case "done", "failed":
			if kind == "ship" || kind == "scout" {
				open = nil
			}
		}
	}
	return open
}

func laneState(events []Event, open []Decision) string {
	for _, d := range open {
		if d.Verb != "blocked" {
			return "needs-decision"
		}
	}
	if len(open) > 0 {
		return "blocked"
	}
	for i := len(events) - 1; i >= 0; i-- {
		switch v := events[i].Verb; v {
		case "working", "paused", "done", "failed":
			return v
		}
	}
	return "unknown"
}

var stateRank = map[string]int{"needs-decision": 0, "blocked": 1, "working": 2, "paused": 3, "unknown": 4, "failed": 5, "done": 6}

type entry struct{ Section, Title, Kind, Hold, HoldKind, Home string }

var (
	backlogRe = regexp.MustCompile(`^- \[[ xX]\] (\S+) - (.*)$`)
	tagRe     = regexp.MustCompile(`\(([a-z-]+): ([^)]*)\)`)
	titleEnd  = regexp.MustCompile(` \([a-z-]+: | blocked-by: `)
	mateRe    = regexp.MustCompile(`^- (\S+) - (.*)$`)
	verbRe    = regexp.MustCompile(`^[a-z][a-z0-9-]*`)
	slugRe    = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
)

func lines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		out = append(out, clean(sc.Text()))
	}
	return out
}

// ReadBacklog reads data/backlog.md entries: `- [ ] id - title (kind: k) (hold: h) (hold-kind: captain)`.
func ReadBacklog(path string) map[string]entry {
	out, section := map[string]entry{}, ""
	for _, line := range lines(path) {
		if strings.HasPrefix(line, "## ") {
			section = strings.TrimSpace(line[3:])
		}
		m := backlogRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		e := entry{Section: section, Title: m[2]}
		if loc := titleEnd.FindStringIndex(m[2]); loc != nil {
			e.Title = m[2][:loc[0]]
		}
		for _, t := range tagRe.FindAllStringSubmatch(m[2], -1) {
			switch t[1] {
			case "kind":
				e.Kind = t[2]
			case "hold":
				e.Hold = t[2]
			case "hold-kind":
				e.HoldKind = t[2]
			}
		}
		out[m[1]] = e
	}
	return out
}

// ReadSecondmates reads data/secondmates.md entries: `- id - description (home: path; ...)`.
func ReadSecondmates(path string) map[string]entry {
	out := map[string]entry{}
	for _, line := range lines(path) {
		m := mateRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		e := entry{Kind: "secondmate", Title: m[2]}
		if i := strings.Index(e.Title, " (home: "); i >= 0 {
			e.Home, _, _ = strings.Cut(e.Title[i+8:], ";")
			e.Home = strings.TrimSuffix(strings.TrimSpace(e.Home), ")")
			e.Title = e.Title[:i]
		}
		if i := strings.Index(e.Title, ". "); i > 0 {
			e.Title = e.Title[:i]
		}
		out[m[1]] = e
	}
	return out
}

func readMeta(path string) map[string]string {
	out := map[string]string{}
	for _, line := range lines(path) {
		if k, v, ok := strings.Cut(line, "="); ok {
			out[k] = v
		}
	}
	return out
}

func first(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

type cachedLog struct {
	mod    time.Time
	size   int64
	events []Event
}

// Reader keeps parsed status logs and re-reads a log only when its size or mtime changes.
type Reader struct {
	mu    sync.Mutex
	cache map[string]cachedLog
}

func NewReader() *Reader { return &Reader{cache: map[string]cachedLog{}} }

func (r *Reader) events(path string) ([]Event, time.Time) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, time.Time{}
	}
	if c, ok := r.cache[path]; ok && c.mod.Equal(fi.ModTime()) && c.size == fi.Size() {
		return c.events, c.mod
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fi.ModTime()
	}
	c := cachedLog{fi.ModTime(), fi.Size(), ParseLog(string(data))}
	r.cache[path] = c
	return c.events, c.mod
}

// Load returns every lane of one home: status logs, in-flight backlog entries
// and registered second mates, sorted by who needs attention first.
func (r *Reader) Load(home string) ([]Lane, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	stateDir := filepath.Join(home, "state")
	if _, err := os.Stat(stateDir); err != nil {
		return nil, err
	}
	backlog := ReadBacklog(filepath.Join(home, "data", "backlog.md"))
	mates := ReadSecondmates(filepath.Join(home, "data", "secondmates.md"))
	ids := map[string]bool{}
	paths, _ := filepath.Glob(filepath.Join(stateDir, "*.status"))
	for _, p := range paths {
		if id := strings.TrimSuffix(filepath.Base(p), ".status"); !strings.HasPrefix(id, ".") {
			ids[id] = true
		}
	}
	for id, e := range backlog {
		if e.Section == "In flight" {
			ids[id] = true
		}
	}
	for id := range mates {
		ids[id] = true
	}
	lanes := make([]Lane, 0, len(ids))
	for id := range ids {
		lanes = append(lanes, r.lane(home, id, backlog[id], mates[id]))
	}
	sort.Slice(lanes, func(i, j int) bool {
		a, b := lanes[i], lanes[j]
		if stateRank[a.State] != stateRank[b.State] {
			return stateRank[a.State] < stateRank[b.State]
		}
		if !a.UpdatedAt.Equal(b.UpdatedAt) {
			return a.UpdatedAt.After(b.UpdatedAt)
		}
		return a.ID < b.ID
	})
	return lanes, nil
}

func (r *Reader) lane(home, id string, b, mate entry) Lane {
	meta := readMeta(filepath.Join(home, "state", id+".meta"))
	l := Lane{ID: id, Kind: first(meta["kind"], b.Kind, mate.Kind, "unknown"), Title: first(b.Title, mate.Title, id), Hold: b.Hold}
	l.Events, l.UpdatedAt = r.events(filepath.Join(home, "state", id+".status"))
	l.Decisions = OpenDecisions(l.Events, l.Kind)
	if b.HoldKind == "captain" && b.Section != "Done" && !hasCaptainHold(l.Decisions) {
		l.Decisions = append(l.Decisions, Decision{Key: "captain-hold", Verb: "captain-hold", Text: b.Hold})
	}
	l.State = laneState(l.Events, l.Decisions)
	if e, ok := l.Latest(); ok && !e.At.IsZero() {
		l.UpdatedAt = e.At
	}
	if h := first(meta["home"], mate.Home); h != "" {
		if !filepath.IsAbs(h) {
			h = filepath.Join(home, h)
		}
		if fi, err := os.Stat(filepath.Join(h, "state")); err == nil && fi.IsDir() {
			l.Home = h
		}
	}
	return l
}

func hasCaptainHold(ds []Decision) bool {
	for _, d := range ds {
		if strings.HasPrefix(d.Key, "captain-hold") {
			return true
		}
	}
	return false
}
