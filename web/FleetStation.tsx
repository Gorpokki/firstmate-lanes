import React,{useState} from 'react';
import {type Fleet,type Lane} from './stations';
import {deriveFleet,type FleetState} from './fleet-model';
import {Shipyard} from './Shipyard';
import type {TriangleMesh} from './holo-renderer';

const colors:Record<string,string>={'needs you':'#ff967b',waiting:'#e9bd72',working:'#82c8ed',done:'#98d3a4',holding:'#b6a4c7'};

export function FleetStation({fleet,onSelect,meshes}:{fleet:Fleet;onSelect:(lane:Lane)=>void;meshes?:{id:string;name:string;mesh:TriangleMesh}[]}) {
 const [filter,setFilter]=useState<FleetState|null>(null),[motion,setMotion]=useState(true),[selected,setSelected]=useState('');
 const [yard,setYard]=useState(false);
 const {rows,shares}=deriveFleet(fleet,filter);
 return <section className="fleet-station" data-motion={motion} aria-label="Fleet heat grid">
  <style>{`.fleet-station{--fleet-border:#596171}.fleet-station button{font:inherit;color:inherit;background:#252d39;border:1px solid var(--fleet-border);border-radius:8px;cursor:pointer}.fleet-station button:focus-visible,.fleet-station input:focus-visible{outline:3px solid #82c8ed;outline-offset:2px}.fleet-state-bar{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.fleet-state-bar button{padding:8px 10px;border-bottom:3px solid var(--state-color)}.fleet-state-bar button[aria-pressed=true]{background:#34465c}.fleet-share{color:#b5bfcd;margin-left:6px}.fleet-motion{display:inline-flex;align-items:center;gap:8px;margin:8px 0 14px}.fleet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:7px}.fleet-tile{position:relative;min-width:0;aspect-ratio:1;background:var(--state-color)!important;color:#101318!important;padding:5px!important;overflow:hidden;text-align:left}.fleet-tile[aria-pressed=true]{outline:3px solid #fff}.fleet-tile-name{display:block;font-size:12px;line-height:1.2;overflow-wrap:anywhere}.fleet-drone{position:absolute;width:8px;height:8px;right:5px;top:5px;border-radius:50%;background:#fff;box-shadow:0 0 8px #fff;animation:fleet-flight 2.4s ease-in-out infinite alternate}.fleet-station[data-motion=false] .fleet-drone{animation:none}@keyframes fleet-flight{to{transform:translate(-30px,20px)}}@media(prefers-reduced-motion:reduce){.fleet-drone{animation:none}}`}</style>
  <h2>Fleet</h2>
  <div className="fleet-state-bar" role="group" aria-label="Filter lanes by state">{shares.map(({state,count,percentage})=><button key={state} type="button" aria-pressed={filter===state} style={{'--state-color':colors[state]} as React.CSSProperties} onClick={()=>setFilter(filter===state?null:state)}>{state}<span className="fleet-share">{percentage.toFixed(0)}% · {count}</span></button>)}</div>
  <label className="fleet-motion"><input type="checkbox" checked={motion} onChange={event=>setMotion(event.target.checked)}/> Motion</label>
 <button aria-pressed={yard} onClick={()=>setYard(value=>!value)}>{yard?'Heat grid':'Shipyard'}</button>
 {yard?<Shipyard lanes={fleet.stationLanes} meshes={meshes} filter={filter} motion={motion} selected={selected} onSelect={lane=>{setSelected(lane.id);onSelect(lane);}}/>:<div className="fleet-grid" role="list" aria-label={`${rows.length} lanes${filter?` in ${filter}`:''}`}>
   {rows.map(lane=><button key={lane.id} type="button" role="listitem" className="fleet-tile" aria-label={`${lane.name}, ${lane.state}`} aria-pressed={selected===lane.id} title={`${lane.name} · ${lane.state}`} style={{'--state-color':colors[lane.state]} as React.CSSProperties} onClick={()=>{setSelected(lane.id);onSelect(lane);}}><span className="fleet-tile-name">{lane.name}</span>{lane.state==='working'&&<span className="fleet-drone" aria-hidden="true"/>}</button>)}
  </div>}
 </section>;
}
