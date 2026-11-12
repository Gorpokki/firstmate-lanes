// The lane board web canvas in plain React, fed by the TUI's Fleet JSON
// (fmlanes --serve publishes fleet.json and ships.json). It re-reads
// fleet.json every 2 s. Panels with no source in status logs (PRs, releases,
// runners, orders) are dropped. Lane cards open their log.
import React, { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { stamp } from "./time";

type Fleet = {
	updatedAt: string;
	kpis: { label: string; value: string; detail: string; tone: string }[];
	blockers:
		| { title: string; detail: string; next: string; age: string }[]
		| null;
	waitingOnCaptain:
		| { lane: string; key: string; ask: string; age: string }[]
		| null;
	lanes: Lane[] | null;
	crew: Lane[] | null;
	timeline: { at: string; lane: string; verb: string; text: string }[] | null;
};
type Lane = {
	id: string;
	title: string;
	kind: string;
	status: string;
	note: string;
	age: string;
	decisions: number;
	mate: boolean;
	log: { at: string; verb: string; text: string }[] | null;
};

const C = {
	bg: "#000000",
	orange: "#FF9900",
	peach: "#FFCC99",
	lav: "#CC99CC",
	blue: "#9999FF",
	sky: "#99CCFF",
	gold: "#FFCC66",
	tan: "#DDAA77",
	red: "#FF5555",
	redDeep: "#CC3333",
	gray: "#777799",
	ink: "#000000",
	text: "#FFE6CC",
	dim: "#B8A898",
};
const FONT = "'Antonio', 'Helvetica Neue', Arial Narrow, system-ui, sans-serif";
const TONE: Record<string, string> = {
	ok: C.sky,
	warn: C.gold,
	alert: C.red,
	info: C.blue,
	idle: C.gray,
};
const LANE_COLOR: Record<string, string> = {
	blocked: C.red,
	failed: C.redDeep,
	waiting: C.orange,
	"in-progress": C.sky,
	parked: C.gray,
	queued: C.lav,
	done: C.blue,
};
const LANE_LABEL: Record<string, string> = {
	blocked: "Blocked",
	failed: "Failed",
	waiting: "Waiting on captain",
	"in-progress": "In progress",
	parked: "Parked",
	queued: "Queued",
	done: "Done",
};
const VERB_COLOR: Record<string, string> = {
	"needs-decision": C.orange,
	blocked: C.red,
	failed: C.red,
	working: C.sky,
	paused: C.gray,
	done: C.blue,
	resolved: C.lav,
};

const lab: CSSProperties = {
	fontFamily: FONT,
	textTransform: "uppercase",
	letterSpacing: "0.08em",
	fontWeight: 600,
};

function Pill(props: {
	label: string;
	color: string;
	active?: boolean;
	count?: number;
	onClick?: () => void;
}) {
	const style: CSSProperties = {
		...lab,
		fontSize: 12,
		border: props.active ? `2px solid ${C.text}` : "2px solid transparent",
		cursor: props.onClick ? "pointer" : "default",
		background: props.color,
		color: C.ink,
		borderRadius: 999,
		padding: "6px 14px",
		minHeight: 30,
		opacity: props.active === false ? 0.78 : 1,
	};
	const body = `${props.label}${props.count !== undefined ? ` ${props.count}` : ""}`;
	return props.onClick ? (
		<button
			type="button"
			aria-pressed={props.active}
			style={style}
			onClick={props.onClick}
		>
			{body}
		</button>
	) : (
		<span style={{ ...style, display: "inline-block" }}>{body}</span>
	);
}

function Frame(props: {
	id: string;
	title: string;
	color: string;
	tag?: string;
	children?: ReactNode;
}) {
	return (
		<section
			id={props.id}
			style={{
				marginTop: 18,
				borderTop: `14px solid ${props.color}`,
				borderLeft: `clamp(14px, 4vw, 36px) solid ${props.color}`,
				borderBottom: `6px solid ${props.color}`,
				borderTopLeftRadius: 40,
				borderBottomLeftRadius: 28,
				padding: "10px 4px 14px clamp(10px, 2vw, 18px)",
				minWidth: 0,
			}}
		>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					alignItems: "baseline",
					justifyContent: "space-between",
					gap: 8,
					marginBottom: 10,
				}}
			>
				<h2 style={{ ...lab, margin: 0, fontSize: 20, color: props.color }}>
					{props.title}
				</h2>
				{props.tag ? (
					<span style={{ ...lab, fontSize: 11, color: C.dim }}>
						{props.tag}
					</span>
				) : null}
			</div>
			{props.children}
		</section>
	);
}

function Empty(props: { what: string }) {
	return (
		<div
			style={{ ...lab, fontSize: 13, color: C.dim, padding: "8px 0" }}
		>{`No ${props.what} on record`}</div>
	);
}

function Card(props: {
	color: string;
	head: string;
	badge?: string;
	onClick?: () => void;
	open?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			onClick={props.onClick}
			style={{
				flex: "1 1 260px",
				minWidth: 0,
				display: "flex",
				background: props.open ? "#1c1820" : "#111014",
				borderRadius: 16,
				overflow: "hidden",
				cursor: props.onClick ? "pointer" : "default",
				outline: props.open ? `2px solid ${props.color}` : "none",
			}}
		>
			<div style={{ width: 10, flexShrink: 0, background: props.color }} />
			<div style={{ padding: "10px 12px", minWidth: 0, flex: 1 }}>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span
						style={{
							...lab,
							fontSize: 14,
							color: C.peach,
							overflowWrap: "anywhere",
						}}
					>
						{props.head}
					</span>
					{props.badge ? (
						<Pill label={props.badge} color={props.color} />
					) : null}
				</div>
				<div
					style={{
						color: C.text,
						fontSize: 14,
						lineHeight: 1.45,
						marginTop: 6,
						overflowWrap: "anywhere",
					}}
				>
					{props.children}
				</div>
			</div>
		</div>
	);
}

const wrapRow: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };

type View =
	| "all"
	| "alert"
	| "health"
	| "captain"
	| "lanes"
	| "crew"
	| "log"
	| "holo";
const VIEWS: { v: View; label: string; color: string }[] = [
	{ v: "all", label: "All", color: C.peach },
	{ v: "alert", label: "Alert", color: C.red },
	{ v: "health", label: "Health", color: C.orange },
	{ v: "captain", label: "Captain", color: C.peach },
	{ v: "lanes", label: "Lanes", color: C.sky },
	{ v: "crew", label: "Crew", color: C.tan },
	{ v: "log", label: "Log", color: C.lav },
	{ v: "holo", label: "Holo", color: C.blue },
];

function LaneLog(props: { lane: Lane }) {
	const log = props.lane.log ?? [];
	return (
		<div
			style={{ marginTop: 8, borderTop: `1px solid #332a22`, paddingTop: 8 }}
		>
			<div
				style={{ ...lab, fontSize: 11, color: C.dim }}
			>{`${props.lane.kind} · ${props.lane.title}`}</div>
			<ol
				style={{
					listStyle: "none",
					margin: "6px 0 0",
					padding: 0,
					display: "flex",
					flexDirection: "column",
					gap: 4,
				}}
			>
				{log.slice(-8).map((e, i) => (
					<li
						key={i}
						style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
					>
						<span
							style={{
								...lab,
								flexShrink: 0,
								background: C.lav,
								color: C.ink,
								borderRadius: 999,
								padding: "2px 8px",
								fontSize: 11,
							}}
						>
							{e.at}
						</span>
						<span style={{ fontSize: 13, minWidth: 0 }}>
							<b style={{ color: VERB_COLOR[e.verb] ?? C.text }}>{e.verb}</b>
							{`: ${e.text}`}
						</span>
					</li>
				))}
			</ol>
		</div>
	);
}

// ---- per-lane hologram: same ships, pick, targets and assembly rule as the TUI (holo.go) ----
type ShipFrame = { wire: string[]; fill: string[] };
let SHIPS: Record<string, ShipFrame[]> = {};
fetch("ships.json")
	.then((r) => r.json())
	.then((j) => {
		SHIPS = j;
	})
	.catch(() => {});
const SHIP_NAMES = ["Starblazer", "Liberty Enforcer", "Barracuda", "Anubis"];
const HOLO_TARGET: Record<string, number> = {
	queued: 0.12,
	parked: 0.45,
	"in-progress": 0.6,
	waiting: 0.72,
	blocked: 0.5,
	failed: 0.5,
	done: 1,
};
function fnv32a(s: string): number {
	let h = 0x811c9dc5;
	for (const b of new TextEncoder().encode(s)) {
		h ^= b;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}
function shipFor(id: string): string {
	return SHIP_NAMES[fnv32a(id) % SHIP_NAMES.length];
}
function cellRank(r: number, c: number): number {
	let x = (Math.imul(r, 73856093) ^ Math.imul(c, 19349663)) >>> 0;
	x = (x ^ (x >>> 13)) >>> 0;
	x = Math.imul(x, 0x5bd1e995) >>> 0;
	x = (x ^ (x >>> 15)) >>> 0;
	return (x % 1000) / 1000;
}
const escH = (c: string) =>
	c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c;
function holoHTML(l: Lane, tick: number, prog: number): string {
	const fs = SHIPS[shipFor(l.id)];
	if (!fs || !fs.length) return "";
	const f = fs[tick % fs.length];
	let color = LANE_COLOR[l.status] ?? C.gray;
	if (l.status === "blocked" && tick % 4 < 2) color = "#661f1f";
	let out = "";
	for (let r = 0; r < f.fill.length; r++) {
		const fill = [...f.fill[r]],
			wire = [...f.wire[r]];
		let run = "",
			cls = "";
		const flush = () => {
			if (run) out += cls ? `<span style="color:${cls}">${run}</span>` : run;
			run = "";
		};
		for (let c = 0; c < fill.length; c++) {
			const ch = fill[c],
				wc = wire[c] ?? " ",
				rank = cellRank(r, c);
			let k = "",
				t = " ";
			if (ch === " " && wc === " ") {
				t = " ";
			} else if (l.status === "failed" && rank < 0.4) {
				k = C.dim;
				t = "·";
			} else if (rank < prog && ch !== " ") {
				k = color;
				t = ch;
			} else if (wc !== " ") {
				k = "#3a3550";
				t = wc;
			}
			if (k !== cls) {
				flush();
				cls = k;
			}
			run += escH(t);
		}
		flush();
		out += "\n";
	}
	return out;
}
function Holo(props: {
	lane: Lane;
	tick: number;
	prog: number;
	size?: number;
}) {
	const l = props.lane;
	return (
		<div
			style={{
				position: "relative",
				border: `1px solid #2a2440`,
				borderTop: `3px solid ${LANE_COLOR[l.status] ?? C.gray}`,
				borderRadius: 12,
				padding: "22px 6px 8px",
				overflow: "hidden",
				background: "#05040a",
			}}
		>
			<span
				style={{
					...lab,
					position: "absolute",
					top: 4,
					left: 10,
					fontSize: 11,
					color: LANE_COLOR[l.status] ?? C.gray,
				}}
			>{`Holo // ${shipFor(l.id)} // ${Math.round(props.prog * 100)}%`}</span>
			<pre
				aria-label={`Lane ship for ${l.id}`}
				style={{
					margin: 0,
					fontFamily: "Menlo, 'SF Mono', Consolas, monospace",
					fontSize: props.size ?? 8,
					lineHeight: 1.15,
					textAlign: "center",
					overflow: "hidden",
				}}
				dangerouslySetInnerHTML={{
					__html: holoHTML(l, props.tick, props.prog),
				}}
			/>
		</div>
	);
}

function App(props: { initial: Fleet }) {
	const [F, setF] = useState<Fleet>(props.initial);
	const [stale, setStale] = useState(false);
	const [view, setView] = useState<View>("all");
	const [laneFilter, setLaneFilter] = useState<string>("all");
	const [openLane, setOpenLane] = useState<string>("");
	const [tick, setTick] = useState(0);
	const prog = React.useRef<Record<string, number>>({});
	useEffect(() => {
		const t = setInterval(() => setTick((x) => x + 1), 150);
		return () => clearInterval(t);
	}, []);
	useEffect(() => {
		const t = setInterval(() => {
			fetch("fleet.json", { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.then((j) => {
					setStale(!j);
					if (j) setF(j);
				})
				.catch(() => setStale(true));
		}, 2000);
		return () => clearInterval(t);
	}, []);
	for (const l of F.lanes ?? []) {
		const t = HOLO_TARGET[l.status] ?? 0.3,
			p = prog.current[l.id];
		prog.current[l.id] =
			p === undefined
				? t
				: Math.abs(t - p) < 0.02
					? t
					: p + Math.sign(t - p) * 0.02;
	}
	const ts = stamp(F.updatedAt);
	const show = (v: View) => view === "all" || view === v;
	const all = F.lanes ?? [],
		blockers = F.blockers ?? [],
		waiting = F.waitingOnCaptain ?? [],
		crew = F.crew ?? [],
		timeline = F.timeline ?? [];
	const laneStatuses = Object.keys(LANE_COLOR).filter((s) =>
		all.some((l) => l.status === s),
	);
	const lanes = all.filter(
		(l) => laneFilter === "all" || l.status === laneFilter,
	);
	const total = all.length;

	return (
		<div
			style={{
				background: C.bg,
				color: C.text,
				fontFamily: FONT,
				padding: "12px clamp(8px, 2vw, 20px) 28px",
				minHeight: "100vh",
				boxSizing: "border-box",
			}}
		>
			<header
				style={{
					borderTop: `22px solid ${C.orange}`,
					borderLeft: `clamp(18px, 6vw, 64px) solid ${C.orange}`,
					borderTopLeftRadius: 56,
					padding: "12px 4px 4px clamp(10px, 2vw, 18px)",
				}}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "space-between",
						alignItems: "flex-end",
						gap: 10,
					}}
				>
					<div style={{ minWidth: 0 }}>
						<h1
							style={{
								...lab,
								margin: 0,
								fontSize: "clamp(24px, 6vw, 40px)",
								lineHeight: 1.05,
								color: C.orange,
							}}
						>
							Firstmate fleet ops
						</h1>
						<div
							style={{ ...lab, fontSize: 12, color: C.dim, marginTop: 4 }}
						>{`read-only · ${stale ? "stale: cannot reach the home" : "live"}`}</div>
					</div>
					<div style={{ textAlign: "right" }}>
						<div
							style={{ ...lab, fontSize: 18, color: C.sky }}
						>{`Stardate ${ts.stardate}`}</div>
						<div style={{ ...lab, fontSize: 13, color: C.peach }}>
							{ts.localTime}
						</div>
					</div>
				</div>
				<nav style={{ ...wrapRow, gap: 6, marginTop: 14 }} aria-label="Panels">
					{VIEWS.map((x) => (
						<Pill
							key={x.v}
							label={x.label}
							color={x.color}
							active={view === x.v}
							onClick={() => setView(x.v)}
						/>
					))}
				</nav>
			</header>

			{show("alert") ? (
				<Frame
					id="alert"
					title={blockers.length ? "Red alert · blockers" : "Blockers"}
					color={blockers.length ? C.red : C.blue}
					tag={`${blockers.length} active`}
				>
					{blockers.length === 0 ? (
						<Empty what="blockers" />
					) : (
						<div style={wrapRow}>
							{blockers.map((b, i) => (
								<div
									key={i}
									style={{
										flex: "1 1 300px",
										minWidth: 0,
										border: `2px solid ${C.red}`,
										borderRadius: 20,
										padding: "12px 14px",
									}}
								>
									<div style={{ ...lab, fontSize: 18, color: C.red }}>
										{b.title}
									</div>
									<div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
										{b.detail}
									</div>
									<div style={{ fontSize: 14, marginTop: 10, color: C.peach }}>
										<span style={{ ...lab, color: C.dim, fontSize: 12 }}>
											Lane ·{" "}
										</span>
										{b.next}
									</div>
									<div
										style={{ ...lab, fontSize: 11, color: C.dim, marginTop: 6 }}
									>{`Open ${b.age}`}</div>
								</div>
							))}
						</div>
					)}
				</Frame>
			) : null}

			{show("health") ? (
				<Frame
					id="health"
					title="Fleet health"
					color={C.orange}
					tag={`${total} lanes tracked`}
				>
					<div style={wrapRow}>
						{F.kpis.map((k) => (
							<div
								key={k.label}
								style={{
									flex: "1 1 150px",
									minWidth: 0,
									display: "flex",
									alignItems: "stretch",
									background: "#111014",
									borderRadius: 999,
									overflow: "hidden",
								}}
							>
								<div
									style={{
										...lab,
										background: TONE[k.tone] ?? C.gray,
										color: C.ink,
										fontSize: 26,
										padding: "6px 14px",
										display: "flex",
										alignItems: "center",
										borderRadius: 999,
									}}
								>
									{k.value}
								</div>
								<div style={{ padding: "6px 14px 6px 10px", minWidth: 0 }}>
									<div style={{ ...lab, fontSize: 12, color: C.peach }}>
										{k.label}
									</div>
									<div style={{ fontSize: 12, color: C.dim }}>{k.detail}</div>
								</div>
							</div>
						))}
					</div>
					{total > 0 ? (
						<div style={{ marginTop: 14 }}>
							<div
								style={{
									display: "flex",
									height: 18,
									borderRadius: 999,
									overflow: "hidden",
									gap: 3,
								}}
								role="img"
								aria-label="Lanes by status"
							>
								{laneStatuses.map((s) => (
									<div
										key={s}
										style={{
											flex: all.filter((l) => l.status === s).length,
											background: LANE_COLOR[s],
										}}
									/>
								))}
							</div>
							<div style={{ ...wrapRow, gap: 12, marginTop: 8 }}>
								{laneStatuses.map((s) => (
									<span
										key={s}
										style={{
											...lab,
											fontSize: 11,
											color: C.text,
											display: "inline-flex",
											alignItems: "center",
											gap: 6,
										}}
									>
										<span
											style={{
												width: 10,
												height: 10,
												borderRadius: 999,
												background: LANE_COLOR[s],
												display: "inline-block",
											}}
										/>
										{`${LANE_LABEL[s]} ${all.filter((l) => l.status === s).length}`}
									</span>
								))}
							</div>
						</div>
					) : null}
				</Frame>
			) : null}

			{show("captain") ? (
				<Frame
					id="captain"
					title="Waiting on captain"
					color={C.peach}
					tag={`${waiting.length} items`}
				>
					{waiting.length === 0 ? (
						<Empty what="items waiting on you" />
					) : (
						<div style={wrapRow}>
							{waiting.map((w) => (
								<Card
									key={w.lane + w.key}
									color={C.peach}
									head={w.lane}
									badge={w.key}
								>
									<div>{w.ask}</div>
									<div
										style={{ ...lab, fontSize: 11, color: C.dim, marginTop: 4 }}
									>{`Open ${w.age}`}</div>
								</Card>
							))}
						</div>
					)}
				</Frame>
			) : null}

			{show("lanes") ? (
				<Frame
					id="lanes"
					title="Lane board"
					color={C.sky}
					tag={`${lanes.length} shown · tap a lane for its log`}
				>
					{all.length === 0 ? (
						<Empty what="lanes" />
					) : (
						<div>
							<div style={{ ...wrapRow, gap: 6, marginBottom: 12 }}>
								<Pill
									label="All"
									color={C.peach}
									active={laneFilter === "all"}
									count={total}
									onClick={() => setLaneFilter("all")}
								/>
								{laneStatuses.map((s) => (
									<Pill
										key={s}
										label={LANE_LABEL[s]}
										color={LANE_COLOR[s]}
										active={laneFilter === s}
										count={all.filter((l) => l.status === s).length}
										onClick={() => setLaneFilter(s)}
									/>
								))}
							</div>
							<div style={wrapRow}>
								{lanes.map((l) => (
									<Card
										key={l.id}
										color={LANE_COLOR[l.status] ?? C.gray}
										head={`${l.id}${l.mate ? " ▸" : ""}${l.decisions ? ` ◆${l.decisions}` : ""}`}
										badge={LANE_LABEL[l.status] ?? l.status}
										open={openLane === l.id}
										onClick={() => setOpenLane(openLane === l.id ? "" : l.id)}
									>
										<div>{l.note}</div>
										<div
											style={{
												...lab,
												fontSize: 11,
												color: C.dim,
												marginTop: 4,
											}}
										>{`Updated ${l.age} ago`}</div>
										{openLane === l.id ? (
											<div style={{ marginTop: 8 }}>
												<Holo
													lane={l}
													tick={tick}
													prog={prog.current[l.id] ?? 0}
													size={7}
												/>
												<LaneLog lane={l} />
											</div>
										) : null}
									</Card>
								))}
							</div>
						</div>
					)}
				</Frame>
			) : null}

			{show("crew") ? (
				<Frame
					id="crew"
					title="Crew"
					color={C.tan}
					tag={`${crew.length} stations`}
				>
					{crew.length === 0 ? (
						<Empty what="crew" />
					) : (
						<div style={wrapRow}>
							{crew.map((c) => (
								<Card
									key={c.id}
									color={C.tan}
									head={`${c.id} · second mate`}
									badge={LANE_LABEL[c.status] ?? c.status}
								>
									{c.title}
								</Card>
							))}
						</div>
					)}
				</Frame>
			) : null}

			{show("holo") ? (
				<Frame
					id="holo"
					title="Holo · every lane"
					color={C.blue}
					tag="ships assemble as lanes move forward"
				>
					{all.length === 0 ? (
						<Empty what="lanes" />
					) : (
						<div
							style={{
								display: "grid",
								gridTemplateColumns:
									"repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
								gap: 10,
							}}
						>
							{all.map((l) => (
								<div key={l.id} style={{ minWidth: 0 }}>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											gap: 8,
											alignItems: "center",
											marginBottom: 4,
										}}
									>
										<span
											style={{
												...lab,
												fontSize: 14,
												color: C.peach,
												overflowWrap: "anywhere",
											}}
										>
											{l.id}
										</span>
										<Pill
											label={LANE_LABEL[l.status] ?? l.status}
											color={LANE_COLOR[l.status] ?? C.gray}
										/>
									</div>
									<Holo
										lane={l}
										tick={tick}
										prog={prog.current[l.id] ?? 0}
										size={6}
									/>
								</div>
							))}
						</div>
					)}
				</Frame>
			) : null}

			{show("log") ? (
				<Frame id="log" title="Timeline" color={C.lav} tag="local time">
					{timeline.length === 0 ? (
						<Empty what="events" />
					) : (
						<ol
							style={{
								listStyle: "none",
								margin: 0,
								padding: 0,
								display: "flex",
								flexDirection: "column",
								gap: 6,
							}}
						>
							{timeline.map((e, i) => (
								<li
									key={`${e.at}-${i}`}
									style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
								>
									<span
										style={{
											...lab,
											flexShrink: 0,
											minWidth: 64,
											textAlign: "center",
											background: i === timeline.length - 1 ? C.peach : C.lav,
											color: C.ink,
											borderRadius: 999,
											padding: "4px 8px",
											fontSize: 12,
										}}
									>
										{e.at}
									</span>
									<span
										style={{
											fontSize: 14,
											lineHeight: 1.45,
											minWidth: 0,
											overflowWrap: "anywhere",
										}}
									>
										<b style={{ ...lab, fontSize: 12, color: C.peach }}>
											{e.lane}
										</b>{" "}
										<b style={{ color: VERB_COLOR[e.verb] ?? C.text }}>
											{e.verb}
										</b>
										{`: ${e.text}`}
									</span>
								</li>
							))}
						</ol>
					)}
				</Frame>
			) : null}

			<footer
				style={{
					marginTop: 18,
					display: "flex",
					flexWrap: "wrap",
					gap: 6,
					alignItems: "center",
				}}
			>
				<div
					style={{
						flex: "1 1 120px",
						height: 12,
						background: C.orange,
						borderRadius: 999,
					}}
				/>
				<span style={{ ...lab, fontSize: 11, color: C.dim }}>
					Source · fmlanes --serve · fleet.json (same reader as the TUI)
				</span>
			</footer>
		</div>
	);
}

const root = createRoot(document.getElementById("root")!);
fetch("fleet.json", { cache: "no-store" })
	.then((r) => r.json())
	.then((f: Fleet) => root.render(<App initial={f} />))
	.catch(() =>
		root.render(
			<div style={{ ...lab, color: C.red, padding: 20 }}>
				Cannot load fleet.json. Start the board with fmlanes --serve.
			</div>,
		),
	);
