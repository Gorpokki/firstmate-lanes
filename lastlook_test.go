package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestLastLookTracksStateChangesAcrossDevices(t *testing.T) {
	path := filepath.Join(t.TempDir(), "last-look.json")
	at := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	initial := Fleet{UpdatedAt: at, Stations: []StationLane{{ID: "example", State: "working"}}}
	store := newLastLook(path)
	if err := store.save(initial); err != nil {
		t.Fatal(err)
	}
	next := Fleet{UpdatedAt: at.Add(time.Hour), Stations: []StationLane{{ID: "example", State: "needs you"}, {ID: "new", State: "holding"}}}
	if err := newLastLook(path).apply(&next); err != nil {
		t.Fatal(err)
	}
	if len(next.ChangedLanes) != 2 || next.ChangedLanes[0] != "example" {
		t.Fatalf("changes: %#v", next.ChangedLanes)
	}
	if err := store.save(next); err != nil {
		t.Fatal(err)
	}
	if err := newLastLook(path).apply(&next); err != nil {
		t.Fatal(err)
	}
	if len(next.ChangedLanes) != 0 {
		t.Fatalf("unchanged lanes: %#v", next.ChangedLanes)
	}
}
