package main

import (
	"strings"
	"time"
)

// Fleet is the single reading consumed by web, terminal and JSON output.
type Fleet struct {
	UpdatedAt     time.Time     `json:"updatedAt"`
	Stations      []StationLane `json:"stationLanes"`
	HiddenAsks    int           `json:"hiddenAsks"`
	AutonomyShare float64       `json:"autonomyShare"`
	ChangedLanes  []string      `json:"changedLanes"`
}

func BuildFleet(lanes []Lane, at time.Time) Fleet {
	f := Fleet{UpdatedAt: at, ChangedLanes: []string{}}
	f.Stations, f.HiddenAsks, f.AutonomyShare = stationFleet(lanes, at)
	return f
}

func tail[T any](s []T, n int) []T {
	n = max(n, 0)
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}
func oneLine(s string) string { return strings.Join(strings.Fields(s), " ") }
