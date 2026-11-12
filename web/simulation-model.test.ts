import {expect,test} from 'bun:test';
import {createSimulation,fractureAt,fractureDuration,simulationStates,stepSimulation} from './simulation-model';

test('simulation visits each station state in order and enters a finite failure',()=>{
 let simulation=createSimulation();
 expect(simulation.state).toBe('needs you');
 for(const state of simulationStates.slice(1)){simulation=stepSimulation(simulation);expect(simulation.state).toBe(state);}
 simulation=stepSimulation(simulation);
 expect(simulation.failed).toBe(true);
 expect(simulation.fractureElapsed).toBe(0);
 for(let i=0;i<fractureDuration/500;i++)simulation=stepSimulation(simulation);
 expect(simulation.fractureElapsed).toBe(fractureDuration);
 expect(stepSimulation(simulation)).toEqual(simulation);
});

test('breakup begins intact, separates nine rigid pieces, and settles',()=>{
 const start=fractureAt(0),middle=fractureAt(fractureDuration/2),end=fractureAt(fractureDuration);
 expect(start).toMatchObject({stress:0,separation:0,particles:0});
 expect(start.pieces).toHaveLength(9);
 expect(start.pieces.every(piece=>piece.x===0&&piece.y===0&&piece.z===0&&piece.rotation===0)).toBe(true);
 expect(middle.stress).toBe(1);
 expect(middle.separation).toBeGreaterThan(0);
 expect(middle.particles).toBeGreaterThan(0);
 expect(end).toMatchObject({stress:1,separation:1,particles:0});
 expect(end.pieces[0]).not.toEqual(start.pieces[0]);
});
