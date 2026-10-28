# Monthly service-hours reports

The **Service Hours → Monthly reports** controls configure one consolidated
report for selected current Admin/Head accounts. Automation is off by default.
Admin and Head apply configuration changes; Coordinators submit proposals for
Admin/Head review. Generation and retry are direct Admin/Head operations. Staff
may inspect saved reports and download their CSV; participant and Viewer roles
cannot read the configuration, audience or saved reports.

## Accounting and immutable evidence

The [shared aggregation](../../src/server/service-hours-summary.ts) reads stored
session credits and adjustments for exactly one `YYYY-MM` bucket. Those buckets
use the existing UTC accounting convention; the schedule timezone does not
rebucket historical records or recalculate past credit policy. Session counts
count saved session rows, including combined-session siblings, rather than
distinct physical meetings. Crew hours remain separate.

Every tutor with a session or adjustment is included, regardless of current
status or the page's filters. Zero-credit sessions, zero-valued adjustments,
deductions-only and offset-zero totals remain evidence. Distinct tutor IDs are
preserved when names match. Report content excludes students, contact details
and adjustment reasons.

`MonthlyHoursReport` freezes rows, totals, reporting month, revision, generation
time, due time, timezone, configuration version and intended audience. Its
authenticated page and CSV read that saved snapshot. A late correction changes
future previews but not previous reports. Generating a revised report requires
an explicit reason and creates the next revision. Preview hashes include the
reviewed content and audience; a changed preview or configuration requires a
fresh review. Actor-bound request IDs recover successful generation after a
lost response without producing another report.

## Schedule and transaction boundaries

`MonthlyHoursSchedule` owns a versioned configuration independently of program
settings. Defaults are the third day at 09:00 in the program timezone; the saved
timezone changes only when explicitly edited. Send days are limited to 1–28.
Repeated local clock times use the earlier occurrence; nonexistent clock times
advance to the first real minute after the gap.
The due instant is never earlier than the UTC accounting bucket's end. For
example, day 1 at 00:00 in Shanghai waits until 08:00 local time; the displayed
next due time includes that wait. Manual previews/generation also require the
month to have ended in both the schedule timezone and UTC.

Activation selects the first future send and its preceding reporting month.
Disabling clears the cursor; re-enabling does not backfill the disabled interval.
Historical generation is an explicit reviewed action. While enabled, configuration
edits retain the next reporting month, including an overdue occurrence. Changing
the clock recalculates its due time but never duplicates a materialized month.

The Node worker checks once on startup and once per minute. Each sweep processes
at most one due month. The database cursor, not the timer, owns the schedule;
successive sweeps catch up enabled-period outages. Such a report reflects the
source data when it is actually generated and cannot reconstruct overwritten
data as it existed before an outage.

The [domain implementation](../../src/server/monthly-hours.ts) generates a coherent
snapshot and all delivery receipts in one repeatable-read transaction. The
schedule lock and unique `(scheduleId, month, revision)` key coordinate workers;
automatic generation creates only revision 1. A manually generated first revision
also satisfies that automatic occurrence. No SMTP call runs inside this transaction.
The domain owns explicit aggregate audit entries rather than capturing report
rows as generic audit diffs. Configuration proposals capture the separate
configuration version and current recipient eligibility for stale-review refusal.

## Delivery and recovery

Each selected account receives the consolidated report at its verified primary
address and any verified secondary addresses permitted by its existing preference.
Normalized duplicate mailboxes are suppressed. One immutable report/mailbox
receipt prevents ordinary duplicate queueing, and each transport call addresses
only one mailbox. HTML and plain text contain the month, generation information,
totals, tutor rows and authenticated report link; CSV is downloaded after sign-in.

Monthly reports are optional PROGRAM mail. They respect the global optional-mail
switch and information-email preference. Before admitting a send, the worker
checks current staff role, account state, address ownership/verification, schedule
membership, effective Service Hours feature and enabled schedule. Removed or
ineligible recipients are skipped. Missing mailboxes or transport readiness are
shown as blocked outcomes. These checks cannot recall SMTP already admitted.

The existing dispatcher leases bounded batches and retries transport failures
with its normal backoff and attempt limit. Fenced admission and completion retain
the candidate lease and attempt identity. Retry operates on existing failed or
retrying deliveries and retains the snapshot, recipient and stable Message-ID;
it does not rebuild the report or add recipients. A transport-blocked receipt can
be retried once the same frozen mailbox is eligible again; a missing-address
receipt is never retargeted to a newly added mailbox. Sent/skipped receipts are not
requeued. If the saved write succeeded but the screen refresh failed, refresh
status rather than repeating generation.

SMTP cannot guarantee exactly-once delivery after a crash between provider
acceptance and recording success. The immutable snapshot and stable Message-ID
make retries identifiable; they do not remove that transport limitation.

## Operations

Apply `20261030010000_monthly_service_hours` and regenerate Prisma before starting
the updated app. This adds the schedule, reports and nullable outbox relation;
existing notification receipts remain intact. No new secret or environment
variable is required. Use the existing PROGRAM sender configuration.

The shipped integration requires a persistent Node process, as in the supplied
Docker deployment. A short-lived host needs a separately operated persistent
worker; this feature does not expose a public scheduler endpoint. Inspect the
page's next due time, last generation error and per-report delivery outcomes.
Verify actual sender/inbox delivery separately on the intended deployment before
enabling its schedule. Synthetic transport tests establish application behavior,
not production SMTP readiness.

See [deployment](../guides/deployment.md#monthly-service-hours-delivery),
[staff usage](../guides/user-guide.md) and the
[technical reference](technical-report.md).
