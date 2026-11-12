import type {TriangleMesh} from './holo-renderer';

export type ShipMesh={id:string;name:string;mesh:TriangleMesh};

export function assignedShip(laneId:string,meshes:readonly ShipMesh[]=[]):ShipMesh|undefined {
 if(!meshes.length)return undefined;
 let hash=0;
 for(let i=0;i<laneId.length;i++)hash=(Math.imul(hash,31)+laneId.charCodeAt(i))|0;
 return meshes[(hash>>>0)%meshes.length];
}

export async function loadCatalog(signal?:AbortSignal):Promise<{models:ShipMesh[];warnings:string[]}> {
 const response=await fetch('/meshes.json',{cache:'no-store',signal});
 if(!response.ok)throw Error('Model catalog unavailable');
 const catalog=await response.json() as {models:{id:string;name:string}[];warnings:string[]};
 const models=await Promise.all(catalog.models.map(async model=>{
  const lod=await Promise.all((['lo','hi'] as const).map(async level=>{
   const data=await fetch(`/mesh?id=${encodeURIComponent(model.id)}&lod=${level}`,{cache:'no-store',signal});
   if(!data.ok)throw Error(`Model is no longer admitted: ${model.name}`);
   const bytes=await data.arrayBuffer();
   if(!bytes.byteLength||bytes.byteLength%18)throw Error('Invalid triangle geometry');
   const values=new Int16Array(bytes.byteLength/2),view=new DataView(bytes);
   for(let i=0;i<values.length;i++)values[i]=view.getInt16(i*2,true);
   return values;
  }));
  return {...model,mesh:{lod:[lod[0],lod[1]]} as TriangleMesh};
 }));
 return {models,warnings:catalog.warnings||[]};
}
