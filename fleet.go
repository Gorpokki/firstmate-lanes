package main

// Fleet is the one shared primitive both front ends render: the
// lane board's panels (health, red alert, waiting on captain, lane board,
// crew, timeline) built from one home's lanes. The TUI draws it; --json hands
// the same value to the web/mobile board.

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type KPI struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Detail string `json:"detail"`
	Tone   string `json:"tone"` // ok, warn, alert, info, idle
}

type Blocker struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Next   string `json:"next"`
	Age    string `json:"age"`
}

type BoardLane struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Kind      string   `json:"kind"`
	Status    string   `json:"status"` // blocked, waiting, in-progress, parked, queued, done, failed
	Note      string   `json:"note"`
	Age       string   `json:"age"`
	Decisions int      `json:"decisions"`
	Mate      bool     `json:"mate"`
	Links     []string `json:"links"`
	Log       []Line   `json:"log"`
}

type Wait struct {
	Lane string `json:"lane"`
	Key  string `json:"key"`
	Ask  string `json:"ask"`
	Age  string `json:"age"`
}

type Line struct {
	At   string `json:"at"`
	Lane string `json:"lane,omitempty"`
	Verb string `json:"verb"`
	Text string `json:"text"`
}

type Fleet struct {
	UpdatedAt time.Time   `json:"updatedAt"`
	Home      string      `json:"home"`
	KPIs      []KPI       `json:"kpis"`
	Blockers  []Blocker   `json:"blockers"`
	Waiting   []Wait      `json:"waitingOnCaptain"`
	Lanes     []BoardLane `json:"lanes"`
	Crew      []BoardLane `json:"crew"`
	Timeline  []Line      `json:"timeline"`
}

// boardStatus maps a status-log state onto the lane board's vocabulary.
var boardStatus = map[string]string{
	"needs-decision": "waiting", "captain-hold": "waiting", "blocked": "blocked", "working": "in-progress",
	"paused": "parked", "done": "done", "failed": "failed", "unknown": "queued",
}

// StatusOrder is the board's display order, attention first.
var StatusOrder = []string{"blocked", "failed", "waiting", "in-progress", "parked", "queued", "done"}

var StatusLabel = map[string]string{
	"blocked": "Blocked", "failed": "Failed", "waiting": "Waiting on captain", "in-progress": "In progress",
	"parked": "Parked", "queued": "Queued", "done": "Done",
}

func stamp(t time.Time) string {
	if t.IsZero() {
		return "--:--"
	}
	return t.Format("15:04")
}

func BuildFleet(home string, lanes []Lane, at time.Time) Fleet {
	f := Fleet{UpdatedAt: at, Home: home}
	count := map[string]int{}
	var all []Line
	for _, l := range lanes {
		b := BoardLane{ID: l.ID, Title: l.Title, Kind: l.Kind, Status: boardStatus[l.State], Age: age(l.UpdatedAt),
			Decisions: len(l.Decisions), Mate: l.Kind == "secondmate" || l.Home != "", Links: l.Links, Note: "no status log yet"}
		if e, ok := l.Latest(); ok {
			b.Note = e.Text
		}
		for _, e := range tail(l.Events, 40) {
			b.Log = append(b.Log, Line{At: stamp(e.At), Verb: e.Verb, Text: e.Text})
		}
		for _, e := range l.Events {
			all = append(all, Line{At: e.At.Format(time.RFC3339), Lane: l.ID, Verb: e.Verb, Text: e.Text})
		}
		count[b.Status]++
		for _, d := range l.Decisions {
			if d.Verb == "blocked" {
				f.Blockers = append(f.Blockers, Blocker{Title: l.ID, Detail: d.Text, Next: l.Title, Age: age(d.At)})
			} else {
				f.Waiting = append(f.Waiting, Wait{Lane: l.ID, Key: d.Key, Ask: d.Text, Age: age(d.At)})
			}
		}
		if l.State == "failed" {
			f.Blockers = append(f.Blockers, Blocker{Title: l.ID, Detail: b.Note, Next: l.Title, Age: b.Age})
		}
		if b.Mate {
			f.Crew = append(f.Crew, b)
		}
		f.Lanes = append(f.Lanes, b)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].At < all[j].At })
	for _, e := range tail(all, 14) {
		t, _ := time.Parse(time.RFC3339, e.At)
		e.At = stamp(t)
		f.Timeline = append(f.Timeline, e)
	}
	f.KPIs = []KPI{
		{"Lanes", fmt.Sprint(len(lanes)), "in this home", "idle"},
		{"In progress", fmt.Sprint(count["in-progress"]), "working now", "info"},
		{"Waiting", fmt.Sprint(count["waiting"]), fmt.Sprintf("%d open asks", len(f.Waiting)), "warn"},
		{"Blocked", fmt.Sprint(count["blocked"] + count["failed"]), "need help", "alert"},
		{"Done", fmt.Sprint(count["done"]), "finished", "ok"},
	}
	return f
}

func tail[T any](s []T, n int) []T {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}

func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }

func age(t time.Time) string {
	if t.IsZero() {
		return "?"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", max(0, int(d.Seconds())))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
