import {expect,test} from 'bun:test';
import {acceptedKeys,answerFor,answeredLanes,batchReady,buildSitting,deferForLater,readOnlyReason,reviewAnswers,undoAnswer,type SittingAnswer} from './sitting';
import type {Fleet,Lane} from './stations';

const lane=(id:string,secondMate:string,asks:Lane['asks']):Lane=>({id,name:`Lane ${id}`,home:'main',secondMate,state:'needs you',now:'',history:[],asks});
const ask=(key:string,effort='quick',form='choice',asked='2026-01-01T00:00:00Z'):Lane['asks'][number]=>({key,form,question:`Question ${key}?`,topic:`Topic ${key}`,reason:'Reason',choices:[{label:'Yes',effect:'Do it'},{label:'No',effect:'Stop'}],pick:0,pick_reason:'Crew reason',no_pick_reason:'Dashboard reason',effort,asked,answerable:true});
const fleet=(...stationLanes:Lane[]):Fleet=>({updatedAt:'2026-01-02T00:00:00Z',stationLanes,hiddenAsks:0,autonomyShare:0,changedLanes:[]});

test('only accepted delivery results count as sent, so a refused answer stays pending for correction and resend',()=>{
 expect([...acceptedKeys([{lane:'a',key:'A',accepted:true,reason:'applied'},{lane:'a',key:'B',accepted:false,reason:'stale'}])]).toEqual(['A']);
 expect(acceptedKeys(null).size).toBe(0);
});

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
 expect(readOnlyReason({...lane('local/build','build',[]),home:'local'},{...ask('x'),answerable:false})).not.toContain('drop-in');
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

test('a sitting is sendable only when every ask still in it is answered, skipped or deferred',()=>{
 const items=buildSitting(fleet(lane('a','Mate',[ask('a1'),ask('a2')])));
 const [first,second]=items;
 const one={[first.ref]:answerFor(first,'choice',0)};
 expect(batchReady(items,one)).toBe(false);
 const both={...one,[second.ref]:answerFor(second,'skip')};
 expect(batchReady(items,both)).toBe(true);
 expect(batchReady(items,{...both,[second.ref]:answerFor(second,'own',undefined,'Use the fallback')})).toBe(true);
 expect(batchReady(items,undoAnswer(both,second.ref))).toBe(false);
 expect(batchReady(items.filter(item=>item.ref!==second.ref),one)).toBe(true);
 expect(batchReady([],{})).toBe(false);
});

test('a lane is hollow only when each of its asks has an answer',()=>{
 const data=fleet(lane('a','Mate',[ask('a1'),ask('a2')]),lane('b','Mate',[ask('b1')]),lane('c','Mate',[]));
 const [a1,b1,a2]=buildSitting(data);
 expect(answeredLanes(data,{[a1.ref]:answerFor(a1,'choice',0),[b1.ref]:answerFor(b1,'skip')})).toEqual(['b']);
 expect(answeredLanes(data,{[a1.ref]:answerFor(a1,'choice',0),[a2.ref]:answerFor(a2,'own',undefined,'Mine')})).toEqual(['a']);
});
