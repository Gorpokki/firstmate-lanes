import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {deriveBoard,freshness,states,type Fleet,type Station} from './stations';
import {FleetStation} from './FleetStation';
import {LaneStation} from './LaneStation';
import {AskStation} from './AskStation';
import {Simulation} from './Simulation';
import {assignedShip,loadCatalog,type ShipMesh} from './mesh-catalog';

const colors:Record<string,string>={'needs you':'#ff967b',waiting:'#e9bd72',working:'#82c8ed',done:'#98d3a4',holding:'#b6a4c7'};
function App(){
 const [fleet,setFleet]=useState<Fleet|null>(null),[error,setError]=useState('');
 const [station,setStation]=useState<Station>('list'),[mate,setMate]=useState(''),[selected,setSelected]=useState('');
 const [checked,setChecked]=useState<Set<string>>(new Set());
 const [meshes,setMeshes]=useState<ShipMesh[]>([]),[modelWarnings,setModelWarnings]=useState<string[]>([]);
 const simulation=location.pathname==='/simulation';
 useEffect(()=>{
  const controller=new AbortController();
  loadCatalog(controller.signal).then(catalog=>{setMeshes(catalog.models);setModelWarnings(catalog.warnings);}).catch(e=>{if(!controller.signal.aborted)setModelWarnings([String(e)]);});
  return()=>controller.abort();
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{try{
   const response=await fetch('/fleet.json',{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('Fleet unavailable');
   const data=await response.json();setFleet(data);setError('');
  }catch(e){if(!controller.signal.aborted)setError(String(e));}};
  load();const timer=setInterval(load,3000);
  return()=>{controller.abort();clearInterval(timer);};
 },[]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(simulation||e.metaKey||e.ctrlKey||e.altKey||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]'))return;
   if((e.key==='Enter'||e.code==='Space')&&(e.target as HTMLElement).closest('button,a,summary'))return;
   const keys:Record<string,Station>={a:'ask',l:'list',f:'fleet',Enter:'lane'};
   if(keys[e.key]){e.preventDefault();setStation(keys[e.key]);}
   if(e.code==='Space'&&station==='list'&&selected){
    e.preventDefault();setChecked(old=>{const next=new Set(old);next.has(selected)?next.delete(selected):next.add(selected);return next;});
   }
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[station,selected,simulation]);
 if(simulation)return <main><Simulation meshes={meshes}/>{modelWarnings.map(w=><p role="status" key={w}>{w}</p>)}</main>;
 if(!fleet)return <main role="status">{error||'Reading fleet…'}</main>;
 const board=deriveBoard(fleet,mate),lane=fleet.stationLanes.find(l=>l.id===selected)||board.rows[0];
 const ship=lane?assignedShip(lane.id,meshes):undefined;
 return <main>
  <style>{`*{box-sizing:border-box}body{background:#101318;color:#edf0f4;font:16px system-ui;margin:0}main{max-width:1400px;margin:auto;padding:20px}button,select,input,textarea{font:inherit}button,select{background:#252d39;color:inherit;border:1px solid #596171;border-radius:8px;padding:10px;cursor:pointer}button:focus-visible,select:focus-visible{outline:3px solid #82c8ed}button[aria-current=true]{border-color:#82c8ed;background:#34465c}header{border-bottom:1px solid #596171;padding-bottom:16px}nav,.strip,.actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.strip span{padding:6px;border-bottom:3px solid}h1{font-size:26px}.muted{color:#b5bfcd}.list{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #38404d}th{white-space:nowrap}td button{padding:5px;border:0;background:none;text-align:left}input[type=checkbox]{width:22px;height:22px}article{margin:20px 0;padding:18px;border:1px solid #596171;border-radius:12px}.state{text-transform:capitalize;white-space:nowrap}p{line-height:1.5}a{color:#82c8ed}@media(max-width:600px){main{padding:12px}th,td{padding:10px 5px;font-size:14px}.last-word{min-width:160px}nav button{flex:1}}`}</style>
  {station!=='ask'&&<header>
   <h1>Fleet board</h1><p>{board.summary}</p>
   <p className="muted">{freshness(fleet.updatedAt)} · {fleet.hiddenAsks} old asks hidden</p>
   <nav aria-label="Stations">{(['ask','list','fleet','lane'] as Station[]).map(s=><button key={s} aria-current={station===s} onClick={()=>setStation(s)}>{s[0].toUpperCase()+s.slice(1)}</button>)}</nav>
   <div className="strip">{states.map(state=><span key={state} style={{borderColor:colors[state]}}>{state}: {fleet.stationLanes.filter(l=>l.state===state).length}</span>)}</div>
   <button onClick={async()=>{try{const response=await fetch('/last-look',{method:'POST',headers:{'X-Fleet-Action':'save'}});if(!response.ok)throw Error('Could not save last look');}catch(e){setError(String(e));}}}>Save last look</button>
  </header>}
  {error&&<p role="alert">{error}</p>}
  {station==='list'&&<section>
   <h2>List</h2>
   <div className="actions">
    <label>Second mate <select value={mate} onChange={e=>setMate(e.target.value)}><option value="">All</option>{board.mates.map(m=><option key={m}>{m}</option>)}</select></label>
    <button disabled={!checked.size} onClick={()=>setStation('ask')}>Ask selected lanes ({checked.size})</button>
   </div>
   <div className="list"><table>
    <thead><tr><th>Select</th><th>Lane</th><th>State</th><th>Second mate</th><th>Quick asks</th><th>To read</th><th>Crew's last word</th></tr></thead>
    <tbody>{board.rows.map((row,index)=><React.Fragment key={row.id}>{(index===0||board.rows[index-1].state!==row.state)&&<tr><th colSpan={7} scope="rowgroup" className="state">{row.state}</th></tr>}<tr onFocus={()=>setSelected(row.id)}>
     <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={checked.has(row.id)} onChange={()=>setChecked(old=>{const next=new Set(old);next.has(row.id)?next.delete(row.id):next.add(row.id);return next;})}/></td>
     <td><button onClick={()=>{setSelected(row.id);setStation('lane');}}>{row.name}</button></td>
     <td className="state" style={{color:colors[row.state]}}>{row.state}</td><td>{row.secondMate||'Main'}</td>
     {['quick','read'].map(effort=><td key={effort}>{row.asks.filter(a=>a.effort===effort).map(a=><p key={a.key}>{a.question||a.topic}</p>)}</td>)}
     <td className="last-word">{row.now}{!!row.invalidAsks&&<p role="status">{row.invalidAsks} malformed asks omitted</p>}</td>
    </tr></React.Fragment>)}</tbody>
   </table></div>
  </section>}
  {station==='lane'&&(lane?<LaneStation lane={lane} mesh={ship?.mesh} shipName={ship?.name}/>:<p>No lanes.</p>)}
  {station==='fleet'&&<FleetStation fleet={fleet} meshes={meshes} onSelect={row=>setSelected(row.id)}/>}
  <AskStation active={station==='ask'} fleet={fleet} meshes={meshes} selectedLaneIds={checked.size?[...checked]:undefined} onBack={()=>setStation('list')} onConfirm={async answers=>{
   const response=await fetch('/answers',{method:'POST',headers:{'Content-Type':'application/json','X-Fleet-Action':'confirm'},body:JSON.stringify({confirmed:true,answers})});
   if(!response.ok)throw Error(await response.text());
   const results=await response.json();
   try{const refreshed=await fetch('/fleet.json',{cache:'no-store'});if(!refreshed.ok)throw Error('Fleet refresh failed');setFleet(await refreshed.json());}
   catch{setError('Answer results received; fleet refresh failed');}
   return results;
  }}/>
  {modelWarnings.length>0&&<details><summary>Model admission warnings</summary>{modelWarnings.map(w=><p key={w}>{w}</p>)}</details>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
