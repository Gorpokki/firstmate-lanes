import {states,type Fleet,type Lane} from './stations';

export type FleetState=typeof states[number];
export type StateShare={state:FleetState;count:number;percentage:number};

export function deriveFleet(fleet:Fleet,filter:FleetState|null=null) {
 const rows=fleet.stationLanes.toSorted((a,b)=>states.indexOf(a.state as FleetState)-states.indexOf(b.state as FleetState)||a.id.localeCompare(b.id));
 const shares=states.map(state=>{
  const count=fleet.stationLanes.filter(lane=>lane.state===state).length;
  return {state,count,percentage:fleet.stationLanes.length?count/fleet.stationLanes.length*100:0};
 });
 return {rows:filter?rows.filter(lane=>lane.state===filter):rows,shares};
}
