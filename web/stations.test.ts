import {test,expect} from 'bun:test';
import {deriveBoard} from './stations';

test('List filters by second mate and summarizes the fleet',()=>{
 const lane=(id:string,state:string,secondMate:string,asked:string)=>({id,name:id,state,secondMate,home:'main',now:'Example',history:[],asks:asked?[{key:id,form:'discussion',question:'Example?',reason:'Choose',effort:'quick',asked,answerable:true}]:[]});
 const fleet={updatedAt:'2026-01-10T12:00:00Z',stationLanes:[lane('old','needs you','build','2026-01-09T12:00:00Z'),lane('new','needs you','design','2026-01-10T11:00:00Z'),lane('work','working','design','')],hiddenAsks:2,autonomyShare:0.5,changedLanes:['work']};
 const board=deriveBoard(fleet);
 expect(board.summary).toBe('2 lanes need you · 2 asks · 50% autonomy · 1 changed');
 expect(board.mates).toEqual(['build','design']);
 expect(deriveBoard(fleet,'design').rows.map(l=>l.id).toSorted()).toEqual(['new','work']);
});
