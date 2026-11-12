package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestConfirmedAnswersBatchByHomeAndRefuseStale(t *testing.T) {
	home := t.TempDir()
	for _, dir := range []string{"state", "data", "mate/state", "mate/data"} {
		if err := os.MkdirAll(filepath.Join(home, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	asked := time.Now().UTC().Truncate(time.Second)
	record := func(key string) []byte {
		return []byte(`{"name":"Example","state":"waiting","now":"Awaiting route","start":"2026-01-01T00:00:00Z","asks":[{"form":"choice","key":"` + key + `","question":"Choose route?","reason":"Route required","effort":"quick","asked":"` + asked.Format(time.RFC3339) + `","choices":[{"label":"North","effect":"Travel north"},{"label":"South","effect":"Travel south"}]}]}`)
	}
	for name, data := range map[string][]byte{"state/alpha.lane.json": record("alpha"), "state/beta.lane.json": record("beta"), "mate/state/gamma.lane.json": record("gamma"), "data/secondmates.md": []byte("- design - Design (home: mate)\n")} {
		if err := os.WriteFile(filepath.Join(home, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	log := filepath.Join(home, "command-log")
	command := filepath.Join(home, "answer-command")
	script := "#!/bin/sh\nprintf 'CALL %s\\n' \"$FM_HOME\" >> '" + log + "'\nwhile IFS=\"$(printf '\\t')\" read -r key answer label; do printf 'closed: %s\\n' \"$key\"; done\n"
	if err := os.WriteFile(command, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	service := AnswerService{Reader: NewReader(), Home: home, Command: command}
	answers := []SittingAnswer{{Lane: "alpha", Key: "alpha", Kind: "choice", Choice: 0, Asked: asked}, {Lane: "beta", Key: "beta", Kind: "own", Text: "Use the coastal route", Asked: asked}, {Lane: "design/gamma", Key: "gamma", Kind: "skip", Asked: asked}, {Lane: "missing", Key: "stale", Kind: "choice", Asked: asked}}
	if _, err := service.Send(context.Background(), false, answers); err == nil {
		t.Fatal("unconfirmed sitting accepted")
	}
	if _, err := os.Stat(log); !os.IsNotExist(err) {
		t.Fatal("unconfirmed sitting invoked command")
	}
	results, err := service.Send(context.Background(), true, answers)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 4 || !results[0].Accepted || !results[1].Accepted || !results[2].Accepted || results[3].Accepted {
		t.Fatalf("results: %#v", results)
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(calls), "CALL ") != 2 {
		t.Fatalf("not batched per home: %s", calls)
	}
}

func TestKeylessAndSharedTaskIDsAreNotDelivered(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	record := func(key string) []byte {
		return []byte(`{"name":"Example","state":"waiting","now":"Awaiting route","start":"2026-01-01T00:00:00Z","asks":[{"form":"choice","key":"` + key + `","question":"Choose route?","reason":"Route required","effort":"quick","asked":"` + now.Format(time.RFC3339) + `","choices":[{"label":"North","effect":"Travel north"},{"label":"South","effect":"Travel south"}]}]}`)
	}
	status := "needs-decision [key=shared] [at=" + strconv.FormatInt(now.Unix(), 10) + "]: Choose route\n"
	for name, data := range map[string][]byte{"state/alpha.lane.json": record("shared"), "state/gamma.lane.json": record("unique"), "state/beta.status": []byte(status), "state/delta.status": []byte("needs-decision: Keyless question\n")} {
		if err := os.WriteFile(filepath.Join(home, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	log := filepath.Join(home, "command-log")
	command := filepath.Join(home, "answer-command")
	script := "#!/bin/sh\nprintf 'CALL\\n' >> '" + log + "'\nwhile IFS=\"$(printf '\\t')\" read -r key answer label; do printf 'closed: %s\\n' \"$key\"; done\n"
	if err := os.WriteFile(command, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	service := AnswerService{Reader: NewReader(), Home: home, Command: command}
	answers := []SittingAnswer{
		{Lane: "alpha", Key: "shared", Kind: "own", Text: "Use the coastal route", Asked: now},
		{Lane: "delta", Key: "default", Kind: "own", Text: "Use the coastal route"},
		{Lane: "gamma", Key: "unique", Kind: "own", Text: "Use the coastal route", Asked: now},
	}
	results, err := service.Send(context.Background(), true, answers)
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Accepted || results[1].Accepted || !results[2].Accepted {
		t.Fatalf("results: %#v", results)
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(calls), "CALL") != 1 {
		t.Fatalf("refused asks reached the intake: %s", calls)
	}
}

func TestAnswerHTTPRequiresAllowedHostAndConfirmation(t *testing.T) {
	handler := hostGuard(answerHandler(&AnswerService{}), nil)
	for _, c := range []struct {
		host, action, body string
		status             int
	}{
		{"malicious.example.test", "confirm", `{"confirmed":true,"answers":[]}`, http.StatusForbidden},
		{"localhost", "", "{}", http.StatusBadRequest},
		{"localhost", "confirm", `{"confirmed":false,"answers":[]}`, http.StatusBadRequest},
	} {
		req := httptest.NewRequest(http.MethodPost, "http://"+c.host+"/answers", strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Fleet-Action", c.action)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != c.status {
			t.Fatalf("host=%s action=%s status=%d want=%d", c.host, c.action, response.Code, c.status)
		}
	}
}
