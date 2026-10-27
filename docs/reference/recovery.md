# Recovery contracts

The [operator guide](../guides/recovery.md) owns command usage and whole-site
procedures. This reference describes the implemented trust and data boundaries.

## Supported causal restoration

RecoveryAction is prospective provenance for an interview admission.
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
accounts. A learning partner's account may appear in the transitive journal after
an independent edit, but that does not make it a login created by this admission.
Independent password changes do not preserve a login whose only authorization was
the voided admission. Inactive tutors continue to use zero workload under the
existing lifecycle rule; the later preference remains in immutable history.
Adapter revision 2 is included in the plan fingerprint, invalidating older previews.

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

The management website uses `/admin/recovery` for eligible admission plans and
`/admin/database` for permitted current-record inspection. Admin and Head apply
directly; Coordinator recovery writes enter ordinary Admin/Head proposal review.
Queued proposals retain the original fingerprint and recheck the graph when a
reviewer applies them. Inspection does not authorize arbitrary record mutation.

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

Record inspection uses the shared model-specific safe field policies. Operator
authority does not remove masking. Safe AuditLog and Recovery* identifiers allow
chronology/relationship investigation; JSON snapshots, private evidence and
credential fields are excluded from row selection. Newly added models have
metadata-only access until their safe policy is explicitly reviewed.

## Whole-site staging boundary

[The staging service](../../src/server/recovery/operator-site.ts) accepts a trusted
gzip-compressed plain PostgreSQL dump matching the current backup script. It
checks the gzip stream, PostgreSQL header, compressed/decompressed bounds and
content hash. No WAL/PITR service, storage restore, schema migration, security
reconciliation or live cutover is implemented by this command.

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
and an explicit PostgreSQL environment. Credentials use environment variables;
stdout is streamed with a size bound, stderr is consumed without printing, and a
ten-minute deadline terminates only that child tool. Errors use stable codes.
The operator supplies compatible PostgreSQL tools; the web runtime does not
contain them by default.

The service creates a fresh target, revokes PUBLIC database connectivity, restores
through `psql --no-psqlrc --single-transaction` with `ON_ERROR_STOP`, compares
public-table counts and then sets `ALLOW_CONNECTIONS false`. It never overwrites
or drops a database. Failure attempts the same fence and writes a failure receipt;
a failed fence has a distinct actionable error. A lost host/process can interrupt
this sequence, so infrastructure isolation remains required even before a receipt.

The restored database can contain old website passwords, sessions and grants.
Connection fencing prevents normal startup; it is not a security-state
reconciler. Reopening/cutover remains blocked until the manual procedure in the
guide has preserved revocations, invalidated restored credentials/tokens, reviewed
external effects and approved the resulting state. Count comparisons are aggregate
inspection only and cannot establish semantic equivalence.

## Verification boundaries

The journal captures committed row changes in an AFTER ROW trigger. A skipped
`ON CONFLICT DO NOTHING` insert does not count as an event. Both old and new
foreign-key values enter scope discovery. A `RecoveryFence` revision rejects a
stale Serializable snapshot after waiting for another writer. Coverage requires
the expected trigger function and event mask, origin replication mode, and a
trigger enabled for ordinary writes; merely finding its name is insufficient.

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
CI runs the standalone tooling tests alongside the ordinary checks; the real
two-instance staging rehearsal remains an explicit operator verification.
The opt-in [PostgreSQL staging rehearsal](../../scripts/recovery-postgres.test.ts)
requires two caller-owned isolated loopback clusters with distinct ports,
`shbs_*_test` maintenance databases and compatible PostgreSQL tools. Set
`SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL` and `SHBS_RECOVERY_TEST_STAGING_ADMIN_URL`,
then run it serially with `node --import tsx --test scripts/recovery-postgres.test.ts`.
It creates random synthetic fixture databases and roles, performs the real
dump/restore/fence sequence and cleans up only those fixtures. It never starts
PostgreSQL or resets a supplied database; it skips when those variables are absent.
Neither mocked tool tests nor aggregate counts establish a production restoration
rehearsal, PostgreSQL tool-version compatibility or cutover acceptance.
