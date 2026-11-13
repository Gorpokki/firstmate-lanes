import React from 'react';
import type {Lane} from './stations';
import {Holo} from './Holo';
import {readOnlyReason} from './sitting';
import type {TriangleMesh} from './holo-renderer';

type AskDetails={topic?:string;must_decide?:string[];choices?:{label:string;effect:string}[]};

export function LaneStation({lane,mesh,shipName}:{lane:Lane;mesh?:TriangleMesh;shipName?:string}){
 const now=Date.now();
 const history=lane.history.map((item,index)=>{
  const start=Date.parse(item.at),end=index+1<lane.history.length?Date.parse(lane.history[index+1].at):now;
  const duration=Number.isFinite(start)&&Number.isFinite(end)&&start>0?Math.max(0,end-start):0;
  return {...item,duration};
 });
 const duration=(ms:number)=>ms<60000?`${Math.floor(ms/1000)}s`:ms<3600000?`${Math.floor(ms/60000)}m`:`${Math.floor(ms/3600000)}h`;
 const sourceState=lane.sourceState?.toLowerCase()||'';
 const blocked=/blocked|block/.test(sourceState),failed=/failed|failure|error/.test(sourceState);
 return <section aria-label={`Lane ${lane.name}`}>
  <h2>{lane.name}</h2>
  <Holo mesh={mesh} state={lane.state} progress={lane.progress} name={shipName||'No admitted ship'} options={{blocks:blocked,fragments:failed?1:0}}/>
  <h2>Crew's last word</h2><p>{lane.now||'No status line yet.'}</p>
  <h2>Status log</h2><ol>{history.toReversed().map((item,index)=><li key={`${item.at}-${index}`}>{Date.parse(item.at)>0?<time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>:'time unknown'} · {item.state} · {duration(item.duration)} · {item.text}</li>)}</ol>
  <h2>Asks</h2>{lane.asks.length?<ul>{lane.asks.map(ask=>{
   const details=ask as typeof ask&AskDetails,asked=Date.parse(ask.asked),known=Number.isFinite(asked)&&asked>0;
   return <li key={ask.key}><strong>{details.question||details.topic||ask.form}</strong>{ask.reason&&<p>{ask.reason}</p>}{!ask.answerable&&<p>{readOnlyReason(lane,ask)}</p>}{details.must_decide?.length?<ul>{details.must_decide.map(decision=><li key={decision}>{decision}</li>)}</ul>:null}{details.choices?.length?<ul>{details.choices.map((choice,index)=><li key={`${index}-${choice.label}`}><strong>{choice.label}</strong> — {choice.effect}</li>)}</ul>:null}{known?<time dateTime={ask.asked}>{new Date(ask.asked).toLocaleString()}</time>:<p>asked time unknown</p>}</li>;
  })}</ul>:<p>No asks.</p>}
 </section>;
}
