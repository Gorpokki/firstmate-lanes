package main

import (
	"sort"
	"time"
)

// StationLane is the lane contract shared by all four stations.
type StationLane struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Home        string          `json:"home"`
	SecondMate  string          `json:"secondMate"`
	State       string          `json:"state"`
	SourceState string          `json:"sourceState"`
	Now         string          `json:"now"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	History     []StationChange `json:"history"`
	Asks        []StationAsk    `json:"asks"`
	Start       time.Time       `json:"start"`
	Ticket      *LaneRecordLink `json:"ticket,omitempty"`
	InvalidAsks int             `json:"invalidAsks"`
	Progress    float64         `json:"progress"`
}
type StationChange struct {
	At    time.Time `json:"at"`
	State string    `json:"state"`
	Text  string    `json:"text"`
}
type StationAsk = LaneRecordAsk

func stationLane(l Lane, at time.Time) (StationLane, int) {
	out := StationLane{ID: l.ID, Name: l.Title, SourceState: l.State, UpdatedAt: l.UpdatedAt, Asks: []StationAsk{}, History: []StationChange{}}
	out.Home, out.SecondMate = l.Home, l.SecondMate
	if e, ok := l.Latest(); ok {
		out.Now = e.Text
	}
	hidden := 0
	for _, d := range l.Decisions {
		if d.At.IsZero() || d.At.Before(at.Add(-7*24*time.Hour)) {
			hidden++
			continue
		}
		out.Asks = append(out.Asks, StationAsk{Key: d.Key, Form: "discussion", Topic: d.Text, Question: d.Text, MustDecide: []string{d.Text}, Reason: "Crew needs your answer", Effort: "read", Asked: d.At})
	}
	if l.Record != nil {
		out.Start, out.Ticket, out.InvalidAsks = l.Record.Start, l.Record.Ticket, l.InvalidAsks
		out.Now = l.Record.Now
		for _, ask := range l.Record.Asks {
			if ask.Asked.Before(at.Add(-7 * 24 * time.Hour)) {
				hidden++
				continue
			}
			out.Asks = append(out.Asks, ask)
		}
	}
	for _, e := range l.Events {
		out.History = append(out.History, StationChange{At: e.At, State: e.Verb, Text: e.Text})
	}
	sort.SliceStable(out.History, func(i, j int) bool { return out.History[i].At.Before(out.History[j].At) })
	switch {
	case len(out.Asks) > 0:
		out.State = "needs you"
	case l.State == "needs you" && l.Record != nil && !l.HadRecordAsks && len(l.Record.Asks) == 0 && !l.UpdatedAt.IsZero() && !l.UpdatedAt.Before(at.Add(-7*24*time.Hour)):
		out.State = "needs you"
	case l.State == "done":
		out.State = "done"
	case l.State == "working" && !l.UpdatedAt.IsZero() && at.Sub(l.UpdatedAt) < 2*time.Hour:
		out.State = "working"
	case l.State == "waiting":
		out.State = "waiting"
	default:
		out.State = "holding"
	}
	switch {
	case out.SourceState == "failed" || out.State == "done":
		out.Progress = 1
	case out.State == "working" || out.State == "needs you":
		out.Progress = .72
	case out.State == "waiting":
		out.Progress = .48
	default:
		out.Progress = .35
	}
	return out, hidden
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
		oldest := func(l StationLane) time.Time {
			var t time.Time
			for _, ask := range l.Asks {
				if t.IsZero() || ask.Asked.Before(t) {
					t = ask.Asked
				}
			}
			return t
		}
		if a.State == "needs you" && !oldest(a).Equal(oldest(b)) {
			return oldest(a).Before(oldest(b))
		}
		return a.ID < b.ID
	})
	share := 0.0
	if len(lanes) > 0 {
		share = float64(autonomous) / float64(len(lanes))
	}
	return out, hidden, share
}
