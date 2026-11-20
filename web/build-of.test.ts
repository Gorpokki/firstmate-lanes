import {expect,test} from 'bun:test';
import {buildOf} from './Holo';

test('blocked or failed hull shape stops at half, regardless of supplied progress',()=>{
 expect(buildOf('needs you',true,false,.72)).toBe(.5);
 expect(buildOf('done',false,true,1)).toBe(.5);
 expect(buildOf('working',false,false,.35)).toBe(.35);
});
