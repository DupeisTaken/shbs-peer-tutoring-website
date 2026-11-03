# Session planning

Recurring pairings describe teaching assignments. `SessionPlan` materializes one
dated lesson from that assignment, with immutable subject and roster snapshots.
`SessionPlanCohort` describes where and when a subset meets; each participant keeps
a stable `SessionPlanParticipant` identity as they move. Actual attendance remains
in `Session` and may have a different duration. The implementation lives in
[the planning service](../../src/server/session-planning/index.ts) and
[router](../../src/server/api/routers/session-planning.ts).

Tutors use one workspace at `/dashboard` and the compatible `/schedule` entry.
Schedule, Pairings, Preferences and History & hours are local panels. Each panel
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
or shown. Chair work remains independently owned beside the agenda; ordinary
panelists open their own reader and voting workflow. Preferences groups availability,
workload, willingness and qualifications without combining their saves. History
reuses the authorized personal tutor-history reader; existing historical access at
`/history` remains available independently of current participation policy.

**Sessions → Add Extra Session** selects an existing pairing's published future
session and participants before opening the existing extra-session proposal
editor. It requires active tutoring access and a usable published source. Selecting
the source neither submits a proposal nor changes a recurring assignment; the
existing 45-minute, agreement, version and conflict rules still govern submission.
An unavailable source leaves the action disabled; Pairings remains directly available in the workspace tabs.

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

[Workflow tests](../../src/server/session-planning/workflows.test.ts) exercise
the real transaction/state model against the guarded isolated test database.
[Attendance and messaging integration](../../src/server/session-planning/attendance-messaging.test.ts)
checks receipt replay, actual duration, split rosters, provenance and contact scope.
Transport and UI fixtures cover failures without sending mail to real recipients.
Use the repository's [verification requirements](../contributing/verification.md)
for schema agreement, complete regression checks and actual-page screenshots.

[Reference home](README.md).
