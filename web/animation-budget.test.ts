import {expect,test} from 'bun:test';
import {budget,simulationTicks,spinFrameDue,spinTicks} from './animation-budget';
import {createSimulation,fractureDuration,stepSimulation} from './simulation-model';

test('the simulation never ticks while hidden, paused or settled',()=>{
 expect(simulationTicks({hidden:false,running:true,settled:false})).toBe(true);
 for(const activity of [{hidden:true,running:true,settled:false},{hidden:false,running:false,settled:false},{hidden:false,running:true,settled:true}])
  expect(simulationTicks(activity)).toBe(false);
});

test('a run settles within a bounded number of steps',()=>{
 let simulation=createSimulation(),steps=0;
 while(!(simulation.failed&&simulation.fractureElapsed>=fractureDuration)&&steps<100){simulation=stepSimulation(simulation);steps++;}
 expect(simulation.failed&&simulation.fractureElapsed>=fractureDuration).toBe(true);
 expect(steps).toBeLessThanOrEqual(12);
});

test('the ship spins only while visible and is capped by the frame budget',()=>{
 expect(spinTicks({hidden:false,spinning:true})).toBe(true);
 expect(spinTicks({hidden:true,spinning:true})).toBe(false);
 expect(spinTicks({hidden:false,spinning:false})).toBe(false);
 let last=0,frames=0;
 for(let time=0;time<=1000;time+=1000/120)if(spinFrameDue(time,last)){frames++;last=time;}
 expect(frames).toBeLessThanOrEqual(budget.maxActiveFramesPerSecond);
 expect(frames).toBeGreaterThan(10);
});

test('hidden and idle budgets allow no work',()=>{
 expect(budget).toMatchObject({hiddenFrames:0,hiddenRequests:0,idleFrames:0,idleRequests:0,simulationFleetRequests:0});
});
