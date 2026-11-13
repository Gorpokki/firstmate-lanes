export const simulationStates=['needs you','waiting','working','holding','done'] as const;
export type SimulationState=typeof simulationStates[number];
export type Simulation={state:SimulationState;sourceState?:'blocked';failed:boolean;fractureElapsed:number};
export const fractureDuration=3000;

export function createSimulation():Simulation{return {state:simulationStates[0],failed:false,fractureElapsed:0};}

export function stepSimulation(simulation:Simulation):Simulation {
 if(simulation.failed)return {...simulation,fractureElapsed:Math.min(fractureDuration,simulation.fractureElapsed+500)};
 if(simulation.sourceState==='blocked')return {...simulation,state:'waiting',sourceState:undefined};
 const index=simulationStates.indexOf(simulation.state);
 if(index<simulationStates.length-1)return {...simulation,state:simulationStates[index+1]!};
 return {...simulation,failed:true,fractureElapsed:0};
}

export function fractureAt(elapsed:number) {
 const t=Math.max(0,Math.min(1,elapsed/fractureDuration));
 const stress=Math.min(1,t*2);
 const separation=t<.35?0:Math.min(1,(t-.35)/.65);
 const particles=t<.35?0:Math.max(0,1-Math.abs(t-.58)/.42);
 const pieces=Array.from({length:9},(_,index)=>{
  const x=index%3-1,y=Math.floor(index/3)-1;
  return {x:x*separation*.65,y:y*separation*.65,z:(1-Math.hypot(x,y)/Math.SQRT2)*separation*.3,rotation:(x-y)*separation*.18};
 });
 return {stress,separation,particles,pieces};
}
