import React from "react";
import {
	AGE_DAYS,
	ageDays,
	ageTone,
	ageWords,
	hiddenTicked,
	listRows,
	overdue,
	type Fleet,
	type ListRow,
} from "./stations";

type ListProps = {
	fleet: Fleet;
	mate: string;
	setMate: (mate: string) => void;
	ticked: ReadonlySet<string>;
	tick: (id: string) => void;
	selected: string;
	select: (id: string) => void;
	openLane: (id: string) => void;
	decide: () => void;
};
// The List's columns; the fourth is the lane's count of open asks.
const COLS = ["Waiting", "", "Lane", "Asks", "Its oldest ask"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A block with no ask shows the crew's last word, said as a block.
const question = ({ lane, ask }: ListRow) =>
	ask
		? ask.question || ask.topic || ask.key
		: /^blocked\b/i.test(lane.now)
			? lane.now
			: `Blocked: ${lane.now || "the crew cannot clear it"}`;

// One segment per day; an overdue day is bright and tall.
function AgeBar({ age }: { age: number }) {
	const days = ageDays(age);
	return (
		<span className="agebar" aria-hidden>
			{Array.from({ length: AGE_DAYS }, (_, i) => (
				<i
					key={i}
					className={i < days && i >= 5 ? "od" : undefined}
					style={{
						background: i >= days ? "#2A2630" : i >= 5 ? "#FF9900" : ageTone(age),
					}}
				/>
			))}
		</span>
	);
}
function Row(p: { row: ListRow } & Omit<ListProps, "fleet" | "mate" | "setMate" | "decide">) {
	const { lane, ask } = p.row,
		on = p.ticked.has(lane.id),
		words = ageWords(p.row.age),
		late = overdue(p.row.age);
	// Space ticks the lane from the row as from its box; Enter and a click open the lane.
	const key = (e: React.KeyboardEvent) => {
		if (e.key !== " ") return;
		e.preventDefault();
		if (e.type === "keydown" && !e.repeat) p.tick(lane.id);
	};
	return (
		<div className={`lrow${lane.id === p.selected ? " sel" : ""}`}>
			<label className="tk">
				<input
					type="checkbox"
					className="tick"
					checked={on}
					onChange={() => p.tick(lane.id)}
					onFocus={() => p.select(lane.id)}
					aria-label={`Tick ${lane.name} to decide it in the Ask station`}
				/>
			</label>
			<button
				className="cols"
				onClick={() => p.openLane(lane.id)}
				onFocus={() => p.select(lane.id)}
				onKeyDown={key}
				onKeyUp={key}
				aria-label={`${lane.name}${on ? ", ticked" : ""}: ${plural(lane.asks.length, "ask")}, waiting ${words}${late ? ", overdue" : ""}. ${question(p.row)}`}
			>
				<AgeBar age={p.row.age} />
				<span className="a">{words}</span>
				<span className="n">{lane.name}</span>
				<span className="m">{lane.asks.length}</span>
				<span className="q2">
					{question(p.row)}
					{!!lane.invalidAsks && <em> · {lane.invalidAsks} malformed asks omitted</em>}
				</span>
			</button>
		</div>
	);
}
// Every lane that needs you: a decision or a block the crew cannot clear, grouped Quick and To read.
export function ListStation(p: ListProps) {
	const { quick, read, mates } = listRows(p.fleet, p.mate),
		hidden = hiddenTicked(p.fleet, p.ticked, p.mate),
		pills = p.mate && !mates.some(([m]) => m === p.mate) ? [...mates, [p.mate, 0] as [string, number]] : mates,
		most = [...quick, ...read].reduce<ListRow | undefined>((top, r) => (r.lane.asks.length > (top?.lane.asks.length ?? 0) ? r : top), undefined),
		unlisted = p.fleet.stationLanes.filter((l) => l.state !== "needs you").reduce((n, l) => n + (l.invalidAsks || 0), 0);
	const group = (label: string, rows: ListRow[]) =>
		rows.length > 0 && (
			<section aria-label={label}>
				<div className="grp">
					<span className="lab">
						{label} · {plural(rows.length, "lane")}
					</span>
				</div>
				{rows.map((row) => (
					<Row key={row.lane.id} row={row} {...p} />
				))}
			</section>
		);
	return (
		<div className="lst">
			<style>{LIST_CSS}</style>
			<div className="vtitle">
				<h2 className="lab">Every lane that needs you</h2>
				<span className="sp" />
				<span>
					{["a number: open asks", most && `most: ${most.lane.name} ${most.lane.asks.length}`, unlisted && `${unlisted} malformed asks omitted in other lanes`]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</div>
			<div className="lfilter" role="group" aria-label="Second mate">
				<span className="lab">Second mate</span>
				<button className={p.mate ? "" : "on"} aria-pressed={!p.mate} onClick={() => p.setMate("")}>
					all
				</button>
				{pills.map(([m, n]) => (
					<button key={m} className={p.mate === m ? "on" : ""} aria-pressed={p.mate === m} onClick={() => p.setMate(m)}>
						{m} <b>{n}</b>
					</button>
				))}
				{p.ticked.size > 0 && (
					<span className="go">
						<button className="link act" onClick={p.decide}>
							decide {p.ticked.size} ticked {p.ticked.size === 1 ? "lane" : "lanes"} in the Ask station
						</button>
						{hidden > 0 && <span className="hid">{hidden} hidden by the filter</span>}
					</span>
				)}
			</div>
			<div className="lrow lhead" aria-hidden>
				<i />
				<div className="cols">
					{COLS.map((c, i) => (
						<span key={i}>{c}</span>
					))}
				</div>
			</div>
			{group("Quick", quick)}
			{group("To read", read)}
			{!quick.length && !read.length && (
				<p className="big">{mates.length ? "No lane of this second mate needs you." : "Nothing needs you."}</p>
			)}
		</div>
	);
}
// D's List, scoped to the station; the frame owns tokens and geometry.
const LIST_CSS = `
.lst{display:flex;flex-direction:column}
.lst .vtitle{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;margin:12px 0 2px;color:var(--dim);font-size:15.5px}.lst .vtitle .lab{color:var(--text);font-size:17px;margin:0}.lst .vtitle .sp{flex:1}
.lst .grp{margin:7px 0 2px;color:var(--dim);font-size:15px;display:flex;gap:12px;align-items:baseline}.lst .grp .lab{color:var(--text)}
.lst .lfilter{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 6px;color:var(--dim);font-size:14.5px}.lst .lfilter .lab{margin-right:6px}
.lst .lfilter>button{min-height:26px;padding:0 10px;border:1.5px solid #4A434E;border-radius:999px;color:var(--dim);background:none;font-size:14.5px}.lst .lfilter>button.on{color:#FFF4DC;border-color:#FFF4DC}.lst .lfilter b{font-weight:600}
.lst .go{margin-left:auto;display:flex;align-items:center;gap:12px}.lst .go .hid{color:var(--dim)}
.lst .link.act{color:#CDBFAE;background:none;border:1.5px solid #5E5560;border-radius:999px;padding:7px 16px}
.lst .lrow{display:grid;grid-template-columns:15px 1fr;gap:0 14px;align-items:center;width:100%;padding:1px 10px;min-height:21px;border-radius:4px;box-shadow:inset 0 -1px 0 #17141B;font-size:16.5px;line-height:1.24}
.lst .cols{display:grid;grid-template-columns:74px 62px 230px 60px 1fr;gap:0 14px;align-items:center;width:100%;padding:0;border:0;border-radius:0;background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.lst .cols span{overflow-wrap:anywhere}.lst .lrow .a,.lst .lrow .m{color:var(--dim);white-space:nowrap}.lst .lrow .n{font-weight:400}.lst .lrow.sel .n{font-weight:600}
.lst .lrow .q2{color:var(--dim);max-width:86ch;line-height:1.22}.lst .q2 em{font-style:normal;color:#E9A35A}.lst .lrow.sel .q2{color:#FFF4DC}
.lst section .lrow:nth-of-type(even){background:#0E0C11}.lst .lrow:hover,.lst .lrow.sel{background:#1D1921}
.lst .lhead{min-height:18px;box-shadow:inset 0 -1px 0 #3A3440;color:#B8AB9B;font:600 13px/1 var(--lab);letter-spacing:.1em;text-transform:uppercase}.lst .lhead .cols{cursor:default}
.lst .tk{display:flex;align-items:center;align-self:stretch;cursor:pointer}
.lst .tick{appearance:none;margin:0;width:15px;height:15px;border:1.5px solid #6B6272;border-radius:3px;background:none;cursor:pointer}.lst .tick:checked{background:#FFCC99;border-color:#FFCC99;box-shadow:inset 0 0 0 2.5px #000}.lst .tick:focus-visible{outline:2px solid var(--peach);outline-offset:2px}
.lst .agebar{display:inline-flex;gap:2px;align-items:center}.lst .agebar i{width:7px;height:8px;border-radius:1px}.lst .agebar i.od{height:14px}
.lst .big{font:500 36px/1.16 var(--body);margin:30px 0 0}
@media (max-width:760px){
.lst .lhead{display:none}.lst .lrow{grid-template-columns:30px 1fr;gap:0 4px;padding:8px 4px}.lst .tick{width:22px;height:22px}
.lst .cols{grid-template-columns:62px 1fr auto;gap:2px 10px}.lst .lrow .a{display:none}.lst .lrow .m{text-align:right}.lst .lrow .q2{grid-column:1 / 4}
.lst .go{margin-left:0;flex-basis:100%;flex-wrap:wrap}.lst .link.act{padding:11px 12px;white-space:normal}.lst .lfilter>button{min-height:36px}.lst .big{font-size:27px}
}`;
