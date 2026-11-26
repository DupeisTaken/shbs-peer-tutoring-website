# Session planning

Recurring pairings describe teaching assignments. `SessionPlan` materializes one
dated lesson from that assignment, with immutable subject and roster snapshots.
`SessionPlanCohort` describes where and when a subset meets; each participant keeps
a stable `SessionPlanParticipant` identity as they move. Actual attendance remains
in `Session` and may have a different duration. Implementation:
[planning service](../../src/server/session-planning/index.ts),
[router](../../src/server/api/routers/session-planning.ts), and
[scheduling delivery](session-planning-delivery.md).

**Contents:** [Tutor Schedule workspace](#tutor-schedule-workspace) · [Tutoring pauses and affirmative exceptions](#tutoring-pauses-and-affirmative-exceptions) · [Request profiling and comparison contract](#request-profiling-and-comparison-contract)

Tutors use one workspace at `/dashboard` and the compatible `/schedule` entry.
Schedule, Pairings, Preferences and History & Hours are local panels. Each panel
mounts on first access and stays mounted while hidden, retaining independent drafts
and read recovery. Existing fragments select the owning panel; local links between
these two routes do not discard live editors. An open native dialog retains focus.
The tutee agenda remains at `/student?view=schedule#sessions` with its existing
permissions and source-owned writes.

## Tutor Schedule workspace

[The workspace](<../../src/app/(tutor)/_components/tutor-workspace.tsx>) places
compact outstanding tasks above local panels. [Schedule](<../../src/app/(tutor)/_components/tutor-schedule.tsx>)
uses a compact action row for extra sessions, interviews and meetings instead of
four repeated overview cards. Feature-disabled appointment sources are not queried
or shown. A 24 px section gap separates the complete action and notice block from
the agenda, including when actions wrap on narrow screens. Chair work remains
independently owned beside the agenda; ordinary panelists open their own reader
and voting workflow. Preferences groups availability, workload, willingness and
qualifications without combining their saves. History
reuses the authorized personal tutor-history reader; existing historical access at
`/history` remains available independently of current participation policy.

**Sessions → Add Extra Session** selects an existing pairing's published future
session and participants before opening the existing extra-session proposal
editor. It requires active tutoring access and a usable published source. Selecting
the source neither submits a proposal nor changes a recurring assignment; the
existing 45-minute, agreement, version and conflict rules still govern submission.
An unavailable source leaves the action disabled; Pairings remains directly available in the workspace tabs.
The picker displays the current primary pairing's localized weekly slot rather
than the source occurrence's date for ordinary extra-session sources. A moved or
timetable-mapped date never becomes the displayed recurring weekday. Distinct
source cohorts retain their captured audience, identity and version even when
their weekly labels match; an unavailable current slot is shown as unavailable
rather than inferred from the occurrence. Paused exception rows (**Arrange
exception**) display the paused occurrence's localized calendar date before its
calendar weekday and planned time so dated exceptions remain distinct from
recurring-slot extra sources.
The tutor picker requests this enrichment with `includeRecurringSchedule: true`.
Omitted or false flags preserve the existing agenda response shape and avoid the
current-pairing lookup; historical readers remain captured evidence only.

A tutoring pause retains a separate published, suppressed source for **Arrange
exception**. Tutors can propose or tutees can suggest an exception from
that source without restoring its automatic commitment. When a physical cohort
contains both scheduled and paused learners, the paused action passes
`pausedOnly` and the server selects only its paused roster. Ordinary attendance
and ordinary rescheduling keep their scheduled roster. Sharing a room and time
never transfers one learner's affirmative agreement to another learner.

The compact agenda previews actionable items from up to three distinct unresolved
items across the personal sources. Items requiring action come first, most recent first; other commitments
follow by nearest start. Ended tutoring stays outstanding until attendance is
recorded. Interview action labels distinguish an unrecorded own vote, an eligible
chair's scheduling or decision work, and permitted completion follow-up. A saved
vote, pending decision/completion review or recorded completion does not become a
second action merely because the interview remains open. An unscheduled interview
may require action but never acquires an invented dated appointment. The preview
is independent of event filters and paged event lists; its three rows are not a
total count of all available records.

The event filters default to **Upcoming (2 weeks)**: the current and next school
weeks in the program timezone, plus ended tutoring missing attendance. Upcoming
events appear earliest first. **All** and **History** show newest events first,
using each source's authorized scope. Interviews and meetings keep their original
workflow and personal-history readers. The room grid and both calendar notices
appear below the personal agenda at `/schedule#room-schedule`. New tutor calendar
notices use `/schedule#school-calendar/YYYY-MM-DD`; tutee notices retain
`/student#school-calendar/YYYY-MM-DD`. Old dashboard room/calendar fragments now open the same retained Schedule panel.
The room grid is an optional retained disclosure; calendar notices remain visible.

The live agenda loads up to 300 recent unfinished sessions independently of the
current two-week window. Its overdue-attendance query reads 301 source rows,
retains the newest 300 and returns `attendanceBacklogHasMore` when another match
exists. The current-window query has its own 300-row bound; IDs merge before
chronological display, so the combined result can exceed 300 cohorts. Current
request and suggestion lists retain their separate 100-row limits. The backlog
notice explains that recording loaded attendance allows older unfinished sessions
to enter Upcoming, while All/History can browse more published cohorts without
granting historical attendance writes. It does not imply that the loaded working
set is the entire backlog.

Session history reads captured published planning evidence rather than rebuilding
the past from current Pairings. It includes retained cancellation/move evidence
and recorded planned sessions; older attendance without a published plan remains
in personal attendance history. There is no standalone historical-attendance union
in this agenda. The self-scoped
[history reader](../../src/server/session-planning/index.ts) returns bounded pages
with stable timestamp/ID cursors, without publishing plans or running scheduling
writes. Interview and meeting event pages use independent bounded cursors in the
[personal-source router](../../src/server/api/routers/personal-schedule.ts).
Each source has its own **Load more** and refresh recovery. A partial page is not
presented as the complete history.

Historical session projections grant no write authority. When the same cohort
also belongs to the current authoritative agenda, its live projection wins by ID,
preserving any existing permitted attendance workflow. Event filters and paging
do not reset retained proposal, attendance, vote, completion or meeting-excuse
controllers, captured versions or pending submissions. Each feature still owns
its independent Save, Cancel and accepted-write refresh recovery. Transient
source failures retain available evidence with an explicit error; unavailable
interviews, meetings or tutoring cannot erase the independently authorized sibling
sources. Authoritative access denial conceals that source's private records and
disables its retained readers until fresh access succeeds. Opening a history or
appointment reader performs no generic event write.

## Automatic room review

The dated-session editor uses one **Include all tutees in this session** checkbox;
unchecked selects exactly one current cohort participant. A one-person source shows
the participant directly. This introduces no arbitrary-subset agreement model.

In-person proposals, suggestions and counteroffers call `previewLocation` when
Review is selected. This authorized read takes the normal period/planning fences,
checks current cohort/request versions and applicable participant ownership, then
uses the existing dated conflict validator. It prefers a usable existing room,
then program order, name and ID. Blackouts, published cohorts, pending offers,
calendar-mapped recurrence and shared participant conflicts remain authoritative.
Online is an explicit alternative; unavailable rooms never silently become Online.

The preview creates no reservation, request, response, receipt or notification.
Review shows the concrete room. Submission passes that exact room through the
existing locked write validator; a newly occupied/deleted room rejects the write
without substituting another location. Edit and Review again to obtain a new room.
Existing explicit-room and no-room historical evidence is unchanged. A formalized
suggestion carries agreement forward only if date, time, room and Online status
still match; changed automatic allocation requires fresh agreement.

## Publication and existing data

The visible school-timezone window is Monday–Sunday for the current and next week.
On Sunday the bounded background worker prepares the following window; agenda
reads catch up under the same database lock. Generation keys make repeated
publication idempotent. An initial publication does not invent ended lessons.
Previously published, ended lessons remain available for attendance beyond the
visible window. Existing attendance and historical durations are not rewritten.

Personal agendas do not expose the publisher's program-wide `unavailable` counter.
It mixes invalid assignment groups with failed candidate dates and is not a count
of a participant's weekly arrangements. Session-specific unavailable guidance
stays with the affected captured lesson; internal maintenance metrics remain
available to the scheduling service. The deprecated personal response field stays
at zero for compatibility and never contains the publisher's global count.

The source term's persisted `SCHEDULED` official refresh is an exact end boundary:
new lessons must finish at or before `executeAt`. The earlier term date bound
still applies. Moving or cancelling the refresh can restore eligible future
commitments; started lessons and recorded attendance retain their evidence.
Blocked, failed, cancelled and completed schedules do not impose a future cutoff;
actual refresh continues to own term activation and participation changes.

The reversible `SessionPlanCohort.refreshSuppressed` marker keeps refresh intent
separate from participant cancellations, tutoring pauses and negotiated consent.
Scheduling changes dirty maintenance through the
[refresh-boundary migration](../../prisma/migrations/20261116010000_session_refresh_boundary/migration.sql).
Reconciliation releases future bookings and preserves their IDs; restoration
rechecks conflicts. Calendar reads apply the current cutoff before maintenance
catches up and retain cancellation until restoration is safe. Source schedule
versions advance the same calendar UID's sequence across cancellation/replacement.
A cutoff saved before a lesson stays effective on a late first read; a cutoff
saved after work started cannot retroactively suppress that lesson.

Every new plan derives an end exactly 45 minutes after its start. Older recurring
slots may retain their historical duration; the agenda flags their normalization.
The source start stays fixed. Unscheduled or invalid combined groups remain
unavailable until repaired. Effective dated exceptions and current proposals take
part in conflict checks. School closures suppress ordinary recurrence; agreed
dated sessions remain commitments. Tutoring pauses apply the stronger affirmative
exception rule below. The school-calendar mapping adapter reads
the owning calendar's effective weekday and semantic revision.
Semantic calendar saves and resets reconcile future plans in the same transaction,
using the shared period, room and planning locks. A closure saved before a lesson
starts cannot remain attendance-eligible just because the first agenda read occurs
after its start; retrospective edits preserve already-started evidence.
Individual `scheduleOverride` provenance preserves an agreed learner
who returns to an ordinary shared cohort. `calendarSuppressed` distinguishes an
ordinary commitment that may be restored on reset from a user/lifecycle
cancellation. Restoration rechecks conflicts; exact matching cohorts coalesce
and emptied physical cohorts retain cancellation evidence for subscriptions.
This includes restoring peers to an already-agreed sibling at the unchanged
weekly clock: retain the agreed cohort's identity and each learner's separate
consent, rather than creating overlapping attendance blocks.
Calendar-change notices include current live proposal recipients on the target
date, even when no confirmed lesson or recurring assignment exists there yet.
Superseded offers, elapsed cutoffs and terminal requests do not expand that audience.

### Tutoring pauses and affirmative exceptions

The [tutoring policy helper](../../src/lib/tutoring-policy.ts) resolves applied
`ProgramCalendarDay` ranges against the actual program-local date, independently
of timetable mappings. `NOTICE` retains the legacy informational contract;
`PAUSE_REGULAR` suppresses automatic ordinary commitments. Both endpoints are
inclusive. Any active overlapping pause still applies after another is removed.
Existing rows default to `NOTICE`, and an omitted effect in an older edit preserves
the current row's effect. Coordinator proposals do not apply policy until approved.
School-day appeal counting and recurring assignments are unchanged.

The [calendar writer](../../src/server/program/calendar.ts) shares the period →
room → planning → notice-range lock order with publication and attendance.
Changing the effective pause interval/mode, reactivating a pause or removing one
reconciles future publications in the same transaction. Reasons and editor
versions do not themselves change scheduling meaning. Reconciliation includes
published moved/extra cohorts outside the visible two-week window, not only
newly generated ordinary lessons. Started lessons and any cohort with recorded
attendance retain their evidence; policy changes create no attendance, absence
cards or service hours.

New no-tutoring ranges default to `PAUSE_REGULAR` in the editor, impact preview and
writer. An explicit `NOTICE` selection remains informational, and omitted effects
on existing rows preserve their saved meaning. Applying a pause cancels future
automatic regular commitments while retaining already-confirmed extras and
explicitly agreed rescheduled lessons. Existing confirmed extras remain valid
even when their pre-pause agreement used the ordinary timeout rule; this retention
does not manufacture affirmative consent for a new paused-date offer or revive
cancelled participants.

`ProgramCalendarPolicyRevision` keeps append-only semantic snapshots of each
stable starting-date source: ending date, effect, active state, version and the
database effective time. Reason/editor-only changes add no semantic revision.
Raw source updates, removal and source-table truncation append their meaning;
they do not rewrite earlier policy. The
[history reader](../../src/server/program/calendar-policy-history.ts) selects the
latest snapshot of each source strictly before the actual lesson start, then
checks active intervals and overlaps. Filtering endpoints first would wrongly
revive a shortened/removed old pause. A decision at or after the start preserves
already-started evidence. Synchronous configuration reconciliation uses the same
persisted effective time. Deployment seeds existing rows at deployment time;
neither their editor timestamps nor legacy notices invent a past pause.

`SessionPlanParticipant.tutoringPauseSuppressed` records a distinct reversible
cause. `calendarSuppressed` remains the school-calendar cause. User/lifecycle
cancellations clear the pause marker and are not candidates for automatic
restoration. Removing a pause restores only eligible future participants after
checking remaining pauses, school-calendar restrictions and current conflicts.
An unresolved conflict leaves a reversible tombstone for a later dirty-source
pass. Cohort IDs and cancelled calendar evidence remain intact; membership,
continuation and reviewed execution-identity changes use the same source-owned
planning lifecycle instead of deleting/recreating consent.

A new exception on a paused date requires affirmative agreement for the exact date,
clock, room/Online choice, tutor and participating learner. The scheduler reads
accepted offers and current response owners. `AUTHOR` and `EXPLICIT` responses
can establish affirmative consent; `MATCHED` evidence must retain the same offer
and valid affirmative provenance. For carried split consent, the parent chain
is checked rather than trusting a historical `MATCHED` label that may have hidden
timeout acceptance. `TIMEOUT`, `scheduleOverride`, plan kind `EXTRA` and a cohort's
rescheduled flag do not independently establish affirmative consent. Retaining an
already-confirmed extra under a newly applied pause is separate from admitting a
new exception. In a mixed regular cohort,
one agreed learner remains scheduled while a peer without that evidence stays
paused. Source/owner changes still require the existing live authority checks.

Submission, counteroffers, delivery completion, final agreement and the deadline
sweep recheck the proposed date's pause policy. While paused, essential-mail
delivery records acceptance time but creates no silence deadline. Applying a pause
clears existing pending response deadlines while retaining SMTP acceptance times;
timeout/unknown acceptance cannot become optional participation. Removing the
pause does not revive a cleared deadline or count silence spent under the pause.
Previously delivered pause-exposed offers therefore still need affirmative replies;
a genuinely new ordinary offer may use the normal delivery-based response clock.
If an essential message was admitted with explicit-only guidance, completion does
not start a silence timer merely because the pause was removed while SMTP was in
flight. A valid move out of a paused date remains negotiable, and
expiration never resurrects the suppressed original. Only current pending offers
hold rooms/participants; terminal requests release those holds through the normal
request-state path. Short-notice cutoff and explicit agreement rules still apply.

Upcoming and the default week list show dated commitments and attendance duties,
excluding cancelled and fully paused source cards. All/History retain cancellation
evidence. The optional-session picker still exposes eligible suppressed sources
without granting attendance authority. Attendance, reminder reads and private calendars use the
effective scheduled roster. A paused source alone reserves no active commitment.
Pending requests and captured decision reviews display the proposed room or
Online choice alongside the time. Explicit-only guidance appears before email
delivery as well as afterwards. An unknown physical room asks for a refresh and
blocks acceptance without silently substituting Online or a roomless offer;
fresh server validation still checks the captured offer and version.
Retained confirmed extras and affirmatively agreed reschedules may receive
reminders even on paused dates;
an overlapping `NOTICE` still suppresses optional reminders under the legacy
notice contract. Queued essential proposal mail is checked against current policy
before delivery so its agreement guidance cannot promise silence acceptance on
a paused date. Existing SMTP acceptance times remain historical facts.
The stricter explicit-only transport admission remains sticky across automatic
and manual retries, including a later notice for the same offer. Retrying retains
the actual prior admission time while rotating the active attempt ID/lease; an old
attempt completion cannot settle the replacement. A never-admitted queued notice
does not establish that transport evidence.

The management impact preview is a read-only snapshot of already-published future
participant commitments, not unique people, sessions or all future recurrence.
It separates ordinary suppression, retained affirmative exceptions, exceptions
needing confirmation and potentially restorable participants. Actual writes
recheck current versions, source authority and conflicts. Previewing does not
reserve rooms, create a request or apply policy.

### Durable maintenance and source invalidation

[The maintenance adapter](../../src/server/session-planning/maintenance.ts) uses
`SchedulingMaintenanceState` and `SchedulingDirtyEvent` only as rebuildable
accelerators. They contain the implementation version, published window and
timezone, repeated-publication counters, exact event IDs and a bounded queue of
current requests awaiting fresh checks. They contain no permission, participant
consent or historical assignment authority. The original source tables remain
authoritative, including when ownership or eligibility changes A → B → A before
the next reader. Such changes still schedule a new current-source check; they do
not create a new reason to reject a currently valid request.

Every maintained source INSERT/DELETE and semantic UPDATE appends an event in the
same transaction through `scheduling_source_dirty` and
`scheduling_mark_dirty()`. Each source also has the unconditional statement
trigger `scheduling_source_truncated`, so source TRUNCATE schedules rediscovery.
The source triggers never take the planning lock or update a
shared revision row while holding source locks. It ignores `updatedAt` and
ordinary `version`-only updates, calendar note-only edits and unrelated program
settings. It does not honor recovery recapture suppression: a compensating source
write must invalidate current scheduling even when its recovery journal is
deliberately suppressed. The complete dependency closure is:

| Source tables | Scheduling dependency |
| --- | --- |
| `Pairing`, `PairingGroup`, `PairingTutee` | Assignment clocks, room, tutor, subject, combined-group primary and active roster |
| `Tutor`, `Tutee`, `User` | Membership/status, direct profile links, identity grouping, role, suspension, tutor revocation, retired-login/voided state and recipient mailbox changes |
| `TutorProfileOwnership`, `StudentProfileOwnership` | Explicit current/retained profile ownership and reviewed transfer revisions |
| `Term`, `ProgramSettings` | Active period, inclusive date bounds and program timezone |
| `SchoolCalendarDay` | School-day/timetable meaning, semantic revision, reset and inactive tombstone |
| `ProgramCalendarDay` | Applied tutoring-pause interval, effect and active state; informational/reason-only edits do not change planning meaning |
| `SchoolDeparture`, `PolicyAcceptance` | Current participation and the policy evidence consumed by dual-role learner admission |
| `StudentContinuationPairing`, `StudentContinuationAssignment` | Continuation identity, current status, target pairing and assignment/release instants |
| `SessionPlanContinuationMember`, `SessionPlanAssignment` | Supplemental enrollment/release and original published assignment/roster evidence. A surveyless withdrawal release records the original tutee profile, including after transfer |
| `SessionPlan`, `SessionPlanCohort`, `SessionPlanParticipant` | Dated source, clock, room, cancellation/override/suppression and participant changes |
| `SessionPlanningRequest`, `SessionPlanningOffer`, `SessionPlanningResponse` | Current offers, holds, request state, responses and delivered response deadlines |
| `Room`, `RoomUnavailability` | Room existence and recurring blocked clocks |
| `ParticipantConsolidation`, `PairingExecutionSuccessor` | Current participant and recurring assignment successors |
| `SessionPlanExecution`, `SessionParticipantExecution`, `SessionResponseExecution` | Current execution tutor, learner, assignment and response authority, retaining original evidence actors |
| `RetiredHistoryOwnership`, `HistoryRowOwnership`, `PersonCombineReceipt` | Reviewed inherited consent ownership and original-account restriction provenance |
| `StudentRequestExecutionAssignment`, `StudentSurvey` | Exact original request ownership, current learner, open state and released membership |

The identity integration migration installs the additional dependencies and the
same strict verifier atomically. It invalidates existing publication and settlement
versions without deleting pending source events or request retries. Updating the
state row changes its database generation (`xmin`), preventing an acknowledgement
that read the old state from certifying it after installation. Missing state still
starts with obsolete defaults and requires a later current-source pass. Identity
mapping revisions remain semantic changes even though ordinary timestamps and
the unrelated generic `version` field are excluded from dirty-event comparison.

The [tutoring policy migration](../../prisma/migrations/20261108010000_tutoring_pause_policy/migration.sql)
adds its source to both unconditional triggers and the complete strict verifier,
preserves pending events/retries and invalidates existing maintenance generations.
The implementation version also advances so an old warm publication cannot skip
the new policy pass. The [safe recovery follow-up](../../prisma/migrations/20261108011000_tutoring_pause_recovery/migration.sql)
retains `tutoringPauseSuppressed` beside the independent calendar marker in
planning journal snapshots and retains the safe `schedulingEffect` scalar. It
does not add notice reasons, message bodies, mailbox addresses or capabilities,
and it grants no new recovery compensation authority. Complete pre-policy backup
catalogs remain recognized; a partially added policy-column pair is rejected.
The [policy history migration](../../prisma/migrations/20261108012000_tutoring_policy_history/migration.sql)
also preserves entity-specific interval/effect/active facts and the date primary
key in calendar-source recovery evidence. Its projection excludes the notice
reason. History snapshots reject row updates/deletes, and a compensating source
write appends a new revision at its actual database time. No generic recovery
operation acquires authority to edit prior policy history. Complete pre-history
backup catalogs remain recognized; incomplete history tables are rejected. A dedicated
history-integrity check verifies exact unconditional capture, source-truncation,
row-immutability and journal triggers and matches each current source to its latest
semantic snapshot. As-of reads and config writes fail closed if those contracts
are missing; the scheduling maintenance verifier requires the same proof.
Whole-database offline backup/test resets may truncate source and history together,
following the existing immutable-evidence reset convention. Operational record
editing exposes no history truncation or historical revision writer. Source-only
truncation appends deactivation; accidental history-only truncation while source
rows remain fails the semantic consistency check. Privileged offline database
restoration must restore source and revision history consistently; runtime guards
do not claim to prevent a database administrator from replacing the full database.
All new migration helper definitions and trigger references are explicitly in
`public`, with fixed function search paths where appropriate, so a custom caller
schema or a migration search path beginning with `pg_catalog` cannot shadow the
intended recovery projection. Clean migration verification must use the committed
chain; updating a stored checksum does not establish successful installation.
The [consent lookup index](../../prisma/migrations/20261108013000_tutoring_consent_lookup/migration.sql)
adds a B-tree on `SessionNotice.offerId` for repeated exact-offer sticky-admission
checks in agenda/sweep paths. It narrows candidate notice history before applying
admission-time/context filters. The tradeoff is an extra index entry and insertion
work per notice; this change does not itself establish a measured latency gain.

Conflict checks reuse the proposed party's current execution identities within
one operation. The original published actors remain historical evidence; they do
not replace the current tutor or learner when checking other commitments.

An unchanged warm publication checks the durable window and at most 1,000 visible
dirty event IDs, then returns without enumerating global pairings or published
assignments. A missing state row, implementation-version mismatch, timezone
change, Monday window change, Sunday preparation extension or any pending event
requires the existing source reconciliation and publication pass. Active tutors
can also trigger an explicit scheduling refresh (`sessionPlanning.refreshSchedule`
via the **Refresh scheduling** button in the agenda header), which re-checks active
tutor authorization and runs a forced reconciliation and publication pass under
the same period → room → planning fence without exposing global diagnostic counts.
Combining, splitting, expanding or shrinking a `PairingGroup` retires future
`REGULAR` plans whose captured assignment set no longer matches the current
teaching unit, closes their open requests as stale, and allows a later return to
that assignment shape to publish a new revision without reviving participant-cancelled
or already-started lessons. Recording attendance on an already-ended lesson and
already-agreed `EXTRA` sessions remain intact across later recurring group edits.
Clearing a pairing back to awaiting schedule suppresses its ordinary future
commitments while preserving explicitly agreed exceptions, and restores them if
re-confirmed. The pass keeps
the period → room → planning and source-row fences, current source validation,
45-minute calculation, continuation handling, synchronous calendar reconciliation
and transactional notice effects. Internal `normalized` and `unavailable` counter
semantics remain: a newly inserted conflict cancellation is counted on that call;
invalid groups and clocks still count on repeated calls.

Only the exact event IDs visible before a successful pass are acknowledged after
its notices succeed. A sequence's allocation order is not transaction commit
order; neither consumer acknowledges through `MAX(id)`. Publication's own dated
writes and a backlog exceeding the bounded ID batch can require further
no-change passes before the watermark is clean.
Concurrent or late-committing events remain pending. An event is removed only
after both publication and request-settlement consumers finish it.

The deadline sweep preserves the original due-first, `updatedAt`, then ID order,
200-request cap and visited-count return. Every visitor retains its independent
period/room/planning transaction, fresh source and recipient checks, timestamp
rotation and recovery journal effects. Pending requests therefore still incur
the full sweep cost; the principal warm-read saving is publication. A clean
metadata watermark never skips request validation or its original journal write.

Settlement metadata tracks completed checks without selecting or reordering
visitors. One invalidation batch captures at most 1,000 event IDs and pages current
open requests by stable ID, retaining at most 200 IDs. Successful checks remove
only that request from the queue in the same transaction. A failed notice rolls
back its complete decision and moves its bookkeeping to one deduplicated retry
event while retaining the original failure rotation. A permanently broken request
cannot pin the metadata page. Source events are acknowledged only when all pages
are exhausted; independent retry events remain until their current checks succeed.
Changes behind the cursor append separate events for a later batch. Missing or
obsolete settlement state discovers every current open request, even with an
empty event table. Terminal/deleted queue entries are pruned from their current
state. A sweep without bookkeeping avoids extra metadata acknowledgements but
still performs the original request work.

Agenda reads try the period → room → planning fence without waiting when they
prepare settlement bookkeeping. If another publisher owns any part of that set,
the short transaction releases its acquired prefix and leaves all dirty events,
batch state and retries intact. The reader still runs the same fresh due-first
candidate query and every selected request's blocking, independent authoritative
decision; only bookkeeping is deferred. Admitted metadata work still verifies
trigger integrity and propagates errors. Publication has already committed, so
a bookkeeping failure cannot roll its business rows or recovery journal back.
An uncontended agenda resumes the pending batch. The persistent Node delivery
worker also runs the blocking public sweep immediately and every 30 seconds,
including after publication catch-up failure, so sustained reader contention does
not turn cleanup or deadlines into opportunistic-only work. A running sweep is
not overlapped by another worker tick; this interval is not an exact completion
deadline under long work or database failure.

Deferred calendar/ordinary restoration remains discoverable: clearing a hold,
changing a response/request, removing a room block or changing a dated conflict
appends another publication event. Reconciliation still rechecks conflicts before
restoring a suppressed commitment. Mutations, attendance and reminders retain
their original fresh authorization and source checks; a clean watermark grants
no write authority and history-only readers do not start maintenance.

`scheduling_verify_maintenance_triggers()` checks the full dependency set before
either consumer trusts metadata. Missing, disabled, column-restricted,
conditional, deferred or wrong-function triggers fail closed, as does a connection
whose `session_replication_role` is not `origin`. It verifies the metadata repair
guards too. Apply the committed migration instead of bypassing that error.
`scheduling_metadata_deleted` observes deleted pending events through its transition
table; `scheduling_metadata_truncated` observes an event-table TRUNCATE. Both call
`scheduling_invalidate_deleted_metadata()` to obsolete the publication and
settlement versions, forcing rediscovery even when the state row remains. Normal
cleanup only deletes fully consumed events and does not invalidate the watermark.
Readers acquire `ACCESS SHARE` on both metadata relations before taking one
state/event snapshot, so a concurrent TRUNCATE cannot pair an old state with a
newly empty event table. Publication acknowledgement compares the captured
committed row's `xmin`; reset, deletion or recreation prevents that earlier pass
from certifying the replacement state. A missing state is inserted obsolete and
needs a later committed pass. Settlement bootstrap and page writes likewise
check the captured generation, and obsolete state forces rediscovery. Source
inserts remain compatible with these relation locks; no trigger acquires a
planning fence after holding metadata locks.
Opposite metadata row/table orders can still produce a PostgreSQL deadlock.
Database-only maintenance entrypoints retry a known aborted transaction at most
twice, always in a fresh whole transaction. They never retry a callback inside a
caller-owned transaction. Other failures propagate, and an external reset caller
must retry its own complete aborted transaction. Publication notices and recovery
changes roll back with the failed attempt; no mail is sent by these callbacks.
Clearing both exact metadata tables together also rebuilds both consumers on the
next read. Disabled-trigger imports and whole-database restoration require
clearing both metadata tables before returning the site to service.
Causal-recovery policy excludes only these exact
rebuildable tables, while source writes and recovery evidence retain their
original contracts.

## Agreements

Tutees suggest; active tutors formalize. A matching suggestion supplies agreement
only for the exact current lesson/version, participant, date, time and location.
Messages help coordinate but never constitute structured acceptance.

An individual request has at most three offers: tutor A, tutee B, tutor C.
Rejecting A or B requires an alternative. The tutee's final rejection cancels only
that dated commitment. Rejected extra-session proposals do not cancel the regular
lesson. No schedule transition creates attendance, absence cards or service hours.

For all-tutee requests, every required actor must agree to the same offer. Each
person can reject once; a counteroffer supersedes others' old consent. A person
whose rejection is spent may request a separate reschedule. This immediately
freezes the group request and its timers. The tutor formalizes individual child
requests; the recurring pairing group remains intact. Exact mutual agreement may
carry forward only after the individual conflict checks pass.
New proposals capture their scheduled audience in stable participant-ID order,
so an unordered database relation cannot change later split-child, recipient,
audit or recovery write order. Existing requests retain their captured audience
order; reading or splitting an older request does not rewrite that evidence.

Every response clock begins at essential-mail SMTP acceptance, not creation or
queueing. A resend never restarts it. Outside paused target dates, twenty-four
hours of silence accepts only when the complete interval ends before both the
original and proposed starts. Paused-date exceptions require affirmative acceptance.
Short-notice requests require explicit agreement before the earlier start;
unresolved requests expire and retain the original arrangement. Delivery failures
remain visible and block automatic acceptance. A server outage that misses an eligible
response deadline until after the cutoff never retroactively moves a started
session; a distinct essential notice identifies the missed deadline for review. See
[delivery and calendar contracts](session-planning-delivery.md).

## Extra-session cancellation

`sessionPlanning.proposeCancellation` captures an active tutor's exact scheduled
extra cohort/version, one or all currently scheduled participants, and a client
receipt key. A `CANCEL` planning request reuses immutable offers, per-person
responses, essential delivery clocks and settlement locks. Its offer retains the
existing date/time/location as evidence; it creates no replacement-room hold.
The original commitment stays effective while the request is pending. All required
responses must agree; a rejection closes the request with the lesson unchanged,
without a counteroffer or split. Existing short-notice, delivery and explicit
agreement rules still apply, and expiry preserves the lesson.

Agreement cancels only the selected participant commitments, clears reversible
calendar/pause suppression, increments calendar versions and cancels an empty
physical cohort. Weekly pairings, regular lessons, peers, attendance and hours
remain intact. Cancellation agreement cannot supply affirmative consent for a
paused-date lesson. The server rechecks ownership, active participation, source
version, request overlap and extra provenance, including rescheduled extras;
started or recorded lessons cannot enter or complete cancellation. The existing
receipt and transactional outbox prevent duplicate writes/notices, and calendar
subscriptions retain the original identities and cancellation evidence.

The retained agenda editor reuses arrangement's ONE/ALL selection and consequence
review without time/location editing. Request cards distinguish cancellation
from a time offer and expose acceptance or keeping the session. An accepted
submission with failed refresh offers reads only, preserving its receipt until
the agenda synchronizes.

**All** also exposes the nearest 300 scheduled future extras beyond the normal
two-week window as live cohorts, so they can be cancelled before entering
Upcoming. This is a bounded working set; farther extras remain read-only history
projections until they enter that set or the current window. Historical regular
lessons acquire no scheduling authority from this query.

## Attendance and permissions

The tutor agenda owns the retained wide attendance dialog. Its input identifies
the cohort and expected version. The server locks and validates the cohort, checks
its exact participant/subject snapshot, and records actual clocks. Extra and
rescheduled provenance comes from planning, while tutor/tutee attendance outcomes
remain explicit. A cohort-based immutable receipt prevents changed clocks from
earning a second credit; exact retries replay the original result. Planned records
do not inherit mutable catalog-slot links.

Legacy attendance payloads and historical corrections remain compatible. They are
not exposed as a generic future-planning form. Combining unrelated dated cohorts
is not supported; existing recurring combined pairing groups are materialized as
one cohort. Backfilling truly unplanned historical lessons remains a management
review rather than fabricated retroactive consent.

Historical CSV archives exclude `Session.planningCohortId` and all planning,
agreement, delivery and calendar-token tables. Imported attendance retains its
actual evidence without claiming authority over a live dated cohort. Database
backups retain these operational records; the generic record inspector does not
expose their private consent or capability data by default.

The scoped messaging composer permits only current tutor-to-assigned-tutee edges
and their reverse. Explicit messaging permissions, restrictions, departures and
account ownership remain authoritative. Opening the composer sends nothing;
ordinary message search gains no broader directory access.

## Verification boundaries

Scheduling computation reuses bounded timezone formatters. A publication operation
owns its successful wall-time parser and immutable indexed calendar snapshot;
returned dates and resolved days cannot mutate later results. The parser still
rejects missing/repeated DST clocks, and every lesson still validates its own
location and 45 elapsed minutes. These caches never retain permissions, ownership,
conflicts, consent or database rows between operations.

Publication batches generation-key reads per assignment unit (at most 21 dates),
including cancelled and moved plans. Conflict checks narrow pending offers by
strict UTC overlap, then select the request's exact current offer. Regular-plan
materialization reads use bounded batches, including cancelled/moved exceptions.
Room ranking builds one booking index while retaining canonical-person scoring,
group usage order and the final authoritative room check. Private calendar output
skips folding only when a complete line already fits within 75 UTF-8 bytes.

Continuation membership is read once per publication in batches of at most 500
distinct source pairing IDs. The period/planning fences also serialize its
writers; the operation-local set selects the continuation key scheme only when
every pairing in the group belongs to it. Partial groups keep ordinary keys.
Source reconciliation, consent evidence and conflict validation remain live.

Agenda reads still catch up publication and deadlines. The period, room, planning
and authority-row fences remain in force, including re-reads after waiting for
source locks. A worker interval or TTL cannot replace these checks without a
durable invalidation contract covering every source change.

An invalidation pass locks its union of source accounts, profiles and pairings in
the existing table order, then reloads source evidence in bounded batches. Each
plan still compares continuation assignments against its own creation time and
retains released-member provenance. This evidence lives only for that pass;
individual scheduling mutations retain their fresh source checks.

Fresh publication uses the immutable fields it just inserted instead of loading
the complete plan graph twice. Publication decisions and writes remain serial, so
each later lesson sees earlier reservations. A fresh parameterized statement per
candidate reads overlapping cohorts, exact current pending offers, calendar facts,
recurrences, materialized exceptions, canonical identities and room facts. Native
timestamp columns retain UTC instants; the shared TypeScript calendar resolver
still owns closures, makeup weekdays and tombstones. The existing decision logic
consumes this coherent snapshot only for initial publication. It never inserts
future candidate assignments early: their presence would incorrectly suppress
unmaterialized recurring commitments. Direct account links retain precedence over
retained profile aliases. Existing agreements and restoration keep their live
validation path.

The publication statement excludes recurring bookings outside the strict
45-minute overlap before loading their rosters and canonical ownership. It uses
the normalized duration, not a legacy pairing's stored end time; exact adjacency
remains available. Calendar hint validation and unfiltered fallback are retained.

The PostgreSQL adapter names only the fixed publication-validation statement,
using a hash of its complete SQL. PostgreSQL can reuse its prepared statement on
that connection; parameters and result rows are never cached. Changed SQL receives
a different name, while unrelated queries retain unnamed execution. Each
candidate still reads current database facts and earlier writes in its transaction.

Lifecycle notices resolve recipients in batches while retaining actor identities
and retained-owner precedence. Notice inserts preserve the first intent for each
dedupe key and leave existing queue receipts unchanged. They run under the
producer's planning fence, with normal unique/FK errors and recovery triggers;
they neither send mail nor change delivery eligibility or response clocks.
New non-actionable publication notices capture immutable audiences and schedule
facts at each decision, then resolve contact destinations and room names freshly
at transaction finalization. A finalization failure rolls back the publication.
Formal negotiation notices retain their response identities and existing timing.

### Request profiling and comparison contract

Local benchmarks (run from the repo root against a chosen baseline commit or the
dedicated loopback database `shbs_performance_test` on port `55439`, which is
truncated per fixture — never share it):

```sh
node scripts/benchmark-session-planning.mjs --baseline <commit> --output outputs/scheduling-profile/compute.json
node scripts/benchmark-room-allocation.mjs --baseline <commit> --output outputs/scheduling-profile/room-results.json
node --conditions=react-server --import tsx scripts/benchmark-session-publication.ts --scenario basic --output outputs/scheduling-profile/after-basic.json --compare outputs/scheduling-profile/baseline-basic.json
node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts --scenario warm --transport http --mode latency --samples 40 --anchor <ISO-instant> --output outputs/scheduling-profile/warm.json
```

CI runs [scheduling-profile.yml](../../.github/workflows/scheduling-profile.yml)
(`scripts/profile-scheduling-requests.ts` on Node 22 Linux + PostgreSQL 16):

- **Topology and population:** 11 checks — planning, 1 serial preflight (5
  prerequisite diagnostics), 8 scenario groups (`cold`, `warm`, `Sunday`,
  `negotiation`, `allocation`, `catalog`, `contention`, `backlog`; `max-parallel: 4`)
  and final aggregation across **60 latency partitions and 10 diagnostics**.
  Baseline and candidate run serially on the same runner with pristine checkouts,
  fresh databases and 7-minute per-partition budgets.
- **Dependency admission (early matrix gate):** Before clock deferral or Docker
  pulls, `scripts/scheduling-profile/evaluate-admission.mjs` inspects the
  immutable control(s) and candidate. Lockfile differences fail closed
  (`BLOCKED`) whenever any scheduling trigger path, runtime config file, file in
  the static scheduling import graph, non-dependency `package.json` field, or
  package in the transitive `package-lock.json` scheduling closure changes
  (requiring an independently reviewed immutable control with compatible locked
  dependencies). When programmatic inspection proves zero scheduling impact, a
  PR-scoped `.github/scheduling-profile-manifests/pr-<number>-admission.json`
  (or manual `admission-manifest`) pinning baseline/candidate hashes and sorted
  `changedPackages` emits a `NOT_APPLICABLE` receipt (`measured: false`,
  distinct from measured `PASS`) and skips workers and aggregation. `aggregate`
  runs only when `matrix` succeeds with `admission == 'ADMITTED'`.
- **Admission windows (Asia/Shanghai):** Campaigns admit only between
  **00:30–11:30** or **19:15–20:30** CST (reserving >=3 h before 14:30 / 23:30
  and respecting the 12-hour shared anchor). Outside these windows the workflow
  emits a `DEFERRED` receipt and skips workers — rerun the full workflow during
  an eligible window (`gh run rerun <run-id>`) and never treat a deferred run as
  a measured `PASS`.
- **Resuming failed partitions:** A transient bootstrap/install failure can be
  retried with `gh run rerun <run-id> --failed` while the original window still
  fits the worker budget; semantic mismatches, timeouts or missing seals fail
  closed and require a new campaign.
- **Schema overlays and parity:** Paired runs require byte-identical schemas or
  an explicitly reviewed manifest in `.github/scheduling-profile-manifests/`
  (`current.json` or `pr-<number>.json` + `pr-<number>-baseline.txt`, with
  optional `pr-<number>-catalog-baseline.txt`). `--capture-schema shared` checks
  v3 lossless graph parity across business records, receipts, notices, ordered
  recovery changes and fences (emitting `.parity-failure.json` on mismatch);
  `--capture-schema native-original` runs unpaired cold original-schema controls.
- **Locking and concurrency invariants:** Room creation/deletion acquires the
  catalog lock before the planned-room lock; per-room booking indices stay
  operation-local. See the
  [supplementary concurrency protocol](../../scripts/scheduling-concurrency/README.md)
  for overlapping cold/Sunday/proposal/settlement campaigns.
- **Verification:** [workflows.test.ts](../../src/server/session-planning/workflows.test.ts),
  [attendance-messaging.test.ts](../../src/server/session-planning/attendance-messaging.test.ts),
  and [verification requirements](../contributing/verification.md).

[Reference home](README.md).
