import {test,expect} from 'bun:test';
import type {Lane} from './stations';
import {nameRows,yardOf} from './shipyard-model';

test('a berth name breaks only between words and ends at a whole word',()=>{
 expect(nameRows('Compare three cache layers',12,3)).toEqual(['Compare','three cache','layers']);
 expect(nameRows('Compare three cache layers for the example lane',12,2)).toEqual(['Compare','three cache…']);
});

test('only a working lane is a hull in work, the one the drones build',()=>{
 const as=(state:string,sourceState=state)=>yardOf({state,sourceState} as Lane);
 expect(['needs you','waiting','working','done','holding'].map(s=>as(s))).toEqual(['lit','lit','hull','launched','scaffold']);
 expect(as('holding','working')).toBe('scaffold'); // gone quiet: no drones
 expect(as('needs you','blocked')).toBe('stalled');
});
