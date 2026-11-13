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
