import {test,expect} from 'bun:test';
import type {Fleet} from './stations';
import {deriveFleet} from './fleet-model';

const fleet=JSON.parse(`{"updatedAt":"2026-01-10T12:00:00Z","hiddenAsks":0,"autonomyShare":0.5,"changedLanes":[],"stationLanes":[{"id":"z-work","name":"Z work","state":"working","secondMate":"","home":"main","now":"Building","history":[],"asks":[]},{"id":"a-done","name":"A done","state":"done","secondMate":"","home":"main","now":"Finished","history":[],"asks":[]},{"id":"b-wait","name":"B wait","state":"waiting","secondMate":"","home":"main","now":"Waiting","history":[],"asks":[]},{"id":"a-work","name":"A work","state":"working","secondMate":"","home":"main","now":"Building","history":[],"asks":[]},{"id":"c-need","name":"C need","state":"needs you","secondMate":"","home":"main","now":"Choose","history":[],"asks":[]},{"id":"d-hold","name":"D hold","state":"holding","secondMate":"","home":"main","now":"Parked","history":[],"asks":[]}]}`) as Fleet;

test('Fleet grid orders lanes, reports state shares, and filters by state',()=>{
 const board=deriveFleet(fleet);
 expect(board.rows.map(lane=>lane.id)).toEqual(['c-need','b-wait','a-work','z-work','a-done','d-hold']);
 expect(board.shares.map(({state,count,percentage})=>({state,count,display:Math.round(percentage)}))).toEqual([
  {state:'needs you',count:1,display:17},
  {state:'waiting',count:1,display:17},
  {state:'working',count:2,display:33},
  {state:'done',count:1,display:17},
  {state:'holding',count:1,display:17},
 ]);
 expect(deriveFleet(fleet,'working').rows.map(lane=>lane.id)).toEqual(['a-work','z-work']);
});
