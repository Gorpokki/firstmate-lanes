import {test,expect} from 'bun:test';
import type {Fleet} from './stations';
import {clickShown,deriveFleet,shownStates,YARD_SHOWN} from './fleet-model';

const lane=(id:string,state:string,sourceState=state)=>({id,name:id,state,sourceState,secondMate:'',home:'main',now:'',asks:[]});
const fleet:Fleet={updatedAt:'2026-01-10T12:00:00Z',hiddenAsks:0,autonomyShare:.5,changedLanes:[],stationLanes:[lane('w','working'),lane('n','needs you'),lane('q','holding','working'),lane('p','holding','parked'),lane('b','holding','blocked'),lane('d','done')]};

test('Fleet groups lanes in play by state and counts the holding row as parked and gone quiet',()=>{
 const board=deriveFleet(fleet);
 expect(board.groups.map(g=>[g.state,g.lanes.map(l=>l.id)])).toEqual([['needs you',['n']],['working',['w']],['done',['d']]]);
 expect(board.hold.map(l=>l.id)).toEqual(['b','p','q']);
 expect([board.parked,board.quiet]).toEqual([2,1]);
 const present=board.shares.map(share=>share.state);
 expect(clickShown(['working'],'working',present)).toEqual(['working']); // the yard filter never hides every state the fleet has
 expect(clickShown(['working'],'done',present)).toEqual(['working','done']);
});

test('the shipyard shows the lanes it has when the stored filter hides them all',()=>{
 const held:Fleet={...fleet,stationLanes:[lane('q','holding','working'),lane('p','holding','parked')]};
 const present=deriveFleet(held).shares.map(share=>share.state);
 expect(present).toEqual(['holding']);
 expect(shownStates(YARD_SHOWN,present)).toEqual(['holding']);
 expect(shownStates(['working'],['needs you','done'])).toEqual(['needs you','done']);
 expect(shownStates(['working'],['working','done'])).toEqual(['working']);
});

test('a refused yard click keeps the holding-hidden default for a fleet that later works',()=>{
 const held:Fleet={...fleet,stationLanes:[lane('q','holding','working'),lane('p','holding','parked')]};
 const present=deriveFleet(held).shares.map(share=>share.state);
 const stored=clickShown(YARD_SHOWN,'holding',present);
 expect(stored).toBe(YARD_SHOWN);
 const worked:Fleet={...fleet,stationLanes:[lane('w','working'),lane('q','holding','working'),lane('p','holding','parked')]};
 const later=shownStates(stored,deriveFleet(worked).shares.map(share=>share.state));
 expect(later).toEqual(YARD_SHOWN);
 expect(later).toContain('working');
});

test('the yard filter keeps a working lane shown in a fleet of working and holding lanes',()=>{
 const worked:Fleet={...fleet,stationLanes:[lane('w','working'),lane('q','holding','working')]};
 const present=deriveFleet(worked).shares.map(share=>share.state);
 expect(present).toEqual(['working','holding']);
 expect(clickShown(YARD_SHOWN,'working',present)).toEqual(YARD_SHOWN);
 expect(clickShown(YARD_SHOWN,'holding',present)).toEqual([...YARD_SHOWN,'holding']);
});
