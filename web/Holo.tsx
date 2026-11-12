import React,{useEffect,useRef,useState} from 'react';
import {fractureDuration} from './simulation-model';
import {renderHolo,type RenderOptions,type TriangleMesh} from './holo-renderer';

type HoloProps={mesh?:TriangleMesh;state:string;sourceState?:string;progress?:number;name:string;options?:(Pick<RenderOptions,'blocks'|'fragments'|'mode'|'fractureElapsed'>&{failed?:boolean})};
export function Holo({mesh,state,sourceState,progress,name,options}:HoloProps){
 const [angle,setAngle]=useState({yaw:0,pitch:.16}),[spinning,setSpinning]=useState(true),[zoom,setZoom]=useState(1),[size,setSize]=useState({width:72,height:27}),[autoFractureElapsed,setAutoFractureElapsed]=useState<number|null>(null),host=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number}|null>(null);
 const failed=options?.failed??(/failed|failure|error/i.test(state)||/failed|failure|error/i.test(sourceState??'')||(options?.fragments??0)>0);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const observer=new ResizeObserver(entries=>{const width=Math.max(24,Math.floor(entries[0].contentRect.width/8)),height=Math.max(12,Math.floor(width*.38));setSize(old=>old.width===width&&old.height===height?old:{width,height});});
  const wheel=(event:WheelEvent)=>{event.preventDefault();setZoom(value=>Math.max(.55,Math.min(2.5,value-event.deltaY*.001)));};
  observer.observe(element);element.addEventListener('wheel',wheel,{passive:false});
  return()=>{observer.disconnect();element.removeEventListener('wheel',wheel);};
 },[]);
 useEffect(()=>{if(!spinning)return;let frame=0,last=0;const tick=(time:number)=>{if(time-last>45){setAngle(current=>({...current,yaw:current.yaw+.025}));last=time;}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[spinning]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{const target=event.target;if(event.code==='Space'&&!event.repeat&&!(target instanceof HTMLElement&&target.closest('input,textarea,select,button'))){event.preventDefault();setSpinning(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 useEffect(()=>{
  if(!failed){setAutoFractureElapsed(null);return;}
  if(options?.fractureElapsed!==undefined)return;
  const started=performance.now();setAutoFractureElapsed(0);let frame=0;
  const tick=()=>{const elapsed=Math.min(fractureDuration,performance.now()-started);setAutoFractureElapsed(elapsed);if(elapsed<fractureDuration)frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[failed,options?.fractureElapsed]);
 const renderProgress=progress??(state==='done'?1:state==='needs you'||state==='working'?.72:state==='waiting'?.48:state==='holding'?.35:.55);
 const fractureElapsed=options?.fractureElapsed??(failed?autoFractureElapsed??0:undefined);
 const frame=mesh?renderHolo(mesh,{...size,yaw:angle.yaw,pitch:angle.pitch,progress:renderProgress,...options,fractureElapsed}):'No admitted ship';
 const start=(event:React.PointerEvent)=>{drag.current={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);};
 const move=(event:React.PointerEvent)=>{if(!drag.current)return;const dx=event.clientX-drag.current.x,dy=event.clientY-drag.current.y;drag.current={x:event.clientX,y:event.clientY};setAngle(a=>({yaw:a.yaw+dx*.012,pitch:Math.max(-1.35,Math.min(1.35,a.pitch+dy*.012))}));};
 return <section aria-label="Holo view" style={{display:'flex',flexDirection:'column',width:'100%',alignItems:'center',justifyContent:'center',gap:12,minHeight:340,overflow:'hidden'}}>
  <div ref={host} onPointerDown={start} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onDoubleClick={()=>{setZoom(1);setAngle({yaw:0,pitch:.16});}} style={{width:'min(100%,760px)',touchAction:'none',cursor:'grab',overflow:'hidden'}}>
   <pre aria-label="Rendered ship" style={{margin:0,color:options?.blocks?'#ff6464':state==='holding'?'#b6a4c7':'#8fe6ff',fontSize:`${12*zoom}px`,lineHeight:1,whiteSpace:'pre',textShadow:'0 0 8px currentColor',animation:options?.blocks?'holo-flicker .3s steps(2,end) infinite':undefined}}>{frame}</pre>
  </div><strong>{name}</strong>
  <div><button type="button" aria-label={spinning?'Stop ship spin':'Start ship spin'} onClick={()=>setSpinning(value=>!value)}>{spinning?'Pause spin':'Spin'}</button><button type="button" aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.55,value-.15))}>−</button><button type="button" aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(2.5,value+.15))}>+</button></div>
  {options?.blocks&&<style>{'@keyframes holo-flicker{50%{opacity:.35}}'}</style>}
 </section>;
}
