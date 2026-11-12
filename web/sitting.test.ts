import {expect,test} from 'bun:test';
import {answerFor,buildSitting,deferForLater,readOnlyReason,reviewAnswers,undoAnswer,type SittingAnswer} from './sitting';
import type {Fleet,Lane} from './stations';

const lane=(id:string,secondMate:string,asks:Lane['asks']):Lane=>({id,name:`Lane ${id}`,home:'main',secondMate,state:'needs you',now:'',history:[],asks});
const ask=(key:string,effort='quick',form='choice',asked='2026-01-01T00:00:00Z'):Lane['asks'][number]=>({key,form,question:`Question ${key}?`,topic:`Topic ${key}`,reason:'Reason',choices:[{label:'Yes',effect:'Do it'},{label:'No',effect:'Stop'}],pick:0,pick_reason:'Crew reason',no_pick_reason:'Dashboard reason',effort,asked,answerable:true});
const fleet=(...stationLanes:Lane[]):Fleet=>({updatedAt:'2026-01-02T00:00:00Z',stationLanes,hiddenAsks:0,autonomyShare:0,changedLanes:[]});

test('sitting starts with each lane next ask, quick first, groups by mate, and restricts selected lanes',()=>{
 const data=fleet(lane('a','Zed',[ask('a1','read'),ask('a2')]),lane('b','Alpha',[ask('b1')]),lane('c','Alpha',[ask('c1','read')]));
 expect(buildSitting(data).map(item=>item.ask.key)).toEqual(['b1','a2','c1','a1']);
 expect(buildSitting(data,['a']).map(item=>item.ask.key)).toEqual(['a2','a1']);
});

test('read-only asks never take sitting slots and drop-in lanes get their own reason',()=>{
 const data=fleet(lane('a','Mate',[{...ask('a1'),answerable:false},ask('a2')]));
 expect(buildSitting(data).map(item=>item.ask.key)).toEqual(['a2']);
 const local={...lane('local/x','',[]),home:'local'};
 expect(readOnlyReason(local,{...ask('x'),answerable:false})).toContain('drop-in');
 expect(readOnlyReason(lane('a','Mate',[]),{...ask('x'),answerable:false})).not.toContain('drop-in');
 expect(readOnlyReason(lane('a','Mate',[]),ask('x'))).toBe('');
});

test('answers support choice, own, skip, grill, undo, and defer into a later sitting',()=>{
 const data=fleet(lane('a','Mate',[ask('a1'),ask('a2')]));
 const [first,second]=buildSitting(data);
 expect(answerFor(first,'choice',1)).toMatchObject({lane:'a',key:'a1',kind:'choice',choice:1,asked:first.ask.asked});
 expect(answerFor(first,'own',undefined,'Use the fallback')).toMatchObject({kind:'own',text:'Use the fallback'});
 expect(answerFor(first,'skip')).toMatchObject({kind:'skip'});
 expect(answerFor(first,'grill')).toMatchObject({kind:'grill'});
 const answers:SittingAnswer[]=[answerFor(first,'choice',0)];
 const initial={ [first.ref]:answerFor(first,'choice',0) };
 expect(undoAnswer(initial,first.ref)).toEqual({});
 expect(reviewAnswers(data,answers)).toEqual([{lane:'Lane a',key:'a1',question:'Question a1?',answer:'Yes'}]);
 expect(reviewAnswers(data,[])).toEqual([]);
 expect(deferForLater(data,[first.ref]).map(item=>item.ask.key)).toEqual(['a1']);
 expect(buildSitting(data,undefined,new Set([first.ref])).map(item=>item.ask.key)).toEqual(['a2']);
 expect(second.ask.key).toBe('a2');
});
