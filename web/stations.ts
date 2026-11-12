export type Link={id:string;title:string;url:string};
export type Ask={key:string;form:string;question?:string;topic?:string;must_decide?:string[];reason:string;choices?:{label:string;effect:string}[];pick?:number;pick_reason?:string;no_pick_reason?:string;effort:string;detail?:string;tickets?:Link[];pull_requests?:Link[];grill_pages?:Link[];waits_on_this?:string;asked:string;answerable:boolean};
export type Lane={id:string;name:string;home:string;secondMate:string;state:string;sourceState?:string;now:string;updatedAt?:string;start?:string;ticket?:Link;invalidAsks?:number;progress?:number;history:{at:string;state:string;text:string}[];asks:Ask[]};
export type Fleet={updatedAt:string;stationLanes:Lane[];hiddenAsks:number;autonomyShare:number;changedLanes:string[]};
export const states=['needs you','waiting','working','done','holding'];
export type Station='ask'|'list'|'fleet'|'lane';
export function deriveBoard(fleet:Fleet,mate='') {
 const oldest=(lane:Lane)=>Math.min(...lane.asks.map(a=>Date.parse(a.asked)));
 const rows=fleet.stationLanes.filter(l=>!mate||l.secondMate===mate).toSorted((a,b)=>states.indexOf(a.state)-states.indexOf(b.state)||(a.state==='needs you'?oldest(a)-oldest(b):0)||a.id.localeCompare(b.id));
 const needs=fleet.stationLanes.filter(l=>l.state==='needs you').length;
 const asks=fleet.stationLanes.reduce((n,l)=>n+l.asks.length,0);
 return {rows,summary:`${needs} lanes need you · ${asks} asks · ${Math.round(fleet.autonomyShare*100)}% autonomy · ${(fleet.changedLanes||[]).length} changed`,mates:[...new Set(fleet.stationLanes.map(l=>l.secondMate).filter(Boolean))].sort()};
}
export function freshness(updated:string,now=Date.now()) {
 const age=Math.max(0,now-Date.parse(updated));
 return age<60000?'Live':`Updated ${Math.floor(age/60000)} min ago`;
}
