# fm-lanes

The dashboard that shows every lane of a Firstmate fleet, and lets one person answer what the lanes ask of them.

## Language

**Lane**:
One piece of work that one crew owns, from start to done.
_Avoid_: task, job, ticket

**Crew**:
The agent that does the work of one lane.
_Avoid_: worker, agent

**Second mate**:
The agent that runs one group of lanes; asks group by it.
_Avoid_: product, context, home

**Lane record**:
The small record that a crew writes for its lane; the dashboard's only source of lane facts.
_Avoid_: status file, state file

**Ask**:
A question from a crew that only the user can answer.
_Avoid_: decision, question, open loop

**Choice ask**:
An ask with one question, a reason and two to four choices.
_Avoid_: quick ask, option ask

**Discussion ask**:
An ask for a matter that is not a plain choice; it names what must be decided and opens a grill.
_Avoid_: grill request, open ask

**Crew pick**:
The choice that the crew recommends for a choice ask.
_Avoid_: recommendation, default

**Grill**:
A talk between the user and a crew about an ask, held before the user chooses.
_Avoid_: discussion request, interview

**Station**:
One of the four screens of the dashboard: Ask, List, Fleet, Lane.
_Avoid_: view, tab, page

**Board**:
The frame around a station: the summary, the station rail and the fleet strip. The Ask station hides it.
_Avoid_: chrome, frame

**Home**:
One Firstmate installation and the lanes that it runs.
_Avoid_: instance, fleet

**Block**:
A lane that is stopped by something its crew cannot clear.
_Avoid_: blocker, stuck lane

**Needs you**:
The state of a lane that has an open ask or a block.
_Avoid_: waiting on captain

**Holding**:
The state of a lane that is parked, or that says it works but went silent.
_Avoid_: parked, stale, unknown

**Board suggestion**:
The choice that the dashboard marks on a choice ask for which the crew gave no pick.
_Avoid_: default, recommendation

**Quick**, **To read**:
The two effort classes of an ask: one that the user answers at a glance, and one that the user reads first.
_Avoid_: shallow, deep

**Sitting**:
One short run of asks that the user answers in one go; its answers go to Firstmate together.
_Avoid_: batch, session, queue

**Own answer**:
An answer that the user types in their own words when no choice of the ask fits.
_Avoid_: free text, other

**Skip**:
No answer from the user: the crew chooses by itself and says what it chose in its next status line.
_Avoid_: pass, dismiss

**Defer**:
The user wants to answer the ask, but not now: the ask comes back in a later sitting.
_Avoid_: snooze, later

**Save**:
The dashboard's last reading of the fleet.
_Avoid_: snapshot, refresh

**Changed lanes**:
The lanes whose state changed since the user last looked.
_Avoid_: since line, diff

**Autonomy share**:
The share of lanes that ran without the user.
_Avoid_: autonomy score

**Crew's last word**:
The newest status line of a lane.
_Avoid_: note, last status

**Heat grid**:
The first display of the Fleet station: one tile for each lane, in the colour of its state.
_Avoid_: heatmap

**Shipyard**:
The second display of the Fleet station: each lane's ship in its own place, under a camera that the user moves.
_Avoid_: berths, berth view, dock view

**Holo view**:
The ASCII ship of one lane (lit, flat or as bars), which the user can turn and zoom.
_Avoid_: hologram, viewscreen, carousel

**Build state**:
How far the ship of a lane is built; it shows the status of the lane.
_Avoid_: progress
