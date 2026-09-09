# Room scheduling guarantees

Planned pairings use a published time slot as their recurring day and time. A room may have only
one pairing at a time within a program period, and a pairing cannot overlap a recurring room
blackout. The comparison is strict: a session ending when another begins is valid.

Database triggers enforce this rule for every writer. The application also checks it when
management creates or edits a pairing, when a tutor selects a slot, when a catalog slot change
propagates to linked pairings, and when management adds a room blackout. These application writes
share a transaction lock so their validation reads remain coherent and return a clear conflict
message; the database triggers remain the final boundary. New blackouts check the active program
period, while completed periods remain historical evidence.

The room integration tests require an explicit loopback PostgreSQL database whose name ends in
`_test`, with no connection-target query overrides. Their guard runs before setup or cleanup hooks are registered, so inheriting a demo or
production database from `.env` fails before any fixture or active-period writes.

Availability remains scheduling guidance. Student and tutor availability helps the team agree on
a suitable slot, while an assignment can exist before that agreement and schedule conflicts use
the review workflow described in the participant handbooks.

The tutor control currently manages the pairing's **default time-slot reference**. Clearing it
removes that catalog link while retaining the copied day and time. It does not erase the pairing's
schedule. Attendance continues to accept the actual date, time, and room for a completed session;
a truthful historical report can therefore differ from the planned booking and is handled through
the existing conflict warning and management review.
