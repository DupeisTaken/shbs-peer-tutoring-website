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

Management previews and saved reports use a sortable table on wider screens and
individual cards on narrow screens. Each card keeps the person's name, account
reference and exact amount together, with tutoring/Crew breakdowns and the same
details dialog. Both layouts share correction instructions; printed output uses
only the table.

## Source accounting and opening review

The [school reporting domain](../../src/server/school-hours.ts) owns a serialized
issue chain. Each individual's baseline freezes earned credit, extra credit,
deductions and stored Crew credit. Their next amount is the difference in earned
and extra credit, minus the difference in deductions, plus the difference in Crew
credit. Opposite changes on different people remain separate even when the
program-wide net is zero. Stored precision is retained; display rounding never
becomes a new source value. Lengthy values have an explicitly approximate summary
using the existing four-decimal display convention. Management and the saved public report keep the exact posting value beside that
summary; CSV retains the exact numeric value. Email shows each person’s exact signed
posting amount once, without approximate duplicates, component breakdowns or
previous/replacement tables. Those details remain in the linked report and CSV.
Long exact values use smaller type to keep the complete number and unit together;
ordinary amounts retain their normal emphasis. No value is rounded or truncated.
Opening-review summaries
keep exact source amounts in screen-reader text and the evidence dialog, without
rounding the editable already-reported values. Tiny nonzero amounts never appear
as zero. Neither repeating fractions nor floating-point tails are silently
reclassified as accounting errors, and saved snapshots are not rewritten.

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
The saved report lists the correction from every earlier edition of that month.
A revision email prominently limits its displayed changes to people whose last
entered edition was the immediately previous one. Earlier-edition, never-entered
and unknown-edition recipients must open the report or reconcile before posting.
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
accounts. Each receives a separate consolidated email. An exact verified address in the
account-email registry uses that account’s saved email language; addresses without
a verified, non-retired account default to English. This presentation-only lookup
never attributes school hours or grants report access. Both draft languages are
available from the formatter. Recipient addresses are not included in the shared
report. The schedule’s recipient list supports an optional editable label beside
each email, such as “School office”. Labels are staff-only schedule metadata,
limited to 80 characters, and save through the same versioned settings review as
the addresses. Labels do not select an account, affect language or delivery, or
appear in reports, exports or emails. Clearing a label removes it; removing a
recipient also removes its label. Older clients that omit labels retain the
labels of unchanged recipients.
The Service Hours module, schedule, global
program-mail switch and PROGRAM transport govern sending. Mail-off blocks school
delivery without treating the report as newly unreported; retry the same receipt
after restoring availability. Removed recipients, revoked links and superseded
editions are not silently retargeted or resent as current.

## Link-only retrieval and names

Delivery keeps the existing light email layout, **The Program [month] Report is
ready** heading and **View Month Report** action. Correction subjects identify the
report month and revision. Complete posting/unknown-edition safeguards appear once
above the individual cards; each person’s exact conditional change appears once.
Full correction choices and comparison tables remain in the saved report, where
full-precision values wrap within their columns without rounding or truncation.
Runtime callers supply the public brand to the pure email builder so offline
previews do not load server configuration.

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

The settings editor adopts its configuration version and initial reporting month
once. Background reads expose stale settings without replacing the draft or its
selected month; an explicit successful Reload replaces the configuration snapshot.
Authoritative denial clears private drafts, reviews and requested previews. A fresh
successful Retry restores reading, but a discarded preview must be requested again.
Retry and reload completions overtaken by newer denial or unmount cannot restore
old evidence. Accepted writes retain their read-only recovery instead of replaying
the mutation after a failed refresh.

Admin, Head and Coordinator can inspect management previews and reports; Viewer
and participant roles cannot. Admin/Head apply settings directly; Coordinators
propose settings changes for review. Opening-baseline review, issuance, retry and
link management require direct Admin/Head authority. Public capabilities confer
no management or write access.

Apply the reporting migrations through `20261108010000_school_hours_recipient_labels`
and regenerate Prisma before starting the updated application. The first migration
adds the school reporting tables and outbox relation, disables the replaced
monthly schedule and retires unsent
overview receipts while preserving sent evidence. The two follow-up migrations
permit only the narrowly scoped external school delivery shape and forbid
request-specific context on those receipts.
The journal migration registers both legacy and school-reporting tables with the
recovery change journal. It reuses compatible origin/always coverage and installs
missing triggers; it refuses disabled, replica-only or otherwise incompatible
triggers without replacing them. Investigate that database state before retrying.
The recovery baseline migration records a present-day `UNSUPPORTED` baseline for existing rows
linked to unfinished recovery actions by the journal's top-level identities. It
does not update report rows, reconstruct past event order, infer ownership from
private report contents or reopen completed recoveries. Repeating registration
does not duplicate baseline evidence. Registration follows connected report and
schedule identities to completion in one call; a shared schedule conservatively
connects all its editions. These consequences require manual review,
not automatic admission compensation. The record inspector exposes only permitted
metadata; report bodies, opening balances, recipients and link hashes stay private.
The recipient-label migration adds an empty JSON object to existing schedules;
it preserves their recipient addresses, report history and delivery receipts.
Automation starts disabled; review opening balances and configure recipients
before activation. No new environment secret is required. Persistent Node hosting
is required for automatic
sending; real SMTP/inbox readiness must be verified on the intended deployment.

See the [staff guide](../guides/user-guide.md) and
[deployment procedure](../guides/deployment.md#monthly-service-hours-delivery).
