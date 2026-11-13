// The holo view's scenes, with no UI: the carousel (one lane's ship, turning) and its explosion. A port of the approved
// prototype's scenes, which follow the first Go ship renderer.
import {hex} from './ascii3d';
import type {Cam,Dot,Inner,Mesh,RGB,Scene,V3} from './ascii3d';

export const SPIN=.75; // rad/s: one turn in about 8.4 s
export const CAR0={yaw:-.65,pitch:.35};
// Fit the ship in w x h px. As the original Go ship renderer ("zoom 1 fills the available field without clipping any
// vertex"): the fit is taken from the turned ship's own extent on every frame, so the ship stays as large as the field
// allows at every angle of a turn, and a nose-on ship does not shrink to the size its full length needs.
export function carouselCam(m:Mesh,yaw:number,pitch:number,zoom:number,wPx:number,hPx:number):Cam{
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),P=m.pos;
 let rx=1e-6,ry=1e-6;
 for(let i=0;i<P.length;i+=3){
  rx=Math.max(rx,Math.abs(P[i]*cy-P[i+2]*sy));
  ry=Math.max(ry,Math.abs(P[i+1]*cp-(P[i]*sy+P[i+2]*cy)*sp));
 }
 return {yaw,pitch,ppu:Math.min(wPx*.47/rx,hPx*.47/ry)*zoom,px:0,py:0};
}
export const STALLED:RGB=[0x5a,0x56,0x62];
// status: "blocked" draws a steady grey ship (red means needs-you everywhere else); "failed" breaks the hull apart
export function carouselScene(m:Mesh,status:string,color:string,prog:number,inner?:Inner):Scene{
 const rgb=status==='blocked'?STALLED:hex(color);
 return {objs:[{mesh:m,at:[0,0,0],s:1,id:0,rgb,prog,broken:status==='failed',inner}]};
}

// ---------------- explosion ----------------
// The explosion of the first Go ship renderer, with its numbers. There, one tick is 0.1 s and one model unit is the
// hull's bounding radius. In order:
//   stress, 1 to 3 s: 5 to 9 places on the hull erupt, each with a shell of hot fragments and a plume of gas;
//   the rupture: a small white ignition, then the radial blast, which grows, then flies apart and thins;
//   the hull, in 3 x 3 rigid pieces (by where a triangle lies along x and z). A piece gets one radial impulse away from
//   the blast origin. After that it has a constant velocity and a constant spin about its own centre: no drag, no
//   gravity, no collisions. The pieces drift out of the field.
// The camera draws back to a field about four times wider in the first 1.1 s, then holds. Time is continuous here.
// The drawing ends once every piece has left the field for good, or BLAST s after the rupture.
const TICK=.1,RAMP='.,:;-=+*#%@',FIRE=[[54,49,48],[130,43,20],[239,75,12],[255,154,25],[255,224,112],[255,253,235]];
export const BLAST=20;
const rng=(seed:number)=>()=>{seed=(seed+0x6d2b79f5)|0;let x=Math.imul(seed^(seed>>>15),1|seed);x=(x+Math.imul(x^(x>>>7),61|x))^x;return ((x^(x>>>14))>>>0)/4294967296;};
// the radial blast, in cells around its origin: spokes of particles and a ragged shell, each particle with its own drift
const BURST=(()=>{
 const r=rng(42),xy:number[]=[];
 for(let k=0;k<40;k++){
  const a=k*Math.PI/20+(r()-.5)*.12,len=.45+.55*r();
  for(let d=.3;d<len;d+=.03)xy.push(Math.cos(a)*d*16+(r()-.5)*.6,Math.sin(a)*d*9+(r()-.5)*.4);
 }
 for(let k=0;k<700;k++){const a=r()*Math.PI*2,d=.35+.6*Math.sqrt(r());xy.push(Math.cos(a)*d*16,Math.sin(a)*d*9);}
 return {xy,hw:17.5,hh:9.5};
})();
const fire0=(heat:number,op:number)=>{const v=Math.max(0,Math.min(.9999,heat))*5,i=Math.floor(v),f=v-i;return `rgb(${[0,1,2].map(k=>Math.round((FIRE[i][k]*(1-f)+FIRE[i+1][k]*f)*op)).join()})`;};
const HOT=Array.from({length:65},(_,i)=>fire0(i/64,1)); // a frame has some 1500 particles: their colours come from a table
// white-yellow core, orange rim, red embers, smoke; it fades to the black of the field
const fire=(heat:number,op=1)=>op===1?HOT[Math.round(Math.max(0,Math.min(1,heat))*64)]:fire0(heat,op);
const ramp=(heat:number)=>RAMP[Math.min(RAMP.length-1,Math.floor(heat*RAMP.length))];
const dirOf=(seed:number,j:number):V3=>{const th=(seed+j*137)*2.39996323,z=Math.sin((seed+j*71)*1.618),r=Math.sqrt(1-z*z);return [r*Math.cos(th),z,r*Math.sin(th)];};
// the screen's axes in model space: right, up, and toward the viewer
const axes=(yaw:number,pitch:number)=>{const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);return {r:[cy,0,-sy] as V3,u:[-sy*sp,cp,-cy*sp] as V3,n:[sy*cp,sp,cy*cp] as V3};};
export const pullback=(s:number)=>1-.76*((1-Math.exp(-4*Math.min(1.1,s)))/(1-Math.exp(-4.4))); // s: seconds since the rupture
type Site={p:V3;vent:V3;start:number;seed:number};
export type Chunk={c:V3;v:V3;ax:V3;spin:number;rad:number}; // centre, velocity (units/s), spin axis, spin (rad/s), reach from the centre
type Rupture={fit:number;chunks:(Chunk|null)[];pos:Float32Array;origin:V3;col:number;row:number;burst:Float32Array};
// of: each triangle's piece; cen: the centre of each piece (NaN: no such piece); stress: seconds from the start to the rupture
export type Blast={m:Mesh;R:number;stress:number;sites:Site[];rnd:()=>number;of:Uint8Array;cen:Float64Array;rup?:Rupture};
export type BlastView={zoom:number;w:number;h:number;cw:number;ch:number}; // the zoom; the field in cells; one cell in px
export type BlastPhase='stress'|'rupture'|'debris'|'settled';

// where the hull erupts: a random triangle on the half of the hull that faces the viewer
function stressSite(m:Mesh,n:V3,rnd:()=>number,j:number,count:number,ticks:number):Site{
 const P=m.pos;
 let p:V3=[0,0,0];
 // ponytail: a face toward the viewer, not a drawn cell as the original; read the depth buffer if a site must never be hidden
 for(let k=0;k<8;k++){const t=Math.floor(rnd()*m.n)*9;p=[0,1,2].map(a=>(P[t+a]+P[t+3+a]+P[t+6+a])/3) as V3;if(p[0]*n[0]+p[1]*n[1]+p[2]*n[2]>=0)break;}
 const l=Math.hypot(p[0],p[1],p[2]);
 return {p,vent:l?[p[0]/l,p[1]/l,p[2]/l]:[0,1,0],start:Math.floor(j*ticks*3/(count*4)),seed:Math.floor(rnd()*1000)};
}
// The stress starts: where the hull will erupt, and for how long, before it ruptures.
export function startBlast(m:Mesh,yaw:number,pitch:number,seed:number):Blast{
 const rnd=rng(seed),P=m.pos,{n}=axes(yaw,pitch);
 let R=1e-6;
 for(let i=0;i<P.length;i+=3)R=Math.max(R,Math.hypot(P[i],P[i+1],P[i+2]));
 const ticks=10+Math.floor(rnd()*21),count=5+Math.floor(rnd()*5),sites:Site[]=[];
 for(let j=0;j<count;j++)sites.push(stressSite(m,n,rnd,j,count,ticks));
 // the nine pieces: a triangle belongs to the cell of a 3 x 3 grid over x and z that holds its centre; a piece's centre is the mean of its points
 const N=9,sum=new Float64Array(N*3),cnt=new Float64Array(N),of=new Uint8Array(m.n),kx=3/Math.max(1e-9,m.hi[0]-m.lo[0]),kz=3/Math.max(1e-9,m.hi[2]-m.lo[2]);
 for(let t=0,j=0;t<m.n;t++,j+=9){
  const x=P[j]+P[j+3]+P[j+6],y=P[j+1]+P[j+4]+P[j+7],z=P[j+2]+P[j+5]+P[j+8];
  const i=Math.min(2,Math.max(0,Math.floor((z/3-m.lo[2])*kz)))*3+Math.min(2,Math.max(0,Math.floor((x/3-m.lo[0])*kx)));
  of[t]=i;cnt[i]+=3;sum[3*i]+=x;sum[3*i+1]+=y;sum[3*i+2]+=z;
 }
 return {m,R,stress:ticks*TICK,sites,rnd,of,cen:sum.map((v,i)=>cnt[(i/3)|0]?v/cnt[(i/3)|0]:NaN)};
}
// the blast origin: the centre of the ship as drawn, on the plane through the model's centre that faces the viewer
// ponytail: the centre of the triangles' drawn area; the original takes the centre of the drawn cells. They differ where the hull covers itself.
function blastOrigin(P:Float32Array,r:V3,u:V3):[number,number]{
 let A=0,ox=0,oy=0;
 const dot=(j:number,a:V3)=>P[j]*a[0]+P[j+1]*a[1]+P[j+2]*a[2];
 for(let j=0;j<P.length;j+=9){
  const x0=dot(j,r),y0=dot(j,u),x1=dot(j+3,r),y1=dot(j+3,u),x2=dot(j+6,r),y2=dot(j+6,u);
  const a=Math.abs((x1-x0)*(y2-y0)-(x2-x0)*(y1-y0));
  A+=a;ox+=a*(x0+x1+x2);oy+=a*(y0+y1+y2);
 }
 return [ox/(3*A||1),oy/(3*A||1)];
}
const unit=(v:number[]):V3|null=>{const l=Math.hypot(v[0],v[1],v[2]);return l?[v[0]/l,v[1]/l,v[2]/l]:null;};
// a piece's radial impulse away from the origin, then inertia; its reach bounds where its points can be
function chunk(b:Blast,i:number,origin:V3):Chunk|null{
 if(Number.isNaN(b.cen[3*i]))return null;
 const c:V3=[b.cen[3*i],b.cen[3*i+1],b.cen[3*i+2]],P=b.m.pos,rnd=b.rnd;
 const d=unit([c[0]-origin[0],c[1]-origin[1],c[2]-origin[2]])??[1,0,0],sp=(.65+rnd()*.3)*b.R;
 let rad=0;
 for(let t=0;t<b.m.n;t++)if(b.of[t]===i)for(let k=0;k<9;k+=3)rad=Math.max(rad,Math.hypot(P[9*t+k]-c[0],P[9*t+k+1]-c[1],P[9*t+k+2]-c[2]));
 return {c,v:[d[0]*sp,d[1]*sp,d[2]*sp],ax:unit([rnd()-.5,rnd()-.5,rnd()-.5])??[0,1,0],spin:.8+rnd()*1.1,rad};
}
// The rupture: the blast origin, the nine pieces with their impulse, and the particles of the blast drawing.
function rupture(b:Blast,yaw:number,pitch:number,V:BlastView):Rupture{
 const {r,u}=axes(yaw,pitch),ppu=carouselCam(b.m,yaw,pitch,V.zoom,V.w*V.cw,V.h*V.ch).ppu,[ox,oy]=blastOrigin(b.m.pos,r,u);
 const origin:V3=[r[0]*ox+u[0]*oy,r[1]*ox+u[1]*oy,r[2]*ox+u[2]*oy];
 const chunks=Array.from({length:9},(_,i)=>chunk(b,i,origin));
 // the blast drawing stays at the blast origin and fits the room around it; a particle's velocity is in cells for each tick
 const bx=Math.round(V.w/2+ox*ppu/V.cw),by=Math.round(V.h/2-oy*ppu/V.ch);
 const fit=.94*Math.max(.05,Math.min(Math.min(bx,V.w-1-bx)/BURST.hw,Math.min(by,V.h-1-by)/BURST.hh)),xy=BURST.xy,burst=new Float32Array(xy.length*2);
 for(let i=0;i<xy.length;i+=2){const px=xy[i]*fit,py=xy[i+1]*fit;burst.set([px,py,px*.025+(b.rnd()-.5)*.25,py*.025+(b.rnd()-.5)*.125],i*2);}
 return {fit:ppu/V.zoom,chunks,pos:new Float32Array(b.m.pos.length),origin,col:V.cw/ppu,row:V.ch/ppu,burst};
}
type Put=(x:number,y:number)=>void;
// the blast drawing, 3 s: an ignition, a small white disc that grows; then the drawing grows to its full size by 1.2 s,
// then each particle flies on its own, and they thin out
function blastDrawing(X:Rupture,tick:number,put:Put){
 if(tick<3){
  const radius=(Math.floor(tick)+1)*1.2;
  for(let y=-6;y<=6;y++)for(let x=-10;x<=10;x++)if(Math.hypot(x/2,y/2)<=radius)put(x/2,y/4);
  return;
 }
 const scale=.2+.8*Math.min(1,(tick-2)/10),drift=Math.max(0,tick-12),B=X.burst;
 for(let i=0;i<B.length;i+=4)if(drift<=8+((i/4)*17)%11)put(B[i]*scale+B[i+2]*drift,B[i+1]*scale+B[i+3]*drift);
}
// the eruptions: each has one expansion and particles that live a fixed time; the gas goes on after the rupture
function siteDots(b:Blast,site:Site,a:number,at:(p:number[])=>V3,dots:Dot[]){
 for(let j=0;j<24;j++){ // hot fragments on a small shell that grows: a bright core, then orange sparks, then red embers
  const life=7+(site.seed+j*11)%6;
  if(a>=life)continue;
  const pr=a/life,rad=(.008+a*.009)*b.R,d=dirOf(site.seed,j),heat=Math.max(0,1-pr*.85-(j%4)*.035);
  dots.push({p:at([site.p[0]+d[0]*rad,site.p[1]+d[1]*rad,site.p[2]+d[2]*rad]),ch:ramp(heat),color:fire(heat,Math.min(1,(1-pr)*2)),id:0});
 }
 for(let j=0;j<14;j++){ // the plume: a puff expands, drifts along the vent and fades, from its own birth
  const tt=a-Math.floor(j/3),life=16+(site.seed+j*7)%9,pr=tt/life,op=(1-pr)*(1-pr)*.9;
  if(tt<0||tt>=life||op<=.015)continue;
  const d=dirOf(site.seed,j),rad=(.008+tt*.0025)*b.R,w=tt*TICK*b.R,c=[0,1,2].map(i=>site.p[i]+(site.vent[i]*.11+d[i]*.045)*w);
  for(let q=0;q<6;q++){const e=dirOf(site.seed+j,q);dots.push({p:at([c[0]+e[0]*rad,c[1]+e[1]*rad,c[2]+e[2]*rad]),ch:pr>.5?'.':':',color:fire(0,op),id:0});}
 }
}
// a piece: its centre moves at its velocity; its points turn about its centre, about its axis
function movePieces(b:Blast,X:Rupture,s:number){
 const P=b.m.pos,pose=X.chunks.map(c=>c&&{c,cs:Math.cos(s*c.spin),sn:Math.sin(s*c.spin)});
 for(let tr=0;tr<b.m.n;tr++){
  const {c,cs,sn}=pose[b.of[tr]]!,[ux,uy,uz]=c.ax;
  for(let v=0;v<3;v++){
   const j=9*tr+3*v,x=P[j]-c.c[0],y=P[j+1]-c.c[1],z=P[j+2]-c.c[2],k=(ux*x+uy*y+uz*z)*(1-cs);
   X.pos[j]=c.c[0]+c.v[0]*s+x*cs+(uy*z-uz*y)*sn+ux*k;
   X.pos[j+1]=c.c[1]+c.v[1]*s+y*cs+(uz*x-ux*z)*sn+uy*k;
   X.pos[j+2]=c.c[2]+c.v[2]*s+z*cs+(ux*y-uy*x)*sn+uz*k;
  }
 }
}
// One frame, t seconds after the stress started: the scene and its camera.
export function blastFrame(b:Blast,color:string,prog:number,t:number,yaw:number,pitch:number,V:BlastView,inner?:Inner):{scene:Scene;cam:Cam}{
 const {r,u,n}=axes(yaw,pitch),dots:Dot[]=[],age=t/TICK;
 if(!b.rup&&t>=b.stress)b.rup=rupture(b,yaw,pitch,V);
 const X=b.rup,s=X?Math.max(0,t-b.stress):0,tick=s/TICK,pull=pullback(s);
 // the view has no perspective: a move along the view axis changes only what covers what. As the original draws them:
 // the gas over the whole ship, then the pieces over the gas, then the blast over all.
 const K=8*b.R,lift=(p:number[],k:number):V3=>[p[0]+n[0]*k,p[1]+n[1]*k,p[2]+n[2]*k];
 if(X&&tick<30)blastDrawing(X,tick,(x,y)=>{ // x, y: cells from the blast origin, before the camera's pullback
  const radius=Math.max(2,V.h*Math.min(1,(tick+1)/12)*pull),cell=Math.round(x*pull)+Math.round(y*pull)*V.w;
  const heat=Math.max(0,Math.min(1,1-Math.min(1,Math.hypot(x*pull,y*pull*2)/radius)*.52-Math.max(0,tick-12)*.045+.05*Math.sin(cell*1.7+Math.floor(tick)*.8)));
  const dx=x*X.col,dy=-y*X.row;
  dots.push({p:lift([X.origin[0]+r[0]*dx+u[0]*dy,X.origin[1]+r[1]*dx+u[1]*dy,X.origin[2]+r[2]*dx+u[2]*dy],K),ch:ramp(heat),color:fire(heat),id:0});
 });
 for(const site of b.sites){const a=age-site.start;if(a>=0&&a<=30)siteDots(b,site,a,p=>lift(p,X?-K:K),dots);}
 if(!X)return {scene:{objs:[{mesh:b.m,at:[0,0,0],s:1,id:0,rgb:hex(color),prog,inner}],dots},cam:carouselCam(b.m,yaw,pitch,V.zoom,V.w*V.cw,V.h*V.ch)};
 movePieces(b,X,s);
 const g=Math.exp(-tick*.12)*.8,rgb=[255,154,45].map(h=>Math.round(175*(1-g)+h*g)) as RGB; // hot metal cools to soot grey while it tumbles
 return {scene:{objs:[{mesh:{...b.m,pos:X.pos},at:[0,0,0],s:1,id:0,rgb,prog,inner}],dots},cam:{yaw,pitch,ppu:X.fit*V.zoom*pull,px:0,py:0}};
}
// Where the explosion is at t s: before the rupture, the blast drawing, the debris, or done. Done means every eruption
// has burnt out, the drawing is over and every piece is farther from the centre than the field's corners, so no turn of
// the camera brings it back; or BLAST s have passed.
export function blastPhase(b:Blast,t:number,V:BlastView):BlastPhase{
 const X=b.rup,s=t-b.stress;
 if(!X||s<0)return 'stress';
 if(s<3)return 'rupture';
 if(s>=BLAST)return 'settled';
 const ppu=X.fit*V.zoom*pullback(s),corner=Math.hypot(V.w*V.cw,V.h*V.ch)/2/ppu,gas=Math.max(...b.sites.map(site=>site.start))+30;
 const gone=X.chunks.every(c=>!c||Math.hypot(c.c[0]+c.v[0]*s,c.c[1]+c.v[1]*s,c.c[2]+c.v[2]*s)-c.rad>corner);
 return gone&&t/TICK>gas?'settled':'debris';
}
