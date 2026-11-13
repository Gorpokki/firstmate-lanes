# An ask is a JSON object in one of two forms

Crews wrote asks as free text: a typical ask was long, most held raw codes or paths, and a model had to guess the question and its choices. So a crew now writes each ask as a JSON object in one of two fixed forms. A **choice ask** has one question, a reason and two to four choices, with the crew's pick or the reason for no pick. A **discussion ask** is for a matter that is not a plain choice: it names the topic and what must be decided, and it opens a grill. A grill is offered on every ask, not only on a discussion ask. The choices do not bind the user: they can answer each ask in their own words.

An ask carries more than the decision: what each choice does, why the crew picks its choice, the effort, the crew's full text, what waits on the answer, and links to the lane's ticket, its pull requests and any grill pages that exist. The Ask station shows the decision first: the question, the reason and the choices. It keeps the links and the other text out of sight until the user asks for them. Asks group by the second mate of their lane, which is a fact of the lane and not a label that a crew types.

## Considered options

- A smaller set of fields (question, choices, pick): less for a crew to write, but the user must leave the dashboard to find the ticket or the reason.
- Free text, then a rewrite by a model: no new rule for crews, but the rewrite is a guess that can change what the crew meant.
- One fixed form (choice only): an ask that is not a plain choice does not fit, so crews would force it into false choices.
- A pick on every choice ask with no way out: rejected, because a crew with no honest pick would invent one.
