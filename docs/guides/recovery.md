# Selective recovery and operator staging

Use selective recovery to compensate a mistaken admission, participant, workflow,
attendance, card or program-refresh action while preserving independent facts,
historical evidence and existing tutee accounts. See the
[recovery reference](../reference/recovery.md) for journal provenance, trigger
coverage and technical invariants.

## Choose a recovery route

| Scope | Tool | When to use |
| --- | --- | --- |
| Supported single action (0–1 later causal events) | Website: **Data & Recovery → Admission Recovery** (`/admin/recovery`) | Routine reversal; Admin/Head apply directly (Head-only for program refresh), Coordinators submit proposals |
| Supported action with 2+ later causal events, or record inspection | Operator CLI (`npm run recovery -- ...`) inside `app` container or trusted checkout | Longer tracked causal chains, offline plan hashing/comparison, or `records` / `checkpoint` inspection |
| Whole-site logical backup restore & cutover rehearsal | Operator CLI `site *` commands on a trusted host with `pg_dump`/`psql` | Staging a `.sql.gz` backup on an isolated PostgreSQL instance and rehearsing security reconciliation/cutover |

**Data & Recovery → Database records** (`/admin/database`) inspects permitted
current records and safe IDs (read-only).

### Using Admission Recovery in the website

1. Choose the admission or checkpoint and compare **What recovery would change**
   with **What stays unchanged** (**Record identifiers** holds event/record IDs;
   recovery IDs are distinct from application or audit IDs).
2. Independent field-level edits (name/contact, security, suspension, staff/Crew/Translator
   access, workload) remain in place when the journal has complete field coverage;
   admission-only logins are still disabled and existing tutee accounts are preserved.
3. **If the UI refuses or loses contact:**
   - **Changed records:** Use **Review updated consequences** (your typed reason is
     kept) before confirming again.
   - **Already recorded:** **Restoration already recorded** (including an owner-review
     draft) blocks repeat submission.
   - **Uncertain direct response:** Confirm the retained retry with the same
     fingerprint, reason and client key — never invent a new key.
   - **Uncertain Coordinator proposal:** Check **View approval request** before
     resubmitting; approval creation has no automatic replay deduplication.
   - **Access revoked:** Private views conceal immediately until **Retry** freshly
     rechecks every open private view.
4. Older `AuditLog` entries with legacy `undoData` do not prove a causal chain and
   cannot be forced through Admission Recovery; inspect current facts and apply a
   separately reviewed correction. Missing journal coverage blocks both website
   and CLI routes.

## Operator CLI basics

Run from the repository root, `/app`, or inside the production Compose container:

```bash
# Inside production Docker Compose (for records, admission, checkpoint):
docker compose exec -T app npm run --silent recovery -- records tables

# From a trusted source checkout (also required for host-only `site` commands):
npm run recovery -- --help
```

- **Environment:** Pass `DATABASE_URL` via the process environment or `.env`, never
  on the command line.
- **Authority:** Domain commands require a current Admin/Head `--actor-id` (rechecked
  live; `--role` impersonation is rejected). Host access is a separate privilege —
  the CLI does not prompt for a web password.
- **Container vs. host:** `records`, `admission` and `checkpoint` run inside the
  `app` container or checkout. `site *` commands require host `pg_dump` and `psql`
  (not installed in the web image).

## Inspect records

```bash
npm run recovery -- records tables
npm run recovery -- records inspect --table RecoveryAction --limit 25
npm run recovery -- records inspect --table TutorApplication --key '{"id":"APPLICATION_ID"}'
npm run recovery -- records dependencies --table Tutor --key '{"id":"TUTOR_ID"}' --limit 25
```

- Use exact model names and key shapes from `tables` (composite keys as one JSON
  object); pass `nextCursor` to `--cursor` (up to 100 rows per inspect page, 50
  per dependencies page).
- Credentials, invitation codes, tokens, private message bodies and raw JSON
  evidence are always excluded.

## Save, compare and apply an admission restoration

Find the prospective admission's `RecoveryAction.id` via `records inspect`, then
plan, compare and apply (saving plans to an existing private directory; plan files
never overwrite existing files):

```bash
# 1. Capture plan (checkpoint is an alias for inspect) and record printed planHash
npm run recovery -- admission checkpoint --action-id ACTION_ID --actor-id ADMIN_ID --out local-operations/admission-plan.json

# 2. Read-only drift check before applying
npm run recovery -- admission compare --plan local-operations/admission-plan.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID

# 3. Apply restoration (restore is an alias for apply); keep the --client-key UUID
npm run recovery -- admission restore --plan local-operations/admission-plan.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID --reason 'Mistaken interview admission; reviewed with leadership' --client-key 611a19be-3d0a-4d80-bdf2-bc7ace21445d

# 4. Read committed receipt without writing again
npm run recovery -- admission receipt --receipt-id RECEIPT_ID --actor-id ADMIN_ID
```

The server rechecks the causal graph, fingerprint and actor authority inside the
transaction (bypassing only the website's 0–1 later-event cap). Retry an uncertain
response with the **exact same** intent and `--client-key`. Voided admissions
never restore old passwords, codes or sessions.

## Review and apply a scoped checkpoint

Supported adapters: `PARTICIPANT_TUTOR`, `PARTICIPANT_TUTEE`, `STUDENT_WORKFLOW`,
`STUDENT_QUARTER_WITHDRAWAL` (**inspection-only** — always blocks automated apply;
see [recovery reference](../reference/recovery.md#delivery-effects)), `ATTENDANCE`,
`CARD`, and `PROGRAM_REFRESH` (Head-only).

```bash
npm run recovery -- checkpoint capture --adapter ATTENDANCE --source-id SESSION_ID --actor-id ADMIN_ID --out local-operations/checkpoint.json
npm run recovery -- checkpoint inspect --checkpoint-id CHECKPOINT_ID --actor-id ADMIN_ID --out local-operations/checkpoint-review.json
npm run recovery -- checkpoint compare --plan local-operations/checkpoint-review.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID
npm run recovery -- checkpoint apply --plan local-operations/checkpoint-review.json --plan-hash REVIEWED_SHA256 --actor-id ADMIN_ID --reason 'Reviewed mistaken correction' --client-key 611a19be-3d0a-4d80-bdf2-bc7ace21445d
npm run recovery -- checkpoint receipt --receipt-id RECEIPT_ID --actor-id ADMIN_ID
```

- Attendance restoration recalculates the merged block and flags discrepancy review;
  card restoration opens a new review; closed-signup restoration creates an
  owner-review draft that the owner must explicitly submit with current policy and
  mailbox verification.

## Stage and rehearse a whole-site logical restore

Backups are logical `.sql.gz` dumps (no continuous WAL / arbitrary PITR; limits:
2 GiB compressed / 8 GiB decompressed). Use only a trusted operator backup and a
separate loopback PostgreSQL instance (`RECOVERY_DATABASE_URL`, distinct port and
operator role). Pre-create the dump's application owner role on the staging
instance as **NOLOGIN**, unprivileged (`site stage` never creates roles). Keep
the private evidence directory restricted (including Windows ACLs).

| Phase | Plan command | Apply command | Key env vars / inputs | Outcome |
| --- | --- | --- | --- | --- |
| 1. Stage backup | `site plan --backup FILE --target-name DB --evidence-dir DIR --out PLAN` | `site stage --plan PLAN --plan-hash SHA --reason TEXT` | `DATABASE_URL`, `RECOVERY_DATABASE_URL`, host `pg_dump`/`psql` | Saves `current-site.dump`, restores backup to fresh DB, seals `ALLOW_CONNECTIONS false` (`SEALED_STAGING_ONLY`) |
| 2. Reconcile security | `site reconcile-plan --plan P --plan-hash H --receipt R --receipt-hash RH --out PLAN` | `site reconcile --plan PLAN --plan-hash SHA --reason TEXT` | `RECOVERY_PREVIOUS_AUTH_SECRET`, `RECOVERY_ROTATED_AUTH_SECRET` | Overlays current security/restrictions, disables old passwords, rotates keys, revokes capabilities, quarantines deferred mail |
| 3. Acceptance probe | `site acceptance-plan ... --actor-id SYNTHETIC_USER --out PLAN` | `site acceptance --plan PLAN --plan-hash SHA --reason TEXT` | Synthetic `shbs_*_test` only: `RECOVERY_APPLICATION_URL`, `RECOVERY_FRESH_TEST_PASSWORD`, `.next/standalone` + `RECOVERY_REHEARSAL_CHECKOUT_SHA` (or `GITHUB_SHA`), optional `RECOVERY_CHECKPOINT_AUTH_SECRET` | Runs disposable writable clone + loopback SMTP sink verifying fresh login and old-proof rejection (rejects 2FA accounts) |
| 4. Isolated cutover | `site cutover-plan ... --pointer-path FILE --out PLAN` | `site cutover --plan PLAN --plan-hash SHA --reason TEXT` | Synthetic `shbs_*_test` only | Atomically updates deployment pointer to verified `READ_ONLY_NO_OUTBOUND` target |
| 5. Isolated rollback | `site rollback-plan ... --out PLAN` | `site rollback --plan PLAN --plan-hash SHA --reason TEXT` | `RECOVERY_ROLLBACK_DATABASE_URL`, `RECOVERY_ROLLBACK_APPLICATION_URL`, second key rotation + fresh synthetic password | Restores newest security onto original fixture, switches pointer back, fences previous target |

- **Evidence under `EVIDENCE_DIR/PLAN_ID/`:** `intent.json`, `current-site.dump`
  (sensitive — protect like a backup), `current-evidence.json`, and `receipt.json`
  (or `failure.json`). Never delete `intent.json` to replay a failed plan — start
  a new plan and fresh target.
- **`STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION`:** Immediately fence the
  isolated PostgreSQL instance before continuing.
- Staging and synthetic clone acceptance do **not** activate a writable live site.
  See [recovery reference](../reference/recovery.md) for reconciliation invariants
  and [deployment runbook](deployment.md) for production operations.

## Reconcile pretracking archive provenance

Records imported before archive-provenance tracking began have no per-row origin
in the database. Never infer origin from names, dates, inactive status, totals,
or matching emails, and never assume balances were posted to the school ledger.

Keep private import files and origin evidence outside Git in a local
operator-only directory. Extract exact scalar/composite primary keys and
privacy-preserving SHA-256 row hashes offline (no DB connection; skips
reference-only `User.csv`):

```bash
npm run recovery -- provenance extract --input local-operations/pretracking-archive.zip --out local-operations/provenance-candidates.json --evidence-label synthetic-pretracking-2024 --revision DEPLOYED_SHA
```

Or build a strict JSON candidate file directly from retained evidence with exact
primary keys (`action: "MARK_IMPORTED"` or `"RELEASE_IMPORTED"`). Then run a
read-only preview and compare with an active Admin/Head `--actor-id`:

```bash
npm run recovery -- provenance preview --candidates local-operations/provenance-candidates.json --candidates-hash CANDIDATES_SHA256 --actor-id ADMIN_ID --revision DEPLOYED_SHA --out local-operations/provenance-plan.json
npm run recovery -- provenance compare --plan local-operations/provenance-plan.json --plan-hash PLAN_SHA256 --actor-id ADMIN_ID
```

Preview checks blockers without writing:
- Active/live records (`ACTIVE` participants, active-term sessions/pairings,
  pending workflows, upcoming meetings/patrols) and active reference
  configuration (`Term`, `TimeSlot`, `Room`, `Subject`, `SchoolCalendarDay`)
  block.
- Live rows diverging from the original import hash block as possible native
  late corrections.
- `MARK_IMPORTED` blocks if financial sources (`Session`, `ServiceHourAdjustment`,
  `Patrol`) overlap `SchoolHoursSchedule.openingBaseline` or a committed
  `SchoolHoursReport`.
- `RELEASE_IMPORTED` on an archived financial source is allowed only when it
  matches an exact anchored opening/committed owner, component, and amount.

When `applicable: true`, apply the exact reviewed plan with a fresh UUID
`--client-key` and inspect the receipt:

```bash
npm run recovery -- provenance apply --plan local-operations/provenance-plan.json --plan-hash PLAN_SHA256 --actor-id ADMIN_ID --reason 'Reviewed pretracking archive provenance' --client-key 4a55f2c8-851c-4a5d-9b30-2a7e5c4e1201
npm run recovery -- provenance receipt --receipt-id RECEIPT_ID --actor-id ADMIN_ID
```

Apply rechecks live Admin/Head authority, shared writer fences, and current
source hashes in a `Serializable` transaction, updating only
`ImportedRecordProvenance` alongside immutable `ArchiveProvenanceReceipt` and
`AuditLog` entries. Retries with the same `--actor-id` and `--client-key` replay
idempotently; reusing a key with different intent fails.
