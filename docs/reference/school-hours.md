# Individual school service-hours reports

School reports tell recipients how many previously unreported hours to apply to
each individual's school account. Tutoring net and Crew hours form the highlighted
account amount; they are not additional amounts to apply again. Optional program
statistics are secondary. The normal tutor roster is unchanged, and the former
admin monthly overview controls and automatic delivery are retired. Existing
monthly snapshots remain historical evidence.
Stale clients cannot issue, preview, retry or reconfigure the retired workflow,
and pending legacy configuration proposals cannot reactivate it. Legacy delivery
admission retires unsent receipts even if an old configuration is still enabled.

## Source accounting and opening review

The [school reporting domain](../../src/server/school-hours.ts) owns a serialized
issue chain. Each individual's baseline freezes earned credit, extra credit,
deductions and stored Crew credit. Their next amount is the difference in earned
and extra credit, minus the difference in deductions, plus the difference in Crew
credit. Opposite changes on different people remain separate even when the
program-wide net is zero. Stored precision is retained; display rounding never
becomes a new source value.

The report month identifies the reporting occurrence, not a service-date filter.
Late attendance for earlier dates remains eligible, and school-calendar changes
do not reset the baseline. Recreated standing adjustments do not become new
credit or deductions merely because their database row IDs or creation times
changed. Valid corrections and reversals remain signed changes. Administrative
loss of ownership/evidence requires reconciliation rather than a silent reversal.

Before issuing the first report, Admin/Head review each person's school-account
reference and already-reported component amounts. Zero must be explicitly
reviewed; old monthly snapshots are not a sufficient opening baseline. New
unreviewed identities block issuance until reviewed. Once reports exist, review
cannot overwrite already committed balances for existing people.

Tutoring and Crew sources are attributed through explicit current/retained
ownership and account-retirement history, never matching names, email or directory
grouping. Distinct people with the same name remain distinct. Ambiguous ownership
or account mapping blocks generation. Crew uses recorded patrol hours rather than
today's hourly rate. There is no separate invented Crew deduction ledger.

## Immutable issues and corrections

A coherent transaction verifies the expected configuration, opening baseline,
source content and predecessor, then saves the snapshot, advances the chain and
queues one receipt per recipient. Preview and download are read-only. Retrying a
request uses its receipt; retrying email uses the saved edition and does not
recalculate credit or advance the chain. Reports describe source credit and never
write to external school accounts.

Only the current head month's report can be revised. A revision identifies the
replaced edition and shows each affected person's incremental correction alongside
the revised monthly amount. If Alex's original +7 hours were already applied,
a revision to +7.5 requires only +0.5 more. If not yet applied, use +7.5 once.
Each revision also lists the correction from every earlier edition of that month.
If a third edition is +7.7, a recipient who applied the first +7 uses +0.7;
one who applied the second +7.5 uses +0.2. Select only the comparison matching
the last applied edition. If that edition is unknown, reconcile before posting.
Unchanged people must not be credited again. After a later month is issued,
corrections enter the next report against the current chain head; an ancestor's
financial baseline cannot be rewritten.

Reported means included in a committed school report. Delivery receipts show mail
status, not confirmation that school staff posted hours to accounts. SMTP cannot
guarantee exactly-once delivery after provider acceptance followed by a crash.
Frozen report identity and stable Message-ID identify a retry; recipients still
apply each individual's report amount once.

## Scheduling and delivery

The default is noon on the last calendar day of the month in the saved program
timezone. Administrators can override individual occurrence dates within their
labelled calendar month. Changes after
an issue's cutoff remain eligible for the next issue. A reschedule cannot issue an
already-issued automatic occurrence again. Disabled intervals do not discard
unreported source changes.

The [persistent worker](../../src/server/school-hours-worker.ts) performs bounded
due work at startup and once per minute. PostgreSQL retains the schedule cursor,
chain and outbox across restarts. The shared dispatcher uses fenced attempts and
bounded retries; no SMTP call runs inside the reporting transaction.

Recipients are explicitly configured school mailboxes and need not have site
accounts. Each receives a separate consolidated email; recipient addresses are
not included in the shared report. The Service Hours module, schedule, global
program-mail switch and PROGRAM transport govern sending. Mail-off blocks school
delivery without treating the report as newly unreported; retry the same receipt
after restoring availability. Removed recipients, revoked links and superseded
editions are not silently retargeted or resent as current.

## Link-only retrieval and names

The [link helper](../../src/server/school-hours-link.ts) creates a purpose-separated
capability from the report ID, link version and AUTH_SECRET. Only its digest is
stored; retries reproduce the same token. Revocation or reissue invalidates prior
links. Protect AUTH_SECRET and review existing links when rotating it.

The public HTML/CSV handlers authorize exactly one saved report by capability,
without a login or email-verification step. A stale site cookie cannot prevent
access. Responses are private/no-store, no-referrer and noindex. The projection
contains report metadata, frozen export names, school-account references and
individual hours; it excludes source identifiers, recipient lists, tutee details,
patrol observations and private adjustment reasons. Anyone possessing the link
can read that report, so recipients must limit sharing.

Export names default to `Legal First "Nickname" Legal Last (Another Language)`.
Absent optional parts are omitted; unconfirmed or unsplit legacy names remain
intact instead of guessing legal parts from display labels. Names and identity
provenance are frozen with the edition. CSV uses the shared quoting, Unicode and
formula-protection helper.

## Authority and deployment

Admin, Head and Coordinator can inspect management previews and reports; Viewer
and participant roles cannot. Admin/Head apply settings directly; Coordinators
propose settings changes for review. Opening-baseline review, issuance, retry and
link management require direct Admin/Head authority. Public capabilities confer
no management or write access.

Apply all three migrations through `20261031030000_school_hours_context_guard`
and regenerate Prisma before starting the updated application. The first migration
adds the school reporting tables
and outbox relation, disables the replaced monthly schedule and retires unsent
overview receipts while preserving sent evidence. The two follow-up migrations
permit only the narrowly scoped external school
delivery shape and forbid request-specific context on those receipts.
Automation starts disabled; review opening balances and configure recipients
before activation. No new
environment secret is required. Persistent Node hosting is required for automatic
sending; real SMTP/inbox readiness must be verified on the intended deployment.

See the [staff guide](../guides/user-guide.md) and
[deployment procedure](../guides/deployment.md#monthly-service-hours-delivery).
