# Identity lifecycle and authority inventory

`Person` is directory metadata. A group can contain several original Tutor/Tutee
records and more than one live login awaiting review. Membership, private history,
credentials, restrictions, consent and original evidence keep their own authority.
This inventory is maintained alongside identity writers and readers; it is not a
proposal to replace them with a `personId` authorization check.

Admin and Head can directly perform authorized identity management operations,
including account combination, exact historical ownership correction and guarded
account deletion. The current Head alone can transfer leadership; combination
cannot replace that workflow or bypass the singleton-Head invariant. Coordinator
profile and academic corrections follow the [management review policy](../guides/program-configuration.md#management-responsibilities-and-review);
these requests do not grant identity-combination or private-history access.

## Source writers

| Entry point | Identity initialization / synchronization | Authority and preserved data |
| --- | --- | --- |
| Production administrator bootstrap, [create-admin](../../scripts/create-admin.ts) | Missing User identity in its bootstrap transaction | Period → username → leadership locks; no demo records; retired login recovery remains refused |
| Management/Crew registration, [registration](../../src/server/auth/registration.ts) | Missing new User identity before code redemption commits | Existing verified challenge, invitation rank, actor/recipient checks and credential rules |
| Tutor registration and management Tutor-access grant | Existing [account profile](../../src/server/account-profile.ts) synchronization after the explicit User→Tutor link | Exact source pointers; existing academic/lifecycle/credential and restriction decisions |
| Viewer signup, [viewer-signup](../../src/server/auth/viewer-signup.ts) | Missing new User identity inside the consumed-challenge transaction | No participant or historical access is inferred from the mailbox/name |
| Staff Add Tutor / Add a Tutee, [admin router](../../src/server/api/routers/admin.ts) | New standalone Person created with each source in the same transaction | No login or ownership grant; existing names, status, academic and approval validation |
| Accepted Tutor applications, [promotion](../../src/server/tutors/promote.ts) | New standalone Person; missing legacy roster identity also initialized | Verified-account linking still uses account-profile synchronization; initialization cannot redeem a code or grant participation |
| Public Tutee intake, [student-survey](../../src/server/student-survey.ts) | Materialization creates a standalone Person; verified completion uses retained ownership and account-profile synchronization | Exact intake, submitted time, policy signature, mailbox proof and academic snapshot remain authoritative |
| Program Records preview/import, [record-transfer](../../src/server/record-transfer.ts) | Initialize involved User/Tutor/Tutee references and retained student owners only after all archive references validate | Same rollback transaction as preview/import audit; no imported Person IDs, scope revisions, credentials, invitations or new login accounts |
| Exact historical account setup, [history-account-setup](../../src/server/history-account-setup.ts), [exact-history-invitations](../../src/server/exact-history-invitations.ts) | Missing User directory identity when verified credentials are created; exact claim uses existing ownership synchronization | Creating credentials and claiming frozen historical sources remain separate; no current participation/consent is fabricated |
| Current profile edit/relink, [account-profile](../../src/server/account-profile.ts) | `syncAccountPerson` | Explicit current pointers; canonical name mirrors remain a separate write from directory metadata |
| Historical Tutor/Tutee claim or correction, [tutor-history](../../src/server/tutor-history.ts), [tutee-history](../../src/server/tutee-history.ts), [student-ownership](../../src/server/student-ownership.ts) | `syncParticipantPerson` inside the authorized ownership transaction | Correction moves the exact source only; it does not combine the former/new owners' unrelated groups |
| Combine Records, [person-combine](../../src/server/person-combine.ts) | Reviewed plan and atomic receipt | Admin/Head authority, current-password confirmation where required, actor rules, fresh revisions, explicit retirement and retained original actors; unresolved work keeps review state |
| Account deletion, [delete-account](../../src/server/delete-account.ts) | Existing guarded delete clears the primary pointer | Combined families and retained history remain protected; empty Person metadata may remain for review |
| Departure, return, restrictions and current participation | Existing [school departure](../../src/server/school-departure.ts), [membership](../../src/server/membership.ts) and domain workflows | Do not create or join Persons merely to restore eligibility; consent, deadlines, assignments and qualifications are separate decisions |

The missing-source helper
[person-source-initialization](../../src/server/person-source-initialization.ts)
requires the caller's transaction and the username namespace fence. It uses only
current pointers, explicit retained ownership and recorded credential-retirement
edges. A source with existing metadata is left untouched, including metadata that
reconciliation would flag. A missing account may adopt one existing explicitly
owned source group. Two established groups or contradictory current/retained
owners require reviewed correction or Combine Records; initialization does not
choose an owner or join those groups.

Source association uses the narrow metadata assignment primitive, preserving
Tutor/Tutee `updatedAt`, original names, academic/period evidence, signatures and
edit versions. Identity-specific revisions still advance when membership or
ownership changes, so pending reviews cannot survive an A→B→A change. A retry of
an already initialized source does not advance revisions. Initialization failure,
preview rollback or later audit failure rolls back its Person writes as well.

Synthetic seed/test fixtures may deliberately contain missing or inconsistent
metadata to exercise compatibility. They are not production provisioning paths.
Raw SQL or external writers are outside this inventory and must be reconciled
before enabling a cutover; do not silently add them to trusted source writers.

## Reader authority

| Reader / action | Authoritative IDs | Directory grouping effect |
| --- | --- | --- |
| [Users directory and details](../../src/server/account-directory.ts), [member filters](../../src/lib/user-filters.ts) | Explicit Person members plus each member's own filter facts | Deduplicates presentation; never combines two members' privileges into one filter match |
| [Authentication](../../src/server/auth/index.ts), [session version](../../src/server/auth/session-version.ts), [TRPC procedure guards](../../src/server/api/trpc.ts) | Live User credentials/session generation and current role/capability | Person is not a login principal; retired credentials remain unusable |
| [Membership projection](../../src/lib/account-membership.ts), Tutor/Tutee workspaces | User current participant pointers, membership bits, status and domain eligibility | Grouping supplies no Tutor/Tutee/management/translation capability |
| [Personal Tutor history](../../src/server/personal-tutor-history.ts), [Tutee ownership](../../src/server/student-ownership.ts), staff historical details | Exact current/retained ownership; explicit retired User family where that reader supports it | Unrelated live logins in one Person do not share private history |
| [Messages](../../src/server/api/routers/messaging.ts), [Crew history](../../src/server/api/routers/crew.ts), [approval](../../src/server/api/routers/approval.ts), [translation review](../../src/server/api/routers/translation-review.ts) | Original User actor/recipient IDs plus [recorded retirement family](../../src/server/account-history.ts) | No Person-based private-read expansion; original authorship remains unchanged |
| [Policy acceptance](../../src/server/policy-acceptance.ts), account and participation policy readers | Existing acceptance evidence and recorded retired account family | Grouping is not a signature and cannot manufacture agreement or reset deadlines |
| [Attendance](../../src/server/attendance-approval.ts), assignments, service-hour and qualification workflows | Exact Tutor/Tutee, assignment, term and evidence IDs | Repeated historical profiles stay separate; no assignment or qualification transfer is inferred |
| [Patrol credit](../../src/server/crew/patrol-credit.ts) | Original actor/evidence IDs and retired family under its owner lock | Prevents repeated credit while retaining original awards; no credit rewrite during initialization |
| [Departure](../../src/server/school-departure.ts), suspension, request invalidity and restoration | Existing account, participant, request and period state | Operational review can point to the owning workflow; grouping cannot remove a restriction |
| Identity previews, receipts and [operational review](../../src/server/person-operational-review.ts) | Explicit source graph, revisions and current domain work | Read-only refresh does not finalize review; an authorized fresh write must recheck evidence |
| Historical invitation and claim recovery, [exact-history-invitations](../../src/server/exact-history-invitations.ts) | Actor-bound delivery operation ID; secret claim-token digest plus the recorded live account, credential generation and exact retained ownership | Recovery reads do not resend SMTP, replay a claim or use Person membership as access |

## Frozen historical invitations and claim receipts

Admin/Head can review one historical Tutor or an exact set of historical Tutor/Tutee
sources already in one reviewed group. The preview reports stable blocking reasons
for unreviewed grouping, nonhistorical sources, current assignments/pending work,
conflicting accounts and incomplete credentials. Staff resolve those conditions in
their existing workflows and request a fresh preview; this invitation path does not
transfer assignments, qualifications, restrictions or policy acceptance.

When an exact invitation blocks participation finalization, the review keeps a
separate cancellation control for that invitation's original source set. Adding
or removing group members cannot widen that set. Cancellation uses a fresh scope
revision; an accepted cancellation clears the participation preview and requires
an explicit fresh review. It never finalizes the group automatically. Legacy
Tutee invitations retain their original Tutees workflow.

The additive `HistoricalRecordInvitation` stores the selected typed source IDs,
recipient and issuer credential bindings, source/group ownership generations and a
hashed token. Later group members never join its scope. Source/group revisions also
advance for removal-and-restoration and owner A→B→A transitions without changing
original source `updatedAt` or historical evidence. Existing `TuteeHistoryInvitation`
rows and delivery attempts keep their original tokens and challenge format through
the explicit adapter in [history-account-setup](../../src/server/history-account-setup.ts).

Delivery commits an inert `HistoricalRecordInvitationAttempt` before SMTP, then
rechecks authority, scope and predecessor setup/envelope progress before publication.
A failed or superseded candidate retains the predecessor. The actor-bound operation
receipt remains readable after later replacements; a lost response is reconciled by
read, never by sending again. Credentials still require the separate mailbox challenge
and shared account invitation review. Creating a neutral login does not claim sources.

Both legacy and exact claims atomically write `HistoricalRecordClaimReceipt` with
ownership and audit. It stores a token digest, exact source IDs and the receiving
account/credential generation, never a raw token. `inspectClaim` can report
`claimed: true` after an accepted claim even when the original grant was consumed or
replaced. Every such read rechecks the account, mailbox and each retained owner;
correcting a source away immediately denies that receipt's detail. The legacy claim
mutation remains single-use. A receipt is recovery evidence, not an ownership grant.
Subset claims may synchronize directory metadata for siblings but private readers
continue to expose only explicitly owned sources and existing retired-account families.

## Read-only reconciliation

From a trusted checkout with the deployed schema and generated Prisma client,
configure the intended database through the normal environment and run:

```sh
npm run --silent identity:reconcile > identity-reconciliation.json
```

The production image also ships this command and its runtime dependencies:

```sh
docker compose exec -T app npm run --silent identity:reconcile > identity-reconciliation.json
```

Use `--silent` so npm's script headers do not precede the JSON report. The image
smoke exercises both clean exit `0` and findings exit `2` with only the database
environment; no application authentication configuration is required by the CLI.

The command takes no arguments. It reads one PostgreSQL `REPEATABLE READ`,
`READ ONLY` transaction, prints JSON to stdout and disconnects. Exit status is `0`
when no findings were detected, `2` when findings need review, and nonzero on an
execution error. It has no repair, merge, backfill or production-mutation mode.
Keep its output in an access-controlled operator location: stable source IDs are
still internal metadata even though names, mailboxes, passwords, tokens, signatures
and message contents are excluded.

The report contains stable counts, typed findings and two separate projections:
each source's direct/canonical Person, and its explicit current/retained owners
resolved through credential retirement. Equal display groups are never treated as
equal private owners. A separate `historyReaderUserIds` projection reflects the
actual difference between Tutor family reads and exact Tutee owner reads. Normal
combination transfers retained Tutee ownership; legacy/imported links still naming
a retired owner are flagged when the surviving Tutee reader cannot reach them.
The report does not transfer those links. It detects:

- Missing Person associations, dangling Person/owner/source references and empty
  unredirected Persons. Empty metadata after a legitimate delete/correction is a
  review finding, not permission to discard receipts or history.
- Person redirects and account-retirement cycles, including missing targets and
  sources still attached to redirected groups.
- Conflicting current/retained owners after retirement-family resolution.
- Missing/invalid primary accounts, a grouped state with multiple live logins,
  ownership/retirement projections that disagree with directory metadata, and
  historical owner links that disagree with the live private reader's projection.

The implementation lives in
[person-reconciliation](../../src/server/person-reconciliation.ts) and the
[CLI](../../scripts/reconcile-person-sources.ts). The report cannot establish that
two humans are the same person, that an external writer is safe, or that active
work/qualifications/consent should move. It does not inspect private message bodies,
calculate every authorization query, or resolve general split/reviewer policy.

## Cutover comparison and rollback limits

1. Back up the full database, apply the reviewed migrations in an isolated copy,
   and record the application/schema revisions. Program Records CSVs are additive
   archives, not a backup of operational identity decisions, credentials or receipts.
2. Capture reconciliation before and after the candidate writer changes using the
   same frozen dataset. Compare source-ID sets, owner families and original source
   evidence. Names and mailboxes are not comparison keys.
3. Investigate every new conflict, cycle, primary error or projection mismatch.
   Use existing exact ownership correction/Combine Records with the required
   authority and evidence. The command never repairs a production database.
4. Check directory presentation and the actual private readers independently:
   two live logins grouped for review must still see only their own history,
   messages, signatures and capabilities. Test retries and rollback before rollout.
5. Keep source IDs, immutable retired-account edges, reservations and receipts.
   Roll back through a compatible corrective release. Deleting Person metadata,
   weakening guards, restoring retired credentials, or running old writers that
   omit identity fences is not a safe rollback.

The safe continuation leaves active-assignment/qualification transfer, general
split, and new reviewer/request-routing policy outside its scope. Keep the broad
identity lifecycle tracker open until those choices are reviewed and implemented.

## Coverage matrix

| Contract | Behavioral coverage to run | Separate evidence |
| --- | --- | --- |
| Missing-source initialization, explicit owners, no implicit group merge, source evidence, idempotency, concurrent initialization and rollback | [Initialization database tests](../../src/server/person-source-initialization.test.ts) | Compare actual database source versions; these tests do not prove SMTP or UI behavior |
| Deterministic findings, orphan/conflicting owners, cycles, primary and projection mismatches | [Pure reconciliation tests](../../src/server/person-reconciliation.test.ts); read-only database test in the initialization suite | Run the CLI against an isolated migrated copy and retain its exit code/report |
| Archive preview rollback, import source identities, explicit owners, unchanged source timestamps, stable retries and excluded operational fields | [Record-transfer router tests](../../src/server/api/routers/record-transfer.test.ts) | Archive preview is a rolled-back write transaction, not the read-only reconciliation command |
| Normal provisioning and authorization | [Registration](../../src/server/auth/registration.test.ts), [Viewer signup](../../src/server/auth/viewer-signup.test.ts), [student survey](../../src/server/student-survey.test.ts), [staff creation](../../src/server/academics.test.ts), [promotion](../../src/server/profile-name-policy.test.ts), [request validity](../../src/server/request-invalidity.test.ts) | Existing workflow checks remain required alongside the new helper tests |
| Grouping, original actor families, permissions and exact ownership correction | [Person combine](../../src/server/person-combine.test.ts), [directory](../../src/server/account-directory.test.ts), [Tutor history](../../src/server/tutor-history.test.ts), [Tutee history](../../src/server/api/routers/tutee-history.test.ts) | Actual EN/ZH desktop/mobile review and recovery flows are captured in the change report |
| Credential and invitation compatibility | [History setup](../../src/server/history-account-setup.test.ts), [delivery](../../src/server/tutee-history-delivery.test.ts), [exact invitations](../../src/server/exact-history-invitations.test.ts) | Frozen source membership, mailbox proof, publication rollback and lost-response reads need their own tests |
| Exact and legacy claim recovery, subset privacy, source/credential A→B→A, competing claim/correction, delivery/cancellation overlap and audit rollback | [Exact invitation database tests](../../src/server/exact-history-invitations.test.ts), [legacy history API tests](../../src/server/api/routers/tutee-history.test.ts) | Database tests use synthetic mail; actual EN/ZH setup/claim and read recovery screenshots remain separate browser evidence |

This matrix lists required coverage, not a statement that a particular revision
passed. Record exact commands, source revision and outcomes in the PR and local
HTML evidence report. Follow the shared runtime lease and
[resource safety](../contributing/local-development.md#worktree-and-resource-safety)
when running tests, CLI/database work, build or browser verification.

[Technical reference](README.md) · [Deployment](../guides/deployment.md#unified-person-identity-migration).
