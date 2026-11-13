export type Link={id:string;title:string;url:string};
export type Ask={key:string;form:string;question?:string;topic?:string;must_decide?:string[];reason:string;choices?:{label:string;effect:string}[];pick?:number;pick_reason?:string;no_pick_reason?:string;effort:string;detail?:string;tickets?:Link[];pull_requests?:Link[];grill_pages?:Link[];waits_on_this?:string;asked:string;answerable:boolean};
export type Lane={id:string;name:string;home:string;secondMate:string;state:string;sourceState?:string;now:string;updatedAt?:string;start?:string;ticket?:Link;invalidAsks?:number;progress?:number;history:{at:string;state:string;text:string}[];asks:Ask[]};
export type Fleet={updatedAt:string;stationLanes:Lane[];hiddenAsks:number;autonomyShare:number;changedLanes:string[]};
export const states=['needs you','waiting','working','done','holding'];
export type Station='ask'|'list'|'fleet'|'lane';
export const stateColors:Record<string,string>={'needs you':'#E5484D',waiting:'#F5C842',working:'#6FA3FF',done:'#3DBE5A',holding:'#8C8C8C'};
export function deriveBoard(fleet:Fleet,mate='') {
 const rows=fleet.stationLanes.filter(l=>!mate||l.secondMate===mate);
 return {rows,mates:[...new Set(fleet.stationLanes.map(l=>l.secondMate).filter(Boolean))].sort()};
}
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
export const laneWords=(lane:Lane,now=Date.now())=>`${lane.asks.length?`${plural(lane.asks.length,'ask')} · `:''}last word ${lane.updatedAt?`${elapsed(minutesSince(lane.updatedAt,now))} ago`:'time unknown'}`;
