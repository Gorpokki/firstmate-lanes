import {expect,test} from 'bun:test';
import {type RenderSurface,fallbackMesh,renderHolo,renderHoloSurface} from './holo-renderer';

const render=(fractureElapsed?:number)=>renderHolo(fallbackMesh,{width:24,height:12,yaw:.4,pitch:.2,progress:1,fractureElapsed});

test('the build plane preserves and removes the expected world-space regions',()=>{
 const triangle=new Int16Array([-16384,-16384,0,16384,-16384,0,16384,16384,0]);
 const surface=(progress:number)=>renderHoloSurface(triangle,{width:40,height:20,yaw:0,pitch:0,progress});
 const samples=(view:RenderSurface)=>[-.3,.3].map(x=>{
  const row=Math.floor(view.framing.cy+.4*view.framing.scale),column=Math.floor(view.framing.cx+x*view.framing.scale);
  return view.frame.split('\n')[row]![column]!==' ';
 });
 expect(samples(surface(0))).toEqual([false,false]);
 expect(samples(surface(.4))).toEqual([true,false]);
 expect(samples(surface(1))).toEqual([true,true]);
});

test('partial reveal covers a narrow mesh at phone and desktop cell sizes without moving framing',()=>{
 const rectangle=new Int16Array([-3277,-32767,0,3277,-32767,0,3277,32767,0,-3277,-32767,0,3277,32767,0,-3277,32767,0]);
 for(const {width,height,holdingSamples} of [{width:39,height:14,holdingSamples:[true,true]},{width:72,height:27,holdingSamples:[true,false]}]){
  const surface=(progress:number)=>renderHoloSurface(rectangle,{width,height,yaw:0,pitch:.16,progress});
  const samples=(view:RenderSurface)=>[-.05,.05].map(x=>{
   const row=Math.floor(view.framing.cy),column=Math.floor(view.framing.cx+x*view.framing.scale);
   return Number.isFinite(view.depth[row*width+column]);
  });
  const hidden=surface(0),holding=surface(.35),full=surface(1);
  expect(samples(hidden)).toEqual([false,false]);
  expect(samples(holding)).toEqual(holdingSamples);
  expect(samples(full)).toEqual([true,true]);
  expect(holding.framing).toEqual(full.framing);
 }
});

test('fracture starts intact, separates rigid pieces, bursts particles, and stops at its end',()=>{
 const intact=render(),start=render(0),burst=render(1800),end=render(3000);
 expect(start).toBe(intact);
 expect(burst).not.toBe(intact);
 expect(burst).toContain('*');
 expect(end).not.toBe(intact);
 expect(render(6000)).toBe(end);
});
test('surface buffers expose near depth and original face attribution',()=>{
 const source=new Float32Array([-0.8,-0.8,0.2,0.8,-0.8,0.2,0.8,0.8,0.2,-0.8,-0.8,0.2,0.8,0.8,0.2,-0.8,0.8,0.2]);
 const full=renderHoloSurface(source,{width:32,height:16,mode:'blocks'});
 const missing=renderHoloSurface(source.subarray(0,9),{width:32,height:16,mode:'blocks'},full.framing);
 const visible=Array.from(full.triangles).filter(face=>face>=0);
 expect(visible.length).toBeGreaterThan(0);
 expect(visible).toContain(0);
 expect(visible).toContain(1);
 expect(visible.every(face=>face===0||face===1)).toBe(true);
 expect(Array.from(full.depth).some((depth,index)=>depth<0&&full.triangles[index]===0)).toBe(true);
 expect(Array.from(missing.depth).filter(Number.isFinite).length).toBeLessThan(visible.length);
});
