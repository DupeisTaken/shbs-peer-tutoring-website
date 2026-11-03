# Selective recovery and operator staging

Use selective recovery when a supported admission, participant, workflow,
attendance, card or program-refresh action was mistaken. The system
compensates the selected action while retaining independent facts,
historical evidence and existing tutee accounts. Read the proposed
effects before applying them. The [recovery reference](../reference/recovery.md)
describes provenance coverage, permissions and technical limits.

## Choose a recovery route

Open **Admission Recovery** at `/admin/recovery` from the management navigation.
Admin and Head can apply eligible plans directly. Coordinators submit a request
for Admin/Head review through the existing approval workflow; a queued request
is not a completed recovery. Reviewers recheck the live plan before it applies.
Open **Database Records** at `/admin/database` to inspect permitted current
records, model metadata and safe record references. Viewing a record grants no
additional mutation authority.

Choose an approval by the applicant's name and review **What recovery would
change** beside **What stays unchanged**. **Record identifiers** holds the original
event names and IDs for operator investigation. The recovery reference is distinct
from an application ID or audit ID.

Later independent name/contact, account security, suspension, staff/Crew/Translator
access and workload-preference edits can now remain in place when the journal has
complete field-level coverage. Already-shortened or revoked source codes stay
revoked. An admission-only login is still disabled even if its password changed;
inactive tutors still have zero workload. Existing tutee accounts are
preserved. A transaction that also changes ownership, unsupported participation or
other unrecognized fields still needs a separate review. Older edits without the
new field-name evidence cannot be assumed harmless.

If the records change while you review, your reason remains typed, but recovery is
disabled. Use **Review updated consequences**, inspect the new effects, then confirm
again. A failed refresh preserves your reason and offers a read-only retry.
If applying a checkpoint reports a conflict, the page fetches a fresh preview;
you must explicitly review the changed consequences before trying again. Selecting
**Inspect** for the same checkpoint also refreshes its evidence. If an action
reports that you no longer have permission, private lists, previews and receipts
are concealed. **Retry** must successfully recheck every open private view before
showing them again; it does not repeat the write or discard your reason.

A recorded checkpoint outcome is labelled **Restoration already recorded** and
cannot be applied again. This also covers a pending owner-review draft; it does
not mean participation has resumed. Blocked evidence and pending management review
have separate labels. Only a complete supported chain with more than one later
event directs the operator to the CLI.
A successfully read receipt also records completion when an older preview still
looks eligible, provided both the receipt ID and its checkpoint match the active
view. A receipt reference in the URL alone, or a receipt belonging to another
checkpoint, does not establish that outcome.

Within the same open application tab and verified sign-in, switching checkpoints
or navigating away and back does not permit another submission of a recorded
restoration or queued approval. The page retains their receipt or approval
reference, and clears the submitted reason after either outcome is recorded.
Another account, role or session-authority generation cannot inherit that intent.
This protection follows client-side navigation; a full reload or new tab starts a
new in-memory cache. Before resubmitting there, inspect the server's receipt and
approval history and have management reconcile any uncertain approval submission.
No recovery reason or retry key is saved in browser storage.

An uncertain direct restoration response retains the exact checkpoint,
fingerprint, trimmed reason and retry key. Confirming its retry reconciles that
original operation; it does not adopt changed consequences or create a new intent.
After an uncertain approval submission, **View approval request** opens the
read-only approval list instead. Have management reconcile the original request
and any recovery receipt before attempting another submission; approval creation
does not provide the direct restoration's durable replay guarantee. Do not invent
a new key or switch checkpoints to bypass either state. A later denial remains
concealed across page navigation until fresh reads pass for every affected private
checkpoint and receipt, including a view that is no longer selected.

The website permits a supported action only when its entire tracked causal chain
has zero or one later logical action. Two later actions anywhere in that chain
require the host operator CLI. A transaction that changes several rows counts as
one logical action. Missing coverage blocks both routes; moving to the CLI does
not make missing evidence trustworthy.

Older activity records can be inspected, but their historical `undoData` does not
prove a complete causal chain. They cannot be forced through the new admission
recovery command. Use the record inspector to establish the actual current facts
and obtain a separately reviewed correction when no supported plan exists.

The operator CLI runs on a trusted host with database credentials. It provides
JSON reports and typed operations; it does not expose SQL or shell execution in
the website. Domain commands require a current Admin or Head account ID and
recheck that account's current authority, including suspension, retirement and
recovery-voided access. `--role` and impersonated role claims
are not supported. Host access is a separate operational privilege: the CLI
does not prompt for a website password or authenticate whoever controls the host.

## Inspect records

Run commands from the repository root, or the standalone application's `/app`
directory. Set `DATABASE_URL` through the protected process environment or local
environment file. Do not put a password-bearing URL in command-line arguments.

```bash
npm run recovery -- --help
npm run recovery -- records tables
npm run recovery -- records inspect --table RecoveryAction --limit 25
npm run recovery -- records inspect --table TutorApplication --key '{"id":"APPLICATION_ID"}'
npm run recovery -- records inspect --table AuditLog --key '{"id":"AUDIT_ID"}'
npm run recovery -- records dependencies --table Tutor --key '{"id":"TUTOR_ID"}' --limit 25
```

Use the exact model name, key fields and available status reported by `tables`.
Composite keys use one JSON object. Copy a record reference from the website and
place its `table` and `key` values in these explicit options; never execute an
unreviewed copied command. Pages contain at most 100 rows. Supply the returned
`nextCursor` to `--cursor` to continue. The inspector excludes credentials,
invitation codes, tokens, private message bodies and unreviewed JSON evidence.
An unsupported table exposes metadata only. The CLI preserves those exclusions;
it has no full-secret output flag.

`records dependencies` requires an exact key and returns at most 50 recorded
changes per page. Follow its action/event references to inspect the associated
journal. Safe affected-record keys and changed-column names are available, but
raw historical snapshots and credential values remain excluded. A shared record
reference establishes recorded impact evidence, not permission to reverse it or
proof that every related action was caused by the selected record.

Checkpoint and other recovery metadata references link through their stored
action/event identities. Checkpoint dependency pages follow that exact action's
journal; they do not infer links from private scope or answer snapshots. A missing
or inaccessible owner-review draft shows the same unavailable page through both
signup URLs, while the recorded owner can review it through ordinary signup.

## Save and compare an admission checkpoint

Find the prospective admission's `RecoveryAction.id` through the inspector. An
application ID or old audit ID is not a recovery-action ID. Save a plan in a
private directory that already exists:

```bash
npm run recovery -- admission checkpoint --action-id ACTION_ID --actor-id ADMIN_ID --out local-operations/admission-plan.json
```

`checkpoint` is an alias for `inspect`. Its saved plan describes the supported
restoration to the state before that admission, plus the current causal graph
and fingerprint. It is not a general-purpose snapshot of a participant. Keep the
printed `planHash` separately with the reviewed plan. Plan files are created
exclusively: a repeated filename cannot overwrite the evidence.

```bash
npm run recovery -- admission compare --plan local-operations/admission-plan.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID
```

Comparison is read-only. It reports the stored checkpoint and the current plan,
including whether their fingerprints differ. Changed dependencies, changed
access or conflicting history require a fresh review and new plan. The CLI
rejects a file edited after its reviewed hash was recorded and a plan bound to a
different database or actor.

## Apply the reviewed restoration

```bash
npm run recovery -- admission restore --plan local-operations/admission-plan.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID --reason 'Mistaken interview admission; reviewed with program leadership' --client-key 611a19be-3d0a-4d80-bdf2-bc7ace21445d
```

`restore` is an alias for `apply`. This performs a causal void, including supported
admission-derived invitations, account access and assignment consequences. It
preserves independent participation, independent grants and tutee
accounts. The server rechecks the graph, fingerprint and current authorization
inside the write transaction. A stale or incomplete plan performs no domain
write. The operator route bypasses only the website's later-action count limit.

Keep the returned receipt ID and the client key. Retry an uncertain response with
the **same** intent and client key; do not invent a new key to bypass a failure.
Read the committed receipt without writing again:

```bash
npm run recovery -- admission receipt --receipt-id RECEIPT_ID --actor-id ADMIN_ID
```

Receipt output includes the action, actor, reason, channel, fingerprint and time.
It excludes raw evidence blobs. An already voided admission cannot be used to
restore an old password, registration code or session. A later admission or new
credential needs a fresh ordinary authorization.

## Review a scoped checkpoint

The checkpoint section at `/admin/recovery` lists before-states captured by
supported ordinary writers. You may also deliberately capture the current state
before a planned action. Capture is a mutation; viewing and comparing are read-only.
Use the adapter matching the source: `PARTICIPANT_TUTOR`, `PARTICIPANT_TUTEE`,
`STUDENT_WORKFLOW`, `ATTENDANCE`, `CARD` or `PROGRAM_REFRESH`.

```bash
npm run recovery -- checkpoint capture --adapter ATTENDANCE --source-id SESSION_ID --actor-id ADMIN_ID --out local-operations/checkpoint.json
npm run recovery -- checkpoint inspect --checkpoint-id CHECKPOINT_ID --actor-id ADMIN_ID --out local-operations/checkpoint-review.json
npm run recovery -- checkpoint compare --plan local-operations/checkpoint-review.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID
npm run recovery -- checkpoint apply --plan local-operations/checkpoint-review.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID --reason 'Reviewed mistaken correction' --client-key 611a19be-3d0a-4d80-bdf2-bc7ace21445d
npm run recovery -- checkpoint receipt --receipt-id RECEIPT_ID --actor-id ADMIN_ID
```

The same website zero-or-one later-event rule applies across the entire chain.
Admin/Head review ordinary restoration; program-refresh restoration requires Head
authority. Coordinator proposals retain the exact reviewed fingerprint. An operator
can handle a longer supported chain but cannot bypass current restrictions or
unknown evidence. Review delivery dispositions: stopped pending work, previously
observed notices, sent mail and in-flight uncertainty mean different things.

Attendance restoration recalculates the complete merged block and requests fresh
discrepancy review. Card restoration creates a new review. A closed signup produces
an owner-review draft; the owner must submit it through normal intake, current
policy agreement and mailbox verification. A recovery receipt can therefore mean
that owner action is still required, rather than participation is already active.

## Stage a whole-site logical backup

Whole-site staging is a separate operator operation. The current backup script
produces logical `.sql.gz` dumps. Continuous WAL coverage is not configured by this
feature, so it does not offer arbitrary-time point-in-time recovery.

Provision an isolated PostgreSQL instance first. Keep it loopback-only and keep
every application instance, background worker and outbound delivery path away
from it. Use a different local port from a local source database. Set
`RECOVERY_DATABASE_URL` to that instance's maintenance database with a dedicated
operator role, different from the source application's database username. The
operator needs permission to create databases, restore the dump's ownership and
set database connection fences. Install compatible `pg_dump` and `psql` tools on
the operator host; these executables are not added to the web runner image.

On the staging instance, provision the source application's database role with
the same name as a **NOLOGIN**, unprivileged role so the trusted dump's ownership
statements can succeed. The tool requires this role to have no superuser,
create-role, create-database, replication or bypass-RLS privileges. Provision any
other ownership roles required by the dump under the same isolation policy.
`site stage` does not create or change PostgreSQL roles automatically. Isolated
rollback later retires only its exact, validated, generated source database role.

Use only a trusted operator-produced backup: a SQL dump is executable database
input. Keep the chosen file immutable during planning and staging. Create a
private evidence parent directory outside both databases with enough space for
a current-site dump and the staging database. Keep Windows filesystem ACLs
restricted to the operator; POSIX file modes alone do not configure Windows ACLs.

```bash
npm run recovery -- site plan --backup backups/SITE-TIMESTAMP.sql.gz --target-name shbs_recovery_rehearsal --evidence-dir local-operations/recovery-evidence --out local-operations/site-plan.json
npm run recovery -- site stage --plan local-operations/site-plan.json --plan-hash REVIEWED_SHA256 --reason 'Isolated recovery rehearsal'
```

Planning decompresses and hashes the backup, confirms the target does not exist,
checks endpoint/role isolation, and records current public-table counts in a
read-only transaction. It does not create a database. The compressed input is
bounded to 2 GiB and decompressed SQL to 8 GiB. Prepare a separately reviewed
procedure for larger backups.

Staging validates the plan and backup again, writes an external intent, saves a
complete current-site custom-format `pg_dump`, creates the fresh target, restores
with `psql` in one transaction, records table-count comparison and then sets
`ALLOW_CONNECTIONS false` on the staging database. It never changes the live
database URL, restores over an existing database, runs migrations or starts Next.
The receipt's `SEALED_STAGING_ONLY` state means the database is fenced and **not
eligible for application startup**. Counts show structural differences; equal
counts do not prove equal records or a correct restoration.

Evidence is stored under `EVIDENCE_DIR/PLAN_ID/`: `intent.json`,
`current-site.dump`, its hash in `current-evidence.json`, and `receipt.json`, or
`failure.json`. The current dump
contains sensitive site data and credential hashes. Protect it like a backup,
retain it outside the restored database, and follow the deployment retention
policy. JSON diagnostics never print passwords or subprocess stderr.

A failed restore is fenced when possible and retained for diagnosis. Do not
delete its intent to replay the same plan. Review the failure and choose a new
plan and fresh target. `STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION` means the
operator must immediately fence the isolated instance before further work.

## Reconcile security and rehearse isolated cutover

Staging does not authorize startup. Each later phase has a separate plan and
receipt. Run `site reconcile-plan`, `site acceptance-plan`, `site cutover-plan`
and `site rollback-plan` with the preceding phase's `--plan`, `--plan-hash`,
`--receipt`, `--receipt-hash` and a new `--out`. Acceptance planning also takes
`--actor-id SYNTHETIC_USER`; cutover planning takes `--pointer-path FILE`.
Apply a reviewed phase with the corresponding verb without `-plan`, its plan/hash
and `--reason`. `npm run recovery -- --help` lists the exact forms.

Reconciliation preserves a fresh, snapshot-bound copy of current security state,
checks stable source identity closure, overlays current restrictions and independent
grants, disables old passwords and advances session generations. It invalidates
bearer capabilities, quarantines deferred work and preserves sent/accepted/uncertain
delivery evidence. Unknown identity/security schema changes block reconciliation.
Signing-key rotation uses `RECOVERY_PREVIOUS_AUTH_SECRET` and
`RECOVERY_ROTATED_AUTH_SECRET`; only their fingerprints enter plans and receipts.

Acceptance, cutover and rollback are restricted to synthetic loopback
`shbs_*_test` environments. `RECOVERY_APPLICATION_URL` identifies a separately
provisioned read-only application role; `RECOVERY_FRESH_TEST_PASSWORD` is a fresh
synthetic credential. Acceptance and rollback also require a trusted matching
Next standalone build at `.next/standalone`, with `.recovery-checkout.json` binding
its checkout SHA. Set `RECOVERY_REHEARSAL_CHECKOUT_SHA` to that exact revision
(the hosted workflow uses `GITHUB_SHA`). The genuine Next/Auth.js probe runs only
on an owned disposable writable clone with a loopback SMTP sink. It proves a
fresh login before independently rejecting old keys and session generations;
the receipt distinguishes observed notification-worker delivery from unchanged
restored queues. Synthetic capability fixtures additionally prove valid access
before restoration and rejection afterward.

Cutover atomically changes an exact reviewed deployment pointer and permits only
that verified read-only target (`READ_ONLY_NO_OUTBOUND`). Clone acceptance does
not activate a writable production application.
The password-only synthetic harness refuses accounts requiring two-factor
authentication. An optional `RECOVERY_CHECKPOINT_AUTH_SECRET` supplies the distinct
old backup signing key for the rejection proof; it is never saved in receipts.

Rollback uses `RECOVERY_ROLLBACK_DATABASE_URL` and
`RECOVERY_ROLLBACK_APPLICATION_URL`, a second signing-key rotation and a fresh
synthetic password. It preserves the newest target security onto the original
retained-business fixture, invalidates credentials again, switches the pointer
back and fences the previous target. A rollback never copies old credentials back.
Same-intent receipts and transactional markers support resuming completed stages
after a lost response; stale fingerprints or unrelated pointers remain conflicts.

Retain each phase's external evidence and receipt. Check the real rehearsal report
for measured results; mocked tests and equal table counts do not prove restore or
cutover correctness. Production connectivity, external storage and operational
maintenance remain governed by the [deployment runbook](deployment.md).
