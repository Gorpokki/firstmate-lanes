package main

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestStationStateBoundaries(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name, state string
		updated     time.Time
		decisions   []Decision
		want        string
		hidden      int
	}{
		{"recent work", "working", now.Add(-time.Hour), nil, "working", 0},
		{"silent work", "working", now.Add(-2 * time.Hour), nil, "holding", 0},
		{"parked", "paused", now, nil, "holding", 0},
		{"waiting", "waiting", now, nil, "waiting", 0},
		{"done", "done", now, nil, "done", 0},
		{"seven day ask", "needs-decision", now, []Decision{{Key: "choice", At: now.Add(-7 * 24 * time.Hour)}}, "needs you", 0},
		{"old ask", "needs-decision", now, []Decision{{Key: "choice", At: now.Add(-7*24*time.Hour - time.Second)}}, "holding", 1},
		{"undated ask stays visible", "needs-decision", now, []Decision{{Key: "choice"}}, "needs you", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			lane, hidden := stationLane(Lane{ID: "example", State: c.state, UpdatedAt: c.updated, Decisions: c.decisions}, now)
			if lane.State != c.want || hidden != c.hidden {
				t.Fatalf("state=%q hidden=%d; want %q %d", lane.State, hidden, c.want, c.hidden)
			}
		})
	}
}

func TestOnlyOwnedNativeAsksAreAnswerable(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	ask := LaneRecordAsk{Form: "choice", Key: "route", Question: "Route?", Reason: "Pick", Effort: "quick", Asked: now, Choices: []LaneRecordChoice{{Label: "A", Effect: "a"}, {Label: "B", Effect: "b"}}}
	owned, _ := stationLane(Lane{ID: "owned", OwnerDir: "/home", State: "needs you", Record: &LaneRecord{Asks: []LaneRecordAsk{ask}}}, now)
	local, _ := stationLane(Lane{ID: "local/dropin", Home: "local", OwnerDir: "", State: "needs you", Record: &LaneRecord{Asks: []LaneRecordAsk{ask}}}, now)
	if len(owned.Asks) != 1 || len(local.Asks) != 1 {
		t.Fatalf("asks owned=%d local=%d, want 1 each", len(owned.Asks), len(local.Asks))
	}
	for _, a := range owned.Asks {
		if !a.Answerable {
			t.Fatalf("owned native ask %q not answerable", a.Key)
		}
	}
	for _, a := range local.Asks {
		if a.Answerable {
			t.Fatalf("drop-in ask %q answerable without an owning home", a.Key)
		}
	}
}

func TestStatusLineAsksGoBackToTheCrewAsACount(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	ask := LaneRecordAsk{Form: "choice", Key: "route", Question: "Route?", Reason: "Pick", Effort: "quick", Asked: now, Choices: []LaneRecordChoice{{Label: "A", Effect: "a"}, {Label: "B", Effect: "b"}}}
	cases := []struct {
		name  string
		lane  Lane
		asks  int
		count int
		state string
	}{
		{"free text", Lane{State: "needs-decision", Events: []Event{{Verb: "needs-decision", Key: "route", At: now, Text: "Pick north or south?"}}, Decisions: []Decision{{Key: "route", Verb: "needs-decision", At: now, Text: "Pick north or south?"}}}, 0, 1, "needs you"},
		{"undated", Lane{State: "needs-decision", Decisions: []Decision{{Key: "route", Verb: "needs-decision"}}}, 0, 1, "needs you"},
		{"keyless block", Lane{State: "blocked", Decisions: []Decision{{Key: "default", Verb: "blocked", At: now}}}, 0, 1, "needs you"},
		{"captain hold", Lane{State: "needs-decision", Hold: "Pick the bump", Decisions: []Decision{{Key: "example", Verb: "captain-hold", Text: "Pick the bump"}}}, 0, 1, "needs you"},
		{"older than seven days", Lane{State: "needs-decision", Decisions: []Decision{{Key: "route", Verb: "needs-decision", At: now.Add(-8 * 24 * time.Hour)}}}, 0, 0, "holding"},
		{"record keeps fixed forms", Lane{State: "needs you", InvalidAsks: 2, Record: &LaneRecord{Asks: []LaneRecordAsk{ask}}}, 1, 2, "needs you"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.lane.ID, c.lane.OwnerDir = "example", "/home"
			row, _ := stationLane(c.lane, now)
			if len(row.Asks) != c.asks || row.InvalidAsks != c.count || row.State != c.state {
				t.Fatalf("asks=%d count=%d state=%q; want %d %d %q", len(row.Asks), row.InvalidAsks, row.State, c.asks, c.count, c.state)
			}
			for _, d := range c.lane.Decisions {
				if d.Text != "" && !slices.ContainsFunc(row.History, func(h StationChange) bool { return h.Text == d.Text }) {
					t.Fatalf("status text %q not kept in the log: %+v", d.Text, row.History)
				}
			}
		})
	}
}

func TestZeroTimeReceiptHidesNothing(t *testing.T) {
	r := &Reader{}
	if err := r.acknowledge("/home", "owned", "route", time.Time{}); err != nil {
		t.Fatal(err)
	}
	lanes := []Lane{{ID: "owned", OwnerDir: "/home", Decisions: []Decision{{Key: "route", Verb: "needs-decision"}}}}
	r.removeAccepted(lanes)
	if len(lanes[0].Decisions) != 1 {
		t.Fatal("zero-time receipt hid a re-held undated ask")
	}
	stale := &Reader{accepted: map[string]time.Time{receiptID("/home", "owned", "route"): {}}}
	stale.removeAccepted(lanes)
	if len(lanes[0].Decisions) != 1 {
		t.Fatal("persisted zero-time receipt hid a re-held undated ask")
	}
}

func TestRegisteredHomeNamedLocalStaysAnswerable(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	ask := LaneRecordAsk{Form: "discussion", Key: "route", Topic: "Route", MustDecide: []string{"Route"}, Reason: "Pick", Effort: "read", Asked: now}
	row, _ := stationLane(Lane{ID: "local/build", Home: "local", SecondMate: "local", OwnerDir: "/home", State: "needs you", Record: &LaneRecord{Asks: []LaneRecordAsk{ask}}}, now)
	if len(row.Asks) != 1 || !row.Asks[0].Answerable {
		t.Fatalf("second mate aliased local lost answerability: %+v", row.Asks)
	}
}

func TestStationFleetOrdersNeedsYouByOldestAskThenStates(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	decided := func(id string, at time.Time) Lane {
		ask := LaneRecordAsk{Form: "discussion", Key: id, Topic: id, MustDecide: []string{id}, Reason: "Pick", Effort: "read", Asked: at}
		return Lane{ID: id, OwnerDir: "/home", State: "needs you", UpdatedAt: now, Record: &LaneRecord{Asks: []LaneRecordAsk{ask}}}
	}
	lanes := []Lane{
		{ID: "holding", State: "paused", UpdatedAt: now},
		decided("needs-new", now.Add(-24*time.Hour)),
		{ID: "working", State: "working", UpdatedAt: now.Add(-time.Hour)},
		{ID: "undated", OwnerDir: "/home", State: "needs-decision", UpdatedAt: now, Decisions: []Decision{{Key: "undated", Verb: "needs-decision"}}},
		{ID: "done", State: "done", UpdatedAt: now},
		decided("needs-old", now.Add(-72*time.Hour)),
		{ID: "waiting", State: "waiting", UpdatedAt: now},
		{ID: "quiet", State: "needs you", UpdatedAt: now, Record: &LaneRecord{}},
	}
	rows, _, _ := stationFleet(lanes, now)
	got := make([]string, len(rows))
	for i, row := range rows {
		got[i] = row.ID
	}
	if len(got) != 8 || got[0] == got[1] || !(got[0] == "undated" || got[0] == "quiet") || !(got[1] == "undated" || got[1] == "quiet") {
		t.Fatalf("unknown-age needs-you lanes must lead, got %v", got)
	}
	if want := []string{"needs-old", "needs-new", "waiting", "working", "done", "holding"}; !slices.Equal(got[2:], want) {
		t.Fatalf("order after unknown-age lanes = %v, want %v", got[2:], want)
	}
}

func collisionFixture(t *testing.T, dropInName string) (string, *Reader) {
	t.Helper()
	home := t.TempDir()
	for _, dir := range []string{"state", "data", "mate/state", "mate/data"} {
		if err := os.MkdirAll(filepath.Join(home, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	dropIn := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dropIn, "lanes"), 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		filepath.Join(home, "data", "secondmates.md"):           "- local - Local crew (home: mate)\n",
		filepath.Join(home, "mate", "state", "build.status"):    "working [at=1768046400]: Building example",
		filepath.Join(dropIn, "lanes", dropInName+".lane.json"): `{"name":"Drop-in lane","state":"working","now":"Synthetic","start":"2026-01-10T12:00:00Z"}`,
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	reader := NewReader()
	reader.DropIn = dropIn
	return home, reader
}

func TestCanonicalLaneIDCollisionFailsWholeFleet(t *testing.T) {
	home, reader := collisionFixture(t, "build")
	if _, err := reader.LoadFleet(home); err == nil || !strings.Contains(err.Error(), "local/build") {
		t.Fatalf("colliding lane IDs loaded: err=%v", err)
	}
}

func TestLocalAliasWithoutCollisionStillLoads(t *testing.T) {
	home, reader := collisionFixture(t, "scratch")
	lanes, err := reader.LoadFleet(home)
	if err != nil {
		t.Fatal(err)
	}
	homes := map[string]string{}
	for _, lane := range lanes {
		homes[lane.ID] = lane.Home
	}
	if homes["local/build"] != "local" || homes["local/scratch"] != "local" {
		t.Fatalf("aliased and drop-in lanes not both loaded: %v", homes)
	}
}

func TestRegisteredHomeLanes(t *testing.T) {
	home := t.TempDir()
	for _, dir := range []string{"state", "data", "mate/state", "mate/data"} {
		if err := os.MkdirAll(filepath.Join(home, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range map[string]string{
		"state/build.status":      "working [at=1768046400]: Building example",
		"data/secondmates.md":     "- design - Design crew (home: mate)\n",
		"mate/state/build.status": "done [at=1768046400]: Example shipped",
	} {
		if err := os.WriteFile(filepath.Join(home, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	lanes, err := NewReader().LoadFleet(home)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]Lane{}
	for _, l := range lanes {
		found[l.ID] = l
	}
	if found["build"].Home != "main" || found["design/build"].SecondMate != "design" || found["design/build"].State != "done" {
		t.Fatalf("registered homes not represented: %#v", found)
	}
}

func TestAutonomyIncludesStructuredAskHistory(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	lanes := []Lane{
		{ID: "automatic", State: "done"},
		{ID: "answered", State: "done", HadRecordAsks: true},
		{ID: "past-help", State: "done", Events: []Event{{Verb: "needs you", At: now.Add(-time.Hour)}}},
		{ID: "status-help", State: "done", Events: []Event{{Verb: "blocked", At: now.Add(-time.Hour)}}},
	}
	if got := BuildFleet(lanes, now).AutonomyShare; got != 0.25 {
		t.Fatalf("autonomy=%v, want one untouched lane out of four", got)
	}
}

func TestReturnedAsksWaitFromTheirOwnDecision(t *testing.T) {
	now := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	oldAt := now.Add(-72 * time.Hour)
	events := ParseLog(fmt.Sprintf("needs-decision [key=route] [at=%d]: Pick north or south?\nworking [key=other] [at=%d]: Unrelated note", oldAt.Unix(), now.Add(-time.Minute).Unix()))
	old := Lane{ID: "old", OwnerDir: "/home", State: "needs-decision", UpdatedAt: now.Add(-time.Minute), Events: events, Decisions: OpenDecisions(events, "ship")}
	newer := Lane{ID: "newer", OwnerDir: "/home", State: "needs-decision", UpdatedAt: now.Add(-2 * time.Hour), Decisions: []Decision{{Key: "fresh", Verb: "needs-decision", At: now.Add(-time.Hour)}}}
	mixedAsk := LaneRecordAsk{Form: "discussion", Key: "fresh", Topic: "Fresh", MustDecide: []string{"Fresh"}, Reason: "Pick", Effort: "read", Asked: now.Add(-30 * time.Minute)}
	mixed := Lane{ID: "mixed", OwnerDir: "/home", State: "needs-decision", UpdatedAt: now, Record: &LaneRecord{Asks: []LaneRecordAsk{mixedAsk}}, Decisions: []Decision{{Key: "route", Verb: "needs-decision", At: now.Add(-48 * time.Hour)}}}

	rows, _, _ := stationFleet([]Lane{newer, mixed, old}, now)
	got := make([]string, len(rows))
	for i, row := range rows {
		got[i] = row.ID
	}
	if !slices.Equal(got, []string{"old", "mixed", "newer"}) {
		t.Fatalf("returned asks must order by their own decision time, got %v", got)
	}
	row := rows[0]
	if row.ReturnedSince == nil || !row.ReturnedSince.Equal(oldAt) {
		t.Fatalf("returned since %v, want the decision time %v", row.ReturnedSince, oldAt)
	}
	if row.State != "needs you" || len(row.Asks) != 0 || row.InvalidAsks != 1 {
		t.Fatalf("returned-only lane state=%q asks=%d count=%d; want needs you, no cards, one returned", row.State, len(row.Asks), row.InvalidAsks)
	}
	if !slices.ContainsFunc(row.History, func(h StationChange) bool { return h.Text == "Pick north or south?" }) {
		t.Fatalf("returned text not kept in the log: %+v", row.History)
	}
}
