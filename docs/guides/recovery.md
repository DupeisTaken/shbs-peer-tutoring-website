# Selective recovery and operator staging

Use selective recovery when an interview admission was mistaken. The system
removes the consequences of that admission while retaining independent facts,
historical evidence and existing learning-partner accounts. Read the proposed
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
inactive tutors still have zero workload. Existing learning-partner accounts are
preserved. A transaction that also changes ownership, unsupported participation or
other unrecognized fields still needs a separate review. Older edits without the
new field-name evidence cannot be assumed harmless.

If the records change while you review, your reason remains typed, but recovery is
disabled. Use **Review updated consequences**, inspect the new effects, then confirm
again. A failed refresh preserves your reason and offers a read-only retry.

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
```

Use the exact model name, key fields and available status reported by `tables`.
Composite keys use one JSON object. Copy a record reference from the website and
place its `table` and `key` values in these explicit options; never execute an
unreviewed copied command. Pages contain at most 100 rows. Supply the returned
`nextCursor` to `--cursor` to continue. The inspector excludes credentials,
invitation codes, tokens, private message bodies and unreviewed JSON evidence.
An unsupported table exposes metadata only. The CLI preserves those exclusions;
it has no full-secret output flag.

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
preserves independent participation, independent grants and learning-partner
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
The tool does not create or change PostgreSQL roles automatically.

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

## Cutover remains a separate reviewed procedure

There is no automated whole-site cutover or security-state reconciler. Keep the
target fenced until an operator has completed all of the following:

1. Preserve the current database and external incident/recovery evidence. Confirm
   the intended backup, business checkpoint, schema and application revision.
2. Review restored records using isolated read-only PostgreSQL tools, explicitly
   controlling any temporary reopening of the staging database. Do not use the
   normal container entrypoint: it deploys migrations, and Next instrumentation
   and ordinary reads can start workers or materialize records.
3. Reconcile current suspensions, retirements, departures, grant/invitation
   revocations and every other security decision after the backup. Invalidate
   restored sessions and all one-time authentication/invitation/reset tokens.
   Never revive a previous password or access grant merely because it existed
   in the backup. Require fresh credential authorization before enabling access.
4. Reconcile post-backup business events and external effects, including mail,
   notifications, files and storage that are outside a database dump. Establish
   that an application startup cannot replay deliveries or deadlines.
5. Review the resulting difference report and recovery evidence with program
   leadership. Plan an explicit maintenance window, rollback target, isolated
   acceptance checks and controlled reopening before changing live connectivity.

These steps are operational blockers, not guarantees supplied by `site stage`.
Keep the source site unchanged until they are resolved. See the
[deployment runbook](deployment.md) for existing backup and deployment practices.
