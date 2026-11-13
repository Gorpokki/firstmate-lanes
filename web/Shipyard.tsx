import React,{forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {extras,frame,labelAt,paint,render,shipMesh,view,type Frame,type Mode} from './ascii3d';
import {ISO,STILL,TOP,droneScene,fitYard,yardCols,yardLayout,yardScene,type Berth,type YardLane} from './scenes';
import {shipHex} from './Holo';
import {assignedShip,type ShipMesh} from './mesh-catalog';
import {usePageHidden} from './page-visibility';
import {berthNames,yardOf} from './shipyard-model';
import {stateColors,type Lane} from './stations';

const MONO="Menlo, 'SF Mono', Consolas, monospace",FONT_PX=9,LABEL_PX=15,GX=26,GZ=27; // berths stand apart, so a name fits between them
type Kept={f:Frame;glyph:string[];color:string[];depth:Float32Array;id:Int16Array;quad:Uint8Array};
type Cam={yaw:number;pitch:number;zoom:number;base:number;px:number;py:number;key:string;sel:string;size:string;all:boolean;drawn:string;t:number;changed:number;keep:Kept|null};
type Loop={ctx:CanvasRenderingContext2D|null;f:Frame|null;cw:number;ch:number;w:number;h:number;raf:number};
type Props={lanes:Lane[];meshes:ShipMesh[];selected:string;top:boolean;mode:Mode;motion:boolean;onPick:(id:string)=>void};
export type YardCamera={zoom:(by:'in'|'out')=>void;fit:()=>void};
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const yardLane=(lane:Lane):YardLane=>{const hex=stateColors[lane.state]??stateColors.holding!;return {id:lane.id,name:lane.name,yard:yardOf(lane),heatHex:hex,color:shipHex(hex),hot:lane.state==='needs you',failed:lane.sourceState==='failed'};};

// One frame of the yard. It is drawn in full for each change (and for 0.7 s after it, while the renderer's exposure
// settles) and kept; a drone step, about ten a second, puts the kept frame back and draws only the drones over it.
// It returns whether the loop goes on: only while drones fly (Motion on, a ship in work in sight) or a change settles.
function drawYard(L:Loop,c:Cam,p:Props,now:number):boolean{
 const ctx=L.ctx!,f=L.f!,W=L.w*L.cw,H=L.h*L.ch;
 const {berths,floor}=yardLayout(p.lanes.map(yardLane),l=>{const ship=assignedShip(l.id,p.meshes);return ship?shipMesh(ship.mesh,0):null;},yardCols(p.lanes.length),GX,GZ);
 if(!berths.length){ctx.clearRect(0,0,W,H);c.keep=null;return false;}
 if(c.key!==`${p.top}`)Object.assign(c,{...(p.top?TOP:ISO),zoom:0,key:`${p.top}`}); // a preset: from the top, or from an angle
 const fit=fitYard(berths,c.yaw,c.pitch,W,H),size=`${W}x${H}x${berths.length}`;
 if(!c.zoom||c.size!==size){c.base=fit.fit;c.size=size;}
 const V=(b:Berth)=>view({yaw:c.yaw,pitch:c.pitch,ppu:1,px:0,py:0},b.at[0],b.at[1],b.at[2]),me=berths.find(b=>b.lane.id===p.selected)??berths[0]!;
 if(c.all){c.zoom=fit.fit/c.base;c.px=fit.bx;c.py=fit.by;c.all=false;c.sel=p.selected;} // the whole yard on one screen
 if(!c.zoom){c.zoom=Math.max(1,190/Math.max(1,GX*c.base));c.sel='';} // the start: large ships, about 190 px from berth to berth
 const ppu=c.base*c.zoom;
 if(c.sel!==p.selected){ // a new selection out of sight comes to the middle; at the start the selected berth is in the middle
  const q=V(me),x=W/2+c.px+q[0]*ppu,y=H/2+c.py-q[1]*ppu;
  if(c.sel===''||x<60||x>W-60||y<60||y>H-60){
   c.px=-q[0]*ppu;c.py=q[1]*ppu;
   // a berth at the yard's edge does not leave half the field empty: the yard's own edge stops at the field's edge
   let X0=Infinity,X1=-Infinity,Y0=Infinity,Y1=-Infinity;
   for(const b of berths){const v=V(b);X0=Math.min(X0,v[0]-15);X1=Math.max(X1,v[0]+15);Y0=Math.min(Y0,v[1]-15);Y1=Math.max(Y1,v[1]+17);}
   c.px=(X1-X0)*ppu<=W?-(X0+X1)/2*ppu:clamp(c.px,W/2-X1*ppu,-W/2-X0*ppu);
   c.py=(Y1-Y0)*ppu<=H?(Y0+Y1)/2*ppu:clamp(c.py,H/2+Y0*ppu,Y1*ppu-H/2);
  }
  c.sel=p.selected;
 }
 const seen=berths.filter(b=>{const q=V(b),x=W/2+c.px+q[0]*ppu,y=H/2+c.py-q[1]*ppu,m=16*ppu;return x>-m&&x<W+m&&y>-m&&y<H+m;}); // only the berths in sight are drawn
 if(!seen.length){ctx.clearRect(0,0,W,H);c.keep=null;return false;}
 const live=p.motion&&seen.some(b=>b.lane.yard==='hull'&&b.mesh);
 const key=`${c.yaw}|${c.pitch}|${ppu}|${c.px}|${c.py}|${p.selected}|${p.mode}|${size}|${seen.length}|${seen.filter(b=>b.mesh).length}|${p.lanes.map(l=>[l.id,l.name,yardOf(l),l.state,l.sourceState,assignedShip(l.id,p.meshes)?.id].join('|')).join(';')}`;
 if(key!==c.drawn){c.drawn=key;c.changed=now;}
 const full=!c.keep||c.keep.f!==f||now-c.changed<700;
 if(!full&&!live)return false; // nothing moved: the canvas keeps its frame
 if(!full&&now-c.t<95)return true; // nothing moved but the clock: wait for the next drone step
 c.t=now;
 const cam={yaw:c.yaw,pitch:c.pitch,ppu,px:c.px,py:c.py},ids=new Set(seen.map(b=>b.i)),near=GX*ppu>=84;
 if(full){
  const named=berthNames(yardScene(seen,floor,p.selected,STILL),berths,p.selected,Math.max(8,Math.floor((GX*ppu-12)/6.1)));
  render(f,{...named,labels:named.labels!.filter(l=>near?ids.has(l.id):l.id===me.i)},cam,p.mode); // from far away only the selected berth keeps its name
  c.keep={f,glyph:f.glyph.slice(),color:f.color.slice(),depth:f.depth.slice(),id:f.id.slice(),quad:f.quad.slice()};
 }else{const k=c.keep!;for(let i=0;i<k.glyph.length;i++){f.glyph[i]=k.glyph[i]!;f.color[i]=k.color[i]!;}f.depth.set(k.depth);f.id.set(k.id);f.quad.set(k.quad);}
 extras(f,droneScene(seen,STILL,live?now:STILL),cam); // Motion off: the drones hold still
 paint(ctx,f,`${FONT_PX}px ${MONO}`,'#000',LABEL_PX);
 return live||now-c.changed<700;
}

// The shipyard: each shown lane's ship in its berth, in an ASCII drydock, under one camera. A drag (one finger) moves the
// yard; shift + drag, the right button or two fingers turn it; the wheel or a pinch zooms at the pointer; a double click
// or a double tap goes back to the start. A click or a tap selects a lane. Hidden, it draws nothing.
export const Shipyard=forwardRef<YardCamera,Props>(function Shipyard(p,ref){
 const canvas=useRef<HTMLCanvasElement>(null),hidden=usePageHidden();
 const live=useRef(p),loop=useRef<Loop>({ctx:null,f:null,cw:5.4,ch:11,w:0,h:0,raf:0});
 const cam=useRef<Cam>({yaw:0,pitch:0,zoom:0,base:0,px:0,py:0,key:'',sel:'',size:'',all:false,drawn:'',t:0,changed:0,keep:null});
 live.current=p;
 const hide=useRef(hidden);hide.current=hidden;
 const step=(now:number)=>{
  const L=loop.current;L.raf=0;
  if(hide.current||!L.ctx)return;
  L.f=frame(L.f,L.w,L.h,L.cw,L.ch);
  let more=false;
  try{more=drawYard(L,cam.current,live.current,now);}catch(error){console.error(error);}
  if(more)L.raf=requestAnimationFrame(step);
 };
 const kick=()=>{const L=loop.current;if(!L.raf&&!hide.current)L.raf=requestAnimationFrame(step);};
 useEffect(()=>{
  const cv=canvas.current!,ctx=cv.getContext('2d'),L=loop.current;L.ctx=ctx;
  if(ctx){ctx.font=`${FONT_PX}px ${MONO}`;L.cw=ctx.measureText('M').width||5.4;L.ch=Math.round(FONT_PX*1.25);}
  const fit=()=>{
   const r=cv.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
   cv.width=Math.max(1,r.width*d);cv.height=Math.max(1,r.height*d);ctx?.setTransform(d,0,0,d,0,0);
   L.w=Math.max(4,Math.floor(r.width/L.cw));L.h=Math.max(2,Math.floor(r.height/L.ch));
   cam.current.keep=null;kick();
  };
  const observer=new ResizeObserver(fit);observer.observe(cv);fit();
  const wheel=(e:WheelEvent)=>{e.preventDefault();const r=cv.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);};
  cv.addEventListener('wheel',wheel,{passive:false});
  return()=>{cancelAnimationFrame(L.raf);L.raf=0;observer.disconnect();cv.removeEventListener('wheel',wheel);};
 },[]);
 useEffect(kick,[p.lanes.map(l=>l.id+l.name+l.state+l.sourceState).join(),p.meshes,p.selected,p.top,p.mode,p.motion,hidden]);
 // zoom by k about a point (px from the canvas centre); the buttons zoom about the centre
 const zoomAt=(k:number,mx:number,my:number)=>{const c=cam.current;if(!c.zoom)return;const z=clamp(c.zoom*k,.3,14),r=z/c.zoom;c.px=mx-(mx-c.px)*r;c.py=my-(my-c.py)*r;c.zoom=z;kick();};
 const turn=(dx:number,dy:number)=>{const c=cam.current;c.yaw+=dx*.008;c.pitch=clamp(c.pitch+dy*.006,.3,Math.PI/2);};
 const reset=()=>{cam.current.key='';kick();}; // the start: the preset angle, large ships, the selected berth in the middle
 useImperativeHandle(ref,()=>({zoom:by=>zoomAt(by==='in'?1.3:1/1.3,0,0),fit:()=>{cam.current.all=true;kick();}}),[]);
 const pick=(x:number,y:number)=>{
  const L=loop.current,f=L.f;if(!f||!L.ctx)return;
  const cx=Math.floor(x/L.cw),cy=Math.floor(y/L.ch);
  let id=cx<f.w&&cy<f.h?f.id[cy*f.w+cx]!:-1;
  if(id<0)id=labelAt(f,L.ctx,x,y,LABEL_PX);
  const lanes=live.current.lanes;if(id>=0&&lanes[id])live.current.onPick(lanes[id]!.id);
 };
 // pointers: one moves the yard (or turns it with shift or the right button); two pinch to zoom and turn by twist and lift
 const g=useRef({pts:new Map<number,[number,number]>(),at:null as null|[number,number],moved:false,turn:false,pinch:null as null|{d:number;a:number;x:number;y:number},tap:{t:0,x:0,y:0}});
 const two=()=>{const [a,b]=[...g.current.pts.values()];return {d:Math.max(1,Math.hypot(b![0]-a![0],b![1]-a![1])),a:Math.atan2(b![1]-a![1],b![0]-a![0]),x:(a![0]+b![0])/2,y:(a![1]+b![1])/2};};
 const handlers={
  onPointerDown:(e:React.PointerEvent<HTMLCanvasElement>)=>{
   const s=g.current;e.currentTarget.setPointerCapture(e.pointerId);s.pts.set(e.pointerId,[e.clientX,e.clientY]);
   if(s.pts.size===1){s.at=[e.clientX,e.clientY];s.moved=false;s.turn=e.shiftKey||e.button===2;}
   else if(s.pts.size===2){s.pinch=two();s.moved=true;}
  },
  onPointerMove:(e:React.PointerEvent<HTMLCanvasElement>)=>{
   const s=g.current;if(!s.pts.has(e.pointerId))return;s.pts.set(e.pointerId,[e.clientX,e.clientY]);
   if(s.pts.size>=2&&s.pinch){
    const n=two(),o=s.pinch,r=e.currentTarget.getBoundingClientRect();s.pinch=n;
    const c=cam.current;c.yaw+=n.a-o.a;turn(0,n.y-o.y);
    zoomAt(n.d/o.d,n.x-r.left-r.width/2,n.y-r.top-r.height/2);
    return;
   }
   if(!s.at)return;
   const dx=e.clientX-s.at[0],dy=e.clientY-s.at[1];
   if(!s.moved&&Math.abs(dx)+Math.abs(dy)<4)return;
   s.moved=true;
   if(s.turn)turn(dx,dy);else{cam.current.px+=dx;cam.current.py+=dy;}
   s.at=[e.clientX,e.clientY];kick();
  },
  onPointerUp:(e:React.PointerEvent<HTMLCanvasElement>)=>{
   const s=g.current;s.pts.delete(e.pointerId);
   if(s.pts.size<2)s.pinch=null;
   if(s.pts.size===1){const [rest]=[...s.pts.values()];s.at=rest!;return;} // a pinch ends: the finger left moves the yard
   if(s.pts.size)return;
   if(s.at&&!s.moved){
    const r=e.currentTarget.getBoundingClientRect(),t=performance.now(),tap=s.tap;
    if(e.pointerType!=='mouse'&&t-tap.t<350&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<30){reset();s.tap={t:0,x:0,y:0};} // a double tap: the start
    else{pick(e.clientX-r.left,e.clientY-r.top);s.tap={t,x:e.clientX,y:e.clientY};}
   }
   s.at=null;
  },
  onPointerCancel:(e:React.PointerEvent<HTMLCanvasElement>)=>{const s=g.current;s.pts.delete(e.pointerId);s.pinch=null;s.at=null;},
  onDoubleClick:reset,
  onContextMenu:(e:React.MouseEvent)=>e.preventDefault(),
 };
 return <canvas ref={canvas} className="yard" role="img" aria-label="Shipyard: each shown lane's ship in its berth. Drag moves the yard, shift and drag or two fingers turn it, the wheel or a pinch zooms, a double click or double tap goes back to the start" {...handlers}/>;
});
