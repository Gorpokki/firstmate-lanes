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
- `web/`: the web and phone board (React 18.3.1). `web/app.js` is the built bundle that `--serve` embeds. After a change to `web/app.tsx`, run `bun install && bun run build` in `web/` with bun 1.3.14, the version CI pins; other versions emit different bytes.

## Quality checks

Run the Go and web quality commands before opening a pull request. The web commands need bun 1.3.14, the version the quality workflow pins:

```sh
test -z "$(gofmt -l .)"
go vet ./...
go build .
go test ./...
python3 -m venv "${TMPDIR:-/tmp}/lizard"
LIZARD_PY="${TMPDIR:-/tmp}/lizard/bin/python"
"$LIZARD_PY" -m pip install --disable-pip-version-check 'lizard==1.24.1'
"$LIZARD_PY" scripts/complexity-check.py --self-test
"$LIZARD_PY" scripts/complexity-check.py --base "$(git merge-base origin/main HEAD)"
python3 scripts/leak-check.py --self-test
python3 scripts/slop-check.py
python3 scripts/doc-slop-check.py
(cd web && bun install --frozen-lockfile && bun run format:check && bun run lint && bun run typecheck && bun test && bun run build)
```

The quality workflow runs on pull requests and pushes to `main`; the no-leak workflow runs on pull request events.

The function-complexity gate compares all tracked and unignored `.go`, `.js`, `.jsx`, `.py`, `.ts`, and `.tsx` source in the base and current tree, including new files.
It excludes `vendor/`, `node_modules/`, `web/app.js`, files ending in `_generated.go`, `.gen.go`, or `.generated.go`, and files marked `Code generated ... DO NOT EDIT.`
Only new or worsened functions above CCN 15 fail; unchanged functions above the limit do not fail.

The required no-leak scan checks every outgoing commit in the PR (its file paths, file contents, full commit message, and author and committer names and emails), the PR head tree, and the PR title and body.
A commit identity may only be the GitHub noreply address `<id>+<login>@users.noreply.github.com` or the repository owner's login (`--owner-login`, which CI takes from the repository owner); every other identity value goes through the denylist and generic shape checks.
Identity allowances never apply to file content, paths, messages, or issue and PR text.
Local prepublication scans can also check an issue's title and body by passing `--event-file` a JSON file shaped `{"issue": {"title": ..., "body": ...}}`.
A file with no `issue` or `pull_request` object fails the scan.
CI does not scan issues.
The secret-bearing job runs only the trusted default-branch scanner and reads PR Git objects as data; it never executes PR code.
Set repository secret `LEAK_DENYLIST` from the private local denylist using repository Actions settings or a CLI that reads from stdin; never pass the value as an argument or print it.
Never commit or encode the value in artifacts or other public text.
The scan fails when the secret is missing or blank.

## Ship models

The hologram frames are ASCII renders, made from these 3D models by HotSliceOfJesus on Thingiverse. Each model is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The renders are changed from the originals: each is turned into 32 rotation frames of 64x20 text cells.

- Starblazer: [Freelancer Civilian Fighter "Starblazer"](https://www.thingiverse.com/thing:2047196)
- Liberty Enforcer: [Freelancer Liberty "Enforcer" Ship](https://www.thingiverse.com/thing:2041139)
- Barracuda: [Freelancer Bounty Hunter Ship "Barracuda" Fighter](https://www.thingiverse.com/thing:2044452)
- Anubis: [Freelancer The Order Ship Anubis](https://www.thingiverse.com/thing:2038647)
