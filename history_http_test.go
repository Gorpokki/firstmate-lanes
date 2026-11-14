package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The polled reading carries each lane's line count and no status log; the log is read one bounded page at a time.
func TestHistoryIsReadAPageAtATime(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	const lines = 250
	var log strings.Builder
	for i := range lines {
		fmt.Fprintf(&log, "working [at=%d]: line %d\n", 1700000000+60*i, i)
	}
	if err := os.WriteFile(filepath.Join(home, "state", "long.status"), []byte(log.String()), 0600); err != nil {
		t.Fatal(err)
	}
	reader := NewReader()
	handler, err := boardHandler(home, runtimeConfig{}, reader, newLastLook(filepath.Join(t.TempDir(), "last-look.json")), &AnswerService{Reader: reader, Home: home}, nil)
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string, into any) int {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost"+path, nil))
		if response.Code == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), into); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
		}
		return response.Code
	}
	var fleet Fleet
	if get("/fleet.json", &fleet); len(fleet.Stations) != 1 || fleet.Stations[0].HistoryLines != lines || len(fleet.Stations[0].History) != 0 {
		t.Fatalf("polled reading: %+v", fleet.Stations)
	}
	lane := "/lane-history.json?lane=" + fleet.Stations[0].ID
	type shape struct {
		from, length int
		first        string
		until        bool
	}
	for query, want := range map[string]shape{
		"":             {150, 100, "line 150", false},
		"&before=150":  {50, 100, "line 50", true},
		"&before=50":   {0, 50, "line 0", true},
		"&before=9999": {150, 100, "line 150", false},
		"&before=x":    {150, 100, "line 150", false},
	} {
		page := HistoryPage{Lines: []StationChange{{}}}
		code := get(lane+query, &page)
		got := shape{page.From, len(page.Lines), page.Lines[0].Text, page.Until != nil}
		if code != http.StatusOK || page.Total != lines || got != want {
			t.Errorf("page %q: status %d, total %d, got %+v, want %+v", query, code, page.Total, got, want)
		}
	}
	if code := get("/lane-history.json?lane=absent", nil); code != http.StatusNotFound {
		t.Errorf("unknown lane: status %d, want 404", code)
	}
}
