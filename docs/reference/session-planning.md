# Session planning

Recurring pairings describe teaching assignments. `SessionPlan` materializes one
dated lesson from that assignment, with immutable subject and roster snapshots.
`SessionPlanCohort` describes where and when a subset meets; each participant keeps
a stable `SessionPlanParticipant` identity as they move. Actual attendance remains
in `Session` and may have a different duration. The implementation lives in
[the planning service](../../src/server/session-planning/index.ts) and
[router](../../src/server/api/routers/session-planning.ts).

Tutors open dated tutoring and its attendance workflow in `/schedule#sessions`,
alongside their independently authorized interview and meeting appointments.
Recurring pairing setup remains on the dashboard. The tutee agenda remains at
`/student?view=schedule#sessions`; sharing the tutor's presentation does not change
the tutee route, planning permissions or source-owned writes.

## Tutor Schedule workspace

[Schedule](<../../src/app/(tutor)/_components/tutor-schedule.tsx>) starts with
Interviews, Meetings, Sessions and Upcoming summaries. Feature-disabled interviews
and meetings are neither queried nor shown. Pairings remains expanded on the
dashboard, alongside the chair's interview workspace; an assigned chair's personal
appointment still appears in Schedule and links back to that workspace. Ordinary
panelists deliberately open their own interview reader and voting workflow.

**Sessions → Add Extra Session** selects an existing pairing's published future
session and participants before opening the existing extra-session proposal
editor. It requires active tutoring access and a usable published source. Selecting
the source neither submits a proposal nor changes a recurring assignment; the
existing 45-minute, agreement, version and conflict rules still govern submission.
An unavailable source leaves the action disabled and provides a Pairings link.

**Upcoming** previews up to three distinct unresolved items across the personal
sources. Items requiring action come first, most recent first; other commitments
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
`/student#school-calendar/YYYY-MM-DD`. Old dashboard room/calendar fragments offer
an explicit continuation retaining the validated date; they never automatically
unmount a live dashboard editor.

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

## Publication and existing data

The visible school-timezone window is Monday–Sunday for the current and next week.
On Sunday the bounded background worker prepares the following window; agenda
reads catch up under the same database lock. Generation keys make repeated
publication idempotent. An initial publication does not invent ended lessons.
Previously published, ended lessons remain available for attendance beyond the
visible window. Existing attendance and historical durations are not rewritten.

Every new plan derives an end exactly 45 minutes after its start. Older recurring
slots may retain their historical duration; the agenda flags their normalization.
The source start stays fixed. Unscheduled or invalid combined groups remain
unavailable until repaired. Effective dated exceptions and current proposals take
part in conflict checks. School closures suppress ordinary recurrence; explicitly
agreed sessions remain commitments. The school-calendar mapping adapter reads
the owning calendar's effective weekday and semantic revision.
Semantic calendar saves and resets reconcile future plans in the same transaction,
using the shared period, room and planning locks. A closure saved before a lesson
starts cannot remain attendance-eligible just because the first agenda read occurs
after its start; retrospective edits preserve already-started evidence.
Individual `scheduleOverride` provenance preserves an explicitly agreed learner
who returns to an ordinary shared cohort. `calendarSuppressed` distinguishes an
ordinary commitment that may be restored on reset from a user/lifecycle
cancellation. Restoration rechecks conflicts; exact matching cohorts coalesce
and emptied physical cohorts retain cancellation evidence for subscriptions.
Calendar-change notices include current live proposal recipients on the target
date, even when no confirmed lesson or recurring assignment exists there yet.
Superseded offers, elapsed cutoffs and terminal requests do not expand that audience.

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
| `SchoolDeparture`, `PolicyAcceptance` | Current participation and the policy evidence consumed by dual-role learner admission |
| `StudentContinuationPairing`, `StudentContinuationAssignment` | Continuation identity, current status, target pairing and assignment/release instants |
| `SessionPlanContinuationMember`, `SessionPlanAssignment` | Supplemental enrollment/release and original published assignment/roster evidence |
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

Conflict checks reuse the proposed party's current execution identities within
one operation. The original published actors remain historical evidence; they do
not replace the current tutor or learner when checking other commitments.

An unchanged warm publication checks the durable window and at most 1,000 visible
dirty event IDs, then returns without enumerating global pairings or published
assignments. A missing state row, implementation-version mismatch, timezone
change, Monday window change, Sunday preparation extension or any pending event
requires the existing source reconciliation and publication pass. The pass keeps
the period → room → planning and source-row fences, current source validation,
45-minute calculation, continuation handling, synchronous calendar reconciliation
and transactional notice effects. Original `normalized` and `unavailable` counter
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
queueing. A resend never restarts it. Twenty-four hours of silence accepts only
when the complete interval ends before both the original and proposed starts.
Short-notice requests require explicit agreement before the earlier start;
unresolved requests expire and retain the original arrangement. Delivery failures
remain visible and block automatic acceptance. A server outage that misses an eligible
response deadline until after the cutoff never retroactively moves a started
session; a distinct essential notice identifies the missed deadline for review. See
[delivery and calendar contracts](session-planning-delivery.md).

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

Run the source-comparison benchmarks from the repository root, choosing the
unoptimized scheduling commit that is the optimization branch's base:

```sh
node scripts/benchmark-session-planning.mjs --baseline <commit> --output outputs/language-performance/implementation/compute.json
node scripts/benchmark-room-allocation.mjs --baseline <commit> --output outputs/language-performance/implementation/room-results.json
```

The compute harness compares complete values, errors, calendar bytes and schedule
fingerprints from actual source before timing synthetic workloads. It distinguishes
fresh module formatter caches from warmed caches; operation caches start empty in
both modes. The room harness includes allocator computation with immediate mock
reads and explicit guard stubs. Neither measures network, rendering, real database
latency, lock contention or a website-wide speedup. Preserve the emitted revisions,
source hashes, runtime, sample ranges and scope alongside any reported medians.

The PostgreSQL domain benchmark is `scripts/benchmark-session-publication.ts`.
It requires an explicitly owned loopback database on port 55439 named
`shbs_performance_test`, with this checkout's complete migrations already applied.
It **truncates that database** for each synthetic fixture; never use a database
owned by another task. Run baseline and changed sources serially with the exact
same script, runtime, migrations and scenario:

```sh
node --conditions=react-server --import tsx scripts/benchmark-session-publication.ts --scenario basic --output outputs/scheduling-performance/baseline-basic.json
node --conditions=react-server --import tsx scripts/benchmark-session-publication.ts --scenario basic --output outputs/scheduling-performance/after-basic.json --compare outputs/scheduling-performance/baseline-basic.json
```

Repeat with `--scenario rooms` and separate result paths for 100 assigned rooms.
The script checks complete normalized publication/agenda results, migration
checksums and source stability. One warmup and five measured samples establish
illustrative medians/ranges and query counts, not production p95. Locks and
recovery triggers execute normally, but the fixture has no competing requests,
negotiations, HTTP, rendering or SMTP. Recovery journal semantics and concurrent
publication require the domain tests in addition to benchmark output parity.

### Request profiling and comparison contract

The dedicated [request-profile workflow](../../.github/workflows/scheduling-profile.yml)
runs `scripts/profile-scheduling-requests.ts` on Node 22 Linux against its own
PostgreSQL service. Cold publication, warm agendas, Sunday catch-up, negotiation,
allocation, catalog reads and competing requests each have separate latency and
diagnostic jobs. Baseline and candidate run serially on the same runner with the
same synthetic fixture, harness, anchor, dependency lockfile and database schema.
The job reserves time for evidence upload and fails on exhausted budgets; partial
samples do not count as passing evidence.

The matrix admits all workers into one interval on the same Shanghai calendar
date. Start a campaign between **00:30–11:30** or **19:15–20:30** Shanghai time.
Admission reserves at least three hours before 14:30 or 23:30 respectively. The
command deadline is also limited by the shared anchor's twelve-hour lifetime.
These limits apply on weekdays, Sundays, calendar closures and makeup days.
Outside either start window, the matrix writes a `DEFERRED` receipt with the
next eligible UTC instant. It skips measurements and the aggregate. No runner
waits for that instant. Check the account queue and confirm the PR still has
the recorded head, then run `gh run rerun <deferred-run-id> --repo <owner/repo>`
during an eligible window. Rerun the entire deferred workflow because it has no
measurement jobs to resume. This preserves the original PR event and its scoped
baseline and catalog pins. A successful deferral job cannot establish
performance acceptance. Require the complete `PASS` aggregate for the current
head and successfully completed measurement jobs in the admitted attempt.

The worker's phase receipts record the static command label, elapsed time, exit
status and remaining phase budget. Only the initial disposable Alpine package
setup may retry once. Each attempt has at most 30 seconds and both share a
60-second ceiling under the worker's existing deadline. The first failure
remains in the terminal receipt even when the retry succeeds. A failed
migration, comparison, timing command or parity check ends that worker.

The special workflow caps preflight at two runners and the remaining matrix at
four per PR. Three admitted PRs can use twelve profiling jobs. Run required CI
ahead of a coordinated campaign and check the account queue for other work. A delayed worker that cannot fit its
entire command budget must fail before timing starts. Each worker records the
actual Node and PostgreSQL clock ranges. Aggregation verifies those ranges
against the same interval for latency, diagnostics and original-schema trials.

This preserves the real HTTP and database clocks. The synthetic timetable has
15:00 starts, later alternate and proposed slots, and 45-minute lessons. A
15:00 crossing in the original comparison changed two notice-availability
relations even though every persisted table matched. Both relations remain in
the complete-history comparison. The midnight buffer keeps every real-time
request in its original planning day, including the Sunday preparation and
Monday visibility transition. The deadline-specific negotiation fixture picks
an already scheduled cohort with room for the full 24-hour response window.
It still checks the actual persisted deadline at one millisecond before expiry
and at equality.

The comparison helper rejects changed historical migrations or domain models.
It permits only the exact appended maintenance models and their additive migration
to be overlaid on the baseline. The baseline application source stays unchanged.
This shared-schema control includes the new triggers' cost on both revisions; a
separately labelled native-schema cold baseline records the original schema too.
Later comparisons with byte-identical schemas and migration chains require no
overlay or native-schema control. Unrelated schema changes still fail closed.
For a combined-feature run, manual dispatch may select an explicitly reviewed
manifest under `.github/scheduling-profile-manifests/`. Without that input, the
workflow selects the integration owner's reviewed `current.json` in that folder
when it exists, allowing combined proof on a pull request before the workflow
reaches the default branch. This convention does not authorize broader schema
changes: the committed file still requires review and must bind the exact
baseline/candidate schema hashes, dependency lockfile, complete historical
migration inventory and added migration paths/hashes. Every unlisted difference
is rejected; the selected path, manifest and its hash accompany the evidence. Such a control
is labelled as running the baseline application under the candidate schema.
The historical inventory accepts the repository's exact `0_init` bootstrap;
new overlay migrations still require timestamped paths.
Scenarios unavailable in the baseline need separate candidate evidence, without
a baseline parity or speedup claim.
An integration branch may also commit a reviewed
`.github/scheduling-profile-manifests/baseline.txt` containing exactly one
40-character lowercase commit SHA, optionally followed by LF. The workflow reads
it from the immutable candidate checkout before checking out the baseline, and
requires an exact schema manifest for that override. Manual baseline input takes
precedence. Receipts retain the selected SHA, selection path and file hash; a
moving branch name or an unbound schema delta is never accepted. This supports
comparison to the original pre-integration source even when a PR is stacked.
A single pull request can use a named control without pinning future pull
requests. Commit a matching pair in that directory: `pr-<number>-baseline.txt`
and `pr-<number>.json`. Only the corresponding PR selects the pair; both files
are required. Manual selection takes precedence and the existing integration
fallback still applies when there is no matching pair.

PR #569 uses the **original-plus-roster-order** control
(`223a1b213a7a5167187b057d08a349d30f0087ad`). Its only parent is the
frozen original `c113b8efbbfe0c350dc8c0d09aec92c48777d9c6`.
Only the new proposal roster capture in `src/server/session-planning/index.ts`
differs. The control has no scheduling optimizations or schema, test or
dependency changes. Its native-schema cold measurements still use the
roster-corrected source. Historical measurements and failed comparisons of
the unmodified original remain separate and must not be pooled with this
control. This choice does not change ordered audit or recovery comparisons.

The scoped pair may also include `pr-<number>-catalog-baseline.txt`, with a
distinct immutable commit and a trailing LF. Only the catalog diagnostic and
its ten latency partitions use that pin. Other scenarios continue to use
the primary baseline, including the cold original-schema observations. Both
controls use the same reviewed schema manifest. The aggregate records the
baseline by scenario and validates source preservation separately for each.

For PR #569 the catalog source control is
`c3947f096a1cf1eb33c02948d0385d46d6838d77`, directly descended from
`223a1b213a7a5167187b057d08a349d30f0087ad`. Its only changed paths are
`src/server/room-allocation.ts` and `src/server/ordered-pairing-release.ts`.
The candidate schema overlay supplies
`20261103031000_order_group_room_version_journal` to both revisions in
shared-schema measurements. The original-schema cold control still measures
the roster-corrected source on its historical database. Preserve separate
pre-repair measurements when discussing the cost of the catalog correction.

PR #568 uses the same two source controls with its own ten-addition reviewed manifest. Its catalog-specific pin is `pr-568-catalog-baseline.txt`. Non-catalog workloads keep `pr-568-baseline.txt`. PR #569 uses its separate two-addition manifest. Unrelated pull requests without a scoped pair use their own base. The combined identity/recovery v3 projections and native-original contract are verified separately in PR #570.

Artifacts retain source hashes, overlay paths, migration checksums, runtime,
individual samples, errors and normalized output comparisons.

HTTP mode uses the production tRPC router through the standalone HTTP adapter,
the real client serializer and current authorization middleware. Synthetic opaque
cookie capabilities replace the login exchange. It measures actual loopback HTTP,
database queries and transactions, but excludes Next ingress/proxy, Auth.js login,
TLS, browser rendering and SMTP. The harness selects the official `server-only`
server entry with an exact-specifier module hook; React and Auth.js keep their
normal resolution. Invoke it with both preloads:

```sh
node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts --scenario warm --transport http --mode latency --samples 40 --anchor <shared-ISO-instant> --output outputs/scheduling-profile/warm.json
```

The database guard requires the explicitly owned loopback port 55439 and database
`shbs_performance_test`, without URL overrides. The harness truncates its public
fixture tables without CASCADE and rejects cross-schema dependencies. It never
loads dotenv configuration or sends mail. Do not run it against a shared database.

Latency mode reports raw samples and nearest-rank empirical p50/p95 after a
discarded warmup: 20 rounds for cold/Sunday and 40 for other workflow scenarios.
The hosted workflow divides this complete population into contiguous four-round
partitions, each with its own discarded process warmup. One fixed anchor and
immutable Node image cover the run. Each baseline/candidate pair stays serial on
one runner; up to four independent hosted jobs may run concurrently. This changes
queueing capacity, not sample populations, per-runner limits or paired measurement
order; available repository capacity may still queue jobs. Native-schema cold
controls use the same four-round ranges and aggregate separately to 20 samples.
Pure helper tests gate matrix preparation in the same two-CPU, 4 GB Node
container before measurement runners start. Five diagnostic preflights each run three rounds per revision: negotiation,
allocation, catalog, and the two controlled contention orders. They gate
the 60 original latency partitions and five other diagnostics. A shared
worker runs all 70 measurement jobs. Two controlled preflight jobs are
additional to the original 68; the original latency population is unchanged.
Final acceptance requires both phases, so a preflight pass alone is not evidence
of complete latency coverage.
The 90-second native, 150-second ordinary command and whole-job budgets remain
fatal; partitioning never accepts a partial population or reduces sample counts.

Both contention controls execute the entire ordinary contention fixture. After
the shared prelude, a controller holds the planned-room fence while the first
request owns the period fence. PostgreSQL must show the other request blocked
on that first backend before the controller releases its hold. Each successful
schedule supplies a complete reference graph for the same shared anchor and
source revisions. The two diagnostic scenarios retain their controller setup and wait observations separately.

The 40 free-running rounds continue to start both requests together. A narrow
witness records the completion of their actual period-fence acquisitions inside
their transactions. Raw audit IDs, persisted creation timestamps and ties are
recorded separately. Each full observed history must equal one validated
reference graph. When persisted audit chronology differs from acquisition order,
the alternate history also requires proof that the two references differ only
in the position of the intact allocator audit entry relative to the intact
three-row response block. The aggregate records counts and durations by
observed acquisition order, including empty strata and differing paired orders.
Unknown business, clock, audit or recovery data fails comparison and retains
the full snapshot. Historical failed runs keep their original result.

Partition receipts contain raw observations and complete canonicalization for
every round, but do not report eligible latency percentiles. The aggregation
helper requires all seven scenarios, exact disjoint round coverage, matching
source/harness/schema contracts, paired runtime identity, uncensored completed
samples and successful paired semantic checks. It retains runner identities and
paired comparisons. Pooled percentiles describe these hosted-runner observations;
they are neither one host's repeated experiment nor production p95. Hardware and
cloud variance between partitions remain explicit. All diagnostic jobs must also
pass the workflow gate. Rerun the complete workflow attempt when collecting a new
partition population; earlier attempts' failure artifacts remain separate.
A repeated-state failure in the immutable baseline remains failed evidence even
when a candidate fixes its cause. Do not sort away stored arrays, audit writes
or recovery ordinals, or silently patch baseline application files. Any separately
named correctness control requires explicit comparison-scope review and an exact
immutable source revision; it cannot retroactively certify the original run.

Cold means empty planning tables, not a restarted OS or database. Diagnostic
runs are separate and report query counts/time, advisory acquisition elapsed and
observed transaction-held intervals through commit. These intervals include driver
and transport overhead; CPU and event-loop figures are process-wide and overlap
under contention. They are not exact PostgreSQL wait accounting. Explicit domain
clocks used for Sunday and deadline cases are labelled separately.

Unfinished operations remain in timeout receipts as censored elapsed lower bounds,
with explicit unfinished/error counts. They are excluded from completed p50/p95;
partial or timed-out runs cannot establish latency gains. Completed failures remain
in completed elapsed samples and are counted separately.

The explicit `backlog` scenario is diagnostic-only, runs one to three rounds with
no warmup, and is excluded from `--scenario all`. It exercises 205 open requests,
the original ordered 200-request cap, 60 scoped notice failures followed by
recovery, and 1,200 genuine room updates. An isolated SQL observer retains raw
ordered timestamp writes and checks the exact open-request rotation clock plus
terminal timestamps against the operation window. Instrumentation is removed in
`finally`. These stress observations report no request latency percentiles and
do not represent production traffic.

Room creation and deletion take the catalog lock before the planned-room lock.
An allocator holding the latter therefore sees stable catalog membership through
its serial decisions. The per-room booking index stays operation-local. Bulk-wide
canonical ownership reuse is deliberately deferred: the planned-room lock does
not freeze all ownership writers, so such reuse needs a separate freshness proof
and measured benefit. Final room conflict checks remain live.

Parity checks cover business records, receipts, notices, ordered recovery changes
and fences. Generated identifiers require unambiguous witnesses, and receipt
hashes must match their exact inputs before canonical comparison. Synthetic
setup rows, including the allocation scenario's room unavailability, use stable
fixture IDs; all their fields remain in parity. API-created records retain their
generated IDs and require explicit semantic witnesses. The normalization format is version 2: compact references point to a retained
dictionary of full semantic identities, with compact edges to parent identities.
This lossless graph encoding of normalized identities prevents repeated escaping
of nested parent strings from exhausting the artifact size. It retains all
selected rows, stored JSON and ordering witnesses; cycles, ambiguous identities
and unresolved generated references fail the run. Full graph comparisons emit
bounded failure messages; they do not expand entire snapshots into assertion
diffs. Before a repeated-fixture or paired digest mismatch throws, the harness
writes the actual failed snapshot, operation inputs/windows and digests to a
separate `.parity-failure.json` artifact. Its bounded first-difference summary
uses deterministic JSON-pointer paths and explicitly marks diagnostic truncation;
it never decides equality. The failed round is not a completed receipt. Aggregation
rejects retained failure snapshots even if another report claims PASS. Raw
snapshots remain available in the paired artifacts. The sequential
late-root witness preserves two participant journal changes and fence revision
two; combining cohort and participant writes into one SQL statement remains
unsupported. Under-one-second first publication is a target to verify from a
passing supported-runtime result, not a property established by this harness's
presence or by earlier Windows measurements.
Persistence `createdAt`/`updatedAt` values are omitted recursively, including in
journal snapshots and procedure results. Continuation creation boundaries and
sweep selection/rotation therefore need separate semantic witnesses. This is
normalized output parity, not byte-identical full journal content. The native
original-schema control currently covers cold publication only; other shared-schema
comparisons isolate application changes and do not establish whole-rollout gains
including new trigger overhead.

[Workflow tests](../../src/server/session-planning/workflows.test.ts) exercise
the real transaction/state model against the guarded isolated test database.
[Attendance and messaging integration](../../src/server/session-planning/attendance-messaging.test.ts)
checks receipt replay, actual duration, split rosters, provenance and contact scope.
Transport and UI fixtures cover failures without sending mail to real recipients.
Use the repository's [verification requirements](../contributing/verification.md)
for schema agreement, complete regression checks and actual-page screenshots.

[Reference home](README.md).
