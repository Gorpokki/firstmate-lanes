package main

import (
	"strings"
	"testing"
)

const validLaneRecord = `{
  "name":"Synthetic lane","state":"needs you","now":"Waiting for a decision","start":"2026-06-01T09:00:00Z","ticket":{"id":"T-17","title":"Synthetic ticket","url":"https://example.test/tickets/17"},
  "history":[{"at":"2026-06-01T09:00:00Z","state":"working","text":"Started"}],
  "asks":[
    {"form":"choice","key":"stable-choice-1","question":"Which approach?","reason":"The tradeoff matters.","choices":[{"label":"A","effect":"Keeps the API stable."},{"label":"B","effect":"Removes old behavior."}],"pick":0,"pick_reason":"A fits callers.","effort":"quick","asked":"2026-06-02T10:00:00Z"},
    {"form":"discussion","key":"stable-discussion-1","topic":"Release timing","must_decide":["Whether to release","Who approves"],"reason":"A decision is needed.","effort":"read","detail":"Full synthetic context.","waits_on_this":"Release is blocked","asked":"2026-06-02T11:00:00Z","tickets":[{"id":"T-17","title":"Ticket","url":"http://example.test/t/17"}]}
  ]
}`

func TestParseLaneRecordFixedAskForms(t *testing.T) {
	record, invalid, err := ParseLaneRecord([]byte(validLaneRecord))
	if err != nil {
		t.Fatal(err)
	}
	if invalid != 0 || len(record.Asks) != 2 {
		t.Fatalf("invalid=%d asks=%d", invalid, len(record.Asks))
	}
	choice, discussion := record.Asks[0], record.Asks[1]
	if choice.Form != "choice" || choice.Key != "stable-choice-1" || len(choice.Choices) != 2 || choice.Pick == nil || *choice.Pick != 0 || choice.PickReason == "" {
		t.Fatalf("choice ask lost fields: %#v", choice)
	}
	if discussion.Form != "discussion" || discussion.Topic != "Release timing" || len(discussion.MustDecide) != 2 || discussion.WaitsOnThis == "" || len(discussion.Tickets) != 1 {
		t.Fatalf("discussion ask lost fields: %#v", discussion)
	}
	if record.Name != "Synthetic lane" || record.State != "needs you" || len(record.History) != 1 || record.Ticket == nil {
		t.Fatalf("record lost fields: %#v", record)
	}
}

func TestParseLaneRecordOmitsMalformedAsksAndCountsThem(t *testing.T) {
	input := `{"name":"Synthetic","state":"working","now":"Building","start":"2026-01-01T00:00:00Z","asks":[{"form":"choice","key":"bad","question":"Pick?","reason":"Reason","choices":[{"label":"Only","effect":"One"}],"effort":"quick","asked":"2026-01-02T00:00:00Z"},{"form":"unknown","key":"bad-2"},{"form":"discussion","key":"good","topic":"Topic","must_decide":["Decision"],"reason":"Reason","effort":"read","asked":"2026-01-02T00:00:00Z"}]}`
	record, invalid, err := ParseLaneRecord([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if invalid != 2 || len(record.Asks) != 1 || record.Asks[0].Key != "good" {
		t.Fatalf("invalid=%d asks=%#v", invalid, record.Asks)
	}
}

func TestParseLaneRecordValidatesChoiceBoundariesAndLinks(t *testing.T) {
	for _, count := range []int{2, 3, 4} {
		choices := ""
		for i := 0; i < count; i++ {
			if i > 0 {
				choices += ","
			}
			choices += `{"label":"Choice","effect":"Effect"}`
		}
		input := `{"form":"choice","key":"key","question":"Question","reason":"Reason","choices":[` + choices + `],"no_pick_reason":"No recommendation.","effort":"read","asked":"2026-01-02T00:00:00Z","grill_pages":[{"id":"G","title":"Grill","url":"https://example.test/grill"}]}`
		if _, invalid, err := ParseLaneRecord([]byte(`{"name":"Synthetic","state":"working","now":"Working","start":"2026-01-01T00:00:00Z","asks":[` + input + `]}`)); err != nil || invalid != 0 {
			t.Fatalf("choice count %d: invalid=%d err=%v", count, invalid, err)
		}
	}
	for _, badURL := range []string{"javascript:alert(1)", "https:///missing-host", "https://user:secret@example.test/", "http://example.test/with space"} {
		input := `{"form":"discussion","key":"key","topic":"Topic","must_decide":["Decision"],"reason":"Reason","effort":"quick","asked":"2026-01-02T00:00:00Z","tickets":[{"id":"T","title":"Ticket","url":"` + badURL + `"}]}`
		_, invalid, err := ParseLaneRecord([]byte(`{"name":"Synthetic","state":"working","now":"Working","start":"2026-01-01T00:00:00Z","asks":[` + input + `]}`))
		if err != nil || invalid != 1 {
			t.Fatalf("unsafe URL %q: invalid=%d err=%v", badURL, invalid, err)
		}
	}
}

func TestParseLaneRecordRejectsMalformedPresentRecord(t *testing.T) {
	for _, input := range []string{`{`, `{"name":"Synthetic","state":"unknown","now":"Now","start":"2026-01-01T00:00:00Z"}`, `{"name":"Synthetic","state":"working","now":"Now"} {}`} {
		if _, _, err := ParseLaneRecord([]byte(input)); err == nil {
			t.Fatalf("accepted malformed record %q", input)
		}
	}
}

func TestMalformedAskTypesDoNotHideValidRecord(t *testing.T) {
	input := []byte(`{"name":"Synthetic","state":"working","now":"Working","start":"2026-01-01T00:00:00Z","asks":[{"form":"choice","choices":"not an array"}]}`)
	record, invalid, err := ParseLaneRecord(input)
	if err != nil || record.Name != "Synthetic" || invalid != 1 {
		t.Fatalf("record=%#v invalid=%d err=%v", record, invalid, err)
	}
}

func TestRecordTextCannotDriveTerminalControls(t *testing.T) {
	input := strings.Replace(validLaneRecord, "Synthetic lane", `Synthetic\u001blane`, 1)
	input = strings.Replace(input, "Which approach?", `Which\u001bapproach?`, 1)
	record, invalid, err := ParseLaneRecord([]byte(input))
	if err != nil || invalid != 0 {
		t.Fatalf("parse: invalid=%d err=%v", invalid, err)
	}
	if record.Name != "Synthetic lane" || record.Asks[0].Question != "Which approach?" {
		t.Fatalf("control bytes survived: name=%q question=%q", record.Name, record.Asks[0].Question)
	}
}
