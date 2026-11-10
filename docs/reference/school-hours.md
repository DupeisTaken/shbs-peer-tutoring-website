# Individual school service-hours reports

School reports tell recipients how many previously unreported hours to apply to
each individual's school account. New reports post the combined tutoring net and
Crew change in 0.1-hour steps and retain the unposted remainder. The source
breakdown and carried time are not additional amounts to apply. Optional program
statistics are secondary. The normal tutor roster is unchanged, and the former
admin monthly overview controls and automatic delivery are retired. Existing
monthly snapshots remain historical evidence.
Stale clients cannot issue, preview, retry or reconfigure the retired workflow,
and pending legacy configuration proposals cannot reactivate it. Legacy delivery
admission retires unsent receipts even if an old configuration is still enabled.

Management previews use a sortable table on wider screens and individual cards
on narrow screens. The saved public report uses a compact semantic table, with
local horizontal scrolling on narrow screens. A sticky Details strip keeps each
name and exact Hours together during scrolling; desktop hides that extra context.
Semantic headers identify table cells for screen readers. Each summary keeps the person's name and
school-account reference, then **Carry In → Raw Change → Hours → Carry Out**.
**Hours** is the exact amount to enter once. A dash (**—**) replaces a zero posting
and repeated no-entry prose; a single legend and accessible labels explain it.
Revision applicability remains explicit. **Raw Change** combines tutoring net and Crew change,
displayed as hours and minutes rounded to the nearest minute (half-minutes round
away from zero). This changes presentation only. Per-person Details retains the
exact source values, separate tutoring/Crew components, previous-month/revision
comparisons and alternative posting instructions. Missing historical carry is
shown as unavailable, never inferred as zero. Both layouts share correction
instructions; printed management output uses only the table.

The saved public report uses the same four-field order, with a full-width native
Details disclosure per person. The recipient email is a notification only:
month/revision metadata and the link to the report, with no individual hour amounts,
carry balances, participant lists or source breakdowns. The viewed report is the
posting instruction. Notification emails, the saved-report table and staff views
are separate presentations of the same saved edition;
review screenshots of those views are evidence, not images attached to emails.

## Source accounting and opening review

The [school reporting domain](../../src/server/school-hours.ts) owns a serialized
issue chain. Each individual's baseline freezes earned credit, extra credit,
deductions and stored Crew credit. Their next amount is the difference in earned
and extra credit, minus the difference in deductions, plus the difference in Crew
credit, plus their retained carry. Opposite changes on different people remain
separate even when the program-wide net is zero.

New editions use `TENTH_HOUR_CARRY_NONNEGATIVE`: combine the person's source changes
and signed incoming balance. A negative balance posts **0 hours** and is retained
in full. A positive balance posts complete tenths of an hour and retains the
difference. A tenth is six minutes. For example, 80 minutes posts **1.3 hours**
and retains **2 minutes**; four more minutes in a later report can release another
**0.1 hour**. Carry follows the person across report months, account retirement and
explicit ownership merges. It is never pooled between independent people or
discarded because email is disabled. Source credits and opening component balances
keep their stored precision.

The [posting helper](../../src/server/school-hours-posting.ts) uses isolated Decimal
arithmetic and decimal-string carry. A narrowly bounded machine-roundoff allowance
at a nonzero tenth avoids retaining `0.099999…` forever after minute conversion.
Any tiny difference remains in the signed carry, so posted plus retained equals
available; no real tiny source value is discarded. Carries are saved atomically
with the current source baseline, snapshot and outbox. Preview, download, delivery
retry and an accepted generation retry never advance carry again.

Deductions never become a new negative posting. For example, −80 minutes posts
**0 hours** and carries an 80-minute deficit. Forty later positive minutes still
post zero and leave a 40-minute deficit; another 50 minutes repay it, post
**0.1 hour**, and retain **4 minutes**. Reports therefore add no hours until future
credit has covered the carried deficit. A source reversal does not reduce an
already issued month's posting; it becomes carry. Raw tutoring/Crew changes and
signed carry remain visible as accounting evidence and are not entry instructions.

Older snapshots, including the earlier signed `TENTH_HOUR_CARRY` policy, remain
immutable and retain their original instructions. A missing baseline carry means zero.
New corrections add tenth-hour increments to the saved monthly amount; they do
not retroactively quantize an older edition. A replacement total or comparison
against a legacy edition may consequently retain its historical precision.
Email announces the saved edition without copying its hour report. The report
and CSV retain the posting amounts, source breakdowns, carry and earlier-edition
choices. The dash is presentation only: exact numeric zero remains in Details,
saved snapshots and CSV. Long legacy values
retain the existing readable fallback. Opening-review summaries
keep exact source amounts in screen-reader text and the evidence dialog, without
rounding the editable already-reported values. Compact carried-minute summaries
may be approximate; exact retained hour strings remain in report evidence and CSV.
Saved snapshots are never rewritten to adopt the new policy.

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
Opening reviews can be saved in batches. Only explicitly reviewed people advance;
their source ownership evidence remains anchored while other people are reviewed.
The narrow-screen review table scrolls horizontally to keep its source headers
and values readable, with the existing sticky detail actions.
Unfinished reviews continue to block issuance, rather than turning missing inputs
into zero or inferring school posting from stored source credit.

New program-record imports retain exact historical hours in rosters and history,
but do not make those hours eligible for the school issue chain. The importer
writes server-owned `ImportedRecordProvenance` for newly inserted records in the
same transaction. School reporting excludes marked Sessions, adjustments and
Patrols and shows their count as archive evidence. Exact repeats of existing native
records remain native; CSV cannot supply, remove or export this operational
classification. A newly imported source therefore cannot silently credit an
already-reviewed owner or add a new opening-review identity. Native late entries
and signed corrections retain their existing eligibility.

If a restored imported source ID overlaps previously reviewed or committed school
evidence, issuance blocks for reconciliation instead of generating an artificial
negative reversal. The migration does not guess which older records came from an
import: pretracking evidence retains the explicit school-ledger opening review.
This release does not add a bulk archive-to-report release action. Intentionally
unreported historical hours require operator reconciliation with the school
ledger; importing them alone is not posting authority. Opening-balance review
does not establish archive provenance. Older unclassified records retain their
existing automation behavior until a separate operator review establishes their
origin; this release adds no retrospective classification tool or automatic
backfill. Normal imported source
inserts are journaled through their original source references. Simple financial
provenance keys also link boundary changes to tracked source IDs as unsupported
recovery consequences. A security-overlay restore fingerprints all provenance and
refuses divergence rather than dropping the boundary silently. Composite marker
keys do not independently expand into parent recovery references: this release
has no marker-release API, and a future standalone reclassification workflow must
add typed recovery references before it can safely change those boundaries.

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
The viewed report prominently limits its displayed Hours to people whose last
entered edition was the immediately previous one. Earlier-edition, never-entered
and unknown-edition recipients must use Details or reconcile before posting.
Revision emails only announce the updated report and link to it.
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
accounts. Each receives a separate notification email. An exact verified address in the
account-email registry uses that account’s saved email language; addresses without
a verified, non-retired account default to English. This presentation-only lookup
never attributes school hours or grants report access. Both draft languages are
available from the formatter. Recipient addresses are not included in the shared
report. The schedule’s recipient list supports an optional editable label beside
each email, such as “School office”. Labels are staff-only schedule metadata,
limited to 80 characters, and save through the same versioned settings review as
the addresses. Labels do not select an account, affect language or delivery,
establish archive provenance, or appear in reports, exports or emails. Clearing a label removes it; removing a
recipient also removes its label. Older clients that omit labels retain the
labels of unchanged recipients.
The Service Hours module, schedule, global
program-mail switch and PROGRAM transport govern sending. Mail-off blocks school
delivery without treating the report as newly unreported; retry the same receipt
after restoring availability. Removed recipients, revoked links and superseded
editions are not silently retargeted or resent as current.

## Link-only retrieval and names

Delivery keeps the existing light email layout and **View Month Report** action,
with a concise **Your monthly report is ready** heading. Correction subjects identify the
report month and revision. Emails include edition metadata, the report link and
privacy/receipt guidance, with no individual hour report in HTML, plain text or
the inbox preview. Complete posting/unknown-edition safeguards and each person's
exact conditional Hours appear in the viewed report. Full correction choices
and comparison tables remain in its per-person Details, where
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

## School-recipient reminders and link visits

The emailed report link now uses a recipient-specific `v2` capability from
[the recipient helper](../../src/server/school-hours-recipient-token.ts). It binds
the delivery receipt, report, current link version and exact original mailbox
under a separate HMAC purpose. The URL exposes no mailbox. Shared `v1` report
links remain readable and cannot authorize a reminder or identify a recipient.
New personal links support the same report-only HTML and CSV without a site login;
forwarding a personal link never changes its reminder destination.

On the public report, **Remind me later / 稍后提醒我** opens a native date/time
form. The review shows the report timezone and masked original mailbox. Only a
deliberate same-origin POST can schedule or cancel; there is no address field,
resend-to-all action, management approval or new management scheduling control.
The request body is streamed with a 2 KiB bound, strict fields and duplicate-key
rejection. Public report CSP permits same-origin forms only on personal pages;
scripts, external resources and embedding remain blocked. Explicit HEAD and
prefetch handling never record an opening or create mail.

The [recipient service](../../src/server/school-hours-recipient.ts) rechecks the
capability and uses the reporting/transport fence for writes. Each reminder has
an independent `EmailDelivery` receipt, source receipt, selected UTC instant,
reviewed link version and intent fingerprint. Exact UUID retries recover the
same accepted result, even after the selected time; they cannot alter the target
or selected time. One unfinished reminder per original recipient receipt and at
most five accepted reminder requests in 24 hours bound deliberate scheduling,
including cancelled requests. Cancellation stops only that recipient's pending,
blocked or failed reminder; it cannot interrupt SMTP already admitted as SENDING.
Original delivery evidence and financial snapshots never change.

The automatic monthly issuance toggle does not govern recipient-requested
reminders. Current recipient eligibility, global program mail, Service Hours,
valid report/link state and the transport still govern actual delivery. Revoked,
replaced or reissued links cannot be used to initiate or send an old reminder.
The existing dispatcher checks due work every 30 seconds while the app runs;
outages and bounded transport retries may delay delivery. The selected instant
survives backoff. A blocked/failed reminder can be cancelled on the personal page,
then scheduled again. Management Retry continues to affect original deliveries
only, and original report-list counts exclude recipient reminders.

For valid personal HTML GET requests, the first link visit is recorded on that exact
email receipt as `schoolHoursLinkOpenedAt`. CSV, HEAD and prefetch do not record
it. No tracking pixel, IP, user-agent, visit count or claimed reader identity is
stored. Recording failure does not prevent viewing the saved report. Existing
authorized **Delivery history** displays **Report link opened** with its timestamp
or **No report-link opening recorded**, separately from SMTP status. A scanner or
forwarded link can cause a visit; this is not an email-read receipt or confirmation
that school hours were posted. The public report displays no other recipient's
address, reminders or engagement history. Existing links have no invented history.

Apply `20261111020000_school_recipient_reminders` and regenerate Prisma. Existing
rows retain the `initial` send key; reminder rows use distinct keys while the
existing school-mail context-null constraint remains intact. This feature layers
on the single-language notification email and compact report design in PR #653;
recipient reminders use the same immutable report and brief email layout.

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
no management access. Shared links are read-only; personal links authorize only
their original mailbox's reminder requests.

Apply the complete reporting migration chain through
`20261108010000_school_hours_recipient_labels` and the prospective archive-boundary
migration `20261108010000_imported_record_provenance`, then regenerate Prisma
before starting the updated application. The first migration
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
