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
	readOnly                                       int
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
		var asks []StationAsk
		for _, ask := range lane.Asks {
			if ask.Answerable {
				asks = append(asks, ask)
			} else {
				s.readOnly++
			}
		}
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
	switch {
	case s.ownMode:
		s.ownModeKey(k)
	case s.finished:
		if k == "n" {
			s.load(lanes)
		}
	case s.review:
		s.reviewModeKey(m, k)
	default:
		s.askModeKey(k, lanes)
	}
}

func (s *sitting) closeOwnInput() {
	s.ownMode = false
	s.searchMode = false
	s.own = ""
}

func (s *sitting) findAskByOwnText() {
	needle := strings.ToLower(strings.TrimSpace(s.own))
	for i, it := range s.items {
		if needle != "" && strings.Contains(strings.ToLower(it.lane.Name+" "+it.ask.Question+" "+it.ask.Topic), needle) {
			s.index = i
			break
		}
	}
}

func (s *sitting) ownModeKey(k string) {
	switch k {
	case "enter":
		if s.searchMode {
			s.findAskByOwnText()
		} else if strings.TrimSpace(s.own) != "" {
			s.commit("own", s.own, 0)
		} else {
			s.message = "An own answer cannot be empty"
			return
		}
		s.closeOwnInput()
	case "esc":
		s.closeOwnInput()
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
}

func (s *sitting) reviewModeKey(m *model, k string) {
	switch k {
	case "up", "k":
		s.reviewIndex = max(0, s.reviewIndex-1)
	case "down", "j":
		s.reviewIndex = min(max(0, len(s.answers)-1), s.reviewIndex+1)
	case "y":
		if n := s.unanswered(); n > 0 {
			s.message = fmt.Sprintf("%d asks still need an answer, skip or defer; nothing sent", n)
		} else if len(s.answers) > 0 {
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
}

func (s *sitting) chooseByKey(k string) {
	if it, ok := s.current(); ok && it.ask.Form == "choice" {
		choice := int(k[0] - '1')
		if choice < len(it.ask.Choices) {
			s.commit("choice", "", choice)
		}
	}
}

func (s *sitting) deferCurrent() {
	if it, ok := s.current(); ok {
		s.deferred[itemKey(it)] = true
		s.dropAnswer(itemKey(it))
		s.advance()
		s.message = "Deferred; it returns in a later sitting"
	}
}

func (s *sitting) askModeKey(k string, lanes []StationLane) {
	switch k {
	case "up", "k":
		s.index = max(0, s.index-1)
	case "down", "j":
		s.index = min(max(0, len(s.items)-1), s.index+1)
	case "1", "2", "3", "4":
		s.chooseByKey(k)
	case "o":
		s.beginOwn()
	case "s":
		s.commit("skip", "", 0)
	case "g":
		s.commit("grill", "", 0)
	case "d":
		s.deferCurrent()
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
func (s *sitting) answered(it sittingItem) bool {
	for _, a := range s.answers {
		if answerKey(a) == itemKey(it) {
			return true
		}
	}
	return false
}

// unanswered counts the asks of the batch that still lack a choice, own answer, skip or grill.
// Deferred asks have left the batch; y sends only when this is zero.
func (s *sitting) unanswered() int {
	n := 0
	for _, it := range s.items {
		if !s.deferred[itemKey(it)] && !s.answered(it) {
			n++
		}
	}
	return n
}

func (s *sitting) dropAnswer(key string) {
	for i, a := range s.answers {
		if answerKey(a) == key {
			s.answers = append(s.answers[:i], s.answers[i+1:]...)
			s.reviewIndex = min(s.reviewIndex, max(0, len(s.answers)-1))
			return
		}
	}
}

func (s *sitting) advance() {
	for n := 1; n <= len(s.items); n++ {
		i := (s.index + n) % len(s.items)
		it := s.items[i]
		if !s.answered(it) && !s.deferred[itemKey(it)] {
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
	// Accepted asks leave the batch, so refused answers can be changed and sent again.
	items := m.sitting.items[:0]
	for _, it := range m.sitting.items {
		if !accepted[it.lane.ID+"\x00"+it.ask.Key] {
			items = append(items, it)
		}
	}
	m.sitting.items = items
	m.sitting.index = len(items)
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
func sittingFrame(rows []string, tag string, offsetWanted, w, h int) []string {
	var wrapped []string
	for _, row := range rows {
		wrapped = append(wrapped, wrap(row, w-4)...)
	}
	offset := min(offsetWanted, max(0, len(wrapped)-(h-1)))
	return frame("Ask", cPeach, tag+" · pgup/pgdn", wrapped[offset:], w, h)
}

func (s sitting) view(w, h, hidden int) []string {
	rows := []string{}
	if s.message != "" {
		rows = append(rows, dim.Render(clean(s.message)), "")
	}
	if hidden > 0 {
		rows = append(rows, dim.Render(fmt.Sprintf("%d ticked lane(s) hidden by the mate filter are included", hidden)), "")
	}
	body, tag := s.viewBodyRows()
	return sittingFrame(append(rows, body...), tag, s.offset, w, h)
}

func (s sitting) viewBodyRows() ([]string, string) {
	switch {
	case s.finished:
		return []string{text.Render("n NEXT SITTING · l List · f Fleet · enter Lane")}, "delivery"
	case len(s.items) == 0:
		return s.viewNoItemsRows()
	case s.ownMode:
		label := "OWN ANSWER"
		if s.searchMode {
			label = "FIND ASK"
		}
		return []string{lab(cPeach).Render(label), text.Render(s.own + "▌"), dim.Render("enter keeps draft · esc cancels; nothing sent")}, label
	case s.review:
		return s.viewReviewRows()
	}
	return s.viewAskRows()
}

func (s sitting) viewNoItemsRows() ([]string, string) {
	if s.readOnly > 0 {
		return []string{text.Render(fmt.Sprintf("%d read-only asks cannot be answered here. Lane shows why. l List · f Fleet · enter Lane", s.readOnly))}, "read-only"
	}
	return []string{dim.Render("NO OPEN ASKS"), text.Render("Select lanes in List; a opens their sitting. l List · f Fleet · enter Lane")}, "0 asks"
}

func (s sitting) viewReviewRows() ([]string, string) {
	rows := []string{lab(cPeach).Render("REVIEW BEFORE SEND"), ""}
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
	send := lab(cPeach).Render("y CONFIRM AND SEND ONCE")
	if n := s.unanswered(); n > 0 {
		send = dim.Render(fmt.Sprintf("%d asks still need an answer, skip or defer before y sends", n))
	}
	rows = append(rows, "", text.Render("↑↓ select · c change · o own · u undo · n return"), send)
	return rows, fmt.Sprintf("%d / 4", len(s.answers))
}

func (s sitting) viewAskRows() ([]string, string) {
	it, ok := s.current()
	if !ok {
		return []string{text.Render("All asks deferred. n starts another sitting; l opens List.")}, "deferred"
	}
	a := it.ask
	rows := []string{pill(a.Effort, cGold) + " " + lab(cPeach).Render(it.lane.Name) + dim.Render(" · "+it.lane.SecondMate), "", text.Render(oneLine(askQuestion(a))), dim.Render(oneLine(a.Reason)), ""}
	if a.Form == "discussion" {
		rows = append(rows, lab(cGold).Render("g ASK FOR GRILL"))
		for _, item := range a.MustDecide {
			rows = append(rows, "• "+oneLine(item))
		}
	} else {
		rows = append(rows, viewChoiceRows(a)...)
	}
	if s.details {
		rows = append(rows, viewDetailRows(a)...)
	}
	rows = append(rows, "", text.Render("1–4 choose · o own · s crew decides · g grill · d defer"), dim.Render("u undo · r review · v details · / find · space spin · l List · f Fleet · enter Lane"))
	return rows, fmt.Sprintf("%d of %d", s.index+1, len(s.items))
}

func viewChoiceRows(a StationAsk) []string {
	var rows []string
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
	return rows
}

func viewDetailRows(a StationAsk) []string {
	asked := "time unknown"
	if !a.Asked.IsZero() {
		asked = a.Asked.Format(time.RFC3339)
	}
	rows := []string{"", text.Render(oneLine(a.Detail)), dim.Render("Asked " + asked + " · waiting impact: " + oneLine(a.WaitsOnThis))}
	for _, group := range [][]LaneRecordLink{a.Tickets, a.PullRequests, a.GrillPages} {
		for _, link := range group {
			rows = append(rows, oneLine(link.Title)+" "+link.URL)
		}
	}
	return rows
}
