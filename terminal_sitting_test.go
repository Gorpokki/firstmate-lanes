package main

import (
	"strings"
	"testing"
	"time"
)

func terminalFixture() []StationLane {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	return []StationLane{
		{ID: "mate-a", Name: "Mate A", SecondMate: "mate", State: "needs you", Asks: []StationAsk{{Form: "choice", Key: "quick-a", Question: "Choose A?", Effort: "quick", Asked: asked, Answerable: true, Choices: []LaneRecordChoice{{Label: "Yes", Effect: "ship"}, {Label: "No", Effect: "wait"}}}}},
		{ID: "lane-b", Name: "Lane B", State: "working", Asks: []StationAsk{{Form: "discussion", Key: "read-b", Topic: "Discuss B?", MustDecide: []string{"Plan"}, Effort: "read", Asked: asked.Add(time.Minute), Answerable: true}}},
	}
}

func TestTerminalStationsAndSelectedAskSitting(t *testing.T) {
	m := model{fleet: BuildFleet(nil, time.Time{}), view: 1, w: 80, h: 24, selected: map[string]bool{}}
	m.fleet.Stations = terminalFixture()
	m, _ = m.key("a")
	if len(m.sitting.items) != 2 || m.sitting.items[0].ask.Key != "quick-a" {
		t.Fatalf("quick ask not first: %+v", m.sitting.items)
	}
	m.sitting.key(&m, "1", m.askLanes())
	if len(m.sitting.answers) != 1 || m.sitting.answers[0].Kind != "choice" || m.sitting.answers[0].Choice != 0 {
		t.Fatalf("choice answer: %+v", m.sitting.answers)
	}
	m, _ = m.key("o")
	for _, r := range "Use the default" {
		m, _ = m.key(string(r))
	}
	m, _ = m.key("enter")
	if len(m.sitting.answers) != 2 || m.sitting.answers[1].Kind != "own" || m.sitting.answers[1].Text != "Use the default" {
		t.Fatalf("own answer: %+v", m.sitting.answers)
	}
	m.sitting.key(&m, "r", m.askLanes())
	m.sitting.key(&m, "n", m.askLanes())
	if m.pendingSend {
		t.Fatal("review cancellation initiated a send")
	}
	m.sitting.key(&m, "r", m.askLanes())
	m.sitting.key(&m, "y", m.askLanes())
	if !m.pendingSend || len(m.answers) != 2 {
		t.Fatalf("confirmed send not exposed to CLI: pending=%t answers=%+v", m.pendingSend, m.answers)
	}
}

func TestTerminalSittingUndoDeferAndSearch(t *testing.T) {
	m := model{fleet: Fleet{Stations: terminalFixture()}, view: 0, w: 80, h: 24}
	m.openSitting()
	m.sitting.key(&m, "d", m.askLanes())
	if len(m.sitting.deferred) != 1 || m.sitting.items[m.sitting.index].ask.Key != "read-b" {
		t.Fatalf("defer did not move to next ask: %+v", m.sitting)
	}
	m.sitting.key(&m, "/", m.askLanes())
	for _, r := range "Lane B" {
		m.sitting.key(&m, string(r), m.askLanes())
	}
	m.sitting.key(&m, "enter", m.askLanes())
	if m.sitting.items[m.sitting.index].ask.Key != "read-b" {
		t.Fatalf("search did not select matching lane: %s", m.sitting.items[m.sitting.index].lane.Name)
	}
	m.sitting.key(&m, "s", m.askLanes())
	m.sitting.key(&m, "u", m.askLanes())
	if len(m.sitting.answers) != 0 || m.sitting.items[m.sitting.index].ask.Key != "read-b" {
		t.Fatalf("undo did not restore ask: %+v", m.sitting)
	}
}

func TestTerminalMultipleSelectionKeepsUncheckedLanesVisible(t *testing.T) {
	m := model{fleet: Fleet{Stations: terminalFixture()}, view: 1, w: 100, h: 30}
	m, _ = m.key("space")
	m, _ = m.key("down")
	m, _ = m.key("space")
	if len(m.selected) != 2 || len(m.listLanes()) != 2 {
		t.Fatalf("selection hid sibling lanes: selected=%v lanes=%v", m.selected, m.listLanes())
	}
	m, _ = m.key("a")
	if len(m.sitting.items) != 2 {
		t.Fatalf("selected sitting has %d asks", len(m.sitting.items))
	}
	m, _ = m.key("1")
	m, _ = m.key("g")
	for _, needle := range []string{"Mate A", "Choose A?", "Lane B", "Discuss B?"} {
		if !strings.Contains(m.View(), needle) {
			t.Fatalf("review omitted %q", needle)
		}
	}
	m, _ = m.key("o")
	m, _ = m.key("esc")
	if m.pendingSend {
		t.Fatal("editing review sent answers")
	}
}

func TestTerminalMateFilterScopesListOnlyNotSitting(t *testing.T) {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	ask := func(key string) []StationAsk {
		return []StationAsk{{Form: "discussion", Key: key, Topic: key, MustDecide: []string{"Plan"}, Effort: "read", Asked: asked, Answerable: true}}
	}
	lanes := []StationLane{
		{ID: "design-lane", Name: "Design Lane", SecondMate: "design", State: "needs you", Asks: ask("design")},
		{ID: "build-lane", Name: "Build Lane", SecondMate: "build", State: "needs you", Asks: ask("build")},
	}
	m := model{fleet: Fleet{Stations: lanes}, view: 1, w: 120, h: 40, selected: map[string]bool{}, mateFilter: "design"}
	m.openSitting()
	if len(m.sitting.items) != 2 {
		t.Fatalf("unticked sitting under mate filter has %d asks, want both mates", len(m.sitting.items))
	}
	m.selected["build-lane"] = true
	m.openSitting()
	if len(m.sitting.items) != 1 || m.sitting.items[0].lane.ID != "build-lane" {
		t.Fatalf("ticked lane hidden by filter dropped from sitting: %+v", m.sitting.items)
	}
	m.view = 0
	if !strings.Contains(m.View(), "1 ticked lane(s) hidden by the mate filter are included") {
		t.Fatal("Ask did not count the hidden ticked lane")
	}
}

func TestTerminalListSelectionStartsUntouchedSittingOnEveryAskEntry(t *testing.T) {
	for _, entry := range []string{"a", "shift+tab"} {
		m := model{fleet: Fleet{Stations: terminalFixture()}, view: 1, w: 100, h: 30}
		m, _ = m.key("a")
		m, _ = m.key("l")
		m, _ = m.key("space")
		m, _ = m.key(entry)
		if m.view != 0 || len(m.sitting.items) != 1 || len(m.selected) != 1 {
			t.Fatalf("%s: view=%d items=%d selected=%v, want Ask with only the selected lane's ask", entry, m.view, len(m.sitting.items), m.selected)
		}
		if !m.selected[m.sitting.items[0].lane.ID] {
			t.Fatalf("%s: sitting holds lane %q, not the selected lane", entry, m.sitting.items[0].lane.ID)
		}
	}
}

func TestTerminalBoardSuggestionIsAttributedAndKeylessAskIsReadOnly(t *testing.T) {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	choices := []LaneRecordChoice{{Label: "North", Effect: "go"}, {Label: "South", Effect: "wait"}}
	m := model{fleet: Fleet{Stations: []StationLane{
		{ID: "north-lane", Name: "North Lane", State: "needs you", Asks: []StationAsk{{Form: "choice", Key: "route", Question: "Route?", Reason: "Pick", Effort: "quick", Asked: asked, Answerable: true, NoPickReason: "both carry equal risk", Choices: choices}}},
		{ID: "keyless-lane", Name: "Keyless Lane", State: "needs you", Asks: []StationAsk{{Form: "choice", Key: "default", Question: "Keyless?", Reason: "Pick", Effort: "read", Asked: asked, Choices: choices}}},
	}}, view: 0, w: 120, h: 40, selected: map[string]bool{}}
	m.openSitting()
	lineWith := func(view, needle string) string {
		for _, line := range strings.Split(view, "\n") {
			if strings.Contains(line, needle) {
				return line
			}
		}
		return ""
	}
	view := m.View()
	if !strings.Contains(lineWith(view, "North — go"), "board suggestion") || strings.Contains(lineWith(view, "South — wait"), "board suggestion") {
		t.Fatalf("board suggestion not attributed to the first listed choice only:\n%s", view)
	}
	if !strings.Contains(view, "Crew gave no pick: both carry equal risk") || strings.Contains(lineWith(view, "North — go"), "both carry equal risk") {
		t.Fatalf("crew's no-pick reason not shown separately:\n%s", view)
	}
	if len(m.sitting.items) != 1 || m.sitting.items[0].lane.ID != "north-lane" {
		t.Fatalf("read-only keyless ask took a sitting slot: %+v", m.sitting.items)
	}
}

func TestTerminalReadOnlyAsksDoNotTakeSittingSlots(t *testing.T) {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	var asks []StationAsk
	for i, key := range []string{"read-1", "read-2", "read-3", "read-4"} {
		asks = append(asks, StationAsk{Form: "discussion", Key: key, Topic: "Read only?", MustDecide: []string{"Plan"}, Effort: "quick", Asked: asked.Add(time.Duration(i) * time.Minute)})
	}
	asks = append(asks, StationAsk{Form: "discussion", Key: "answerable", Topic: "Answer me?", MustDecide: []string{"Plan"}, Effort: "read", Asked: asked.Add(time.Hour), Answerable: true})
	m := model{fleet: Fleet{Stations: []StationLane{{ID: "lane-c", Name: "Lane C", State: "needs you", Asks: asks}}}, view: 0, w: 120, h: 40, selected: map[string]bool{}}
	m.openSitting()
	if len(m.sitting.items) != 1 || m.sitting.items[0].ask.Key != "answerable" {
		t.Fatalf("read-only asks took sitting slots: %+v", m.sitting.items)
	}
}

func TestTerminalAllReadOnlySittingHasNoAsks(t *testing.T) {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	lanes := []StationLane{{ID: "lane-d", Name: "Lane D", State: "needs you", Asks: []StationAsk{{Form: "discussion", Key: "default", Topic: "Keyless?", MustDecide: []string{"Plan"}, Effort: "quick", Asked: asked}}}}
	m := model{fleet: Fleet{Stations: lanes}, view: 0, w: 120, h: 40, selected: map[string]bool{}}
	m.openSitting()
	if len(m.sitting.items) != 0 || m.sitting.readOnly != 1 {
		t.Fatalf("read-only ask entered the sitting: items=%d readOnly=%d", len(m.sitting.items), m.sitting.readOnly)
	}
	if !strings.Contains(m.View(), "read-only") {
		t.Fatalf("empty read-only sitting not explained:\n%s", m.View())
	}
}

func TestTerminalLongAskCanBeReadBeforeAnswering(t *testing.T) {
	m := model{fleet: Fleet{Stations: terminalFixture()}, view: 0, w: 60, h: 16}
	m.fleet.Stations[0].Asks[0].Detail = strings.Repeat("synthetic context ", 100) + "end-of-detail"
	m.openSitting()
	m.sitting.details = true
	visible := false
	for range 20 {
		if strings.Contains(m.View(), "end-of-detail") {
			visible = true
			break
		}
		m, _ = m.key("pgdown")
	}
	if !visible {
		t.Fatal("long ask detail is unreachable")
	}
	if m.pendingSend || len(m.sitting.answers) != 0 {
		t.Fatal("reading detail answered or sent the ask")
	}
}

func TestFleetSelectionOpensTheLaneHighlighted(t *testing.T) {
	m := model{view: 2, w: 120, h: 34, fleet: Fleet{Stations: []StationLane{
		{ID: "alpha", Name: "Alpha", State: "needs you"},
		{ID: "bravo", Name: "Bravo", State: "working"},
		{ID: "charlie", Name: "Charlie", State: "working"},
	}}}
	m, _ = m.key("3")
	m, _ = m.key("down")
	if l, _ := m.selectedLane(); l.ID != "charlie" {
		t.Fatalf("filtered Fleet highlighted %s, want charlie", l.ID)
	}
	m, _ = m.key("enter")
	if l, _ := m.selectedLane(); l.ID != "charlie" {
		t.Fatalf("Lane opened %s, want the lane highlighted in Fleet", l.ID)
	}
	m, _ = m.key("l")
	if l, _ := m.selectedLane(); l.ID != "charlie" {
		t.Fatalf("List selected %s, want charlie", l.ID)
	}
}

func TestTerminalSittingSendsOnlyACompleteBatch(t *testing.T) {
	m := model{fleet: Fleet{Stations: terminalFixture()}, view: 0, w: 100, h: 30}
	m.openSitting()
	send := func() bool {
		m.pendingSend, m.answers = false, nil
		m.sitting.review = true
		m.sitting.key(&m, "y", m.askLanes())
		m.sitting.review = false
		return m.pendingSend
	}
	m.sitting.key(&m, "1", m.askLanes())
	if send() {
		t.Fatal("sent with one of two asks answered")
	}
	m.sitting.index = 1
	m.sitting.key(&m, "s", m.askLanes())
	if !send() || len(m.answers) != 2 {
		t.Fatalf("complete batch not sent: %+v", m.answers)
	}
	m.sitting.key(&m, "u", m.askLanes())
	if send() {
		t.Fatal("sent after undo reopened an ask")
	}
	m.sitting.index = 1
	m.sitting.key(&m, "d", m.askLanes())
	if !send() || len(m.answers) != 1 || m.answers[0].Key != "quick-a" {
		t.Fatalf("deferred ask did not leave the batch: %+v", m.answers)
	}
	m.sitting.index = 0
	m.sitting.key(&m, "d", m.askLanes())
	if len(m.sitting.answers) != 0 || send() {
		t.Fatalf("deferring an answered ask kept its answer: %+v", m.sitting.answers)
	}
}
