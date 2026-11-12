import React,{useEffect,useRef,useState} from 'react';
import {renderHolo} from './holo-renderer';
import {states,type Lane} from './stations';
import {deriveShipyardRows,layoutShipyard} from './shipyard-model';
import type {ShipMesh} from './mesh-catalog';

type FleetState=typeof states[number];
type ShipyardProps={lanes:Lane[];meshes?:ShipMesh[];selected?:string;filter?:FleetState|null;motion:boolean;onSelect:(lane:Lane)=>void};
type Point={x:number;y:number;originX:number;originY:number;pointerType:string;shift:boolean};
type Camera={x:number;y:number;zoom:number;yaw:number;pitch:number};
const initialCamera:Camera={x:0,y:0,zoom:1,yaw:0,pitch:.16};
const colors:Record<string,string>={'needs you':'#ff967b',waiting:'#e9bd72',working:'#82c8ed',done:'#98d3a4',holding:'#b6a4c7'};

export function Shipyard({lanes,meshes=[],selected='',filter=null,motion,onSelect}:ShipyardProps){
 const host=useRef<HTMLDivElement>(null),pointers=useRef(new Map<number,Point>()),lastTouchTap=useRef<{time:number;x:number;y:number}|null>(null),pinch=useRef<{distance:number;angle:number;center:{x:number;y:number}}|null>(null),dragged=useRef(false);
 const [size,setSize]=useState({width:640,height:420}),[camera,setCamera]=useState(initialCamera);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const observer=new ResizeObserver(entries=>{const {width,height}=entries[0]!.contentRect;setSize(old=>old.width===width&&old.height===height?old:{width,height});});
  const wheel=(event:WheelEvent)=>{event.preventDefault();setCamera(value=>({...value,zoom:Math.max(.45,Math.min(2.8,value.zoom-event.deltaY*.001))}));};
  observer.observe(element);element.addEventListener('wheel',wheel,{passive:false});
  return()=>{observer.disconnect();element.removeEventListener('wheel',wheel);};
 },[]);
 const rows=deriveShipyardRows(lanes,meshes,filter),layout=layoutShipyard(rows,size.width,size.height,selected,camera),selectedLane=lanes.find(lane=>lane.id===selected);
 const reset=()=>setCamera(initialCamera);
 const pointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
  const selecting=event.target instanceof Element?event.target.closest('.shipyard-select'):null;
  if(pointers.current.size===0)dragged.current=false;
  (selecting??event.currentTarget).setPointerCapture(event.pointerId);
  pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY,originX:event.clientX,originY:event.clientY,pointerType:event.pointerType,shift:event.shiftKey});
  if(event.pointerType==='touch'&&pointers.current.size===2){
   dragged.current=true;lastTouchTap.current=null;
   const points=[...pointers.current.values()];
   pinch.current={distance:Math.max(1,Math.hypot(points[1]!.x-points[0]!.x,points[1]!.y-points[0]!.y)),angle:Math.atan2(points[1]!.y-points[0]!.y,points[1]!.x-points[0]!.x),center:{x:(points[0]!.x+points[1]!.x)/2,y:(points[0]!.y+points[1]!.y)/2}};
  }
 };
 const pointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
  const previous=pointers.current.get(event.pointerId);if(!previous)return;
  const current={...previous,x:event.clientX,y:event.clientY,shift:event.shiftKey};pointers.current.set(event.pointerId,current);
  if(event.pointerType==='touch'&&pointers.current.size===2){
   const points=[...pointers.current.values()],distance=Math.max(1,Math.hypot(points[1]!.x-points[0]!.x,points[1]!.y-points[0]!.y)),angle=Math.atan2(points[1]!.y-points[0]!.y,points[1]!.x-points[0]!.x),center={x:(points[0]!.x+points[1]!.x)/2,y:(points[0]!.y+points[1]!.y)/2};
   const old=pinch.current;pinch.current={distance,angle,center};
   if(old)setCamera(value=>({...value,x:value.x+center.x-old.center.x,y:value.y+center.y-old.center.y,zoom:Math.max(.45,Math.min(2.8,value.zoom*distance/old.distance)),yaw:value.yaw+(angle-old.angle),pitch:Math.max(-1.2,Math.min(1.2,value.pitch+(center.y-old.center.y)*.004))}));
  }else{
   if(!dragged.current&&Math.hypot(current.x-current.originX,current.y-current.originY)<6)return;
   const dx=current.x-(dragged.current?previous.x:current.originX),dy=current.y-(dragged.current?previous.y:current.originY);dragged.current=true;
   if(event.pointerType==='mouse'&&(event.shiftKey||previous.shift))setCamera(value=>({...value,yaw:value.yaw+dx*.01,pitch:Math.max(-1.2,Math.min(1.2,value.pitch+dy*.01))}));
   else setCamera(value=>({...value,x:value.x+dx,y:value.y+dy}));
  }
 };
 const pointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{
  const point=pointers.current.get(event.pointerId);pointers.current.delete(event.pointerId);if(pointers.current.size<2)pinch.current=null;
  if(event.type==='pointerup'&&point?.pointerType==='touch'&&!dragged.current&&pointers.current.size===0){
   const now=Date.now(),last=lastTouchTap.current;
   if(last&&now-last.time<320&&Math.hypot(event.clientX-last.x,event.clientY-last.y)<24){reset();lastTouchTap.current=null;}
   else lastTouchTap.current={time:now,x:event.clientX,y:event.clientY};
  }
 };
 return <section className="shipyard" aria-label="Shipyard">
 <style>{`.shipyard{--yard-border:#596171;color:#e8edf5}.shipyard-stage{position:relative;height:min(65vh,680px);min-height:320px;overflow:hidden;border:1px solid var(--yard-border);border-radius:14px;background:radial-gradient(ellipse at center,#1d2a39,#10151d 75%);touch-action:none;cursor:grab;user-select:none}.shipyard-stage:active{cursor:grabbing}.shipyard-camera{position:absolute;inset:0;transform-origin:center center;will-change:transform}.shipyard-cell{position:absolute;width:180px;height:150px;transform:translate(-50%,-50%);display:grid;place-items:center}.shipyard-cage{position:relative;width:156px;height:112px;border:1px solid #64768a;border-radius:7px;box-shadow:inset 0 0 20px #82c8ed12,0 0 12px #82c8ed12;display:grid;place-items:center;background:linear-gradient(135deg,#ffffff08,transparent 55%)}.shipyard-cage:before,.shipyard-cage:after{content:'';position:absolute;inset:8px;border:1px dashed #64768a55;pointer-events:none}.shipyard-cage:after{inset:0 50%;border:0;border-left:1px solid #64768a35}.shipyard-ship{font:8px/1 monospace;white-space:pre;margin:0;text-align:center;text-shadow:0 0 6px currentColor}.shipyard-label{position:absolute;top:119px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 7px;border-radius:8px;background:#111923dd;font-size:12px}.shipyard-select{position:absolute;inset:0;border:0;background:transparent;color:inherit;cursor:pointer}.shipyard-select:focus-visible{outline:3px solid #82c8ed;outline-offset:3px}.shipyard-drone{position:absolute;z-index:2;top:5px;left:7px;width:9px;height:7px;border:1px solid #d7f4ff;border-radius:3px;background:#82c8ed;box-shadow:0 0 8px #82c8ed;pointer-events:none;animation:shipyard-flight 2.8s ease-in-out infinite alternate}.shipyard-drone:after{content:'';position:absolute;top:6px;left:3px;width:2px;height:54px;background:linear-gradient(#82c8ed,transparent);opacity:0;transform-origin:top;animation:shipyard-zap 1.4s steps(2,end) infinite}.shipyard-stage[data-motion=false] .shipyard-drone{display:none}@keyframes shipyard-flight{to{transform:translate(130px,15px)}}@keyframes shipyard-zap{50%{opacity:.9;transform:scaleY(.65)}}`}</style>
  <div ref={host} className="shipyard-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onDoubleClick={reset} data-motion={motion}>
   <div className="shipyard-camera" style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}>
    {layout.map(({row,x,y,showLabel})=>{
     const state=row.lane.state,color=colors[state]??'#8fe6ff',progress=row.lane.progress;
     const mesh=row.mesh;
     return <div className="shipyard-cell" key={row.lane.id} style={{left:x,top:y} as React.CSSProperties}>
      <div className="shipyard-cage" style={{borderColor:`${color}aa`}}>
       <pre className="shipyard-ship" aria-hidden="true" style={{color}}>{mesh?renderHolo(mesh,{width:28,height:13,yaw:camera.yaw,pitch:camera.pitch,progress}):'No admitted ship'}</pre>
       {motion&&state==='working'&&<span className="shipyard-drone" aria-hidden="true"/>}
      </div>
      {showLabel&&row.lane.id!==selected&&<span className="shipyard-label">{row.lane.name}</span>}
      <button className="shipyard-select" type="button" style={{background:'transparent',border:0}} aria-label={`${row.lane.name}, ${state}${row.meshName?`, ${row.meshName}`:''}`} aria-pressed={selected===row.lane.id} onClick={event=>{if(event.detail>0&&dragged.current)return;onSelect(row.lane);}}/>
     </div>;
    })}
   </div>
   {selectedLane&&<span aria-live="polite" style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',zIndex:3,maxWidth:'90%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',padding:'4px 10px',borderRadius:10,background:'#111923dd',pointerEvents:'none'}}>{selectedLane.name}</span>}
  </div>
 </section>;
}
