import type {Lane} from './stations';
import {states} from './stations';
import type {TriangleMesh} from './holo-renderer';
import {assignedShip,type ShipMesh} from './mesh-catalog';

export type ShipyardRow={lane:Lane;mesh?:TriangleMesh;meshName?:string};
export type ShipyardLayoutItem={row:ShipyardRow;x:number;y:number;offscreen:boolean;showLabel:boolean};

export function deriveShipyardRows(lanes:Lane[],meshes:ShipMesh[]=[],filter:string|null=null):ShipyardRow[] {
 const ordered=lanes.toSorted((a,b)=>states.indexOf(a.state)-states.indexOf(b.state)||a.id.localeCompare(b.id));
 return ordered.filter(lane=>!filter||lane.state===filter).map(lane=>{
  const ship=assignedShip(lane.id,meshes);
  return {lane,mesh:ship?.mesh,meshName:ship?.name};
 });
}

export function layoutShipyard(rows:ShipyardRow[],width:number,height:number,selected='',camera={x:0,y:0,zoom:1}):ShipyardLayoutItem[] {
 const cellWidth=180,cellHeight=150,columns=Math.max(1,Math.floor(width/cellWidth));
 const placed=rows.map((row,index)=>{
  const x=(index%columns+.5)*cellWidth,y=(Math.floor(index/columns)+.5)*cellHeight;
  const screenX=width/2+camera.x+(x-width/2)*camera.zoom,screenY=height/2+camera.y+(y-height/2)*camera.zoom,halfWidth=Math.min(85,Math.max(42,row.lane.name.length*4+12))*camera.zoom,labelY=screenY+54*camera.zoom;
  return {row,x,y,offscreen:screenX-halfWidth<0||screenX+halfWidth>width||labelY-10<0||labelY+10>height,showLabel:false};
 });
 const labelBounds:{x:number;y:number;halfWidth:number}[]=[];
 for(const item of [...placed].sort((a,b)=>Number(b.row.lane.id===selected)-Number(a.row.lane.id===selected))){
  const isSelected=item.row.lane.id===selected;
  if(item.offscreen&&!isSelected)continue;
  const x=width/2+camera.x+(item.x-width/2)*camera.zoom,y=height/2+camera.y+(item.y-height/2)*camera.zoom+54*camera.zoom,halfWidth=Math.min(85,Math.max(42,item.row.lane.name.length*4+12))*camera.zoom;
  const overlaps=labelBounds.some(other=>Math.abs(x-other.x)<halfWidth+other.halfWidth&&Math.abs(y-other.y)<20*camera.zoom);
  if(!overlaps||isSelected){item.showLabel=true;labelBounds.push({x,y,halfWidth});}
 }
 return placed;
}
