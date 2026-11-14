package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestAcceptedReceiptsSurviveRestartWithoutHidingNewAsks(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	if err := os.MkdirAll(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	var record LaneRecord
	if err = json.Unmarshal([]byte(validLaneRecord), &record); err != nil {
		t.Fatal(err)
	}
	record.Asks = record.Asks[:1]
	record.Asks[0].Asked = time.Now().UTC().Truncate(time.Second)
	publish := func() {
		data, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(home, "state", "sample.lane.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	publish()
	receipts := filepath.Join(root, "app-state", "accepted.json")
	first := NewReader()
	first.receiptPath = receipts
	if err = first.acknowledge(canonical, "sample", record.Asks[0].Key, record.Asks[0].Close, record.Asks[0].Asked); err != nil {
		t.Fatal(err)
	}
	restarted := NewReader()
	restarted.receiptPath = receipts
	lanes, err := restarted.LoadFleet(home)
	if err != nil {
		t.Fatal(err)
	}
	if asks := BuildFleet(lanes, time.Now()).Stations[0].Asks; len(asks) != 0 {
		t.Fatalf("accepted ask reopened: %+v", asks)
	}
	record.Asks[0].Asked = record.Asks[0].Asked.Add(time.Second)
	publish()
	lanes, err = restarted.LoadFleet(home)
	if err != nil {
		t.Fatal(err)
	}
	if asks := BuildFleet(lanes, time.Now()).Stations[0].Asks; len(asks) != 1 || !asks[0].Asked.Equal(record.Asks[0].Asked) {
		t.Fatalf("new ask hidden by old receipt: %+v", asks)
	}
}

func TestConcurrentReadersPreserveEachAcceptedReceipt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accepted.json")
	asked := time.Now().UTC()
	var workers sync.WaitGroup
	for _, key := range []string{"first", "second"} {
		workers.Add(1)
		go func(key string) {
			defer workers.Done()
			reader := NewReader()
			reader.receiptPath = path
			if err := reader.acknowledge("owner", "lane", key, "", asked); err != nil {
				t.Error(err)
			}
		}(key)
	}
	workers.Wait()
	receipts, err := readReceipts(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"first", "second"} {
		if !receipts["owner\x00lane\x00"+key].Equal(asked) {
			t.Fatalf("lost confirmed receipt %s: %+v", key, receipts)
		}
	}
}

// A done ask and a release ask with the same key and time are different asks: a receipt for one
// must not hide the other, while receipts written before close modes existed still hide a default ask.
func TestAcceptedReceiptBindsTheCloseMode(t *testing.T) {
	asked := time.Date(2026, 1, 10, 9, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		accepted, current string
		hidden            bool
	}{
		{"", "", true}, {"", "done", true}, {"done", "", true}, {"release", "release", true},
		{"", "release", false}, {"done", "release", false}, {"release", "", false}, {"release", "done", false},
	} {
		reader := NewReader()
		if err := reader.acknowledge("owner", "alpha", "task", c.accepted, asked); err != nil {
			t.Fatal(err)
		}
		lanes := []Lane{{ID: "alpha", OwnerDir: "owner", Record: &LaneRecord{Asks: []LaneRecordAsk{{Key: "task", Asked: asked, Close: c.current}}}}}
		reader.removeAccepted(lanes)
		if hidden := len(lanes[0].Record.Asks) == 0; hidden != c.hidden {
			t.Fatalf("receipt for close %q, ask with close %q: hidden=%v want %v", c.accepted, c.current, hidden, c.hidden)
		}
	}
}

func TestAcceptedReceiptDoesNotHideSameKeyInAnotherLane(t *testing.T) {
	reader := NewReader()
	asked := time.Date(2026, 1, 10, 9, 0, 0, 0, time.UTC)
	if err := reader.acknowledge("owner", "alpha", "shared", "", asked); err != nil {
		t.Fatal(err)
	}
	lanes := []Lane{{ID: "beta", OwnerDir: "owner", Decisions: []Decision{{Key: "shared", Verb: "needs-decision", At: asked}}}}
	reader.removeAccepted(lanes)
	if len(lanes[0].Decisions) != 1 {
		t.Fatal("accepting lane alpha hid lane beta's open ask with the same key")
	}
}
