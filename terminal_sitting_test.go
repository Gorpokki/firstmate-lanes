package main

import (
	"strings"
	"testing"
	"time"
)

func terminalFixture() []StationLane {
	asked := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	return []StationLane{
		{ID: "mate-a", Name: "Mate A", SecondMate: "mate", State: "needs you", Asks: []StationAsk{{Form: "choice", Key: "quick-a", Question: "Choose A?", Effort: "quick", Asked: asked, Choices: []LaneRecordChoice{{Label: "Yes", Effect: "ship"}, {Label: "No", Effect: "wait"}}}}},
		{ID: "lane-b", Name: "Lane B", State: "working", Asks: []StationAsk{{Form: "discussion", Key: "read-b", Topic: "Discuss B?", MustDecide: []string{"Plan"}, Effort: "read", Asked: asked.Add(time.Minute)}}},
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
