import React,{useEffect,useRef,useState} from 'react';
import {laneWords,returnedWords,stateColors,type Ask,type Lane} from './stations';
import {Holo} from './Holo';
import {acceptedKeys,answerFor,batchReady,laneBatch,readOnlyReason,undoAnswer,unansweredCount,type DeliveryResult,type SittingAnswer,type SittingItem} from './sitting';
import type {TriangleMesh} from './holo-renderer';

type LaneProps={lane:Lane;mesh?:TriangleMesh;shipName?:string;onBack?:()=>void;onConfirm?:(answers:SittingAnswer[])=>Promise<DeliveryResult[]>};
type Answers=Record<string,SittingAnswer>;
type Act=(()=>void)|undefined;
type Acts={[key:string]:Act};
const question=(ask:Ask)=>ask.question||ask.topic||ask.key;
const fieldKey=(event:KeyboardEvent)=>event.metaKey||event.ctrlKey||event.altKey||(event.target instanceof HTMLElement&&!!event.target.closest('input,textarea,select,[contenteditable=true]'));
const duration=(ms:number)=>ms<60000?`${Math.floor(ms/1000)}s`:ms<3600000?`${Math.floor(ms/60000)}m`:`${Math.floor(ms/3600000)}h`;
// one formatter for every log line: building one per line made each poll's render a long task
const stamp=new Intl.DateTimeFormat([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const when=(at:string)=>{const t=Date.parse(at);return t>0?stamp.format(t):'time unknown';};
const answerWords=(ask:Ask,answer:SittingAnswer)=>answer.kind==='choice'?ask.choices?.[answer.choice??-1]?.label||`Choice ${answer.choice}`:answer.kind==='own'?answer.text||'Own answer':answer.kind==='skip'?'Crew decides':'Grill requested';

// a status line's verb in its state colour; a plain note stays neutral
const VERB_STATE:Record<string,string>={'needs-decision':'needs you',blocked:'needs you',failed:'needs you','captain-held':'needs you',working:'working',paused:'holding',done:'done',resolved:'done',published:'done',ready:'waiting'};
const logColor=(verb:string)=>stateColors[verb]??stateColors[VERB_STATE[verb]??'']??'#8F8477';
// One page of a lane's status log, as GET /lane-history.json gives it: oldest line first.
type LogPage={total:number;from:number;until?:string;lines:{at:string;state:string;text:string}[]};
// The server gives no more lines than this in one page; "newer" steps by it.
const LOG_PAGE=100;
// The lane's status log under its ship, one page at a time: one bar per line in a strip (oldest at the left), then the
// lines, newest first. The newest page follows the lane; an older page stays as it was read.
function LaneLog({lane}:{lane:Lane}){
 const [request,setRequest]=useState({before:0}); // the page ends before request.before; 0 is the newest page
 const [page,setPage]=useState<LogPage>();
 const [failed,setFailed]=useState(false);
 const {before}=request,count=lane.historyLines??0,follows=before?0:count;
 useEffect(()=>{
  if(!count)return;
  const controller=new AbortController();
  fetch(`/lane-history.json?lane=${encodeURIComponent(lane.id)}&before=${before}`,{cache:'no-store',signal:controller.signal})
   .then(response=>response.ok?response.json():Promise.reject(Error(response.statusText)))
   .then(data=>{setPage(data);setFailed(false);})
   .catch(()=>{if(!controller.signal.aborted)setFailed(true);}); // a failed read keeps the page already shown; the frame reports a board that cannot be read
  return ()=>controller.abort();
 },[lane.id,request,follows]);
 useEffect(()=>{if(failed)setRequest(old=>({before:old.before}));},[lane]);
 if(!count)return <p className="now">No status line yet.</p>;
 if(!page)return <p className="now">Reading the status log…</p>;
 const now=Date.now(),end=page.from+page.lines.length;
 const rows=page.lines.map((item,index)=>{const start=Date.parse(item.at),next=page.lines[index+1]?.at??page.until,stop=next?Date.parse(next):now;return {...item,lasted:start>0&&Number.isFinite(stop)?Math.max(0,stop-start):0};});
 return <div className="log">
  <span className="nowlab">Status log · {page.total} {page.total===1?'line':'lines'}{page.total>rows.length?` · lines ${page.from+1} to ${end}`:''}, newest first</span>
  {page.total>rows.length&&<span className="logpage">
   <button type="button" className="link" disabled={!page.from} onClick={()=>setRequest({before:page.from})}>◂ older lines</button>
   <button type="button" className="link" disabled={end>=page.total} onClick={()=>setRequest({before:end+LOG_PAGE>=page.total?0:end+LOG_PAGE})}>newer lines ▸</button>
  </span>}
  <div className="logstrip" title="the same lines as a strip, oldest at the left">{rows.map((item,i)=><i key={i} style={{background:logColor(item.state)}} title={`${when(item.at)} · ${item.state}`}/>)}</div>
  <ol>{rows.toReversed().map((item,i)=><li key={i} tabIndex={0}><span className="at" title={item.at}>{when(item.at)}</span><b style={{color:logColor(item.state)}}>{item.state}</b><span className="tx">{item.text} <small>· {duration(item.lasted)}</small></span></li>)}</ol>
 </div>;
}
type CardProps={lane:Lane;ask:Ask;index:number;count:number;answer?:SittingAnswer;locked:boolean;sent:boolean;save:(kind:SittingAnswer['kind'],choice?:number,text?:string)=>void;defer:()=>void;undo:()=>void;openIndex:()=>void;ownRef:React.RefObject<HTMLInputElement>};
function Choices({ask,answer,save}:Pick<CardProps,'ask'|'answer'|'save'>){
 return <div className="opts">
  {ask.must_decide?.length?<ul className="why">{ask.must_decide.map(item=><li key={item}>{item}</li>)}</ul>:null}
  {ask.choices?.map((choice,i)=><button key={`${i}-${choice.label}`} type="button" className={`opt${answer?.kind==='choice'&&answer.choice===i?' on':''}`} aria-pressed={answer?.kind==='choice'&&answer.choice===i} onClick={()=>save('choice',i)}>
   <kbd>{i+1}</kbd><span className="ol"><span>{choice.label}<small className="fx">{choice.effect}</small></span>{ask.pick===i&&<em>★ crew pick</em>}</span>
  </button>)}
 </div>;
}
// his own answer, when no choice fits: Enter keeps it; an empty field takes it back
function OwnAnswer({answer,save,ownRef}:Pick<CardProps,'answer'|'save'|'ownRef'>){
 const mine=answer?.kind==='own';
 return <form className={`ownans${mine?' on':''}`} onSubmit={event=>{event.preventDefault();save('own',undefined,String(new FormData(event.currentTarget).get('own')??''));ownRef.current?.blur();}}>
  <kbd>o</kbd><input ref={ownRef} name="own" defaultValue={mine?answer.text:''} placeholder="Your own answer, when no choice fits" aria-label="Your own answer" enterKeyHint="done" autoComplete="off" onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.blur();}}/>
  <button type="submit" className="link">{mine?'✓ your answer':'use my answer'}</button>
 </form>;
}
// One ask of the lane, answered in place: the choices, an own answer, skip, defer and a grill, as on the Ask station.
function LaneAsk(p:CardProps){
 const {ask,answer}=p;
 return <section className="card" aria-label={`Ask ${p.index+1} of ${p.count}: ${question(ask)}`}>
  <div className="ctop"><span className="lab">Ask {p.index+1} of {p.count}{p.count>1?' · ↑ ↓':''} · {ask.effort==='quick'?'quick':'to read'}</span><button type="button" className="link" onClick={p.openIndex}>all {p.count} {p.count===1?'ask':'asks'} ▸<kbd>i</kbd></button></div>
  <h1 className="q">{question(ask)}</h1>
  {ask.reason&&<p className="why">{ask.reason}</p>}
  {ask.answerable&&!p.locked?<React.Fragment>
   <Choices ask={ask} answer={answer} save={p.save}/>
   <OwnAnswer key={answer?.kind??''} answer={answer} save={p.save} ownRef={p.ownRef}/>
   <div className="hint">
    <button type="button" className="link" aria-pressed={answer?.kind==='skip'} onClick={()=>p.save('skip')}>{answer?.kind==='skip'?'✓ skipped: crew decides':'skip: crew decides'}<kbd>s</kbd></button>
    <button type="button" className="link" onClick={p.defer}>defer: ask me later<kbd>w</kbd></button>
    <button type="button" className="link" aria-pressed={answer?.kind==='grill'} onClick={()=>p.save('grill')}>{answer?.kind==='grill'?'✓ grill asked for':'ask for a grill'}<kbd>g</kbd></button>
    {answer&&<button type="button" className="link" onClick={p.undo}>undo<kbd>u</kbd></button>}
   </div>
  </React.Fragment>:<p className="why">{ask.answerable?p.sent?'Sent from this lane.':'Sending…':readOnlyReason(p.lane,ask)}</p>}
 </section>;
}
type BatchProps={lane:Lane;answers:Answers;batchKeys:string[];left:number;after:number;sendCount:number;deferred:number;ready:boolean;sending:boolean;delivery:DeliveryResult[]|null;error:string;canSend:boolean;send:()=>void};
// The lane's answers under the card. They go as one batch of at most four asks, once every ask in the batch has an answer, a skip, a grill or is deferred.
function LaneBatch(p:BatchProps){
 const sent=acceptedKeys(p.delivery);
 const rows=Object.values(p.answers).flatMap(answer=>{const ask=p.lane.asks.find(a=>a.key===answer.key);return ask?[{key:ask.key,q:question(ask),a:answerWords(ask,answer),sent:sent.has(ask.key),next:!p.batchKeys.includes(ask.key)}]:[];});
 const pending=rows.filter(row=>!row.sent).length,allAccepted=!!p.delivery?.every(r=>r.accepted||sent.has(r.key));
 if(!p.left&&!rows.length&&!p.delivery&&!p.error)return null;
 return <div className="answers" aria-label="Answers on this lane">
  <span className="lab">{pending?'Your answers on this lane':allAccepted?'Sent':p.delivery?'Delivery':'This batch'}</span>
  <ol>{rows.map(row=><li key={row.key}><span className="aq">{row.q}</span><span className="aa">{row.a}</span>{row.sent?<small>sent</small>:row.next&&<small>next batch</small>}</li>)}</ol>
  {p.delivery&&<ul aria-label="Delivery results">{p.delivery.map((r,i)=><li key={`${i}-${r.key}`}>{r.key}: {r.accepted?'Accepted':'Refused'} — {r.reason}</li>)}</ul>}
  {p.error&&<p role="alert">{p.error}</p>}
  {p.left>0&&<p className="now">{p.left} {p.left===1?'ask still needs':'asks still need'} an answer, a skip or a defer before this lane's answers can be sent.</p>}
  {p.after>0&&<p className="now">{p.after} more {p.after===1?'ask waits':'asks wait'} for the next batch, which takes at most four asks.</p>}
  {p.ready&&p.canSend&&<button type="button" className="link act send" disabled={p.sending} onClick={p.send}>{p.sending?'Sending…':`send ${p.sendCount} ${p.sendCount===1?'answer':'answers'}`}<kbd>y</kbd></button>}
  {!p.canSend&&<p className="now">Sending is unavailable; answers have not been sent.</p>}
  {p.deferred>0&&<p className="now">{p.deferred} deferred {p.deferred===1?'ask waits':'asks wait'} for a later sitting.</p>}
 </div>;
}
// The lane's list of asks (i): find by words, ↑ ↓ choose, enter opens the ask, esc closes.
function LaneIndex({lane,current,open,close}:{lane:Lane;current:number;open:(index:number)=>void;close:()=>void}){
 const [query,setQuery]=useState(''),words=query.toLowerCase().split(' ').filter(Boolean);
 const matches=lane.asks.map((ask,i)=>({ask,i})).filter(({ask})=>words.every(w=>(question(ask)+' '+ask.reason).toLowerCase().includes(w)));
 const [chosen,setChosen]=useState(current),at=Math.max(0,matches.findIndex(m=>m.i===chosen)),pick=matches[at];
 const key=(event:React.KeyboardEvent)=>{
  if(event.target instanceof HTMLButtonElement&&event.key!=='Escape')return;
  const step=(by:number)=>setChosen(matches[Math.max(0,Math.min(matches.length-1,at+by))]?.i??chosen);
  const acts:Acts={Escape:close,ArrowDown:()=>step(1),ArrowUp:()=>step(-1),Enter:()=>{if(pick)open(pick.i);}},act=acts[event.key];
  if(!act)return;
  event.preventDefault();act();
 };
 return <React.Fragment><div className="veil" onClick={close}/><div className="pop names idx" role="dialog" aria-label={`Asks of ${lane.name}`} onKeyDown={key}>
  <span className="lab">{lane.name} · {lane.asks.length} {lane.asks.length===1?'ask':'asks'}</span>
  <input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find in this lane: words of a question or its reason" aria-label="Find in this lane"/>
  {matches.map(({ask,i})=><button key={ask.key} type="button" className={i===pick?.i?'tw on':'tw'} onFocus={()=>setChosen(i)} onClick={()=>open(i)}><b>{i+1}</b><span className="e">{ask.effort==='quick'?'quick':'to read'}</span><span className="iq">{question(ask)}</span></button>)}
  {!matches.length&&<p>No ask in this lane has those words.</p>}
  {pick&&<p className="pv">{question(pick.ask)}</p>}
  <span className="foot">{query?`${matches.length} of ${lane.asks.length} · `:''}↑ ↓ choose · enter opens · esc closes</span>
 </div></React.Fragment>;
}
type LaneKeys={answerable:boolean;count:number;ready:boolean;idx:boolean;choose:(i:number)=>void;save:CardProps['save'];defer:()=>void;undo:()=>void;move:(by:number)=>void;openIndex:()=>void;send:()=>void;back?:()=>void;ownRef:CardProps['ownRef']};
// what a key does on the Lane station; esc goes back only when no box of the board is open (the board closes its own)
function laneAct(p:LaneKeys,key:string):Act{
 if(key==='Escape')return document.querySelector('.frame .pop')?undefined:p.back;
 if(key==='ArrowUp'||key==='ArrowDown')return ()=>p.move(key==='ArrowUp'?-1:1);
 if(key==='i')return p.openIndex;
 if(key==='y')return p.ready?p.send:undefined;
 if(!p.answerable)return undefined;
 if(key.length===1&&'123456789'.includes(key))return ()=>p.choose(Number(key)-1);
 const acts:Acts={s:()=>p.save('skip'),w:p.defer,g:()=>p.save('grill'),u:p.undo,o:()=>p.ownRef.current?.focus()};
 return acts[key];
}
// The Lane station's keys, in the capture phase, so esc is decided before the board's own key handler runs.
function useLaneKeys(k:LaneKeys){
 const live=useRef(k);live.current=k;
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(fieldKey(event)||live.current.idx)return;
   const act=laneAct(live.current,event.key);
   if(!act)return;
   event.preventDefault();act();
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[]);
}
function useLaneAnswers(lane:Lane,onConfirm:LaneProps['onConfirm']){
 const [answers,setAnswers]=useState<Answers>({}),[deferred,setDeferred]=useState<string[]>([]),[batch,setBatch]=useState<string[]>([]),[delivery,setDelivery]=useState<DeliveryResult[]|null>(null),[sending,setSending]=useState(false),[error,setError]=useState('');
 const sent=acceptedKeys(delivery);
 const pending=lane.asks.filter(ask=>ask.answerable&&!deferred.includes(ask.key)&&!sent.has(ask.key)).map(ask=>ask.key);
 useEffect(()=>{setBatch(old=>laneBatch(pending,old));},[lane,deferred,delivery]);
 const items:SittingItem[]=lane.asks.filter(ask=>batch.includes(ask.key)&&pending.includes(ask.key)).map(ask=>({lane,ask,ref:ask.key,round:0}));
 const ready=batchReady(items,answers),sentTo=(ask:Ask)=>sent.has(ask.key),isLocked=(ask:Ask)=>sending||sentTo(ask);
 // the same answer again takes it back; an own answer with no words takes his own answer back
 const save=(ask:Ask,kind:SittingAnswer['kind'],choice?:number,text?:string)=>{
  if(isLocked(ask)||!ask.answerable)return;
  const had=answers[ask.key],same=had?.kind===kind&&had.choice===choice&&kind!=='own',empty=kind==='own'&&!text?.trim();
  setAnswers(old=>same||empty?undoAnswer(old,ask.key):{...old,[ask.key]:answerFor({lane,ask,ref:ask.key,round:0},kind,choice,text?.trim())});
  setDeferred(old=>old.filter(key=>key!==ask.key));
 };
 const defer=(ask:Ask)=>{if(isLocked(ask)||!ask.answerable)return;setAnswers(old=>undoAnswer(old,ask.key));setDeferred(old=>old.includes(ask.key)?old:[...old,ask.key]);};
 const send=async()=>{if(!onConfirm||sending||!ready)return;setSending(true);setError('');try{const results=await onConfirm(items.map(item=>answers[item.ref]));setDelivery(old=>[...(old??[]),...results]);}catch(e){setError(e instanceof Error?e.message:'Could not send answers.');}finally{setSending(false);}};
 return {answers,deferred,delivery,sending,error,ready,isLocked,sentTo,left:unansweredCount(items,answers),sendCount:items.length,batchKeys:items.map(item=>item.ref),after:pending.length-items.length,save,defer,send,undo:(ask:Ask)=>{if(!isLocked(ask))setAnswers(old=>undoAnswer(old,ask.key));}};
}
/** One lane: its ship, large, with its name, build and status log; beside it the lane's asks, answered in place. */
export function LaneStation({lane,mesh,shipName,onBack,onConfirm}:LaneProps){
 const [la,setLa]=useState(0),[idx,setIdx]=useState(false),ownRef=useRef<HTMLInputElement>(null);
 const count=lane.asks.length,index=Math.min(la,Math.max(0,count-1)),ask=lane.asks[index],batch=useLaneAnswers(lane,onConfirm);
 const save:CardProps['save']=(kind,choice,text)=>{if(ask)batch.save(ask,kind,choice,text);};
 const defer=()=>{if(!ask)return;batch.defer(ask);setLa((index+1)%Math.max(1,count));};
 const undo=()=>{if(ask)batch.undo(ask);};
 useLaneKeys({answerable:!!ask&&ask.answerable&&!batch.isLocked(ask),count,ready:batch.ready&&!!onConfirm,idx,choose:i=>{if(ask?.choices?.[i])save('choice',i);},save,defer,undo,move:by=>setLa(Math.max(0,Math.min(count-1,index+by))),openIndex:()=>setIdx(count>0),send:batch.send,back:onBack,ownRef});
 return <div className="lane" aria-label={`Lane ${lane.name}`}>
  <div className="holo">
   <Holo mesh={mesh} state={lane.state} sourceState={lane.sourceState} progress={lane.progress} name={shipName||'No admitted ship'} turnKeys/>
   <LaneLog lane={lane}/>
  </div>
  <div className="side">
   {onBack&&<div><button type="button" className="link" onClick={onBack}>‹ back<kbd>esc</kbd></button></div>}
   <h2>{lane.name}</h2>
   {lane.title&&<p className="now">{lane.title}</p>}
   <div className="state"><i style={{background:stateColors[lane.state]}}/><b>{lane.state}</b><span>{laneWords(lane)}</span></div>
   {ask?<LaneAsk key={ask.key} lane={lane} ask={ask} index={index} count={count} answer={batch.answers[ask.key]} locked={batch.isLocked(ask)} sent={batch.sentTo(ask)} save={save} defer={defer} undo={undo} openIndex={()=>setIdx(true)} ownRef={ownRef}/>:<p className="now big">{lane.invalidAsks?returnedWords(lane.invalidAsks):'Nothing needs you on this lane.'}</p>}
   <LaneBatch lane={lane} answers={batch.answers} batchKeys={batch.batchKeys} left={batch.left} after={batch.after} sendCount={batch.sendCount} deferred={batch.deferred.length} ready={batch.ready} sending={batch.sending} delivery={batch.delivery} error={batch.error} canSend={!!onConfirm} send={batch.send}/>
   {lane.now&&<div className="last"><span className="nowlab">Crew's last word</span><p className="now">{lane.now}</p></div>}
  </div>
  {idx&&<LaneIndex lane={lane} current={index} open={i=>{setLa(i);setIdx(false);}} close={()=>setIdx(false)}/>}
 </div>;
}
