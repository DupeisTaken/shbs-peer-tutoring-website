# Technical report

Use this guide to find the code responsible for current behavior and understand the invariants a change must preserve. For setup commands, see [local development](local-development.md); for operating the server, see [deployment](deployment.md).

## Architecture

The application runs as a persistent Next.js 16 / React 19 Node server with tRPC 11, Prisma 7/PostgreSQL, Auth.js JWT sessions, next-intl and Tailwind CSS 4. It is not a static export: background verification deadlines, authentication and database mutations require the server.

| Change you need | Start here |
| --- | --- |
| Add or change a page | [App routes](../src/app), [shared components](../src/app/_components) and [message catalogs](../messages) |
| Add an API operation or access rule | [Router composition](../src/server/api/root.ts) and [procedure middleware](../src/server/api/trpc.ts) |
| Change schema or transactions | [Prisma schema](../prisma/schema.prisma), [migrations](../prisma/migrations), [database client](../src/server/db.ts) and [transaction helpers](../src/server/transactions.ts) |
| Change management review | [Operation classification](../src/lib/approval-policy.ts), [proposals](../src/server/approvals.ts) and [approval router](../src/server/api/routers/approval.ts) |
| Change intake or participation | [Surveys](../src/server/student-survey.ts), [student workflow](../src/server/student-workflow.ts), [ownership](../src/server/student-ownership.ts) and [membership](../src/server/membership.ts) |
| Change profile synchronization | [Account profiles](../src/server/account-profile.ts) |
| Change messaging or recipient access | [Messaging permissions](../src/server/messaging-permissions.ts) and [messaging router](../src/server/api/routers/messaging.ts) |
| Change hours or historical corrections | [Hour calculator](../src/lib/service-hours.ts), [meeting hours](../src/server/meeting-hours.ts) and [corrections](../src/server/api/routers/corrections.ts) |
| Change published content or translations | [Slug allocation](../src/server/home/slugs.ts), [translation destination checks](../src/server/translation-destination.ts) and [policy acceptance](../src/server/policy-acceptance.ts) |
| Change dates or intake labels | [Program time](../src/lib/program-time.ts) and [period display](../src/lib/period.ts) |
| Change delivery or deadline processing | [Email sender](../src/server/email/sender.ts), [instrumentation](../src/instrumentation.ts) and [deadline worker](../src/server/student-deadline-worker.ts) |

## Identity and authorization

Account role, linked tutor profile, crew membership and translator assignment are separate capabilities. Protected requests reload current role, linkage and suspension state. Navigation and client controls do not replace server authorization. Student records require explicit account/profile ownership; a matching name or email never grants access.

| Procedure family | Intended callers |
| --- | --- |
| `publicProcedure` | Public operations with their own input validation and feature gates |
| `protectedProcedure` | Authenticated accounts with current authorization |
| `tutorProcedure` / `activeTutorProcedure` | Linked tutor access / active tutor duties |
| `crewProcedure` | Permitted active crew or management access with the crew module enabled |
| `adminProcedure` | Management; sensitive coordinator mutations enter review |
| `adminOnlyProcedure` / `headProcedure` | ADMIN or HEAD / HEAD only |
| `viewerProcedure` | Permitted management reads with masked VIEWER responses |
| `translatorProcedure` | Explicit assigned translators; management rank does not grant editing access |
| `translationReviewerProcedure` | Management reviewers or assigned translators reading their own drafts |

[Composable membership](../src/lib/account-membership.ts) keeps the exact management rank in `User.role`, tutor identity in `tutorId` with independent `tutorAccessRevoked`, crew lifecycle in `crewStatus`, explicit translation permission in `canTranslate`, and tutee membership in `tuteeMember`. `PolicyAcceptance` remains separate immutable evidence. Viewer exclusivity is validated by the complete membership schema and a database constraint. Legacy mixed Viewer accounts lose read-only management access and retain their explicit participant capabilities; migration never inserts policy acceptance. Outstanding pre-migration registration codes expire because they have no durable Head grant evidence; Head must issue fresh codes.

`admin.setMemberships` applies a complete badge set atomically with identity confirmation. `account.requestMemberships` only queues the caller's own proposal. `HEAD_APPROVAL_OPERATIONS` classifies alternate roster/crew/interview/registration grant paths, and approval replay checks the live Head role. Only Head may provision a new tutor login; sending an existing setup link is still available to management. Existing linked identities/history are preserved when participation is disabled. A tutor entering `/student` must personally accept the current tutee policy, which grants membership in the acceptance transaction; unrelated tutor features do not require tutee consent.

Management draft publication uses a server-only `translationPublicationScope` limited to the validated draft operation and live reviewer identity. It never sets `canTranslate` and cannot authorize subsequent direct edits. Coordinator translator authorization precedes proposal queuing.

The [user filter helpers](../src/lib/user-filters.ts) match composable membership badges. Tutor status applies only to an explicit Tutor-only role inclusion without a Tutor exclusion. Edits and saved-filter restoration normalize away inapplicable status; the matcher independently ignores it as a defensive boundary. Preferences are scoped to the signed-in account. The underlying `admin.accounts` query remains protected by `adminProcedure`; client filters do not provide authorization.

Account names synchronize only to explicitly linked current profiles. Shared profile writers lock the account before roster rows and reject stale versions. Signed agreements, submitted survey names and historical snapshots remain evidence of what was submitted.

Client caches belong to the account, role and tutor link. Navigation and focus changes check the live identity before reusing data. The HTTP proxy removes rejected session cookies before page rendering; API authorization remains in force. Background responses must not restore a prior login after sign-out. Keep `AUTH_SECRET` stable and shared across production instances; diagnose failed sign-ins using [local troubleshooting](local-development.md#troubleshooting).

## Approval transactions

Classify every management write in the [approval policy](../src/lib/approval-policy.ts). Unknown coordinator operations fail closed. A sensitive coordinator write creates an immutable proposal; it has not applied the change.

1. Capture validated input, affected records, active period and a fingerprint of review evidence.
2. Consume the coordinator's confirmation ticket when queuing a ticketed action.
3. Recheck requester/reviewer status, prevent self-review and compare current evidence before approval.
4. Replay the original parser and resolver under reviewer privileges. Ticketed actions require the reviewer's own fresh confirmation.
5. Commit the domain change, proposal decision, related notifications and decision audit together. Competing reviewers cannot apply a proposal twice.
6. Send external email after commit. Delivery failure must remain retryable without undoing an applied assignment.

Use [database scope](../src/server/db-scope.ts) so helpers participate in the enclosing transaction. An independent client escapes rollback. Interview review revalidates panel membership, qualifications and votes while preserving the coordinator chair's result and authorship. Scheduling checks the current chair under the same lock as panel replacement. Interview history and completion live in Tutor Applications; legacy interview routes redirect there. Subject Availability is a separate staff-only route and API, independent of interview enablement. `TutorSubjectWillingness` records explicit per-variant intent with no inferred migration backfill: an absent row means not recorded. Staff writes use coordinator approval; active tutors can update only their own willingness. `availableSubjectIds` intersects explicit willingness with stored approved qualification grants and active subjects, excluding inactive or access-revoked tutors. Callers must still enforce timetable and capacity constraints. Changing willingness never edits approvals, grants or interview records.

Audit events identify actors by stable account ID. Generic mutation summaries record operations without raw passwords or tokens; detailed correction and approval evidence is retained separately. The audit is not a page-access log, and a generic summary does not guarantee that every direct operation and audit insert share one transaction. Review metadata and undo payloads are not exposed to VIEWER accounts.

## Student lifecycle and ownership

The original survey submission determines queue priority. Confirmation creates or links an account without replacing its existing role or password. Account links expire after 24 hours. First assignment of an unverified request starts a fixed seven-day deadline; neither resends nor reassignment extends it.

| Action | Invariant |
| --- | --- |
| Submit or repeat an open survey | Preserve the first payload, timestamp and exact accepted policy snapshot |
| Confirm the email link | Consume a single-use challenge; merely opening a link does not confirm it |
| Resend a link | Failed delivery preserves the usable link; successful delivery replaces it |
| Edit availability | Preserve subjects, priority and assignments |
| Recall an unassigned request | Close it permanently; a later application receives a new request and priority |
| Approve withdrawal | Release all assignments and block another signup for that account/email in the period |
| Approve a schedule rejection | Remove only the affected pairing and return the request for matching |
| Expire an unverified assignment | Permanently disqualify it and release assignments; a fresh eligible application is separate |

`StudentProfileOwnership` retains explicit links across intakes and verified email changes. Attendance, feedback and appeals use all owned profiles. Staff-entered enrollment withdrawal also requires explicit ownership and current-term evidence; it never relies on a matching email. Signup-source labels describe recorded provenance and do not change permissions or priority.

Deadline timestamps live in PostgreSQL. The Node worker checks at startup and every minute; workflow entry points also enforce expiry. Database locks serialize transitions across instances, and downtime never extends a deadline. Keep the SQL constraints and triggers in the migration chain; `db push` alone does not reproduce them.

### Membership changes

Tutor and crew requests lock the member, recheck current membership and change only a pending request. Membership, notification and audit changes commit together, including through coordinator review. A stale request cannot override a later manual status change. Opt-out approval requires a seven-day wait; reentry requires approval without that wait. Opting out does not automatically perform the staff student-requeue action.

These requests differ from non-survey tutee opt-outs relayed by a tutor: [removal processing](../src/server/discipline/removal.ts) finalizes those after their seven-day recall window when a workflow enforces due requests. Survey/account-linked whole-period withdrawals instead require staff review and impose the period signup block. Do not merge these lifecycle rules.

Application locks protect supported API writes. Do not import directly into request tables assuming a unique pending-request index exists. Validate membership and pending-request invariants when designing import tooling, and preserve decision history.

## Scheduling, hours and discipline

Planned room bookings cannot overlap within a program period or conflict with a recurring blackout. Adjacent bookings are allowed. Shared transaction locks keep application validation coherent; database triggers enforce the final constraint. Actual historical attendance can differ from a plan and is recorded with conflict warnings and management notification.

Room block create/edit/remove operations use `adminProcedure` and the approval allowlist: Admin/Head apply writes, while Coordinators submit proposals. The shared [room block schemas](../src/lib/room-blocks.ts) validate day, minute bounds, reason length and increasing times before a request enters review. [Room validation](../src/server/room-bookings.ts) serializes block edits and removals with planned booking writes, excludes the edited block from overlap checks, and rejects conflicts with other blocks or active-term pairings. [Proposal preflight](../src/server/room-block-proposals.ts) validates current feasibility without reserving a time; approval checks target evidence and reruns the mutation inside the review transaction. Rejected or failed approvals do not change availability. The room-block migration extends the existing database trigger to enforce valid ranges and disjoint blocks on inserts/updates without rewriting historical rows.

Room-block review summaries use immutable payload/target evidence, not current room lookups. New proposals capture `roomBlockContext` for readable room identity. Review recomputes this context only when it was originally recorded, preserving the fingerprint shape of legacy requests. Missing legacy details are explicitly unavailable; raw proposal values remain in the evidence disclosure.

The [hour calculator](../src/lib/service-hours.ts) owns session rounding; use the [policy examples](../prisma/policies/tutor-policy.en.md#service-hours) rather than ordinary nearest-half-hour rounding. Completed interviews credit actual duration. Meeting deductions use the semester allowance in [meeting-hours.ts](../src/server/meeting-hours.ts); corrections recompute system credits while preserving manual adjustments.

[Disciplinary standing](../src/lib/discipline.ts) counts valid cards: three yellows contribute one effective red. With discipline enabled, an unexcused tutee absence produces a valid red; tutor-requested cards await review. At two effective reds, [removal synchronization](../src/server/discipline/removal.ts) immediately inactivates an active tutee and detaches current-term pairings without another approval. Pending appeals do not invalidate cards. Appeals close at the end of the fifth subsequent school day using the program timezone and calendar overrides. Invalidating a card recalculates standing; restoration requires the removal's status snapshot to remain current and eligible pairings to remain valid.

Attendance and patrol corrections preserve reasons and snapshots, reconcile dependent hours and discipline, and notify HEAD. [Crew flag reconciliation](../src/server/crew/flags.ts) compares exact observations with distinct attendance in shared blocks; `4+` cannot prove an undercount. Flags require a management decision before a penalty. Corrected evidence may reopen review and remove a linked penalty; manual adjustments remain separate.

Program timezone conversion distinguishes instants, calendar dates and weekly wall-clock slots. Use the shared helpers rather than browser-local conversions. [Configuration effects](program-reference.md#program-time-zone) explain what changes when the school timezone changes.

[Timezone labels](../src/lib/program-time-zone-label.ts) are display-only and require an explicit instant. Intl resolves localized names, seasonal abbreviations and GMT offsets using that instant; retain the IANA region as the persisted value. Local-input labels reuse strict program-time conversion and omit the offset when an input has no unique instant. Selector previews use one shared noon-UTC reference date and memoize option labels. No timestamp, recurring slot, permission or schema changes accompany display formatting.

## Communication

[Messaging permissions](../src/server/messaging-permissions.ts) use explicit ownership and recorded assignment evidence. Role contact groups form a union; a user override replaces that union. The same checks govern search, sends and replies. Permission or assignment writes cannot race send validation and commit.

A send validates the entire recipient batch and atomically writes separate deliveries, a retry receipt and notifications. A sender lock serializes retries and quotas; reusing a client key with different recipients, text or disclosure fails. Notifications omit private message bodies and recipient lists. No external I/O belongs inside the transaction.

Supervision requires the message's recorded disclosure. HEAD/ADMIN may inspect and reversibly hide disclosed messages with audit evidence; participant-only messages remain excluded from all supervision queries. Hiding retains the original content for authorized review. Contact restrictions block new sending and incoming eligibility without erasing readable history. See [contact configuration](program-reference.md#message-permissions-and-supervision).

Announcements freeze tutor IDs at publication, or at approval for a coordinator proposal. Editing or restoring a post does not recompute its recipients. Empty restricted audiences never become broadcasts. Preview, publication, reads and acknowledgements must share recipient-selection rules; notifications and publication commit together.

### Account emails and delivery

[Account email services](../src/server/auth/account-emails.ts) use the account-profile lock to serialize a person's changes. `AccountEmail` is the globally unique namespace for primary and verified secondary addresses; triggers reserve primary addresses for every account creation/update path. Inputs are trimmed and lowercased. Pending secondary requests live only in `EmailVerificationCode`, so failed, expired or abandoned requests cannot block another person. The settings list combines owned addresses with account-local pending challenges and applies the five-secondary limit to that union. Cancellation remains available for expired requests; resend is available when secondary binding is enabled; failed SMTP delivery retires only that request's challenge.

Secondary-email requests and confirmations first acquire the `secondary-email-binding-setting` transaction lock, shared with the ADMIN/HEAD availability mutation, and reject when `ProgramSettings.secondaryEmailBindingEnabled` is false. This independent flag defaults true for compatibility. Existing addresses, pending state, primary-email changes and authentication remain intact. Secondary-email requests and confirmations first acquire the `secondary-email-binding-setting` transaction lock, shared with the ADMIN/HEAD availability mutation, and reject when `ProgramSettings.secondaryEmailBindingEnabled` is false. This independent flag defaults true for compatibility. Existing addresses, pending state, primary-email changes and authentication remain intact. Verification rechecks availability and claims the address atomically. An address lock serializes competing confirmations; the unique registry key also arbitrates races with primary-account writers. Verified aliases resolve the same account. Recovery grants bind to their exact destination and recheck ownership on redemption; address removal and password rotation revoke grants. Never infer participant ownership from an alias or change the account's ID/history when promoting it.

Database triggers enqueue `EmailDelivery` in the event transaction for account changes and in-app notifications. No-op writes and rollbacks produce no notices. The [delivery worker](../src/server/email/notification-delivery.ts) rechecks program enablement and category preference for optional messages/information, and current recipient ownership for all mail. Security enqueue and dispatch bypass optional gates, including legacy `emailSecurity=false` values. That stored field is preserved but is no longer an editable preference. Disabling program notifications only skips non-security pending rows; previous-primary security notices have the documented ownership exception. Notices contain fixed event descriptions, not profile values, secrets or message bodies. See [operations and retry limits](deployment.md#optional-notification-delivery).

## Policy documents and translations

[Bundled sample policies](policies/README.md) are English/Chinese development sources requiring school adaptation and approval. The running site reads `PolicyDocument` rows. Staff publish reviewed revisions through the policy editor; changing Markdown does not update live policy records.

Acceptance keeps the exact revision, text, signature and timestamp. Participation requires current consent; history, feedback, appeals, account settings and messages stay available during renewal. Student and tutor applicability are checked independently. Client scrolling and confirmation controls assist review but do not replace server revision and action-ticket validation.

Translation drafts capture a fingerprint of their destination. Publication rechecks it under a shared transaction lock covering direct edits and deletion; changed or missing destinations require a fresh draft. UI strings, fixed landing text, news, sections and page titles follow this rule. Publication, draft state and audit evidence roll back together on failure. Unknown/deleted UI language codes are rejected rather than silently writing English.

Custom pages and page-mode landing sections share `/p/<slug>`. Their writers must use the shared namespace lock and [slug allocator](../src/server/home/slugs.ts) through commit. Collision suffixes fit the 60-character limit, unpublished content reserves its slug, and text-only translations do not allocate URLs. Direct database imports need their own cross-table validation.

## Data and deployment

Use the [deployment runbook](deployment.md) for bootstrap, SMTP, migrations, backups and launch verification. The image includes Prisma's migration CLI and starts the standalone server after applying migrations. PostgreSQL data and uploaded media must persist across container replacements. Development seeding is never a production bootstrap.

## Validation and development

[Local development](local-development.md#5-run-the-tests) contains the commands and isolated database setup. [Contributor guidance](contributing.md#required-checks) defines required checks. Use the [CI workflow](../.github/workflows/docker-build.yml) for the current verification pipeline rather than relying on historical test totals.

For focused regressions, start with the tests alongside the changed domain: `student-survey.test.ts`, `account-profile.test.ts`, `translation-destination.test.ts`, router `workflows.test.ts`, `home-slugs.test.ts`, `program-timezone.test.ts`, and messaging/announcement tests. Integration tests reset fixtures and must use an allowed isolated local database. Add cases for stale state, concurrent decisions, authorization and transaction rollback when changing these boundaries.

### Subject groups and qualification snapshots

`CourseGroup` holds offered-group order. `Subject` remains the stable variant referenced by surveys, choices and application intents; `baseName` and `SubjectLevel.prefix` generate its display name. All catalogue writers use [course-catalogue.ts](../src/server/course-catalogue.ts) and preserve archived variants. Pairing labels are synchronized transactionally when a variant name changes. Selection queries share `subjectOrderBy` (group rank/ID, level rank/ID, subject ID).

`TutorQualification` records an approval source and its status; `QualificationGrant` stores each concrete granted subject with its source and time. [Qualification helpers](../src/server/qualifications.ts) snapshot lower offered levels only on approval. Eligibility reads filter the source to `APPROVED`, never derive eligibility from application intent or the current level scale. Catalogue edits, approvals and assignment checks share a transaction lock. Repeated approval is idempotent; deleting one source cascades only its own grants. Historical assignments remain intact, while new assignments require an approved grant.

The migration assigns one group per legacy subject and exactly one original-subject grant per legacy approval, including retained historical scalar references. It does not guess relationships or grant new eligibility. Nullable group links support legacy fixture/import compatibility; catalogue APIs always create explicit groups. New code must use `approveQualification` rather than creating approval rows without grants. `admin.subjectEligibility` exposes distinct approved tutor/subject pairs. Subject willingness remains independent from qualification and should be intersected with these grants for availability.

## Maintaining the documentation

Edit the existing guide for the reader's task. Keep each procedure in one place and link to it from related guides. [Documentation ownership](contributing.md#documentation-and-repository-hygiene) explains where content belongs.

Run `npm run docs:check` to validate Markdown links, heading anchors, guide discoverability, role sections and issue forms. Read the guides directly in GitHub or a Markdown viewer; no compilation step is required.
