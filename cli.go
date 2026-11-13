package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
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
func readFleet(reader *Reader, home string, look *lastLook) (Fleet, error) {
	lanes, err := reader.LoadFleet(home)
	if err != nil {
		return Fleet{}, err
	}
	fleet := BuildFleet(lanes, time.Now())
	if look != nil {
		err = look.apply(&fleet)
	}
	return fleet, err
}
func (m model) read() tea.Cmd {
	return func() tea.Msg { f, err := readFleet(m.r, m.home, m.look); return fleetMsg{f, err} }
}
func (m model) poll() tea.Cmd {
	return tea.Batch(m.read(), tea.Tick(m.every, func(time.Time) tea.Msg { return tickMsg{} }))
}
func (m model) Init() tea.Cmd { return tea.Batch(m.poll(), anim()) }
func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := message.(type) {
	case tea.WindowSizeMsg:
		m.w, m.h = msg.Width, msg.Height
	case animMsg:
		m.step()
		return m, anim()
	case tickMsg:
		return m, m.poll()
	case fleetMsg:
		m.cliApplyFleet(msg)
	case answerResultMsg:
		m.applyAnswerResult(msg)
		return m, m.read()
	case tea.KeyMsg:
		return m.cliUpdateKey(msg)
	}
	return m, nil
}

func (m *model) cliApplyFleet(msg fleetMsg) {
	m.err = msg.err
	if msg.err == nil {
		m.fleet = msg.f
		if m.view == 0 && len(m.sitting.items) == 0 {
			m.openSitting()
		}
	}
}

func (m model) cliUpdateKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.view == 0 && m.sitting.ownMode && msg.Type == tea.KeyRunes && !msg.Alt {
		for _, r := range msg.Runes {
			m, _ = m.key(string(r))
		}
		return m, nil
	}
	next, quit := m.key(msg.String())
	if quit {
		return next, tea.Quit
	}
	if next.pendingSend && !m.pendingSend {
		service := next.answerService
		answers := append([]SittingAnswer(nil), next.answers...)
		return next, func() tea.Msg {
			if service == nil {
				return answerResultMsg{err: fmt.Errorf("answer command is unavailable")}
			}
			results, err := service.Send(context.Background(), true, answers)
			return answerResultMsg{results: results, err: err}
		}
	}
	return next, nil
}

func cliFail(err error) {
	fmt.Fprintln(os.Stderr, "fmlanes:", err)
	os.Exit(1)
}

func cliConvertShips(home, convert, output string) error {
	destination := output
	if destination == "" {
		destination = filepath.Join(convert, "converted")
	}
	if home != "" {
		if err := (runtimeConfig{StateDir: destination}).protectHomes(home); err != nil {
			return err
		}
	}
	return convertShips(convert, destination)
}

func cliCheckArgs(home string, every time.Duration) error {
	if home == "" {
		fmt.Fprintln(os.Stderr, "usage: fmlanes --home PATH (or set FM_HOME)")
		os.Exit(2)
	}
	if every <= 0 {
		return fmt.Errorf("--every must be positive")
	}
	return nil
}

func cliPrepareDirs(config runtimeConfig, home string) error {
	if err := config.protectHomes(home); err != nil {
		return err
	}
	for _, directory := range []string{filepath.Join(config.DropIn, "models"), filepath.Join(config.DropIn, "lanes")} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			return err
		}
	}
	return nil
}

func cliSelectView(m *model, name string) error {
	for i, station := range views {
		if station.key == name {
			m.view = i
			return nil
		}
	}
	return fmt.Errorf("unknown station %q", name)
}

func cliServe(address, home string, config runtimeConfig, reader *Reader, look *lastLook, service *AnswerService, allow []string) error {
	handler, err := boardHandler(home, config, reader, look, service, allow)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "fmlanes: serving the board at http://%s\n", address)
	return http.ListenAndServe(address, handler)
}

func cliPrintOnce(m *model, home string, reader *Reader, look *lastLook, asJSON bool, size string) error {
	var err error
	if m.fleet, err = readFleet(reader, home, look); err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(m.fleet)
	}
	if _, err = fmt.Sscanf(size, "%dx%d", &m.w, &m.h); err != nil || m.w < 1 || m.h < 1 {
		return fmt.Errorf("invalid --size")
	}
	m.step()
	if m.view == 0 {
		m.openSitting()
	}
	fmt.Println(m.View())
	return nil
}

func main() {
	home := flag.String("home", os.Getenv("FM_HOME"), "main home to read (default $FM_HOME)")
	view := flag.String("view", "list", "start station: ask, list, fleet, lane")
	every := flag.Duration("every", time.Second, "home refresh interval")
	once := flag.Bool("once", false, "print one terminal frame and exit")
	size := flag.String("size", "120x34", "terminal frame size COLSxROWS")
	asJSON := flag.Bool("json", false, "print the shared fleet JSON and exit")
	address := flag.String("serve", "", "serve the web and phone board at this address")
	dropIn := flag.String("drop-in", "", "dedicated root containing models/ and lanes/")
	ships := flag.String("ships", "", "additional certified converted model directory")
	convert := flag.String("convert-ships", "", "convert GLB models from this source root")
	output := flag.String("output", "", "conversion output directory (default <source>/converted)")
	var allow []string
	flag.Func("allow-host", "additional accepted Host name (repeatable)", func(value string) error { allow = append(allow, value); return nil })
	flag.Parse()
	if *convert != "" {
		if err := cliConvertShips(*home, *convert, *output); err != nil {
			cliFail(err)
		}
		return
	}
	if err := cliCheckArgs(*home, *every); err != nil {
		cliFail(err)
	}
	config, err := loadRuntimeConfig(*dropIn, *ships)
	if err == nil {
		err = cliPrepareDirs(config, *home)
	}
	if err != nil {
		cliFail(err)
	}
	reader := NewReader()
	reader.DropIn = config.DropIn
	reader.receiptPath = filepath.Join(config.StateDir, "accepted-asks.json")
	look := newLastLook(filepath.Join(config.StateDir, "last-look.json"))
	service := &AnswerService{Reader: reader, Home: *home, Command: os.Getenv("FM_LANES_ANSWER_COMMAND")}
	m := model{r: reader, home: *home, every: *every, view: 1, answerService: service, look: look}
	if err = cliSelectView(&m, *view); err != nil {
		cliFail(err)
	}
	if *address != "" {
		if err = cliServe(*address, *home, config, reader, look, service, allow); err != nil {
			cliFail(err)
		}
		return
	}
	if *once || *asJSON {
		if err = cliPrintOnce(&m, *home, reader, look, *asJSON, *size); err != nil {
			cliFail(err)
		}
		return
	}
	if _, err = tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
		cliFail(err)
	}
}

//go:embed web/index.html web/app.js web/manifest.webmanifest web/fonts
var webFiles embed.FS

func boardHandler(home string, config runtimeConfig, reader *Reader, look *lastLook, answers *AnswerService, allow []string) (http.Handler, error) {
	site, err := fs.Sub(webFiles, "web")
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("POST /answers", answerHandler(answers))
	mux.HandleFunc("GET /fleet.json", func(w http.ResponseWriter, r *http.Request) {
		fleet, err := readFleet(reader, home, look)
		if err != nil {
			http.Error(w, fmt.Sprintf("cannot read fleet: %v", err), http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(fleet)
	})
	mux.HandleFunc("POST /last-look", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Fleet-Action") != "save" {
			http.Error(w, "explicit save required", http.StatusBadRequest)
			return
		}
		fleet, err := readFleet(reader, home, nil)
		if err != nil {
			http.Error(w, fmt.Sprintf("cannot read fleet: %v", err), http.StatusServiceUnavailable)
			return
		}
		if err = look.save(fleet); err != nil {
			http.Error(w, "cannot save last look", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mountModelRoutes(mux, config)
	mux.HandleFunc("GET /simulation", func(w http.ResponseWriter, r *http.Request) {
		data, err := webFiles.ReadFile("web/index.html")
		if err != nil {
			http.Error(w, "page unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
	mux.Handle("GET /", http.FileServerFS(site))
	return hostGuard(mux, allow), nil
}

func hostGuard(next http.Handler, names []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host, names) {
			http.Error(w, "host not allowed", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func hostAllowed(hostport string, names []string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		host = hostport
	}
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if net.ParseIP(host) != nil || strings.EqualFold(host, "localhost") {
		return true
	}
	return slices.ContainsFunc(names, func(name string) bool { return strings.EqualFold(host, name) })
}
