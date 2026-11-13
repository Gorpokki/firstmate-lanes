import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	boardSummary,
	findFoot,
	findLanes,
	fleetOrder,
	freshness,
	hiddenTicked,
	isOld,
	keepNeedingTicks,
	laneWords,
	stateChanges,
	stateColors,
	type Fleet,
	type Station,
	type SummaryPart,
} from "./stations";
import { FleetStation } from "./FleetStation";
import { LaneStation } from "./LaneStation";
import {
	AskStation,
	type DeliveryResult,
	type SittingAnswer,
} from "./AskStation";
import { ListStation } from "./ListStation";
import { Simulation } from "./Simulation";
import { assignedShip, loadCatalog, type ShipMesh } from "./mesh-catalog";

const POLL_MS = 3000;
type Pop = "find" | "changed" | "save" | "keys" | null;
type Toggle = (pop: Pop) => void;
const stationKeys: [Station, string, string][] = [
	["ask", "Ask", "a"],
	["list", "List", "l"],
	["fleet", "Fleet", "f"],
	["lane", "Lane", "enter"],
];
const KEYS: [string, string][] = [
	["a  l  f", "stations: ask, list, fleet"],
	["enter", "open the selected lane: its ship and its asks"],
	["z", "ask station: show or hide the rest of the board"],
	["/", "find a lane by name, the holding lanes too"],
	["c", "the lanes that changed since your last look"],
	["?", "these keys"],
	["esc", "close a box · lane: back"],
	["space", "list: tick the lane · ask, lane: spin the ship, or stop it"],
	["o", "ask station: type your own answer"],
	["v", "ship view: ASCII lit, ASCII flat, bars"],
	["i", "lane: its list of asks, with find"],
	["arrows", "lane: ← → turn the ship, ↑ ↓ its asks"],
	["1-9 s w g u y", "lane: choose, skip, defer, grill, undo, send"],
	["1-4", "ask station: choose that answer"],
	[
		"s",
		"skip the ask: no answer from you, the crew goes on with its best judgment",
	],
	["w", "defer the ask: it comes back in a later sitting"],
	["u", "undo the last answer, skip or defer"],
	["y", "sitting done: send its answers to Firstmate"],
	["k", "take the crew's ★ picks for the rest of the sitting"],
	["p", "show the answers kept in this sitting"],
	["n", "start the next sitting"],
	["e", "start a sitting of quick asks"],
	["d", "the crew's own text for the ask"],
	[
		"g",
		"ask for a grill: the crew talks the ask through with you before you choose",
	],
];
const SIM_TITLE =
	"One ship run through every lane state, for the review of the holo view";
const Key = ({ k }: { k: string }) => <kbd className="k">{k}</kbd>;
const phone = () => matchMedia("(max-width: 760px)").matches;

function StationButtons(p: { station: Station; go: (s: Station) => void }) {
	return (
		<>
			{stationKeys.map(([id, label, k]) => (
				<button
					key={id}
					className={p.station === id ? "on" : ""}
					aria-current={p.station === id}
					onClick={() => p.go(id)}
				>
					{label}
					<Key k={k} />
				</button>
			))}
		</>
	);
}
function TopBar(p: {
	fleet: Fleet;
	station: Station;
	focus: boolean;
	board: boolean;
	flipBoard: () => void;
	toggle: Toggle;
}) {
	const old = isOld(p.fleet.updatedAt);
	return (
		<div className="top">
			<div className="elbow" />
			<div className="bar">
				{p.focus ? (
					<span className="barnav">
						<button onClick={() => p.toggle("keys")}>
							Keys
							<Key k="?" />
						</button>
					</span>
				) : (
					"Lanes"
				)}
			</div>
			<i />
			<i />
			<i />
			{p.station === "ask" && (
				<button
					className="link boardtog tb"
					aria-pressed={p.board}
					onClick={p.flipBoard}
				>
					{p.board ? "▾ hide the board" : "▸ show the board"}
					<Key k="z" />
				</button>
			)}
			<button
				className={`fresh lab${old ? " old" : ""}`}
				onClick={() => p.toggle("save")}
			>
				{freshness(p.fleet.updatedAt)}
				{old ? " ▸" : ""}
			</button>
		</div>
	);
}
function Rail(p: {
	station: Station;
	focus: boolean;
	go: (s: Station) => void;
	toggle: Toggle;
}) {
	return (
		<nav className="rail" aria-label="Stations">
			<div className="cap" />
			{!p.focus && (
				<>
					<StationButtons station={p.station} go={p.go} />
					<a className="sm" href="/simulation" title={SIM_TITLE}>
						Lane sim
					</a>
				</>
			)}
			<div className="fill" />
			{!p.focus && (
				<>
					<button className="sm" onClick={() => p.toggle("find")}>
						Find lane
						<Key k="/" />
					</button>
					<button className="sm" onClick={() => p.toggle("keys")}>
						Keys
						<Key k="?" />
					</button>
				</>
			)}
			<div className="capb" />
		</nav>
	);
}
function SummaryWords({ part }: { part: SummaryPart }) {
	return (
		<>
			{part.t.map(([words, tone], i) =>
				tone === "need" ? (
					<b key={i}>{words}</b>
				) : tone === "n" ? (
					<em key={i} className="n">
						{words}
					</em>
				) : (
					<React.Fragment key={i}>{words}</React.Fragment>
				),
			)}
		</>
	);
}
function Summary(p: {
	fleet: Fleet;
	go: (s: Station) => void;
	toggle: Toggle;
	lit: boolean;
}) {
	const open = (part: SummaryPart) =>
		part.go === "changed"
			? () => p.toggle("changed")
			: part.go
				? () => p.go(part.go as Station)
				: undefined;
	return (
		<div className="topline">
			<span className={`pulse${p.lit ? " lit" : ""}`}>
				{boardSummary(p.fleet).map((row, i) => (
					<span key={i} className={`prow${i ? " since" : ""}`}>
						{row.map((part) => {
							const onClick = open(part);
							return (
								<React.Fragment key={part.k}>
									{onClick ? (
										<button className={`p-${part.k}`} onClick={onClick}>
											<SummaryWords part={part} />
										</button>
									) : (
										<span className={`p-${part.k}`}>
											<SummaryWords part={part} />
										</span>
									)}
									{part.k === "need" && <i className="br" />}
								</React.Fragment>
							);
						})}
					</span>
				))}
			</span>
			<span className="quiet">
				<button
					className="link chg"
					onClick={() => p.toggle("changed")}
					title="The lanes that changed since your last look"
				>
					changed lanes ▸<Key k="c" />
				</button>
			</span>
		</div>
	);
}
function FleetStrip({
	fleet,
	open,
	flash,
	have,
}: {
	fleet: Fleet;
	open: () => void;
	flash: string[];
	have: string[];
}) {
	const lanes = fleetOrder(fleet);
	const counts = Object.keys(stateColors)
		.map((state) => `${lanes.filter((l) => l.state === state).length} ${state}`)
		.join(", ");
	return (
		<button
			className="strip"
			onClick={open}
			title={`The fleet: one mark per lane. ${counts}${have.length ? ". Hollow: every ask of the lane has your answer" : ""}`}
			aria-label="Open the fleet"
		>
			{lanes.map((lane, i) => (
				<React.Fragment key={lane.id}>
					{i > 0 && lanes[i - 1].state !== lane.state && <i className="gap" />}
					<i
						className={
							[
								flash.includes(lane.id) && "flash",
								have.includes(lane.id) && "have",
							]
								.filter(Boolean)
								.join(" ") || undefined
						}
						style={{ "--c": stateColors[lane.state] } as React.CSSProperties}
					/>
				</React.Fragment>
			))}
		</button>
	);
}
function FindBox(p: {
	fleet: Fleet;
	openLane: (id: string) => void;
	close: () => void;
}) {
	const [query, setQuery] = useState(""),
		[index, setIndex] = useState(0);
	const { rows, n } = findLanes(p.fleet, query);
	const move = (step: number) =>
		setIndex((i) => Math.max(0, Math.min(rows.length - 1, i + step)));
	const key = (e: React.KeyboardEvent) => {
		const run: Record<string, () => void> = {
			Escape: p.close,
			ArrowDown: () => move(1),
			ArrowUp: () => move(-1),
			Enter: () => rows[index] && p.openLane(rows[index].id),
		};
		if (!run[e.key]) return;
		e.preventDefault();
		run[e.key]();
	};
	return (
		<div className="pop find" role="dialog" aria-label="Find lane">
			<span className="lab">Find lane</span>
			<input
				autoFocus
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setIndex(0);
				}}
				onKeyDown={key}
				placeholder={`A part of its name · all ${p.fleet.stationLanes.length} lanes`}
				aria-label="Lane name"
			/>
			{rows.map((lane, i) => (
				<button
					key={lane.id}
					className={`hit${i === index ? " sel" : ""}`}
					onClick={() => p.openLane(lane.id)}
				>
					<i style={{ background: stateColors[lane.state] }} />
					<b>{lane.name}</b>
					<span className="lab">{lane.state}</span>
					<span>{laneWords(lane)}</span>
					<span className="q2">
						{lane.asks[0]?.question || lane.asks[0]?.topic || lane.now}
					</span>
				</button>
			))}
			<span className="foot">{findFoot(query, rows.length, n)}</span>
		</div>
	);
}
function ChangedBox({
	fleet,
	saveLook,
}: {
	fleet: Fleet;
	saveLook: () => void;
}) {
	const lanes = fleetOrder(fleet).filter((l) =>
		fleet.changedLanes.includes(l.id),
	);
	return (
		<div className="pop names" role="dialog" aria-label="Changed lanes">
			<span className="lab">Changed since your last look · esc closes</span>
			{lanes.length ? (
				lanes.map((lane) => (
					<p key={lane.id}>
						<i style={{ color: stateColors[lane.state] }}>● </i>
						<b>{lane.name}</b> · now {lane.state}
					</p>
				))
			) : (
				<p>No lane changed since your last look.</p>
			)}
			<button className="link" onClick={saveLook}>
				save this as your last look
			</button>
		</div>
	);
}
function KeysBox(p: {
	station: Station;
	board: boolean;
	flipBoard: () => void;
}) {
	return (
		<div className="pop" role="dialog" aria-label="Keys">
			<span className="lab">{phone() ? "More" : "Keys"}</span>
			{p.station === "ask" && (
				<button className="btn motionbtn" onClick={p.flipBoard}>
					{p.board ? "Hide the board" : "Show the board"}
				</button>
			)}
			<a className="btn motionbtn" href="/simulation" title={SIM_TITLE}>
				Lane sim
			</a>
			<div className="keys">
				{KEYS.map(([k, words]) => (
					<React.Fragment key={k}>
						<kbd>{k}</kbd>
						<span>{words}</span>
					</React.Fragment>
				))}
			</div>
		</div>
	);
}
type FrameProps = {
	fleet: Fleet;
	station: Station;
	go: (s: Station) => void;
	openLane: (id: string) => void;
	saveLook: () => void;
	have?: string[];
	children: React.ReactNode;
};
function Pops(
	p: Omit<FrameProps, "children" | "go"> & {
		pop: Pop;
		close: () => void;
		board: boolean;
		flipBoard: () => void;
	},
) {
	if (p.pop === "find")
		return (
			<>
				<div className="veil" onClick={p.close} />
				<FindBox
					fleet={p.fleet}
					close={p.close}
					openLane={(id) => {
						p.close();
						p.openLane(id);
					}}
				/>
			</>
		);
	if (p.pop === "changed")
		return <ChangedBox fleet={p.fleet} saveLook={p.saveLook} />;
	if (p.pop === "keys")
		return (
			<KeysBox station={p.station} board={p.board} flipBoard={p.flipBoard} />
		);
	if (p.pop === "save")
		return (
			<div className="pop" role="dialog" aria-label="Save">
				<span className="lab">{freshness(p.fleet.updatedAt)}</span>
				{`The board server reads Firstmate's state files for each poll, every ${POLL_MS / 1000} seconds; if the reading stays old, check that the board server is running and reachable.`}
			</div>
		);
	return null;
}
// The board's keys: z shows or hides it on Ask, / Find lane, c changed lanes, ? keys, esc closes a box. A field keeps its keys.
function useFrameKeys(
	station: Station,
	flipBoard: () => void,
	toggle: Toggle,
	close: () => void,
) {
	useEffect(() => {
		const keys: Record<string, () => void> = {
			"/": () => toggle("find"),
			c: () => toggle("changed"),
			"?": () => toggle("keys"),
			Escape: close,
			...(station === "ask" ? { z: flipBoard } : {}),
		};
		const key = (e: KeyboardEvent) => {
			const run = keys[e.key];
			const field = (e.target as HTMLElement).closest(
				"input,textarea,select,[contenteditable=true]",
			);
			if (!run || e.metaKey || e.ctrlKey || e.altKey || field) return;
			e.preventDefault();
			run();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [station]);
}
// A lane that changed state since the reading before lights its strip mark and the summary once; the class drops at the next reading.
function useFlash(fleet: Fleet) {
	const seen = useRef<Record<string, string> | null>(null),
		[flash, setFlash] = useState<string[]>([]);
	useEffect(() => {
		const ids = stateChanges(seen.current, fleet);
		seen.current = Object.fromEntries(
			fleet.stationLanes.map((l) => [l.id, l.state]),
		);
		setFlash((old) => (ids.length || old.length ? ids : old));
	}, [fleet]);
	return flash;
}
// The board around every station: top bar, station rail, the fleet strip and the phone's station bar.
function Frame(p: FrameProps) {
	const [board, setBoard] = useState(false),
		[pop, setPop] = useState<Pop>(null);
	const toggle: Toggle = (next) =>
		setPop((old) => (old === next ? null : next));
	const flipBoard = () => setBoard((shown) => !shown);
	const close = () => setPop(null);
	useFrameKeys(p.station, flipBoard, toggle, close);
	const flash = useFlash(p.fleet);
	const focus = p.station === "ask" && !board,
		quiet = p.station === "ask" || p.station === "list";
	const openFleet = () => p.go("fleet");
	return (
		<div
			className={`frame v-${p.station}${quiet ? " quiet" : ""}${focus ? " focus" : ""}`}
		>
			<TopBar
				fleet={p.fleet}
				station={p.station}
				focus={focus}
				board={board}
				flipBoard={flipBoard}
				toggle={toggle}
			/>
			<Rail station={p.station} focus={focus} go={p.go} toggle={toggle} />
			<main className="main">
				{p.station !== "ask" && (
					<Summary
						fleet={p.fleet}
						go={p.go}
						toggle={toggle}
						lit={flash.length > 0}
					/>
				)}
				{p.children}
			</main>
			<div className="bot">
				<div className="elbow" />
				<FleetStrip
					fleet={p.fleet}
					open={openFleet}
					flash={flash}
					have={p.have ?? []}
				/>
			</div>
			<nav className="tabs" aria-label="Stations">
				<FleetStrip
					fleet={p.fleet}
					open={openFleet}
					flash={flash}
					have={p.have ?? []}
				/>
				<div>
					<StationButtons station={p.station} go={p.go} />
					<button className="find" onClick={() => toggle("find")}>
						Find
					</button>
					<button className="more" onClick={() => toggle("keys")}>
						More
					</button>
				</div>
			</nav>
			<Pops
				fleet={p.fleet}
				station={p.station}
				openLane={p.openLane}
				saveLook={p.saveLook}
				pop={pop}
				close={close}
				board={board}
				flipBoard={flipBoard}
			/>
		</div>
	);
}
function App() {
	const [fleet, setFleet] = useState<Fleet | null>(null),
		[error, setError] = useState(""),
		[, setFailedReads] = useState(0);
	const [station, setStation] = useState<Station>("list"),
		[back, setBack] = useState<Station>("list"),
		[mate, setMate] = useState(""),
		[selected, setSelected] = useState("");
	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [have, setHave] = useState<string[]>([]);
	const [meshes, setMeshes] = useState<ShipMesh[]>([]),
		[modelWarnings, setModelWarnings] = useState<string[]>([]);
	const simulation = location.pathname === "/simulation";
	// The Lane station's esc goes back to the station that opened it.
	const go = (next: Station) => {
		if (next === "lane" && station !== "lane") setBack(station);
		setStation(next);
	};
	const tick = (id: string) => {
		if (!fleet || !keepNeedingTicks(fleet, new Set([id])).size) return;
		setChecked((old) => {
			const next = new Set(old);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	};
	const takeFleet = (data: Fleet) => {
		setFleet(data);
		setChecked((old) => {
			const next = keepNeedingTicks(data, old);
			return next.size === old.size ? old : next;
		});
	};
	useEffect(() => {
		const controller = new AbortController();
		loadCatalog(controller.signal)
			.then((catalog) => {
				setMeshes(catalog.models);
				setModelWarnings(catalog.warnings);
			})
			.catch((e) => {
				if (!controller.signal.aborted) setModelWarnings([String(e)]);
			});
		return () => controller.abort();
	}, []);
	useEffect(() => {
		if (simulation) return;
		const controller = new AbortController();
		const load = async () => {
			try {
				const response = await fetch("/fleet.json", {
					cache: "no-store",
					signal: controller.signal,
				});
				if (!response.ok) throw Error(await response.text());
				const data = await response.json();
				takeFleet(data);
				setError("");
			} catch (e) {
				if (controller.signal.aborted) return;
				setError(String(e));
				// A failed read still re-renders, so the reading's age keeps moving.
				setFailedReads((n) => n + 1);
			}
		};
		load();
		const timer = setInterval(load, POLL_MS);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [simulation]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			if (
				simulation ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey ||
				(e.target as HTMLElement).closest(
					"input,textarea,select,[contenteditable=true]",
				)
			)
				return;
			if (
				(e.key === "Enter" || e.code === "Space") &&
				(e.target as HTMLElement).closest("button,a,summary")
			)
				return;
			const keys: Record<string, Station> = {
				a: "ask",
				l: "list",
				f: "fleet",
				Enter: "lane",
			};
			if (keys[e.key]) {
				e.preventDefault();
				go(keys[e.key]);
			}
			if (e.code === "Space" && station === "list" && selected) {
				e.preventDefault();
				tick(selected);
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [station, selected, simulation, fleet]);
	if (simulation)
		return (
			<main className="sim-page">
				<Simulation meshes={meshes} />
				{modelWarnings.map((w) => (
					<p role="status" key={w}>
						{w}
					</p>
				))}
			</main>
		);
	if (!fleet) return <main role="status">{error || "Reading fleet…"}</main>;
	const lane =
		fleet.stationLanes.find((l) => l.id === selected) || fleet.stationLanes[0];
	const openLane = (id: string) => {
		setSelected(id);
		go("lane");
	};
	const ship = lane ? assignedShip(lane.id, meshes) : undefined;
	// One batch of answers, from the Ask station's sitting or from one lane, through the answer command.
	const sendAnswers = async (answers: SittingAnswer[]) => {
		const response = await fetch("/answers", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Fleet-Action": "confirm",
			},
			body: JSON.stringify({ confirmed: true, answers }),
		});
		if (!response.ok) throw Error(await response.text());
		const results: DeliveryResult[] = await response.json();
		try {
			const refreshed = await fetch("/fleet.json", {
				cache: "no-store",
			});
			if (!refreshed.ok) throw Error(await refreshed.text());
			takeFleet(await refreshed.json());
		} catch (e) {
			setError(`Answer results received; fleet refresh failed: ${String(e)}`);
		}
		return results;
	};
	const saveLook = async () => {
		try {
			const response = await fetch("/last-look", {
				method: "POST",
				headers: { "X-Fleet-Action": "save" },
			});
			if (!response.ok) throw Error(await response.text());
		} catch (e) {
			setError(String(e));
		}
	};
	return (
		<Frame
			fleet={fleet}
			station={station}
			go={go}
			openLane={openLane}
			saveLook={saveLook}
			have={have}
		>
			<style>{`.station button,.station select{background:#17131B;color:var(--text);border:1px solid #4A4252;border-radius:8px;padding:10px;cursor:pointer}.station header{border-bottom:1px solid var(--line);padding-bottom:16px}.station h1{font-size:26px}.station article{margin:20px 0;padding:18px;border:1px solid #4A4252;border-radius:12px}.station p{line-height:1.5}.station a{color:var(--peach)}`}</style>
			{error && <p role="alert">{error}</p>}
			<div className="station">
				{station === "list" && (
					<ListStation
						fleet={fleet}
						mate={mate}
						setMate={setMate}
						ticked={checked}
						tick={tick}
						selected={selected}
						select={setSelected}
						openLane={openLane}
						decide={() => setStation("ask")}
					/>
				)}
				{station === "lane" &&
					(lane ? (
						<LaneStation
							key={lane.id}
							lane={lane}
							mesh={ship?.mesh}
							shipName={ship?.name}
							onBack={() => setStation(back)}
							onConfirm={sendAnswers}
						/>
					) : (
						<p>No lanes.</p>
					))}
				{station === "fleet" && (
					<FleetStation
						fleet={fleet}
						meshes={meshes}
						onSelect={(row) => setSelected(row.id)}
					/>
				)}
				<AskStation
					active={station === "ask"}
					fleet={fleet}
					meshes={meshes}
					selectedLaneIds={checked.size ? [...checked] : undefined}
					hiddenSelected={hiddenTicked(fleet, checked, mate)}
					onBack={() => setStation("list")}
					onOpenLane={openLane}
					onAnswered={(ids) =>
						setHave((old) => (old.join() === ids.join() ? old : ids))
					}
					onConfirm={sendAnswers}
				/>
				{modelWarnings.length > 0 && (
					<details>
						<summary>Model admission warnings</summary>
						{modelWarnings.map((w) => (
							<p key={w}>{w}</p>
						))}
					</details>
				)}
			</div>
		</Frame>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
