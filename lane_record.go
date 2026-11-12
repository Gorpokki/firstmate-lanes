package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

// LaneRecord is the record-specific input contract; the station owner converts it to StationLane.
type LaneRecord struct {
	Name    string             `json:"name"`
	State   string             `json:"state"`
	Now     string             `json:"now"`
	Start   time.Time          `json:"start"`
	Ticket  *LaneRecordLink    `json:"ticket,omitempty"`
	History []LaneRecordChange `json:"history"`
	Asks    []LaneRecordAsk    `json:"asks"`
}

type LaneRecordChange struct {
	At    time.Time `json:"at"`
	State string    `json:"state"`
	Text  string    `json:"text,omitempty"`
}

type LaneRecordLink struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

type LaneRecordChoice struct {
	Label  string `json:"label"`
	Effect string `json:"effect"`
}

// LaneRecordAsk holds both fixed ask forms. Only fields for its Form are populated.
type LaneRecordAsk struct {
	Form         string             `json:"form"`
	Key          string             `json:"key"`
	Question     string             `json:"question,omitempty"`
	Topic        string             `json:"topic,omitempty"`
	MustDecide   []string           `json:"must_decide,omitempty"`
	Reason       string             `json:"reason"`
	Choices      []LaneRecordChoice `json:"choices,omitempty"`
	Pick         *int               `json:"pick,omitempty"`
	PickReason   string             `json:"pick_reason,omitempty"`
	NoPickReason string             `json:"no_pick_reason,omitempty"`
	Effort       string             `json:"effort"`
	Detail       string             `json:"detail,omitempty"`
	Tickets      []LaneRecordLink   `json:"tickets,omitempty"`
	PullRequests []LaneRecordLink   `json:"pull_requests,omitempty"`
	GrillPages   []LaneRecordLink   `json:"grill_pages,omitempty"`
	WaitsOnThis  string             `json:"waits_on_this,omitempty"`
	Asked        time.Time          `json:"asked"`
	Answerable   bool               `json:"answerable"`
}

// ParseLaneRecord validates a lane record. Invalid asks are omitted and counted;
// invalid record-level data returns an error so callers can distinguish it from absence.
func ParseLaneRecord(data []byte) (LaneRecord, int, error) {
	var record LaneRecord
	type recordFields LaneRecord
	input := struct {
		*recordFields
		Asks []json.RawMessage `json:"asks"`
	}{recordFields: (*recordFields)(&record)}
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&input); err != nil {
		return LaneRecord{}, 0, fmt.Errorf("decode lane record: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); err == nil {
		return LaneRecord{}, 0, errors.New("decode lane record: multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return LaneRecord{}, 0, fmt.Errorf("decode lane record: %w", err)
	}
	record.Name, record.Now = clean(record.Name), clean(record.Now)
	if record.Ticket != nil {
		record.Ticket.ID = clean(record.Ticket.ID)
		record.Ticket.Title = clean(record.Ticket.Title)
	}
	for i := range record.History {
		record.History[i].Text = clean(record.History[i].Text)
	}
	if strings.TrimSpace(record.Name) == "" || strings.TrimSpace(record.Now) == "" || record.Start.IsZero() {
		return LaneRecord{}, 0, errors.New("lane record requires name, now, and start")
	}
	if !laneRecordState(record.State) {
		return LaneRecord{}, 0, fmt.Errorf("invalid lane record state %q", record.State)
	}
	if record.Ticket != nil && !validLaneRecordLink(*record.Ticket) {
		return LaneRecord{}, 0, errors.New("invalid lane record ticket link")
	}
	for _, change := range record.History {
		if change.At.IsZero() || !laneRecordState(change.State) {
			return LaneRecord{}, 0, errors.New("invalid lane record history entry")
		}
	}
	valid := make([]LaneRecordAsk, 0, len(input.Asks))
	invalid := 0
	keys := make(map[string]struct{}, len(input.Asks))
	for _, raw := range input.Asks {
		var ask LaneRecordAsk
		if err := json.Unmarshal(raw, &ask); err != nil {
			invalid++
			continue
		}
		for _, value := range []*string{&ask.Question, &ask.Topic, &ask.Reason, &ask.PickReason, &ask.NoPickReason, &ask.Detail, &ask.WaitsOnThis} {
			*value = clean(*value)
		}
		for i := range ask.MustDecide {
			ask.MustDecide[i] = clean(ask.MustDecide[i])
		}
		for i := range ask.Choices {
			ask.Choices[i].Label = clean(ask.Choices[i].Label)
			ask.Choices[i].Effect = clean(ask.Choices[i].Effect)
		}
		for _, links := range [][]LaneRecordLink{ask.Tickets, ask.PullRequests, ask.GrillPages} {
			for i := range links {
				links[i].ID = clean(links[i].ID)
				links[i].Title = clean(links[i].Title)
			}
		}
		if !validLaneRecordAsk(ask) {
			invalid++
			continue
		}
		if _, exists := keys[ask.Key]; exists {
			invalid++
			continue
		}
		keys[ask.Key] = struct{}{}
		valid = append(valid, ask)
	}
	record.Asks = valid
	return record, invalid, nil
}

func laneRecordState(state string) bool {
	switch state {
	case "needs you", "waiting", "working", "done", "holding":
		return true
	default:
		return false
	}
}

func validLaneRecordAsk(a LaneRecordAsk) bool {
	if !slugRe.MatchString(a.Key) || strings.TrimSpace(a.Reason) == "" || a.Asked.IsZero() || (a.Effort != "quick" && a.Effort != "read") {
		return false
	}
	for _, links := range [][]LaneRecordLink{a.Tickets, a.PullRequests, a.GrillPages} {
		for _, link := range links {
			if !validLaneRecordLink(link) {
				return false
			}
		}
	}
	switch a.Form {
	case "choice":
		if strings.TrimSpace(a.Question) == "" || len(a.Choices) < 2 || len(a.Choices) > 4 || (a.Pick != nil && (*a.Pick < 0 || *a.Pick >= len(a.Choices) || strings.TrimSpace(a.PickReason) == "")) {
			return false
		}
		for _, choice := range a.Choices {
			if strings.TrimSpace(choice.Label) == "" || strings.TrimSpace(choice.Effect) == "" {
				return false
			}
		}
		return true
	case "discussion":
		if strings.TrimSpace(a.Topic) == "" || len(a.MustDecide) == 0 {
			return false
		}
		for _, decision := range a.MustDecide {
			if strings.TrimSpace(decision) == "" {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func validLaneRecordLink(link LaneRecordLink) bool {
	if strings.TrimSpace(link.ID) == "" || strings.TrimSpace(link.Title) == "" {
		return false
	}
	u, err := url.Parse(link.URL)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(link.URL, "\r\n\t ")
}
