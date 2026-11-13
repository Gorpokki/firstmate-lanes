import React,{useEffect,useRef,useState} from 'react';
import {MODES} from './ascii3d';
import {deriveFleet,toggleShown,YARD_SHOWN} from './fleet-model';
import {Holo,setShipView,useShipView} from './Holo';
import {assignedShip,type ShipMesh} from './mesh-catalog';
import {Shipyard,type YardCamera} from './Shipyard';
import {YARD_HELP,YARD_KEY} from './shipyard-model';
import {laneWords,stateColors,type Fleet,type Lane} from './stations';

type Props={fleet:Fleet;meshes:ShipMesh[];selected:string;motion:boolean;flash:string[];onSelect:(id:string)=>void;onOpen:(id:string)=>void};
const Key=({k}:{k:string})=><kbd className="k">{k}</kbd>;
const fieldKey=(e:KeyboardEvent)=>e.metaKey||e.ctrlKey||e.altKey||e.repeat||(e.target instanceof HTMLElement&&!!e.target.closest('input,textarea,select,[contenteditable=true]'));

// The Fleet station: the heat grid (each lane a tile, grouped by state; the holding lanes in their own quiet row, h) or the
// shipyard (b), with the selected lane's ship turning in the side panel. Motion off stops the flashes and the drones; the
// ship's own spin is its own switch.
export function FleetStation({fleet,meshes,selected,motion,flash,onSelect,onOpen}:Props){
 const [yard,setYard]=useState(false),[top,setTop]=useState(true),[hold,setHold]=useState(false),[shown,setShown]=useState(YARD_SHOWN);
 const view=useShipView(),camera=useRef<YardCamera>(null);
 const {rows,groups,hold:held,parked,quiet,shares}=deriveFleet(fleet),sel=rows.find(lane=>lane.id===selected);
 useEffect(()=>{
  const keys:Record<string,()=>void>={b:()=>setYard(on=>!on),...(yard?{t:()=>setTop(on=>!on)}:{h:()=>setHold(on=>!on)})};
  const key=(e:KeyboardEvent)=>{const run=keys[e.key];if(!run||fieldKey(e))return;e.preventDefault();run();};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[yard]);
 const tile=(lane:Lane)=><button key={lane.id} type="button" aria-pressed={lane.id===selected}
  className={`tile${lane.state==='holding'?' grey':lane.state==='needs you'?'':' soft'}${lane.id===selected?' sel':''}${motion&&flash.includes(lane.id)?' flash':''}${lane.state==='working'?motion?' work':' work stop':''}`}
  style={lane.state==='holding'?undefined:{'--c':stateColors[lane.state]} as React.CSSProperties}
  onClick={()=>onSelect(lane.id)} onDoubleClick={()=>onOpen(lane.id)} title={`${lane.name}: ${lane.state}`}>
  <span>{lane.name}</span>{lane.asks.length>0&&<b>{lane.asks.length}</b>}
 </button>;
 const ship=sel?assignedShip(sel.id,meshes):undefined;
 return <section className="fleet-station" aria-label="Fleet">
  <div className="vtitle">
   <span className="lab">Fleet · {rows.length} {rows.length===1?'lane':'lanes'}</span>
   <span className="seg2" role="group" aria-label="Fleet display"><button type="button" className={yard?'':'on'} aria-pressed={!yard} onClick={()=>setYard(false)}>Heat grid</button><button type="button" className={yard?'on':''} aria-pressed={yard} onClick={()=>setYard(true)}>Shipyard</button></span><Key k="b"/>
   {yard&&<>
    <span className="seg2" role="group" aria-label="Yard camera"><button type="button" className={top?'':'on'} aria-pressed={!top} onClick={()=>setTop(false)}>Angle</button><button type="button" className={top?'on':''} aria-pressed={top} onClick={()=>setTop(true)}>Top</button></span><Key k="t"/>
    <span className="seg2 cam" role="group" aria-label="Yard zoom"><button type="button" aria-label="Farther" onClick={()=>camera.current?.zoom('out')}>−</button><button type="button" aria-label="Nearer" onClick={()=>camera.current?.zoom('in')}>+</button><button type="button" onClick={()=>camera.current?.fit()}>fit all</button></span>
    <span className="seg2" role="group" aria-label="Ship view">{MODES.map(([m,label])=><button key={m} type="button" className={view.mode===m?'on':''} aria-pressed={view.mode===m} onClick={()=>setShipView({mode:m})}>{label}</button>)}</span><Key k="v"/>
   </>}
   <span className="sp"/><span>{yard?<>{YARD_KEY[0]}<br/>{YARD_KEY[1]}</>:'a number: open asks'}</span>
  </div>
  {yard&&<div className="yardbar" role="group" aria-label="The share of each lane state; a click shows or hides its ships">
   {shares.map(({state,label,count})=><button key={state} type="button" className={shown.includes(state)?'on':''} aria-pressed={shown.includes(state)} style={{flexGrow:count,'--c':stateColors[state]} as React.CSSProperties} onClick={()=>setShown(old=>toggleShown(old,state))} title={`${count} of ${rows.length} lanes: ${label}. Click: ${shown.includes(state)?'hide':'show'} their ships`}><b>{count}</b> {label}</button>)}
   <span>{YARD_HELP}</span>
  </div>}
  <div className="fleet">
   <div className="left">
    {yard?<Shipyard ref={camera} lanes={rows.filter(lane=>shown.includes(lane.state))} meshes={meshes} selected={selected} top={top} mode={view.mode} motion={motion} onPick={onSelect}/>
     :groups.map(group=><React.Fragment key={group.state}><div className="grp"><span className="lab">{group.label} · {group.lanes.length}</span></div><div className="tiles">{group.lanes.map(tile)}</div></React.Fragment>)}
    {!yard&&<div className="hold">
     <button type="button" className="link" aria-expanded={hold} onClick={()=>setHold(on=>!on)}>Holding · {held.length} {hold?'▾':'▸'}<Key k="h"/></button>
     <span>{parked} parked, {quiet} gone quiet</span>
     {!hold&&<span className="dots" aria-hidden="true">{held.map(lane=><i key={lane.id}/>)}</span>}
    </div>}
    {!yard&&hold&&<div className="tiles held">{held.map(tile)}</div>}
   </div>
   {sel&&<aside className="panel" aria-label="Selected lane">
    <Holo key={sel.id} mesh={ship?.mesh} state={sel.state} sourceState={sel.sourceState} progress={sel.progress} name={ship?.name||'No admitted ship'}/>
    <h2>{sel.name}</h2>
    <div className="state"><i style={{background:stateColors[sel.state]}}/><b>{sel.state}</b></div>
    <p className="sw">{laneWords(sel)}</p>
    {sel.now&&<><span className="nowlab">Crew's last word</span><p>{sel.now}</p></>}
    <div><button type="button" className="link" onClick={()=>onOpen(sel.id)}>open the lane ▸<Key k="enter"/></button></div>
   </aside>}
  </div>
 </section>;
}
