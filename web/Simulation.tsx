import React,{useEffect,useState} from 'react';
import {Holo} from './Holo';
import {budget,simulationTicks} from './animation-budget';
import {usePageHidden} from './page-visibility';
import type {BlastPhase} from './scenes';
import {stateColors} from './stations';
import type {TriangleMesh} from './holo-renderer';

type SimulationMesh={id:string;name:string;mesh:TriangleMesh};
type SimulationProps={meshes:SimulationMesh[]};
type Step={label:string;state:string;sourceState?:string;progress?:number;note:string};
// One ship run through each state a lane can have, so the holo view can be reviewed state by state. It ends in the
// failure: stress, the rupture, and debris that drifts out of the field; then the page rests.
const STEPS:Step[]=[
 {label:'Queued',state:'working',progress:.12,note:'scaffold: the wire frame, nothing built'},
 {label:'Working',state:'working',note:'the hull grows from the stern'},
 {label:'Waiting, not on you',state:'waiting',note:'the hull is nearly complete'},
 {label:'Needs you',state:'needs you',note:'the same hull in the needs-you colour'},
 {label:'Blocked',state:'needs you',sourceState:'blocked',note:'the build stops at half, a steady grey ship'},
 {label:'Holding',state:'holding',note:'a part hull in grey'},
 {label:'Done',state:'done',note:'the hull is complete: launched'},
 {label:'Failed',state:'needs you',note:'the ship fails: stress, a rupture, then debris that drifts out of the field'},
];
const LAST=STEPS.length-1;
const PHASE_LINE:Record<BlastPhase,string>={stress:'Failure · stress: the hull erupts',rupture:'Failure · rupture: the blast',debris:'Failure · debris drifting',settled:'Failure · the debris has left the field'};
function useSelectedMesh(meshes:SimulationMesh[]){
 const [meshId,setMeshId]=useState(meshes[0]?.id??'');
 const selected=meshes.find(mesh=>mesh.id===meshId)??meshes[0];
 useEffect(()=>{if(!meshes.some(mesh=>mesh.id===meshId))setMeshId(meshes[0]?.id??'');},[meshes,meshId]);
 return [selected,setMeshId] as const;
}
// the states advance one step each simulationStepMs while shown and running; the failure is the last step
function useSimulationClock(running:boolean,done:boolean,setStep:React.Dispatch<React.SetStateAction<number>>){
 const hidden=usePageHidden();
 useEffect(()=>{if(!simulationTicks({hidden,running,settled:done}))return;const timer=window.setInterval(()=>setStep(n=>Math.min(LAST,n+1)),budget.simulationStepMs);return()=>window.clearInterval(timer);},[hidden,running,done]);
}
function ShipPicker({meshes,selected,setMeshId}:{meshes:SimulationMesh[];selected?:SimulationMesh;setMeshId:(id:string)=>void}){
 const index=Math.max(0,meshes.findIndex(mesh=>mesh.id===selected?.id)),pick=(by:number)=>meshes.length&&setMeshId(meshes[(index+by+meshes.length)%meshes.length]!.id);
 return <div className="simrow">
  <label className="lab">Ship <select aria-label="Ship" value={selected?.id??''} onChange={event=>setMeshId(event.target.value)}>{meshes.map(mesh=><option key={mesh.id} value={mesh.id}>{mesh.name}</option>)}</select></label>
  <span className="lab">{meshes.length?`${index+1} of ${meshes.length}`:'No admitted ship'}</span>
  <button type="button" className="btn" onClick={()=>pick(-1)}>‹ previous</button><button type="button" className="btn" onClick={()=>pick(1)}>next ›</button>
 </div>;
}
export function Simulation({meshes}:SimulationProps){
 const [step,setStep]=useState(0),[running,setRunning]=useState(true),[blast,setBlast]=useState<number|null>(null),[phase,setPhase]=useState<BlastPhase|null>(null);
 const [selected,setMeshId]=useSelectedMesh(meshes);
 const failing=step===LAST,current=STEPS[step]!;
 useSimulationClock(running,failing,setStep);
 useEffect(()=>{setPhase(null);setBlast(failing?performance.now():null);},[failing,selected?.id]); // the failure blows the ship up; every other state builds it again
 const blowUp=()=>{setStep(LAST);setRunning(true);setPhase(null);setBlast(performance.now());};
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='x'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!(event.target as HTMLElement).closest('input,select,textarea'))blowUp();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const choose=(index:number)=>{setStep(index);setRunning(false);if(index===LAST){setPhase(null);setBlast(performance.now());}};
 return <section aria-label="Lane simulation" className="lane sim">
  <div className="holo">
   <Holo mesh={selected?.mesh} name={selected?.name??'No ships loaded'} state={current.state} sourceState={current.sourceState} progress={current.progress} idle={phase==='settled'} blast={blast} paused={!running} onPhase={setPhase}/>
  </div>
  <div className="side">
   <div><a className="link" href="/">‹ back to the board</a></div>
   <h2>Lane simulation</h2>
   <p className="now">Synthetic lane · {current.label}</p>
   <ShipPicker meshes={meshes} selected={selected} setMeshId={setMeshId}/>
   <div className="simrow"><span className="lab">State</span>
    <button type="button" className="btn" onClick={()=>setRunning(value=>!value)}>{running?'Pause':'Resume'}</button>
    <button type="button" className="btn" onClick={()=>{setStep(0);setRunning(true);}}>Restart</button>
    <button type="button" className="btn" onClick={()=>setStep(n=>Math.min(LAST,n+1))}>Step</button>
    <button type="button" className="btn" onClick={blowUp}>Blow it up<kbd>x</kbd></button>
   </div>
   <div className="simsteps" role="group" aria-label="State">{STEPS.map((s,i)=><button key={s.label} type="button" className={i===step?'on':''} aria-pressed={i===step} title={s.note} onClick={()=>choose(i)}><i style={{background:stateColors[s.sourceState?'holding':s.state]}}/><b>{s.label}</b></button>)}</div>
   <p className="now" aria-live="polite">{failing&&phase?PHASE_LINE[phase]:`${current.label}: ${current.note}.`}</p>
  </div>
 </section>;
}
