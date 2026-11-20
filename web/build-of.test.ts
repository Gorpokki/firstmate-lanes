import {expect,test} from 'bun:test';
import {buildOf,caption} from './Holo';

test('hull label describes its state-derived shape without claiming measured progress',()=>{
 expect(caption(null,false,false,false)).toBe('Hull follows lane state');
 expect(caption(null,false,false,true)).toBe('blocked');
 expect(caption('stress',true,false,false)).toBe('failing: stress');
});

test('blocked or failed hull shape stops at half, regardless of supplied progress',()=>{
 expect(buildOf('needs you',true,false,.72)).toBe(.5);
 expect(buildOf('done',false,true,1)).toBe(.5);
 expect(buildOf('working',false,false,.35)).toBe(.35);
});
