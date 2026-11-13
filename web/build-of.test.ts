import {expect,test} from 'bun:test';
import {buildOf} from './Holo';

// oracle: README's Lane line ("a blocked lane's ship stops at half build") and station.go's progress for a needs-you lane (.72)
test('a blocked or failed lane stops at half build, whatever progress the server reports',()=>{
 expect(buildOf('needs you',true,false,.72)).toBe(.5);
 expect(buildOf('done',false,true,1)).toBe(.5);
 expect(buildOf('working',false,false,.35)).toBe(.35);
 expect(buildOf('done',false,false,undefined)).toBe(1);
});
