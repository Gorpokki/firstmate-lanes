# firstmate-lanes

A private-network fleet board with four stations: **Ask, List, Fleet and Lane**.
The web board, phone board, terminal and `--json` use the same fleet contract.
On the web every station sits inside the board: a top bar, a station rail and a fleet strip with one mark per lane; a lane that changes state lights its mark once. On a phone the stations sit in a bar at the foot.
List, Fleet and Lane show the board summary. Ask hides the summary, and hides the rail and the strip until `z` shows them.

## Build and run

Requires Go 1.24 or later. Bun is needed to rebuild the web bundle or convert models.
The checked-in `web/app.js` is embedded in the executable; the board does not load remote fonts or scripts.
Its two faces, Antonio and Barlow Semi Condensed (SIL Open Font License), are in `web/fonts/` and are embedded as well.

```sh
go build -o fmlanes .
./fmlanes --home testdata/sample-home
./fmlanes --home "$FM_HOME" --serve 127.0.0.1:7777
./fmlanes --home testdata/sample-home --json
./fmlanes --home testdata/sample-home --once --view lane --size 120x34
```

`--view` accepts `ask`, `list`, `fleet` or `lane`; List is the default.
The terminal refreshes every second (`--every`); the web refreshes every three seconds.
For phone access, listen on a private-network interface and open that address on the phone.
The board has **no login**: anyone who can reach it can read fleet data and submit confirmed answers.
Do not expose it to an untrusted network.

The HTTP Host guard accepts IP addresses, `localhost`, and names explicitly supplied with repeatable `--allow-host` flags.
Other Host values receive 403, including on answer and asset routes.

## Stations

- **List:** every lane that needs you, a lane with an open ask or a block, and no other lane. Lanes are grouped **Quick** and **To read** by their oldest ask, and each group heading counts its lanes. Under column headers, each row has a tick, the oldest ask's age as a bar and in words, the lane name, its count of open asks and its oldest question. The age bar has one segment per day; from 5.5 days the ask is overdue and its sixth and seventh segments are bright orange and tall. The second-mate pills count each second mate's lanes that need you. Space or the tick box ticks a lane; **decide N ticked lanes in the Ask station** starts a sitting of the ticked lanes. The second-mate filter scopes List only: Ask without ticks covers every lane, and a sitting covers every ticked lane, including ticked lanes the filter hides. The List and Ask both show how many ticked lanes the filter hides.
- **Fleet:** a heat grid of every lane, grouped by state, or a shipyard (`b`). The holding lanes sit in one collapsed row (`h`) that counts the parked and gone-quiet lanes. The shipyard has a yardbar that shows or hides each state's ships, an Angle or Top view (`t`), zoom −, + and fit all, and the ship view modes (`v`). Mouse drag pans; Shift-drag turns; the wheel zooms; double-click resets. Touch drag pans, two fingers turn/pinch, and double-tap resets. Lane names in the Shipyard wrap between words; only a word longer than a row is hyphenated. The selected lane's ship turns in the side panel. Motion (`m`) turns the flashes and the drones on or off.
- **Lane:** the lane's ship, large, with its name and build percentage, and the status log under it as a strip and timed lines. A lane without a lane record is named by its ID in every station, and its backlog sentence shows under the name here. Beside the ship the lane's asks are answered in place: choices (`1`-`9`), own answer (`o`), crew-decides skip (`s`), defer (`w`), grill (`g`) and undo (`u`); `↑` `↓` step through the asks and `i` opens the lane's list of asks with its own find. The lane's answers go in batches of at most four asks through the answer command (`y`), and a batch sends only once every ask in it has an answer, a skip or a grill, or is deferred; the lane's other asks wait for the next batch. `esc` goes back to the station that opened the lane. A blocked lane's ship stops at half build in steady grey; a failed lane's ship also builds to half, then its hull breaks apart.
- **Holo view:** one ASCII renderer draws the ship on Lane, Ask and the lane simulation, with the same controls: ASCII lit, ASCII flat or bars (`v`); the unbuilt hull as dot fill, dim hull or wireframe; zoom −, + and fit; tilt; spin (`space`). Drag turns and tilts, the wheel zooms, double-click resets, and on Lane `←` `→` turn the ship. The view mode and fill are shared by every holo and kept in the browser. The ship turns by itself unless the browser asks for reduced motion. The Fleet shipyard draws its ships with the same renderer, under one navigable camera.
- **Ask:** up to four asks, quick first and grouped by the lane's second mate. The card holds the question, reason and choices; the lane's ship, state and last word sit beside it, and its ticket, pull request and grill links open on hover, focus or tap. A crew pick is labelled with its reason; a board suggestion is explicitly labelled when there is no crew pick. Discussion asks show their must-decide items. Every ask offers a grill request among its ways out. Choice, own answer, crew-decides skip, defer, grill, undo and review do not send anything. The send card identifies each answer by lane name and question. **send N answers to Firstmate** is the one sending action, and it stays disabled until every ask in the sitting has a choice, own answer, skip or grill request, so the whole batch goes at once and any answer can be undone or changed before then. A deferred ask leaves the sitting and returns in a later one. A lane whose every ask has an answer in the sitting shows as a hollow mark in the fleet strip. Keys (`?`) lists the Ask keys.

- **Board:** Find lane (`/`) finds any lane by name, or by a word of its backlog sentence when it has no lane record, holding lanes too. Changed lanes (`c`) lists the lanes whose state changed since your last look; its **save this as your last look** link saves a new last look. The reading age at the right of the top bar opens a box that says how fresh the reading is. Keys (`?`) lists the web keys; on a phone, More holds the board switch and Lane sim.

`/simulation` is a web-only surface, opened from Lane sim in the station rail.
It runs one admitted model through every lane state and ends in its failure: stress eruptions on the hull, the rupture with its blast, then nine rigid pieces that drift out of the field, each with its own velocity and spin. The drawing stops once every piece has left the field. Pause, Restart, Step, a state button for each state and Blow it up (`x`) drive it; the ship picker lists every admitted model in the loaded pool.
It uses synthetic lane data and never answers a real ask.

The simulation keeps idle and hidden performance budgets, recorded in `web/perf/budget.json`:

- **Hidden:** while the page is hidden, it draws no ship frames, steps no states and makes no requests. Spin and steps resume where they stopped once the page is visible again.
- **Idle:** when the debris has left the field, the ship stops spinning by itself. With the simulation paused and the spin stopped, the page draws no frames and makes no requests. Restart or Spin starts the ship again.
- **Active:** spin redraws stay at 24 frames a second or fewer, within a main-thread script budget.
- **Fleet:** the simulation never reads `/fleet.json`.
- **Shipyard:** with its drones and the side ship turning, and while dragged, the yard stays within the active frame and script budgets. With Motion off it draws no frames; while the page is hidden it draws no frames and makes no requests of its own. At 1440 x 900 and 1280 x 720 the yard ends inside the frame and the station does not scroll.

Lane and Ask ships also stop spinning while the page is hidden.
`web/perf/simulation-budget.mjs` serves `testdata/sample-home` with a built `fmlanes` and runs `/simulation` and the Fleet shipyard in headless Chromium, on a copy of the sample home with a lane in work.
It counts ship canvas paints, requests, simulation steps and Chromium script time over fixed windows, and fails when any budget is exceeded:

```sh
(cd web && bun run build) && go build -o fmlanes .
node web/perf/simulation-budget.mjs --binary ./fmlanes --report simulation-budget.json
```

The check imports `playwright` from `NODE_PATH`; it is not a repository dependency.
Install it with a Chromium build outside the repository, then point `NODE_PATH` at it:

```sh
npm install --prefix "$HOME/.cache/fmlanes-playwright" --no-save playwright@1.63.0
"$HOME/.cache/fmlanes-playwright/node_modules/.bin/playwright" install chromium
export NODE_PATH="$HOME/.cache/fmlanes-playwright/node_modules"
```

The **Simulation budget** GitHub workflow builds the web bundle from source, runs this check on every pull request and push to `main`, and posts the measurements to the job summary.

### Keys

| Key | Action |
|---|---|
| `a`, `l`, `f`, `enter` | Ask, List, Fleet, selected Lane |
| `z` | Show or hide the rest of the board on the web Ask station |
| `/`, `c`, `?`, `esc` | Web: find a lane, changed lanes, keys, close a box |
| `space` | Tick the focused List lane; pause/resume a Lane or Ask ship |
| `v` | Web: ship view, ASCII lit, ASCII flat or bars |
| `b` | Web Fleet: heat grid or shipyard |
| `t` | Web Fleet shipyard: from an angle or from the top |
| `h` | Web Fleet heat grid: show or hide the holding lanes |
| `m` | Web: motion on or off (flashes and drones) |
| `i`, `esc` | Web Lane: the lane's list of asks; back to the station that opened it |
| `o` | Focus/type an own answer in Ask |
| `w`, `p`, `k`, `e` | Web Ask: defer, show kept answers, take crew picks, quick sitting (`s`, `g`, `u`, `y`, `n`, `1`–`4` as in the terminal; `d` shows crew text) |
| `tab`, `shift+tab` | Next/previous terminal station |
| `↑`, `↓` or `k`, `j` | Select a terminal lane or ask |
| `m` | Cycle terminal second-mate filter |
| `1`–`4` | Choose an Ask option in the terminal |
| `s`, `g`, `d` | Terminal crew-decides skip, grill request, defer |
| `u`, `r`, `v`, `/` | Terminal undo, review, details, find ask |
| `pgup`, `pgdown` | Scroll terminal Ask cards, detail and delivery reports |
| `y` | Explicitly confirm a terminal send from review, once every ask in the sitting is answered or deferred |
| `c`, `o`, `u`, `n` | In terminal review: change, own answer, undo, return |
| `n` | Start another terminal sitting after delivery/all-deferred |
| `s`, `1`–`5` | In terminal Fleet: heat/shipyard toggle; state filters |
| `b` | Save the terminal's last look |
| `q`, `ctrl+c` | Quit terminal; typing an own answer keeps ordinary letters |

Terminal and web use self-made procedural defaults.
Real ship models load only from the user's local drop-in pool; no third-party models, inherited frames or model-source assets are shipped.

## Reads, state and writes

The reader reads the main home and the homes registered in its `data/secondmates.md`.
Registered second mates remain lanes themselves; their homes' lanes carry the second-mate alias.

Inputs:

- `state/<id>.lane.json`: preferred structured lane record when present.
- `state/<id>.status`: fallback events, `verb [key=<slug>] [at=<epoch>]: text`; continuation lines belong to the previous event.
- `state/<id>.meta`: lane kind.
- `data/backlog.md`: titles, kinds and captain holds.
- `data/secondmates.md`: registered second mates and their `home:` locations, relative to the main home or absolute.
- The configured drop-in root's `lanes/*.lane.json`: local, read-only lanes using the same parser and station projection. These are never answer-command destinations.

A malformed present lane record fails the whole fleet read, without falling back to conflicting status data. CLI and web errors identify the source file or home and preserve the underlying cause.
Malformed individual asks are omitted and counted without hiding valid asks in that record.
An open `needs-decision` or `blocked` status line, or a backlog captain hold, is free text and not a fixed-form ask: it is never an ask card or a sitting slot. It goes back to the crew and counts with the omitted asks; its lane still needs you, and its text stays in the lane's status log.
Text controls are sanitized before terminal rendering; links must be HTTP(S) without embedded credentials.

Five station states:

| State | Meaning |
|---|---|
| needs you | A recent open ask or block |
| waiting | Explicit waiting state without a recent ask |
| working | Working with an update less than two hours old |
| holding | Parked, silent working, failed, or otherwise inactive |
| done | Completed without a recent open ask |

Asks exactly seven days old remain visible; older asks are hidden and counted.
Working becomes holding at exactly two hours.
Autonomy share counts lanes without recorded human involvement, including structured asks and history.
The board also shows freshness and lane-state changes since the explicit last look.
The fleet's `progress` is shared state-derived ship materialization, not a measured percentage of task completion or a time estimate.
Web reveal follows each mesh's own width and includes partially covered edge cells, keeping narrow ships visible at phone and desktop sizes without changing their proportions.

Application state lives outside homes in `$XDG_STATE_HOME/fmlanes`, or the user's `.local/state/fmlanes` when that variable is unset.
The default drop-in root is its `dropins` directory.
The app creates owner-only `models/` and `lanes/` directories there.
A `config.json` in application state, or an external file selected by `FM_LANES_CONFIG`, may set `drop_in`, `models` and `ships`.
Relative configuration locations resolve beside that configuration file.
`--drop-in` overrides the drop-in root; `--ships` selects a converted pool and its parent source root.
Keep this configuration and all personal model inputs outside version control.

`last-look.json` is one server-owned reading shared by devices and the terminal.
`accepted-asks.json` stores exact confirmed-answer receipts; its companion lock prevents concurrent writers losing receipts.
Both use atomic owner-only files.
A receipt hides only the accepted key and asked timestamp, not a later ask reusing that key; a receipt with no timestamp hides nothing.
State, drop-in creation and configured conversion output are rejected inside known homes, including through symlinks.

**No home is written by the reader.** Confirmed answers are the sole home-writing path:

1. Re-read the current fleet and validate every answer against a current, recent, open ask.
2. Reject stale timestamps, invalid choices, duplicate keys and read-only drop-in lanes. Asks without a native task ID, and asks on drop-in lanes, are shown read-only and never take a sitting slot. A task ID shared by two open asks in one home is refused before any delivery, even when only one of them is selected.
3. Invoke the installed `bin/fm-captain-hold.sh answers --source fm-lanes` once per owning home, setting `FM_HOME` for that batch.
4. Send the existing tab-separated key/answer/label contract on stdin; never invoke a shell with answer text.
5. Report actual `closed`, `skipped` and `refused` command results. Exit success alone is not acceptance. There is no automatic retry.

`FM_LANES_ANSWER_COMMAND` can select another installed intake executable, including a deterministic stand-in for isolated verification.
Unconfirmed requests never invoke it.

## Structured lane records

A record carries `name`, one of the five `state` values, `now`, `start`, optional `ticket`, timestamped `history`, and `asks`.
An example choice ask:

```json
{
  "form": "choice",
  "key": "route-choice",
  "question": "Which route should the crew use?",
  "reason": "The next step depends on the route.",
  "choices": [
    {"label": "North", "effect": "Use the shorter route."},
    {"label": "South", "effect": "Use the sheltered route."}
  ],
  "pick": 0,
  "pick_reason": "The shorter route meets the requirement.",
  "effort": "quick",
  "detail": "Additional synthetic context.",
  "tickets": [],
  "pull_requests": [],
  "grill_pages": [],
  "waits_on_this": "The next build step",
  "asked": "2026-01-01T09:00:00Z"
}
```

Choice asks require two to four labelled choices with effects.
`pick` is an optional zero-based choice index; a supplied pick requires `pick_reason`.
`no_pick_reason` may explain why the crew gave no pick.
`effort` is `quick` or `read`.
A discussion ask uses `form: "discussion"`, `topic` and a nonempty `must_decide` string array instead of `question`, `choices` and a pick.
Links have `id`, `title` and `url`; history entries have `at`, `state` and optional `text`.
Use a current `asked` timestamp when trying the example; old asks intentionally disappear from sittings.
The second mate belongs to the lane, not to each ask.

## Add a model

The full executable includes the conversion workflow, certificate checks and ASCII/quadrant renderer.
Conversion requires Bun and Python's `uv` launcher; its isolated script environment installs the declared geometry dependencies.
No source models are downloaded by the app.
Only use assets you have permission to use; never publish personal, third-party-private or game-extracted models.

1. Use the dedicated drop-in root's `models/<group>/<ship>/` directory. Put `model.glb` and `manifest.json` together there.
2. Give every model a stable unique key, display name and explicit nose/up axes. Axes are `+x`, `-x`, `+y`, `-y`, `+z`, `-z`; forward and up must be perpendicular.

```json
{"key":"example-ship","name":"Example Ship","orient":{"forward":"+x","up":"+y"}}
```

3. Set `MODEL_ROOT` to that `models` directory and run the built-in converter:

```sh
./fmlanes --convert-ships "$MODEL_ROOT"
# Optional separate output:
./fmlanes --convert-ships "$MODEL_ROOT" --output "$CONVERTED_ROOT"
```

4. By default, output goes to `models/converted`. It contains `meshes.json` and little-endian signed-16-bit high/low triangle buffers. The converter excludes its own output from source discovery.
5. Start the normal full build with the same drop-in configuration. It preloads the admitted pool automatically. `--ships "$CONVERTED_ROOT"` explicitly selects a pool and takes its parent as the models root, so use it only when `CONVERTED_ROOT` sits directly inside `MODEL_ROOT`. For an output folder elsewhere, set both `models` (`MODEL_ROOT`) and `ships` (`CONVERTED_ROOT`) in the configuration file and start without `--ships`. Refresh an already open web page after changing the pool.
6. Open `/simulation`, choose the model, inspect nose/up orientation, rotate it, switch the ship view, and inspect the blocked and failed states.

Admission verifies the current source, manifest, converter, checker, renderer and output hashes, explicit orientation and reference-checked algorithm-2 certificates.
After duplicate, degenerate and winding repair, conversion compares the actual quantized output against its repaired source through the application's double-sided quadrant depth and triangle buffers.
Nine fixed oblique/cardinal views detect newly missing surfaces, added surfaces and inverted normals; mathematical openness alone is diagnostic, not a rejection.
The checker uses a normalized depth tolerance of 0.02 and a per-view visible-loss limit of 1%, retaining source detail when reduction loses visible surfaces.
These sampled views do not establish completeness for off-view or subpixel geometry.
A failed model does not hide healthy models; admission warnings explain rejected entries.
An outdated or altered certificate cannot serve a mesh.
Do not edit a certificate to force a model through.

Public converter checks construct unequal-axis tetrahedra, open surfaces and missing-face regressions; no external model fixture is required.
The normal runtime configuration can privately preload a local pool without publishing its inventory or locations.

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
PYTHONDONTWRITEBYTECODE=1 uv run --with trimesh --with numpy --with fast-simplification --with networkx --with scipy python converter/test_converter.py
# Needs NODE_PATH for Playwright and ./fmlanes from go build -o fmlanes . (see the simulation budget section):
node web/perf/simulation-budget.mjs --binary ./fmlanes
```

The quality workflow runs on pull requests and pushes to `main`; the no-leak workflow runs on pull request events.

The function-complexity gate compares all tracked and unignored `.go`, `.js`, `.jsx`, `.py`, `.ts`, and `.tsx` source in the base and current tree, including new files.
It excludes `vendor/`, `node_modules/`, `web/app.js`, files ending in `_generated.go`, `.gen.go`, or `.generated.go`, and files marked `Code generated ... DO NOT EDIT.`
Only new or worsened functions above CCN 15 fail; unchanged functions above the limit do not fail.

The required no-leak scan checks every outgoing commit in the PR (its file paths, file contents, full commit message, and author and committer names and emails), the PR head tree, and the PR title and body.
A commit identity may only be the GitHub noreply address `<id>+<login>@users.noreply.github.com` or the repository owner's login (`--owner-login`, which CI takes from the repository owner); every other identity value goes through the denylist and generic shape checks.
Identity allowances never apply to file content, paths, messages, or issue and PR text.
The generic email shape rule skips one exact quoted synthetic credentialed-URL fixture in `lane_record_test.go`; the denylist and every other check still apply to that file.
The generic private-IP shape rule skips one exact quoted synthetic host string in the Host-guard test `state_test.go`; the denylist and every other check still apply to that file.
Local prepublication scans can also check an issue's title and body by passing `--event-file` a JSON file shaped `{"issue": {"title": ..., "body": ...}}`.
A file with no `issue` or `pull_request` object fails the scan.
CI does not scan issues.
The secret-bearing job runs only the trusted default-branch scanner and reads PR Git objects as data; it never executes PR code.
Set repository secret `LEAK_DENYLIST` from the private local denylist using repository Actions settings or a CLI that reads from stdin; never pass the value as an argument or print it.
Never commit or encode the value in artifacts or other public text.
The scan fails when the secret is missing or blank.

## Web bundle

Build `web/app.js` with bun 1.3.14, the version CI pins; other versions emit different bytes. After rebuilding it, rebuild the Go executable so it embeds the updated bundle.
Runtime proof should use synthetic homes, a stand-in keyed-answer command, all four terminal `--once` stations, and actual desktop/phone browser surfaces.

## Public geometry

Built-in defaults and public test fixtures are self-made generic procedural or hand-built geometry.
No third-party models, inherited baked frames or previously credited model sources are included.
Personal models and local preload configuration stay outside version control.

