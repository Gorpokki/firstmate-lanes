import type {Ask,Fleet} from './stations';

export type SittingAnswer={lane:string;key:string;kind:'choice'|'own'|'skip'|'grill';choice?:number;text?:string;asked:string};
export type DeliveryResult={lane:string;key:string;accepted:boolean;reason:string};
export type SittingItem={lane:Fleet['stationLanes'][number];ask:Ask;ref:string;round:number};
export type ReviewRow={lane:string;key:string;question:string;answer:string};

const refFor=(lane:string,key:string)=>`${lane}\0${key}`;
const effortRank=(ask:Ask)=>ask.effort==='quick'?0:1;
const askedAt=(ask:Ask)=>{const time=Date.parse(ask.asked);return Number.isFinite(time)?time:0;};
export const readOnlyReason=(lane:Fleet['stationLanes'][number],ask:Ask)=>ask.answerable?'':lane.home==='local'&&!lane.secondMate?'Local drop-in lanes have no owning home, so this ask cannot be answered here.':'This ask has no verifiable task ID, so it cannot be answered here.';

export function buildSitting(fleet:Fleet,selectedLaneIds?:string[],deferred:ReadonlySet<string>=new Set()):SittingItem[]{
 const selected=selectedLaneIds?new Set(selectedLaneIds):undefined;
 const lanes=fleet.stationLanes.filter(lane=>!selected||selected.has(lane.id)).toSorted((a,b)=>a.secondMate.localeCompare(b.secondMate)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const ordered=lanes.map(lane=>({lane,asks:lane.asks.filter(ask=>ask.answerable&&!deferred.has(refFor(lane.id,ask.key))).toSorted((a,b)=>effortRank(a)-effortRank(b)||askedAt(a)-askedAt(b))}));
 const result:SittingItem[]=[];
 for(let round=0;round<4;round++)for(const {lane,asks} of ordered){
  const ask=asks[round];
  if(ask)result.push({lane,ask,ref:refFor(lane.id,ask.key),round});
 }
 return result.toSorted((a,b)=>effortRank(a.ask)-effortRank(b.ask)||a.lane.secondMate.localeCompare(b.lane.secondMate)||a.round-b.round||askedAt(a.ask)-askedAt(b.ask)||a.lane.name.localeCompare(b.lane.name)||a.ask.key.localeCompare(b.ask.key)).slice(0,4);
}

export function answerFor(item:SittingItem,kind:SittingAnswer['kind'],choice?:number,text?:string):SittingAnswer{
 return {lane:item.lane.id,key:item.ask.key,kind,asked:item.ask.asked,...(kind==='choice'&&choice!==undefined?{choice}:{}),...(kind==='own'&&text!==undefined?{text}:{})};
}

export function deferForLater(fleet:Fleet,refs:readonly string[]):SittingItem[]{
 const deferred=new Set(refs);
 return fleet.stationLanes.flatMap(lane=>lane.asks.filter(ask=>deferred.has(refFor(lane.id,ask.key))).map(ask=>({lane,ask,ref:refFor(lane.id,ask.key),round:0})));
}

// One batch: send only once every ask still in the sitting has a choice, own answer, skip or grill. Deferred asks have left the sitting.
export const unansweredCount=(items:readonly SittingItem[],answers:Readonly<Record<string,SittingAnswer>>)=>items.filter(item=>!answers[item.ref]).length;
export const batchReady=(items:readonly SittingItem[],answers:Readonly<Record<string,SittingAnswer>>)=>items.length>0&&unansweredCount(items,answers)===0;

export function undoAnswer(answers:Record<string,SittingAnswer>,ref:string):Record<string,SittingAnswer>{
 const next={...answers};
 delete next[ref];
 return next;
}
export function reviewAnswers(fleet:Fleet,answers:SittingAnswer[]):ReviewRow[]{
 return answers.flatMap(answer=>{
  const lane=fleet.stationLanes.find(item=>item.id===answer.lane),ask=lane?.asks.find(item=>item.key===answer.key);
  if(!lane||!ask)return [];
  const question=ask.question||ask.topic||ask.key;
  const response=answer.kind==='choice'?ask.choices?.[answer.choice??-1]?.label||`Choice ${answer.choice}`:answer.kind==='own'?answer.text||'Own answer':answer.kind==='skip'?'Crew decides':'Grill requested';
  return [{lane:lane.name,key:ask.key,question,answer:response}];
 });
}

// The lanes whose every ask has an answer in this sitting: their fleet strip mark is hollow.
export const answeredLanes=(fleet:Fleet,answers:Readonly<Record<string,SittingAnswer>>)=>fleet.stationLanes.filter(lane=>lane.asks.length>0&&lane.asks.every(ask=>answers[refFor(lane.id,ask.key)])).map(lane=>lane.id);

// An ask's age bar: one segment per day up to a week. A day past 5.5 days is overdue (bright and tall); past a week one end cap says it.
export const OVERDUE_DAYS=5.5,AGE_DAYS=7;
export const minutesSince=(iso:string,now=Date.now())=>{const time=Date.parse(iso);return Number.isFinite(time)&&time>0?Math.max(0,(now-time)/60000):Number.NaN;};
export function ageWords(minutes:number){
 if(!Number.isFinite(minutes))return 'time unknown';
 if(minutes<60)return `${Math.max(1,Math.round(minutes))} min`;
 if(minutes<1440)return `${Math.round(minutes/60)} h`;
 const days=Math.round(minutes/1440);
 return days===1?'1 day':`${days} days`;
}
export function ageBar(minutes:number){
 const days=minutes/1440,lit=Math.max(1,Math.min(AGE_DAYS,Math.round(days)));
 const color=days<1?'#7E7468':days<3?'#A8906E':days<OVERDUE_DAYS?'#BF9862':'#E6CDA2';
 return {segments:Array.from({length:AGE_DAYS},(_,i)=>i>=lit?'off':i>=5?'overdue':'on'),color,overdue:days>=OVERDUE_DAYS,past:Math.round(days)>AGE_DAYS};
}
