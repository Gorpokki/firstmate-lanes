# firstmate-lanes

Terminal and web lane dashboard for Firstmate fleets.

`fmlanes` shows every lane of one Firstmate home: a task or a second mate, its state, its latest status line, its open decisions and its status log. It has three front ends that read the same data:

- **Terminal (TUI):** an LCARS board in Bubble Tea, with eight views.
- **Web:** the same board in a browser, served by `fmlanes --serve`.
- **Phone:** the same web board. It fits a phone screen and can be added to the home screen as an app.

Each lane also gets a **hologram**: an ASCII ship that rotates and assembles as the lane moves forward. Blocked lanes flicker red. Failed lanes break up.

## Run

Needs Go 1.24 or later.

```sh
go run . --home testdata/sample-home                          # terminal board on the sample home
FM_HOME=/path/to/firstmate go run .                           # terminal board on a real home
go run . --home testdata/sample-home --serve 127.0.0.1:7777   # web and phone board at http://127.0.0.1:7777
go run . --home testdata/sample-home --once --view holo --size 120x34   # print one frame and exit
go run . --home testdata/sample-home --json                   # print the board data as JSON and exit
```

To open the board on a phone, serve it on an address the phone can reach, for example `--serve 0.0.0.0:7777`. The board has no login, so anyone who can reach that address can read the home's lane names and status lines. Use a private network.

`--serve` answers only the Host names `localhost`, IP addresses, and names given with `--allow-host <name>` (repeatable). Any other Host gets 403, which stops other websites from reading the board through DNS rebinding.

| Key | Action |
|---|---|
| `1`-`8`, `tab`, `←` `→` | Change view: All, Alert, Health, Captain, Lanes, Crew, Log, Holo |
| `↑` `↓` (`k` `j`) | Select a lane |
| `enter`, `esc` | Below 100 columns: open the selected lane (hologram and log) in the Lanes view, then go back |
| `f` | Filter the lane board by status |
| `q` | Quit |

## Read-only

`fmlanes` only stats and reads files. It never writes to the home, never sends steers, and never runs Firstmate scripts. The terminal board reads the home again every second (`--every`). The web board asks the server for `fleet.json` every 2 seconds, and the server reads the home again for each request. A status log is parsed again only when its size or modification time changes.

It reads:

- `state/<id>.status`: one event per line, `verb [key=<slug>] [at=<epoch>]: text`. A line that does not start an event continues the one above it.
- `state/<id>.meta`: `kind` (ship, scout, secondmate).
- `data/backlog.md`: title, kind and hold of each entry. A `(hold-kind: captain)` hold counts as an open decision.
- `data/secondmates.md`: registered second mates.

Open decisions follow Firstmate's own fold. `needs-decision` and `blocked` open a key (`default` when the line has none). `resolved` and `captain-held` close it. A `done` or `failed` line closes all of a task's decisions, but never a second mate's.

## Layout

- `state.go`: the home reader.
- `fleet.go`: `BuildFleet`, which turns lanes into the board's panels. Every front end renders this one value.
- `main.go`, `holo.go`: the terminal board's views and the hologram.
- `cli.go`: the terminal program, the flags, and `--serve`.
- `web/`: the web and phone board (React 18.3.1). `web/app.js` is the built bundle that `--serve` embeds. After a change to `web/app.tsx`, run `bun install && bun run build` in `web/`.

## Test

```sh
go test ./...
```

## Ship models

The hologram frames are ASCII renders, made from these 3D models by HotSliceOfJesus on Thingiverse. Each model is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The renders are changed from the originals: each is turned into 32 rotation frames of 64x20 text cells.

- Starblazer: [Freelancer Civilian Fighter "Starblazer"](https://www.thingiverse.com/thing:2047196)
- Liberty Enforcer: [Freelancer Liberty "Enforcer" Ship](https://www.thingiverse.com/thing:2041139)
- Barracuda: [Freelancer Bounty Hunter Ship "Barracuda" Fighter](https://www.thingiverse.com/thing:2044452)
- Anubis: [Freelancer The Order Ship Anubis](https://www.thingiverse.com/thing:2038647)
