//go:build !(js && wasm)

package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

type fleetMsg struct {
	f   Fleet
	err error
}
type tickMsg struct{}
type animMsg struct{}

func anim() tea.Cmd {
	return tea.Tick(150*time.Millisecond, func(time.Time) tea.Msg { return animMsg{} })
}

func (m model) read() tea.Cmd {
	return func() tea.Msg {
		lanes, err := m.r.Load(m.home)
		return fleetMsg{BuildFleet("main", lanes, time.Now()), err}
	}
}

func (m model) poll() tea.Cmd {
	return tea.Batch(m.read(), tea.Tick(m.every, func(time.Time) tea.Msg { return tickMsg{} }))
}

func (m model) Init() tea.Cmd { return tea.Batch(m.poll(), anim()) }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
	case animMsg:
		m.step()
		return m, anim()
	case tickMsg:
		return m, m.poll()
	case fleetMsg:
		if m.err = msg.err; msg.err == nil {
			m.fleet = msg.f
		}
	case tea.KeyMsg:
		next, quit := m.key(msg.String())
		if quit {
			return next, tea.Quit
		}
		return next, nil
	}
	return m, nil
}

func main() {
	home := flag.String("home", os.Getenv("FM_HOME"), "Firstmate home to read (default $FM_HOME)")
	viewF := flag.String("view", "all", "start view: all, alert, health, captain, lanes, crew, log, holo")
	every := flag.Duration("every", time.Second, "how often to re-read the home")
	once := flag.Bool("once", false, "print one frame to stdout and exit")
	size := flag.String("size", "120x34", "frame size for --once, as COLSxROWS")
	asJSON := flag.Bool("json", false, "print the fleet board data as JSON and exit")
	ships := flag.Bool("ships", false, "print the hologram ship frames as JSON and exit")
	addr := flag.String("serve", "", "serve the web and phone board at this address (for example 127.0.0.1:7777) and exit only on error")
	flag.Parse()
	if *home == "" {
		fmt.Fprintln(os.Stderr, "usage: fmlanes --home PATH (or set FM_HOME)")
		os.Exit(2)
	}
	m := model{r: NewReader(), home: *home, every: *every}
	for i, v := range views {
		if v.key == *viewF {
			m.view = i
		}
	}
	if *addr != "" {
		fmt.Fprintf(os.Stderr, "fmlanes: serving the board at http://%s\n", *addr)
		if err := serve(*addr, *home); err != nil {
			fmt.Fprintln(os.Stderr, "fmlanes:", err)
			os.Exit(1)
		}
		return
	}
	if *once || *asJSON || *ships {
		lanes, err := m.r.Load(*home)
		m.fleet, m.err = BuildFleet("main", lanes, time.Now()), err
		m.step()
		if *ships {
			json.NewEncoder(os.Stdout).Encode(shipsJSON())
			return
		}
		if *asJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", " ")
			enc.Encode(m.fleet)
			return
		}
		if os.Getenv("FMLANES_TRUECOLOR") != "" { // keep truecolor when stdout is not a tty
			lipgloss.SetColorProfile(termenv.TrueColor)
		}
		fmt.Sscanf(*size, "%dx%d", &m.w, &m.h)
		fmt.Println(m.View())
		return
	}
	if _, err := tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, "fmlanes:", err)
		os.Exit(1)
	}
}

func shipsJSON() map[string][]map[string][]string {
	out := map[string][]map[string][]string{}
	for n, fs := range generatedShipFrames {
		for _, f := range fs {
			out[n] = append(out[n], map[string][]string{"wire": f.wire, "fill": f.fill})
		}
	}
	return out
}

//go:embed web/index.html web/app.js web/manifest.webmanifest
var webFiles embed.FS

// serve publishes the board for browsers and phones: the static page, the
// ship frames, and fleet.json, which re-reads the home on every request.
func serve(addr, home string) error {
	site, _ := fs.Sub(webFiles, "web")
	ships, _ := json.Marshal(shipsJSON())
	r := NewReader()
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServerFS(site))
	mux.HandleFunc("GET /ships.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(ships)
	})
	mux.HandleFunc("GET /fleet.json", func(w http.ResponseWriter, _ *http.Request) {
		lanes, err := r.Load(home)
		if err != nil {
			http.Error(w, "cannot read the home", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(BuildFleet("main", lanes, time.Now()))
	})
	return http.ListenAndServe(addr, mux)
}
