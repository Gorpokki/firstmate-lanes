import {test,expect} from 'bun:test';
import {ageDays,boardSummary,findFoot,findLanes,fleetOrder,freshness,hiddenTicked,isOld,keepNeedingTicks,keepsKey,laneWords,listQuestion,listRows,overdue,returnedOnly,stateChanges,type Lane} from './stations';
import {buildSitting} from './sitting';

const lane=(id:string,state:string,secondMate:string,asked:string)=>({id,name:id,state,secondMate,home:'main',now:'Example',asks:asked?[{key:id,form:'discussion',question:'Example?',reason:'Choose',effort:'quick',asked,answerable:true}]:[]});
const fleet={updatedAt:'2026-01-10T12:00:00Z',stationLanes:[lane('old','needs you','build','2026-01-09T12:00:00Z'),lane('new','needs you','design','2026-01-10T11:00:00Z'),lane('work','working','design',''),lane('parked','holding','','')],hiddenAsks:2,autonomyShare:0.5,changedLanes:['work']};
const words=(row:{t:[string,string][]}[])=>row.map(part=>part.t.map(([w])=>w).join(''));

test('the mate filter scopes the List only: a hidden ticked lane stays ticked, is counted and enters the sitting',()=>{
 const all=listRows(fleet,'',Date.parse(fleet.updatedAt));
 expect(all.quick.map(r=>r.lane.id)).toEqual(['old','new']);
 expect(all.mates).toEqual([['build',1],['design',1]]);
 const ticked=new Set(['old','new']),design=listRows(fleet,'design');
 expect(design.quick.map(r=>r.lane.id)).toEqual(['new']);
 expect(hiddenTicked(fleet,ticked,'design')).toBe(1);
 expect(hiddenTicked(fleet,ticked,'')).toBe(0);
 expect(buildSitting(fleet,[...ticked]).map(item=>item.lane.id).toSorted()).toEqual(['new','old']);
});

test('a tick survives only while its lane needs you',()=>{
 expect([...keepNeedingTicks(fleet,new Set(['old','new','work','parked','unknown']))].toSorted()).toEqual(['new','old']);
 const answered={...fleet,stationLanes:fleet.stationLanes.map(l=>l.id==='old'?{...l,state:'working'}:l)};
 expect([...keepNeedingTicks(answered,new Set(['old','new']))]).toEqual(['new']);
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
 const sentenced={...fleet,stationLanes:[{...lane('fallback','working','',''),title:'Compare three cache layers in the report'}]};
 expect(findLanes(sentenced,'cache layers').rows.map(l=>l.id)).toEqual(['fallback']);
 expect(findLanes(sentenced,'fallback').rows.map(l=>l.id)).toEqual(['fallback']);
 expect(findLanes(fleet,'  ').n).toBe(0);
 expect(findFoot('zz',0,0)).toBe('No lane has this name.');
});

test('only a lane whose state changed since the reading before lights',()=>{
 expect(stateChanges(null,fleet)).toEqual([]);
 expect(stateChanges({old:'needs you',new:'waiting',work:'working'},fleet)).toEqual(['new']);
});

test('a lane without a status time says its time is unknown',()=>{
 // The server sends Go's zero time.Time for a lane with no status file or record.
 const quiet={...lane('quiet','holding','',''),updatedAt:'0001-01-01T00:00:00Z'};
 expect(laneWords(quiet)).toBe('last word time unknown');
 expect(laneWords({...quiet,updatedAt:'2026-01-10T11:00:00Z'},Date.parse(fleet.updatedAt))).toBe('last word 1 hour ago');
});

test('freshness names old data as a save',()=>{
 const at=Date.parse(fleet.updatedAt);
 expect(freshness(fleet.updatedAt,at+30000)).toBe('Live');
 expect(freshness(fleet.updatedAt,at+5*60000)).toBe('Updated 5 min ago');
 expect(freshness(fleet.updatedAt,at+3*3600000)).toBe('Saved 3 hours ago');
 expect(isOld(fleet.updatedAt,at+9*60000)).toBe(false);
 expect(isOld(fleet.updatedAt,at+10*60000)).toBe(true);
});

test('an ask is overdue from 5.5 days, and that is the day its sixth segment lights tall',()=>{
 const day=1440;
 expect(overdue(5.4*day)).toBe(false);
 expect(overdue(5.5*day)).toBe(true);
 expect(ageDays(5.4*day)).toBe(5);
 expect(ageDays(5.5*day)).toBe(6);
});

test('a tick box keeps only space; a text field keeps every key; a button keeps enter and space',()=>{
 const tick={tagName:'INPUT',type:'checkbox'},text={tagName:'INPUT',type:'text'},button={tagName:'BUTTON'};
 for(const key of ['a','l','f','Enter','/','c','?'])expect(keepsKey(tick,key)).toBe(false);
 expect(keepsKey(tick,'Space')).toBe(true);
 for(const el of [text,{tagName:'INPUT',type:'search'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{tagName:'DIV',isContentEditable:true}])
  for(const key of ['f','Enter','Space','/'])expect(keepsKey(el,key)).toBe(true);
 expect([keepsKey(button,'Enter'),keepsKey(button,'Space'),keepsKey(button,'f')]).toEqual([true,true,false]);
 expect([keepsKey({tagName:'BODY'},'Enter'),keepsKey({tagName:'BODY'},'Space'),keepsKey(null,'f')]).toEqual([false,false,false]);
});

const returnedLane=(id:string,returnedSince:string,updatedAt:string,asked='')=>({...lane(id,'needs you','build',asked),invalidAsks:1,returnedSince,updatedAt});
const boardOf=(...stationLanes:ReturnType<typeof returnedLane>[])=>({updatedAt:'2026-01-10T12:00:00Z',hiddenAsks:0,autonomyShare:0,changedLanes:[],stationLanes}) as unknown as Fleet;
const ageOf=(board:Fleet,id:string)=>{const {quick,read}=listRows(board,'',Date.parse(board.updatedAt));return [...quick,...read].find(r=>r.lane.id===id)?.age;};

test('a lane whose open asks are all returned waits from its oldest decision, not its latest note',()=>{
 const board=boardOf(returnedLane('ann','2026-01-10T11:00:00Z','2026-01-10T08:00:00Z'),returnedLane('zed','2026-01-05T12:00:00Z','2026-01-10T11:59:00Z'));
 expect(fleetOrder(board).map(l=>l.id)).toEqual(['zed','ann']);
 expect(ageOf(board,'zed')).toBe(5*1440);
});

test('a record block keeps its reason beside its malformed-ask count; a status-line return shows only its count',()=>{
 const block={...lane('blocked','needs you','build',''),invalidAsks:2,now:'Waiting on the owner to pick the route'} as unknown as Lane;
 const returned={...lane('returned','needs you','build',''),invalidAsks:1,returnedSince:'2026-01-10T11:00:00Z'} as unknown as Lane;
 const asked={...lane('asked','needs you','build','2026-01-10T11:00:00Z'),invalidAsks:1} as unknown as Lane;
 expect(listQuestion({lane:block,age:NaN})).toBe('Blocked: Waiting on the owner to pick the route');
 expect(returnedOnly(block)).toBe(false);
 expect(listQuestion({lane:returned,age:NaN})).toBe('1 ask not in the ask form went back to the crew.');
 expect(returnedOnly(returned)).toBe(true);
 expect(listQuestion({lane:asked,ask:asked.asks[0],age:NaN})).toBe('Example?');
});

test('a returned ask without a decision time stays unknown and sorts ahead of dated lanes',()=>{
 const board=boardOf(returnedLane('recent','2026-01-10T11:00:00Z','2026-01-10T08:00:00Z'),returnedLane('undated','0001-01-01T00:00:00Z','2026-01-10T11:59:00Z'));
 expect(fleetOrder(board).map(l=>l.id)).toEqual(['undated','recent']);
 expect(Number.isNaN(ageOf(board,'undated'))).toBe(true);
});
