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
	openKeys := answersOpenKeys(lanes)
	results := make([]DeliveryResult, len(answers))
	batches := map[string][]int{}
	payloads := make([]string, len(answers))
	seen := map[string]bool{}
	for i, answer := range answers {
		results[i] = DeliveryResult{Lane: answer.Lane, Key: answer.Key}
		lane, text, reason := answersPrepare(answer, current, openKeys, seen)
		if reason != "" {
			results[i].Reason = reason
			continue
		}
		seen[lane.OwnerDir+"\x00"+answer.Key] = true
		payloads[i] = answer.Key + "\t" + text + "\t" + answer.Kind + "\n"
		batches[lane.OwnerDir] = append(batches[lane.OwnerDir], i)
	}
	homes := make([]string, 0, len(batches))
	for home := range batches {
		homes = append(homes, home)
	}
	sort.Strings(homes)
	for _, home := range homes {
		indices := batches[home]
		var input strings.Builder
		for _, i := range indices {
			input.WriteString(payloads[i])
		}
		output, callErr := s.answersRunHome(ctx, home, input.String())
		accepted, refused := answersParseOutput(string(output))
		for _, i := range indices {
			s.answersRecord(&results[i], home, answers[i], accepted, refused, callErr)
		}
	}
	return results, nil
}

func answersOpenKeys(lanes []Lane) map[string]int {
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
	return openKeys
}

func answersFindAsk(row StationLane, answer SittingAnswer) *StationAsk {
	for j := range row.Asks {
		if row.Asks[j].Key == answer.Key && row.Asks[j].Asked.Equal(answer.Asked) {
			return &row.Asks[j]
		}
	}
	return nil
}

// answersPrepare returns the lane and TSV text for an answer, or a non-empty refusal reason.
func answersPrepare(answer SittingAnswer, current map[string]Lane, openKeys map[string]int, seen map[string]bool) (Lane, string, string) {
	const closed = "Ask is no longer open"
	lane, ok := current[answer.Lane]
	if !ok {
		return lane, "", closed
	}
	if lane.OwnerDir == "" {
		return lane, "", "Local lane has no owning home; no answer was sent"
	}
	row, _ := stationLane(lane, time.Now())
	ask := answersFindAsk(row, answer)
	if ask == nil {
		return lane, "", closed
	}
	if !ask.Answerable {
		return lane, "", readOnlyReason(row) + " No answer was sent."
	}
	key := lane.OwnerDir + "\x00" + answer.Key
	if openKeys[key] > 1 {
		return lane, "", "Task ID is shared by another open ask in this home; no answer was sent"
	}
	if seen[key] {
		return lane, "", "Duplicate ask in sitting"
	}
	text, reason := answersText(answer, ask)
	if reason != "" {
		return lane, "", reason
	}
	// The installed intake is a TSV protocol, not a shell or a multiline transport.
	if text == "" || len(text) > 8192 || strings.ContainsAny(text, "\r\n\t\x00") {
		return lane, "", "Answer must be a single non-empty line without control separators"
	}
	return lane, text, ""
}

func answersText(answer SittingAnswer, ask *StationAsk) (string, string) {
	switch answer.Kind {
	case "choice":
		if ask.Form != "choice" || answer.Choice < 0 || answer.Choice >= len(ask.Choices) {
			return "", "Choice is no longer available"
		}
		choice := ask.Choices[answer.Choice]
		return choice.Label + ": " + choice.Effect, ""
	case "own":
		return strings.TrimSpace(answer.Text), ""
	case "skip":
		return "Skipped: the crew chooses and reports its choice in its next status line.", ""
	case "grill":
		return "Grill requested: discuss this ask with the crew before choosing.", ""
	}
	return "", "Invalid answer kind"
}

func (s *AnswerService) answersRunHome(ctx context.Context, home, input string) ([]byte, error) {
	command := s.Command
	if command == "" {
		command = filepath.Join(s.Home, "bin", "fm-captain-hold.sh")
	}
	callCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(callCtx, command, "answers", "--source", "fm-lanes")
	cmd.Stdin = strings.NewReader(input)
	env := []string{}
	for _, v := range os.Environ() {
		name, _, _ := strings.Cut(v, "=")
		if name != "FM_HOME" && name != "FM_ROOT_OVERRIDE" && name != "FM_STATE_OVERRIDE" && name != "FM_DATA_OVERRIDE" {
			env = append(env, v)
		}
	}
	cmd.Env = append(env, "FM_HOME="+home)
	return cmd.Output()
}

func answersParseOutput(output string) (map[string]bool, map[string]string) {
	accepted := map[string]bool{}
	refused := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
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
	return accepted, refused
}

func (s *AnswerService) answersRecord(result *DeliveryResult, home string, answer SittingAnswer, accepted map[string]bool, refused map[string]string, callErr error) {
	if accepted[answer.Key] {
		result.Accepted = true
		result.Reason = "Accepted"
		if err := s.Reader.acknowledge(home, answer.Lane, answer.Key, answer.Asked); err != nil {
			result.Reason = "Accepted; local receipt could not be saved"
		}
		return
	}
	if reason := refused[answer.Key]; reason != "" {
		result.Reason = reason
	} else if callErr != nil {
		result.Reason = "Keyed-answer command refused or failed"
	} else {
		result.Reason = "Keyed-answer command did not accept this ask"
	}
}
