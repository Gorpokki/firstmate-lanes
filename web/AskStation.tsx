import React,{useEffect,useRef,useState} from 'react';
import {AGE_DAYS,ageDays,ageTone,ageWords,overdue,returnedWords,stateColors,type Fleet,type Lane,type Link} from './stations';
import {assignedShip,type ShipMesh} from './mesh-catalog';
import {Holo} from './Holo';
import {answerFor,answeredLanes,batchReady,buildSitting,deferForLater,minutesSince,reviewAnswers,undoAnswer,type DeliveryResult,type SittingAnswer,type SittingItem} from './sitting';

export type {DeliveryResult,SittingAnswer} from './sitting';
type AskStationProps={fleet:Fleet;active:boolean;selectedLaneIds?:string[];hiddenSelected:number;meshes?:ShipMesh[];onBack:()=>void;onConfirm?:(answers:SittingAnswer[])=>Promise<DeliveryResult[]>;onOpenLane?:(id:string)=>void;onAnswered?:(laneIds:string[])=>void};
type Answers=Record<string,SittingAnswer>;
const askQuestion=(item:SittingItem)=>item.ask.question||item.ask.topic||item.ask.key;
const isEditing=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable=true]');
const phone=()=>matchMedia('(max-width: 760px)').matches;
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;
const K=({k}:{k:string})=><kbd className="k">{k}</kbd>;
const crewPick=(item:SittingItem)=>item.ask.pick!==undefined&&!!item.ask.choices?.[item.ask.pick];
const hintWords=(n:number)=>`${phone()?'A tap':`A click or ${n>1?`1–${n}`:'1'}`} chooses. Nothing goes to Firstmate until you send the sitting.`;
const answerWords=(item:SittingItem,answer:SittingAnswer)=>answer.kind==='choice'?item.ask.choices?.[answer.choice??-1]?.label||`choice ${(answer.choice??0)+1}`:answer.kind==='own'?answer.text||'':answer.kind==='skip'?'skipped: the crew chooses':'a grill with the crew, before you choose';
function linksOf(lane:Lane,item:SittingItem):[string,Link][]{
 const all:[string,Link][]=[...(lane.ticket?[['ticket',lane.ticket] as [string,Link]]:[]),...(item.ask.tickets||[]).map(link=>['ticket',link] as [string,Link]),...(item.ask.pull_requests||[]).map(link=>['pull request',link] as [string,Link]),...(item.ask.grill_pages||[]).map(link=>['grill page',link] as [string,Link])];
 return all.filter(([,link],i)=>all.findIndex(([,other])=>other.url===link.url)===i);
}
function AgeBar({minutes}:{minutes:number}){
 if(!Number.isFinite(minutes))return null;
 const days=ageDays(minutes);
 return <span className="agebar" role="img" aria-label={overdue(minutes)?'Overdue':'Age'}>{Array.from({length:AGE_DAYS},(_,i)=><i key={i} className={i<days&&i>=5?'od':undefined} style={{background:i>=days?'#2A2630':i>=5?'#FF9900':ageTone(minutes)}}/>)}</span>;
}
// The lane's ticket, pull requests and grill pages, and what waits on the answer: not part of the decision, so out of sight
// until the pointer rests on the widget or it has focus. A click or a tap holds it open.
function Links({links,waits}:{links:[string,Link][];waits?:string}){
 const [open,setOpen]=useState(false);
 return <span className={`linkw${open?' open':''}`}>
  <button className="link go" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{links.length?plural(links.length,'link'):'more'} {open?'▾':'▸'}</button>
  <span className="linkpop">{links.map(([kind,link])=><a key={link.url} href={link.url} target="_blank" rel="noreferrer"><small>{kind}</small>{link.title} ▸</a>)}{waits&&<span><small>waits on your answer</small>{waits}</span>}</span>
 </span>;
}
// The ask's lane beside it: the same holo as the Lane station, its state and its own last word.
function ShipBox({lane,meshes,onOpenLane}:{lane:Lane;meshes?:ShipMesh[];onOpenLane?:(id:string)=>void}){
 const ship=assignedShip(lane.id,meshes),source=lane.sourceState?.toLowerCase()||'',updated=minutesSince(lane.updatedAt||'');
 return <div className="shipbox">
  <Holo mesh={ship?.mesh} state={lane.state} progress={lane.progress} name={ship?.name||'No admitted ship'} options={{blocks:/blocked|block/.test(source),fragments:/failed|failure|error/.test(source)?1:0}}/>
  <div className="lstate"><i style={{background:stateColors[lane.state]}}/>{lane.state!=='needs you'&&<b>{lane.state}</b>}{onOpenLane?<button className="link" onClick={()=>onOpenLane(lane.id)} title="Open the lane: its ship and its asks">{lane.asks.length===1?'open the lane':plural(lane.asks.length,'ask')} ▸<K k="enter"/></button>:<span>{plural(lane.asks.length,'ask')}</span>}</div>
  {lane.now&&<div className="last"><span className="nowlab">{"Crew's last word"}{Number.isFinite(updated)?` · ${ageWords(updated)} ago`:''}</span><p className="now">{lane.now}</p></div>}
 </div>;
}
type CardProps={item:SittingItem;lane:Lane;lead:boolean;raw:boolean;hinted:boolean;meshes?:ShipMesh[];ownRef:React.RefObject<HTMLInputElement>;onOpenLane?:(id:string)=>void;choose:(i:number)=>void;own:(text:string)=>void;skip:()=>void;defer:()=>void;grill:()=>void;flipRaw:()=>void};
// One ask: its lane, how long it has waited, the question, why it matters, the choices. A choice is kept here; the sitting sends them.
function Card({item,lane,lead,raw,hinted,meshes,ownRef,onOpenLane,choose,own,skip,defer,grill,flipRaw}:CardProps){
 const {ask}=item,choices=ask.choices||[],rec=crewPick(item)?ask.pick:choices.length?0:undefined,minutes=minutesSince(ask.asked),links=linksOf(lane,item);
 return <section className="card" aria-label={`${lane.name}: ${askQuestion(item)}`}>
  <div className="cbar"/>
  <div className="cmain">
   <div className="ctop">
    <button className="who" onClick={()=>onOpenLane?.(lane.id)} title="Open this lane"><span className="next">Next · </span>{lane.secondMate&&<span className="next">{lane.secondMate} · </span>}{lane.name}</button>
    <span className="age"><AgeBar minutes={minutes}/><span><b>{lead?'Waiting longest · ':''}{ageWords(minutes)}</b> · <span className="nb">{ask.effort==='quick'?'quick':'to read'}</span></span></span>
   </div>
   <div className="qa"><h1 className="q">{askQuestion(item)}</h1>{ask.reason&&<p className="why">{ask.reason}</p>}
    {ask.form==='discussion'&&!!ask.must_decide?.length&&<ul className="must" aria-label="Must decide">{ask.must_decide.map((decision,i)=><li key={`${i}-${decision}`}>{decision}</li>)}</ul>}
   </div>
   {raw&&<pre className="raw">{JSON.stringify(ask,(key,value)=>key==='answerable'?undefined:value,2)}</pre>}
   <div className="opts col">
    {choices.map((choice,i)=><button key={`${i}-${choice.label}`} className={`opt${rec===i?' rec':''}`} onClick={()=>choose(i)}>
     <kbd>{i+1}</kbd><span className="ol"><span>{choice.label}{choice.effect&&<small className="fx">{choice.effect}</small>}</span>{rec===i&&<em className={crewPick(item)?'':'board'}>{crewPick(item)?'★ crew pick':'☆ board suggestion'}</em>}</span>
    </button>)}
    {/* the owner's own answer, when no choice fits: on every ask. Enter keeps it; esc leaves the field */}
    <form className="ownans" onSubmit={event=>{event.preventDefault();const text=String(new FormData(event.currentTarget).get('own')??'').trim();if(text){own(text);(document.activeElement as HTMLElement|null)?.blur();}}}>
     <kbd>o</kbd><input ref={ownRef} name="own" placeholder="Type your own answer, if no choice fits" aria-label="Your own answer" enterKeyHint="done" autoComplete="off" onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.blur();}}/><button type="submit" className="link">use my answer</button>
    </form>
   </div>
   {crewPick(item)&&ask.pick_reason&&<p className="pickwhy">★ {ask.pick_reason}</p>}
   {!crewPick(item)&&ask.no_pick_reason&&<p className="pickwhy">No crew pick: {ask.no_pick_reason}</p>}
   <div className="hint">
    <button className="link way" title="No answer from you: the crew goes on with its own best judgment" onClick={skip}>skip: crew decides<K k="s"/></button>
    <button className="link way" title="You want to answer this ask, but not now: it comes back in a later sitting" onClick={defer}>defer: ask me later<K k="w"/></button>
    <button className="link go" aria-expanded={raw} onClick={flipRaw}>crew text {raw?'▾':'▸'}<K k="d"/></button>
    <button className="link faint" title="Asks the crew to talk this ask through with you before you choose" onClick={grill}>ask for a grill<K k="g"/></button>
    {(links.length>0||!!ask.waits_on_this)&&<Links links={links} waits={ask.waits_on_this}/>}
    <span className="tip">{!choices.length?(ask.form==='discussion'?'A discussion ask: ask for a grill, or type your own answer.':'No choices came with this ask.'):hinted?hintWords(choices.length):''}</span>
   </div>
  </div>
  <ShipBox lane={lane} meshes={meshes} onOpenLane={onOpenLane}/>
 </section>;
}
// The sitting's answers in plain words, under the card: the lane, its question, what was answered.
function AnswerList({rows,sent}:{rows:[SittingItem,SittingAnswer][];sent:boolean}){
 return <div className="answers" aria-label="Answers in this sitting"><span className="lab">{sent?'Sent':'Your answers in this sitting'}</span><ol>{rows.map(([item,answer])=><li key={item.ref} className={`a-${answer.kind}`}><b>{item.lane.name}</b><span className="aq">{askQuestion(item)}</span><span className="aa">{answer.kind==='own'&&<i>your words: </i>}{answerWords(item,answer)}</span></li>)}</ol></div>;
}

export function AskStation({fleet,active,selectedLaneIds,hiddenSelected,meshes,onBack,onConfirm,onOpenLane,onAnswered}:AskStationProps){
 const [items,setItems]=useState<SittingItem[]>([]),[answers,setAnswers]=useState<Answers>({}),[deferred,setDeferred]=useState<string[]>([]),[trail,setTrail]=useState<string[]>([]),[later,setLater]=useState<string[]>([]);
 const [delivery,setDelivery]=useState<DeliveryResult[]|null>(null),[sending,setSending]=useState(false),[error,setError]=useState(''),[raw,setRaw]=useState(false),[paste,setPaste]=useState(false),ownRef=useRef<HTMLInputElement>(null);
 const sit=items.filter(item=>!deferred.includes(item.ref)),cur=sit.find(item=>!answers[item.ref]),laneOf=(item:SittingItem)=>fleet.stationLanes.find(lane=>lane.id===item.lane.id)??item.lane;
 const given=trail.flatMap(ref=>{const item=sit.find(entry=>entry.ref===ref),answer=answers[ref];return item&&answer?[[item,answer] as [SittingItem,SittingAnswer]]:[];});
 const reviewed=given.map(([,answer])=>answer).filter(answer=>reviewAnswers(fleet,[answer]).length>0),ready=batchReady(sit,answers),n=delivery?delivery.length:reviewed.length;
 const keep=sit.filter(item=>!answers[item.ref]&&crewPick(item)),open=fleet.stationLanes.reduce((total,lane)=>total+lane.asks.filter(ask=>ask.answerable).length,0),waiting=Math.max(0,open-sit.length);
 const oldest=Math.min(...fleet.stationLanes.flatMap(lane=>lane.asks.filter(ask=>ask.answerable).map(ask=>Date.parse(ask.asked))).filter(time=>time>0));
 const canMoveOn=!cur&&(!!delivery||!n),waitLater=[...new Set([...later,...deferred])];
 const start=(next:SittingItem[])=>{setItems(next);setAnswers({});setDeferred([]);setTrail([]);setDelivery(null);setError('');setRaw(false);setPaste(false);};
 // The next sitting leaves out deferred and sent asks; once nothing else waits, the deferred asks come back.
 const upcoming=(quick:boolean)=>{
  const next=buildSitting(fleet,selectedLaneIds,new Set(waitLater));
  if(quick)return next.filter(item=>item.ask.effort==='quick');
  return next.length?next:deferForLater(fleet,waitLater).filter(item=>item.ask.answerable).slice(0,4);
 };
 const nextSitting=(quick=false)=>{const next=upcoming(quick);setLater(waitLater.filter(ref=>!next.some(item=>item.ref===ref)));start(next);};
 const nextCount=canMoveOn?upcoming(false).length:0,quickCount=canMoveOn?upcoming(true).length:0;
 useEffect(()=>{if(active&&!trail.length&&!delivery)nextSitting();},[active]);
 useEffect(()=>{if(active&&!items.length&&!delivery&&upcoming(false).length)nextSitting();},[fleet]);
 useEffect(()=>{onAnswered?.(answeredLanes(fleet,answers));},[fleet,answers]);
 const locked=sending||!!delivery;
 const save=(item:SittingItem,answer:SittingAnswer)=>{if(locked)return;setAnswers(old=>({...old,[item.ref]:answer}));setTrail(old=>[...old.filter(ref=>ref!==item.ref),item.ref]);setRaw(false);};
 const choose=(i:number)=>{if(cur&&i<(cur.ask.choices?.length??0))save(cur,answerFor(cur,'choice',i));};
 const defer=()=>{if(!cur||locked)return;setDeferred(old=>[...old,cur.ref]);setAnswers(old=>undoAnswer(old,cur.ref));setTrail(old=>[...old.filter(ref=>ref!==cur.ref),cur.ref]);setRaw(false);};
 const undo=()=>{const ref=trail.at(-1);if(!ref||locked)return;setTrail(old=>old.slice(0,-1));setAnswers(old=>undoAnswer(old,ref));setDeferred(old=>old.filter(entry=>entry!==ref));};
 const keepPicks=()=>{if(locked||!keep.length)return;setAnswers(old=>({...old,...Object.fromEntries(keep.map(item=>[item.ref,answerFor(item,'choice',item.ask.pick)]))}));setTrail(old=>[...old.filter(ref=>!keep.some(item=>item.ref===ref)),...keep.map(item=>item.ref)]);setPaste(true);};
 const confirm=async()=>{if(!onConfirm||locked||!ready||!n)return;setSending(true);setError('');try{const results=await onConfirm(reviewed);setDelivery(results);}catch(e){setError(e instanceof Error?e.message:'Could not send answers.');}finally{setSending(false);}};
 const keyRef=useRef<(event:KeyboardEvent)=>void>(()=>{});
 const enterLane=(event:KeyboardEvent)=>{if(cur&&!(event.target instanceof HTMLElement&&event.target.closest('button,a,summary')))onOpenLane?.(cur.lane.id);};
 const keyActions=():Record<string,(()=>void)|false>=>({s:!!cur&&(()=>save(cur,answerFor(cur,'skip'))),w:!!cur&&defer,d:!!cur&&(()=>setRaw(value=>!value)),g:!!cur&&(()=>save(cur,answerFor(cur,'grill'))),o:!!cur&&(()=>ownRef.current?.focus()),u:undo,y:!cur&&confirm,k:keepPicks,n:nextCount>0&&(()=>nextSitting()),e:quickCount>0&&(()=>nextSitting(true)),p:n>0&&(()=>setPaste(value=>!value))});
 keyRef.current=event=>{
  if(event.metaKey||event.ctrlKey||event.altKey||event.repeat||isEditing(event.target))return;
  if(event.key==='Enter'){enterLane(event);return;}
  const action=/^[1-9]$/.test(event.key)?()=>choose(Number(event.key)-1):keyActions()[event.key];
  if(action){event.preventDefault();action();}
 };
 useEffect(()=>{if(!active)return;const key=(event:KeyboardEvent)=>keyRef.current(event);window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[active]);
 const inSitting=fleet.stationLanes.filter(lane=>!selectedLaneIds||selectedLaneIds.includes(lane.id));
 const readOnly=inSitting.reduce((total,lane)=>total+lane.asks.filter(ask=>!ask.answerable).length,0),returned=inSitting.reduce((total,lane)=>total+(lane.invalidAsks||0),0);
 const pips=<span className="pips" role="img" aria-label={`${sit.filter(item=>answers[item.ref]).length} of ${sit.length} answered`}>{items.map(item=><i key={item.ref} className={answers[item.ref]?'done':deferred.includes(item.ref)?'skip':item===cur?'cur':undefined}/>)}</span>;
 const more=(nextCount>0||quickCount>0)&&<div className="opts more"><span className="lab">More asks</span>{nextCount>0&&<button className="link" onClick={()=>nextSitting()}>next sitting: {plural(nextCount,'ask')}<K k="n"/></button>}{quickCount>0&&<button className="link" onClick={()=>nextSitting(true)}>quick sitting: {plural(quickCount,'ask')}<K k="e"/></button>}</div>;
 return <section className="ask" aria-label="Ask sitting" hidden={!active}>
  <style>{CSS}</style>
  {/* only while it is shown: a hidden station keeps no holo turning */}
  {!active?null:!items.length?<div className="stage"><section className="card calm"><div className="cbar"/><div className="cmain">
   <p className="big">{later.length?`No new ask waits. ${plural(later.length,'deferred ask')} can come back.`:'No ask waits for your answer. You can stop here.'}</p>
   {readOnly>0&&<p className="why">{readOnly} read-only {readOnly===1?'ask':'asks'} cannot be answered here; Lane shows why.</p>}
   {returned>0&&<p className="why">{returnedWords(returned)}</p>}{more}
  </div></section></div>
  :!cur?<div className="stage"><div className="donecol"><section className="card calm"><div className="cbar"/><div className="cmain">
   <div className="ctop"><span className="who">{!n?'Sitting done':delivery?'Sent':'Ready to send'}</span>{pips}</div>
   <p className="big">{!n?'Nothing was chosen in this sitting.':delivery?`${plural(n,'answer')} sent to Firstmate.`:`${n} ${n===1?'answer is':'answers are'} ready.`}</p>
   {!delivery&&n>0&&<p className="why">Nothing is sent yet. Go back to change an answer, or send them all to Firstmate.</p>}
   {delivery&&<ul className="why results" aria-label="Delivery results">{delivery.map(result=><li key={`${result.lane}-${result.key}`}><b>{fleet.stationLanes.find(lane=>lane.id===result.lane)?.name||result.lane}</b> · {result.accepted?'accepted':`refused: ${result.reason}`}</li>)}</ul>}
   {error&&<p role="alert">{error}</p>}
   {!delivery&&<div className="opts">
    {n>0&&<button className="link act send" disabled={!onConfirm||!ready||sending} onClick={confirm}>{sending?'sending…':`send ${plural(n,'answer')} to Firstmate`}<K k="y"/></button>}
    <button className="link act" disabled={!trail.length||sending} onClick={undo}>go back<K k="u"/></button>
   </div>}
   {!onConfirm&&!delivery&&n>0&&<p className="why">Sending is unavailable; answers have not been sent.</p>}
   {more}
  </div></section>{n>0&&<AnswerList rows={given} sent={!!delivery}/>}</div></div>
  :<div className="stage">
   <Card key={cur.ref} item={cur} lane={laneOf(cur)} lead={Date.parse(cur.ask.asked)===oldest} raw={raw} hinted={!trail.length} meshes={meshes} ownRef={ownRef} onOpenLane={onOpenLane} choose={choose} own={text=>save(cur,answerFor(cur,'own',undefined,text))} skip={()=>save(cur,answerFor(cur,'skip'))} defer={defer} grill={()=>save(cur,answerFor(cur,'grill'))} flipRaw={()=>setRaw(value=>!value)}/>
   {paste&&n>0&&<AnswerList rows={given} sent={false}/>}
   {/* the sitting's own row, at the same place for every ask: its progress, the answers kept, the ways out */}
   <div className="sitrow"><div className="sit">
    <span className="lab">This sitting</span>{pips}
    <span className="of">{items.indexOf(cur)+1} of {items.length}</span><span className="words">{[items.filter(item=>item.ask.effort!=='quick').length,items.filter(item=>item.ask.effort==='quick').length].map((count,i)=>count?`${count} ${i?'quick':'to read'}`:'').filter(Boolean).join(', ')}</span>
    <span className="clip">{n>0&&<button className="link have" aria-expanded={paste} onClick={()=>setPaste(value=>!value)}><i className="ck">✓</i> {plural(n,'answer')} kept {paste?'▾':'▸'}<K k="p"/></button>}
     {trail.length>0&&<button className="link act" onClick={undo}>undo<K k="u"/></button>}</span>
    {hiddenSelected>0&&<span className="hid">+{hiddenSelected} ticked, hidden by the filter</span>}
   </div><div className="sit out"><i className="br"/>
    {keep.length?<button className="link picks act" onClick={keepPicks}>take {keep.length} ★ {phone()?'':'crew '}{keep.length===1?'pick':'picks'}<K k="k"/></button>:<span className="link picks none">no ★ picks left</span>}
    <button className="link more" onClick={onBack}>{plural(waiting,'ask')} later ▸<K k="l"/></button>
   </div></div>
  </div>}
 </section>;
}

const CSS=`
.ask .stage{flex:1;display:flex;flex-direction:column;gap:22px;padding:14px 0 0;min-height:0}
.frame.v-ask .ask .stage{display:grid;grid-template-rows:minmax(480px,auto) auto;align-content:start}
.ask .card{display:flex;gap:26px;align-items:stretch;align-self:start;animation:ask-in .28s ease-out}
@keyframes ask-in{from{opacity:.25;transform:translateY(4px)}}
.ask .cbar{flex:0 0 9px;background:var(--red);border-radius:9px}
.ask .calm .cbar{background:var(--f2)}
.ask .cmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;padding:4px 0}
.ask .ctop{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.ask .who{font:600 21px/1 var(--lab);letter-spacing:.07em;text-transform:uppercase;background:none;border:0;border-radius:0;padding:0;color:var(--text)}
.ask button.who:hover{color:var(--peach)}
.ask .next{color:var(--dim)}
.ask .age{display:flex;align-items:center;gap:10px;color:var(--dim);font-size:16px;white-space:nowrap}
.ask .age b{color:#D6CABA;font-weight:500}
.ask .agebar{display:inline-flex;gap:2px;align-items:center}
.ask .agebar i{width:13px;height:9px;border-radius:1px}
.ask .agebar i.od{height:17px}
.ask .qa{display:flex;flex-direction:column;gap:14px}
.frame.v-ask .ask .card:not(.calm) .qa{min-height:150px;justify-content:center}
.ask .q{font:500 38px/1.16 var(--body);margin:0;max-width:23em;text-wrap:balance;color:#FFF4DC}
.ask .why{margin:0;color:var(--dim);font-size:19px;max-width:44em}
.ask .results{padding-left:1.2em;font-size:16.5px}
.ask .must{margin:0;padding-left:1.2em;font-size:18px}
.ask .raw{margin:0;padding:10px 14px;background:#141118;border-radius:8px;font-size:15.5px;color:var(--text);max-width:60em;white-space:pre-wrap;max-height:9em;overflow:auto}
.ask .opts{display:flex;flex-wrap:wrap;gap:12px;margin-top:4px}
.ask .opts.col{display:inline-flex;flex-direction:column;align-items:stretch;gap:10px;align-self:flex-start}
.ask .calm .opts{align-items:baseline}
.ask .opt{display:flex;align-items:center;gap:14px;background:none;color:var(--text);border:1.5px solid #8F8477;border-radius:999px;padding:0 22px 0 0;font-size:20px;min-height:48px;overflow:hidden}
.ask .opt kbd{align-self:stretch;width:46px;background:#3A3042;color:var(--peach);display:grid;place-items:center;flex:none}
.ask .ol{display:flex;align-items:center;gap:12px}
.ask .opt em{font:600 13px/1 var(--lab);letter-spacing:.08em;text-transform:uppercase;font-style:normal;color:var(--peach);white-space:nowrap}
.ask .opt.rec{border-color:#E8DCCB}
.ask .opt.rec em{color:var(--text)}
.ask .opt.rec em.board{color:var(--dim)}
.ask .opt:hover{background:#1D1921}
.ask .opt small.fx{display:block;color:var(--dim);font-size:.84em;line-height:1.25;margin-top:1px}
.ask .ownans{display:flex;align-items:center;gap:10px;min-height:44px;max-width:760px;padding:0 14px 0 0;border:1.5px dashed #5A5260;border-radius:999px}
.ask .ownans:focus-within{border-style:solid;border-color:#FFF4DC}
.ask .ownans kbd{margin-left:16px}
.ask .ownans input{flex:1;min-width:15em;background:none;border:0;outline:0;color:var(--text);font:inherit;font-size:18px}
.ask .ownans input::placeholder{color:#9C9184}
.ask .ownans .link{flex:none}
.ask p.pickwhy{margin:2px 0 0;color:#B8AB9B;font-size:16px}
.ask .link{color:var(--dim);font:600 14px/1 var(--lab);letter-spacing:.08em;text-transform:uppercase;padding:6px 0;white-space:nowrap;border:0;border-radius:0;background:linear-gradient(#5E5560,#5E5560) no-repeat 0 calc(100% + 5px)/100% 1px;background-origin:content-box}
.ask .link:hover{color:var(--text)}
.ask .link kbd{margin-left:6px}
.ask .hint{display:flex;flex-wrap:wrap;align-items:center;gap:4px 26px;color:#CDBFAE;font-size:15.5px;margin-top:auto}
.ask .hint .link,.ask .link.act{color:#CDBFAE;background:none;border:1.5px solid #5E5560;border-radius:999px;padding:7px 16px}
.ask .hint .link.way{color:var(--text);border:1px solid #8A7F8C}
.ask .hint .link.go{border-color:transparent;padding-left:4px;padding-right:4px;background:linear-gradient(#5E5560,#5E5560) no-repeat 0 calc(100% + 4px)/100% 1px;background-origin:content-box}
.ask .link.faint{opacity:.84}
.ask .link.act.send{color:var(--text);border:1px solid var(--text)}
.ask .hint .tip{flex-basis:100%;min-height:1.3em}
.ask .hint .tip:empty{display:none}
.ask .linkw{position:relative;display:inline-flex}
.ask .linkpop{display:none;position:absolute;left:-14px;bottom:100%;z-index:6;flex-direction:column;gap:10px;min-width:280px;padding:12px 14px 14px;background:#17141B;border:1px solid #4A424D;border-radius:12px;color:#D9CDBD;font-size:15.5px}
.ask .linkw:hover .linkpop,.ask .linkw:focus-within .linkpop,.ask .linkw.open .linkpop{display:flex}
.ask .linkpop a{color:#D9CDBD;text-decoration:underline;text-underline-offset:4px;text-decoration-color:#6B6170}
.ask .linkpop small{display:block;color:var(--dim);font:600 11.5px/1.5 var(--lab);letter-spacing:.08em;text-transform:uppercase}
.ask .shipbox{flex:0 0 42%;min-width:0;display:flex;flex-direction:column;gap:12px;position:relative}
.ask .shipbox>section>div:last-of-type{opacity:.45}
.ask .shipbox:hover>section>div:last-of-type,.ask .shipbox:focus-within>section>div:last-of-type{opacity:1}
.ask .lstate{display:flex;align-items:center;gap:9px;color:var(--dim);font-size:16px}
.ask .lstate i{width:11px;height:11px;border-radius:50%;flex:none}
.ask .lstate b{color:var(--text);font:600 14px/1 var(--lab);letter-spacing:.08em;text-transform:uppercase}
.ask .last{display:flex;flex-direction:column;gap:9px}
.ask .nowlab{font:600 14px/1 var(--lab);letter-spacing:.1em;text-transform:uppercase;color:#B8AB9B}
.ask p.now{margin:0;color:var(--dim);font-size:16.5px;text-wrap:balance}
.ask .sitrow{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;padding:10px 0 0;border-top:1px solid var(--line);min-height:44px}
.ask .sit{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;color:var(--dim);font-size:16px;padding-left:35px}
.ask .sit .lab{color:var(--text)}
.ask .link.have{color:#B8AB9B}
.ask .link.have .ck{color:var(--text);font-style:normal}
.ask .sit.out{gap:6px 26px;padding-left:0}
.ask .sit .clip{display:contents}
.ask .sit .words{margin-left:-11px}
.ask .sit .words::before{content:"· "}
.ask .sit .picks.act{color:#A89C8E;border-color:#5A5258}
.ask .picks.none{opacity:.65;cursor:default}
.ask .br{display:none}
.ask .pips{display:inline-flex;gap:7px}
.ask .pips i{width:13px;height:13px;border-radius:50%;border:1.5px solid #8F8477}
.ask .pips i.done{background:var(--text);border-color:var(--text)}
.ask .pips i.cur{border-color:var(--peach);box-shadow:0 0 0 2px #000,0 0 0 3.5px var(--peach)}
.ask .pips i.skip{border-style:dashed;opacity:.7}
.ask .big{font:500 36px/1.16 var(--body);margin:0}
.ask .donecol{display:flex;flex-direction:column;gap:18px;min-height:0}
.ask .opts.more{margin-top:16px;gap:22px;align-items:baseline}
.ask .opts.more .lab,.ask .opts.more .link{color:var(--dim)}
.ask .answers{display:flex;flex-direction:column;gap:8px;padding-left:31px}
.ask .answers ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ask .answers li{display:grid;grid-template-columns:230px minmax(0,1.2fr) minmax(0,1fr);gap:0 18px;font-size:16.5px;color:var(--dim)}
.ask .answers li b{color:var(--text);font-weight:600}
.ask .answers .aa{color:#FFF4DC}
.ask .answers .aa i{font-style:normal;color:#B8AB9B}
.ask .answers li.a-skip .aa,.ask .answers li.a-grill .aa{color:#B8AB9B}
@media (prefers-reduced-motion:reduce){.ask .card{animation:none}}
@media (max-width:760px){
.ask .stage,.frame.v-ask .ask .stage{display:flex;padding:4px 0 120px;gap:8px}
.ask .card{gap:8px 11px;position:relative;flex-wrap:wrap}
.ask .cbar{flex-basis:5px}
.ask .cmain{gap:8px;flex:1 1 0}
.ask .qa,.frame.v-ask .ask .card:not(.calm) .qa{gap:6px;min-height:0}
.ask .shipbox{position:absolute;top:0;right:0;width:112px;flex:none;gap:0}
.ask .shipbox>section{min-height:0!important;gap:0!important}
.ask .shipbox pre{font-size:6px!important}
.ask .shipbox>section>:not(:first-child),.ask .lstate,.ask .last{display:none}
.ask .ctop{padding-right:116px;gap:6px 10px;line-height:1.2}
.ask .who{font-size:18px}
.ask .age{font-size:15px;flex-wrap:wrap;gap:2px 10px}
.ask .agebar i{width:10px}
.ask .q{font-size:25px}
.ask .why{font-size:16.5px}
.ask .big{font-size:27px}
.ask .opts,.ask .opts.col{display:flex;flex-direction:column;align-items:stretch;gap:8px}
.ask .opts.more{flex-direction:row;flex-wrap:wrap;gap:6px 16px}
.ask .opt{font-size:18.5px;min-height:46px;padding:0 16px 0 0}
.ask .ol{flex-direction:column;align-items:flex-start;gap:2px;padding:9px 0}
.ask .ownans{max-width:none}
.ask .ownans input{min-width:0}
.ask .hint{font-size:15px;gap:10px 18px}
.ask .link{padding:15px 0}
.ask .hint .link:not(.go),.ask .link.act{padding:11px 12px;line-height:1}
.ask .hint .link.go{border:none;border-radius:0;padding:6px 0;background:linear-gradient(#5E5560,#5E5560) no-repeat 0 calc(100% + 5px)/100% 1px;background-origin:content-box}
.ask .answers{padding-left:16px}
.ask .answers li{grid-template-columns:1fr}
.ask .sitrow{position:fixed;left:0;right:0;bottom:calc(73px + env(safe-area-inset-bottom));z-index:5;background:#000;margin:0;padding:6px 14px 2px;gap:0 12px;align-items:center;justify-content:flex-start}
.ask .sitrow::before{content:"";position:absolute;left:0;right:0;bottom:calc(100% + 1px);height:18px;background:linear-gradient(#0000,#000);pointer-events:none}
.ask .sit,.ask .sit.out{display:contents}
.ask .sit .lab{display:none}
.ask .sit .link{padding:15px 0}
.ask .sitrow .link.act{padding:10px 9px}
.ask .sit.out .picks{order:3;margin-left:auto}
.ask .sit.out .more{order:4}
.ask .sitrow .br{display:block;flex-basis:100%;height:0;order:5}
.ask .sit .of{order:6}
.ask .sit .words{order:7;margin-left:-8px}
.ask .sit .clip{display:flex;align-items:center;gap:0 12px;order:8;margin-left:auto;min-height:30px}
.ask .sit .hid{order:9;flex-basis:100%;font-size:14px}
}`;
