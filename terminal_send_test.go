package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestConfirmDispatchesSittingOnceUntilResult(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	asked := time.Now().UTC().Truncate(time.Second)
	record := []byte(`{"name":"Example","state":"waiting","now":"Awaiting route","start":"2026-01-01T00:00:00Z","asks":[{"form":"choice","key":"alpha","question":"Choose route?","reason":"Route required","effort":"quick","asked":"` + asked.Format(time.RFC3339) + `","choices":[{"label":"North","effect":"Travel north"},{"label":"South","effect":"Travel south"}]}]}`)
	if err := os.WriteFile(filepath.Join(home, "state", "alpha.lane.json"), record, 0600); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(home, "command-log")
	command := filepath.Join(home, "answer-command")
	script := "#!/bin/sh\nprintf 'CALL\\n' >> '" + log + "'\nwhile IFS=\"$(printf '\\t')\" read -r key answer label; do printf 'closed: %s\\n' \"$key\"; done\n"
	if err := os.WriteFile(command, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}

	m := model{view: 0, answerService: &AnswerService{Reader: NewReader(), Home: home, Command: command}}
	m.sitting.review = true
	m.sitting.answers = []SittingAnswer{{Lane: "alpha", Key: "alpha", Kind: "choice", Choice: 0, Asked: asked}}
	var tm tea.Model = m
	var confirm tea.Cmd
	tm, confirm = tm.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("y")})
	if confirm == nil {
		t.Fatal("confirmation returned no send command")
	}
	result, ok := confirm().(answerResultMsg)
	if !ok || result.err != nil || len(result.results) != 1 || !result.results[0].Accepted {
		t.Fatalf("send result: %#v", result)
	}
	for _, key := range []tea.KeyMsg{{Type: tea.KeyEnter}, {Type: tea.KeyDown}, {Type: tea.KeyRunes, Runes: []rune("y")}} {
		var next tea.Cmd
		tm, next = tm.Update(key)
		if next != nil {
			t.Fatalf("key %q while the send is pending returned another send command", key.String())
		}
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(calls), "CALL") != 1 {
		t.Fatalf("keyed-answer command invoked %d times for one home: %s", strings.Count(string(calls), "CALL"), calls)
	}
}
