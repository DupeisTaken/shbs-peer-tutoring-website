# Identity lifecycle and authority inventory

`Person` is directory metadata. A group can contain several original Tutor/Tutee
records and more than one live login awaiting review. Membership, private history,
credentials, restrictions, consent and original evidence keep their own authority.
This inventory is maintained alongside identity writers and readers; it is not a
proposal to replace them with a `personId` authorization check.

After participation transfer, a former tutor login can retain its `TUTOR` role
while its effective tutor link is revoked. The signed-in landing route sends that
login to `/history`, preventing a loop through the tutor layout. Management and
crew destinations, current tutee membership, and suspension precedence remain
independent of that fallback.

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
| Separate mistakenly grouped records, [person-partition](../../src/server/person-partition.ts) | Exact complete ownership components move to a new Person with an immutable receipt | Admin/Head and current password; current pointers, retained ownership and permanent retirement families remain intact; both results require fresh participation review |
| Correct retired-source history, [person-history-correction](../../src/server/person-history-correction.ts) | Versioned exact original-source and legacy-row ownership, with immutable before/after receipt | Admin/Head and password; retired credentials, original actors, signatures and completed evidence stay unchanged; explicit quarantine withholds private access |
| Merge active participation, [person-participation](../../src/server/person-participation.ts) | One chosen active Tutor/Tutee, exact successor assignments and published execution mappings | Reviewed concrete qualification tuples, preferences, restrictions, original intake priority and consent/deadline evidence; source profiles and completed records remain inspectable |
| Account deletion, [delete-account](../../src/server/delete-account.ts) | Existing guarded delete clears the primary pointer | Combined families and retained history remain protected; empty Person metadata may remain for review |
| Departure, return, restrictions and current participation | Existing [school departure](../../src/server/school-departure.ts), [membership](../../src/server/membership.ts) and domain workflows | Do not create or join Persons merely to restore eligibility; consent, deadlines, assignments and qualifications are separate decisions |

The missing-source helper
[person-source-initialization](../../src/server/person-source-initialization.ts)
requires the caller's transaction and the username namespace fence. It uses only
current pointers, explicit retained ownership and authoritative effective history
ownership. A source with existing metadata is left untouched, including metadata that
reconciliation would flag. A missing account may adopt one existing explicitly
owned source group. Two established groups or contradictory current/retained
owners require reviewed correction or Combine Records; initialization does not
choose an owner or join those groups.

A missing retired account may inherit only its explicit current reader's unredirected
Person. Missing/quarantined mapping instead creates a review-required group with no
live primary account. If the reader points to a redirected group, initialization rejects
the new association for reconciliation; it does not follow that redirect or repair
existing metadata. Already initialized sources remain untouched.

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
| [Messages](../../src/server/api/routers/messaging.ts), [Crew history](../../src/server/api/routers/crew.ts), [approval](../../src/server/api/routers/approval.ts), [translation review](../../src/server/api/routers/translation-review.ts) | Original User actor/recipient IDs plus [effective original-source ownership](../../src/server/account-history.ts) | No Person-based private-read expansion; replies use the reviewed live reader while original sender attribution remains unchanged |
| [Policy acceptance](../../src/server/policy-acceptance.ts), account and participation policy readers | Historical display uses effective ownership; current consent uses its intersection with permanent retirement-family evidence | A corrected reader does not gain another original account's current consent merely by receiving private historical evidence |
| [Attendance](../../src/server/attendance-approval.ts), assignments, service-hour and qualification workflows | Exact Tutor/Tutee, assignment, term and evidence IDs | Repeated historical profiles stay separate; no assignment or qualification transfer is inferred |
| [Patrol credit](../../src/server/crew/patrol-credit.ts) | Original actor/evidence IDs and retired family under its owner lock | Prevents repeated credit while retaining original awards; no credit rewrite during initialization |
| [Departure](../../src/server/school-departure.ts), suspension, request invalidity and restoration | Existing account, participant, request and period state | Operational review can point to the owning workflow; grouping cannot remove a restriction |
| Identity previews, receipts and [operational review](../../src/server/person-operational-review.ts) | Explicit source graph, revisions and current domain work | Read-only refresh does not finalize review; an authorized fresh write must recheck evidence |
| Historical invitation and claim recovery, [exact-history-invitations](../../src/server/exact-history-invitations.ts) | Actor-bound delivery operation ID; secret claim-token digest plus the recorded live account, credential generation and exact retained ownership | Recovery reads do not resend SMTP, replay a claim or use Person membership as access |

## Reviewed directory separation

**Users & Roles → User details → Combined records → Separate mistakenly grouped
records** reviews an exact subset and shows both resulting identities. The source
read includes retired login records even though ordinary directory account actions
hide those credentials. A selection must leave at least one source on each side.
The preview identifies any current-owner, retained-owner or effective history-reader
edge crossing the proposed split. Staff must select the complete component or use
an independently authorized ownership/access correction; grouping metadata never
cuts private access by itself.

The password-confirmed write uses the same period, username and account locking
order as combination and rechecks the complete source graph and monotonic revisions.
It creates a new Person instead of reviving a redirected identity. Participant
timestamps, original names, academics, signatures, assignments, restrictions and
credentials remain unchanged. Both resulting identities enter `REVIEW_REQUIRED`;
directory separation is not participation finalization.

`PersonPartitionReceipt` and the audit commit atomically. Its exact source list,
actor and reviewed intent remain immutable. An uncertain response first reads the
actor-bound receipt. If none exists, an explicit retry requires a fresh password
and resends the same frozen operation ID and intent. A delayed original request
and retry therefore produce at most one separation. Accepted writes only retry
directory reads when synchronization fails; changing displayed groups does not
discard the retained controller's receipt.

While an identity write or its outcome recovery is pending, User details disables
sibling profile/record openers and parent read retries as well as dismissal.
Receipt recovery stays available in the original controller; opening a nested
reader must not hide those controls behind another busy dialog.

The dedicated `recovery_capture_person_partition()` journal matches typed affected
Person/User/Tutor/Tutee references, never the reviewer's ID as a generic edge. It
records only safe references and changed field names; private drafts, operation
hashes and credentials are excluded. Related corrections remain unsupported
recovery descendants. Compensation suppresses only its named root, retaining
effects visible to any other root. The recovery catalog and coverage inventory
register this exact function and the receipt's limited inspector fields.

## Retired-source history and access correction

`User.mergedIntoId` permanently disables credentials. It does not define mutable
private ownership. `RetiredHistoryOwnership` maps each retired original User to
one live reader or explicit quarantine, with a monotonic revision. Migration
backfills each recorded retirement chain to its terminal live reader; cycles,
missing/voided terminals become quarantine. After cutover a missing mapping denies
access. The retirement trigger initializes a new source and retargets incoming
reader mappings atomically. B → A → D therefore produces independent B → D and
A → D reader assignments; correcting only B to C cannot move A's evidence.

The directory correction inventory shows every potentially affected exact profile,
notification and withdrawal restriction. Old combines sometimes rewrote recipients
without per-row provenance; matching names, addresses or timestamps cannot repair
that missing evidence. Staff choose Retain, Assign or Quarantine for every row.
The Admin/Head-only inventory labels notifications with their original title and
exact record ID, retaining an event/type fallback for blank titles. It does not
project notification bodies or private event payloads into that review.
Retain freezes the actual previous reader even when its raw owner is a selected
retired source. Current operational profiles require the participation transfer
review rather than a historical-only owner change. New combines freeze exact
original profile-ownership transfers in their receipt and preserve raw notification
and withdrawal-block recipients.

`HistoryRowOwnership` preserves exact legacy decisions without rewriting original
notice content, actors or restriction evidence. A quarantined notification has no
private reader. A quarantined withdrawal block retains its original email/account
restriction and all unresolved reviewed claimants; repeated quarantine cannot drop
an earlier protected account. Resolving an assigned account projection does not
erase the original blocked email. Exact Tutor/Tutee quarantine removes retained
read ownership and receives a separate review group. SQL guards and provisioning
helpers prevent ordinary relinking from undoing that decision.

`PersonHistoryCorrectionReceipt` retains exact before/after readers, quarantine
restriction sets, per-profile directory groups and typed affected subjects.
Source evidence, signatures, completed lessons, attendance, credits and retired
credentials are unchanged. Suspended or departed records are not excluded from
historical correction; their existing access/participation restrictions still apply.
Recipient setup requires an existing proved account, or history can remain
quarantined while the existing neutral-account setup flow completes.

Private access changes advance server-owned `historyAccessRevision`. The credential
trigger converts that change into a new `sessionVersion`; a plain caller-supplied
session-version increment is not relied on. Session/token/cache identity includes
both generations. Protected query results recheck the sampled access generation;
message/notification read-state writes fence exact ownership inside their transaction.
Visible tabs verify identity every 30 seconds and fail closed after a 10-second
verification timeout. An unauthorized response conceals and clears cached private
content immediately; this is bounded polling, not instantaneous push revocation.

## Active participation execution

The reviewed transfer selects one retained login and at most one active Tutor and
one active Tutee. Original profiles remain evidence. Superseded recurring Pairings
remain intact with explicit current successor assignments. Published plans retain
their original snapshots; separate plan/participant/pending-response execution
records bind the exact reviewed live actors. Source freshness, collision checks,
calendar/delivery, response authorization and attendance must use that same mapping.
Completed lessons and existing response deadlines are never rewritten by transfer.

Qualification transfer materializes only the concrete approved
`sourceSubjectId`/`subjectId` tuples reviewed, retaining their original approval and
grant provenance. It does not run current-catalogue inheritance. Willingness and
availability are explicit source choices, not a union. Original intake terms,
submission/assignment priority and signatures remain on their source records.
Current restrictions, disciplinary consequences and pending lifecycle/consent
decisions remain visible and enforceable. Exact history-access disagreements have
their own explicit acknowledgment inside the active transfer review.

Both new authority workflows use immutable actor-bound receipts and exact frozen
operation retries after uncertain responses. Their safe typed journal function is
`recovery_capture_identity_authority()`. It matches affected entity plus record ID,
not reviewer/approver IDs; journals changed column names and safe references; and
suppresses only the exact compensating root. Identity-authority descendants remain
unsupported by recovery until a complete domain adapter exists.

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
resolved through explicit effective history ownership. Equal display groups are never treated as
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
- Conflicting current/retained owners after effective-reader resolution; missing,
  invalid and quarantined reader mappings are distinct findings.
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

The ordinary directory split preserves complete ownership components. Active
participation and retired-source correction use the separate authority workflows
above. Keep the broad identity lifecycle tracker open until the complete acceptance
matrix and integrated scheduling/recovery contracts are verified.

A canonical learner whose own intake has closed may execute another independent
open request only through that request's exact assignment authority. The writer
stages the reviewed source/request/pairing mapping before adding the physical
roster member; database guards verify its open original source, current intake
term and non-superseded pairing. Missing, released or mismatched maps remain
blocked. This grants no queue authority to the closed original intake: after its
last actual assignment ends, the canonical profile becomes inactive rather than
pending merely because another original request is still open.

The roster guard applies to actual status transitions and membership writes.
Unchanged-status contact edits and history ownership revision updates remain
permitted, even when an original request is flagged. They do not authorize new
assignment or reactivation. The follow-up migration preserves the checksum of
the original participation migration.

Calendar subscriptions resolve exact execution ownership before rendering each
candidate event. Restoring an original profile does not restore calendar access
to a future commitment now assigned elsewhere; event identifiers stay stable for
the current execution owner.

Historical planning reads follow the exact retained/direct private profile owner,
including readers without a current tutor or learner capability. Live agenda and
session actions continue to use the pinned execution authority and current source
restrictions. A private history correction cannot redirect live session authority.

## Optional email copies and original restrictions

History correction inventories exact notification copies separately from the
notification itself. New optional copies carry immutable `sourceNotificationId`;
legacy null origins are unknown and require explicit row review. Copies can be
retained or quarantined, never reassigned or automatically forwarded. Moving a
notification away from its stored email recipient requires quarantining its exact
pending, unadmitted copies. The same ownership fence serializes correction with
transport admission. Started, sent and uncertain copies remain observed effects;
the operation cannot recall mail. An expired started attempt becomes uncertain
instead of silently replaying private content.

Original source suspension and departure restrictions follow exact profile
provenance through later activation and assignment. A correction grants no
participation capability. Admin/Head may record a factual RETURN on a retired
source with fresh password confirmation and its current departure revision. That
operation preserves retired credentials, original profiles and independent
observer revocation. The correction UI links the exact original departure editor;
reload the preview after changing a source fact.

## Coverage matrix

| Contract | Behavioral coverage to run | Separate evidence |
| --- | --- | --- |
| Missing-source initialization, explicit owners, no implicit group merge, source evidence, idempotency, concurrent initialization and rollback | [Initialization database tests](../../src/server/person-source-initialization.test.ts) | Compare actual database source versions; these tests do not prove SMTP or UI behavior |
| Deterministic findings, orphan/conflicting owners, cycles, primary and projection mismatches | [Pure reconciliation tests](../../src/server/person-reconciliation.test.ts); read-only database test in the initialization suite | Run the CLI against an isolated migrated copy and retain its exit code/report |
| Archive preview rollback, import source identities, explicit owners, unchanged source timestamps, stable retries and excluded operational fields | [Record-transfer router tests](../../src/server/api/routers/record-transfer.test.ts) | Archive preview is a rolled-back write transaction, not the read-only reconciliation command |
| Normal provisioning and authorization | [Registration](../../src/server/auth/registration.test.ts), [Viewer signup](../../src/server/auth/viewer-signup.test.ts), [student survey](../../src/server/student-survey.test.ts), [staff creation](../../src/server/academics.test.ts), [promotion](../../src/server/profile-name-policy.test.ts), [request validity](../../src/server/request-invalidity.test.ts) | Existing workflow checks remain required alongside the new helper tests |
| Grouping, original actor families, permissions and exact ownership correction | [Person combine](../../src/server/person-combine.test.ts), [directory](../../src/server/account-directory.test.ts), [Tutor history](../../src/server/tutor-history.test.ts), [Tutee history](../../src/server/api/routers/tutee-history.test.ts) | Actual EN/ZH desktop/mobile review and recovery flows are captured in the change report |
| Complete-component separation, stale reviews, restrictions, audit rollback and immutable receipts | [Partition database tests](../../src/server/person-partition.test.ts), [typed journal tests](../../src/server/person-partition-journal.test.ts), [partition UI tests](../../src/app/_components/person-partition.test.tsx) | Real directory pages and personal readers must be checked separately from mocked UI responses |
| Credential and invitation compatibility | [History setup](../../src/server/history-account-setup.test.ts), [delivery](../../src/server/tutee-history-delivery.test.ts), [exact invitations](../../src/server/exact-history-invitations.test.ts) | Frozen source membership, mailbox proof, publication rollback and lost-response reads need their own tests |
| Exact and legacy claim recovery, subset privacy, source/credential A→B→A, competing claim/correction, delivery/cancellation overlap and audit rollback | [Exact invitation database tests](../../src/server/exact-history-invitations.test.ts), [legacy history API tests](../../src/server/api/routers/tutee-history.test.ts) | Database tests use synthetic mail; actual EN/ZH setup/claim and read recovery screenshots remain separate browser evidence |

This matrix lists required coverage, not a statement that a particular revision
passed. Record exact commands, source revision and outcomes in the PR and local
HTML evidence report. Follow the shared runtime lease and
[resource safety](../contributing/local-development.md#worktree-and-resource-safety)
when running tests, CLI/database work, build or browser verification.

[Technical reference](README.md) · [Deployment](../guides/deployment.md#unified-person-identity-migration).
