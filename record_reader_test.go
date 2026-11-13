package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRecordPreferredAndMissingRecordFallsBack(t *testing.T) {
	home := t.TempDir()
	for _, dir := range []string{"state", "data"} {
		if err := os.Mkdir(filepath.Join(home, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	sentence := "Compare three cache layers for the read API and write the results to a report"
	backlog := "## In flight\n- [ ] fallback - " + sentence + " (kind: scout)\n- [ ] example - A sentence the record name replaces (kind: ship)\n"
	writeTestFile(t, filepath.Join(home, "data", "backlog.md"), []byte(backlog))
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
	f, e := found["fallback"], found["example"]
	if got, want := [4]string{f.Name, f.Title, e.Name, e.Title}, [4]string{"fallback", sentence, "Record example", ""}; got != want {
		t.Fatalf("fallback and record name/title = %q, want %q", got, want)
	}
}

func TestSidecarFailureIdentifiesFileAndCauseOverHTTP(t *testing.T) {
	cause := json.Unmarshal([]byte(`{`), new(any)).Error()
	for _, file := range []string{"last-look.json", "accepted-asks.json"} {
		t.Run(file, func(t *testing.T) {
			home := t.TempDir()
			if err := os.Mkdir(filepath.Join(home, "state"), 0700); err != nil {
				t.Fatal(err)
			}
			stateDir := t.TempDir()
			if err := os.WriteFile(filepath.Join(stateDir, file), []byte(`{`), 0600); err != nil {
				t.Fatal(err)
			}
			reader := NewReader()
			reader.receiptPath = filepath.Join(stateDir, "accepted-asks.json")
			handler, err := boardHandler(home, runtimeConfig{}, reader, newLastLook(filepath.Join(stateDir, "last-look.json")), &AnswerService{Reader: reader, Home: home}, nil)
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost/fleet.json", nil))
			body := response.Body.String()
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(body, file) || !strings.Contains(body, cause) {
				t.Fatalf("status=%d, want %s and %q in %q", response.Code, file, cause, body)
			}
		})
	}
}

func TestSourceFailureIdentifiesFileAndCauseOverHTTP(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "state", "broken.lane.json"), []byte(`{"name":`), 0600); err != nil {
		t.Fatal(err)
	}
	reader := NewReader()
	handler, err := boardHandler(home, runtimeConfig{}, reader, newLastLook(filepath.Join(t.TempDir(), "last-look.json")), &AnswerService{Reader: reader, Home: home}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/fleet.json"},
		{http.MethodPost, "/last-look"},
	} {
		t.Run(route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, "http://localhost"+route.path, nil)
			request.Header.Set("X-Fleet-Action", "save")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("status=%d, want source failure", response.Code)
			}
			body := response.Body.String()
			if !strings.Contains(body, "broken.lane.json") || !strings.Contains(body, io.ErrUnexpectedEOF.Error()) {
				t.Fatalf("source filename or underlying cause missing: %q", body)
			}
		})
	}
}
