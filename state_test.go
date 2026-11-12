package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
)

func TestParseAndFold(t *testing.T) {
	log := strings.Join([]string{
		"working [corr=ab12] [at=1700000000]: started",
		"  wrapped prose continues the line above",
		"https://example.com/pull/1: a wrapped URL is not a verb",
		"needs-decision: keyless asks open the default key",
		"blocked [key=host] [at=1700000100]: no free host",
		"resolved [key=host]: host freed",
		"blocked [key=bad key at=1]: a malformed key opens nothing",
		"blocked [key=pending-reply-7]: pending-reply-missed: no reply yet",
		"resolved [key=pending-reply-7]: an unrelated note cannot close a reserved key",
		"done [key=child-a]: a second mate's child report",
	}, "\n")
	events := ParseLog(log)
	if len(events) != 8 {
		t.Fatalf("got %d events, want 8: %+v", len(events), events)
	}
	if e := events[0]; e.Verb != "working" || e.At.Unix() != 1700000000 || !strings.Contains(e.Text, "wrapped prose") || !strings.Contains(e.Text, "a wrapped URL") {
		t.Fatalf("first event = %+v", e)
	}
	mate := OpenDecisions(events, "secondmate")
	if len(mate) != 2 || mate[0].Key != "default" || mate[1].Key != "pending-reply-7" || laneState(events, mate) != "needs-decision" {
		t.Fatalf("second mate: done must not clear decisions, got %+v", mate)
	}
	if task := OpenDecisions(events, "scout"); len(task) != 0 || laneState(events, task) != "done" {
		t.Fatalf("task: done must clear decisions, got %+v", task)
	}
}

func TestSampleHome(t *testing.T) {
	lanes, err := NewReader().Load("testdata/sample-home")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"flaky-tests":    "needs-decision", // keyed ask still open
		"docs-mate":      "needs-decision", // second mate: child done line keeps its ask open
		"deps-bump":      "needs-decision", // backlog captain hold
		"release-notes":  "blocked",
		"api-retry":      "working",
		"triage-bot":     "unknown", // in-flight backlog entry with no status log yet
		"cache-research": "done",    // done clears the task's asks
	}
	got := map[string]Lane{}
	for _, l := range lanes {
		got[l.ID] = l
	}
	for id, state := range want {
		if got[id].State != state {
			t.Errorf("%s: state %q, want %q", id, got[id].State, state)
		}
	}
	if d := got["deps-bump"].Decisions; len(d) != 1 || d[0].Verb != "captain-hold" || d[0].Key != "deps-bump" {
		t.Errorf("captain hold decisions %+v, want one keyed by its backlog task ID", d)
	}
	if len(lanes) != len(want) || lanes[0].State != "needs-decision" || lanes[len(lanes)-1].ID != "cache-research" {
		t.Errorf("lanes or order wrong: %d lanes, first %s, last %s", len(lanes), lanes[0].ID, lanes[len(lanes)-1].ID)
	}
	if l := got["api-retry"]; l.Title != "Retry failed API calls with backoff in the widgets service" {
		t.Errorf("api-retry title %q", l.Title)
	}
	if got["docs-mate"].Title != "Persistent second mate for the documentation site" {
		t.Errorf("docs-mate title %q", got["docs-mate"].Title)
	}
}

// Every view fills the terminal exactly, from the minimum size up.
func TestViewFillsTerminal(t *testing.T) {
	lanes, err := NewReader().Load("testdata/sample-home")
	if err != nil {
		t.Fatal(err)
	}
	m := model{fleet: BuildFleet(lanes, time.Now())}
	m.step()
	for _, size := range [][2]int{{40, 10}, {79, 24}, {80, 24}, {120, 12}, {120, 14}, {120, 15}, {120, 34}, {200, 60}} {
		for m.view = range views {
			m.w, m.h = size[0], size[1]
			rows := strings.Split(m.View(), "\n")
			if len(rows) != m.h {
				t.Fatalf("%v view %s: %d rows", size, views[m.view].key, len(rows))
			}
			for _, r := range rows {
				if w := ansi.StringWidth(r); w != m.w {
					t.Fatalf("%v view %s: row width %d: %q", size, views[m.view].key, w, r)
				}
			}
		}
	}
}

// Empty fleet remains navigable in the Lane station.
func TestSelectionOnEmptyList(t *testing.T) {
	m, _ := model{w: 120, h: 34, view: 3}.key("j")
	if m.selIndex() != 0 {
		t.Fatalf("selection = %d, want 0", m.selIndex())
	}
	if got := m.View(); !strings.Contains(got, "NO LANE SELECTED") {
		t.Fatalf("empty lane station: %s", got)
	}
}

// --serve answers only the Host names the user allows: localhost, IP literals and --allow-host names.
func TestServeHostGuard(t *testing.T) {
	ok := hostGuard(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }), []string{"fleet.example"})
	for host, want := range map[string]int{
		"127.0.0.1:7777": 200, "localhost:7777": 200, "[::1]:7777": 200, "192.168.1.20:7777": 200,
		"fleet.example:7777": 200, "evil.example:7777": 403, "127.0.0.1.evil.example:7777": 403, "": 403,
	} {
		req := httptest.NewRequest(http.MethodGet, "/fleet.json", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		ok.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q: status %d, want %d", host, rec.Code, want)
		}
	}
}

func TestTerminalShipRotationPauseAndFiniteBreakup(t *testing.T) {
	for _, id := range []string{"sample-a", "sample-b"} {
		lane := StationLane{ID: id, State: "working", SourceState: "working", Progress: 1}
		m := model{}
		start := strings.Join(shipLines(lane, m.tick, 52, 18), "\n")
		for range 16 {
			m.step()
		}
		rotated := strings.Join(shipLines(lane, m.tick, 52, 18), "\n")
		if start == rotated {
			t.Fatal("working ship did not rotate")
		}
		m.spinPaused = true
		m.step()
		if strings.Join(shipLines(lane, m.tick, 52, 18), "\n") != rotated {
			t.Fatal("paused ship moved")
		}
		pixels := func(lines []string) map[[2]int]bool {
			result := map[[2]int]bool{}
			for row, line := range lines {
				for col, char := range []rune(line) {
					if char != ' ' {
						result[[2]int{row, col}] = true
					}
				}
			}
			return result
		}
		intact := pixels(shipLines(lane, 12, 52, 18))
		lane.SourceState = "failed"
		escaped := false
		for point := range pixels(shipLines(lane, 12, 52, 18)) {
			escaped = escaped || !intact[point]
		}
		if !escaped {
			t.Fatal("failed ship changed glyphs without separating pieces")
		}
		end := strings.Join(shipLines(lane, 24, 52, 18), "\n")
		if strings.Join(shipLines(lane, 48, 52, 18), "\n") != end {
			t.Fatal("breakup did not reach a finite resting frame")
		}
	}
}
