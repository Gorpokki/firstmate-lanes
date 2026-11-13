import {test,expect} from 'bun:test';
import {boardSummary,deriveBoard,findFoot,findLanes,fleetOrder,freshness,isOld,stateChanges} from './stations';

const lane=(id:string,state:string,secondMate:string,asked:string)=>({id,name:id,state,secondMate,home:'main',now:'Example',history:[],asks:asked?[{key:id,form:'discussion',question:'Example?',reason:'Choose',effort:'quick',asked,answerable:true}]:[]});
const fleet={updatedAt:'2026-01-10T12:00:00Z',stationLanes:[lane('old','needs you','build','2026-01-09T12:00:00Z'),lane('new','needs you','design','2026-01-10T11:00:00Z'),lane('work','working','design',''),lane('parked','holding','','')],hiddenAsks:2,autonomyShare:0.5,changedLanes:['work']};
const words=(row:{t:[string,string][]}[])=>row.map(part=>part.t.map(([w])=>w).join(''));

test('List filters by second mate',()=>{
 const board=deriveBoard(fleet);
 expect(board.mates).toEqual(['build','design']);
 expect(deriveBoard(fleet,'design').rows.map(l=>l.id).toSorted()).toEqual(['new','work']);
});

test('the summary brightens only the need-you numbers and names what changed',()=>{
 const [state,since]=boardSummary(fleet);
 expect(words(state)).toEqual(['2 asks in 2 lanes need you','nothing else needs you','1 working','1 holding']);
 expect(state[0].t.filter(([,tone])=>tone==='need').map(([w])=>w)).toEqual(['2','2']);
 expect(words(since)).toEqual(['1 lane changed since your last look','50% ran without you','2 asks older than 7 days hidden']);
 expect(words(boardSummary({...fleet,stationLanes:[lane('work','working','','')],changedLanes:[],hiddenAsks:0})[0])).toEqual(['nothing needs you','1 working']);
});

test('the strip and Find keep one lane order',()=>{
 expect(fleetOrder(fleet).map(l=>l.id)).toEqual(['old','new','work','parked']);
 expect(findLanes(fleet,'PAR').rows.map(l=>l.id)).toEqual(['parked']);
 expect(findLanes(fleet,'  ').n).toBe(0);
 expect(findFoot('zz',0,0)).toBe('No lane has this name.');
});

test('only a lane whose state changed since the reading before lights',()=>{
 expect(stateChanges(null,fleet)).toEqual([]);
 expect(stateChanges({old:'needs you',new:'waiting',work:'working'},fleet)).toEqual(['new']);
});

test('freshness names old data as a save',()=>{
 const at=Date.parse(fleet.updatedAt);
 expect(freshness(fleet.updatedAt,at+30000)).toBe('Live');
 expect(freshness(fleet.updatedAt,at+5*60000)).toBe('Updated 5 min ago');
 expect(freshness(fleet.updatedAt,at+3*3600000)).toBe('Saved 3 hours ago');
 expect(isOld(fleet.updatedAt,at+9*60000)).toBe(false);
 expect(isOld(fleet.updatedAt,at+10*60000)).toBe(true);
});
