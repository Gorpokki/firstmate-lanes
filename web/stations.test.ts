import {test,expect} from 'bun:test';
import {boardSummary,findFoot,findLanes,fleetOrder,freshness,hiddenTicked,isOld,keepNeedingTicks,laneWords,listRows,stateChanges} from './stations';
import {buildSitting} from './sitting';

const lane=(id:string,state:string,secondMate:string,asked:string)=>({id,name:id,state,secondMate,home:'main',now:'Example',history:[],asks:asked?[{key:id,form:'discussion',question:'Example?',reason:'Choose',effort:'quick',asked,answerable:true}]:[]});
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
