import {test,expect} from 'bun:test';
import type {Fleet} from './stations';
import type {TriangleMesh} from './holo-renderer';
import {deriveShipyardRows,layoutShipyard} from './shipyard-model';

const fleet=JSON.parse(`{"updatedAt":"2026-01-10T12:00:00Z","hiddenAsks":0,"autonomyShare":0.5,"changedLanes":[],"stationLanes":[{"id":"z-work","name":"Z work","state":"working","secondMate":"","home":"main","now":"Building","history":[],"asks":[]},{"id":"a-done","name":"A done","state":"done","secondMate":"","home":"main","now":"Finished","history":[],"asks":[]},{"id":"b-wait","name":"B wait","state":"waiting","secondMate":"","home":"main","now":"Waiting","history":[],"asks":[]},{"id":"a-work","name":"A work","state":"working","secondMate":"","home":"main","now":"Building","history":[],"asks":[]},{"id":"c-need","name":"C need","state":"needs you","secondMate":"","home":"main","now":"Choose","history":[],"asks":[]},{"id":"d-hold","name":"D hold","state":"holding","secondMate":"","home":"main","now":"Held","history":[],"asks":[]}]}`) as Fleet;
const mesh=(id:string):TriangleMesh=>({lod:[new Int16Array([id.length]),new Int16Array([id.length])]});
const pool=['ship-a','ship-b'].map(id=>({id,name:id,mesh:mesh(id)}));

test('Shipyard rows sort lanes and pick a stable mesh by lane id',()=>{
 const rows=deriveShipyardRows(fleet.stationLanes,pool);
 expect(rows.map(row=>row.lane.id)).toEqual(['c-need','b-wait','a-work','z-work','a-done','d-hold']);
 const filtered=deriveShipyardRows([...fleet.stationLanes].reverse(),pool,'working');
 expect(filtered.map(row=>row.meshName)).toEqual(rows.filter(row=>row.lane.state==='working').map(row=>row.meshName));
});

test('Shipyard state filter and layout hide offscreen labels but preserve selected lane',()=>{
 const rows=deriveShipyardRows(fleet.stationLanes,pool,'working');
 expect(rows.map(row=>row.lane.id)).toEqual(['a-work','z-work']);
 const layout=layoutShipyard(rows,170,280,'z-work');
 expect(layout.map(item=>item.showLabel)).toEqual([true,true]);
 expect(layout.map(item=>item.offscreen)).toEqual([false,true]);
});
