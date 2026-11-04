package main

// Per-lane hologram. Each lane gets one of the generated ASCII
// ships (picked by a hash of its id), rotating one frame per tick. The ship
// assembles toward a target set by the lane's status: unbuilt cells show the
// wire scaffold, built cells the solid hull. Blocked flickers red; failed
// breaks apart.

import (
	"fmt"
	"hash/fnv"
	"math"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

type shipFrame struct {
	wire []string
	fill []string
}

var shipNames = []string{"Starblazer", "Liberty Enforcer", "Barracuda", "Anubis"}

// holoTarget is how far each status has built its ship.
var holoTarget = map[string]float64{"queued": 0.12, "parked": 0.45, "in-progress": 0.6, "waiting": 0.72, "blocked": 0.5, "failed": 0.5, "done": 1}

func shipFor(id string) string {
	h := fnv.New32a()
	h.Write([]byte(id))
	return shipNames[int(h.Sum32())%len(shipNames)]
}

// cellRank is a fixed pseudo-random order in [0,1) for assembling and breaking cells.
func cellRank(r, c int) float64 {
	x := uint32(r)*73856093 ^ uint32(c)*19349663
	x ^= x >> 13
	x *= 0x5bd1e995
	x ^= x >> 15
	return float64(x%1000) / 1000
}

// holoLines draws the lane's ship in w x h cells at rotation tick and build progress prog.
func holoLines(l BoardLane, tick int, prog float64, w, h int) []string {
	frames := generatedShipFrames[shipFor(l.ID)]
	if len(frames) == 0 || w < 8 || h < 3 {
		return nil
	}
	f := frames[tick%len(frames)]
	sh, sw := len(f.fill), len(f.fill[0])
	// shrink by sampling when the pane is smaller than the 64x20 frame; never stretch
	s := math.Max(1, math.Max(float64(sw)/float64(w), float64(sh)/float64(h)))
	rows := min(h, int(float64(sh)/s))
	cols := min(w, int(float64(sw)/s))
	color := statusColor[l.Status]
	if l.Status == "blocked" && tick%4 < 2 {
		color = "#661f1f"
	}
	hull := lipgloss.NewStyle().Foreground(lipgloss.Color(color))
	wire := lipgloss.NewStyle().Foreground(lipgloss.Color("#3a3550"))
	var out []string
	for r := 0; r < rows; r++ {
		var b strings.Builder
		sr := min(sh-1, int(float64(r)*s))
		fill, wr := []rune(f.fill[sr]), []rune(f.wire[sr])
		for c := 0; c < cols; c++ {
			sc := min(len(fill)-1, int(float64(c)*s))
			ch, wc := fill[sc], wr[min(len(wr)-1, sc)]
			rank := cellRank(sr, sc)
			switch {
			case ch == ' ' && wc == ' ':
				b.WriteByte(' ')
			case l.Status == "failed" && rank < 0.4:
				b.WriteString(dim.Render("·"))
			case rank < prog && ch != ' ':
				b.WriteString(hull.Render(string(ch)))
			case wc != ' ':
				b.WriteString(wire.Render(string(wc)))
			default:
				b.WriteByte(' ')
			}
		}
		out = append(out, b.String())
	}
	// centre vertically and horizontally in the pane
	pad := strings.Repeat(" ", max(0, (w-cols)/2))
	for i := range out {
		out[i] = pad + out[i]
	}
	top := max(0, (h-rows)/2)
	return append(make([]string, top), out...)
}

func holoTitle(l BoardLane, prog float64) string {
	return fmt.Sprintf("HOLO // %s // %s · %d%%", strings.ToUpper(shipFor(l.ID)), strings.ToUpper(StatusLabel[l.Status]), int(prog*100+0.5))
}

// step moves each lane's build progress toward its status target; called once per tick.
func (m *model) step() {
	if m.prog == nil {
		m.prog = map[string]float64{}
	}
	for _, l := range m.fleet.Lanes {
		p, ok := m.prog[l.ID]
		t := holoTarget[l.Status]
		if !ok {
			m.prog[l.ID] = t
			continue
		}
		if d := t - p; math.Abs(d) < 0.02 {
			m.prog[l.ID] = t
		} else {
			m.prog[l.ID] = p + math.Copysign(0.02, d)
		}
	}
	m.tick++
}
