import {expect,test} from 'bun:test';
import {frame,render,toMesh} from './ascii3d';
import {BLAST,blastFrame,blastPhase,carouselCam,carouselScene,pullback,startBlast} from './scenes';

// synthetic geometry: nine small triangles on a 3 x 3 grid over x and z
const tri=(x:number,z:number,d:number)=>[x-d,0,z,x+d,0,z,x,d,z+d];
const mesh=toMesh(Int16Array.from([-.8,0,.8].flatMap(x=>[-.4,0,.4].flatMap(z=>tri(x,z,.05))),v=>Math.round(v*32767)));
const V={zoom:1,w:160,h:60,cw:4,ch:8},yaw=.3,pitch=.35;
const centre=(p:Float32Array,t:number)=>[0,1,2].map(k=>(p[9*t+k]+p[9*t+3+k]+p[9*t+6+k])/3);

test('the explosion stresses the whole hull, ruptures it, then nine pieces drift with their own velocity and spin until they leave the field',()=>{
 const b=startBlast(mesh,yaw,pitch,7);
 expect(Number.isFinite(b.stress)).toBe(true);expect(b.stress).toBeGreaterThan(0);
 expect(b.sites.length).toBeGreaterThan(0);
 expect(blastFrame(b,'#ff0000',1,b.stress-.01,yaw,pitch,V).scene.objs[0]!.mesh).toBe(mesh);
 expect(b.rup).toBeUndefined();
 const at=(s:number)=>Float32Array.from(blastFrame(b,'#ff0000',1,b.stress+s,yaw,pitch,V).scene.objs[0]!.mesh.pos);
 const p0=at(0),p1=at(1),p2=at(2),X=b.rup!;
 expect(X.chunks.filter(Boolean)).toHaveLength(9);
 for(let i=0;i<p0.length;i++)expect(p0[i]).toBeCloseTo(mesh.pos[i]!,6);
 const speeds=new Set<number>();
 for(let t=0;t<9;t++){
  const c=X.chunks[b.of[t]!]!,a=centre(p0,t),d1=centre(p1,t).map((v,k)=>v-a[k]!),d2=centre(p2,t).map((v,k)=>v-a[k]!);
  speeds.add(Math.hypot(...c.v));
  expect(Number.isFinite(Math.hypot(...c.v))).toBe(true);expect(Number.isFinite(c.spin)).toBe(true);
  d1.forEach((v,k)=>{expect(v).toBeCloseTo(c.v[k]!,5);expect(d2[k]!).toBeCloseTo(2*c.v[k]!,5);}); // constant velocity: no drag, no gravity
  const out=[0,1,2].map(k=>c.c[k]!-X.origin[k]!),l=Math.hypot(...out);
  expect(out.reduce((q,v,k)=>q+v/l*c.v[k]!,0)/Math.hypot(...c.v)).toBeCloseTo(1,6); // the impulse points away from the blast origin
 }
 expect(speeds.size).toBeGreaterThan(1); // each piece has its own velocity
 expect(pullback(0)).toBe(1);expect(pullback(1.1)).toBeCloseTo(.24,9);expect(pullback(5)).toBe(pullback(1.1));
 expect(blastPhase(b,b.stress-.1,V)).toBe('stress');
 expect(blastPhase(b,b.stress+1,V)).toBe('rupture');
 let settled=b.stress;
 while(blastPhase(b,settled,V)!=='settled')settled+=.1;
 expect(settled).toBeLessThanOrEqual(b.stress+BLAST);
 expect(blastPhase(b,settled+5,V)).toBe('settled'); // finite: once gone, the pieces never come back
});

test('the renderer draws a built hull in lit glyphs, an unbuilt one as wire, and bars as quadrant blocks',()=>{
 const plate=toMesh(Int16Array.from([-.9,0,-.5,.9,0,-.5,.9,0,.5,-.9,0,-.5,.9,0,.5,-.9,0,.5],v=>Math.round(v*32767))); // a flat plate, seen from above
 const cam=carouselCam(plate,yaw,pitch,1,160*4,60*8),draw=(prog:number,mode:'lit'|'flat'|'bars',inner?:'blank')=>{const f=frame(null,160,60,4,8);render(f,carouselScene(plate,'','#6FA3FF',prog,inner),cam,mode);return f;};
 const glyphs=(f:ReturnType<typeof frame>)=>f.glyph.filter(Boolean);
 const lit=draw(1,'lit'),flat=draw(1,'flat'),bars=draw(1,'bars'),wire=draw(0,'lit','blank');
 expect(glyphs(lit).length).toBeGreaterThan(0);
 expect(new Set(lit.color.filter(Boolean)).size).toBeGreaterThan(new Set(flat.color.filter(Boolean)).size); // light varies the colour
 expect(glyphs(bars).every(g=>' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'.includes(g))).toBe(true);
 expect(glyphs(wire).length).toBeLessThan(glyphs(lit).length);
 expect(glyphs(wire).every(g=>'─│╲╱┼·'.includes(g))).toBe(true);
});
