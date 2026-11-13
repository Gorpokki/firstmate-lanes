package main

import (
	"sort"
	"time"
)

// StationLane is the lane contract shared by all four stations.
type StationLane struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Title         string          `json:"title,omitempty"` // the backlog sentence of a lane without a record
	Home          string          `json:"home"`
	SecondMate    string          `json:"secondMate"`
	State         string          `json:"state"`
	SourceState   string          `json:"sourceState"`
	Now           string          `json:"now"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	History       []StationChange `json:"history"`
	Asks          []StationAsk    `json:"asks"`
	Start         time.Time       `json:"start"`
	Ticket        *LaneRecordLink `json:"ticket,omitempty"`
	InvalidAsks   int             `json:"invalidAsks"`
	ReturnedSince *time.Time      `json:"returnedSince,omitempty"`
	Progress      float64         `json:"progress"`
}
type StationChange struct {
	At    time.Time `json:"at"`
	State string    `json:"state"`
	Text  string    `json:"text"`
}
type StationAsk = LaneRecordAsk

func readOnlyReason(lane StationLane) string {
	if lane.Home == "local" && lane.SecondMate == "" {
		return "Local drop-in lanes have no owning home to receive answers."
	}
	return "This ask has no verifiable task ID, so it cannot be answered here."
}

func stationLane(l Lane, at time.Time) (StationLane, int) {
	// A lane without a record is named by its ID, as the reference board does; its sentence stays as Title.
	out := StationLane{ID: l.ID, Name: l.ID, SourceState: l.State, UpdatedAt: l.UpdatedAt, Asks: []StationAsk{}, History: []StationChange{}}
	out.Home, out.SecondMate = l.Home, l.SecondMate
	if e, ok := l.Latest(); ok {
		out.Now = e.Text
	}
	hidden, returned := 0, 0
	var returnedSince *time.Time
	// A status-line decision is free text, not a fixed-form ask (ADR 0003): it goes back to
	// the crew and only its count shows. Its text stays in the lane's status log.
	for _, d := range l.Decisions {
		if !d.At.IsZero() && d.At.Before(at.Add(-7*24*time.Hour)) {
			hidden++
			continue
		}
		returned++
		if returnedSince == nil || d.At.Before(*returnedSince) {
			since := d.At
			returnedSince = &since
		}
		if d.Verb == "captain-hold" { // a backlog hold has no status line to keep its text
			out.History = append(out.History, StationChange{At: d.At, State: d.Verb, Text: d.Text})
		}
	}
	out.InvalidAsks = l.InvalidAsks + returned
	out.ReturnedSince = returnedSince
	if l.Record == nil && l.Title != l.ID {
		out.Title = l.Title
	}
	if l.Record != nil {
		out.Name = l.Title
		out.Start, out.Ticket = l.Record.Start, l.Record.Ticket
		out.Now = l.Record.Now
		for _, ask := range l.Record.Asks {
			if !ask.Asked.IsZero() && ask.Asked.Before(at.Add(-7*24*time.Hour)) {
				hidden++
				continue
			}
			ask.Answerable = l.OwnerDir != "" && nativeTaskKey(ask.Key)
			out.Asks = append(out.Asks, ask)
		}
	}
	for _, e := range l.Events {
		out.History = append(out.History, StationChange{At: e.At, State: e.Verb, Text: e.Text})
	}
	sort.SliceStable(out.History, func(i, j int) bool { return out.History[i].At.Before(out.History[j].At) })
	out.State = stationLaneState(l, len(out.Asks)+returned, at)
	out.Progress = stationLaneProgress(out)
	return out, hidden
}

func (l StationLane) waitSince() time.Time {
	var t time.Time
	for i, ask := range l.Asks {
		if i == 0 || ask.Asked.Before(t) {
			t = ask.Asked
		}
	}
	if l.ReturnedSince != nil && (len(l.Asks) == 0 || l.ReturnedSince.Before(t)) {
		t = *l.ReturnedSince
	}
	return t
}

func stationLaneState(l Lane, asks int, at time.Time) string {
	switch {
	case asks > 0:
		return "needs you"
	case l.State == "needs you" && l.Record != nil && !l.HadRecordAsks && len(l.Record.Asks) == 0 && !l.UpdatedAt.IsZero() && !l.UpdatedAt.Before(at.Add(-7*24*time.Hour)):
		return "needs you"
	case l.State == "done":
		return "done"
	case l.State == "working" && !l.UpdatedAt.IsZero() && at.Sub(l.UpdatedAt) < 2*time.Hour:
		return "working"
	case l.State == "waiting":
		return "waiting"
	default:
		return "holding"
	}
}

func stationLaneProgress(out StationLane) float64 {
	switch {
	case out.SourceState == "failed" || out.State == "done":
		return 1
	case out.State == "working" || out.State == "needs you":
		return .72
	case out.State == "waiting":
		return .48
	default:
		return .35
	}
}

func stationFleet(lanes []Lane, at time.Time) ([]StationLane, int, float64) {
	out := make([]StationLane, 0, len(lanes))
	hidden, autonomous := 0, 0
	for _, lane := range lanes {
		row, old := stationLane(lane, at)
		hidden += old
		involved := lane.HadRecordAsks || lane.State == "needs you"
		for _, e := range lane.Events {
			if e.Verb == "needs-decision" || e.Verb == "blocked" || e.Verb == "needs you" {
				involved = true
				break
			}
		}
		if !involved && len(lane.Decisions) == 0 {
			autonomous++
		}
		out = append(out, row)
	}
	rank := map[string]int{"needs you": 0, "waiting": 1, "working": 2, "done": 3, "holding": 4}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if rank[a.State] != rank[b.State] {
			return rank[a.State] < rank[b.State]
		}
		if a.State == "needs you" && !a.waitSince().Equal(b.waitSince()) {
			return a.waitSince().Before(b.waitSince())
		}
		return a.ID < b.ID
	})
	share := 0.0
	if len(lanes) > 0 {
		share = float64(autonomous) / float64(len(lanes))
	}
	return out, hidden, share
}
