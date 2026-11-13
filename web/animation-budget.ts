// Idle and hidden performance budgets for the simulation and ship views.
// perf/budget.json holds the numbers; perf/simulation-budget.mjs measures them
// in a real browser against the real server.
import limits from './perf/budget.json';

export const budget=Object.freeze({...limits});

export type SimulationActivity={hidden:boolean;running:boolean;settled:boolean};
export type SpinActivity={hidden:boolean;spinning:boolean};

/** The simulation advances only when visible, running and not yet settled. */
export function simulationTicks({hidden,running,settled}:SimulationActivity):boolean{return !hidden&&running&&!settled;}

/** The ship spins only when visible and not paused. */
export function spinTicks({hidden,spinning}:SpinActivity):boolean{return !hidden&&spinning;}

/** Whether a rAF callback at `time` should commit a spin frame after `last`. */
export function spinFrameDue(time:number,last:number):boolean{return time-last>budget.spinFrameMs;}
