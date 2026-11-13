# The dashboard sends answers, one batch at a time

The dashboard was read-only: the user chose an answer, the dashboard copied it, and the user pasted it into Firstmate. The user will not paste answers. So the dashboard now writes one thing into a Firstmate home: the user's answers. It runs the command that Firstmate has for answers, with the key of the ask and the choice, so no model reads free text to find which ask was answered. The dashboard holds the answers of one sitting and sends them together when the user confirms. Until then, the user can go back and change or undo each answer.

An answer in the batch is one of three things. It is a choice of the ask. It is the user's own answer, typed, when no choice fits: each ask has a field for it. Or it is a skip: the user gives no answer, and the crew chooses by itself and says what it chose in its next status line. A skip does this also when the crew gave no pick. A deferred ask is not in the batch: it comes back in a later sitting. Before the user sends, the dashboard lists the answers of the sitting under the card, by lane name and question.

Each device on the user's private network can open the dashboard, so each such device can answer. There is no login.

## Considered options

- A free-text note into Firstmate's inbox: Firstmate must work out which ask the note answers.
- An answer file in a folder that Firstmate watches: Firstmate needs a new reader for it.
- Send each answer at once: one key less, but no way to go back.
- A skip that parks the lane, or no skip without a crew pick: the lane then waits on the user, which a skip is there to prevent.
- A login before the first answer, or answers from one computer only: more safety than a private network needs, and the phone could not answer.
