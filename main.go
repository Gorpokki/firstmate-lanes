package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

const (
	cOrange, cPeach, cLav, cBlue, cSky = "#FF9900", "#FFCC99", "#CC99CC", "#9999FF", "#99CCFF"
	cGold, cTan, cRed, cGray, cText    = "#FFCC66", "#DDAA77", "#FF5555", "#777799", "#FFE6CC"
	cDim, cInk                         = "#B8A898", "#000000"
)

func fg(c string) lipgloss.Style { return lipgloss.NewStyle().Foreground(lipgloss.Color(c)) }
func pill(label, c string) string {
	return lipgloss.NewStyle().Background(lipgloss.Color(c)).Foreground(lipgloss.Color(cInk)).Bold(true).Render(" " + strings.ToUpper(label) + " ")
}

var (
	text = fg(cText)
	dim  = fg(cDim)
	lab  = func(c string) lipgloss.Style { return fg(c).Bold(true) }
)

type view struct{ key, label, color string }

var views = []view{{"ask", "Ask", cPeach}, {"list", "List", cSky}, {"fleet", "Fleet", cOrange}, {"lane", "Lane", cLav}}

type model struct {
	r             *Reader
	home          string
	fleet         Fleet
	err           error
	view, sel     int
	w, h          int
	every         time.Duration
	tick          int
	selected      map[string]bool
	sitting       sitting
	pendingSend   bool
	answers       []SittingAnswer
	answerService *AnswerService
	look          *lastLook
	spinPaused    bool
	mateFilter    string
	fleetShipyard bool
	fleetFilter   string
}

func (m model) key(k string) (model, bool) {
	if k == "ctrl+c" {
		return m, true
	}
	if m.pendingSend {
		return m, false
	}
	if m.view == 0 && m.sitting.ownMode {
		m.sitting.key(&m, k, m.askLanes())
		return m, false
	}
	switch k {
	case "q":
		return m, true
	case "a":
		m.enterView(0)
	case "l":
		m.view = 1
	case "f":
		m.view = 2
	case "enter":
		m.view = 3
	case "tab", "right":
		m.enterView((m.view + 1) % len(views))
	case "shift+tab", "left":
		m.enterView((m.view + len(views) - 1) % len(views))
	case "o":
		if m.view == 0 {
			if len(m.sitting.items) == 0 {
				m.openSitting()
			}
			m.sitting.key(&m, "o", m.askLanes())
		}
	case " ", "space":
		if m.view == 1 {
			m.toggleSelected()
		} else if m.view == 0 || m.view == 3 {
			m.spinPaused = !m.spinPaused
		}
	case "m":
		m.cycleMate()
	case "s":
		if m.view == 2 {
			m.fleetShipyard = !m.fleetShipyard
		} else if m.view == 0 {
			m.sitting.key(&m, k, m.askLanes())
		}
	case "1", "2", "3", "4", "5":
		if m.view == 2 {
			states := []string{"needs you", "waiting", "working", "holding", "done"}
			state := states[int(k[0]-'1')]
			if m.fleetFilter == state {
				m.fleetFilter = ""
			} else {
				m.fleetFilter = state
			}
			m.sel = 0
		} else if m.view == 0 {
			m.sitting.key(&m, k, m.askLanes())
		}
	case "b":
		if m.look != nil {
			m.err = m.look.save(m.fleet)
			if m.err == nil {
				m.fleet.ChangedLanes = nil
			}
		}
	case "up", "k":
		if m.view == 0 {
			m.sitting.key(&m, k, m.askLanes())
		} else {
			m.sel = max(0, m.sel-1)
		}
	case "down", "j":
		if m.view == 0 {
			m.sitting.key(&m, k, m.askLanes())
		} else {
			m.sel = min(max(0, len(m.listLanes())-1), m.sel+1)
		}
	default:
		if m.view == 0 {
			m.sitting.key(&m, k, m.askLanes())
		}
	}
	m.clampSelection()
	return m, false
}
func (m *model) clampSelection() {
	if m.sel < 0 {
		m.sel = 0
	}
	if n := len(m.listLanes()); n == 0 {
		m.sel = 0
	} else if m.sel >= n {
		m.sel = n - 1
	}
}
func (m model) lanes() []StationLane { return m.fleet.Stations }
func (m model) listLanes() []StationLane {
	var out []StationLane
	for _, l := range m.lanes() {
		if m.mateFilter != "" && l.SecondMate != m.mateFilter {
			continue
		}
		if m.view == 2 && m.fleetFilter != "" && l.State != m.fleetFilter {
			continue
		}
		out = append(out, l)
	}
	return out
}
func (m model) selectedLane() (StationLane, bool) {
	lanes := m.listLanes()
	if len(lanes) == 0 {
		return StationLane{}, false
	}
	return lanes[min(m.sel, len(lanes)-1)], true
}
func (m *model) toggleSelected() {
	l, ok := m.selectedLane()
	if !ok {
		return
	}
	if m.selected == nil {
		m.selected = map[string]bool{}
	}
	if m.selected[l.ID] {
		delete(m.selected, l.ID)
	} else {
		m.selected[l.ID] = true
	}
}
func (m *model) openSitting() { m.sitting = sitting{}; m.sitting.load(m.askLanes()) }
func (m *model) enterView(v int) {
	m.view = v
	if v == 0 && (m.sitting.finished || m.sitting.untouched()) {
		m.openSitting()
	}
}
func (m model) askLanes() []StationLane {
	var out []StationLane
	for _, l := range m.lanes() {
		if m.mateFilter != "" && l.SecondMate != m.mateFilter {
			continue
		}
		if len(m.selected) == 0 || m.selected[l.ID] {
			out = append(out, l)
		}
	}
	return out
}
func (m *model) cycleMate() {
	mates := []string{""}
	seen := map[string]bool{}
	for _, l := range m.lanes() {
		if l.SecondMate != "" && !seen[l.SecondMate] {
			seen[l.SecondMate] = true
			mates = append(mates, l.SecondMate)
		}
	}
	for i, mate := range mates {
		if mate == m.mateFilter {
			m.mateFilter = mates[(i+1)%len(mates)]
			m.sel = 0
			return
		}
	}
	m.mateFilter = ""
}

func fit(s string, w int) string {
	if w <= 0 {
		return ""
	}
	s = ansi.Truncate(s, w, "…")
	return s + strings.Repeat(" ", max(0, w-ansi.StringWidth(s)))
}
func wrap(s string, w int) []string {
	return strings.Split(ansi.Wrap(oneLine(s), max(1, w), " "), "\n")
}
func frame(title, color, tag string, body []string, w, h int) []string {
	c := fg(color)
	head := c.Render("▄▄▄▄") + " " + lab(color).Render(strings.ToUpper(title)) + " "
	tagS := ""
	if tag != "" {
		tagS = " " + dim.Render(strings.ToUpper(tag))
	}
	fill := w - ansi.StringWidth(head) - ansi.StringWidth(tagS)
	out := []string{fit(head+c.Render(strings.Repeat("▄", max(0, fill)))+tagS, w)}
	for i := 1; i < h; i++ {
		line := ""
		if i-1 < len(body) {
			line = body[i-1]
		}
		bar := "██"
		if i == h-1 {
			bar = "▀▀"
		}
		out = append(out, c.Render(bar)+"  "+fit(line, w-4))
	}
	return out
}
func (m model) header() []string {
	needs, asks := 0, 0
	for _, lane := range m.fleet.Stations {
		if lane.State == "needs you" {
			needs++
		}
		asks += len(lane.Asks)
	}
	top := fmt.Sprintf("FLEET BOARD · %d needs you · %d asks · %.0f%% autonomy · %d changed", needs, asks, m.fleet.AutonomyShare*100, len(m.fleet.ChangedLanes))
	if m.err != nil {
		top += " · " + clean(m.err.Error())
	}
	keys := []string{"a", "l", "f", "enter"}
	var tabs []string
	for i, v := range views {
		label := keys[i] + " " + v.label
		p := pill(label, v.color)
		if i == m.view {
			p = lipgloss.NewStyle().Reverse(true).Bold(true).Render(" " + label + " ")
		}
		tabs = append(tabs, p)
	}
	reading := "not read"
	if !m.fleet.UpdatedAt.IsZero() {
		reading = m.fleet.UpdatedAt.Local().Format("15:04")
	}
	return []string{fit(top, m.w), fit(strings.Join(tabs, " ")+dim.Render(fmt.Sprintf(" · read %s · %d old hidden", reading, m.fleet.HiddenAsks)), m.w)}
}
func (m model) footer() string {
	return fit(fg(cOrange).Render("▀▀▀▀▀▀")+dim.Render(" a Ask · l List · f Fleet · enter Lane · ↑↓ select · m mate · o answer · space select/spin · q quit "), m.w)
}
func (m model) View() string {
	if m.w < 40 || m.h < 10 {
		return "fmlanes needs at least 40x10. q quits."
	}
	if m.view == 0 {
		return strings.Join(m.askView(m.w, m.h), "\n")
	}
	height := m.h - 3
	var body []string
	switch m.view {
	case 1:
		body = m.listView(m.w, height)
	case 2:
		body = m.fleetView(m.w, height)
	case 3:
		body = m.laneView(m.w, height)
	}
	return strings.Join(append(append(m.header(), body...), m.footer()), "\n")
}
func (m model) listView(w, h int) []string {
	lanes := m.listLanes()
	mate := "all"
	if m.mateFilter != "" {
		mate = m.mateFilter
	}
	rows := []string{dim.Render(fmt.Sprintf("%d lanes · %d selected · %d quick · %d read · mate %s", len(lanes), len(m.selected), askCount(lanes, "quick"), askCount(lanes, "read"), mate)), ""}
	state := ""
	focusRow := 0
	for i, l := range lanes {
		if l.State != state {
			state = l.State
			rows = append(rows, lab(stateColor(state)).Render(strings.ToUpper(state)))
		}
		check, cursor := "□", " "
		if m.selected[l.ID] {
			check = "✓"
		}
		if i == m.sel {
			cursor = "›"
			focusRow = len(rows)
		}
		rows = append(rows, text.Render(cursor+" "+check+" "+l.Name)+dim.Render(" · "+l.SecondMate), dim.Render("    "+oneLine(l.Now)))
		for _, ask := range l.Asks {
			rows = append(rows, "    "+pill(ask.Effort, cGold)+" "+oneLine(askQuestion(ask)))
		}
	}
	if len(lanes) == 0 {
		rows = append(rows, dim.Render("NO LANES ON RECORD"))
	}
	start := max(0, focusRow-max(1, h-5))
	return frame("List", cSky, "space selects · a starts sitting", rows[start:], w, h)
}
func (m model) fleetView(w, h int) []string {
	lanes := m.listLanes()
	selected, _ := m.selectedLane()
	rows := []string{dim.Render("1 needs you · 2 waiting · 3 working · 4 holding · 5 done"), dim.Render("s heat / shipyard · ↑↓ select · filter " + m.fleetFilter + " · " + selected.Name), ""}
	if m.fleetShipyard {
		cellWidth := min(32, max(24, w/2))
		cols := max(1, w/cellWidth)
		cellHeight := max(5, min(10, h-4))
		start := 0
		if m.sel >= cols {
			start = (m.sel / cols) * cols
		}
		for first := start; first < len(lanes) && len(rows) < h-1; first += cols {
			cells := []string{}
			for i := first; i < min(first+cols, len(lanes)); i++ {
				lane := lanes[i]
				title := lane.Name
				if i == m.sel {
					title = "› " + title
				}
				body := shipLines(lane, m.tick, cellWidth-4, cellHeight-3)
				body = append(body, dim.Render(shipFor(lane.ID)))
				cells = append(cells, strings.Join(frame(title, stateColor(lane.State), lane.State, body, cellWidth, cellHeight), "\n"))
			}
			rows = append(rows, strings.Split(lipgloss.JoinHorizontal(lipgloss.Top, cells...), "\n")...)
		}
	} else {
		cellWidth := max(20, min(28, w))
		cols := max(1, w/cellWidth)
		start := 0
		if m.sel >= cols*max(1, (h-5)/2) {
			start = (m.sel / cols) * cols
		}
		for first := start; first < len(lanes); first += cols {
			names, states := []string{}, []string{}
			for i := first; i < min(first+cols, len(lanes)); i++ {
				lane := lanes[i]
				mark := " "
				if i == m.sel {
					mark = "›"
				}
				if lane.State == "working" && m.tick%2 == 0 {
					mark = "*"
				}
				names = append(names, fit(fg(stateColor(lane.State)).Render(mark+" "+lane.Name), cellWidth))
				states = append(states, fit(dim.Render("  "+lane.State), cellWidth))
			}
			rows = append(rows, strings.Join(names, ""), strings.Join(states, ""))
		}
	}
	if len(lanes) == 0 {
		rows = append(rows, dim.Render("NO LANES MATCH"))
	}
	return frame("Fleet", cOrange, selected.Name, rows, w, h)
}
func (m model) laneView(w, h int) []string {
	l, ok := m.selectedLane()
	if !ok {
		return frame("Lane", cGray, "", []string{dim.Render("NO LANE SELECTED")}, w, h)
	}
	rows := []string{pill(l.State, stateColor(l.State)) + " " + lab(cPeach).Render(l.Name) + dim.Render(" · "+shipFor(l.ID))}
	rows = append(rows, shipLines(l, m.tick, max(1, w-4), max(2, h/3))...)
	rows = append(rows, text.Render("CREW'S LAST WORD  "+oneLine(l.Now)), lab(cLav).Render("HISTORY"))
	for _, event := range tail(l.History, max(1, (h-len(rows)-4)/2)) {
		rows = append(rows, dim.Render(event.At.Format("Jan 2 15:04"))+" "+pill(event.State, stateColor(event.State))+" "+oneLine(event.Text))
	}
	rows = append(rows, lab(cPeach).Render(fmt.Sprintf("ASKS %d · a starts sitting", len(l.Asks))))
	for _, ask := range l.Asks {
		line := pill(ask.Effort, cGold) + " " + oneLine(askQuestion(ask))
		if !ask.Answerable {
			line += dim.Render(" · " + readOnlyReason(l))
		}
		rows = append(rows, line)
	}
	return frame("Lane", stateColor(l.State), "space spins / pauses", rows, w, h)
}
func (m model) askView(w, h int) []string {
	if w < 90 {
		return m.sitting.view(w, h, m.askLanes())
	}
	it, ok := m.sitting.current()
	if !ok {
		return m.sitting.view(w, h, m.askLanes())
	}
	left := strings.Join(m.sitting.view(w*2/3, h, m.askLanes()), "\n")
	ship := frame(shipFor(it.lane.ID), stateColor(it.lane.State), "space spins / pauses", shipLines(it.lane, m.tick, w-w*2/3-4, max(1, h-3)), w-w*2/3, h)
	return strings.Split(lipgloss.JoinHorizontal(lipgloss.Top, left, strings.Join(ship, "\n")), "\n")
}
func stateColor(s string) string {
	switch s {
	case "needs you":
		return cOrange
	case "waiting":
		return cGold
	case "working":
		return cSky
	case "done":
		return cBlue
	default:
		return cGray
	}
}
func askCount(lanes []StationLane, effort string) int {
	n := 0
	for _, l := range lanes {
		for _, a := range l.Asks {
			if a.Effort == effort {
				n++
			}
		}
	}
	return n
}
