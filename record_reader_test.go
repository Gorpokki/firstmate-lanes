package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecordPreferredAndMissingRecordFallsBack(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{
		"example.status":    "done [at=1768046400]: Obsolete status",
		"fallback.status":   "working [at=1768046400]: Status example",
		"example.lane.json": `{"name":"Record example","state":"working","now":"Record wins","start":"2026-01-10T12:00:00Z","history":[{"state":"working","at":"2026-01-10T12:00:00Z"}],"asks":[{"form":"choice","key":"example","question":"Choose a route?","reason":"A route is required","choices":[{"label":"North","effect":"Use northern route"},{"label":"South","effect":"Use southern route"}],"effort":"quick","asked":"2026-01-10T12:00:00Z"}]}`,
	} {
		if err := os.WriteFile(filepath.Join(home, "state", name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	lanes, err := NewReader().LoadFleet(home)
	if err != nil {
		t.Fatal(err)
	}
	fleet := BuildFleet(lanes, time.Date(2026, 1, 10, 13, 0, 0, 0, time.UTC))
	found := map[string]StationLane{}
	for _, l := range fleet.Stations {
		found[l.ID] = l
	}
	if found["example"].Now != "Record wins" || found["example"].State != "needs you" || len(found["example"].Asks) != 1 {
		t.Fatalf("record not preferred: %#v", found["example"])
	}
	if found["fallback"].Now != "Status example" {
		t.Fatalf("fallback lost: %#v", found["fallback"])
	}
}
