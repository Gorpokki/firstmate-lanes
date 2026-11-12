import {fileURLToPath,pathToFileURL} from 'node:url';

const renderer=process.argv[2];
if(!renderer)throw Error('renderer module path is required');
const tolerance=Number(process.argv[3]??.02),limit=Number(process.argv[4]??.01);
if(!(tolerance>0&&limit>0&&limit<1))throw Error('invalid visible-defect thresholds');
const input=await Bun.stdin.arrayBuffer();
if(input.byteLength<8)throw Error('missing triangle counts');
const header=new DataView(input),sourceCount=header.getUint32(0,true),outputCount=header.getUint32(4,true);
if(!sourceCount||!outputCount||sourceCount%9||outputCount%9||input.byteLength!==8+(sourceCount+outputCount)*4)throw Error('invalid triangle payload');
const source=new Float32Array(input,8,sourceCount),output=new Float32Array(input,8+sourceCount*4,outputCount);
// The converter selects the installed product renderer at runtime; a static import would bind the wrong checkout.
const {renderHoloSurface}=await import(pathToFileURL(renderer).href);
const normals=(positions:Float32Array)=>{
 const result=new Float32Array(positions.length/3);
 for(let i=0;i<positions.length;i+=9){
  const ax=positions[i+3]!-positions[i]!,ay=positions[i+4]!-positions[i+1]!,az=positions[i+5]!-positions[i+2]!;
  const bx=positions[i+6]!-positions[i]!,by=positions[i+7]!-positions[i+1]!,bz=positions[i+8]!-positions[i+2]!;
  const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx,length=Math.hypot(x,y,z)||1;
  result[i/3]=x/length;result[i/3+1]=y/length;result[i/3+2]=z/length;
 }
 return result;
};
const sourceNormals=normals(source),outputNormals=normals(output);
const standard:[[number,number],[number,number],[number,number],[number,number],[number,number],[number,number],[number,number],[number,number],[number,number]]=[
 [.65,.4],[2.2,.65],[-1.4,-.3],[0,0],[Math.PI,0],[Math.PI/2,0],[-Math.PI/2,0],[0,Math.PI/2],[0,-Math.PI/2]];
const views:{view:number;yaw:number;pitch:number;reference_pixels:number;missing_pixels:number;missing_ratio:number;added_pixels:number;added_ratio:number;inverted_normal_pixels:number;inverted_normal_ratio:number;max_depth_error:number}[]=[];
const errors:string[]=[];
for(let index=0;index<standard.length;index++){
 const [yaw,pitch]=standard[index]!;
 const options={width:96,height:48,mode:'blocks' as const,yaw,pitch};
 const reference=renderHoloSurface(source,options),candidate=renderHoloSurface(output,options,reference.framing);
 let total=0,missing=0,added=0,inverted=0,maximum=0;
 for(let pixel=0;pixel<reference.depth.length;pixel++){
  const expected=reference.depth[pixel]!,actual=candidate.depth[pixel]!,present=Number.isFinite(expected),visible=Number.isFinite(actual);
  if(present){
   total++;
   if(!visible||actual>expected+tolerance)missing++;
   if(visible){
    maximum=Math.max(maximum,Math.abs(expected-actual));
    if(Math.abs(expected-actual)<=tolerance){
     const sourceNormal=3*reference.triangles[pixel]!,outputNormal=3*candidate.triangles[pixel]!;
     if(sourceNormals[sourceNormal]!*outputNormals[outputNormal]!+sourceNormals[sourceNormal+1]!*outputNormals[outputNormal+1]!+sourceNormals[sourceNormal+2]!*outputNormals[outputNormal+2]!<-.5)inverted++;
    }
   }
  }
  if(visible&&(!present||actual<expected-tolerance))added++;
 }
 if(!total)continue;
 const row={view:index,yaw,pitch,reference_pixels:total,missing_pixels:missing,missing_ratio:missing/total,added_pixels:added,added_ratio:added/total,inverted_normal_pixels:inverted,inverted_normal_ratio:inverted/total,max_depth_error:maximum};
 views.push(row);
 for(const field of ['missing_ratio','added_ratio','inverted_normal_ratio'] as const)if(row[field]>limit)errors.push(`view ${index}: ${field} ${row[field].toFixed(5)} exceeds ${limit}`);
}
if(!views.length)errors.push('reference has no visible sampled surface');
const rendererHash=new Bun.CryptoHasher('sha256').update(await Bun.file(renderer).arrayBuffer()).digest('hex');
const checkerHash=new Bun.CryptoHasher('sha256').update(await Bun.file(fileURLToPath(import.meta.url)).arrayBuffer()).digest('hex');
console.log(JSON.stringify({pass:errors.length===0,errors,reference_checked:true,views,tolerance,max_visible_loss:limit,renderer_sha256:rendererHash,checker_sha256:checkerHash}));