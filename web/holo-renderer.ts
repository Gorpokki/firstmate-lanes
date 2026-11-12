import {fractureAt,fractureDuration} from './simulation-model';
export type TriangleMesh = { lod: readonly [Int16Array, Int16Array] };
export type RenderOptions = { width?: number; height?: number; yaw?: number; pitch?: number; progress?: number; blocks?: boolean; fragments?: number; fractureElapsed?: number; mode?: 'lit'|'blocks' };
export type RenderFraming = { scale:number; cx:number; cy:number };
export type RenderSurface = { frame:string; depth:Float32Array; triangles:Int32Array; framing:RenderFraming };

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

export function renderHoloSurface(source:Int16Array|Float32Array,options:RenderOptions={},framing?:RenderFraming):RenderSurface {
 const width=Math.max(1,Math.floor(options.width??72)),height=Math.max(1,Math.floor(options.height??28));
 const blockMode=options.mode==='blocks',density=blockMode?2:1,rasterWidth=width*density,rasterHeight=height*density,size=rasterWidth*rasterHeight;
 const pixels=Array.from({length:rasterHeight},()=>Array(rasterWidth).fill(' '));
 const depth=new Float32Array(size).fill(Infinity),triangles=new Int32Array(size).fill(-1),brightness=new Float32Array(size);
 const progress=clamp(options.progress??1,0,1),yaw=options.yaw??0,pitch=options.pitch??0;
 const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cpitch=Math.cos(pitch),spitch=Math.sin(pitch);
 const read=(i:number)=>source instanceof Int16Array?source[i]!/32767:source[i]!;
 const rotate=(x:number,y:number,z:number):[number,number,number]=>{
  const rx=x*cyaw-z*syaw,rz=x*syaw+z*cyaw;
  return [rx,y*cpitch-rz*spitch,y*spitch+rz*cpitch];
 };
 const elapsed=options.fractureElapsed??(options.fragments===undefined?undefined:clamp(options.fragments,0,1)*fractureDuration);
 const fracture=elapsed===undefined?null:fractureAt(elapsed),pieces=fracture?.pieces,piecePose=pieces?.map(piece=>({c:Math.cos(piece.rotation),s:Math.sin(piece.rotation)}));
 const buildEdge=-1+2*progress;
 const groupFor=(x:number,y:number)=>clamp(Math.floor((x+1)*1.5),0,2)+3*clamp(Math.floor((y+1)*1.5),0,2);
 const transform=(x:number,y:number,z:number,group:number):[number,number,number]=>{
  if(!pieces)return [x,y,z];
 const piece=pieces[group]!,pose=piecePose![group]!,gx=group%3-1,gy=Math.floor(group/3)-1,dx=x-gx,dy=y-gy;
 return [gx+dx*pose.c-dy*pose.s+piece.x,gy+dx*pose.s+dy*pose.c+piece.y,z+piece.z];
 };
 let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
 for(let i=0;i+8<source.length;i+=9){
  const group=groupFor((read(i)+read(i+3)+read(i+6))/3,(read(i+1)+read(i+4)+read(i+7))/3);
  for(let j=0;j<9;j+=3){
   const [x,y]=rotate(...transform(read(i+j),read(i+j+1),read(i+j+2),group));
   left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
  }
 }
 const extentX=Math.max(.1,right-left),extentY=Math.max(.1,top-bottom);
 const scale=Math.min(rasterWidth*.84/extentX,rasterHeight*.8/extentY);
 const view=framing??{scale,cx:(rasterWidth-(left+right)*scale)/2,cy:(rasterHeight+(bottom+top)*scale)/2};
 for(let i=0;i+8<source.length;i+=9){
  const x0=read(i),x1=read(i+3),x2=read(i+6),centerX=(x0+x1+x2)/3,centerY=(read(i+1)+read(i+4)+read(i+7))/3,group=groupFor(centerX,centerY);
  const vertices:[[number,number,number],[number,number,number],[number,number,number]]=[
   rotate(...transform(x0,read(i+1),read(i+2),group)),rotate(...transform(x1,read(i+4),read(i+5),group)),rotate(...transform(x2,read(i+7),read(i+8),group))];
  const [a,b,c]=vertices,ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],normalLength=Math.hypot(...normal)||1;
  const light=clamp(.2+.8*Math.max(0,(normal[0]*.35+normal[1]*.55+normal[2]*.76)/normalLength),0,1);
  const projected=vertices.map(point=>[view.cx+point[0]*view.scale,view.cy-point[1]*view.scale,point[2]] as const),[p0,p1,p2]=projected;
  const area=(p1[1]-p2[1])*(p0[0]-p2[0])+(p2[0]-p1[0])*(p0[1]-p2[1]);
  if(Math.abs(area)<1e-5)continue;
  const minX=clamp(Math.floor(Math.min(p0[0],p1[0],p2[0])),0,rasterWidth-1),maxX=clamp(Math.ceil(Math.max(p0[0],p1[0],p2[0])),0,rasterWidth-1);
  const minY=clamp(Math.floor(Math.min(p0[1],p1[1],p2[1])),0,rasterHeight-1),maxY=clamp(Math.ceil(Math.max(p0[1],p1[1],p2[1])),0,rasterHeight-1);
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const u=((p1[1]-p2[1])*(x+.5-p2[0])+(p2[0]-p1[0])*(y+.5-p2[1]))/area;
   const v=((p2[1]-p0[1])*(x+.5-p2[0])+(p0[0]-p2[0])*(y+.5-p2[1]))/area,w=1-u-v;
   if(u<0||v<0||w<0)continue;
   if(progress<1&&u*x0+v*x1+w*x2>buildEdge)continue;
   const index=y*rasterWidth+x,z=u*p0[2]+v*p1[2]+w*p2[2],near=-z;
   if(near>=depth[index]!)continue;
   depth[index]=near;triangles[index]=i/9;brightness[index]=light;
  }
 }
 if(fracture&&fracture.particles>0){
  for(let i=0;i<18;i++){
   const angle=i*Math.PI*2/18,radius=(.3+(i%4)*.12)*fracture.particles,[x,y]=rotate(Math.cos(angle)*radius,Math.sin(angle)*radius,Math.sin(angle*3)*radius*.35);
   const px=Math.round(view.cx+x*view.scale),py=Math.round(view.cy-y*view.scale);
   if(px>=0&&px<rasterWidth&&py>=0&&py<rasterHeight)pixels[py]![px]='*';
  }
 }
 const ramp=' .,:-=+*#%@';
 for(let i=0;i<size;i++)if(Number.isFinite(depth[i]!)&&pixels[Math.floor(i/rasterWidth)]![i%rasterWidth]!=='*')pixels[Math.floor(i/rasterWidth)]![i%rasterWidth]=ramp[Math.round(brightness[i]!*(ramp.length-1))]!;
 let frame:string;
 if(!blockMode)frame=pixels.map(row=>row.join('')).join('\n');
 else {
  const quads=[' ','▘','▝','▀','▖','▌','▞','▛','▗','▚','▐','▜','▄','▙','▟','█'];
  const result=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
   const upper=pixels[y*2]!,lower=pixels[y*2+1]!;
   return quads[(upper[x*2]!==' '?1:0)|(upper[x*2+1]!==' '?2:0)|(lower[x*2]!==' '?4:0)|(lower[x*2+1]!==' '?8:0)]!;
  }));
  frame=result.map(row=>row.join('')).join('\n');
 }
 return {frame,depth,triangles,framing:view};
}

export function renderHolo(mesh:TriangleMesh,options:RenderOptions={}) {
 const width=Math.max(1,Math.floor(options.width??72));
 return renderHoloSurface(mesh.lod[width>70?1:0],options).frame;
}

export const fallbackMesh:TriangleMesh={lod:[new Int16Array([
 32767,0,0,-18000,12000,0,-18000,-12000,0,32767,0,0,-18000,-12000,0,-18000,0,12000,
  32767,0,0,-18000,0,12000,-18000,12000,0,-18000,12000,0,-18000,0,12000,-18000,-12000,0,
]),new Int16Array([
  32767,0,0,-18000,12000,0,-18000,-12000,0,32767,0,0,-18000,-12000,0,-18000,0,12000,
  32767,0,0,-18000,0,12000,-18000,12000,0,-18000,12000,0,-18000,0,12000,-18000,-12000,0,
])]};