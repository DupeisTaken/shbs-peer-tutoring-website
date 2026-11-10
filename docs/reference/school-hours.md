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
using the existing four-decimal display convention. School instructions keep the
exact posting value visible beside that summary in management, public HTML and
plain-text email; CSV retains the exact numeric value. Opening-review summaries
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
not included in the shared report. The schedule's recipient list supports an
optional editable label beside each email, such as “School office”. Labels are
staff-only schedule metadata, limited to 80 characters, and save through the same
versioned settings review as the addresses. They do not select an account, alter
delivery, establish archive provenance or appear in reports, exports or emails.
Clearing a label removes it;
removing a recipient also removes its label. Older clients that omit labels retain
the labels of unchanged recipients.
The Service Hours module, schedule, global
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

## Scheduled follow-up emails

From a saved School Month Report, Admin/Head can choose a future local date/time,
review the original recipient list and confirm a one-time follow-up. It sends the
same saved edition with a bilingual reminder not to apply hours twice. This does
not generate another report, change a baseline or confirm school posting. Only
the report's original recipients are eligible, and they must remain configured.

The existing mail dispatcher owns due work, normally checked every 30 seconds.
`EmailDelivery.schoolHoursBatch` identifies the original send (`initial`) or a
follow-up intent UUID. The unique report/recipient/batch key preserves original
delivery evidence while allowing deliberate follow-ups. The selected UTC instant
in `schoolHoursScheduledFor` survives transport backoff; `availableAt` owns retry
timing. The input/actor fingerprint in `schoolHoursIntentHash` recovers exact
retries without allowing a reused intent to schedule different work. Report mail
still has null request context. The report timezone resolves local input;
nonexistent/ambiguous daylight-saving times and past dates are rejected.

Scheduling and cancellation take the existing reporting fence and recheck the
actor. Cancellation affects only pending, blocked or failed follow-up deliveries;
it cannot recall sent mail or interrupt an admitted send. A revoked or superseded
report, disabled schedule, removed recipient or unavailable feature/transport is
checked again at delivery admission. Restarted workers resume persisted due work;
outages can delay mail. The original report Retry action affects only its original
deliveries. For a blocked/failed follow-up, repair the configuration, cancel its
unsent batch and deliberately schedule another. At most 20 unfinished batches per
report may be retained at once. Accepted UI writes recover failed refreshes with
reads only; exact transport retries retain their intent UUID.

Apply `20261111010000_school_hours_followups` and regenerate Prisma before running
this feature. Existing receipts retain the `initial` discriminator and their
original unique-delivery behavior. Follow-up history is separate from the report
list's original delivery counts.

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
