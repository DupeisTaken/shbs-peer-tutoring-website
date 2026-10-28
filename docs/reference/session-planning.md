# Session planning

Recurring pairings describe teaching assignments. `SessionPlan` materializes one
dated lesson from that assignment, with immutable subject and roster snapshots.
`SessionPlanCohort` describes where and when a subset meets; each participant keeps
a stable `SessionPlanParticipant` identity as they move. Actual attendance remains
in `Session` and may have a different duration. The implementation lives in
[the planning service](../../src/server/session-planning/index.ts) and
[router](../../src/server/api/routers/session-planning.ts).

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

[Workflow tests](../../src/server/session-planning/workflows.test.ts) exercise
the real transaction/state model against the guarded isolated test database.
[Attendance and messaging integration](../../src/server/session-planning/attendance-messaging.test.ts)
checks receipt replay, actual duration, split rosters, provenance and contact scope.
Transport and UI fixtures cover failures without sending mail to real recipients.
Use the repository's [verification requirements](../contributing/verification.md)
for schema agreement, complete regression checks and actual-page screenshots.

[Reference home](README.md).
