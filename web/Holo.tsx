import React,{useEffect,useMemo,useRef,useState} from 'react';
import {spinFrameDue,spinTicks} from './animation-budget';
import {usePageHidden} from './page-visibility';
import {fractureDuration} from './simulation-model';
import {renderHolo,type RenderOptions,type TriangleMesh} from './holo-renderer';

type HoloProps={mesh?:TriangleMesh;state:string;sourceState?:string;progress?:number;name:string;idle?:boolean;options?:(Pick<RenderOptions,'blocks'|'fragments'|'mode'|'fractureElapsed'>&{failed?:boolean})};
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
type Options=HoloProps['options'];
const failureRe=/failed|failure|error/i;
const isFailed=(state:string,sourceState:string|undefined,options:Options)=>options?.failed??(failureRe.test(state)||failureRe.test(sourceState??'')||(options?.fragments??0)>0);
const stateProgress=(state:string)=>state==='done'?1:state==='needs you'||state==='working'?.72:state==='waiting'?.48:state==='holding'?.35:.55;
const spaceToggles=(event:KeyboardEvent)=>{const target=event.target;return event.code==='Space'&&!event.repeat&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!(target instanceof HTMLElement&&target.closest('input,textarea,select,button'));};
function useHostGestures(host:React.RefObject<HTMLDivElement|null>,setSize:React.Dispatch<React.SetStateAction<{width:number;height:number}>>,setZoom:React.Dispatch<React.SetStateAction<number>>){
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const observer=new ResizeObserver(entries=>{const width=Math.max(24,Math.floor(entries[0].contentRect.width/8)),height=Math.max(12,Math.floor(width*.38));setSize(old=>old.width===width&&old.height===height?old:{width,height});});
  const wheel=(event:WheelEvent)=>{event.preventDefault();setZoom(value=>Math.max(.55,Math.min(2.5,value-event.deltaY*.001)));};
  observer.observe(element);element.addEventListener('wheel',wheel,{passive:false});
  return()=>{observer.disconnect();element.removeEventListener('wheel',wheel);};
 },[]);
}
function useSpin(idle:boolean|undefined,setAngle:React.Dispatch<React.SetStateAction<{yaw:number;pitch:number}>>){
 const [spinning,setSpinning]=useState(()=>!reducedMotion());
 const hidden=usePageHidden();
 useEffect(()=>{setSpinning(!idle&&!reducedMotion());},[idle]);
 useEffect(()=>{if(!spinTicks({hidden,spinning}))return;let frame=0,last=0;const tick=(time:number)=>{if(spinFrameDue(time,last)){setAngle(current=>({...current,yaw:current.yaw+.025}));last=time;}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[hidden,spinning]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(spaceToggles(event)){event.preventDefault();setSpinning(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 return [spinning,setSpinning] as const;
}
function useAutoFracture(failed:boolean,provided:number|undefined){
 const [elapsed,setElapsed]=useState<number|null>(null);
 useEffect(()=>{
  if(!failed){setElapsed(null);return;}
  if(provided!==undefined)return;
  const started=performance.now();setElapsed(0);let frame=0;
  const tick=()=>{const elapsed=Math.min(fractureDuration,performance.now()-started);setElapsed(elapsed);if(elapsed<fractureDuration)frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[failed,provided]);
 return elapsed;
}
function useDragRotate(setAngle:React.Dispatch<React.SetStateAction<{yaw:number;pitch:number}>>){
 const drag=useRef<{x:number;y:number}|null>(null);
 const start=(event:React.PointerEvent)=>{drag.current={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);};
 const move=(event:React.PointerEvent)=>{if(!drag.current)return;const dx=event.clientX-drag.current.x,dy=event.clientY-drag.current.y;drag.current={x:event.clientX,y:event.clientY};setAngle(a=>({yaw:a.yaw+dx*.012,pitch:Math.max(-1.35,Math.min(1.35,a.pitch+dy*.012))}));};
 const end=()=>{drag.current=null;};
 return {start,move,end};
}
function HoloControls({spinning,setSpinning,setZoom}:{spinning:boolean;setSpinning:React.Dispatch<React.SetStateAction<boolean>>;setZoom:React.Dispatch<React.SetStateAction<number>>}){
 return <div><button type="button" aria-label={spinning?'Stop ship spin':'Start ship spin'} onClick={()=>setSpinning(value=>!value)}>{spinning?'Pause spin':'Spin'}</button><button type="button" aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.55,value-.15))}>−</button><button type="button" aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(2.5,value+.15))}>+</button></div>;
}
const shipColor=(blocks:boolean|undefined,state:string)=>blocks?'#ff6464':state==='holding'?'#b6a4c7':'#8fe6ff';
function ShipText({frame,blocks,state,zoom}:{frame:string;blocks?:boolean;state:string;zoom:number}){
 return <pre aria-label="Rendered ship" className={blocks?'holo-blocked':undefined} style={{margin:0,color:shipColor(blocks,state),fontSize:`${12*zoom}px`,lineHeight:1,whiteSpace:'pre',textShadow:'0 0 8px currentColor'}}>{frame}</pre>;
}
const BlockedFlicker=()=><style>{'@keyframes holo-flicker{50%{opacity:.35}}@media(prefers-reduced-motion:no-preference){.holo-blocked{animation:holo-flicker .3s steps(2,end) infinite}}'}</style>;
export function Holo({mesh,state,sourceState,progress,name,idle,options}:HoloProps){
 const [angle,setAngle]=useState({yaw:0,pitch:.16}),[zoom,setZoom]=useState(1),[size,setSize]=useState({width:72,height:27}),host=useRef<HTMLDivElement>(null);
 const failed=isFailed(state,sourceState,options);
 useHostGestures(host,setSize,setZoom);
 const {start,move,end}=useDragRotate(setAngle);
 const [spinning,setSpinning]=useSpin(idle,setAngle);
 const autoFractureElapsed=useAutoFracture(failed,options?.fractureElapsed);
 const renderProgress=progress??stateProgress(state);
 const fractureElapsed=options?.fractureElapsed??(failed?autoFractureElapsed??0:undefined);
 const {blocks,fragments,mode}=options??{};
 const frame=useMemo(()=>mesh?renderHolo(mesh,{...size,yaw:angle.yaw,pitch:angle.pitch,progress:renderProgress,blocks,fragments,mode,fractureElapsed}):'No admitted ship',[mesh,size,angle,renderProgress,blocks,fragments,mode,fractureElapsed]);
 return <section aria-label="Holo view" style={{display:'flex',flexDirection:'column',width:'100%',alignItems:'center',justifyContent:'center',gap:12,minHeight:340,overflow:'hidden'}}>
  <div ref={host} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={()=>{setZoom(1);setAngle({yaw:0,pitch:.16});}} style={{width:'min(100%,760px)',touchAction:'none',cursor:'grab',overflow:'hidden'}}>
   <ShipText frame={frame} blocks={options?.blocks} state={state} zoom={zoom}/>
  </div><strong>{name}</strong>
  <HoloControls spinning={spinning} setSpinning={setSpinning} setZoom={setZoom}/>
  {options?.blocks&&<BlockedFlicker/>}
 </section>;
}
