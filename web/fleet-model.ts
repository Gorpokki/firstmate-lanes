import {fleetOrder,type Fleet,type Lane} from './stations';

// The heat grid's groups, in the board's order; the holding lanes have their own quiet row.
export const GROUPS:[string,string][]=[['needs you','Need you'],['waiting','Waiting, not on you'],['working','Working'],['done','Done']];
// The yardbar: the share of each lane state, and the filter of the ships the shipyard shows (holding hidden at first).
export const YARD_STATES:[string,string][]=[['needs you','need you'],['waiting','waiting'],['working','working'],['done','done'],['holding','holding']];
export const YARD_SHOWN=['needs you','waiting','working','done'];
// Gone quiet: a working lane with no word for two hours, which the reader holds; every other holding lane is parked.
export const goneQuiet=(lane:Lane)=>lane.state==='holding'&&lane.sourceState==='working';

export function deriveFleet(fleet:Fleet){
 const rows=fleetOrder(fleet),hold=rows.filter(lane=>lane.state==='holding'),quiet=hold.filter(goneQuiet).length;
 return {
  rows,hold,quiet,parked:hold.length-quiet,
  groups:GROUPS.map(([state,label])=>({state,label,lanes:rows.filter(lane=>lane.state===state)})).filter(group=>group.lanes.length),
  shares:YARD_STATES.map(([state,label])=>({state,label,count:rows.filter(lane=>lane.state===state).length})).filter(share=>share.count),
 };
}
// One state's ships shown or hidden in the shipyard; the filter never hides every state.
export function toggleShown(shown:string[],state:string){
 const next=shown.includes(state)?shown.filter(s=>s!==state):[...shown,state];
 return next.length?next:shown;
}
