package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
)

type sittingItem struct {
	lane  StationLane
	ask   StationAsk
	round int
}
type sitting struct {
	items                                          []sittingItem
	index, reviewIndex, offset                     int
	answers                                        []SittingAnswer
	deferred                                       map[string]bool
	own                                            string
	ownMode, searchMode, review, details, finished bool
	message                                        string
}
type answerResultMsg struct {
	results []DeliveryResult
	err     error
}

func (s *sitting) untouched() bool { return len(s.answers) == 0 && len(s.deferred) == 0 }

func (s *sitting) load(lanes []StationLane) {
	*s = sitting{deferred: map[string]bool{}}
	for _, lane := range lanes {
		asks := append([]StationAsk(nil), lane.Asks...)
		sort.SliceStable(asks, func(i, j int) bool {
			if asks[i].Effort != asks[j].Effort {
				return asks[i].Effort == "quick"
			}
			return asks[i].Asked.Before(asks[j].Asked)
		})
		for round, ask := range asks {
			s.items = append(s.items, sittingItem{lane, ask, round})
		}
	}
	sort.SliceStable(s.items, func(i, j int) bool {
		a, b := s.items[i], s.items[j]
		if a.ask.Effort != b.ask.Effort {
			return a.ask.Effort == "quick"
		}
		if a.lane.SecondMate != b.lane.SecondMate {
			return a.lane.SecondMate < b.lane.SecondMate
		}
		if a.round != b.round {
			return a.round < b.round
		}
		if !a.ask.Asked.Equal(b.ask.Asked) {
			return a.ask.Asked.Before(b.ask.Asked)
		}
		if a.lane.Name != b.lane.Name {
			return a.lane.Name < b.lane.Name
		}
		return a.ask.Key < b.ask.Key
	})
	if len(s.items) > 4 {
		s.items = s.items[:4]
	}
}
func sitKey(lane, key string, asked time.Time) string {
	return fmt.Sprintf("%s\x00%s\x00%d", lane, key, asked.UnixNano())
}
func itemKey(it sittingItem) string    { return sitKey(it.lane.ID, it.ask.Key, it.ask.Asked) }
func answerKey(a SittingAnswer) string { return sitKey(a.Lane, a.Key, a.Asked) }
func (s *sitting) current() (sittingItem, bool) {
	if s.index < 0 || s.index >= len(s.items) {
		return sittingItem{}, false
	}
	return s.items[s.index], true
}
func (s *sitting) editAnswer(index int) {
	if index < 0 || index >= len(s.answers) {
		return
	}
	for i, it := range s.items {
		if itemKey(it) == answerKey(s.answers[index]) {
			s.index = i
			s.review = false
			s.finished = false
			return
		}
	}
}
func (s *sitting) key(m *model, k string, lanes []StationLane) {
	if k == "pgdown" {
		s.offset += max(1, m.h-3)
		return
	}
	if k == "pgup" {
		s.offset = max(0, s.offset-max(1, m.h-3))
		return
	}
	s.offset = 0
	if s.ownMode {
		switch k {
		case "enter":
			if s.searchMode {
				needle := strings.ToLower(strings.TrimSpace(s.own))
				for i, it := range s.items {
					if needle != "" && strings.Contains(strings.ToLower(it.lane.Name+" "+it.ask.Question+" "+it.ask.Topic), needle) {
						s.index = i
						break
					}
				}
			} else if strings.TrimSpace(s.own) != "" {
				s.commit("own", s.own, 0)
			} else {
				s.message = "An own answer cannot be empty"
				return
			}
			s.ownMode = false
			s.searchMode = false
			s.own = ""
		case "esc":
			s.ownMode = false
			s.searchMode = false
			s.own = ""
		case "backspace", "ctrl+h":
			if r := []rune(s.own); len(r) > 0 {
				s.own = string(r[:len(r)-1])
			}
		default:
			if k == "space" {
				k = " "
			}
			if len([]rune(k)) == 1 && !unicode.IsControl([]rune(k)[0]) {
				s.own += k
			}
		}
		return
	}
	if s.finished {
		if k == "n" {
			s.load(lanes)
		}
		return
	}
	if s.review {
		switch k {
		case "up", "k":
			s.reviewIndex = max(0, s.reviewIndex-1)
		case "down", "j":
			s.reviewIndex = min(max(0, len(s.answers)-1), s.reviewIndex+1)
		case "y":
			if len(s.answers) > 0 {
				m.answers = append([]SittingAnswer(nil), s.answers...)
				m.pendingSend = true
				s.message = "Sending confirmed sitting…"
			}
		case "n", "esc":
			s.review = false
		case "u":
			s.undo()
		case "c":
			s.editAnswer(s.reviewIndex)
		case "o":
			s.editAnswer(s.reviewIndex)
			s.beginOwn()
		}
		return
	}
	switch k {
	case "up", "k":
		s.index = max(0, s.index-1)
	case "down", "j":
		s.index = min(max(0, len(s.items)-1), s.index+1)
	case "1", "2", "3", "4":
		if it, ok := s.current(); ok && it.ask.Form == "choice" {
			choice := int(k[0] - '1')
			if choice < len(it.ask.Choices) {
				s.commit("choice", "", choice)
			}
		}
	case "o":
		s.beginOwn()
	case "s":
		s.commit("skip", "", 0)
	case "g":
		s.commit("grill", "", 0)
	case "d":
		if it, ok := s.current(); ok {
			s.deferred[itemKey(it)] = true
			s.advance()
			s.message = "Deferred; it returns in a later sitting"
		}
	case "u":
		s.undo()
	case "r":
		s.review = true
		s.message = "Review before sending"
	case "v":
		s.details = !s.details
	case "n":
		if _, ok := s.current(); !ok && len(s.answers) == 0 {
			s.load(lanes)
		}
	case "/":
		s.ownMode = true
		s.searchMode = true
		s.own = ""
	}
}
func (s *sitting) beginOwn() {
	if it, ok := s.current(); ok {
		s.ownMode = true
		s.searchMode = false
		s.own = ""
		for _, a := range s.answers {
			if answerKey(a) == itemKey(it) && a.Kind == "own" {
				s.own = a.Text
			}
		}
	}
}
func (s *sitting) commit(kind, txt string, choice int) {
	it, ok := s.current()
	if !ok {
		return
	}
	if !it.ask.Answerable {
		s.message = "No verifiable task ID; this ask is read-only here"
		return
	}
	answer := SittingAnswer{Lane: it.lane.ID, Key: it.ask.Key, Kind: kind, Text: txt, Choice: choice, Asked: it.ask.Asked}
	delete(s.deferred, itemKey(it))
	for i, a := range s.answers {
		if answerKey(a) == itemKey(it) {
			s.answers[i] = answer
			s.advance()
			s.message = "Answer updated"
			return
		}
	}
	if len(s.answers) >= 4 {
		return
	}
	s.answers = append(s.answers, answer)
	s.advance()
	s.message = "Answer recorded; nothing sent"
}
func (s *sitting) advance() {
	for n := 1; n <= len(s.items); n++ {
		i := (s.index + n) % len(s.items)
		it := s.items[i]
		answered := false
		for _, a := range s.answers {
			if answerKey(a) == itemKey(it) {
				answered = true
				break
			}
		}
		if !answered && !s.deferred[itemKey(it)] {
			s.index = i
			return
		}
	}
	s.index = len(s.items)
	s.review = len(s.answers) > 0
}
func (s *sitting) undo() {
	if len(s.answers) == 0 {
		s.message = "No answers to undo"
		return
	}
	i := len(s.answers) - 1
	if s.review {
		i = min(s.reviewIndex, i)
	}
	s.editAnswer(i)
	s.answers = append(s.answers[:i], s.answers[i+1:]...)
	s.reviewIndex = min(s.reviewIndex, max(0, len(s.answers)-1))
	s.message = "Answer undone; nothing sent"
}
func (m *model) applyAnswerResult(msg answerResultMsg) {
	m.pendingSend = false
	if msg.err != nil {
		m.sitting.message = "Send failed: " + msg.err.Error()
		return
	}
	accepted := map[string]bool{}
	var rows []string
	for _, r := range msg.results {
		status := "REFUSED"
		if r.Accepted {
			status = "ACCEPTED"
			accepted[r.Lane+"\x00"+r.Key] = true
		}
		rows = append(rows, fmt.Sprintf("%s %s / %s — %s", status, r.Lane, r.Key, r.Reason))
	}
	remaining := m.sitting.answers[:0]
	for _, a := range m.sitting.answers {
		if !accepted[a.Lane+"\x00"+a.Key] {
			remaining = append(remaining, a)
		}
	}
	m.sitting.answers = remaining
	m.answers = nil
	m.sitting.message = strings.Join(rows, " · ")
	m.sitting.finished = len(remaining) == 0
	m.sitting.review = !m.sitting.finished
}
func askQuestion(ask StationAsk) string {
	if ask.Question != "" {
		return ask.Question
	}
	return ask.Topic
}
func (s sitting) view(w, h int, lanes []StationLane) []string {
	rows := []string{}
	render := func(tag string) []string {
		var wrapped []string
		for _, row := range rows {
			wrapped = append(wrapped, wrap(row, w-4)...)
		}
		offset := min(s.offset, max(0, len(wrapped)-(h-1)))
		return frame("Ask", cPeach, tag+" · pgup/pgdn", wrapped[offset:], w, h)
	}
	if s.message != "" {
		rows = append(rows, dim.Render(clean(s.message)), "")
	}
	if s.finished {
		rows = append(rows, text.Render("n NEXT SITTING · l List · f Fleet · enter Lane"))
		return render("delivery")
	}
	if len(s.items) == 0 {
		rows = append(rows, dim.Render("NO OPEN ASKS"), text.Render("Select lanes in List; a opens their sitting. l List · f Fleet · enter Lane"))
		return render("0 asks")
	}
	if s.ownMode {
		label := "OWN ANSWER"
		if s.searchMode {
			label = "FIND ASK"
		}
		rows = append(rows, lab(cPeach).Render(label), text.Render(s.own+"▌"), dim.Render("enter keeps draft · esc cancels; nothing sent"))
		return render(label)
	}
	if s.review {
		rows = append(rows, lab(cPeach).Render("REVIEW BEFORE SEND"), "")
		for i, a := range s.answers {
			name, question, answer := a.Lane, a.Key, a.Text
			for _, it := range s.items {
				if itemKey(it) == answerKey(a) {
					name = it.lane.Name
					question = askQuestion(it.ask)
					if a.Kind == "choice" && a.Choice < len(it.ask.Choices) {
						answer = it.ask.Choices[a.Choice].Label
					}
				}
			}
			mark := " "
			if i == s.reviewIndex {
				mark = "›"
			}
			rows = append(rows, text.Render(mark+" "+name+" — "+oneLine(question)), dim.Render("  "+a.Kind+" · "+oneLine(answer)))
		}
		rows = append(rows, "", text.Render("↑↓ select · c change · o own · u undo · n return"), lab(cPeach).Render("y CONFIRM AND SEND ONCE"))
		return render(fmt.Sprintf("%d / 4", len(s.answers)))
	}
	it, ok := s.current()
	if !ok {
		rows = append(rows, text.Render("All asks deferred. n starts another sitting; l opens List."))
		return render("deferred")
	}
	a := it.ask
	rows = append(rows, pill(a.Effort, cGold)+" "+lab(cPeach).Render(it.lane.Name)+dim.Render(" · "+it.lane.SecondMate), "", text.Render(oneLine(askQuestion(a))), dim.Render(oneLine(a.Reason)), "")
	if a.Form == "discussion" {
		rows = append(rows, lab(cGold).Render("g ASK FOR GRILL"))
		for _, item := range a.MustDecide {
			rows = append(rows, "• "+oneLine(item))
		}
	} else {
		for i, c := range a.Choices {
			mark := ""
			if a.Pick != nil && *a.Pick == i {
				mark = " · crew pick: " + a.PickReason
			}
			if a.Pick == nil && i == 0 {
				mark = " · board suggestion: first listed (board ordering fallback)"
			}
			rows = append(rows, fmt.Sprintf("%d  %s — %s%s", i+1, c.Label, oneLine(c.Effect), mark))
		}
		if a.Pick == nil && a.NoPickReason != "" {
			rows = append(rows, dim.Render("Crew gave no pick: "+oneLine(a.NoPickReason)))
		}
	}
	if !a.Answerable {
		rows = append(rows, dim.Render("No verifiable task ID: read-only here; d defers."))
	}
	if s.details {
		asked := "time unknown"
		if !a.Asked.IsZero() {
			asked = a.Asked.Format(time.RFC3339)
		}
		rows = append(rows, "", text.Render(oneLine(a.Detail)), dim.Render("Asked "+asked+" · waiting impact: "+oneLine(a.WaitsOnThis)))
		for _, group := range [][]LaneRecordLink{a.Tickets, a.PullRequests, a.GrillPages} {
			for _, link := range group {
				rows = append(rows, oneLine(link.Title)+" "+link.URL)
			}
		}
	}
	rows = append(rows, "", text.Render("1–4 choose · o own · s crew decides · g grill · d defer"), dim.Render("u undo · r review · v details · / find · space spin · l List · f Fleet · enter Lane"))
	return render(fmt.Sprintf("%d of %d", s.index+1, len(s.items)))
}
