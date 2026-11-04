// LCARS lane board TUI for one Firstmate home, built on the lane
// board web canvas: the same panels (health, red alert, waiting on captain,
// lane board, crew, timeline), view pills, and LCARS elbows, drawn in a terminal.
// Data comes from the read-only home reader through BuildFleet (fleet.go).
package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// The lane board canvas palette.
const (
	cOrange, cPeach, cLav, cBlue, cSky = "#FF9900", "#FFCC99", "#CC99CC", "#9999FF", "#99CCFF"
	cGold, cTan, cRed, cGray, cText    = "#FFCC66", "#DDAA77", "#FF5555", "#777799", "#FFE6CC"
	cDim, cInk                         = "#B8A898", "#000000"
)

var statusColor = map[string]string{"blocked": cRed, "failed": cRed, "waiting": cOrange, "in-progress": cSky, "parked": cGray, "queued": cLav, "done": cBlue}
var toneColor = map[string]string{"ok": cSky, "warn": cGold, "alert": cRed, "info": cBlue, "idle": cGray}
var verbColor = map[string]string{"needs-decision": cOrange, "blocked": cRed, "failed": cRed, "working": cSky, "paused": cGray, "done": cBlue, "resolved": cLav}

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

var views = []view{{"all", "All", cPeach}, {"alert", "Alert", cRed}, {"health", "Health", cOrange}, {"captain", "Captain", cPeach},
	{"lanes", "Lanes", cSky}, {"crew", "Crew", cTan}, {"log", "Log", cLav}, {"holo", "Holo", cBlue}}

type model struct {
	r         *Reader
	home      string
	fleet     Fleet
	err       error
	view, sel int
	filter    int // 0 = all, else index+1 into StatusOrder
	w, h      int
	every     time.Duration
	tick      int
	prog      map[string]float64 // hologram build progress per lane
}

// key applies one key press; both the terminal and the browser build call it.
func (m model) key(k string) (model, bool) {
	switch k {
	case "q", "ctrl+c":
		return m, true
	case "tab", "right":
		m.view = (m.view + 1) % len(views)
	case "shift+tab", "left":
		m.view = (m.view + len(views) - 1) % len(views)
	case "up", "k":
		m.sel = max(0, m.sel-1)
	case "down", "j":
		m.sel = max(0, min(len(m.lanes())-1, m.sel+1))
	case "f":
		m.filter, m.sel = (m.filter+1)%(len(StatusOrder)+1), 0
	default:
		if len(k) == 1 && k[0] >= '1' && int(k[0]-'1') < len(views) {
			m.view = int(k[0] - '1')
		}
	}
	return m, false
}

func (m model) lanes() []BoardLane {
	if m.filter == 0 {
		return m.fleet.Lanes
	}
	var out []BoardLane
	for _, l := range m.fleet.Lanes {
		if l.Status == StatusOrder[m.filter-1] {
			out = append(out, l)
		}
	}
	return out
}

// fit truncates or pads s to exactly w cells.
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

// frame is the LCARS elbow: a half-block top bar with the title, and a solid left bar.
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

func joinH(a, b []string) []string {
	out := make([]string, len(a))
	for i := range a {
		out[i] = a[i] + " " + b[i]
	}
	return out
}

func stack(parts ...[]string) []string {
	var out []string
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func stardate(t time.Time) string {
	frac := (t.Hour()*60 + t.Minute()) * 10 / 1440
	return fmt.Sprintf("STARDATE %d.%03d.%d", t.Year(), t.YearDay(), frac)
}

func (m model) header() []string {
	t := m.fleet.UpdatedAt
	right := lab(cSky).Render(stardate(t)) + "  " + lab(cPeach).Render(strings.ToUpper(t.Format("Mon Jan 2, 3:04 PM")))
	left := fg(cOrange).Render("██████") + " " + lab(cOrange).Render("FIRSTMATE FLEET OPS") + "  " + dim.Render("HOME "+strings.ToUpper(m.fleet.Home)+" · READ-ONLY")
	if m.err != nil {
		left += "  " + lab(cRed).Render("STALE: "+m.err.Error())
	}
	gap := m.w - ansi.StringWidth(left) - ansi.StringWidth(right)
	top := left + strings.Repeat(" ", max(1, gap)) + right
	if gap < 1 {
		top = left
	}
	var tabs []string
	for i, v := range views {
		p := pill(fmt.Sprintf("%d %s", i+1, v.label), v.color)
		if i == m.view {
			p = lipgloss.NewStyle().Background(lipgloss.Color(cText)).Foreground(lipgloss.Color(cInk)).Bold(true).Underline(true).Render(" " + strings.ToUpper(fmt.Sprintf("%d %s", i+1, v.label)) + " ")
		}
		tabs = append(tabs, p)
	}
	return []string{fit(top, m.w), fit(fg(cOrange).Render("██████")+" "+strings.Join(tabs, " "), m.w)}
}

func (m model) footer() string {
	keys := " 1-8/tab view · ↑↓ select lane · f filter · q quit "
	return fit(fg(cOrange).Render(strings.Repeat("▀", 6))+dim.Render(keys)+fg(cOrange).Render(strings.Repeat("▀", max(0, m.w-6-ansi.StringWidth(keys)))), m.w)
}

func (m model) View() string {
	if m.w < 40 || m.h < 10 {
		return "fmlanes needs at least 40x10. q quits."
	}
	bh := m.h - 3
	var body []string
	switch views[m.view].key {
	case "all":
		body = m.all(m.w, bh)
	case "alert":
		body = m.alert(m.w, bh)
	case "health":
		body = m.health(m.w, bh)
	case "captain":
		body = m.captain(m.w, bh)
	case "lanes":
		if m.w >= 100 {
			lw, hh := m.w*50/100, min(24, bh*6/10)
			body = joinH(m.board(lw, bh), stack(m.holo(m.w-lw-1, hh), m.detail(m.w-lw-1, bh-hh)))
		} else {
			body = m.board(m.w, bh)
		}
	case "holo":
		lw := min(44, m.w*38/100)
		body = joinH(m.board(lw, bh), m.holo(m.w-lw-1, bh))
	case "crew":
		body = m.crew(m.w, bh)
	case "log":
		body = m.timeline(m.w, bh)
	}
	return strings.Join(append(append(m.header(), body...), m.footer()), "\n")
}

// all is the canvas's "All" view: left column health, alert, captain; right column lane board and timeline.
func (m model) all(w, h int) []string {
	if w < 100 {
		hh := min(7, h/3)
		ah := min(max(3, 1+2*len(m.fleet.Blockers)+1), (h-hh)/3)
		return stack(m.health(w, hh), m.alert(w, ah), m.board(w, h-hh-ah))
	}
	lw := w * 42 / 100
	hh, ah := min(9, h/3), min(max(3, 3*len(m.fleet.Blockers)+2), h/4)
	left := stack(m.health(lw, hh), m.alert(lw, ah), m.captain(lw, h-hh-ah))
	th := h * 35 / 100
	right := stack(m.board(w-lw-1, h-th), m.timeline(w-lw-1, th))
	return joinH(left, right)
}

func (m model) health(w, h int) []string {
	f := m.fleet
	var rows []string
	line := ""
	for _, k := range f.KPIs {
		p := pill(k.Value, toneColor[k.Tone]) + " " + lab(cPeach).Render(strings.ToUpper(k.Label)) + " " + dim.Render(k.Detail) + "   "
		if line != "" && ansi.StringWidth(line+p) > w-4 {
			rows, line = append(rows, line), ""
		}
		line += p
	}
	rows = append(rows, line, "")
	// status bar: one coloured segment per status, width by lane count
	bw, total := w-4, len(f.Lanes)
	bar, legend := "", ""
	if total > 0 {
		used := 0
		for i, s := range StatusOrder {
			n := 0
			for _, l := range f.Lanes {
				if l.Status == s {
					n++
				}
			}
			if n == 0 {
				continue
			}
			seg := n * bw / total
			if i == len(StatusOrder)-1 || used+seg > bw {
				seg = bw - used
			}
			seg = max(1, seg)
			used += seg
			bar += fg(statusColor[s]).Render(strings.Repeat("█", seg))
			legend += fg(statusColor[s]).Render("●") + " " + text.Render(fmt.Sprintf("%s %d", strings.ToUpper(StatusLabel[s]), n)) + "  "
		}
	}
	rows = append(rows, bar, legend)
	return frame("Fleet health", cOrange, fmt.Sprintf("%d lanes tracked", total), rows, w, h)
}

func (m model) alert(w, h int) []string {
	b := m.fleet.Blockers
	title, color := "Blockers", cBlue
	if len(b) > 0 {
		title, color = "Red alert · blockers", cRed
	}
	var rows []string
	for _, x := range b {
		rows = append(rows, lab(cRed).Render(strings.ToUpper(x.Title))+dim.Render(" · "+x.Age))
		for i, s := range wrap(x.Detail, w-6) {
			if i < 2 {
				rows = append(rows, "  "+text.Render(s))
			}
		}
	}
	if len(rows) == 0 {
		rows = []string{dim.Render("NO BLOCKERS ON RECORD")}
	}
	return frame(title, color, fmt.Sprintf("%d active", len(b)), rows, w, h)
}

func (m model) captain(w, h int) []string {
	var rows []string
	for _, x := range m.fleet.Waiting {
		rows = append(rows, fg(cPeach).Render("▌ ")+lab(cPeach).Render(x.Lane)+dim.Render(" · "+x.Key+" · "+x.Age))
		for i, s := range wrap(x.Ask, w-8) {
			if i < 3 {
				rows = append(rows, fg(cPeach).Render("▌ ")+"  "+text.Render(s))
			}
		}
		rows = append(rows, "")
	}
	if len(rows) == 0 {
		rows = []string{dim.Render("NO ITEMS WAITING ON YOU")}
	}
	return frame("Waiting on captain", cPeach, fmt.Sprintf("%d items", len(m.fleet.Waiting)), rows, w, h)
}

// board is the lane board: filter pills, then one card row pair per lane.
func (m model) board(w, h int) []string {
	lanes := m.lanes()
	cur := "All"
	if m.filter > 0 {
		cur = StatusLabel[StatusOrder[m.filter-1]]
	}
	rows := []string{dim.Render("FILTER ") + pill(cur, cPeach) + dim.Render("  f cycles"), ""}
	start := 0
	if per := (h - 3) / 2; m.sel >= per {
		start = m.sel - per + 1
	}
	for i := start; i < len(lanes); i++ {
		l := lanes[i]
		c := statusColor[l.Status]
		badge := pill(StatusLabel[l.Status], c)
		name := l.ID
		if l.Mate {
			name += " ▸"
		}
		meta := dim.Render(fmt.Sprintf(" %s", l.Age))
		if l.Decisions > 0 {
			meta += fg(cOrange).Render(fmt.Sprintf(" ◆%d", l.Decisions))
		}
		mark := fg(c).Render("▌")
		left := mark + " " + lab(cPeach).Render(strings.ToUpper(name)) + meta
		if i == m.sel {
			left = fg(c).Render("▶") + " " + lipgloss.NewStyle().Reverse(true).Bold(true).Render(strings.ToUpper(name)) + meta
		}
		gap := w - 4 - ansi.StringWidth(left) - ansi.StringWidth(badge)
		rows = append(rows, left+strings.Repeat(" ", max(1, gap))+badge, fg(c).Render("▌")+" "+dim.Render(ansi.Truncate(oneLine(l.Note), w-7, "…")))
	}
	if len(lanes) == 0 {
		rows = append(rows, dim.Render("NO LANES ON RECORD"))
	}
	return frame("Lane board", cSky, fmt.Sprintf("%d shown", len(lanes)), rows, w, h)
}

func (m model) detail(w, h int) []string {
	lanes := m.lanes()
	if m.sel >= len(lanes) {
		return frame("Lane", cGray, "", nil, w, h)
	}
	l := lanes[m.sel]
	rows := []string{lab(cPeach).Render(strings.ToUpper(l.Title)), dim.Render(strings.ToUpper(l.Kind) + " · UPDATED " + l.Age + " AGO"), ""}
	var log []string
	for _, e := range l.Log {
		for j, s := range wrap(e.Verb+": "+e.Text, w-12) {
			if j == 0 {
				log = append(log, pill(e.At, cLav)+" "+fg(verbColor[e.Verb]).Render(s))
			} else {
				log = append(log, "        "+text.Render(s))
			}
		}
	}
	rows = append(rows, tail(log, h-5)...)
	return frame(l.ID, statusColor[l.Status], StatusLabel[l.Status], rows, w, h)
}

func (m model) crew(w, h int) []string {
	var rows []string
	for _, c := range m.fleet.Crew {
		rows = append(rows, fg(cTan).Render("▌ ")+lab(cPeach).Render(strings.ToUpper(c.ID)+" · SECOND MATE")+"  "+pill(StatusLabel[c.Status], cTan))
		for _, s := range wrap(c.Title, w-8) {
			rows = append(rows, fg(cTan).Render("▌ ")+"  "+text.Render(s))
		}
		rows = append(rows, "")
	}
	if len(rows) == 0 {
		rows = []string{dim.Render("NO CREW ON RECORD")}
	}
	return frame("Crew", cTan, fmt.Sprintf("%d stations", len(m.fleet.Crew)), rows, w, h)
}

func (m model) timeline(w, h int) []string {
	var rows []string
	for i, e := range m.fleet.Timeline {
		c := cLav
		if i == len(m.fleet.Timeline)-1 {
			c = cPeach
		}
		rows = append(rows, pill(e.At, c)+" "+lab(cPeach).Render(e.Lane)+" "+fg(verbColor[e.Verb]).Render(e.Verb)+dim.Render(": "+oneLine(e.Text)))
	}
	if len(rows) == 0 {
		rows = []string{dim.Render("NO EVENTS ON RECORD")}
	}
	return frame("Timeline", cLav, "local time", tail(rows, h-1), w, h)
}

// holo is the selected lane's hologram pane.
func (m model) holo(w, h int) []string {
	lanes := m.lanes()
	if m.sel >= len(lanes) {
		return frame("Holo", cGray, "", nil, w, h)
	}
	l := lanes[m.sel]
	p := m.prog[l.ID]
	return frame(holoTitle(l, p), statusColor[l.Status], l.ID, holoLines(l, m.tick, p, w-4, h-1), w, h)
}
