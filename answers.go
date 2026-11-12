package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type SittingAnswer struct {
	Lane   string    `json:"lane"`
	Key    string    `json:"key"`
	Kind   string    `json:"kind"`
	Choice int       `json:"choice,omitempty"`
	Text   string    `json:"text,omitempty"`
	Asked  time.Time `json:"asked"`
}
type DeliveryResult struct {
	Lane     string `json:"lane"`
	Key      string `json:"key"`
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason"`
}
type AnswerService struct {
	Reader        *Reader
	Home, Command string
	mu            sync.Mutex
}

// Send validates a confirmed sitting against a fresh reading, then invokes the
// installed keyed-answer intake exactly once for each owning home. No retries.
func (s *AnswerService) Send(ctx context.Context, confirmed bool, answers []SittingAnswer) ([]DeliveryResult, error) {
	if !confirmed {
		return nil, errors.New("explicit confirmation required")
	}
	if len(answers) == 0 || len(answers) > 4 {
		return nil, errors.New("a sitting must contain one to four answers")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lanes, err := s.Reader.LoadFleet(s.Home)
	if err != nil {
		return nil, err
	}
	current := map[string]Lane{}
	for _, l := range lanes {
		current[l.ID] = l
	}
	openKeys := map[string]int{}
	for _, l := range lanes {
		for _, d := range l.Decisions {
			openKeys[l.OwnerDir+"\x00"+d.Key]++
		}
		if l.Record != nil {
			for _, ask := range l.Record.Asks {
				openKeys[l.OwnerDir+"\x00"+ask.Key]++
			}
		}
	}
	results := make([]DeliveryResult, len(answers))
	batches := map[string][]int{}
	payloads := make([]string, len(answers))
	seen := map[string]bool{}
	for i, answer := range answers {
		result := DeliveryResult{Lane: answer.Lane, Key: answer.Key, Reason: "Ask is no longer open"}
		results[i] = result
		lane, ok := current[answer.Lane]
		if !ok {
			continue
		}
		if lane.OwnerDir == "" {
			results[i].Reason = "Local lane has no owning home; no answer was sent"
			continue
		}
		row, _ := stationLane(lane, time.Now())
		var ask *StationAsk
		for j := range row.Asks {
			if row.Asks[j].Key == answer.Key && row.Asks[j].Asked.Equal(answer.Asked) {
				ask = &row.Asks[j]
				break
			}
		}
		if ask == nil {
			continue
		}
		if !ask.Answerable {
			results[i].Reason = readOnlyReason(row) + " No answer was sent."
			continue
		}
		if openKeys[lane.OwnerDir+"\x00"+answer.Key] > 1 {
			results[i].Reason = "Task ID is shared by another open ask in this home; no answer was sent"
			continue
		}
		key := lane.OwnerDir + "\x00" + answer.Key
		if seen[key] {
			results[i].Reason = "Duplicate ask in sitting"
			continue
		}
		var text string
		switch answer.Kind {
		case "choice":
			if ask.Form != "choice" || answer.Choice < 0 || answer.Choice >= len(ask.Choices) {
				results[i].Reason = "Choice is no longer available"
				continue
			}
			choice := ask.Choices[answer.Choice]
			text = choice.Label + ": " + choice.Effect
		case "own":
			text = strings.TrimSpace(answer.Text)
		case "skip":
			text = "Skipped: the crew chooses and reports its choice in its next status line."
		case "grill":
			text = "Grill requested: discuss this ask with the crew before choosing."
		default:
			results[i].Reason = "Invalid answer kind"
			continue
		}
		// The installed intake is a TSV protocol, not a shell or a multiline transport.
		if text == "" || len(text) > 8192 || strings.ContainsAny(text, "\r\n\t\x00") {
			results[i].Reason = "Answer must be a single non-empty line without control separators"
			continue
		}
		seen[key] = true
		payloads[i] = answer.Key + "\t" + text + "\t" + answer.Kind + "\n"
		batches[lane.OwnerDir] = append(batches[lane.OwnerDir], i)
	}
	homes := make([]string, 0, len(batches))
	for home := range batches {
		homes = append(homes, home)
	}
	sort.Strings(homes)
	for _, home := range homes {
		command := s.Command
		if command == "" {
			command = filepath.Join(s.Home, "bin", "fm-captain-hold.sh")
		}
		indices := batches[home]
		var input strings.Builder
		for _, i := range indices {
			input.WriteString(payloads[i])
		}
		callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		cmd := exec.CommandContext(callCtx, command, "answers", "--source", "fm-lanes")
		cmd.Stdin = strings.NewReader(input.String())
		env := []string{}
		for _, v := range os.Environ() {
			name, _, _ := strings.Cut(v, "=")
			if name != "FM_HOME" && name != "FM_ROOT_OVERRIDE" && name != "FM_STATE_OVERRIDE" && name != "FM_DATA_OVERRIDE" {
				env = append(env, v)
			}
		}
		cmd.Env = append(env, "FM_HOME="+home)
		output, callErr := cmd.Output()
		cancel()
		accepted := map[string]bool{}
		refused := map[string]string{}
		for _, line := range strings.Split(string(output), "\n") {
			if key, ok := strings.CutPrefix(line, "closed: "); ok {
				accepted[strings.TrimSpace(key)] = true
			}
			for _, prefix := range []string{"skipped: ", "refused: "} {
				if body, ok := strings.CutPrefix(line, prefix); ok {
					key, why, _ := strings.Cut(body, " ")
					refused[key] = strings.TrimSpace(why)
				}
			}
		}
		for _, i := range indices {
			if accepted[answers[i].Key] {
				results[i].Accepted = true
				results[i].Reason = "Accepted"
				if err := s.Reader.acknowledge(home, answers[i].Lane, answers[i].Key, answers[i].Asked); err != nil {
					results[i].Reason = "Accepted; local receipt could not be saved"
				}
				continue
			}
			if reason := refused[answers[i].Key]; reason != "" {
				results[i].Reason = reason
			} else if callErr != nil {
				results[i].Reason = "Keyed-answer command refused or failed"
			} else {
				results[i].Reason = "Keyed-answer command did not accept this ask"
			}
		}
	}
	return results, nil
}
