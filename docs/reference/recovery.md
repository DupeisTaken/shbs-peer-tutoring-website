# Recovery contracts

The [operator guide](../guides/recovery.md) owns command usage and whole-site
procedures. This reference describes the implemented trust and data boundaries.

## Supported causal restoration

RecoveryAction is prospective provenance for an interview admission or a supported domain checkpoint.
RecoveryEvent records one later logical transaction; RecoveryTrackedEntity and
RecoveryChange retain its transitive record scope and database change coverage.
RecoveryReceipt retains the same-intent result and compensation evidence.
Historical AuditLog `undoData` is not sufficient provenance for this planner.

`inspectAdmissionRecovery` builds a plan against the current database without
performing domain writes. The plan contains an action/application ID, fingerprint,
coverage, dependent-event count, website eligibility, blockers, warnings, projected
effects and event chronology. Coverage must be complete before either supported
write route can apply it. Unknown changes or a conflicting graph cannot be
overridden with an operator flag.

Notification preferences are independent account settings. `NotificationPreference`
uses the explicit `(userId, category)` identity and participates in the recovery
change journal. Known preference inserts, deletes, and badge/email flag updates
are preserved, never replayed or reverted by admission recovery. Ownership/category
rewrites and unknown changed fields remain unsupported. The legacy review/reminder
email flags on `User` are likewise preserved. Missing journal coverage still blocks
recovery; the preference table is not excluded from coverage checks.

Canonical diagnostic text remains stable in saved plans and CLI evidence. The
website resolves that shared vocabulary through localized messages, preserving
record/table identifiers and displaying unknown future diagnostics verbatim.
Translation does not alter evidence, fingerprints or recovery eligibility.

New journal updates also store `changedFields`: the complete column-name delta,
without private values. Earlier rows retain null because redacted snapshots cannot
establish what was changed. The admission adapter can preserve fully covered
name/contact, notification-preference, password/security, suspension, independent
staff/Crew/Translator access and workload-preference edits. It checks every row in
the transaction against an explicit allowlist. A mixed ownership/lifecycle edit,
new related record, unsupported role change or missing field metadata still blocks
recovery. Expiry shortening/revocation of the exact source code is supported;
extending or rebinding that code is not. These transactions still count toward the
website's zero-or-one limit, even when their independent fields are kept.

Account compensation is limited to the admission's captured, attached or code-using
accounts. A tutee's account may appear in the transitive journal after
an independent edit, but that does not make it a login created by this admission.
Independent password changes do not preserve a login whose only authorization was
the voided admission. Inactive tutors continue to use zero workload under the
existing lifecycle rule; the later preference remains in immutable history.
Adapter revision 4 is included in the plan fingerprint, invalidating older previews.
Supported independent role/suspension edits preserve their database-generated
`refreshAuthorityRevision` increase; recovery never restores earlier scheduling
authority. Standalone epoch edits and merge/ownership changes remain unsupported.

Monthly and school-hours reports and schedules also require journal coverage,
even when their tables are empty. Unrelated reporting does not become an admission
dependency. Related reporting, including reporting within the original admission
transaction, requires manual review because automatic compensation has no reporting
adapter. The journal retains causal record IDs, not private balances, recipient
lists, report contents or link capabilities.

`ScheduledProgramRefresh` participates in the same mandatory change journal as
other domain tables. A schedule linked to an admission's tracked account is
recorded as later unsupported work and blocks automatic compensation. The coverage
migration journals existing related schedules conservatively without changing
their execution or authorization. The record inspector exposes only explicit
period/time/status fields; private refresh evidence and approving identities are
not selected.

Recovery source rows lead with the applicant and an authored decision description.
Chronology distinguishes preserved independent edits from changes needing review;
raw event kinds and record identifiers remain in a disclosure. Audit and approval
titles resolve the existing translated operation vocabulary, with translated
category fallbacks for unknown operations, never the raw operation string.
Refreshing a changed preview retains the typed reason but disables execution until
the user explicitly reviews the new consequences. A failed background read also
retains the draft and disables writes; revoked access removes private content.

The journal follows persisted identities conservatively; a shared record reference
is evidence of possible impact, not proof that every later fact was caused by the
admission. The admission adapter decides which effects it can compensate and
which independent facts it preserves. Unrecognized edits block execution rather
than being guessed away. Related independent work can therefore require operator
review even when an operator would ultimately leave it unchanged.

The website gate counts zero or one later logical action across the entire
causal chain. It does not count affected rows and does not stop at direct
children. `applyAdmissionRecoveryFromOperator` permits a larger covered chain;
it preserves the ordinary domain's live actor, fingerprint, conflict and receipt
requirements. Only the trusted CLI imports this operator adapter. Browser input
never chooses a trusted channel or supplies an authoritative role.
The packaged recovery CLI follows an explicit source-import graph. Domain helpers
for username allocation, account/attendance locks, historical snapshots, signup
state, request review, audit writes, notifications and program time-zone reads
require the caller's database client or transaction. Web wrappers retain their
existing defaults; recovery never imports the shared client, application environment
validation, API router or outbound sender. Extraction does not change current
eligibility checks, source reads, lock order or delivery-source binding. Ordinary
signup management edits still consume their authenticated action proof; the recovery
path still verifies its exact action and transaction binding before changing state.

The Docker runtime assembles each additional source and the two notification
catalogues at its original path before copying the prepared application layer.
The deployment graph guard follows emitted imports, deferred imports and re-exports,
validates JSON assets as terminal data, and checks production packages and exact
runtime destinations. It must fail when a required descendant is missing or a web
runtime dependency reaches the CLI; copying the entire source tree is not a substitute.

Dated scheduling has journal coverage across plans, assignment snapshots, cohorts,
individual commitments, suggestions, requests, offers, responses, mutation receipts,
essential delivery notices and calendar subscriptions. These remain unsupported
admission descendants: recovery cannot cancel an agreed lesson, erase attendance,
replay consent or revoke a separate calendar capability as compensation. Their
presence in a related causal graph blocks both website and operator admission undo;
this also applies when trusted admission code wrote scheduling records in the original
ADMISSION transaction. A shared event label cannot make those effects compensable.
Empty or unrelated scheduling tables do not block every admission. Planning references
follow exact current and retained profile ownership, including a tutor's tutee alias,
and retain the parent plan for later source invalidation or cohort changes.

The scheduling journal uses its own positive projection of record identities,
statuses, clocks and revisions. Notice addresses, bodies, context, SMTP diagnostics,
request hashes and calendar token hashes are excluded; `changedFields` retains only
column names. The additive coverage migration baselines existing related rows as
unsupported evidence without inventing past event order. Completed admission voids
reject stale new plans for the voided tutor unless independent authorization exists.
An already installed scheduling journal trigger is reused only when its function,
row/event coverage and origin-enabled configuration match; incompatible coverage
aborts the migration rather than being silently replaced.
Planning transactions retain period → room/session → recovery-fence lock order;
admission recovery takes period before its recovery fence and never enters room or
calendar delivery locks.

The management website uses `/admin/recovery` for eligible admission plans and
`/admin/database` for permitted current-record inspection. Admin and Head apply
directly; Coordinator recovery writes enter ordinary Admin/Head proposal review.
Queued proposals retain the original fingerprint and recheck the graph when a
reviewer applies them. Inspection does not authorize arbitrary record mutation.

The management review summary treats the recovery action ID as context and the
requested reason as the change being reviewed. It displays the applicant name
only from a matching version-1 captured plan; missing, mismatched or future
evidence never borrows a name from live records. The shared review vocabulary
includes recovery record types and fields, while technical hashes stay outside
the requested-change summary. These labels do not change immutable proposal
evidence, current reviewer authority or the causal execution checks.

Compensation removes supported consequences derived from the admission. It
preserves independent account facts, independent access, unrelated learning
partners and their accounts. A checkpoint does not grant arbitrary row replacement
or permit unvoiding credentials. Reauthorization remains an ordinary domain
operation with fresh credentials. The admission apply transaction commits its
receipt with the domain writes; same-intent retries cannot perform the write
twice. Reused keys with different intent fail.

## Operator command boundary

[The host entry point](../../scripts/recovery.ts) loads only the modules required
for its command and creates its own Prisma or PostgreSQL client. It does not
import the application's shared database, environment validator, Next server or
worker startup. Parsing happens before client creation, so help and malformed
arguments do not open a database connection.

[Typed parsing](../../src/server/recovery/operator-cli.ts) rejects unknown,
duplicate and missing options, role flags, invalid UUIDs, malformed record keys
and unbounded page sizes. Record keys contain at most eight scalar properties;
there is no SQL expression, shell evaluation or arbitrary where-clause option.
Database reports and admission inspection run in read-only repeatable-read
transactions. Admission inspection, comparison and receipt reads require a
currently active, unmerged Admin or Head with no recovery-voided access; apply
independently rereads authority.

[Plan files](../../src/server/recovery/operator-plan.ts) use exclusive creation.
A canonical SHA-256 hash binds the complete file, including its database identity,
actor, action, fingerprint and displayed preview. Apply/compare requires the
reviewed `--plan-hash`; altered files fail before a domain write. Plan integrity
is a review binding, not cryptographic host-user authentication. The trusted
operator controls filesystem access and retains the reviewed hash separately.
Database identity contains host, port, database name and username, never its
password. Redirecting URL options are rejected. Plans do not authorize writes to
another configured database, even if action IDs happen to match.

For IPv6 endpoints, the CLI derives an unbracketed host only in the node-postgres
connection URL after validating the caller's URL. This handles the driver's
connection-string precedence without changing the original plan identity,
credentials or SSL options. Caller-supplied redirect parameters remain rejected.

Record inspection uses the shared model-specific safe field policies. Operator
authority does not remove masking. Safe AuditLog and Recovery* identifiers allow
chronology/relationship investigation; JSON snapshots, private evidence and
credential fields are excluded from row selection. Newly added models have
metadata-only access until their safe policy is explicitly reviewed.

`RecoveryChange` additionally projects its affected record's exact approved
primary key and validated changed-column names. Arbitrary JSON, raw before/after
snapshots and protected target identities remain unavailable. The bounded
`records dependencies` reader follows one exact record, action or event at a time;
its references are recorded relationship evidence, not proof of a complete causal
chain. Both transports retain the same masking and a 50-change page limit.

## Whole-site staging boundary

[The staging service](../../src/server/recovery/operator-site.ts) accepts a trusted
gzip-compressed plain PostgreSQL dump matching the current backup script. It
checks the gzip stream, PostgreSQL header, compressed/decompressed bounds and
content hash. No WAL/PITR service, storage restore, schema migration, security
reconciliation or live cutover is performed by `site stage`. Later phases have
separate reviewed plans and immutable external receipts.

Raw operator and Prisma connections apply the shared UTC startup policy before
their first query, including database-generated recovery journal timestamps.
The fixed runtime setting overrides a non-UTC database/role default without
changing reviewed endpoint identities or permitting caller-supplied startup options.
Raw operator clients also decode timestamp-without-time-zone values as UTC using
a per-client parser; a non-UTC Node host cannot shift security snapshots or their
fingerprints, and shared driver parsers remain unchanged.
Cutover derives its source control connection by changing only the validated
source URL's database to `postgres`, then verifies that database and the reviewed
source role. Database fences run from this separate maintenance database; source
state and session checks bind the reviewed source name explicitly. The source
role must be able to connect to `postgres`; failure does not bypass the fence.

The reviewed plan binds the backup path/hash, source and maintenance identities,
fresh `shbs_recovery_*` database name, evidence directory and table-count
checkpoint. Staging requires a loopback maintenance connection, a different port
from a local source endpoint and a different operator username. It checks that
the source application's role on staging is NOLOGIN and unprivileged. Hostnames
and ports are configuration checks; the operator must provision and independently
verify a separate isolated instance and safe role memberships.

The external intent directory acts as a durable replay lock. Before creating a
target the service saves the current source database as a custom-format dump
outside either database. Subprocesses receive fixed argv arrays with `shell:false`
and an explicit PostgreSQL environment. Credentials use environment variables.
IPv6 hosts keep their URI brackets in reviewed plan identities, while PostgreSQL
tool environment values use the unbracketed address. This conversion does not
change the separate-port isolation check or the saved plan hash.
Stdout is streamed with a size bound, stderr is consumed without printing, and a
ten-minute deadline terminates only that child tool. Errors use stable codes.
The operator supplies compatible PostgreSQL tools; the web runtime does not
contain them by default.

The service creates a fresh target, revokes PUBLIC database connectivity, restores
through `psql --no-psqlrc --single-transaction` with `ON_ERROR_STOP`, compares
public-table counts and then sets `ALLOW_CONNECTIONS false`. It never overwrites
or drops a database. Failure attempts the same fence and writes a failure receipt;
a failed fence has a distinct actionable error. A lost host/process can interrupt
this sequence, so infrastructure isolation remains required even before a receipt.

The `SEALED_STAGING_ONLY` receipt does not authorize startup: restored passwords,
sessions, invitations and grants can be older than current security decisions.
Equal table counts do not establish equal rows, credential safety or semantic
equivalence. A completed same-plan stage can return its saved receipt after
checking the target remains fenced, without replaying the restore.

Transactional resume receipts stored with `COMMENT ON DATABASE` use PostgreSQL's
cluster-shared description catalog. All reconciliation, acceptance and rollback
readers use `pg_catalog.shobj_description`, including maintenance connections
reading a named target. A local `obj_description` lookup cannot recover these
markers. Receipt schema, exact plan hash and existing external evidence checks
still determine whether a same-intent operation can resume.

[Security reconciliation](../../src/server/recovery/operator-reconcile.ts) binds
the staging plan/receipt, current source and restored fingerprints, reviewed
credential generations, policy revision and old/new signing-key fingerprints.
The source projection excludes password hashes. Current names/contact settings,
independent management/Crew/Translator and participant access, lifecycle state,
retirement, suspension, aliases, preferences and departure evidence follow exact
persisted identities. A current-only account is imported only when its referenced
profile/person/account closure exists; missing domain profiles and contradictory
retirement or identifier ownership block the complete transaction. Backup-only
accounts retain evidence but lose credentials and participation and are suspended
and credential-voided. A nonretired backup-only account with Crew lifecycle evidence
uses role `CREW` with `INACTIVE` status; an account without it uses `VIEWER` with
null Crew status. This preserves the existing Viewer exclusivity constraint and
Crew evidence while granting no active access. Already retired accounts retain
their role and permanent retirement. The [static schema contract](../../src/server/recovery/operator-schema.ts)
lists every reviewed public model/column/PostgreSQL type and authority enum label;
the optional Prisma migration table has its own exact metadata policy. A matching
source/backup pair cannot certify a new table, bearer column, changed type or enum
label. Such changes fail closed, and identity-reader changes additionally require
an explicit semantic adapter review.

An operator session is acquired during a brief controlled opening and the target
is immediately fenced again. Reconciliation reads current source state in a
read-only repeatable-read transaction and exports that exact PostgreSQL snapshot
to a protected custom-format dump. A fresh source snapshot is checked again after
target fencing before commit. The reviewed source and restored fingerprints must
still match; snapshot/dump hashes bind the retained evidence without publishing
rows or credentials. Source contents remain unchanged during staging,
reconciliation, acceptance and cutover.

All restored passwords are cleared. Each target credential generation advances
strictly beyond both source and restored values, including accounts with null
passwords; integer exhaustion blocks execution. Only the verified named
`account_session_version` trigger is disabled, inside the fenced target
transaction, and its exact definition/function and original enabled state are
verified after restoration. Ownership, retirement and immutable-evidence guards
remain active. A distinct signing secret is mandatory, and only its fingerprint
is retained. Operational email/login/reset/registration/history/signup/CAPTCHA
proofs, calendar tokens, confirmation tickets and public school-report links are
expired, consumed, rotated or revoked according to their owning table. Immutable
invitation-attempt and accepted-claim receipts remain evidence; old claim/session
generations cannot authorize fresh access.

Current delivery records are retained where their foreign-key closure permits.
Deferred notices are terminally quarantined, leases and attempt ownership are
invalidated, and refresh/report schedules are cancelled or disabled. Sent and
accepted records stay terminal; an in-flight `SENDING` record becomes
`UNCERTAIN_RECOVERY`, never pending. A partial scheduling-maintenance schema
blocks reconciliation. The [supported invalidator](../../src/server/recovery/operator-maintenance.ts)
takes period → room → planning fences before the first reconciliation write,
verifies the exact source-trigger inventory and marks both publication and
settlement watermarks obsolete. It preserves all source/retry events and inserts
a pending global reconciliation marker. Ordinary maintenance then rebuilds from
current sources; recovery never copies a stale clean watermark or clears the log.
The resulting receipt is
`SECURITY_RECONCILED_SEALED`.

[Acceptance and cutover](../../src/server/recovery/operator-cutover.ts) are
restricted to synthetic loopback `shbs_*_test` endpoints. Acceptance requires a
separately provisioned LOGIN role with no memberships, elevated privileges,
domain-write or schema-create privileges and SELECT access to the public tables.
One explicitly reviewed, currently eligible synthetic account receives fresh
credentials. Live suspension, permanent retirement/voiding and participation
restrictions are rechecked before setup, sign-in and session validation. A
two-factor account cannot use this password-only harness. The owned loopback HTTP
server uses the shared scrypt verifier, Auth.js encrypted JWT and current-session
generation check; it verifies fresh authentication, retired signing-key and stale
generation rejection, and denied worker/deferred writes. The receipt is
`ACCEPTED_ISOLATED_READ_ONLY_SEALED` only after the additional genuine application
check succeeds. The [Next clone harness](../../src/server/recovery/operator-next.ts)
copies the sealed idle target into a random disposable database and starts the
trusted standalone build with an ordinary writable role, rotated signing secret
and allowlisted environment. SMTP points only to an owned loopback rejection sink.
The build manifest must match an independently supplied checkout SHA
(`GITHUB_SHA` in the hosted job or `RECOVERY_REHEARSAL_CHECKOUT_SHA` locally), build
ID and server hash. Successful fresh login determines the real cookie/salt; a
current signed-token control precedes negatives changing only secret or epoch.
Protected history reads and actual session cache identities exercise the combined
server-owned history and credential epoch boundary. The Auth.js callback refreshes
history revision, so this is not evidence of isolated stale-history JWT denial.
The notification worker has a new synthetic due
control while every restored queue row must remain unchanged for 65 seconds.
This proves notification delivery liveness and restored queue preservation;
it does not independently prove liveness of every other worker. The clone and
role are removed, and the original target remains sealed and unchanged.

Cutover validates the accepted target and current source fingerprints, verifies
the exact read-only application endpoint, opens only that isolated target and
atomically compares/swaps an identity-only deployment pointer. The pointer stores
the signing-key fingerprint and `READ_ONLY_NO_OUTBOUND` runtime contract, never a
connection password or signing secret. `ISOLATED_READ_ONLY_CUTOVER` is an isolated
rehearsal result, not production deployment or writable application startup.

Rollback fences both fixtures and takes the newest cutover-site security snapshot
and matching dump. It overlays that state onto the original retained-business
fixture, advances generations and invalidates credentials/capabilities again,
requires another signing-key rotation without reusing a known retired key, and
tests fresh read-only authentication and a genuine writable Next clone before
publishing the rollback pointer. It
retires only the exact generated source database role after verifying exclusive
ownership and no elevated privileges. The former target stays fenced. Thus
`ROLLED_BACK_WITH_NEWEST_SECURITY_READ_ONLY` cannot silently restore an earlier
grant or password by switching a pointer alone.

Each phase saves an exclusive external intent and receipt under the staging
evidence directory. Reconciliation and acceptance use transactional database
comment markers; rollback uses pending/final markers, and pointer operation IDs
bind cutover publication. A lost response can return the same receipt or resume
its committed phase without repeating credential changes. Changed fingerprints,
unrelated pointers and incomplete failure state remain conflicts. Dumps are
sensitive backups; the JSON receipts contain hashes, endpoint identities and
bounded metadata. Production connectivity, maintenance, external storage and
business acceptance still follow the deployment runbook.

## Scoped checkpoint contracts

`RecoveryCheckpoint` binds an immutable purpose-specific before-state to one
adapter/version, exact source, capture transaction and tracked scope. Supported
ordinary attendance/card corrections, lifecycle decisions, signup edits and program
refreshes capture before-state in their own transaction. A failed domain write
rolls back its checkpoint too. Explicit `checkpoint capture` is also available;
inspection, comparison and record browsing never create snapshots. Existing
history without a supported before-state is not reconstructed from audit prose.

Adapters validate every changed row, including writes in the original transaction.
The website limit counts all later logical transactions across the tracked chain,
including preserved independent updates; the originating transaction is excluded.
Operator apply bypasses only this count, not coverage, live authority, version,
fingerprint or domain eligibility. A checkpoint is single-use, and an exact retry
returns its immutable receipt. Another intent using the same key conflicts.

Participant restoration binds exact owners, source/group generations, enrollment
consent and retained assignment schedules. Current school departure, academic,
policy, qualification, room/schedule and account restrictions are rechecked. It
does not replay an old consent, credential or finalized request decision.
Attendance recovery calls the ordinary correction writer for the entire merged
block, recomputes service credit, reconciles automatic cards and requests fresh
patrol discrepancy review. Card recovery records a new attributed review and
recomputes standing from current cards. Punishment-related roster restoration
requires the exact captured assignment and current participant eligibility.

Current learner eligibility counts valid disciplinary cards from every exact
source contributing to the canonical execution participant, matching the ordinary
removal writer. This execution scope does not extend account ownership, consent
or private-history access. A superseded learner source cannot be reactivated by
checkpoint restoration. Attendance/card checkpoint compensation is currently
blocked for active consolidated participation, including a canonical learner with
multiple execution sources: those snapshots do not capture and lock the complete
canonical and sibling consequence scope. Use the owning correction and participation
review workflows; the operator CLI cannot bypass this limitation. Original-source
suspension and departure restrictions remain live independently.

Closed student workflows create an immutable `RecoveryWorkflowDraft` containing
only local answers and exact owner/source binding. The owner reviews it at
`/signup?recoveryDraft=ID`, submits through ordinary current intake and completes
fresh mailbox/policy requirements. Draft adoption has its own versioned receipt;
it neither reopens the terminal source nor restores an earlier signature or proof.

Compensation sets `shbs.recovery_compensating` to the exact action ID. Its own
capture is suppressed, while overlapping roots record `RECOVERY_COMPENSATION`.
The former global value `1` is rejected. Domain locks precede sorted recovery
fences; a changing overlap may abort the complete transaction, never omit evidence.
The composed continuation observer retains `sourceSurveyId` in both row versions
and follows both original and current request edges. Scoped compensation does not
disable scheduling invalidation or discard identity provenance.

## Delivery effects

Prospective delivery evidence uses `RecoveryDeliveryCoverage`,
`RecoveryDeliveryEffect` and append-only `RecoveryDeliveryCancellation`. Trusted
writers bind notices to an exact source/event, never to a recipient or actor.
Security mail is independent. A zero-effect event has explicit coverage; missing,
ambiguous or legacy origins remain unknown. Mixed preserved/compensated events
with indistinguishable effects block automatic cancellation.

Notification origin capture uses ordered AFTER ROW triggers around the existing
mail enqueue trigger. BEFORE ROW stacks cannot safely pair a bulk insert with its
later AFTER events. Migration 054000 preserves the earlier migration and replaces
that ordering; coverage refuses coexistence with the old start trigger. A trusted
primary root must contain the exact typed source mutation in the current
transaction before its notice is created. Each other outstanding root with that
same source mutation receives its own immutable event/effect reference to the
shared physical notice or mail. Recipient overlap alone never establishes a link.
Review decisions use their actual review record even when the signup request
remains unchanged. Missing source proof stays unknown.

Migration 056000 introduces delivery coverage marker 2; earlier markers cannot
prove complete overlap attribution and are not backfilled by guesswork. Apply,
transport admission and completion acquire all participating recovery roots in
sorted order before physical delivery locks. A cancellation from either root
stops the shared pending effect; a second root cannot authorize replay. The
public inventory format remains version 1 because its safe fields are unchanged.

Preview fingerprints include the safe effect inventory. Pending or leased generic
deliveries are stopped under the recovery and exact delivery fences; unseen
in-app notices are withdrawn. The dispatcher commits transport admission before
SMTP and finishes only the matching attempt. Sent, observed, previously attempted
and in-flight outcomes remain in the receipt: recovery cannot retract mail or
promise an already admitted external effect did not happen. Request/report mail
retains its owning specialized admission protocol and is not generically replayed.

Generic causal mail admits only an unstarted pending row. A failed or abandoned
admitted attempt remains uncertain instead of becoming retryable pending work.
An exact late provider acceptance can settle that retained attempt as sent,
including after recovery records its stop; it never authorizes a second send.
Recording an accepted transport outcome is separate from the transport call, so
a database completion failure cannot be misreported as a rejected send.

Shared receipt projection returns versioned metadata, source/adapter reference,
authority scope, effects, preserved facts and delivery dispositions. It excludes
raw snapshots, arbitrary adapter results, credentials and private message bodies.
Unknown versions expose metadata without claiming unsupported evidence.

## Verification boundaries

Checkpoint inspection owns a read-only repeatable-read transaction. Signup
preview uses the ordinary normalization rules without writer row locks; apply
revalidates with the ordinary locks. Its fingerprint includes normalized answers,
current field/name/grade configuration, selected catalogue values and tuple
revisions, so a catalogue edit away and back invalidates an earlier preview.
Integration tests must invoke inspection with the root client as well as existing
transactions, because an existing transaction does not exercise the read-only
transaction boundary.

The journal captures committed row changes in an AFTER ROW trigger. A skipped
`ON CONFLICT DO NOTHING` insert does not count as an event. Both old and new
foreign-key values enter scope discovery. A `RecoveryFence` revision rejects a
stale Serializable snapshot after waiting for another writer. Coverage requires
the expected trigger function and event mask, origin replication mode, and a
trigger enabled for ordinary writes; merely finding its name is insufficient.
Conditional predicates, column-filtered updates, trigger arguments and deferred
constraint triggers cannot establish complete coverage. Capture must run for
every ordinary row change before a transaction's planner reads its history.

Registration codes belong to the exact admission generation that inserted them.
Reapproval does not adopt an earlier code. A fresh accepted generation can permit
fresh credential setup for a retained voided account; recovery never restores an
old password. Independently recorded interview hours, names and academic history
remain evidence. Assignment compensation also removes messaging-access links
created solely by those assignments when no other assignment or session supports
them. It preserves all messages and independent links. First-assignment deadlines
return to their attributable prior values only when no qualifying assignment
survives.

Planning is bounded to 100 events, 2,000 changes, 1,000 tracked identities,
200 accounts/codes/pairings, and 400 tutees/deadlines/messaging links. Exceeding
these limits blocks automated execution on both routes. The read-only plan cannot
invent missing history or force unsupported later work through compensation.

[Standalone operator tests](../../scripts/recovery.test.ts) use synthetic dumps,
injected database clients and executable fake PostgreSQL tools. They cover parser
bounds, plan hashing, wrong-database refusal, changed backups, replay protection,
external evidence, fixed argv, failure fencing and secret-free errors without
touching a real database or running Next. Domain integration tests separately
verify real transaction, permission, causal preservation and receipt behavior.
CI runs the standalone tooling tests alongside the ordinary required checks. The
separate [isolated rehearsal workflow](../../.github/workflows/recovery-rehearsal.yml)
uses two job-owned PostgreSQL 16 services and native PostgreSQL 16 clients. It runs
for scoped recovery/schema changes or explicit dispatch without changing the
ordinary required-job topology.

The opt-in [PostgreSQL restoration rehearsal](../../scripts/recovery-postgres.test.ts)
requires two caller-owned isolated loopback clusters with distinct ports,
`shbs_*_test` maintenance databases and compatible PostgreSQL tools. Set
`SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL` and `SHBS_RECOVERY_TEST_STAGING_ADMIN_URL`,
then run it serially with `node --import tsx --test scripts/recovery-postgres.test.ts`.
It applies the committed migration chain to random fixture databases, exercises
native dump/restore and compares every restored public row with the actual
checkpoint and every source row before rollback. Synthetic cases include
retirement, suspension, independent grants/contact edits, source-only and
backup-only accounts, null-password/high credential generations, each known bearer
family, immutable proof receipts, sent/deferred effects, stale source state,
transactional failure fencing and same-intent phase resumption. It then exercises
real HTTP authentication, isolated pointer cutover and newest-security rollback.
Its trusted matching standalone build is required in `.next/standalone`, including
the externally bound `.recovery-checkout.json` manifest. The hosted workflow builds
this runtime serially using only its job-owned synthetic database. Correctly
minted registration, survey, calendar, school report, history, viewer/crew/login
OTP and reset proofs must first succeed on a checkpoint clone and then fail after
reconciliation through the real application routes. SQL inventory quarantine
evidence for other proof families is reported separately. Both acceptance and
rollback clone checks run ordinary Auth.js and the production worker startup path;
the real pointer endpoints remain read-only.
The helper cleans up only generated fixture databases/roles, never resets a
supplied maintenance database and skips when either URL is absent.

`SHBS_RECOVERY_TEST_ARTIFACT_DIR` enables allowlisted synthetic JSON/HTML receipts.
The workflow uploads only those report files, never dumps, raw rows, connection
URLs or credentials. A skipped local run or authored workflow is not a successful
native rehearsal: use the result and artifacts for the exact reviewed revision.
Neither mocked tools nor a successful disposable clone establishes production
restoration, external-storage recovery or activation of a writable live site.
