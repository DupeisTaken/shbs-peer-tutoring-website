# Technical report

Use this guide to find the code responsible for current behavior and understand the invariants a change must preserve. For setup commands, see [local development](local-development.md); for operating the server, see [deployment](deployment.md).

## Architecture

Tutor Roster details use the read-only `tutorDetails.get` procedure, guarded by the same management permission as account policy history. Its explicit field selection excludes authentication secrets; the UI mounts the query only after a staff member opens a tutor. Subject grouping reads concrete grants from approved qualification sources, never recalculating inheritance from current level ranks. Willingness remains a separate three-state value (true, false, or no record). Policy history uses the linked account ID through `student.acceptanceRecords`; neither matching contact data nor viewing a record grants account or role-edit access.

The application runs as a persistent Next.js 16 / React 19 Node server with tRPC 11, Prisma 7/PostgreSQL, Auth.js JWT sessions, next-intl and Tailwind CSS 4. It is not a static export: background verification deadlines, authentication and database mutations require the server.

| Change you need                          | Start here                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add or change a page                     | [App routes](../src/app), [shared components](../src/app/_components) and [message catalogs](../messages)                                                                                        |
| Add an API operation or access rule      | [Router composition](../src/server/api/root.ts) and [procedure middleware](../src/server/api/trpc.ts)                                                                                            |
| Change schema or transactions            | [Prisma schema](../prisma/schema.prisma), [migrations](../prisma/migrations), [database client](../src/server/db.ts) and [transaction helpers](../src/server/transactions.ts)                    |
| Change management review                 | [Operation classification](../src/lib/approval-policy.ts), [proposals](../src/server/approvals.ts) and [approval router](../src/server/api/routers/approval.ts)                                  |
| Change intake or participation           | [Surveys](../src/server/student-survey.ts), [student workflow](../src/server/student-workflow.ts), [ownership](../src/server/student-ownership.ts) and [membership](../src/server/membership.ts) |
| Change profile synchronization           | [Account profiles](../src/server/account-profile.ts)                                                                                                                                             |
| Change messaging or recipient access     | [Messaging permissions](../src/server/messaging-permissions.ts) and [messaging router](../src/server/api/routers/messaging.ts)                                                                   |
| Change hours or historical corrections   | [Hour calculator](../src/lib/service-hours.ts), [meeting hours](../src/server/meeting-hours.ts) and [corrections](../src/server/api/routers/corrections.ts)                                      |
| Change published content or translations | [Slug allocation](../src/server/home/slugs.ts), [translation destination checks](../src/server/translation-destination.ts) and [policy acceptance](../src/server/policy-acceptance.ts)           |
| Change dates or intake labels            | [Program time](../src/lib/program-time.ts) and [period display](../src/lib/period.ts)                                                                                                            |
| Change delivery or deadline processing   | [Email sender](../src/server/email/sender.ts), [instrumentation](../src/instrumentation.ts) and [deadline worker](../src/server/student-deadline-worker.ts)                                      |

### Shared UI patterns

[UI components](../src/app/_components/ui) provide behavior and composition without owning domain mutations. `Button` exposes action emphasis separately from context size; `ChoiceButton` uses pressed state for a selection; `Switch` exposes checked state. `SectionTabs` uses manual keyboard activation so arrow-key exploration does not switch an editor and discard its draft. `FormSection` groups one save scope and disables its fields/actions while busy. `StatePanel` keeps loading, empty, error and denied states distinct.

`NativeDialog` supplies native modality, portal event ownership, radio-aware keyboard focus and exact trigger restoration. `Modal`, the wide/sticky `ProfileDialog`, and `CurrentPolicyDialog` share this behavior while retaining their own layout and scrolling. A nested review owns its Escape event. Independent forms call `useDialogPending(ownPending)` to prevent dismissal during any registered write; its return value disables sibling controls. Register only the form's own pending state, never the returned aggregate, so the guard releases when writes settle. Callers retain validation, versions, permissions, approval policy and action tickets.

`SummaryTable` provides a named keyboard-scrollable region around a semantic table. Keep names, counts and statuses brief. When a row has detail/editor actions, place them in the trailing `TableActions` cell; only explicit action cells stick at the right edge. Read-only history tables need no invented action column. `TableAction` preserves button semantics with compact accent text links (28 px desktop, 44 px below `lg`, no extra vertical gap). `TableDetails` mounts a native modal only when opened. Roster course details keep their original read access; contact, account and history disclosures retain separate authorization and lazy queries. History exports and printed reports preserve full detail.

`FilterToolbar`, `SettingRow`, `ChangeReview` and `InlineNotice` are presentation compositions with caller-owned state. A filter uses pressed choices; only actual content views use tabs. Immediate switches, explicit unknown/yes/no willingness and staged checkbox settings preserve their distinct save behavior. Change review accepts domain-owned immutable evidence such as `ApprovalReviewDetails`; it never generates authorization or confirmation tickets. Announce new failures or completions explicitly and avoid wrapping existing alerts in another alert.

`DisclosureSection` requires an explicit lifetime: `lazy` unmounts closed read details, `retained` mounts once and keeps drafts through collapse, and `mounted` preserves existing creation forms from the start. Participant forms compose `PersonNameFields`, `FieldRequirement`, offered-grade and academic controls without recreating name/version rules. `PublicFormPage`, `PublicFormCard` and `PublicPageNavigation` share public framing and language/back navigation; wide personal history retains its separate layout.

Feature integrations include the three participant/account editors, roster actions, account identity settings, meeting attendance, interview panels, profile/CAPTCHA settings, combine-account candidates and public history. Cached query failures retain usable content and drafts. Background refetches preserve the profile policy snapshot; successful saves and explicit successful Reloads update it. Other pages may still use older patterns; [issue #219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219) tracks wider migration.

Tutor availability keeps a local draft once editing begins, so background query updates cannot discard it. A successful mutation is followed by an explicit throwing refetch before releasing the draft: the server filters inactive slot IDs and returns only a count, so the submitted list is not authoritative. If synchronization fails, the submitted choices remain visible and locked with a read-only retry; only the refreshed result unlocks editing. See [issue #223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223).

The [development gallery](../src/app/ui-gallery/gallery.tsx) imports the same components and styles. It owns only local synthetic state, including locale and temporary theme previews; its [server route](../src/app/ui-gallery/page.tsx) refuses production rendering. See [local verification](local-development.md#ui-pattern-gallery) and [contribution rules](contributing.md#reuse-interaction-patterns).

The [composition examples](../src/app/ui-gallery/recipes.tsx) cover seven reusable workflows: long dialogs, participant forms, filter toolbars, disclosure lifetimes, setting rows, change review and inline recovery. Existing feature implementations remain the reference for domain behavior: [profile policy settings](../src/app/_components/program-profile-settings.tsx) demonstrate cached draft/version recovery, [management actions](../src/app/_components/management-actions.tsx) demonstrate compact mixed controls, and [profile dialog tests](../src/app/_components/profile-dialog.test.tsx) cover child-write registration and focus ownership. Use the [agent component map](../AGENTS.md#start-with-the-shared-patterns) to choose the composition and the [verification matrix](local-development.md#ui-verification-matrix) to check its integration.

## Identity and authorization

Confirmed school departures are stored separately in `SchoolDeparture`, with versioned
`SchoolDepartureEvent` records. [Portal access](../src/lib/portal-access.ts) derives
read-only observer access without rewriting roles. Protected procedures and workspace
layouts reload this state; Viewer masking applies equally to departure-based observers.
[Departure transitions](../src/server/school-departure.ts) serialize with period refresh
and account changes, close current participation, and preserve historical records.
Self-service and non-Head decisions use the Head approval queue; stale revisions fail.
See [migration instructions](deployment.md#school-departure-migration) for the explicit
legacy graduation backfill and [program behavior](program-reference.md) for access rules.

Account role, linked tutor profile, crew membership and translator assignment are separate capabilities. Protected requests reload current role, linkage and suspension state. Navigation and client controls do not replace server authorization. Student records require explicit account/profile ownership; a matching name or email never grants access.

| Procedure family                          | Intended callers                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `publicProcedure`                         | Public operations with their own input validation and feature gates          |
| `protectedProcedure`                      | Authenticated accounts with current authorization                            |
| `tutorProcedure` / `activeTutorProcedure` | Linked tutor access / active tutor duties                                    |
| `crewProcedure`                           | Permitted active crew or management access with the crew module enabled      |
| `adminProcedure`                          | Management; sensitive coordinator mutations enter review                     |
| `adminOnlyProcedure` / `headProcedure`    | ADMIN or HEAD / HEAD only                                                    |
| `viewerProcedure`                         | Management queries; explicit safe projections for Viewers and observers      |
| `translatorProcedure`                     | Explicit assigned translators; management rank does not grant editing access |
| `translationReviewerProcedure`            | Management reviewers or assigned translators reading their own drafts        |

Management observation uses the per-procedure [read models](../src/server/management-read-models.ts)
at the tRPC response boundary. Only listed scalar fields and recursively projected relations
reach Viewers and departure-based observers; unknown fields and unregistered reads fail closed.
Names, schedules, statuses, attendance ratings, school-grade summaries and totals remain visible.
Contact details, signatures, private narratives, application scores/evidence, raw academic text,
account/policy snapshots, invitation labels/codes and attendance submission fingerprints are
withheld. Published policies and announcements remain readable, consistent with the publication
workflow's explicit Viewer oversight (including announcements with selected tutor recipients).

Audit observations contain actor/time/category metadata and a fixed category label, never the
stored action text, details or undo payload. Observer audit search matches actor names, entity
and operation metadata before pagination; it never searches hidden narratives. This also covers
historical actions containing appeal/correction explanations. Staff responses and staff audit
search retain their existing behavior. Own-account and explicitly owned participant history
remain under their separate ownership guards. When adding management queries or relations,
update the read-model inventory and its RPC regression tests rather than adding blacklist keys.

Summary-table detail dialogs consume the same projected observer response as their
rows. Moving information into a lazy dialog must not fetch a richer staff record or
introduce an edit action. The management privacy component tests open attendance
and audit details in English and Chinese using the actual server projections,
including masked fields, and verify focus restoration after closing.

[Composable membership](../src/lib/account-membership.ts) keeps the exact management rank in `User.role`, tutor identity in `tutorId` with independent `tutorAccessRevoked`, crew lifecycle in `crewStatus`, explicit translation permission in `canTranslate`, and tutee membership in `tuteeMember`. `PolicyAcceptance` remains separate immutable evidence. Viewer exclusivity is validated by the complete membership schema and a database constraint. Legacy mixed Viewer accounts lose read-only management access and retain their explicit participant capabilities; migration never inserts policy acceptance. Outstanding pre-migration registration codes expire because they have no durable Head grant evidence; Head must issue fresh codes.

`admin.setMemberships` applies a complete badge set atomically with identity confirmation. `account.requestMemberships` only queues the caller's own proposal. `HEAD_APPROVAL_OPERATIONS` classifies alternate roster/crew/interview/registration grant paths, and approval replay checks the live Head role. Only Head may provision a new tutor login; sending an existing setup link is still available to management. Existing linked identities/history are preserved when participation is disabled. A tutor entering `/student` must personally accept the current tutee policy, which grants membership in the acceptance transaction; unrelated tutor features do not require tutee consent.

Management draft publication uses a server-only `translationPublicationScope` limited to the validated draft operation and live reviewer identity. It never sets `canTranslate` and cannot authorize subsequent direct edits. Coordinator translator authorization precedes proposal queuing.

The [user filter helpers](../src/lib/user-filters.ts) match composable membership badges. Tutor status applies only to an explicit Tutor-only role inclusion without a Tutor exclusion. Edits and saved-filter restoration normalize away inapplicable status; the matcher independently ignores it as a defensive boundary. Preferences are scoped to the signed-in account. The underlying `admin.accounts` query remains protected by `adminProcedure`; client filters do not provide authorization.

Account names synchronize only to explicitly linked current profiles. Shared profile writers lock the account before roster rows and reject stale versions. Signed agreements, submitted survey names and historical snapshots remain evidence of what was submitted.

Head-only [account combination](../src/server/combine-accounts.ts) requires a preview, identity acknowledgement and the Head's password. `User.mergedIntoId` retains the duplicate as historical identity while live authorization and database guards retire its credentials and reserve its identifiers. Ownership-aware reads include retained history without rewriting original actors. Departure history and incompatible account state block this generic workflow; see [identity retention and migration limits](deployment.md#combined-account-identity-retention) and the [operator procedure](user-guide.md#combine-duplicate-accounts-head-only).

The client cache is replaced when the server-supplied account or role identity changes. Route changes and tab focus/visibility share one live session check. Private content stays mounted but hidden while verification is pending, preserving form edits. A failed check or changed identity clears the cache and reloads the server layout. Once the same identity is verified, content is restored immediately; stale active queries refresh in the background without cancelling an existing request. Fresh queries are retained. Deterministic authentication, authorization and precondition errors are not retried; transient failures retain bounded retries.

The global participation-policy query uses this shared navigation/focus refresh. It fetches on initial enable and separately on query-only student tab changes; it does not install competing focus listeners. A verified return to the tab resets dismissal, while ordinary navigation preserves dismissal of the same published revision. Participation mutations always validate current policy acceptance on the server.

Client caches belong to the account, role and tutor link. Navigation and focus changes check the live identity before reusing data. The HTTP proxy removes rejected session cookies before page rendering; API authorization remains in force. Background responses must not restore a prior login after sign-out. Keep `AUTH_SECRET` stable and shared across production instances; diagnose failed sign-ins using [local troubleshooting](local-development.md#troubleshooting).

Browser tRPC links share [batch limits](../src/lib/trpc-batch.ts) so busy pages split simultaneous queries within the server's 20-operation limit. Keep new clients aligned with [signup ingress limits](signup-protection.md#defaults-and-tuning); repeated oversized batches cannot be repaired by retries.

### Stable account usernames

Verified participant accounts share one permanent account handle with any linked tutor record.
Invitation redemption, account setup, joining tutoring, re-enrollment, name changes and academic
corrections preserve an established account handle. A new login for a roster tutor adopts that
roster handle. Old linked mismatches are reconciled to the account handle and recorded in the
audit log; if another identity owns that handle, Head must resolve the conflict explicitly.

New handles use lowercase ASCII letters/digits, up to 64 characters including collision suffixes.
Decomposable accents are normalized (`José García` → `jgarcia`); single-token names use the full
token. Names without usable Latin letters may supply an optional Latin spelling at signup or
invitation registration. Otherwise a neutral `member` base is used, without guessed
transliteration. A graduation suffix is only an initial naming hint supported by confirmed grade
and reference year; it is never an academic record and never changes after a correction. Collision
letters/counters disambiguate names while preserving the length limit. Existing handles are not
normalized or migrated by this policy.

Student handles are assigned only after successful survey/email verification. Unverified surveys
and roster-only tutees reserve no handle and gain no tutor access. Email sign-in remains available.
Existing verified STUDENT accounts are assigned only through deliberate Head backfill or verified
re-enrollment, never by opening profile/list pages. VIEWER accounts keep their separate email-only
automatic-allocation policy; an explicitly assigned existing handle remains valid.

### Head username editing

In **Users & Roles → Edit profile**, Head can save a username for any login account, including their own. Use 1–64 ASCII letters or digits; surrounding whitespace is trimmed and letters are lowercased. Taken usernames in either the login or tutor roster are rejected. The linked tutor is updated atomically, so the old handle no longer signs in. Email sign-in, passwords, IDs, badges and history remain unchanged. Ordinary roster name edits retain the username. Admins and coordinators cannot rename accounts. Saves record the actor and old/new handles and refresh the account list and current header. An unchanged save is a no-op; stale profile versions require reopening the editor.

## Approval transactions

Additional tutor qualifications use `qualificationApplication` and explicit `ADDITIONAL_SUBJECT` / `HIGHER_LEVEL` application types linked to an existing tutor and stable subject ID. Submission is self-only for active, non-revoked tutors; an open-request unique index plus transaction locks prevents duplicate pending/interview requests. Only Admin/Head may choose a panel or decide, and an interviewed request retains the existing votes/majority/chair checks. Initial-signup reconciliation is bypassed: no roles, membership, registration codes, willingness or existing grants change. Approval uses `approveQualification` in the decision transaction and copies its concrete grants into immutable request evidence; later catalogue reordering never recalculates this evidence. SQL guards preserve request identity and final decisions. Legacy status, delete and interview-decision entry points reject additional applications before proposal middleware.

Successful additional-qualification decisions invalidate the affected tutor's `tutorDetails.get` cache alongside the application, availability and roster queries. The detail cache is independent of `admin.tutors`; scoped invalidation ensures reopening the same tutor within the query freshness window shows the new approval without invalidating unrelated tutor details.

The tutor's qualification history derives status filters and counts from the self-only `qualificationApplication.mine` result. Pending includes interviews; approved, rejected and recalled requests have separate filters. Filter selection and collapse state stay local to the component and survive query refreshes. Collapsing history hides its controls and records while keeping submission, current approvals and recall feedback available.

Classify every management write in the [approval policy](../src/lib/approval-policy.ts). Unknown coordinator operations fail closed. A sensitive coordinator write creates an immutable proposal; it has not applied the change.

1. Capture validated input, affected records, active period and a fingerprint of review evidence.
2. Consume the coordinator's confirmation ticket when queuing a ticketed action.
3. Recheck requester/reviewer status, permit self-review only for the active Head and compare current evidence before approval.
4. Replay the original parser and resolver under reviewer privileges. Ticketed actions require the reviewer's own fresh confirmation.
5. Commit the domain change, proposal decision, related notifications and decision audit together. Competing reviewers cannot apply a proposal twice.
6. Send external email after commit. Delivery failure must remain retryable without undoing an applied assignment.

The [approval review presentation model](../src/lib/approval-review.ts) reads only the immutable input and submission evidence. Explicit operation titles and field/value vocabulary live under `approvals.review`; the [shared details component](../src/app/_components/approval-review-details.tsx) renders the same request in the card and consequence dialog. Direct-field comparisons require an exact target-table/ID or compound-key match. Attendance, patrol and pairing collections use their matching child snapshots. Missing evidence is distinct from an empty value; unchanged submitted values and supporting records remain inspectable. Known decisions are displayed as decisions rather than booleans, while user-authored text is preserved verbatim. New review vocabulary is authored in English and Chinese; the other six bundles currently use English for these new keys and retain their existing surrounding translations. Locale parity and ICU checks cover every bundle.

Adding an approval operation requires an authored review title and an explicit choice about whether its input represents direct field updates or action parameters. Do not infer resulting database state from a decision input, fill historical gaps with live queries, or change proposal fingerprints for presentation. Regression coverage is in [model tests](../src/lib/approval-review.test.ts), [details tests](../src/app/_components/approval-review-details.test.tsx), and [queue tests](../src/app/_components/management-actions.test.tsx), alongside the existing server approval and confirmation tests.

Use [database scope](../src/server/db-scope.ts) so helpers participate in the enclosing transaction. An independent client escapes rollback. Interview review revalidates panel membership, qualifications and votes while preserving the coordinator chair's result and authorship. Scheduling checks the current chair under the same lock as panel replacement. Interview history and completion live in Tutor Applications; legacy interview routes redirect there. Subject Availability is a separate staff-only route and API, independent of interview enablement. `TutorSubjectWillingness` records explicit per-variant intent with no inferred migration backfill: an absent row means not recorded. Staff writes use coordinator approval; active tutors can update only their own willingness. `availableSubjectIds` intersects explicit willingness with stored approved qualification grants and active subjects, excluding inactive or access-revoked tutors. Callers must still enforce timetable and capacity constraints. Changing willingness never edits approvals, grants or interview records.

Subject willingness UI: `subjectAvailability.mySubjects` loads on dialog open and scopes qualifications, saved grants and intent to the authenticated tutor. Only subjects backed by approved saved grants (direct or inherited) are returned; unqualified or pending-only subjects are hidden without deleting their historical intent. Staff retains the complete catalogue. The tutor editor uses two mutually exclusive pressed-state buttons; absent intent selects neither, and clicking a confirmed choice does not clear it. Aligned subject rows use paired controls with a checkmark as well as theme colour for selection. The dialog opts into a wider layout; existing profile dialogs keep their default width. On narrow screens, choices stack below each subject and retain equal touch-target heights. Save feedback occupies a stable footer slot. `setMine` retains fresh authorization and cannot accept another tutor ID. Confirmed values are refreshed after immediate saves, including staff/detail caches; failed saves do not present optimistic success. Management card filters use one nullable selection per tutor and mount only inside expanded cards. Pending Review includes open qualification applications without converting them to grants.

Audit events identify actors by stable account ID. Generic mutation summaries record operations without raw passwords or tokens; detailed correction and approval evidence is retained separately. The audit is not a page-access log, and a generic summary does not guarantee that every direct operation and audit insert share one transaction. Review metadata and undo payloads are not exposed to VIEWER accounts.

## Student lifecycle and ownership

The original survey submission determines queue priority. Confirmation creates or links an account without replacing its existing role or password. Account links expire after 24 hours. First assignment of an unverified request starts a fixed seven-day deadline; neither resends nor reassignment extends it.

| Action                          | Invariant                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Submit or repeat an open survey | Preserve the first payload, timestamp and exact accepted policy snapshot                    |
| Confirm the email link          | Consume a single-use challenge; merely opening a link does not confirm it                   |
| Resend a link                   | Failed delivery preserves the usable link; successful delivery replaces it                  |
| Edit availability               | Preserve subjects, priority and assignments                                                 |
| Recall an unassigned request    | Close it permanently; a later application receives a new request and priority               |
| Approve withdrawal              | Release all assignments and block another signup for that account/email in the period       |
| Approve a schedule rejection    | Remove only the affected pairing and return the request for matching                        |
| Expire an unverified assignment | Permanently disqualify it and release assignments; a fresh eligible application is separate |

`StudentProfileOwnership` retains explicit links across intakes and verified email changes. Attendance, feedback and appeals use all owned profiles. Staff-entered enrollment withdrawal also requires explicit ownership and current-term evidence; it never relies on a matching email. Signup-source labels describe recorded provenance and do not change permissions or priority.

[Historical linking and invitations](historical-participant-transition.md) add retained ownership after staff review or an explicit claim by the invited verified account. They preserve original enrollment academics, current membership and recorded attendance. Accountless tutees remain roster records; personal `/history` reads require ownership, while general observer access never grants private history. See the guide's [technical map](historical-participant-transition.md#technical-map) for endpoints and shared cache invalidation.

Deadline timestamps live in PostgreSQL. The Node worker checks at startup and every minute; workflow entry points also enforce expiry. Database locks serialize transitions across instances, and downtime never extends a deadline. Keep the SQL constraints and triggers in the migration chain; `db push` alone does not reproduce them.

### Membership changes

Tutor and crew requests lock the member, recheck current membership and change only a pending request. Membership, notification and audit changes commit together, including through coordinator review. A stale request cannot override a later manual status change. Opt-out approval requires a seven-day wait; reentry requires approval without that wait. Opting out does not automatically perform the staff student-requeue action.

These requests differ from non-survey tutee opt-outs relayed by a tutor: [removal processing](../src/server/discipline/removal.ts) finalizes those after their seven-day recall window when a workflow enforces due requests. Survey/account-linked whole-period withdrawals instead require staff review and impose the period signup block. Do not merge these lifecycle rules.

Application locks protect supported API writes. Do not import directly into request tables assuming a unique pending-request index exists. Validate membership and pending-request invariants when designing import tooling, and preserve decision history.

### Assignment qualification confirmations

`src/server/assignment-qualification.ts` checks stored grants from approved qualification sources under the catalogue lock. Assignment entry points and coordinator proposal creation share this guard. An unqualified assignment requires a one-use `StudentActionConfirmation` with action `ASSIGNMENT_OVERRIDE`, a three-second server deadline, and a hash of the operation and complete parsed assignment payload. The actor, course, tutor, request version, roster and schedule are bound; confirmation tokens themselves are excluded. New warning preparation invalidates older unused override tickets, cancellation deletes the current unused ticket, and approval replay requires the reviewer's fresh evidence. Existing student consequence confirmation remains a separate requirement. Active unlinked roster tutors remain eligible for assignment; a linked account with explicitly revoked tutoring membership is excluded and assignment never restores account access. No additional schema is needed beyond the course grant migration.

## Scheduling, hours and discipline

The tutor dashboard's task summary reuses the same tRPC query keys as its feature
sections, including explicit unknown/error states. It uses the program-zone date
and only confirmed weekly pairing times; this is a regular timetable, not a
holiday or attendance-completion inference. Active membership controls attendance
and pairing writes; pending/inactive membership keeps read-only records and
unresolved requirements. Hash shortcuts focus their section for keyboard users.
Attendance freezes its submitted fields and distinguishes a saved entry from a
failed totals refresh. Pending qualification records stay outside history filters;
completed interview evidence and optional editor disclosures retain mounted drafts.
The [contributor action inventory](contributing.md#consequential-action-inventory)
documents draft, reversible and confirmed action boundaries.

`Pairing.scheduleConfirmed` separates assigned tutors from agreed schedules. New request assignments default false; catalog-slot creation or selection sets true. Clearing a slot link retains the flag and copied times. Lists expose the awaiting state, dashboard counts exclude it, and attendance requires explicit actual start/end values whenever any selected pairing is unconfirmed. Recording actual attendance never confirms the recurring schedule. The [scheduling migration](../prisma/migrations/20260922200100_pairing_scheduling/migration.sql) conservatively marks preexisting rows true because copied-time provenance is unknown; new rows default false. No historical schedule or session time is inferred or rewritten.

Confirmed planned room bookings cannot overlap within a program period or conflict with a recurring blackout. Unconfirmed numeric placeholders do not reserve rooms, and changing only the confirmation flag still invokes the database room guard. Adjacent bookings are allowed. Shared transaction locks keep application validation coherent; database triggers enforce the final constraint. Actual historical attendance can differ from a plan and is recorded with conflict warnings and management notification.

Room block create/edit/remove operations use `adminProcedure` and the approval allowlist: Admin/Head apply writes, while Coordinators submit proposals. The shared [room block schemas](../src/lib/room-blocks.ts) validate day, minute bounds, reason length and increasing times before a request enters review. [Room validation](../src/server/room-bookings.ts) serializes block edits and removals with planned booking writes, excludes the edited block from overlap checks, and rejects conflicts with other blocks or active-term pairings. [Proposal preflight](../src/server/room-block-proposals.ts) validates current feasibility without reserving a time; approval checks target evidence and reruns the mutation inside the review transaction. Rejected or failed approvals do not change availability. The room-block migration extends the existing database trigger to enforce valid ranges and disjoint blocks on inserts/updates without rewriting historical rows.

Room-block review summaries use immutable payload/target evidence, not current room lookups. New proposals capture `roomBlockContext` for readable room identity. Review recomputes this context only when it was originally recorded, preserving the fingerprint shape of legacy requests. Missing legacy details are explicitly unavailable; raw proposal values remain in the evidence disclosure.

The [hour calculator](../src/lib/service-hours.ts) owns session rounding; use the [policy examples](../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual) rather than ordinary nearest-half-hour rounding. Completed interviews credit actual duration. Meeting deductions use the semester allowance in [meeting-hours.ts](../src/server/meeting-hours.ts); corrections recompute system credits while preserving manual adjustments.

[Disciplinary standing](../src/lib/discipline.ts) counts valid cards: three yellows contribute one effective red. With discipline enabled, an unexcused tutee absence produces a valid red; tutor-requested cards await review. At two effective reds, [removal synchronization](../src/server/discipline/removal.ts) immediately inactivates an active tutee and detaches current-term pairings without another approval. Pending appeals do not invalidate cards. Appeals close at the end of the fifth subsequent school day using the program timezone and calendar overrides. Invalidating a card recalculates standing; restoration requires the removal's status snapshot to remain current and eligible pairings to remain valid.

[Catalog-slot attendance propagation](../src/server/attendance-schedule.ts) holds an exclusive transaction advisory barrier before discovering affected history. Attendance and patrol submissions/corrections acquire shared access before their other locks, so normal independent writes can still proceed concurrently. Clock changes move each complete merged block atomically, retain its slot identities and single-credit factors, reject final tutor/date overlaps, reconcile flags and linked deductions, and preserve prior evidence in the audit log. Slot, pairing, session, hours, flags, audit and HEAD notification updates share one transaction. Weekday-only edits preserve actual history. Submissions that read stale catalog defaults must reload; this application coordination does not claim to prevent arbitrary direct SQL attendance writes.

Attendance and patrol corrections preserve reasons and snapshots, reconcile dependent hours and discipline, and notify HEAD. [Crew flag reconciliation](../src/server/crew/flags.ts) compares exact observations with distinct attendance in shared blocks; `4+` cannot prove an undercount. Flags require a management decision before a penalty. Corrected evidence may reopen review and remove a linked penalty; manual adjustments remain separate.

Program timezone conversion distinguishes instants, calendar dates and weekly wall-clock slots. Use the shared helpers rather than browser-local conversions. [Configuration effects](program-reference.md#program-time-zone) explain what changes when the school timezone changes.

Database instant fields currently use PostgreSQL `TIMESTAMP(3)` without time zone, with Prisma reading and writing UTC values. The shared [connection policy](../src/server/database-url.ts) forces `timezone=UTC` through connection startup options for the application pool, Prisma CLI, seed, demo verification and administrator bootstrap. This keeps database defaults, trigger writes and expiry comparisons consistent even when the database or role defaults to another zone. Existing connection options are preserved, with UTC taking precedence. No rows or column types are migrated; calendar-only dates and weekly clock values retain their existing representation.

Docker builds omit database credentials and set `SKIP_ENV_VALIDATION=1`. Importing the database module during Next page-data collection must therefore allow an absent URL without parsing it or opening a connection. Production runtime validation still requires a valid URL; every configured application connection receives the UTC policy. `db-build.test.ts` covers this build/runtime boundary.

Changing the program timezone writes only the singleton setting and audit entry, then refreshes the editor's page. It does not scan or rewrite historical timestamps or recalculate service hours. Derived appeal deadlines for existing cards and crew-observation matching when reconciliation reruns use the current program zone. UTC connection enforcement does not freeze those school-calendar rules. A future `timestamptz` migration needs a separate field/data audit: true instants can be converted explicitly from UTC, while calendar dates and weekly slots must retain their distinct meaning.

[Timezone labels](../src/lib/program-time-zone-label.ts) are display-only and require an explicit instant. Intl resolves localized names, seasonal abbreviations and GMT offsets using that instant; retain the IANA region as the persisted value. Local-input labels reuse strict program-time conversion and omit the offset when an input has no unique instant. Selector previews use one shared noon-UTC reference date and memoize option labels. No timestamp, recurring slot, permission or schema changes accompany display formatting.

## Communication

[Messaging permissions](../src/server/messaging-permissions.ts) use explicit ownership and recorded assignment evidence. Role contact groups form a union; a user override replaces that union. The same checks govern search, sends and replies. Permission or assignment writes cannot race send validation and commit.

A send validates the entire recipient batch and atomically writes separate deliveries, a retry receipt and notifications. A sender lock serializes retries and quotas; reusing a client key with different recipients, text or disclosure fails. Notifications omit private message bodies and recipient lists. No external I/O belongs inside the transaction.

Supervision requires the message's recorded disclosure. HEAD/ADMIN may inspect and reversibly hide disclosed messages with audit evidence; participant-only messages remain excluded from all supervision queries. Hiding retains the original content for authorized review. Contact restrictions block new sending and incoming eligibility without erasing readable history. See [contact configuration](program-reference.md#message-permissions-and-supervision).

Announcements freeze tutor IDs at publication, or at approval for a coordinator proposal. Editing or restoring a post does not recompute its recipients. Empty restricted audiences never become broadcasts. Preview, publication, reads and acknowledgements must share recipient-selection rules; notifications and publication commit together.

### Account emails and delivery

[Account email services](../src/server/auth/account-emails.ts) use the account-profile lock to serialize a person's changes. `AccountEmail` is the globally unique namespace for primary and verified secondary addresses; triggers reserve primary addresses for every account creation/update path. Inputs are trimmed and lowercased. Pending secondary requests live only in `EmailVerificationCode`, so failed, expired or abandoned requests cannot block another person. The settings list combines owned addresses with account-local pending challenges and applies the five-secondary limit to that union. Cancellation remains available for expired requests; resend is available when secondary binding is enabled; failed SMTP delivery retires only that request's challenge.

Secondary-email requests and confirmations first acquire the `secondary-email-binding-setting` transaction lock, shared with the ADMIN/HEAD availability mutation, and reject when `ProgramSettings.secondaryEmailBindingEnabled` is false. This independent flag defaults true for compatibility. Existing addresses, pending state, primary-email changes and authentication remain intact. Verification rechecks availability and claims the address atomically. An address lock serializes competing confirmations; the unique registry key also arbitrates races with primary-account writers. Verified aliases resolve the same account. Recovery grants bind to their exact destination and recheck ownership on redemption; address removal and password rotation revoke grants. Never infer participant ownership from an alias or change the account's ID/history when promoting it.

Database triggers enqueue `EmailDelivery` in the event transaction for account changes and in-app notifications. No-op writes and rollbacks produce no notices. The [delivery worker](../src/server/email/notification-delivery.ts) rechecks program enablement and category preference for optional messages/information, and current recipient ownership for all mail. Security enqueue and dispatch bypass optional gates, including legacy `emailSecurity=false` values. That stored field is preserved but is no longer an editable preference. Disabling program notifications only skips non-security pending rows; previous-primary security notices have the documented ownership exception. Notices contain fixed event descriptions, not profile values, secrets or message bodies. See [operations and retry limits](deployment.md#optional-notification-delivery).

Every [email sender](../src/server/email/sender.ts) call declares SECURITY or PROGRAM purpose; configuration selects a complete sender account per purpose. Student signup confirmation uses PROGRAM, while viewer verification and history invitations use SECURITY. The notification outbox retains the event's internal destination; shared link validation and sign-in callbacks preserve it through password/2FA and session recovery, with current permissions checked at the destination. Shared HTML/plain-text rendering uses runtime branding and program-zone notification timestamps. See [sender setup](deployment.md#email--aliyun-direct-mail-邮件推送) for fallback and delivery checks.

### Management registration codes

Registration Codes supports Tutor, Crew, Admin and Coordinator invitations. Every code grants only its displayed role. Head can issue directly; other staff submit a proposal requiring Head approval. Only Head can list, share or revoke Admin/Coordinator codes. The selected role appears in the list, share card and every redemption step after code validation. There is no Head code; leadership transfer remains separate.

Admin/Coordinator redemption requires email verification and creates a new management-only account without Tutor, Crew, Tutee or Translator participation. Existing primary or secondary email owners must sign in and ask Head to change roles in Users & Roles; a code never resets their credentials or replaces their roles. Expiry, rate limits, email binding and single use remain enforced, and issuer/recipient history is retained. The additive registration-kind migration preserves outstanding Tutor/Crew invitations. Apply migrations before starting the updated application.

## Policy documents and translations

The dashboard's `PolicyConsent` accepted message opens `CurrentPolicyDialog`, a read-only native modal. Opening refetches `student.policy` and suppresses cached text during loading or errors. The reader stays open if the refreshed revision is unaccepted; closing restores the normal consent UI. It uses published locale content with English fallback and never invokes acceptance mutations.

[Bundled policy drafts](policies/README.md) are English/Chinese development sources requiring school adaptation and approval. The running site reads `PolicyDocument` rows. Staff publish reviewed revisions through the policy editor; changing Markdown does not update live policy records.

Acceptance keeps the exact revision, text, signature and timestamp. Participation requires current consent; history, feedback, appeals, account settings and messages stay available during renewal. Student and tutor applicability are checked independently. Client scrolling and confirmation controls assist review but do not replace server revision and action-ticket validation.

Translation drafts capture a fingerprint of their destination. Publication rechecks it under a shared transaction lock covering direct edits and deletion; changed or missing destinations require a fresh draft. UI strings, fixed landing text, news, sections and page titles follow this rule. Publication, draft state and audit evidence roll back together on failure. Unknown/deleted UI language codes are rejected rather than silently writing English.

The `/localization` editor contains interface text, website text and draft review. The retired `/translation-review` route only redirects to its review view; no draft data is migrated or deleted. The route checks live account privileges. Assigned translators mount editing queries; management reviewers without that assignment mount review only. Draft listing filters state while retaining author scoping for non-management accounts. Coordinator text mutations pass explicit Translator authorization and create destination-bound drafts; structural mutations retain general approval queuing. Coordinator review requests still queue `translationReview.decide`, with Admin/Head publication replay limited to the validated draft operation. Draft state, publication and audit retain the existing atomic transaction.

Custom pages and page-mode landing sections share `/p/<slug>`. Their writers must use the shared namespace lock and [slug allocator](../src/server/home/slugs.ts) through commit. Collision suffixes fit the 60-character limit, unpublished content reserves its slug, and text-only translations do not allocate URLs. Direct database imports need their own cross-table validation.

## Data and deployment

Use the [deployment runbook](deployment.md) for bootstrap, SMTP, migrations, backups and launch verification. The image includes Prisma's migration CLI and starts the standalone server after applying migrations. PostgreSQL data and uploaded media must persist across container replacements. Development seeding is never a production bootstrap.

## Validation and development

[Local development](local-development.md#5-run-the-tests) contains the commands and isolated database setup. [Contributor guidance](contributing.md#required-checks) defines required checks. Use the [CI workflow](../.github/workflows/docker-build.yml) for the current verification pipeline rather than relying on historical test totals.

For focused regressions, start with the tests alongside the changed domain: `student-survey.test.ts`, `account-profile.test.ts`, `translation-destination.test.ts`, router `workflows.test.ts`, `home-slugs.test.ts`, `program-timezone.test.ts`, and messaging/announcement tests. Integration tests reset fixtures and must use an allowed isolated local database. Add cases for stale state, concurrent decisions, authorization and transaction rollback when changing these boundaries.

### Subject groups and qualification snapshots

`CourseGroup` holds offered-group order. `Subject` remains the stable variant referenced by surveys, choices and application intents; `baseName` and `SubjectLevel.prefix` generate its display name. Grouped JSON imports validate the shared `courseImportInput` schema and run through `importCourseGroups` under the catalogue lock and enclosing transaction. Exact repeats are no-ops; conflicts never merge or reactivate variants implicitly. Coordinator proposals snapshot the catalogue, groups and levels for stale-state review. The legacy CSV mutation remains available. All catalogue writers use [course-catalogue.ts](../src/server/course-catalogue.ts) and preserve archived variants. Pairing labels are synchronized transactionally when a variant name changes. Selection queries share `courseChoices` and `sortCourseChoices` (configured level rank/ID, base name, subject ID). Unlevelled offerings share the configured unprefixed tier; the complete level scale is read even for restricted pickers. Group-oriented displays and historical snapshots retain `subjectOrderBy`.

`TutorQualification` records an approval source and its status; `QualificationGrant` stores each concrete granted subject with its source and time. [Qualification helpers](../src/server/qualifications.ts) snapshot lower offered levels only on approval. Eligibility reads filter the source to `APPROVED`, never derive eligibility from application intent or the current level scale. Catalogue edits, approvals and assignment checks share a transaction lock. Repeated approval is idempotent; deleting one source cascades only its own grants. Historical assignments remain intact, while new assignments require an approved grant.

The migration assigns one group per legacy subject and exactly one original-subject grant per legacy approval, including retained historical scalar references. It does not guess relationships or grant new eligibility. Nullable group links support legacy fixture/import compatibility; catalogue APIs always create explicit groups. New code must use `approveQualification` rather than creating approval rows without grants. `admin.subjectEligibility` exposes distinct approved tutor/subject pairs. Subject willingness remains independent from qualification and should be intersected with these grants for availability.

## Maintaining the documentation

Edit the existing guide for the reader's task. Keep each procedure in one place and link to it from related guides. [Documentation ownership](contributing.md#documentation-and-repository-hygiene) explains where content belongs.

Run `npm run docs:check` to validate Markdown links, heading anchors, guide discoverability, role sections and issue forms. Read the guides directly in GitHub or a Markdown viewer; no compilation step is required.

### Signup field configuration

`src/lib/signup-fields.ts` defines the fixed field order, immutable essentials, defaults and shared normalization. `ProgramSettings.signupFields` stores per-form states; hidden/required cannot coexist. `program.setSignupField` uses Head authorization, a transaction lock, an expected-state conflict guard and an audit record. Unknown/custom fields and essential changes are rejected. The public forms consume the same settings; each new submission reads current settings on the server and strips hidden answers. Existing survey payloads are decoded without applying current configuration, preserving historical answers and confirmation flows.

Tutor application submission requires explicit agreement and the current published policy revision. New applications store exact policy documents, revision and acceptance time together; historical applications retain null evidence. This application-level evidence never fabricates a user-level `PolicyAcceptance`. Qualification answers and subject intents remain application data, never qualification grants. Secondary-email availability belongs to the program email configuration; the existing signup forms collect only primary sign-in email.

### Reviewing your own management requests

Admin and Head can review eligible ordinary Management Actions. Only the current active Head can review role/badge changes or their own pending requests. Other reviewers cannot decide their own requests, including after promotion to Admin. Current database permissions apply after promotion, demotion or suspension. Head self-review preserves required notes, consequence confirmations, stale-record checks and atomic application; requester and reviewer audit identities remain recorded even when they match. This exception applies to Management Actions, not participant interview voting or qualification decisions.

### Username allocation and bounded student backfill

`src/lib/username.ts` owns the editor/generation character and length rules. All runtime handle
writers use the transaction-scoped PostgreSQL advisory lock `identity:username-namespace` before
profile/identity writes and retain it from the cross-table availability check through persistence.
`ensureUniqueUsername` requires the active transaction client; callers must not pass the root
client or persist its result after the transaction ends. Conflicting automatic creations serialize
and select the next suffix. Explicit Head renames and canonical account/tutor mirroring use the
same lock. An established-handle collision is a reviewable conflict, never an automatic rename.

Head can use **Users & Roles → Assign Username** for an eligible verified student without a handle.
The confirmation names that one account and refreshes account/list data after assignment.
For explicit batches, Head can invoke `admin.backfillStudentUsernames` with `{ userIds: [...] }`, an explicit batch of
1–100 distinct verified STUDENT account IDs. The operation validates the whole batch in a
transaction, leaves established handles unchanged, records each assignment and rejects other
roles/unverified accounts. It does not scan or migrate all users automatically. Review the intended
IDs in Users & Roles before invoking the staff API; repeat with the next explicit batch as needed.
Only Head's authorized, audited username editor deliberately changes an established handle.

`src/server/auth/username.test.ts` exercises real PostgreSQL same-table/cross-table races,
rename versus allocation, simultaneous backfill, rollback, setup, promotion and canonical mirror
reconciliation. Naming and optional-spelling rendering have separate pure/UI regression tests.

## Canonical academic profiles

`AcademicProfile` is one row per `User`, independent of tutor, tutee and crew membership.
It holds an explicit `REPORTED`, `UNKNOWN` or `NOT_APPLICABLE` state, supported G1–G12
number, optional raw school-system text, reference school year (`YY-YY`), confirmation
instant and reconfirmation flag. `AcademicConfirmation` preserves successive confirmed
values, actor, source and optional correction reason. Expected graduation is derived as
the reference school-year end plus `12 - grade`; no override or username parsing is used.

Interactive confirmations and invitation registration take the reference school year
from the active program term on the server. Clients cannot supply an alternative year.
The editor sends its observed year so a concurrent program-year change rejects the stale
confirmation. Internal historical confirmations retain their original reference year.
Users & Roles shows a compact class year where known; full academic evidence is in
User Details.

Current identity records (User, Tutor, Tutee) store explicit `firstName`, `lastName`,
`preferredName`, and `alternativeNames` (the UI's Name in Another Language).
First, last and preferred names have fixed server-side Latin-script validation, with accents,
spaces, apostrophes and hyphens allowed. Alternate names accept Unicode. Blank optional
names are allowed. The legacy policy booleans remain for wire/storage compatibility; the
current API always reports true/false and ignores attempts to change the fixed rules.

`ProgramSettings.usePreferredNames` and `showAlternateNames` default off. ADMIN/HEAD
can change them with stale-draft checking and an audit record. The preferred name replaces
only the first name; the alternate name is appended with a middle-dot separator. PostgreSQL
triggers materialize this label in `User.name` and roster `englishName`, so existing
readers, exports and refreshed authentication sessions agree. The settings writer takes the
username namespace lock then identity table locks before refreshing labels in one transaction.
Saving invalid names rolls back the profile operation. Shared account writes copy explicit
fields to linked rosters; they never split a display label. Username generation uses the
explicit fields rather than the display label.

Migration `20260930010000_four_name_fields` preserves original labels in `legacyName`
and copies only already-explicit matching tutor fields. Unconfirmed old tutor splits retain
the original label until edited. Intake snapshots gain nullable explicit fields without
rewriting old submissions. No trigger touches signatures or audit snapshots. Apply migrations
before deploying the matching application; regenerate Prisma after changing the schema.
The new migration follows the historical `program_profile_policy` and `legal_name_policy`
migrations. New grade reports must still use an offered grade.

See [name-field wording and behavior](design/name-fields.md) for labels and display examples.

Self-service writes own the current authenticated account. ADMIN/HEAD can correct other
accounts; coordinator corrections follow the same proposal/approval workflow as account
name edits. Academic and name changes share the account advisory/row lock and
`User.profileVersion`; two concurrent edits cannot silently replace one another. Linked
Tutor grade fields are compatibility mirrors. Historical `Tutee.gradeLevel`, surveys,
policy/signature snapshots and unrelated names/emails are never rewritten. Roster APIs
return a separate `academic` summary for the current explicit account link. Tutor records
without accounts retain provisional fields and an unknown/unconfirmed summary.

Migration deliberately does not invent reference years or confirmation dates for legacy
grades. Recognized `G10`, `Grade 10` and numeric `10` forms normalize to G1–G12; nonstandard
school systems remain raw text with no inferred graduation. Conflicting User/Tutor/Tutee
sources retain their original values together and require an explicit correction.

Verified student intake records the server-observed account ID/profile version in its
immutable payload. After email proof establishes explicit ownership, a matching version
can confirm a repeated grade, a changed grade or a new reference year. Later profile edits
win over old verification links. Existing conflicting registration/legacy data stays
unchanged and prompts confirmation; hidden/omitted optional grade input is a no-op.
Intake verification is bound to its original active intake term, so a later link cannot
stamp a new school year onto an old answer. Crew application grade/name prefill transfers
to registration for deliberate confirmation without mutating the application snapshot.

Rollover never advances grades. A known report becomes stale at the year boundary and its
expected graduation stays anchored to its original reference. Only an ACTIVE tutor with
confirmed current-year G12 may graduate at the configured graduation boundary (Q4 entry,
or year crossing in semester mode). Known stale reports require confirmation before
reactivation/reentry; unknown/optional and not-applicable data cannot create a new signup
barrier. A tutoring participation break never implies an academic gap. Repeated years,
acceleration and school gaps are new self-reported confirmations with the correct year.

Tests in `src/lib/academics.test.ts` and `src/server/academics.test.ts` cover normalization,
role-independent API ownership, version races, historical preservation, rollout states,
G12 exceptions, reference-year estimates, verified intake and migration fixtures. The
migration regression runs inside a rollback-only PostgreSQL schema in the allowlisted
local test database.
## Serializable username allocation

Program-record transfer uses the same username namespace fence before importing Tutor rows. See [CSV archive internals](#csv-archive-internals) for its transaction and permission boundaries.

The namespace lock also updates the singleton `UsernameNamespaceGuard` row. Advisory locking
alone cannot refresh a snapshot already established by a Serializable approval transaction:
a later User allocation could otherwise be invisible when that snapshot creates a Tutor (and
vice versa). The persisted write fence causes PostgreSQL to reject stale snapshots before handle
selection. Its upsert recreates the singleton after isolated fixture resets; failed transactions
roll back both the fence revision and their account writes.

Identity-capable approval replays acquire this fence before dispatch or profile/leadership locks.
Only a serialization failure tagged by that fence is retried, at most three times at the outer
approval transaction boundary, with a fresh snapshot and rechecked authority/proposal evidence.
Generic commit failures and callbacks that fail after external work are not automatically repeated.
SMTP delivery remains after the committed approval result. Tests reproduce the former ambiguity
in both cross-table directions and exercise a real blocked approval replay, bounded retries and
non-retryable failures.

## CSV archive internals

`src/server/api/routers/record-transfer.ts` exposes HEAD-only export, preview and import procedures. Each rechecks and locks the active account within its transaction; a stale HEAD session cannot authorize a transfer. These procedures are deliberately absent from coordinator approval operations. Export uses a Repeatable Read snapshot and writes export audit evidence. Preview and import use Serializable transactions plus the shared import advisory lock. Tutor files acquire the username namespace fence before the account lock.

`src/server/record-transfer.ts` declares the domain-table allowlist in dependency order. PostgreSQL metadata supplies column types, nullability, defaults, enums and primary keys. Only allowlisted tables and validated column names enter SQL identifiers; cell values use bound JSON parameters through `jsonb_populate_record`. New columns require security review: User remains restricted to ID/name/email, and survey token hashes remain excluded. `User.csv` validates existing accounts without writing them. Scalar ownership and other live references receive explicit checks in addition to database foreign keys; historical actor snapshots can survive account deletion.

Preview runs the same validation/insertion code and deliberately rolls back the transaction. This exercises actual unique and referential constraints without retained writes, notifications or emails. A 15-minute HMAC ticket binds the exact uploaded files to the actor. Import verifies the ticket and revalidates against the current database. Exact primary-key matches are skipped only when all supplied values match; conflicting rows abort the transaction. The import audit entry commits with the data. These three operations bypass the generic post-mutation audit hook because export/import already write transactional evidence and preview must remain a dry run. Imported survey tokens are random hashes with no issued plaintext link.

`src/lib/record-transfer.ts` defines strict CSV parsing and reversible, formula-safe encoding; `record-transfer-archive.ts` checks ZIP names and expanded sizes before extraction. `src/app/_components/record-transfer.tsx` loads ZIP support only on demand and clears preview/confirmation state when files change. The server page and navigation both restrict the feature to HEAD; existing Reports CSV controls use the refreshed account role. Limits are 5 MiB and 5,000 rows across a transfer. This feature is additive history ingestion, not a replacement for database backup/restore or account provisioning.

Regression coverage is in the three `record-transfer.test` files under `src/lib`, `src/server/api/routers` and `src/app/_components`: role denial, stale privileges, rollback, related-record ordering, retries/conflicts, ticket integrity, CSV/ZIP encoding and bounds, upload/confirmation states and error display. Integration fixtures require the isolated `shbs_shipping_test` database.
