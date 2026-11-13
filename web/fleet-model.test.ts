import {test,expect} from 'bun:test';
import type {Fleet} from './stations';
import {deriveFleet,toggleShown} from './fleet-model';

const lane=(id:string,state:string,sourceState=state)=>({id,name:id,state,sourceState,secondMate:'',home:'main',now:'',history:[],asks:[]});
const fleet:Fleet={updatedAt:'2026-01-10T12:00:00Z',hiddenAsks:0,autonomyShare:.5,changedLanes:[],stationLanes:[lane('w','working'),lane('n','needs you'),lane('q','holding','working'),lane('p','holding','parked'),lane('b','holding','blocked'),lane('d','done')]};

test('Fleet groups lanes in play by state and counts the holding row as parked and gone quiet',()=>{
 const board=deriveFleet(fleet);
 expect(board.groups.map(g=>[g.state,g.lanes.map(l=>l.id)])).toEqual([['needs you',['n']],['working',['w']],['done',['d']]]);
 expect(board.hold.map(l=>l.id)).toEqual(['b','p','q']);
 expect([board.parked,board.quiet]).toEqual([2,1]);
 expect(toggleShown(['working'],'working')).toEqual(['working']); // the yard filter never hides every state
 expect(toggleShown(['working'],'done')).toEqual(['working','done']);
});
