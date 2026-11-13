import type {Scene} from './ascii3d';
import type {Berth} from './scenes';
import type {Lane} from './stations';

// How far a berth's ship is built, by its lane: a frame only (holding), a hull in work (working: its two drones work it),
// lit (needs you or waits), launched (done), or stalled (blocked or failed: a steady grey ship).
export const yardOf=(lane:Lane)=>/blocked|failed/.test(lane.sourceState??'')?'stalled':lane.state==='done'?'launched':lane.state==='working'?'hull':lane.state==='needs you'||lane.state==='waiting'?'lit':'scaffold';
export const YARD_KEY=['How far built · frame: holding · hull: working · launched: done','Its state · lit: needs you or waiting · grey ship: blocked'];
export const YARD_HELP='drag moves the yard · shift + drag or two fingers turn it · the wheel or a pinch zooms · double click or double tap: the start';

// A name in rows of at most w letters, cut only between words; a word longer than a row is hyphenated. Past `rows`
// rows the name ends at its last whole word, with "…".
export function nameRows(t:string,w:number,rows=2):string[]{
 const words=t.trim().split(/\s+/),out:{t:string;n:number}[]=[]; // n: whole words that end in this row
 let line='',n=0;
 const push=()=>{out.push({t:line,n});line='';n=0;};
 for(let word of words){
  if(line&&line.length+1+word.length>w)push();
  while(word.length>w){if(line)push();line=word.slice(0,w-1)+'-';word=word.slice(w-1);push();}
  line=line?`${line} ${word}`:word;n++;
 }
 if(line)push();
 if(out.length<=rows)return out.map(o=>o.t);
 const keep=out.slice(0,rows);
 for(;;){
  while(keep.length&&!keep.at(-1)!.n)keep.pop(); // a row that ends inside a word goes, with the rows that led to it
  const last=keep.at(-1);
  if(!last)return [t.slice(0,w-1)+'…'];
  if(last.t.length+1<=w)return [...keep.slice(0,-1).map(o=>o.t),last.t+'…'];
  if(last.n>1)keep[keep.length-1]={t:last.t.slice(0,last.t.lastIndexOf(' ')),n:last.n-1}; // no room for the "…": the row gives up a word
  else if(keep.length<rows)return [...keep.map(o=>o.t),'…'];
  else keep.pop();
 }
}
// The yard at rest: the needs-you hulls are the lit things, every scaffold rests in one faint grey, and only the selected
// berth keeps its floor-level frame, lights and trail; a done ship's trail is green, its state's colour.
const NAME_HOT='#C9BCAB',NAME_REST='#9C9184';
function calm(sc:Scene,on:number|undefined,hot:(id:number)=>boolean):Scene{
 return {...sc,
  objs:sc.objs.map(o=>({...o,glow:(o.glow??1)*(hot(o.id)?1.3:1)})),
  segs:(sc.segs??[]).filter(s=>!(s.back&&s.id!==on)).map(s=>s.back?{...s,color:'#4A4450'}:s),
  dots:(sc.dots??[]).filter(d=>!(d.id!==on&&'•≈~·'.includes(d.ch))).map(d=>{const m=/^rgb\((\d+),(\d+),255\)$/.exec(d.color);return m?{...d,color:`rgb(${Number(m[2])>>3},${Number(m[2])>>1},${Number(m[2])>>2})`}:d;}),
 };
}
// Each berth has its lane's name above its back edge, cut at a word to `max` letters a row; the selected one is cream.
export const berthNames=(sc:Scene,berths:Berth[],sel:string,max:number):Scene=>({
 ...calm(sc,berths.find(b=>b.lane.id===sel)?.i,id=>!!berths[id]?.lane.hot),
 labels:berths.map(b=>{const on=b.lane.id===sel;return {p:[(b.x0+b.x1)/2,b.y1+1.5,b.at[2]-Math.max(...berths.filter(o=>o.at[2]===b.at[2]).map(o=>o.zf))],text:nameRows(b.lane.name,max,3).join('\n'),color:on?'#FFF4DC':b.lane.hot?NAME_HOT:NAME_REST,id:b.i,bg:on?'#000000e6':undefined};}),
});
