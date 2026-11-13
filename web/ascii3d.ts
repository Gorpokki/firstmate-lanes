// The board's one ship renderer: an ASCII 3D frame drawn on a canvas, shared by every holo view.
// A port of the approved prototype's renderer, itself a port of the first Go ship dashboard's:
// 2x2-supersampled barycentric fill with depth, lighting, then a structural pass (silhouette,
// depth jump, crease) that picks box-drawing glyphs. Three view modes:
//   lit  = shade-ramp glyphs, colour scaled by the light on each cell
//   flat = the same glyphs in one flat colour (no lighting)
//   bars = quadrant blocks scaled by the light
// Meshes have x = nose, y = up, z = starboard, radius 1. A scene adds line segments, dots and labels, depth-tested.
// The admission check keeps its own renderer (holo-renderer.ts): its bytes are part of every model's certificate.
import type {TriangleMesh} from './holo-renderer';

export type Mode='lit'|'flat'|'bars';
export const MODES:[Mode,string][]=[['lit','ASCII lit'],['flat','ASCII flat'],['bars','Bars']];
// How the hull that is not built yet is drawn: dots, the dim shade of the hull to come, or its wire edges alone.
export type Inner='dot'|'dim'|'blank';
export const INNERS:[Inner,string][]=[['dot','Dot fill'],['dim','Dim hull'],['blank','Wireframe']];
export type V3=[number,number,number];
export type RGB=[number,number,number];
export type Mesh={pos:Float32Array;n:number;key:Float32Array;lo:V3;hi:V3};
export type Obj={mesh:Mesh;at:V3;s:number;id:number;rgb:RGB;prog:number;broken?:boolean;glow?:number;wire?:string;dim?:string;inner?:Inner};
export type Seg={a:V3;b:V3;color:string;id:number;ch?:string;back?:boolean}; // back: never covers a ship
export type Dot={p:V3;ch:string;color:string;id:number};
export type Label={p:V3;text:string;color:string;id:number;bg?:string};
export type Scene={objs:Obj[];segs?:Seg[];dots?:Dot[];labels?:Label[]};
export type Cam={yaw:number;pitch:number;ppu:number;px:number;py:number}; // ppu: px per world unit; px, py: centre offset in px

const N4=[[-1,0],[1,0],[0,-1],[0,1]];
const SS=2,RAMP='.,:;-=+*#%@',QUAD=' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█';
export const WIRE='#6e66a0',DIM='#38324f';

// ---- meshes ----
const hash01=(i:number)=>{let x=Math.imul(i+1,0x9e3779b9)>>>0;x^=x>>>16;x=Math.imul(x,0x85ebca6b)>>>0;x^=x>>>13;return x/4294967296;};
export function toMesh(q:Int16Array):Mesh{
 const pos=Float32Array.from(q,v=>v/32767),n=pos.length/9;
 const lo:V3=[Infinity,Infinity,Infinity],hi:V3=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<pos.length;i+=3)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],pos[i+a]);hi[a]=Math.max(hi[a],pos[i+a]);}
 const len=Math.max(1e-6,hi[0]-lo[0]),key=new Float32Array(n);
 // build order: the hull grows from the stern to the nose, with a ragged frontier
 for(let t=0;t<n;t++)key[t]=.85*((pos[9*t]+pos[9*t+3]+pos[9*t+6])/3-lo[0])/len+.15*hash01(t);
 return {pos,n,key,lo,hi};
}
const converted=new WeakMap<Int16Array,Mesh>();
/** The renderer's mesh of an admitted ship, converted once: its high level of detail, or its low one (level 0) for the yard. */
export function shipMesh(mesh:TriangleMesh,level:0|1=1):Mesh{
 const source=mesh.lod[level];
 let result=converted.get(source);
 if(!result){result=toMesh(source);converted.set(source,result);}
 return result;
}
// The hull's profile along the keel, in 16 slabs: its half width and its top and bottom, for the yard's harness clamps
// and the drones. Taken once per mesh; a reduced mesh can leave a slab with no vertex, so it takes the nearest filled one.
const SLABS=16,profiles=new WeakMap<Mesh,{z:Float32Array;yHi:Float32Array;yLo:Float32Array}>();
export function slab(m:Mesh,u:number){
 let p=profiles.get(m);
 if(!p){
  const P=m.pos,len=Math.max(1e-6,m.hi[0]-m.lo[0]);
  p={z:new Float32Array(SLABS),yHi:new Float32Array(SLABS).fill(-Infinity),yLo:new Float32Array(SLABS).fill(Infinity)};
  for(let i=0;i<P.length;i+=3){
   const s=Math.min(SLABS-1,Math.floor((P[i]-m.lo[0])/len*SLABS));
   p.z[s]=Math.max(p.z[s],Math.abs(P[i+2]));p.yHi[s]=Math.max(p.yHi[s],P[i+1]);p.yLo[s]=Math.min(p.yLo[s],P[i+1]);
  }
  for(const order of [[...Array(SLABS).keys()],[...Array(SLABS).keys()].reverse()]){
   let last=-1;
   for(const s of order)if(Number.isFinite(p.yHi[s]))last=s;else if(last>=0){p.yHi[s]=p.yHi[last];p.yLo[s]=p.yLo[last];p.z[s]=p.z[last];}
  }
  profiles.set(m,p);
 }
 const s=Math.min(SLABS-1,Math.max(0,Math.floor(u*SLABS)));
 return {z:p.z[s],yHi:p.yHi[s],yLo:p.yLo[s]};
}

// ---- frame buffer ----
export type Frame={
 w:number;h:number;cw:number;ch:number;
 sd:Float32Array;sb:Float32Array;st:Int32Array;so:Int16Array; // sub cells: depth, light, triangle, object
 nrm:Float32Array;vis:Uint8Array; // per triangle (all objects): view normal, built
 glyph:string[];color:string[];depth:Float32Array;id:Int16Array;mask:Uint8Array;quad:Uint8Array;
 labels:{x:number;y:number;text:string;color:string;id:number;bg?:string}[]; // px, drawn over the grid
 ex?:number[];cdf?:Float32Array; // auto exposure: eased low and high light values, and the light's eased CDF
};
export function frame(f:Frame|null,w:number,h:number,cw:number,ch:number):Frame{
 if(f&&f.w===w&&f.h===h){f.cw=cw;f.ch=ch;return f;}
 const S=w*h*SS*SS;
 return {w,h,cw,ch,sd:new Float32Array(S),sb:new Float32Array(S),st:new Int32Array(S),so:new Int16Array(S),nrm:new Float32Array(0),vis:new Uint8Array(0),glyph:new Array(w*h),color:new Array(w*h),depth:new Float32Array(w*h),id:new Int16Array(w*h),mask:new Uint8Array(w*h),quad:new Uint8Array(w*h),labels:[]};
}

const tints=new Map<string,string>();
// dark to full colour, then toward white for highlights above 0.92
export function tint(c:RGB,b:number):string{
 const q=Math.round(Math.max(0,Math.min(1.3,b))*24),k=`${c}|${q}`;
 let s=tints.get(k);
 if(!s){
  const v=q/24,m=.2+.8*Math.min(1,v),wt=Math.max(0,Math.min(1,(v-.92)/.38))*.85;
  const ch=(x:number)=>(x*m+(255-x*m)*wt)|0;
  s=`rgb(${ch(c[0])},${ch(c[1])},${ch(c[2])})`;tints.set(k,s);
 }
 return s;
}
export const hex=(h:string):RGB=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const rank=(r:number,c:number)=>{let x=(Math.imul(r,73856093)^Math.imul(c,19349663))>>>0;x=(x^(x>>>13))>>>0;x=Math.imul(x,0x5bd1e995)>>>0;x=(x^(x>>>15))>>>0;return (x%1000)/1000;};

// Lighting, in view space: a raking key light from the upper left, so hull panels turned different ways get different
// shades; a weak fill from the lower right, so the shadow side keeps its shape; a rim term on faces turned edge-on and a
// bright outline, so the hull stands off the black; a white specular. Then, per frame: a depth unsharp mask (recesses
// darker, ridges lighter) and auto exposure, which stretches the built hull's light over the whole glyph ramp.
const dir=(az:number,el:number)=>[Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)];
const KEY=dir(-1.1,.5),FILL=dir(1.3,-.4);
const HALF=(()=>{const v=[KEY[0],KEY[1],KEY[2]+1],l=Math.hypot(...v);return v.map(x=>x/l);})();
const PAIRS=[[1,0],[2,0],[0,1],[2,1],[2,-1]]; // unsharp-mask neighbours (cells are about twice as tall as wide)

// view space: x right, y up, z toward the viewer; pitch > 0 looks down
export function view(cam:Cam,x:number,y:number,z:number):V3{
 const cy=Math.cos(cam.yaw),sy=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
 const x1=x*cy-z*sy,z1=x*sy+z*cy;
 return [x1,y*cp-z1*sp,y*sp+z1*cp];
}

type Tri={vx:Float32Array;vy:Float32Array;vz:Float32Array;qx:Float32Array;qy:Float32Array};
type Cells={tri:Int32Array;obj:Int16Array;lit:Float32Array;bnd:Uint8Array};
type Edges={edge:Uint8Array;cut:Uint8Array};

// One triangle into the sub cells: its view normal, its light, then a depth-tested barycentric fill.
function fillTriangle(f:Frame,T:Tri,g:number,oi:number){
 const W=f.w*SS,H=f.h*SS,{vx,vy,vz,qx,qy}=T;
 const E=(a:number,b:number,px:number,py:number)=>(px-qx[a])*(qy[b]-qy[a])-(py-qy[a])*(qx[b]-qx[a]);
 const area=E(0,1,qx[2],qy[2]);
 if(Math.abs(area)<1e-9)return;
 let nx=(vy[1]-vy[0])*(vz[2]-vz[0])-(vz[1]-vz[0])*(vy[2]-vy[0]);
 let ny=(vz[1]-vz[0])*(vx[2]-vx[0])-(vx[1]-vx[0])*(vz[2]-vz[0]);
 let nz=(vx[1]-vx[0])*(vy[2]-vy[0])-(vy[1]-vy[0])*(vx[2]-vx[0]);
 const nl=Math.hypot(nx,ny,nz)||1;
 nx/=nl;ny/=nl;nz/=nl;
 if(nz<0){nx=-nx;ny=-ny;nz=-nz;} // two-sided: winding is not trusted
 f.nrm[3*g]=nx;f.nrm[3*g+1]=ny;f.nrm[3*g+2]=nz;
 const key=Math.max(0,nx*KEY[0]+ny*KEY[1]+nz*KEY[2]),fill=Math.max(0,nx*FILL[0]+ny*FILL[1]+nz*FILL[2]);
 const spec=Math.pow(Math.max(0,nx*HALF[0]+ny*HALF[1]+nz*HALF[2]),40);
 const bright=.04+.85*key+.18*fill+.4*(1-nz)**3+.9*spec; // glow applies after exposure
 const x0=Math.max(0,Math.floor(Math.min(qx[0],qx[1],qx[2]))),x1=Math.min(W-1,Math.ceil(Math.max(qx[0],qx[1],qx[2])));
 const y0=Math.max(0,Math.floor(Math.min(qy[0],qy[1],qy[2]))),y1=Math.min(H-1,Math.ceil(Math.max(qy[0],qy[1],qy[2])));
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const wa=E(1,2,x+.5,y+.5)/area,wb=E(2,0,x+.5,y+.5)/area,wc=1-wa-wb;
  if(wa<0||wb<0||wc<0)continue;
  const d=-(wa*vz[0]+wb*vz[1]+wc*vz[2]),si=y*W+x;
  if(d<f.sd[si]){f.sd[si]=d;f.sb[si]=bright;f.st[si]=g;f.so[si]=oi;}
 }
}
function raster(f:Frame,scene:Scene,cam:Cam){
 const kx=cam.ppu/(f.cw/SS),ky=cam.ppu/(f.ch/SS); // sub cells per world unit
 const cx=f.w*SS/2+cam.px/(f.cw/SS),cy=f.h*SS/2+cam.py/(f.ch/SS);
 const cyw=Math.cos(cam.yaw),syw=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
 f.sd.fill(Infinity);f.st.fill(-1);
 const total=scene.objs.reduce((a,o)=>a+o.mesh.n,0);
 if(f.nrm.length<total*3){f.nrm=new Float32Array(total*3);f.vis=new Uint8Array(total);}
 const T:Tri={vx:new Float32Array(3),vy:new Float32Array(3),vz:new Float32Array(3),qx:new Float32Array(3),qy:new Float32Array(3)};
 let off=0;
 scene.objs.forEach((o,oi)=>{
  const P=o.mesh.pos;
  for(let t=0;t<o.mesh.n;t++){
   for(let k=0;k<3;k++){
    const i=9*t+3*k,x=o.at[0]+o.s*P[i],y=o.at[1]+o.s*P[i+1],z=o.at[2]+o.s*P[i+2];
    const x1=x*cyw-z*syw,z1=x*syw+z*cyw;
    T.vx[k]=x1;T.vy[k]=y*cp-z1*sp;T.vz[k]=y*sp+z1*cp;
    T.qx[k]=cx+T.vx[k]*kx;T.qy[k]=cy-T.vy[k]*ky;
   }
   f.vis[off+t]=o.mesh.key[t]<o.prog?1:0;
   fillTriangle(f,T,off+t,oi);
  }
  off+=o.mesh.n;
 });
}
// fold the sub cells into cells: the nearest triangle, the mean light, the covered quadrants, and a face boundary
function fold(f:Frame):Cells{
 const {w,h}=f,W=w*SS,c:Cells={tri:new Int32Array(w*h).fill(-1),obj:new Int16Array(w*h),lit:new Float32Array(w*h),bnd:new Uint8Array(w*h)};
 f.depth.fill(Infinity);f.id.fill(-1);f.mask.fill(0);f.quad.fill(0);
 for(let ci=0;ci<w*h;ci++){
  const x=ci%w,y=(ci-x)/w;
  let n=0,b=0,face=-1;
  for(let k=0;k<SS*SS;k++){
   const si=(y*SS+(k>>1))*W+x*SS+(k&1),t=f.st[si];
   if(t<0)continue;
   n++;b+=f.sb[si];f.mask[ci]|=1<<k;
   if(face<0)face=t;else if(t!==face)c.bnd[ci]=1;
   if(f.sd[si]<f.depth[ci]){f.depth[ci]=f.sd[si];c.tri[ci]=t;c.obj[ci]=f.so[si];}
  }
  if(n)c.lit[ci]=b/n;
 }
 return c;
}
const cellAt=(f:Frame,x:number,y:number)=>(x<0||y<0||x>=f.w||y>=f.h?-1:y*f.w+x);
// one cell of the structural pass: 1 silhouette, 2 occluding contour (depth jump), 3 crease (normal angle); and a cut,
// a real break in depth rather than a steep slope
function edgeAt(f:Frame,c:Cells,x:number,y:number,jump:number):[number,number]{
 const ci=y*f.w+x,t=c.tri[ci];
 let e=0,cut=0;
 for(const [dx,dy] of N4){
  const j=cellAt(f,x+dx,y+dy);
  if(j<0||c.tri[j]<0)return [1,cut];
  const u=c.tri[j],dot=f.nrm[3*t]*f.nrm[3*u]+f.nrm[3*t+1]*f.nrm[3*u+1]+f.nrm[3*t+2]*f.nrm[3*u+2];
  if(f.depth[j]-f.depth[ci]>jump){
   const k=cellAt(f,x-dx,y-dy),back=k>=0&&c.tri[k]>=0?f.depth[ci]-f.depth[k]:0;
   e=2;
   if(f.depth[j]-f.depth[ci]-back>jump)cut=1;
  }else if(dot<.55&&!e)e=3;
 }
 return [e,cut];
}
function structure(f:Frame,scene:Scene,c:Cells):Edges{
 const s:Edges={edge:new Uint8Array(f.w*f.h),cut:new Uint8Array(f.w*f.h)};
 for(let ci=0;ci<f.w*f.h;ci++){
  if(c.tri[ci]<0)continue;
  const x=ci%f.w,[e,cut]=edgeAt(f,c,x,(ci-x)/f.w,.08*scene.objs[c.obj[ci]].s);
  s.edge[ci]=e;s.cut[ci]=cut;
 }
 return s;
}
// depth unsharp mask: a cell farther than its neighbours on both sides is in a recess (darker), nearer is a ridge
// (lighter); a straight slope cancels out, and the outline is left alone
function unsharp(f:Frame,scene:Scene,c:Cells){
 const same=(j:number,ci:number)=>j>=0&&c.tri[j]>=0&&c.obj[j]===c.obj[ci];
 for(let ci=0;ci<f.w*f.h;ci++){
  if(c.tri[ci]<0)continue;
  const x=ci%f.w,y=(ci-x)/f.w,R=.04*scene.objs[c.obj[ci]].s;
  let s=0,n=0;
  for(const [dx,dy] of PAIRS){
   const a=cellAt(f,x+dx,y+dy),b=cellAt(f,x-dx,y-dy);
   if(!same(a,ci)||!same(b,ci))continue;
   s+=Math.max(-1,Math.min(1,(2*f.depth[ci]-f.depth[a]-f.depth[b])/R));n++;
  }
  if(n){const u=s/n;c.lit[ci]=c.lit[ci]*(1-.5*Math.max(0,u))+.25*Math.max(0,-u);}
 }
}
// auto exposure over the built hull, eased between frames so a turn does not pump: mostly histogram equalisation (every
// glyph of the ramp gets used, so the shadow side keeps its panels), plus a linear stretch of the 3rd to 97th percentile
// that lets specular highlights run to white
function exposure(f:Frame,c:Cells){
 const hist=new Uint32Array(64);
 let cnt=0;
 for(let ci=0;ci<f.w*f.h;ci++)if(c.tri[ci]>=0&&f.vis[c.tri[ci]]){hist[Math.min(63,Math.floor(c.lit[ci]/1.6*64))]++;cnt++;}
 if(cnt){
  const first=!f.ex,ease=first?1:.15;
  if(first){f.ex=[0,1];f.cdf=new Float32Array(65);}
  let lo=-1,hi=-1,acc=0;
  for(let b=0;b<64;b++){
   acc+=hist[b];
   if(lo<0&&acc>=cnt*.03)lo=b/64*1.6;
   if(hi<0&&acc>=cnt*.97)hi=(b+1)/64*1.6;
   f.cdf![b+1]+=(acc/cnt-f.cdf![b+1])*ease;
  }
  f.ex![0]+=(lo-f.ex![0])*ease;f.ex![1]+=(hi-f.ex![1])*ease;
 }
 const e0=f.ex?.[0]??0,es=1/Math.max(.2,(f.ex?.[1]??1)-e0),cdf=f.cdf;
 return (l:number)=>{
  const lin=(l-e0)*es;
  if(!cdf)return lin;
  const u=Math.max(0,Math.min(63.999,l/1.6*64)),b=Math.floor(u);
  return .65*(cdf[b]+(cdf[b+1]-cdf[b])*(u-b))+.35*lin;
 };
}
// a structural cell of a built hull in lit mode: Sobel on depth (empty cells count as far); the line runs across the gradient
function sobelGlyph(f:Frame,c:Cells,ci:number,scale:number){
 const x=ci%f.w,y=(ci-x)/f.w,far=f.depth[ci]+.3*scale;
 const D=(dx:number,dy:number)=>{const j=cellAt(f,x+dx,y+dy);return j<0||c.tri[j]<0?far:f.depth[j];};
 const gx=(D(1,-1)+2*D(1,0)+D(1,1)-D(-1,-1)-2*D(-1,0)-D(-1,1))/f.cw,gy=(D(-1,1)+2*D(0,1)+D(1,1)-D(-1,-1)-2*D(0,-1)-D(1,-1))/f.ch;
 const a=(Math.atan2(gx,-gy)*180/Math.PI+180)%180; // the edge's own direction, 0 = horizontal, screen y down
 return a<25||a>=155?'─':a<72?'╲':a<108?'│':'╱';
}
// a structural cell drawn by its structural neighbours; the unbuilt hull's wire also follows face boundaries
function wireGlyph(f:Frame,s:Edges,c:Cells,ci:number,wire:boolean){
 const x=ci%f.w,y=(ci-x)/f.w;
 const con=(dx:number,dy:number)=>{const j=cellAt(f,x+dx,y+dy);return j>=0&&(s.edge[j]||(wire&&c.bnd[j]))?1:0;};
 const hz=con(-1,0)+con(1,0),vt=con(0,-1)+con(0,1),dr=con(-1,-1)+con(1,1),ur=con(1,-1)+con(-1,1);
 if(hz>vt&&hz>=dr&&hz>=ur)return '─';
 if(vt>hz&&vt>=dr&&vt>=ur)return '│';
 return dr>ur?'╲':ur>dr?'╱':hz+vt+dr+ur>=3?'┼':'·';
}
// a cell of a hull that is not built yet: its wire edges, and inside them the chosen fill
function unbuiltCell(f:Frame,o:Obj,c:Cells,ci:number,g:string,structural:boolean,mode:Mode,expose:(l:number)=>number){
 if(structural){f.glyph[ci]=g;f.color[ci]=o.wire??WIRE;return;}
 if(o.inner==='blank')return; // wireframe: the unbuilt hull shows its edges only
 const shade=o.inner==='dim'?RAMP[Math.min(RAMP.length-1,Math.floor(Math.min(1,.06+.92*expose(c.lit[ci]))*RAMP.length))]:g;
 f.glyph[ci]=mode==='bars'?QUAD[f.mask[ci]]:shade;f.color[ci]=o.dim??DIM;f.quad[ci]=mode==='bars'?1:0;
}
function builtCell(f:Frame,o:Obj,c:Cells,ci:number,g:string,structural:boolean,mode:Mode,expose:(l:number)=>number){
 let v=.06+.92*expose(c.lit[ci]);
 if(structural)v=Math.max(v,.7); // the outline reads as a rim light against the black
 v=Math.max(0,Math.min(1.3,v))*(o.glow??1);
 f.glyph[ci]=mode==='bars'?QUAD[f.mask[ci]]:structural?g:RAMP[Math.min(RAMP.length-1,Math.floor(Math.min(1,v)*RAMP.length))];
 f.quad[ci]=mode==='bars'?1:0;
 f.color[ci]=mode==='flat'?tint(o.rgb,.85):tint(o.rgb,v);
}
// The wire of an unbuilt hull and flat mode (no light) draw all three structural kinds. Lit mode draws silhouettes and
// depth cuts, each turned along its edge, and leaves creases to the light, which is where panels show.
function cellGlyph(f:Frame,scene:Scene,c:Cells,s:Edges,mode:Mode,expose:(l:number)=>number,ci:number){
 const t=c.tri[ci];
 f.glyph[ci]='';f.color[ci]='';
 if(t<0)return;
 const o=scene.objs[c.obj[ci]],built=f.vis[t]===1,outline=built&&mode==='lit';
 const structural=outline?s.edge[ci]===1||s.cut[ci]===1:s.edge[ci]>0;
 const g=structural&&outline?sobelGlyph(f,c,ci,o.s):structural||c.bnd[ci]?wireGlyph(f,s,c,ci,!structural):'·';
 f.id[ci]=o.id;
 const x=ci%f.w;
 if(o.broken&&rank((ci-x)/f.w,x)<.4){f.glyph[ci]='·';f.color[ci]=DIM;return;} // a failed lane breaks apart
 (built?builtCell:unbuiltCell)(f,o,c,ci,g,structural,mode,expose);
}

export function render(f:Frame,scene:Scene,cam:Cam,mode:Mode){
 raster(f,scene,cam);
 const c=fold(f),s=structure(f,scene,c);
 unsharp(f,scene,c);
 const expose=exposure(f,c);
 for(let ci=0;ci<f.w*f.h;ci++)cellGlyph(f,scene,c,s,mode,expose,ci);
 extras(f,scene,cam,c.tri);
 const proj=projector(f,cam);
 f.labels=(scene.labels??[]).map(l=>{const p=proj(l.p);return {x:p[0]*f.cw,y:p[1]*f.ch,text:l.text,color:l.color,id:l.id,bg:l.bg};});
}
// world point -> cell x, cell y, depth
function projector(f:Frame,cam:Cam){
 const W=f.w*SS,H=f.h*SS,kx=cam.ppu/(f.cw/SS),ky=cam.ppu/(f.ch/SS),cx=W/2+cam.px/(f.cw/SS),cy=H/2+cam.py/(f.ch/SS);
 const cyw=Math.cos(cam.yaw),syw=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
 return (p:V3):V3=>{
  const x1=p[0]*cyw-p[2]*syw,z1=p[0]*syw+p[2]*cyw;
  return [(cx+x1*kx)/SS,(cy-(p[1]*cp-z1*sp)*ky)/SS,-(p[1]*sp+z1*cp)];
 };
}
function drawSeg(f:Frame,s:Seg,proj:(p:V3)=>V3,tri?:Int32Array){
 const a=proj(s.a),b=proj(s.b),dx=b[0]-a[0],dy=b[1]-a[1];
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return; // never step along an unbounded line
 const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy)))),px=Math.abs(dx)*f.cw,py=Math.abs(dy)*f.ch;
 const flat=!s.ch&&py<.45*px,g0=s.ch??(flat?'─':px<.45*py?'│':dx*dy>0?'╲':'╱');
 for(let k=0;k<=steps;k++){
  const u=k/steps,fy=a[1]+dy*u,y=Math.floor(fy),d=a[2]+(b[2]-a[2])*u-.05,r=fy-y;
  const g=flat?(r<.3?'‾':r>.7?'_':'─'):g0; // a shallow line steps through the cell, not across rows
  const ci=cellAt(f,Math.floor(a[0]+dx*u),y);
  if(ci<0||d>=f.depth[ci]||(s.back&&tri&&tri[ci]>=0))continue;
  f.depth[ci]=d;f.glyph[ci]=g;f.color[ci]=s.color;f.id[ci]=s.id;f.quad[ci]=0;
 }
}
// Line segments and dots, depth-tested against what the frame holds and against each other. render() ends with it; a
// caller can also put it over a frame that is already drawn (tri absent).
export function extras(f:Frame,scene:{segs?:Seg[];dots?:Dot[]},cam:Cam,tri?:Int32Array){
 const proj=projector(f,cam);
 for(const s of scene.segs??[])drawSeg(f,s,proj,tri);
 for(const s of scene.dots??[]){
  const p=proj(s.p),ci=cellAt(f,Math.floor(p[0]),Math.floor(p[1]));
  if(ci<0||p[2]>=f.depth[ci])continue;
  f.depth[ci]=p[2];f.glyph[ci]=s.ch;f.color[ci]=s.color;f.id[ci]=s.id;f.quad[ci]=0;
 }
}

// ---- paint onto a canvas (cell grid; bars mode fills quadrant rectangles so blocks join without gaps) ----
export const LABEL_FONT="600 12px 'Antonio', 'Helvetica Neue', Arial Narrow, sans-serif";
function paintRow(ctx:CanvasRenderingContext2D,f:Frame,y:number,ink:(c:string)=>void){
 const {w,cw,ch}=f;
 let run='',rc='',rx=0;
 // one fillText per run of same-coloured glyphs in a row (a monospace run keeps the cell grid)
 const flush=()=>{if(run){ink(rc);ctx.fillText(run,rx*cw,y*ch+ch/2);run='';}};
 for(let x=0;x<w;x++){
  const ci=y*w+x,g=f.glyph[ci];
  if(!g||g===' '||f.quad[ci]){
   flush();
   if(!g||!f.quad[ci])continue;
   ink(f.color[ci]);
   for(let k=0;k<4;k++)if(f.mask[ci]&(1<<k))ctx.fillRect(x*cw+(k&1)*cw/2,y*ch+(k>>1)*ch/2,cw/2+.4,ch/2+.4);
   continue;
  }
  if(run&&f.color[ci]!==rc)flush();
  if(!run){rc=f.color[ci];rx=x;}
  run+=g;
 }
 flush();
}
function paintLabels(ctx:CanvasRenderingContext2D,f:Frame,lf:number){
 ctx.font=LABEL_FONT.replace('12px',`${lf}px`);ctx.textAlign='center';
 const lp=lf+2,lh=lf+6; // the pitch of a label's rows, and the height of a one-row label
 for(const l of f.labels){ // a label of two rows ("\n") grows up from its place
  const rows=l.text.toUpperCase().split('\n'),up=(rows.length-1)*lp,tw=Math.max(...rows.map(t=>ctx.measureText(t).width))+12;
  ctx.fillStyle=l.bg??'#000000cc';ctx.beginPath();ctx.roundRect(l.x-tw/2,l.y-lh/2-up,tw,lh+up,9);ctx.fill();
  if(lf===12||l.bg){ctx.strokeStyle=l.color;ctx.lineWidth=1;ctx.stroke();} // at a larger size only the selected label has an edge
  ctx.fillStyle=l.color;rows.forEach((t,i)=>ctx.fillText(t,l.x,l.y+1-up+i*lp));
 }
 ctx.textAlign='start';
}
// the label under a point (px), for taps
export function labelAt(f:Frame,ctx:CanvasRenderingContext2D,x:number,y:number,lf=12):number{
 ctx.font=LABEL_FONT.replace('12px',`${lf}px`);
 for(const l of f.labels){const rows=l.text.toUpperCase().split('\n');if(y<l.y+10&&y>l.y-10-(rows.length-1)*(lf+2)&&Math.abs(x-l.x)<Math.max(...rows.map(t=>ctx.measureText(t).width))/2+8)return l.id;}
 return -1;
}
export function paint(ctx:CanvasRenderingContext2D,f:Frame,font:string,bg:string,lf=12){ // lf: the label size in px
 ctx.fillStyle=bg;ctx.fillRect(0,0,f.w*f.cw,f.h*f.ch);
 ctx.font=font;ctx.textBaseline='middle';
 let cur='';
 const ink=(c:string)=>{if(c!==cur){cur=c;ctx.fillStyle=c;}};
 for(let y=0;y<f.h;y++)paintRow(ctx,f,y,ink);
 if(f.labels.length)paintLabels(ctx,f,lf);
}
