import React,{useEffect,useRef,useState} from 'react';
import type {Fleet,Link} from './stations';
import {assignedShip,type ShipMesh} from './mesh-catalog';
import {Holo} from './Holo';
import {answerFor,buildSitting,deferForLater,reviewAnswers,undoAnswer,type DeliveryResult,type SittingAnswer,type SittingItem} from './sitting';

export type {DeliveryResult,SittingAnswer} from './sitting';
type AskStationProps={fleet:Fleet;active:boolean;selectedLaneIds?:string[];hiddenSelected:number;meshes?:ShipMesh[];onBack:()=>void;onConfirm?:(answers:SittingAnswer[])=>Promise<DeliveryResult[]>};
const askQuestion=(item:SittingItem)=>item.ask.question||item.ask.topic||item.ask.key;
const isEditing=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable=true]');

export function AskStation({fleet,active,selectedLaneIds,hiddenSelected,meshes,onBack,onConfirm}:AskStationProps){
 const [items,setItems]=useState<SittingItem[]>([]),[index,setIndex]=useState(0),[answers,setAnswers]=useState<Record<string,SittingAnswer>>({}),[ownText,setOwnText]=useState<Record<string,string>>({}),[later,setLater]=useState<SittingItem[]>([]),[delivery,setDelivery]=useState<DeliveryResult[]|null>(null),[sending,setSending]=useState(false),[error,setError]=useState(''),ownRef=useRef<HTMLTextAreaElement>(null);
 const item=items[index],answerList=Object.values(answers),reviewed=answerList.filter(answer=>reviewAnswers(fleet,[answer]).length>0),reviews=reviewAnswers(fleet,reviewed),linkGroups:[string,Link[]][]=item?[['Tickets',item.ask.tickets||[]],['Pull requests',item.ask.pull_requests||[]],['Grill pages',item.ask.grill_pages||[]]]:[];
 const ship=item?assignedShip(item.lane.id,meshes):undefined;
 useEffect(()=>{if(active&&!answerList.length&&!later.length&&!delivery&&!Object.values(ownText).some(Boolean)){setItems(buildSitting(fleet,selectedLaneIds));setIndex(0);}},[active]);
 useEffect(()=>{if(!item||!active)return;const key=(event:KeyboardEvent)=>{if(event.key.toLowerCase()==='o'&&!event.repeat&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!isEditing(event.target)){event.preventDefault();ownRef.current?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[item?.ref,active]);
 const save=(value:SittingAnswer)=>{if(sending||delivery)return;setAnswers(old=>({...old,[item!.ref]:value}));setDelivery(null);};
 const defer=()=>{if(sending||delivery||later.some(entry=>entry.ref===item!.ref))return;setAnswers(old=>{const next={...old};delete next[item!.ref];return next;});setLater(old=>[...old,...deferForLater(fleet,[item!.ref])]);setItems(old=>old.filter(entry=>entry.ref!==item!.ref));setIndex(value=>Math.max(0,Math.min(value,items.length-2)));};
 const startLater=()=>{setItems(later);setLater([]);setIndex(0);setAnswers({});setOwnText({});setDelivery(null);setError('');};
 const startNext=()=>{setItems(buildSitting(fleet,selectedLaneIds));setLater([]);setIndex(0);setAnswers({});setOwnText({});setDelivery(null);setError('');};
 const confirm=async()=>{if(!onConfirm||sending||!reviewed.length)return;setSending(true);setError('');try{setDelivery(await onConfirm(reviewed));}catch(e){setError(e instanceof Error?e.message:'Could not send answers.');}finally{setSending(false);}};
 const startTime=Date.parse(item?.ask.asked||''),known=Number.isFinite(startTime)&&startTime>0,waited=known?Math.max(0,Date.now()-startTime):0,readOnlyCount=fleet.stationLanes.filter(lane=>!selectedLaneIds||selectedLaneIds.includes(lane.id)).reduce((n,lane)=>n+lane.asks.filter(ask=>!ask.answerable).length,0),waitText=waited<3600000?`${Math.floor(waited/60000)} minutes`:waited<86400000?`${Math.floor(waited/3600000)} hours`:`${Math.floor(waited/86400000)} days`;
 return <section aria-label="Ask sitting" hidden={!active} style={{maxWidth:900,margin:'auto'}}>
  <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h1>Ask</h1><button onClick={onBack}>Back</button></header>
  {hiddenSelected>0&&<p>{hiddenSelected} ticked lane(s) hidden by the mate filter are included.</p>}
  {item?<>
   <p>Ask {index+1} of {items.length} · {item.lane.secondMate}</p>
   <style>{'.ask-layout{display:grid;gap:20px}@media(min-width:800px){.ask-layout{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:start}}'}</style>
   <div className="ask-layout">
   <article aria-label={`${item.lane.name}: ${askQuestion(item)}`}>
    <p>{item.lane.name} · {item.lane.secondMate}</p><h2>{askQuestion(item)}</h2><p>{item.ask.reason}</p>
    {item.ask.form==='discussion'&&<><h3>Must decide</h3><ul aria-label="Must decide">{item.ask.must_decide?.map((decision,index)=><li key={`${index}-${decision}`}>{decision}</li>)}</ul><button onClick={()=>save(answerFor(item,'grill'))}>Ask for grill</button></>}
    {item.ask.choices?.map((choice,choiceIndex)=>{const pick=item.ask.pick===choiceIndex,suggestion=item.ask.pick===undefined&&choiceIndex===0;return <div key={`${choiceIndex}-${choice.label}`} style={{border:'1px solid #596171',padding:10,margin:'8px 0',borderRadius:8}}><button aria-pressed={answers[item.ref]?.kind==='choice'&&answers[item.ref]?.choice===choiceIndex} onClick={()=>save(answerFor(item,'choice',choiceIndex))}>{choice.label} — {choice.effect}</button>{pick&&<p>Crew pick{item.ask.pick_reason?` — ${item.ask.pick_reason}`:''}</p>}{suggestion&&<p>Board suggestion: first listed (board ordering fallback)</p>}</div>;})}{item.ask.pick===undefined&&item.ask.no_pick_reason&&<p>Crew gave no pick: {item.ask.no_pick_reason}</p>}
    <label>Own answer <textarea ref={ownRef} value={ownText[item.ref]||''} onChange={event=>setOwnText(old=>({...old,[item.ref]:event.target.value}))}/></label><button disabled={!ownText[item.ref]?.trim()} onClick={()=>save(answerFor(item,'own',undefined,ownText[item.ref]))}>Use own answer</button>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}><button onClick={()=>save(answerFor(item,'skip'))}>Skip — crew decides and reports in its next status line</button>{item.ask.form!=='discussion'&&<button onClick={()=>save(answerFor(item,'grill'))}>Ask for grill</button>}<button onClick={defer}>Defer</button>{answers[item.ref]&&<button onClick={()=>{if(!sending&&!delivery)setAnswers(old=>undoAnswer(old,item.ref));}}>Undo answer</button>}</div>
    <details><summary>Details, links and waiting impact</summary>{item.ask.detail&&<p>{item.ask.detail}</p>}<p>Waiting on {item.ask.waits_on_this||'no dependency stated'} · {known?`asked ${waitText} ago`:'asked time unknown'}</p>{linkGroups.map(([label,links])=><div key={label}><strong>{label}</strong><ul>{links.map(link=><li key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a></li>)}</ul></div>)}</details>
   </article>
   {active&&<Holo mesh={ship?.mesh} state={item.lane.state} progress={item.lane.progress} name={ship?.name||'No admitted ship'} options={{blocks:/block/i.test(item.lane.sourceState||''),fragments:/failed|error/i.test(item.lane.sourceState||'')?1:0}}/>}
   </div>
   <nav aria-label="Sitting navigation" style={{display:'flex',gap:8,margin:'16px 0'}}><button disabled={!index} onClick={()=>setIndex(value=>value-1)}>Previous ask</button><button disabled={index+1>=items.length} onClick={()=>setIndex(value=>value+1)}>Next ask</button></nav>
   </>:<p>{later.length?'No more asks in this sitting.':'No asks in this sitting.'}{readOnlyCount>0&&` ${readOnlyCount} read-only asks cannot be answered here; Lane shows why.`}</p>}
  <section aria-label="Review answers"><h2>Send card</h2>{reviews.length?<ol>{reviews.map(row=><li key={`${row.key}-${row.lane}`}><button onClick={()=>{const target=items.findIndex(candidate=>candidate.lane.name===row.lane&&candidate.ask.key===row.key);if(target>=0)setIndex(target);}}>{row.lane} — {row.question}: {row.answer}</button></li>)}</ol>:<p>No answers yet.</p>}
   {delivery&&<ul aria-label="Delivery results">{delivery.map(result=><li key={`${result.lane}-${result.key}`}><strong>{fleet.stationLanes.find(lane=>lane.id===result.lane)?.name||result.lane} — {result.key}:</strong> {result.accepted?'Accepted':'Refused'} — {result.reason}</li>)}</ul>}
   {error&&<p role="alert">{error}</p>}
   {!delivery&&<button disabled={!onConfirm||!reviewed.length||sending} onClick={confirm}>{sending?'Sending…':'Confirm and send sitting'}</button>}{!onConfirm&&!delivery&&<p>Sending is unavailable; answers have not been sent.</p>}
   {delivery&&<button onClick={startNext}>Start next sitting</button>}
   {!delivery&&later.length>0&&!reviewed.length&&<button onClick={startLater}>Start later sitting ({later.length} deferred)</button>}
  </section>
 </section>;
}
