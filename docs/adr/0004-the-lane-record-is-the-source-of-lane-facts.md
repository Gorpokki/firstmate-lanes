# The lane record is the source of lane facts

The dashboard must learn each lane's state and its asks from somewhere. Each crew now writes one small record for its lane: its name, its state, what it does now, its asks and its ticket link. The dashboard reads only these records. Until every crew writes one, the dashboard builds the record from the status lines that crews write today.

## Considered options

- Status lines only: no change for crews, but the dashboard must guess each lane's ticket and must guess when an ask is too old to count.
- Ticket states only: one lane for each ticket. In a test on a real fleet this lost every lane that had no ticket, and it marked almost every lane as waiting on the user, because a label never expires.
