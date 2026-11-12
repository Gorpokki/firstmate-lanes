import React,{useEffect,useState} from 'react';
import {Holo} from './Holo';
import {budget,simulationTicks} from './animation-budget';
import {usePageHidden} from './page-visibility';
import type {TriangleMesh} from './holo-renderer';
import {createSimulation,fractureAt,fractureDuration,simulationStates,stepSimulation,type SimulationState} from './simulation-model';

type SimulationMesh={id:string;name:string;mesh:TriangleMesh};
type SimulationProps={meshes:SimulationMesh[]};

export function Simulation({meshes}:SimulationProps){
 const [simulation,setSimulation]=useState(createSimulation),[running,setRunning]=useState(true),[meshId,setMeshId]=useState(meshes[0]?.id??''),[mode,setMode]=useState<'ascii'|'quadrant'>('ascii');
 const selected=meshes.find(mesh=>mesh.id===meshId)??meshes[0];
 useEffect(()=>{if(!meshes.some(mesh=>mesh.id===meshId))setMeshId(meshes[0]?.id??'');},[meshes,meshId]);
 const hidden=usePageHidden(),settled=simulation.failed&&simulation.fractureElapsed>=fractureDuration;
 useEffect(()=>{if(!simulationTicks({hidden,running,settled}))return;const timer=window.setInterval(()=>setSimulation(current=>stepSimulation(current)),budget.simulationStepMs);return()=>window.clearInterval(timer);},[hidden,running,settled]);
 const fracture=simulation.failed?fractureAt(simulation.fractureElapsed):null;
 const selectState=(state:SimulationState|'blocked'|'failed')=>{setSimulation(state==='failed'?{state:'done',failed:true,fractureElapsed:0}:state==='blocked'?{state:'needs you',sourceState:'blocked',failed:false,fractureElapsed:0}:{state,failed:false,fractureElapsed:0});};
 return <section aria-label="Lane simulation" style={{color:'#e8edf5',maxWidth:900,margin:'0 auto',padding:20}}>
  <h1>Lane simulation</h1>
 <p>Synthetic lane · {simulation.failed?'failed breakup':simulation.sourceState??simulation.state}</p>
  <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',marginBottom:16}}>
   <label>Ship <select aria-label="Ship" value={selected?.id??''} onChange={event=>setMeshId(event.target.value)}>{meshes.map(mesh=><option key={mesh.id} value={mesh.id}>{mesh.name}</option>)}</select></label>
   <button type="button" onClick={()=>setRunning(value=>!value)}>{running?'Pause':'Resume'}</button>
   <button type="button" onClick={()=>setSimulation(createSimulation())}>Restart</button>
   <button type="button" onClick={()=>setSimulation(stepSimulation)}>Step</button>
   <label>State <select aria-label="State" value={simulation.failed?'failed':simulation.sourceState??simulation.state} onChange={event=>selectState(event.target.value as SimulationState|'blocked'|'failed')}>
    {simulationStates.map(state=><option key={state}>{state}</option>)}<option value="blocked">blocked (needs you)</option><option value="failed">failed</option>
   </select></label>
   <label>Output <select aria-label="Output mode" value={mode} onChange={event=>setMode(event.target.value as 'ascii'|'quadrant')}><option value="ascii">ASCII</option><option value="quadrant">Quadrant</option></select></label>
  </div>
  <div style={{border:'1px solid #596171',borderRadius:12,padding:16,background:'radial-gradient(ellipse at center,#1d2a39,#10151d 75%)',minHeight:300,display:'grid',placeItems:'center'}}>
   <Holo mesh={selected?.mesh} name={selected?.name??'No ships loaded'} idle={settled} state={simulation.failed?'done':simulation.state} progress={simulation.failed?1:undefined} options={{mode:mode==='ascii'?'lit':'blocks',blocks:simulation.sourceState==='blocked',fractureElapsed:simulation.failed?simulation.fractureElapsed:undefined}} />
  </div>
  {simulation.failed&&<div aria-live="polite" style={{marginTop:12}}>Failure breakup · stress {Math.round(fracture!.stress*100)}% · separation {Math.round(fracture!.separation*100)}% · particles {Math.round(fracture!.particles*100)}%</div>}
 </section>;
}
