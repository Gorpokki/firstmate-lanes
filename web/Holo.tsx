import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {spinFrameDue,spinTicks} from './animation-budget';
import {usePageHidden} from './page-visibility';
import {INNERS,MODES,frame,paint,render,shipMesh,type Frame,type Inner,type Mode,type Scene} from './ascii3d';
import {CAR0,SPIN,blastFrame,blastPhase,carouselCam,carouselScene,startBlast,type Blast,type BlastPhase} from './scenes';
import {stateColors} from './stations';
import type {TriangleMesh} from './holo-renderer';

// blast: a key that starts the ship's explosion (stress, rupture, drifting debris); a new key starts it again.
// paused: the ship holds still, its explosion too. idle: the spin stops. turnKeys: the arrow keys turn the ship.
type HoloProps={mesh?:TriangleMesh;state:string;sourceState?:string;progress?:number;name:string;idle?:boolean;options?:{blocks?:boolean;fragments?:number;failed?:boolean};blast?:number|null;paused?:boolean;onPhase?:(phase:BlastPhase)=>void;turnKeys?:boolean};
const MONO="Menlo, 'SF Mono', Consolas, monospace",FONT_PX=6;
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const failureRe=/failed|failure|error/i;
const isFailed=(state:string,sourceState:string|undefined,options:HoloProps['options'])=>options?.failed??(failureRe.test(state)||failureRe.test(sourceState??'')||(options?.fragments??0)>0);
const isBlocked=(sourceState:string|undefined,options:HoloProps['options'])=>options?.blocks??/block/i.test(sourceState??'');
// How far a lane's hull is built, by its state: blocked and failed builds stop at half.
export const buildOf=(state:string,blocked:boolean,failed:boolean,progress?:number)=>progress??(blocked||failed?.5:state==='done'?1:state==='needs you'||state==='waiting'?.72:state==='working'?.6:.45);
const fieldKey=(event:KeyboardEvent)=>event.metaKey||event.ctrlKey||event.altKey||(event.target instanceof HTMLElement&&!!event.target.closest('input,textarea,select,[contenteditable=true]'));
const spaceToggles=(event:KeyboardEvent)=>event.code==='Space'&&!event.repeat&&!fieldKey(event)&&!(event.target instanceof HTMLElement&&event.target.closest('button'));
// the ship's colours: a light tone of its state colour; the unbuilt hull's wire and fill in darker tones of it
const shipHex=(hex:string)=>'#'+[1,3,5].map((i,k)=>Math.round(parseInt(hex.slice(i,i+2),16)*.6+[255,230,204][k]*.4).toString(16).padStart(2,'0')).join('');
const shade=(hex:string,k:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(shipHex(hex).slice(i,i+2),16)*k).toString(16).padStart(2,'0')).join('');
const inHue=(scene:Scene,hex:string):Scene=>({...scene,objs:scene.objs.map(o=>({...o,wire:shade(hex,.55),dim:shade(hex,.26)}))});

// ---- the view settings every holo shares: the view mode and the unbuilt hull's fill ----
type ShipView={mode:Mode;inner:Inner};
const VIEW_KEY='lanes.ship-view',viewListeners=new Set<()=>void>(),seenKeys=new WeakSet<Event>();
let shipView:ShipView=(()=>{
 const saved=(()=>{try{return JSON.parse(localStorage.getItem(VIEW_KEY)||'{}');}catch{return {};}})();
 return {mode:MODES.some(([m])=>m===saved.mode)?saved.mode:'lit',inner:INNERS.some(([m])=>m===saved.inner)?saved.inner:'dot'};
})();
export function setShipView(next:Partial<ShipView>){
 shipView={...shipView,...next};
 try{localStorage.setItem(VIEW_KEY,JSON.stringify(shipView));}catch{/* a private window keeps the view for this page only */}
 viewListeners.forEach(listener=>listener());
}
export const useShipView=()=>useSyncExternalStore(listener=>{viewListeners.add(listener);return()=>{viewListeners.delete(listener);};},()=>shipView);
const nextMode=(mode:Mode)=>MODES[(MODES.findIndex(([m])=>m===mode)+1)%MODES.length]![0];

type Pose={yaw:number;pitch:number;zoom:number;left:number;prog:number;blast:Blast|null;key:number|null;t:number;phase:BlastPhase|null};
type Live={mesh?:TriangleMesh;hex:string;status:string;goal:number;mode:Mode;inner:Inner;spinning:boolean;paused:boolean;hidden:boolean;blast:number|null;onPhase?:(phase:BlastPhase)=>void};
type Loop={ctx:CanvasRenderingContext2D|null;f:Frame|null;cw:number;ch:number;w:number;h:number;raf:number;last:number;dirty:boolean};
const blastLive=(live:Live,pose:Pose)=>live.blast!==null&&pose.phase!=='settled';
const animating=(live:Live,pose:Pose)=>!!live.mesh&&!live.paused&&(spinTicks({hidden:live.hidden,spinning:live.spinning})||pose.left!==0||pose.prog!==live.goal||blastLive(live,pose));

function advance(live:Live,pose:Pose,dt:number){
 if(pose.left){const d=Math.sign(pose.left)*Math.min(Math.abs(pose.left),dt*Math.max(.5,Math.min(4,Math.abs(pose.left)*2.5)));pose.yaw+=d;pose.left-=d;} // eases to a stop, either way
 if(live.spinning)pose.yaw+=dt*SPIN;
 pose.prog+=Math.max(-dt*.5,Math.min(dt*.5,live.goal-pose.prog)); // a change of state builds or strips the hull
 if(blastLive(live,pose))pose.t+=dt;
}
// One frame of the ship: the carousel, or its explosion while one runs.
function drawShip(L:Loop,live:Live,pose:Pose){
 if(!L.ctx||!L.f)return;
 if(!live.mesh){L.ctx.clearRect(0,0,L.w*L.cw,L.h*L.ch);return;}
 const m=shipMesh(live.mesh),tone=shipHex(live.hex),V={zoom:pose.zoom,w:L.w,h:L.h,cw:L.cw,ch:L.ch};
 if(live.blast!==pose.key){pose.key=live.blast;pose.t=0;pose.phase=null;pose.blast=live.blast===null?null:startBlast(m,pose.yaw,pose.pitch,Math.floor(live.blast));}
 if(pose.blast&&pose.blast.m!==m)pose.blast=startBlast(m,pose.yaw,pose.pitch,Math.floor(live.blast??0));
 const {scene,cam}=pose.blast?blastFrame(pose.blast,tone,pose.prog,pose.t,pose.yaw,pose.pitch,V,live.inner):{scene:carouselScene(m,live.status,tone,pose.prog,live.inner),cam:carouselCam(m,pose.yaw,pose.pitch,pose.zoom,L.w*L.cw,L.h*L.ch)};
 render(L.f,inHue(scene,live.hex),cam,live.mode);
 paint(L.ctx,L.f,`${FONT_PX}px ${MONO}`,'#000');
 const phase=pose.blast?blastPhase(pose.blast,pose.t,V):null;
 if(phase!==pose.phase){pose.phase=phase;if(phase)live.onPhase?.(phase);}
}
// The canvas and its loop. It draws only while something moves (spin, an eased turn or build, an explosion), at most once
// a spin frame, and once after a change; hidden, it draws nothing until it is shown again.
function useShipCanvas(live:React.MutableRefObject<Live>,pose:React.MutableRefObject<Pose>){
 const canvas=useRef<HTMLCanvasElement>(null),loop=useRef<Loop>({ctx:null,f:null,cw:4,ch:8,w:0,h:0,raf:0,last:0,dirty:true});
 const step=(now:number)=>{
  const L=loop.current,P=pose.current,v=live.current;L.raf=0;
  if(v.hidden){L.last=0;return;}
  const moving=animating(v,P);
  if(moving&&L.last&&!spinFrameDue(now,L.last)){L.raf=requestAnimationFrame(step);return;}
  if(!moving&&!L.dirty){L.last=0;return;}
  if(moving)advance(v,P,L.last?Math.min(.1,(now-L.last)/1000):0);
  L.f=frame(L.f,L.w,L.h,L.cw,L.ch);
  if(!moving)L.f.ex=undefined; // a still frame takes its exposure at once, not eased
  try{drawShip(L,v,P);}catch(error){console.error(error);} // one bad frame never stops a ship that turns
  L.dirty=false;L.last=moving?now:0;
  if(moving)L.raf=requestAnimationFrame(step);
 };
 const kick=(dirty=true)=>{const L=loop.current;L.dirty||=dirty;if(!L.raf&&!live.current.hidden)L.raf=requestAnimationFrame(step);};
 useEffect(()=>{
  const cv=canvas.current!,ctx=cv.getContext('2d');
  const L=loop.current;L.ctx=ctx;
  if(ctx){ctx.font=`${FONT_PX}px ${MONO}`;L.cw=ctx.measureText('M').width||3.6;L.ch=Math.round(FONT_PX*1.25);}
  const fit=()=>{
   const r=cv.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
   cv.width=Math.max(1,r.width*d);cv.height=Math.max(1,r.height*d);ctx?.setTransform(d,0,0,d,0,0);
   L.w=Math.max(4,Math.floor(r.width/L.cw));L.h=Math.max(2,Math.floor(r.height/L.ch));
   kick();
  };
  const observer=new ResizeObserver(fit);observer.observe(cv);fit();
  return()=>{cancelAnimationFrame(L.raf);L.raf=0;observer.disconnect();};
 },[]);
 return {canvas,kick};
}
function useSpin(idle:boolean|undefined){
 const [spinning,setSpinning]=useState(()=>!idle&&!reducedMotion());
 useEffect(()=>{setSpinning(!idle&&!reducedMotion());},[idle]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(spaceToggles(event)){event.preventDefault();setSpinning(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 return [spinning,setSpinning] as const;
}
// v steps the shared view mode; ← → turn the ship in one eased step when this holo takes the arrow keys
function useShipKeys(turnKeys:boolean|undefined,turn:(by:number)=>void){
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(fieldKey(event)||seenKeys.has(event))return;
   if(event.key==='v'){seenKeys.add(event);setShipView({mode:nextMode(shipView.mode)});}
   else if(turnKeys&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();turn(event.key==='ArrowLeft'?-.35:.35);}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[turnKeys]);
}
// a drag turns and tilts the ship, the wheel zooms, a double click resets
function useGestures(canvas:React.RefObject<HTMLCanvasElement|null>,pose:React.MutableRefObject<Pose>,kick:()=>void){
 const at=useRef<[number,number]|null>(null);
 const zoomBy=(k:number)=>{pose.current.zoom=Math.max(.5,Math.min(4,pose.current.zoom*k));kick();};
 useEffect(()=>{
  const cv=canvas.current;if(!cv)return;
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoomBy(Math.exp(-event.deltaY*.0015));};
  cv.addEventListener('wheel',wheel,{passive:false});return()=>cv.removeEventListener('wheel',wheel);
 },[]);
 const tilt=(by:number)=>{pose.current.pitch=Math.max(-.3,Math.min(1.3,pose.current.pitch+by));kick();};
 const reset=()=>{Object.assign(pose.current,{...CAR0,zoom:1,left:0});kick();};
 const handlers={
  onPointerDown:(event:React.PointerEvent)=>{at.current=[event.clientX,event.clientY];pose.current.left=0;event.currentTarget.setPointerCapture(event.pointerId);},
  onPointerMove:(event:React.PointerEvent)=>{if(!at.current)return;pose.current.yaw+=(event.clientX-at.current[0])*.012;tilt((event.clientY-at.current[1])*.008);at.current=[event.clientX,event.clientY];},
  onPointerUp:()=>{at.current=null;},onPointerCancel:()=>{at.current=null;},onDoubleClick:reset,
 };
 return {handlers,zoomBy,tilt,reset};
}
// the ship's controls, the same under every holo
function ShipTools({view,spinning,setSpinning,zoomBy,tilt,fit}:{view:ShipView;spinning:boolean;setSpinning:(f:(on:boolean)=>boolean)=>void;zoomBy:(k:number)=>void;tilt:(by:number)=>void;fit:()=>void}){
 return <div className="tools">
  <span className="seg2" role="group" aria-label="Ship view">{MODES.map(([m,label])=><button key={m} type="button" className={view.mode===m?'on':''} aria-pressed={view.mode===m} onClick={()=>setShipView({mode:m})}>{label}</button>)}</span><kbd>v</kbd>
  <span className="seg2" role="group" aria-label="Hull not built yet" title="How the hull that is not built yet is drawn">{INNERS.map(([m,label])=><button key={m} type="button" className={view.inner===m?'on':''} aria-pressed={view.inner===m} onClick={()=>setShipView({inner:m})}>{label}</button>)}</span>
  <span className="seg2 cam" role="group" aria-label="Zoom and tilt">
   <button type="button" aria-label="Zoom out" onClick={()=>zoomBy(1/1.25)}>−</button><button type="button" aria-label="Zoom in" onClick={()=>zoomBy(1.25)}>+</button><button type="button" aria-label="Fit the ship" onClick={fit}>fit</button>
   <button type="button" aria-label="Tilt up" onClick={()=>tilt(-.15)}>▲</button><button type="button" aria-label="Tilt down" onClick={()=>tilt(.15)}>▼</button>
  </span>
  <button type="button" className="link" aria-label={spinning?'Stop ship spin':'Start ship spin'} onClick={()=>setSpinning(on=>!on)}>{spinning?'stop the spin':'spin'}<kbd>space</kbd></button>
  <span className="hint">drag turns and tilts · wheel zooms · double click resets</span>
 </div>;
}
const PHASE_WORD:Record<BlastPhase,string>={stress:'failing: stress',rupture:'failing: rupture',debris:'failed: debris drifting',settled:'failed'};
function caption(phase:BlastPhase|null,blasting:boolean,failed:boolean,blocked:boolean,goal:number){
 if(blasting)return PHASE_WORD[phase??'stress'];
 return failed?'failed':`${blocked?'blocked · ':''}${Math.round(goal*100)}% built`;
}
/** The holo view of one lane's ship: the board's one renderer, its view settings shared by every holo. */
export function Holo({mesh,state,sourceState,progress,name,idle,options,blast=null,paused=false,onPhase,turnKeys}:HoloProps){
 const view=useShipView(),hidden=usePageHidden(),[spinning,setSpinning]=useSpin(idle),[phase,setPhase]=useState<BlastPhase|null>(null);
 const failed=isFailed(state,sourceState,options),blocked=isBlocked(sourceState,options),goal=buildOf(state,blocked,failed,progress);
 const status=blast===null&&failed?'failed':blocked?'blocked':'';
 const live=useRef<Live>(null!),pose=useRef<Pose>({...CAR0,zoom:1,left:0,prog:goal,blast:null,key:null,t:0,phase:null});
 live.current={mesh,hex:stateColors[state]??stateColors.holding,status,goal,mode:view.mode,inner:view.inner,spinning,paused,hidden,blast,onPhase:next=>{setPhase(next);onPhase?.(next);}};
 if(reducedMotion())pose.current.prog=goal; // reduced motion: the hull takes its build at once
 const {canvas,kick}=useShipCanvas(live,pose),{handlers,zoomBy,tilt,reset}=useGestures(canvas,pose,kick);
 useShipKeys(turnKeys,by=>{pose.current.left+=by;kick();});
 useEffect(()=>{if(blast===null)setPhase(null);},[blast]);
 useEffect(()=>kick(),[mesh,state,status,goal,view.mode,view.inner,spinning,paused,hidden,blast]);
 return <section aria-label="Holo view" className="holo-view">
  <canvas ref={canvas} className="ship" role="img" aria-label={`Rendered ship: ${name}`} {...handlers}/>
  <div className="shipname"><b>{name}</b><span>{caption(phase,blast!==null,failed,blocked,goal)}</span></div>
  <ShipTools view={view} spinning={spinning} setSpinning={setSpinning} zoomBy={zoomBy} tilt={tilt} fit={()=>{pose.current.zoom=1;kick();}}/>
 </section>;
}
