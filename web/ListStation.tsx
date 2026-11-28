import React from "react";
import {
	AGE_DAYS,
	ageDays,
	ageTone,
	ageWords,
	hiddenTicked,
	listQuestion,
	listRows,
	overdue,
	returnedOnly,
	unknownWhy,
	type Fleet,
	type ListRow,
} from "./stations";

type ListProps = {
	fleet: Fleet;
	hidden: ReadonlySet<string>;
	setHidden: (hidden: ReadonlySet<string>) => void;
	ticked: ReadonlySet<string>;
	tick: (id: string) => void;
	selected: string;
	select: (id: string) => void;
	openLane: (id: string) => void;
	decide: () => void;
};
// The List's columns, each over its own values; the squares' key shows beside the title and in the age header's tooltip.
const AGE_KEY = "How long the lane's oldest ask has waited for you. One square per day; orange and tall from 5.5 days: overdue.";
const COLS: [string, string?][] = [["Waiting on you", AGE_KEY], ["Lane"], ["Asks", "Open asks on the lane"], ["Oldest ask"]];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// One segment per day; an overdue day is bright and tall. The List and the Ask card both draw it.
export function AgeBar({ minutes }: { minutes: number }) {
	const days = ageDays(minutes);
	return (
		<span className="agebar" role="img" aria-label={overdue(minutes) ? "Overdue" : "Age"}>
			{Array.from({ length: AGE_DAYS }, (_, i) => (
				<i
					key={i}
					className={i < days && i >= 5 ? "od" : undefined}
					style={{
						background: i >= days ? "#2A2630" : i >= 5 ? "#FF9900" : ageTone(minutes),
					}}
				/>
			))}
		</span>
	);
}
// Inside its second mate's group a lane drops that mate's prefix from its name.
const shortName = ({ name, secondMate }: ListRow["lane"]) =>
	secondMate && name.startsWith(`${secondMate}/`) ? name.slice(secondMate.length + 1) : name;
function Row(p: { row: ListRow } & Omit<ListProps, "fleet" | "hidden" | "setHidden" | "decide">) {
	const { lane, ask } = p.row,
		on = p.ticked.has(lane.id),
		why = unknownWhy(p.row),
		words = ageWords(p.row.age),
		late = overdue(p.row.age),
		question = listQuestion(p.row),
		name = shortName(lane),
		quick = ask?.effort === "quick",
		omitted = !!lane.invalidAsks && !returnedOnly(lane) ? `${lane.invalidAsks} malformed asks omitted` : "",
		full = [omitted, question].filter(Boolean).join(" · ");
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
				aria-label={`${lane.name}${on ? ", ticked" : ""}: ${plural(lane.asks.length, "ask")}, waiting ${words}${why && `: ${why}`}${late ? ", overdue" : ""}. ${quick ? "Quick ask: " : ""}${full}`}
			>
				<span className="a">
					<AgeBar minutes={p.row.age} />
					<span>
						{words}
						{late && <b className="od"> overdue</b>}
						{why && <small>{why}</small>}
					</span>
				</span>
				<span className="n" title={lane.name}>
					{name}
				</span>
				<span className="m">{lane.asks.length || "–"}</span>
				<span className="q2" title={full}>
					{quick && <span className="qk">quick</span>}
					{omitted && <em>{omitted} · </em>}
					{question}
				</span>
			</button>
		</div>
	);
}
// Every lane that needs you: a decision or a block the crew cannot clear, grouped by second mate.
export function ListStation(p: ListProps) {
	const { groups, mates } = listRows(p.fleet, p.hidden),
		hidden = hiddenTicked(p.fleet, p.ticked, p.hidden),
		total = mates.reduce((n, [, c]) => n + c, 0),
		shown = groups.reduce((n, [, rows]) => n + rows.length, 0),
		unlisted = p.fleet.stationLanes.filter((l) => l.state !== "needs you").reduce((n, l) => n + (l.invalidAsks || 0), 0);
	const flip = (mate: string) => {
		const next = new Set(p.hidden);
		if (!next.delete(mate)) next.add(mate);
		p.setHidden(next);
	};
	return (
		<div className="lst">
			<style>{LIST_CSS}</style>
			<div className="vtitle">
				<h2 className="lab">Every lane that needs you</h2>
				<span className="sp" />
				<span className="key">Squares: one per day waited · orange: overdue</span>
				{!!unlisted && <span>{unlisted} malformed asks omitted in other lanes</span>}
			</div>
			<div className="lfilter" role="group" aria-label="Second mate">
				<span className="lab">Second mate</span>
				{mates.map(([m, n]) => (
					<button key={m} className={p.hidden.has(m) ? "off" : ""} aria-pressed={!p.hidden.has(m)} onClick={() => flip(m)}>
						{m} <b>{n}</b>
					</button>
				))}
				{shown < total && (
					<span className="shown">
						Showing {shown} of {total} lanes ·{" "}
						<button className="link" onClick={() => p.setHidden(new Set())}>
							show all
						</button>
					</span>
				)}
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
					{COLS.map(([c, tip]) => (
						<span key={c} title={tip}>
							{c}
						</span>
					))}
				</div>
			</div>
			{groups.map(([mate, rows]) => (
				<section key={mate} aria-label={mate}>
					<div className="grp">
						<span className="lab">{mate}</span>
					</div>
					{rows.map((row) => (
						<Row key={row.lane.id} row={row} {...p} />
					))}
				</section>
			))}
			{!shown && <p className="big">{total ? "The filter hides every lane that needs you." : "Nothing needs you."}</p>}
		</div>
	);
}
// D's List, scoped to the station; the frame owns tokens and geometry. Cells hold one line; the selected row shows the whole text.
const LIST_CSS = `
.lst{display:flex;flex-direction:column}
.lst .vtitle{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;margin:12px 0 2px;color:var(--dim);font-size:15.5px}.lst .vtitle .lab{color:var(--text);font-size:17px;margin:0}.lst .vtitle .sp{flex:1}
.lst .grp{margin:9px 0 2px;color:var(--dim);font-size:15px;display:flex;gap:12px;align-items:baseline}.lst .grp .lab{color:var(--text)}
.lst .lfilter{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 6px;color:var(--dim);font-size:14.5px}.lst .lfilter .lab{margin-right:6px}
.lst .lfilter>button{min-height:26px;padding:0 10px;border:1.5px solid #FFF4DC;border-radius:999px;color:#FFF4DC;background:none;font-size:14.5px}.lst .lfilter>button.off{color:var(--dim);border-color:#4A434E;text-decoration:line-through}.lst .lfilter b{font-weight:600}
.lst .shown .link{background:none;border:0;padding:0;color:#CDBFAE;text-decoration:underline;font:inherit;cursor:pointer}
.lst .go{margin-left:auto;display:flex;align-items:center;gap:12px}.lst .go .hid{color:var(--dim)}
.lst .link.act{color:#CDBFAE;background:none;border:1.5px solid #5E5560;border-radius:999px;padding:7px 16px}
.lst .lrow{display:grid;grid-template-columns:15px 1fr;gap:0 14px;align-items:center;width:100%;padding:1px 10px;min-height:21px;border-radius:4px;box-shadow:inset 0 -1px 0 #17141B;font-size:16.5px;line-height:1.24}
.lst .cols{display:grid;grid-template-columns:176px 260px 44px 1fr;gap:0 14px;align-items:center;width:100%;padding:0;border:0;border-radius:0;background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.lst .cols>span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lst .lrow.sel .n,.lst .lrow.sel .q2{white-space:normal;overflow-wrap:anywhere}
.lst .lrow .a{display:flex;align-items:center;gap:8px;color:var(--dim)}.lst .lrow .m{color:var(--dim)}.lst .lrow .n{font-weight:400}.lst .lrow.sel .n{font-weight:600}
.lst .lrow .od{font-weight:600;color:#FF9900}.lst .lrow .qk{color:#B8AB9B;border:1px solid #4A434E;border-radius:4px;padding:0 4px;margin-right:6px;font-size:13px}
.lst .lrow .q2{color:var(--dim);line-height:1.22}.lst .lrow .a small{display:block;font-size:12.5px;line-height:1.1}.lst .q2 em{font-style:normal;color:#E9A35A}.lst .lrow.sel .q2{color:#FFF4DC}
.lst section .lrow:nth-of-type(even){background:#0E0C11}.lst .lrow:hover,.lst .lrow.sel{background:#1D1921}
.lst .lhead{min-height:18px;box-shadow:inset 0 -1px 0 #3A3440;color:#B8AB9B;font:600 13px/1 var(--lab);letter-spacing:.1em;text-transform:uppercase}.lst .lhead .cols{cursor:default}.lst .lhead [title]{cursor:help}
.lst .tk{display:flex;align-items:center;align-self:stretch;cursor:pointer}
.lst .tick{appearance:none;margin:0;width:15px;height:15px;border:1.5px solid #6B6272;border-radius:3px;background:none;cursor:pointer}.lst .tick:checked{background:#FFCC99;border-color:#FFCC99;box-shadow:inset 0 0 0 2.5px #000}.lst .tick:focus-visible{outline:2px solid var(--peach);outline-offset:2px}
.lst .agebar{display:inline-flex;gap:2px;align-items:center}.lst .agebar i{width:7px;height:8px;border-radius:1px}.lst .agebar i.od{height:14px}
.lst .big{font:500 36px/1.16 var(--body);margin:30px 0 0}
@media (max-width:760px){
.lst .lhead{display:none}.lst .lrow{grid-template-columns:30px 1fr;gap:0 4px;padding:8px 4px}.lst .tick{width:22px;height:22px}
.lst .cols{grid-template-columns:auto 1fr auto;gap:2px 10px}.lst .lrow .agebar,.lst .vtitle .key{display:none}.lst .lrow .m{text-align:right}.lst .lrow .q2{grid-column:1 / 4}
.lst .go{margin-left:0;flex-basis:100%;flex-wrap:wrap}.lst .link.act{padding:11px 12px;white-space:normal}.lst .lfilter>button{min-height:36px}.lst .big{font-size:27px}
}`;
