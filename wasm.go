//go:build js && wasm

package main

// Browser build of the TUI. JS passes the Fleet JSON and key
// presses; the real model and View run here and return one ANSI frame.

import (
	"encoding/json"
	"syscall/js"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func main() {
	lipgloss.SetColorProfile(termenv.TrueColor)
	m := model{w: 120, h: 34}
	js.Global().Set("fmTUI", js.FuncOf(func(_ js.Value, a []js.Value) any {
		// fmTUI(fleetJSON, key, cols, rows, ticks) -> ANSI frame; ticks advances the hologram
		if s := a[0].String(); s != "" {
			var f Fleet
			if json.Unmarshal([]byte(s), &f) == nil {
				m.fleet = f
			}
		}
		m.w, m.h = a[2].Int(), a[3].Int()
		for i := 0; i < a[4].Int(); i++ {
			m.step()
		}
		if m.prog == nil {
			m.step()
		}
		if k := a[1].String(); k != "" {
			m, _ = m.key(k)
		}
		return m.View()
	}))
	select {}
}
