export type Link={id:string;title:string;url:string};
export type Ask={key:string;form:string;question?:string;topic?:string;must_decide?:string[];reason:string;choices?:{label:string;effect:string}[];pick?:number;pick_reason?:string;no_pick_reason?:string;effort:string;detail?:string;tickets?:Link[];pull_requests?:Link[];grill_pages?:Link[];waits_on_this?:string;asked:string;answerable:boolean};
export type Lane={id:string;name:string;home:string;secondMate:string;state:string;sourceState?:string;now:string;updatedAt?:string;start?:string;ticket?:Link;invalidAsks?:number;progress?:number;history:{at:string;state:string;text:string}[];asks:Ask[]};
export type Fleet={updatedAt:string;stationLanes:Lane[];hiddenAsks:number;autonomyShare:number;changedLanes:string[]};
export const states=['needs you','waiting','working','done','holding'];
export type Station='ask'|'list'|'fleet'|'lane';
export const stateColors:Record<string,string>={'needs you':'#E5484D',waiting:'#F5C842',working:'#6FA3FF',done:'#3DBE5A',holding:'#8C8C8C'};
// The List: one row per lane that needs you, by its oldest ask. A lane whose oldest ask is quick is in Quick; the rest, a block with no ask too, is in To read.
// The mate filter scopes the List only: each pill counts that second mate's lanes that need you.
export const NO_MATE='no second mate';
export const mateOf=(lane:Lane)=>lane.secondMate||NO_MATE;
export type ListRow={lane:Lane;ask?:Ask;age:number};
const knownTime=(iso:string|undefined)=>{const t=Date.parse(iso||'');return t>0?t:NaN;}; // Go's zero time and a missing time are unknown
const oldestFirst=(a:Ask,b:Ask)=>(knownTime(a.asked)||Infinity)-(knownTime(b.asked)||Infinity);
export function listRows(fleet:Fleet,mate='',now=Date.now()) {
 const need=fleetOrder(fleet).filter(l=>l.state==='needs you'),counts=new Map<string,number>();
 for(const lane of need)counts.set(mateOf(lane),(counts.get(mateOf(lane))??0)+1);
 const rows:ListRow[]=need.filter(l=>!mate||mateOf(l)===mate).map(lane=>{const ask=lane.asks.toSorted(oldestFirst)[0];return {lane,ask,age:Math.max(0,(now-knownTime(ask?.asked??lane.updatedAt))/60000)};});
 return {quick:rows.filter(r=>r.ask?.effort==='quick'),read:rows.filter(r=>r.ask?.effort!=='quick'),mates:[...counts].toSorted((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))};
}
// Ticked lanes that the mate filter hides from the List: they stay ticked and go into the sitting.
export const hiddenTicked=(fleet:Fleet,ticked:ReadonlySet<string>,mate:string)=>mate?fleet.stationLanes.filter(l=>ticked.has(l.id)&&l.state==='needs you'&&mateOf(l)!==mate).length:0;
export const keepNeedingTicks=(fleet:Fleet,ticked:ReadonlySet<string>)=>new Set([...ticked].filter(id=>fleet.stationLanes.some(l=>l.id===id&&l.state==='needs you')));
// An ask's age: one bar segment per day up to a week; from 5.5 days it is overdue, and the sixth and seventh segments are bright and tall.
export const AGE_DAYS=7,OVERDUE_DAYS=5.5;
export const overdue=(minutes:number)=>minutes>=OVERDUE_DAYS*1440;
export const ageDays=(minutes:number)=>Number.isFinite(minutes)?Math.max(1,Math.min(AGE_DAYS,Math.round(minutes/1440))):0;
export const ageTone=(minutes:number)=>minutes<1440?'#7E7468':minutes<3*1440?'#A8906E':overdue(minutes)?'#E6CDA2':'#BF9862'; // tan, never needs-you red
export const ageWords=(minutes:number)=>!Number.isFinite(minutes)?'unknown':minutes<60?`${Math.max(1,Math.round(minutes))} min`:minutes<1440?`${Math.round(minutes/60)} h`:Math.round(minutes/1440)===1?'1 day':`${Math.round(minutes/1440)} days`;
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const elapsed=(minutes:number)=>minutes<60?plural(Math.round(minutes),'minute'):minutes<1440?plural(Math.round(minutes/60),'hour'):plural(Math.round(minutes/1440),'day');
const minutesSince=(iso:string|undefined,now:number)=>Math.max(0,(now-Date.parse(iso||''))/60000);
export const OLD_MINUTES=10;
export const isOld=(updated:string,now=Date.now())=>minutesSince(updated,now)>=OLD_MINUTES;
export function freshness(updated:string,now=Date.now()) {
 const minutes=minutesSince(updated,now);
 return minutes<1?'Live':minutes<OLD_MINUTES?`Updated ${Math.floor(minutes)} min ago`:`Saved ${elapsed(minutes)} ago`;
}
// Lanes in the board's one order: need you (oldest ask first), waiting, working, done, holding.
const oldestAsk=(lane:Lane)=>Math.min(...lane.asks.map(a=>Date.parse(a.asked)).filter(Number.isFinite));
export const fleetOrder=(fleet:Fleet)=>fleet.stationLanes.toSorted((a,b)=>states.indexOf(a.state)-states.indexOf(b.state)||oldestAsk(a)-oldestAsk(b)||a.name.localeCompare(b.name));
// The lanes whose state differs from the reading before: their strip marks light once.
export const stateChanges=(was:Record<string,string>|null,fleet:Fleet)=>was?fleet.stationLanes.filter(l=>l.id in was&&was[l.id]!==l.state).map(l=>l.id):[];
// The summary: row 1 the state, only the need-you numbers bright; row 2 what changed and the share that ran without the user.
export type SummaryPart={k:string;go?:Station|'changed';t:[string,'need'|'n'|''][]};
function needPart(lanes:number,asks:number):SummaryPart {
 const tail:[string,''] =[lanes===1?' lane needs you':' lanes need you',''];
 if(!lanes)return {k:'need',t:[['nothing needs you','need']]};
 return {k:'need',go:'list',t:asks?[[String(asks),'need'],[asks===1?' ask in ':' asks in ',''],[String(lanes),'need'],tail]:[[String(lanes),'need'],tail]};
}
export function boardSummary(fleet:Fleet):SummaryPart[][] {
 const count=(state:string)=>fleet.stationLanes.filter(l=>l.state===state).length,needing=fleet.stationLanes.filter(l=>l.state==='needs you');
 const groups:[string,string][]=[['waiting',' waiting, not on you'],['holding',' holding']];
 const row:SummaryPart[]=[needPart(needing.length,needing.reduce((n,l)=>n+l.asks.length,0))];
 if(needing.length)row.push({k:'rest',t:[['nothing else needs you','']]});
 row.push({k:'working',go:'fleet',t:[[String(count('working')),'n'],[' working','']]});
 for(const [state,words] of groups)if(count(state))row.push({k:state,go:'fleet',t:[[String(count(state)),'n'],[words,'']]});
 const changed=fleet.changedLanes?.length||0,since:SummaryPart[]=[];
 if(changed)since.push({k:'changed',go:'changed',t:[[`${plural(changed,'lane')} changed since your last look`,'']]});
 since.push({k:'auto',t:[[`${Math.round(fleet.autonomyShare*100)}% ran without you`,'']]});
 if(fleet.hiddenAsks)since.push({k:'old',t:[[`${plural(fleet.hiddenAsks,'ask')} older than 7 days hidden`,'']]});
 return [row,since];
}
// Find lane: every word typed is a part of the name; the holding lanes are in reach too.
export const FIND_LIMIT=6;
export function findLanes(fleet:Fleet,query:string) {
 const words=query.toLowerCase().split(/\s+/).filter(Boolean);
 const all=words.length?fleetOrder(fleet).filter(l=>words.every(w=>l.name.toLowerCase().includes(w))):[];
 return {rows:all.slice(0,FIND_LIMIT),n:all.length};
}
export const findFoot=(query:string,shown:number,n:number)=>!query.trim()?'esc closes':!n?'No lane has this name.':`${n>shown?`${shown} of ${n} lanes · type more to narrow · `:''}↑ ↓ choose · enter opens the lane · esc closes`;
// Go sends its zero time (year 1) for a lane with no status time; that and a missing time read as unknown.
export const laneWords=(lane:Lane,now=Date.now())=>`${lane.asks.length?`${plural(lane.asks.length,'ask')} · `:''}last word ${Date.parse(lane.updatedAt||'')>0?`${elapsed(minutesSince(lane.updatedAt,now))} ago`:'time unknown'}`;
