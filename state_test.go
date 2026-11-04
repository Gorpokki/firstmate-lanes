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
	if len(lanes) != len(want) || lanes[0].State != "needs-decision" || lanes[len(lanes)-1].ID != "cache-research" {
		t.Errorf("lanes or order wrong: %d lanes, first %s, last %s", len(lanes), lanes[0].ID, lanes[len(lanes)-1].ID)
	}
	if l := got["api-retry"]; l.Title != "Retry failed API calls with backoff in the widgets service" {
		t.Errorf("api-retry title %q", l.Title)
	}
	if !strings.HasSuffix(got["docs-mate"].Home, "sample-mate") {
		t.Errorf("docs-mate home %q, want the sample-mate path", got["docs-mate"].Home)
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

// Moving down an empty lane list keeps the selection at zero, so no lane view indexes a missing lane.
func TestSelectionOnEmptyList(t *testing.T) {
	m, _ := model{w: 120, h: 34, view: 4}.key("j")
	if m.sel != 0 {
		t.Fatalf("sel = %d after j on an empty list, want 0", m.sel)
	}
	m.View()
}

// The timeline orders events by instant: 01:30 CDT comes before 01:10 CST on the fall-back night.
func TestTimelineOrderAcrossFallBack(t *testing.T) {
	chicago, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatal(err)
	}
	earlier := time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC).In(chicago)
	later := time.Date(2026, 11, 1, 7, 10, 0, 0, time.UTC).In(chicago)
	lanes := []Lane{
		{ID: "a", Events: []Event{{Verb: "working", At: later, Text: "later"}}},
		{ID: "b", Events: []Event{{Verb: "working", At: earlier, Text: "earlier"}}},
	}
	tl := BuildFleet(lanes, time.Now()).Timeline
	if len(tl) != 2 || tl[0].Text != "earlier" || tl[1].Text != "later" {
		t.Fatalf("timeline order = %+v, want earlier then later", tl)
	}
}

// Below 100 columns, Enter opens the selected lane's log in the Lanes view and Esc returns to the board.
func TestNarrowLanesEnterOpensLog(t *testing.T) {
	lanes, err := NewReader().Load("testdata/sample-home")
	if err != nil {
		t.Fatal(err)
	}
	m := model{fleet: BuildFleet(lanes, time.Now()), view: 4, w: 80, h: 24}
	m.step()
	for i, l := range m.fleet.Lanes {
		if l.ID == "api-retry" {
			m.sel = i
		}
	}
	const title = "RETRY FAILED API CALLS WITH BACKOFF IN THE WIDGETS SERVICE"
	if strings.Contains(m.View(), title) {
		t.Fatal("the board shows a lane's log before Enter")
	}
	m, _ = m.key("enter")
	if !strings.Contains(m.View(), title) {
		t.Fatal("Enter does not open the selected lane")
	}
	m, _ = m.key("esc")
	if strings.Contains(m.View(), title) {
		t.Fatal("Esc does not return to the board")
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

// Every lane picks a ship that ships in this build.
func TestShipFor(t *testing.T) {
	for _, id := range []string{"api-retry", "docs-mate", "x", ""} {
		if len(generatedShipFrames[shipFor(id)]) == 0 {
			t.Errorf("%q picks %q, which has no frames", id, shipFor(id))
		}
	}
}
