import {expect,test} from 'bun:test';
import {buildOf} from './Holo';

// oracle: the accepted D renderer's status targets, where blocked and failed both build to 0.5; a working lane keeps the progress the server reports
test('a blocked or failed lane builds to half, whatever progress the server reports',()=>{
 expect(buildOf('needs you',true,false,.72)).toBe(.5);
 expect(buildOf('done',false,true,1)).toBe(.5);
 expect(buildOf('working',false,false,.35)).toBe(.35);
});
