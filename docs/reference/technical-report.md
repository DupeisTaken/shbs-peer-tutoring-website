# Technical report

Use this reference to locate the code behind current behavior and check the invariants a change must preserve. Start with the [architecture map](#architecture). For setup commands, see [local development](../contributing/local-development.md); for production operations, see [deployment](../guides/deployment.md).

## Contents

- [Architecture](#architecture)
- [Universal account invitation contract](#universal-account-invitation-contract)
- [Public signup URL convention](#public-signup-url-convention)
- [Program refresh and recruitment transitions](#program-refresh-and-recruitment-transitions)
- [Identity and authorization](#identity-and-authorization)
- [Approval transactions](#approval-transactions)
- [Student lifecycle and ownership](#student-lifecycle-and-ownership)
- [Scheduling, hours and discipline](#scheduling-hours-and-discipline)
- [Communication](#communication)
- [Policy documents and translations](#policy-documents-and-translations)
- [Subject groups and qualification snapshots](#subject-groups-and-qualification-snapshots)
- [Signup field configuration](#signup-field-configuration)
- [CSV archive internals](#csv-archive-internals)
- [Data and deployment](#data-and-deployment)
- [Validation and development](#validation-and-development)

## Architecture

The application runs as a persistent Next.js 16 / React 19 Node server with tRPC 11, Prisma 7 / PostgreSQL, Auth.js JWT sessions, `next-intl`, and Tailwind CSS 4. It is not a static export: authentication, background workers, and transactional mutations require the Node runtime.

| Change area | Primary entry points |
| --- | --- |
| Pages, shells, and navigation | [App routes](../../src/app), [6-section admin nav](../../src/app/_components/admin-nav.tsx), [shared components](../../src/app/_components), [message catalogs](../../messages) |
| API procedures and middleware | [Router composition](../../src/server/api/root.ts), [procedure middleware](../../src/server/api/trpc.ts) |
| Schema, migrations, and transactions | [Prisma schema](../../prisma/schema.prisma), [migrations](../../prisma/migrations), [database client](../../src/server/db.ts), [transaction helpers](../../src/server/transactions.ts) |
| Management approval pipeline | [Operation classification](../../src/lib/approval-policy.ts), [proposals](../../src/server/approvals.ts), [approval router](../../src/server/api/routers/approval.ts) |
| Intake, lifecycle, and ownership | [Surveys](../../src/server/student-survey.ts), [student workflow](../../src/server/student-workflow.ts), [ownership](../../src/server/student-ownership.ts), [membership](../../src/server/membership.ts) |
| Unified identity and profiles | [Account profiles](../../src/server/account-profile.ts), [record combination](../../src/server/person-combine.ts), [identity lifecycle](identity-lifecycle.md) |
| Name rules and field display | [Configured identity fields](../../src/app/_components/person-name-fields.tsx), [server helpers](../../src/server/program/name-fields.ts), [name fields](name-fields.md) |
| Messaging and supervision | [Messaging permissions](../../src/server/messaging-permissions.ts), [messaging router](../../src/server/api/routers/messaging.ts) |
| Planned rooms, pairing groups, and workload | [Room allocation](../../src/server/room-allocation.ts), [booking locks](../../src/server/room-bookings.ts), [creation receipts](../../src/server/pairing-creation.ts), [group writer](../../src/server/pairing-groups.ts), [combine selection](../../src/lib/pairing-group-selection.ts), [workload reader](../../src/server/tutor-workload.ts) |
| Dated session planning and delivery | [Session planning](session-planning.md), [essential mail and calendars](session-planning-delivery.md), [delivery engine](../../src/server/session-planning-delivery.ts) |
| Hours, school reports, and corrections | [Hour calculator](../../src/lib/service-hours.ts), [meeting hours](../../src/server/meeting-hours.ts), [school reports](../../src/server/school-hours.ts), [school reporting contract](school-hours.md), [corrections](../../src/server/api/routers/corrections.ts) |
| Crew and discipline | [Patrol credit](../../src/server/crew/patrol-credit.ts), [crew flags](../../src/server/crew/flags.ts), [discipline standing](../../src/lib/discipline.ts), [removal sync](../../src/server/discipline/removal.ts) |
| Published content, policies, and translations | [Slug allocation](../../src/server/home/slugs.ts), [translation checks](../../src/server/translation-destination.ts), [policy acceptance](../../src/server/policy-acceptance.ts) |
| Time, periods, and refresh | [Program time](../../src/lib/program-time.ts), [period display](../../src/lib/period.ts), [refresh](../../src/server/program/refresh.ts), [scheduled refresh](../../src/server/program/scheduled-refresh.ts) |
| Email, notifications, and workers | [Email sender](../../src/server/email/sender.ts), [instrumentation](../../src/instrumentation.ts), [deadline worker](../../src/server/student-deadline-worker.ts), [event inventory](notification-events.md) |
| Causal recovery and archives | [Recovery contract](recovery.md), [CSV transfer](../../src/server/record-transfer.ts), [record catalog](../../src/server/recovery/record-catalog.ts) |
| Help catalogue and PDF handbooks | [Help catalogue](../guides/help/README.md), [maintenance procedure](../contributing/help-catalogue.md), `src/lib/help`, `/api/help/pdf/[audience]` |

**Help catalogue & CI-baked assets:** `src/lib/help` stores bilingual task records. The server reader derives live capabilities before serializing search results or articles; Admin and Head PDF editions keep separate authority gates. Screenshot handlers serve only manifest-approved IDs; raw assets stay gitignored and are baked on demand by `.github/workflows/help-assets.yml` (`scripts/capture-help-screenshots.ts`, `src/lib/help/image-budget.ts`) to the rolling `help-assets-latest` GitHub Release, which `.github/workflows/docker-build.yml` verifies and unpacks via `scripts/unpack-help-assets.mjs`. Staff PDF downloads render with a 2-slot concurrency guard, Geist TrueType, and the local Noto Sans SC subset checked by `npm run help:check`.

### Users and Roles details

- **Tutor details (`tutorDetails.get`):** on-demand management read excluding credential secrets. Subject grouping reads concrete `QualificationGrant` rows from approved sources without recalculating inheritance from current level ranks; willingness is three-state (`true`, `false`, or unset); policy history reads via the linked account ID (`student.acceptanceRecords`).
- **Tutee details ([`TuteeDetailsDialog`](../../src/app/_components/tutee-details.tsx)):** wide `ProfileDialog` combining enrollment summary, subject choices, email controls, and paginated `TuteeHistoryContent` (refreshed on each open). Viewers and departure observers see only summary and subjects; private contact and history queries never mount. A retained historical owner allows contact display without enabling current-account verification.
- **Directory projection (`admin.accounts`, `admin.accountDetails`):** projects one directory row per explicit `Person` group (including accountless Tutor/Tutee sources) while keeping each member's roles separate. Filtering evaluates the full search/filter expression against each independent member—never unioning privileges or mixing facts across members. `UserDetailsHost` captures an opening independently of filtered rows, refreshes on open, retains group controllers through transient errors, and conceals private evidence on authoritative denial while keeping safe receipts/recovery available.
- **Application account setup (`admin.applicationAccountSetup`):** on-demand staff read powering an accepted application's **Set up account** popup. Exposes active application-bound codes or linked/pending/restricted/expired/missing states without issuing codes or sending email. Its **Open Users & Roles** link uses [`tutor-directory-link.ts`](../../src/lib/tutor-directory-link.ts) (`/admin/users#tutor-<encoded tutor ID>`) to highlight the exact `tutorDestinations` source (bypassing saved filters until **Return to directory**) without granting representative-account actions or sending setup invitations. Retained historical owners cannot receive accountless setup invitations.

### Management review summaries

- **Signup request queues (`StudentRequestBoard`):** `signupRequestGroup` assigns actionable pending reviews to **Needs review**, invalid/non-open requests to **Closed**, and remaining open requests by subject coverage to **Assigned** (collapsed initially) or **Needs matching**. Display ordinals are consecutive per visible queue. Self-service cards badge `Email verified` / `Email pending` from submission confirmation; legacy/manual cards label `Verified` only when the contact matches a confirmed owner primary address (never inferred from missing flags).
- **Retained legacy signup decline ([`legacy-signup-decline.ts`](../../src/server/legacy-signup-decline.ts)):** `admin.declineSignup` records an immutable `LegacySignupDecline` snapshot (version + same-intent client receipt), marks the Tutee inactive, and releases current-period links without deleting the source or creating an email-wide ban. Blocked by survey backing, consolidation, invalidity, pending reviews, attendance, or published dated sessions (localized via [`legacy-signup-decline-error.ts`](../../src/lib/legacy-signup-decline-error.ts)). Coordinator proposals require Admin/Head approval; observers never receive decision fields.
- **Subject Availability & Offerings:** Subject Availability orders qualified/willing, qualified/unwilling, qualified/not-recorded, then unqualified in catalog order (`courseChoices`), keeping immediate qualification and willingness writes separate. Subject Offerings preserves level-first catalog order.
- **Attendance Flags & Audit diffs:** Attendance Flags filter `viewerProcedure` by decision state (default `Pending`); authoritative denial latches until a fresh authorized `Pending` read. Audit difference markers compare stored JSON before/after values (preserving missing vs. `null`/empty/`false`/`0` and excluding `undoData`) without querying mutable live records.

### Shared UI patterns

Contributor design, composition, and recipe ownership live in [design conventions](../contributing/design.md), [interaction patterns](../contributing/interaction-patterns.md), [implementation recipes](../contributing/implementation.md), and [UI recipes](../contributing/ui-recipes.md). Core shared modules and contracts:

| Module | Contract |
| --- | --- |
| [`SummaryTable`](../../src/app/_components/ui/summary-table.tsx) & [`table-sorting.tsx`](../../src/app/_components/ui/table-sorting.tsx) | Opt-in 3-state client sorting (`asc → desc → none`) over keyed React rows using locale-aware numeric collation and `data-sort-value`; missing values stay last; logs, queues, and paginated history opt out. |
| [`session-view-state.tsx`](../../src/app/_components/session-view-state.tsx) & [`session-view-state.ts`](../../src/lib/session-view-state.ts) | `sessionStorage` persistence for allowlisted tabs/filters/pages partitioned by identity, pathname, feature ID, and scope (max 100 entries, 4 KiB UTF-8 budget, `restoreReady` gate for dynamic catalogs; never drafts/tokens). `useSessionAccessDenied` latches authoritative denials through later transport errors. |
| `useSessionPageScroll` & [`WorkspaceHeaderFrame`](../../src/app/_components/workspace-header-frame.tsx) | Restores `#admin-content` (desktop ≥1024 px) or document scroll after authorized reads settle (≤5 s, cancelled on user gesture, hash arrival, or pathname exit). `WorkspaceHeaderFrame` updates scroll padding and corrects focus occlusion without stealing focus. |
| [`action-review.tsx`](../../src/app/_components/ui/action-review.tsx) (`useActionReview`, `ReviewedAction`) | Consequential confirmation dialog with same-turn admission lock, queued-proposal distinction (`approvalId`), read-only post-save refresh recovery, and `revoke()` on authoritative denial. |
| [`query-feedback.tsx`](../../src/app/_components/ui/query-feedback.tsx) (`QueryFeedback`) | Uses `StatePanel` for initial loading/error and `InlineNotice` when cached data survives a failed refresh (`hasData` checks response presence, not array length). |
| [`modal.tsx`](../../src/app/_components/ui/modal.tsx) (`NativeDialog`, `Modal`, `ProfileDialog`, `TimedActionDialog`) | Native `<dialog>` modality, `useDialogPending(ownPending)` dismissal guard, `returnFocusFallback`, sticky header stacking context above nested sticky table actions, and close-watcher Escape blocking while busy or mandatory. |
| `settleRefreshes` & `invalidateAndReport` | Awaits all invalidation families (even if one throws) and snapshots `errorUpdateCount` to report genuine post-write refresh errors without replaying accepted mutations. |
| [`program-settings.tsx`](<../../src/app/(admin)/admin/program/program-settings.tsx>) & [`program-write-admission.tsx`](../../src/app/_components/program-write-admission.tsx) | Retains account-keyed settings owners across transient `account.me` errors while blocking new writes until identity recovers; authoritative denial or rank change unmounts private owners. |
| [`account-deletion.tsx`](../../src/app/_components/account-deletion.tsx) & [`delete-account.ts`](../../src/server/delete-account.ts) | Preview-fingerprinted, password-confirmed Admin/Head account deletion serialized under namespace, leadership, account, and dependency locks; blocks combined families, retained owners, and unconfirmed intake. |
| [`ui-gallery/gallery.tsx`](../../src/app/ui-gallery/gallery.tsx) & [`recipes.tsx`](../../src/app/ui-gallery/recipes.tsx) | Development-only gallery (404 in production) exercising the real UI components and compositions. |

### UI extension boundaries

| Owner | Responsibilities | Reference examples |
| --- | --- | --- |
| Server feature | Live authority, ownership, version/ticket checks, transactions, approval replay, and immutable audit evidence | [`trpc.ts`](../../src/server/api/trpc.ts), [`approval-policy.ts`](../../src/lib/approval-policy.ts) |
| Feature controller | Local drafts, selected target, expected version, localized consequence, mutation, proposal/error adapters, and refresh/recovery lifetime | [`announcements/page.tsx`](<../../src/app/(admin)/admin/announcements/page.tsx>), [`crew/page.tsx`](<../../src/app/(admin)/admin/crew/page.tsx>), [`account-profile-editor.tsx`](../../src/app/_components/account-profile-editor.tsx) |
| Shared interaction | Controls, native modality, focus/pending guards, review admission, and accepted-write refresh recovery | [`action-review.tsx`](../../src/app/_components/ui/action-review.tsx), [`modal.tsx`](../../src/app/_components/ui/modal.tsx), [`patterns.tsx`](../../src/app/_components/ui/patterns.tsx) |
| Presentation | Hierarchy, labels, density, and summaries | [`button.tsx`](../../src/app/_components/ui/button.tsx), [`summary-table.tsx`](../../src/app/_components/ui/summary-table.tsx), [`recipes.tsx`](../../src/app/ui-gallery/recipes.tsx) |

There is no generic action registry or schema-driven form engine. `ReviewedAction` owns client confirmation ergonomics; `classifyApproval` independently enforces server authority. In `useActionReview`, `commit` runs the mutation, `refresh` handles read-only recovery (never re-calling `commit`), `repeatAfterRefresh` unlocks recurring actions only after synchronization succeeds, and `revoke()` clears open evidence on authoritative denial without cancelling an admitted write.

### Cross-feature UI contracts

- **Tutoring calendar policy (`ProgramCalendarDay`):** inclusive `date` (unique identity) to `endDate` (`>= date`), with explicit `NOTICE` or `PAUSE_REGULAR` effect and monotonic tombstones. Only `PAUSE_REGULAR` cancels future automatic ordinary sessions; school-day appeal deadlines, recurring assignments, and historical attendance stay separate.
- **Name requirements ([`name-fields.ts`](../../src/server/program/name-fields.ts)):** per-account-type `Required` / `Optional` / `Hidden` rules govern signup and shared-profile editing (by current account role). Hidden fields omit participant inputs and active display (falling back to username if blank) while preserving stored values for staff editors and historical evidence.
- **Room order and localized weekdays:** display order is separate from patrol order; participant availability headings and summaries localize weekdays via `formatWeekday` without altering weekday indices, slot IDs, or minute payloads.
- **Flag history & audit diffs:** state filters query authorized server datasets (never reconstructing resolved rows client-side); evidence diffs compare immutable stored snapshots only.
- **Navigation restoration:** session storage holds validated view preferences and scroll offsets only; early manual tab clicks on static `Requests` panels take transient precedence over saved defaults for the same identity/scope, while explicit notification destinations still win.

### Confirmation timing contract

[`confirmationDelayMs`](../../src/lib/confirmation-timing.ts) defines authoritative server delays for `StudentActionConfirmation` tickets:

| Ticket action | Delay | Ticket lifetime | Purpose |
| --- | --- | --- | --- |
| `RECALL`, `SCHEDULE`, `DENY`, `ASSIGN` | 2 s | 30 min | Single-request closure, conflict proposal, denial, or tutor assignment |
| `ASSIGNMENT_OVERRIDE` | 2 s | 5 min | Named unqualified-tutor override (confirmed by proposer and reviewer) |
| `ABORT`, `SURVEY_ABORT`, `APPROVE` | 3 s | 30 min | Quarter withdrawal or participation/assignment-ending approval |
| `POLICY`, `SIGNUP_EDIT`, `SIGNUP_UNASSIGN`, `SIGNUP_APPEAL` | 5 s | 30 min | Policy consent (plus bottom-scroll check), signup edits, releases, and appeals |

`prepareStudentAction` and `prepareAssignmentOverride` return `readyAt`, `expiresAt`, and `serverNow`, anchored to `performance.now()` on receipt so readiness ignores client clock skew and expiry subtracts observed RTT. Zero never auto-submits; a ref blocks same-turn duplicate admission until rejection; server transactions enforce `readyAt <= now < expiresAt`, matching actor/action/target, and single use atomically.

## Universal account invitation contract

`AccountInvitation` is an additive recipient-only envelope (HMAC-hashed mailbox code, separate source reference, recipient email, credential generation, and completion receipt). Staff-visible `RegistrationCode` keys authorize inspection but never authenticate an existing account.

| Source | Authorization and email proof | Redemption result | Boundary |
| --- | --- | --- | --- |
| Tutor/Crew/management staff key | Staff authorization + separate recipient mailbox code | Creates missing credentials or adds authorized access to existing account | Management rank becomes `max(existing, invited)`; no Head grant or demotion |
| Tutee request | Full application + policy consent → exact-submission mailbox verification | Confirms new demand or applies staged answers to owned `OPEN` request | Preserves original priority, fixed 7-day deadline, and source consent |
| Viewer request | Initial mailbox verification + verified-browser proof | New address → read-only Viewer; existing account → sign-in only | Enforces Viewer exclusivity and public Viewer gate |
| Public Crew application | Mailbox verification → staff approval → fresh mailbox verification | Creates missing credentials or adds Crew participation | No access before approval and review; Crew gate stays authoritative |
| Historical participant invitation | Exact staff-reviewed Tutor/Tutee sources + ownership generations + mailbox proof | Creates/uses neutral login; signed-in owner separately claims frozen sources | No current participation added |
| Admin/Head tutor setup | Admin/Head authorizes Tutor invitation to locked roster contact | No login before redemption | Existing logins recover via canonical email only |

**Core invariants:**

- Envelopes capture account ID and `sessionVersion` at issue; password rotation, alias removal/transfer, or account combination invalidates stale evidence.
- Verified-browser handoffs use `rememberInvitation` to set a 15-minute `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookie scoped to `/register-account`—never putting proofs in URLs, history, or Web Storage. `accountInvitation.inspect` is ID-only; `accountInvitation.review` accepts proofs via POST.
- Invitations expire in at most **15 minutes** (capped by source/application deadlines). First Viewer/history verification starts a fixed 15-minute window; resends never extend staff or tutee deadlines.
- Primary and verified secondary emails resolve to the same account; primary proof confirms primary email, while secondary proof does not confirm a different primary. Existing passwords and 2FA remain enforced.
- Source write and completion receipt commit atomically so lost-response retries recover receipts without duplicating accounts or replaying membership writes.

### Crew application verification and status

`CrewSignupVerification` stages unverified applications separately from durable `CrewApplication`. `crew.submitApplication` sends a mailbox challenge without creating an application or staff notification; `crew.verifyApplication` commits the first verified pending application and notification together (retries keep original answers).

`crew.requestStatus` returns a uniform public response for known and unknown emails; `crew.applicationStatus` requires a 15-minute mailbox status proof before returning `PENDING`, `REJECTED`, `ACCEPTED`, or `NOT_FOUND`. Only an accepted application with a live unused staff Crew code can retrieve `InvitationReceipt`. Submit/status mail uses signup ingress admission and the tutee CAPTCHA scene with distinct `crew.submit` and `crew.status` grants.

### Opaque invitation codes

[`src/server/auth/code.ts`](../../src/server/auth/code.ts) keeps invitation and verification code generation/normalization strictly separate:

- **Displayed invitations & staff keys:** 5 mixed alphanumeric characters from `023456789ABCDEFGHIJKMNPQRSTUVWXYZ` (must contain both a letter and a digit; derived under `display:mixed:v3` with stored collision nonce so retries reproduce the same code). Green background in UI (`XXXXX` placeholder) and dark green (`#18342C`) in HTML mail. Older still-valid 5-digit, 5-char, and 12-char codes remain accepted until expiry/revocation.
- **Email verification codes:** 4 digits (`0–9`), preserved as strings so leading zeros survive; 5–6 failure cap per challenge (`emailCodeVersion = 1`; legacy hex rows keep `version = 0`). Blue background in UI (`XXXX` placeholder) and `#172F49` in HTML mail.

Codes are opaque: no character encodes role or identity. Server resolution checks authorization, recipient, expiry, and purpose against database records.

| Verification purpose | Owning module |
| --- | --- |
| Tutee signup & staged replacement | [`student-survey.ts`](../../src/server/student-survey.ts), [`student-signup-intents.ts`](../../src/server/student-signup-intents.ts) |
| Viewer signup | [`viewer-signup.ts`](../../src/server/auth/viewer-signup.ts) |
| Crew application & status | [`crew/signup.ts`](../../src/server/crew/signup.ts) |
| Staff-key & recipient invitation | [`registration.ts`](../../src/server/auth/registration.ts), [`account-invitations.ts`](../../src/server/auth/account-invitations.ts) |
| Historical access setup | [`history-account-setup.ts`](../../src/server/history-account-setup.ts) |
| Associated-email & primary change | [`account-emails.ts`](../../src/server/auth/account-emails.ts), [`email-change.ts`](../../src/server/auth/email-change.ts) |
| Email 2FA & security step-up | [`two-factor.ts`](../../src/server/auth/two-factor.ts), [`step-up.ts`](../../src/server/auth/step-up.ts) |

## Public signup URL convention

Published website and email links use short paths that permanently redirect (`HTTP 308`, preserving query strings) to canonical routes in [`next.config.js`](../../next.config.js). [`src/server/auth/config.ts`](../../src/server/auth/config.ts) allowlists exact public routes without prefix exemptions.

| Published href | Canonical route | Purpose |
| --- | --- | --- |
| `/register` | `/register-account` | Shared account/access invitation review |
| `/tutee` (compat `/signup`) | `/tutee-signup` | Request tutoring |
| `/tutee/account` (compat `/signup/account`) | `/tutee-signup/account` | Confirm tutoring request and account setup |
| `/tutor` | `/tutor-signup` | Apply to tutor |
| `/viewer` | `/viewer-signup` | Register Viewer access (when enabled) |
| `/crew` | `/crew-signup` | Apply to Crew (when enabled) |

[`public-signup-links.ts`](../../src/lib/public-signup-links.ts) maps exact root-relative signup links in CMS buttons/Markdown without rewriting stored content.

**Public QR endpoint ([`public-qr/route.ts`](../../src/app/api/public-qr/route.ts), [`render.tsx`](../../src/server/public-qr/render.tsx)):** allowlists `destination=tutor|tutee|crew|site`, optional `locale=en|zh`, and optional `download=1`, deriving the URL solely from validated `AUTH_URL` (`no-store`, `nosniff`, `shbs-{destination}-qr-{locale}.png`). Renders transparent-background black QR + Geist Sans + local Noto Sans SC footer without runtime font fetches, loading both packaged fonts via direct static literal `process.cwd()` paths so standalone tracing includes only those two files rather than local ignored evidence directories.

## Program refresh and recruitment transitions

- **Next-period recruitment preparation ([`next-recruitment.ts`](../../src/server/program/next-recruitment.ts)):** stores versioned `NextRecruitmentPreparation` rows keyed by source term and audience (absent row = preserve destination opening; null opening = explicit clear). Admin/Head apply directly; Coordinators propose. Lock order: `program:period` → active source term → `program-timezone` (then username namespace during refresh). Feature staging, timezone changes, and quarter-mode changes advance the source transaction fence so stale preparations fail closed.
- **Unified Program Refresh & scheduled activation ([`refresh.ts`](../../src/server/program/refresh.ts), [`scheduled-refresh.ts`](../../src/server/program/scheduled-refresh.ts)):** [`program-settings.tsx`](<../../src/app/(admin)/admin/program/program-settings.tsx>) presents one unified **Program Refresh** card (`Authorize Refresh` with `Schedule for later` / `Refresh now`, `Effects & full refresh details`, embedded Next-Period Recruitment editors, and immediate `Needs renewed review` rechecks). `ScheduledProgramRefresh` stores one versioned Head authorization per source term with `User.refreshAuthorityRevision` (incremented by DB trigger on role, suspension, or merge changes). The Node worker sweeps at startup and every 30 s, marking drift as blocked with audit + notice and capping execution retries at 5.
- **Public signup transition ([`public-signup-transition.ts`](../../src/server/program/public-signup-transition.ts), [`lib/public-signup-transition.ts`](../../src/lib/public-signup-transition.ts)):** projects allowlisted current/next-period metadata under the period barrier. Countdown reaching zero hides the clock while waiting for server confirmation without unlocking form fields. Fresh public tutee submissions require `expectedTermId`.

See [program configuration](../guides/program-configuration.md#refresh-the-program) and [worker operations](../guides/deployment.md#scheduled-program-refresh-worker).

## Identity and authorization

Account role, linked tutor profile, Crew lifecycle, Translator capability, and Tutee membership are separate capabilities stored in [`account-membership.ts`](../../src/lib/account-membership.ts) (`User.role`, `tutorId` + `tutorAccessRevoked`, `crewStatus`, `canTranslate`, `tuteeMember`, with Viewer exclusivity enforced by schema and DB constraint). Protected requests reload live role, linkage, and suspension state; matching names or emails never grant access.

| Procedure family | Authorization boundary |
| --- | --- |
| `publicProcedure` | Public endpoints with input validation and feature gates |
| `protectedProcedure` | Authenticated active session |
| `tutorProcedure` / `activeTutorProcedure` | Linked tutor / active non-revoked tutor duties |
| `crewProcedure` | Active Crew or management with Crew module enabled |
| `adminProcedure` | Management; classified mutations apply, queue for review, or deny by live authority |
| `adminOnlyProcedure` / `headProcedure` | Admin or Head / Head only |
| `viewerProcedure` | Management reads projected through fail-closed [`management-read-models.ts`](../../src/server/management-read-models.ts) for Viewers and departure observers |
| `translatorProcedure` / `translationReviewerProcedure` | Explicit `canTranslate` editors / management reviewers or authors reading own drafts |

- **Observer masking (`management-read-models.ts`):** only allowlisted scalar fields and projected relations reach Viewers and departure observers; unregistered reads fail closed. Audit observer search matches actor name, entity, and operation metadata only (never hidden narratives or `undoData`).
- **School departure ([`school-departure.ts`](../../src/server/school-departure.ts), [`portal-access.ts`](../../src/lib/portal-access.ts)):** `SchoolDeparture` and versioned `SchoolDepartureEvent` derive read-only observer access without rewriting roles, serialize with refresh/account edits, close active participation, and preserve history.
- **Password bounds & confirmation rate limit ([`password-contract.ts`](../../src/lib/password-contract.ts), [`password-confirmation.ts`](../../src/server/auth/password-confirmation.ts)):** new reset/change passwords accept **8–1,024** UTF-16 code units (bootstrap: **12–1,024**; setup/invitation forms keep **8–200**; plaintext is never trimmed/normalized/truncated, and oversized resets reject before token lookup or hashing). Signed-in confirmations share 10 checks per 15 minutes per stable account ID (1–1,024 chars; process-local store).
- **Live primary email in sessions & headers:** JWT token reuse in [`auth/index.ts`](../../src/server/auth/index.ts) reloads live `email` alongside `name`, `role`, `tutorId`, and `historyAccessRevision`, and [`(admin)/layout.tsx`](<../../src/app/(admin)/layout.tsx>) reads live `email`/`name` for `UserAvatar`. Email changes and secondary promotions call `router.refresh()` after query invalidation so headers update without re-signing in.
- **Unified record combination & historical tutor linking:** [`person-combine.ts`](../../src/server/person-combine.ts) and [`person-identity.ts`](../../src/server/person-identity.ts) manage explicit `Person` groups (directory metadata only, never an authorization principal) with `REVIEW_REQUIRED` conflict tracking, explicit login retirement (`User.mergedIntoId`), and `combine-records.tsx`. [`tutor-history.ts`](../../src/server/tutor-history.ts) manages `TutorProfileOwnership` read grants without replacing `User.tutorId`. See [identity lifecycle inventory](identity-lifecycle.md).
- **Client session cache & privacy curtain:** route changes and tab focus run a live identity check while concealing mounted private content (including portaled dialogs) behind a fixed curtain (`visibility: hidden`, `inert`, `aria-hidden`), preserving drafts and scroll positions; identity change or denial clears cache and reloads layout. Browser tRPC links batch up to 20 operations ([`trpc-batch.ts`](../../src/lib/trpc-batch.ts)); [`client-logger.ts`](../../src/trpc/client-logger.ts) suppresses console overlay errors for handled `pairingGroups.save` and `admin.declineSignup` rejections.

### Stable account usernames

Verified accounts share one permanent lowercase ASCII handle (`1–64` chars, rules in [`src/lib/username.ts`](../../src/lib/username.ts)) with any linked tutor record. Accents normalize (`José García` → `jgarcia`), non-Latin names accept an optional Latin spelling or fall back to `member`, and graduation suffixes are initial hints only.

- **Serializable namespace fence:** all handle writers acquire transaction advisory lock `identity:username-namespace` AND update the singleton `UsernameNamespaceGuard` row (`ensureUniqueUsername` requires the active transaction client). Because PostgreSQL Serializable snapshots would otherwise miss concurrent cross-table User/Tutor allocations, the persisted guard row forces a serialization failure, which identity-capable approval replays retry up to 3 times with fresh authority/evidence checks.
- **Student allocation & backfill:** student handles assign on verified signup/re-enrollment, single-account **Users & Roles → Assign Username**, or explicit Admin/Head `admin.backfillStudentUsernames` (1–100 verified STUDENT IDs per batch). Viewers stay email-only unless explicitly assigned.
- **Management editing:** Admin/Head update any login's username atomically with its linked tutor in **Users & Roles → Edit profile** (Coordinators propose); the section refreshes its version automatically after save so repeat edits work without reopening.
- **Display fallback:** `ParticipantName` / `participantNameLabel` fall back from canonical name to authorized username to localized unnamed label (presentation only; search/sort use raw values).

### Canonical academic profiles

`AcademicProfile` (one per `User`) stores `REPORTED` / `UNKNOWN` / `NOT_APPLICABLE`, grade `1–12`, optional raw school text, reference school year (`YY-YY` from active term on the server), and confirmation/reconfirmation flags; `AcademicConfirmation` appends immutable history. Expected graduation is `referenceEndYear + (12 - grade)`. Grades never auto-advance on rollover; only active tutors with confirmed current-year G12 auto-graduate at the graduation boundary.

Structured names (`firstName`, `lastName`, `preferredName`, `alternativeNames`) validate Latin script for the first three and Unicode for alternate names. `ProgramSettings.usePreferredNames` (default `true`) and `showAlternateNames` (default `false`) trigger PostgreSQL materialization into `User.name` and roster `englishName` without rewriting legacy unsplit `legacyName`, signatures, or historical snapshots. See [name fields](name-fields.md).

#### Initial application name corrections

[`application-identity.ts`](../../src/server/tutors/application-identity.ts) (`admin.correctApplicationIdentity`, Admin/Head direct / Coordinator proposal) corrects the four name fields on `INITIAL` applications in `PENDING`/`INTERVIEW` before final decision, completion, promotion, or code issuance. Holds username-namespace + application-review locks, preserves immutable submitted names and append-only correction history, advances application version/identity revision (staling pending decisions/proposals), and supports idempotent retry keys. Promotion readiness uses precedence: verified account → existing roster → application identity.

### Notification record navigation

[`notification-navigation.ts`](../../src/lib/notification-navigation.ts) delegates allowlisted relative record links to [`useNotificationRecordReveal`](../../src/app/_components/use-notification-record-reveal.ts), opting out of Next's default scroll, committing destination filters before DOM reveal, and focusing with `preventScroll`. Desktop reveal scrolls only `#admin-content` from live bounding rectangles (avoiding all-ancestor `scrollIntoView` header shift); mobile retains document reveal. Arrival ownership relinquishes on reveal, user gesture, navigation, or access loss.

## Approval transactions

Every management mutation is classified in [`approval-policy.ts`](../../src/lib/approval-policy.ts) (`classifyApproval` + live-context `proposalAuthority`); unknown Coordinator operations fail closed. Admin/Head apply all non-refresh operations directly; Coordinators queue immutable proposals for Admin/Head review (excluded from management-rank changes, private-message supervision, and refresh). Only official refresh sits in `HEAD_APPROVAL_OPERATIONS` (leadership transfer keeps its own password-confirmed Head-only path).

**Head self-review:** only the current active **Head** may decide official refresh or their own pending management requests (other reviewers—including promoted Admins—cannot self-review). Applies only to **Management Actions**, never interview voting or qualification decisions.

**Proposal execution flow:**

1. Capture validated input, affected records, active period, `reviewReferences` / `reviewPresentation` markers ([`approval-reference-capture.ts`](../../src/server/approval-reference-capture.ts)), and a canonical evidence fingerprint.
2. Consume the requester's confirmation ticket if ticketed.
3. At decision time, recheck live requester/reviewer authority (preferring active eligible Admins for notifications, falling back to Head; `notification.reconcileManagementReviews` reconciles missing deliveries on role changes) and verify unchanged evidence.
4. Replay the original parser and resolver inside one transaction (requiring the reviewer's own fresh confirmation ticket/password where applicable) using [`db-scope.ts`](../../src/server/db-scope.ts).
5. Commit domain mutation, proposal decision, notifications, and audit atomically.
6. Run post-commit external email (e.g., `resendSurveyResult` with `emailSent: null` settled after commit) using the root client so failed SMTP never rolls back committed state.

**Presentation & audit:** [`approval-review.ts`](../../src/lib/approval-review.ts), [`approval-summary.ts`](../../src/lib/approval-summary.ts), [`approval-presentation.ts`](../../src/lib/approval-presentation.ts), [`review-vocabulary.ts`](../../src/lib/review-vocabulary.ts), and [`ApprovalReviewDetails`](../../src/app/_components/approval-review-details.tsx) render immutable proposal snapshots (never live joins). Transactional audit capture records allowlisted before/after snapshots (using [`record-catalog.ts`](../../src/server/recovery/record-catalog.ts) primary-key tuples for bulk writes, never credentials or `undoData`); `admin.auditLogDetail` projects stored events on demand for staff (`AuditChangeSummary` in [`audit-event-details.tsx`](../../src/app/_components/audit-event-details.tsx)). Legacy `admin.undoAudit` refuses partial payloads; prospective initial admissions use the [causal recovery contract](recovery.md).

**Account appeals & concurrency ([`account-appeals.ts`](../../src/server/account-appeals.ts)):** `account.submitAppeal`, `admin.decideAppeal`, `admin.suspendUser`, and `admin.reinstateUser` share READ COMMITTED lock order `namespace → leadership → target account/User → selected appeal`. One pending appeal and reviewer notice per account is admitted; decisions require `PENDING` and the captured `refreshAuthorityRevision` (bumped on every suspension/reason change, validated before Coordinator proposal admission and on replay). Approval co-resolves all pending appeals for that account atomically (distinguishing restoration from already-active closure in [`account_appeal_approved`](notification-events.md#account_appeal_approved)); denying an active account conflicts. Users & Roles captures original appeal and current restriction separately and requires explicit **Reload restriction review** on drift.

**Interview panels, promotion, and additional qualifications:**

- **Chair, voting & panel recovery ([`interview-chair.ts`](../../src/lib/interview-chair.ts), [`interviews.ts`](../../src/server/interviews.ts), [`interview-panel-editor.tsx`](../../src/app/_components/interview-panel-editor.tsx)):** 3–8 active non-revoked, non-merged panelists + **Admin** or **Head** chair (Coordinators may vote, not chair; `chairEligibility: "recorded"` allows hour corrections on already-completed interviews with legacy/demoted chairs). Collapsed/expanded cards show `{accepts} accept · {rejects} reject`. Admin/Head chair acceptance atomically records completion, `minutes / 60` hours ([`interview-hours.ts`](../../src/server/interview-hours.ts)), initial admission/code issuance, and Admin/Head notification (direct chair rejection also applies immediately). `tutor.decideInterview` and Coordinator `queueProposal` admission guard `before.status === "INTERVIEW"` for both accept and reject decisions so fresh-token rejections cannot overwrite terminal `ACCEPTED`/`REJECTED` initial outcomes while exact idempotent acceptance retries remain read-only. `InterviewPanelEditor` captures drafts alongside their original `expectedUpdatedAt` per application, requires explicit **Reload** on stale-version conflict, and provides read-only recovery after an accepted write whose refresh fails.
- **Promotion ([`promote.ts`](../../src/server/tutors/promote.ts)):** locks username namespace + account profiles/users and rechecks verified aliases, retained ownership, and `tutorAccessRevoked`. Management-revoked tutoring access blocks admission even for a Head chair until explicitly restored in **Users & Roles**; ordinary archived tutors can return.
- **Additional qualifications (`qualificationApplication`):** self-only for active non-revoked tutors (`ADDITIONAL_SUBJECT` / `HIGHER_LEVEL`). Only Admin/Head can assign or repair an open panel (`PENDING` or `INTERVIEW` via `admin.assignInterviewers` with required `repairReason`, optimistic `expectedUpdatedAt`, and `panelRepairVersion: 1` audit evidence, superseding open votes while preserving recorded completion and earned service and never reopening terminal `ACCEPTED`/`REJECTED`/`RECALLED` history) or directly approve via `QualificationReview` (**Approve without Interview**, requiring a nonblank note; automatically leaves open Interview Records with no hours). Rejection always requires an interview and panel majority. Retained approval (`retainRecordedService` in `qualificationApplication.decide` and `InterviewApprovalDialog`) validates the complete recorded service ledger without awarding or reassigning hours even when none of the original attendees remain on the current voting panel. Approval calls `approveQualification` and snapshots concrete `QualificationGrant` rows.

## Student lifecycle and ownership

| Action | Invariant |
| --- | --- |
| Submit fresh eligible demand | Reserves priority at acceptance; preserves original payload and signed policy evidence |
| Stage same-email replacement ([`student-signup-intents.ts`](../../src/server/student-signup-intents.ts)) | Stores independent `StudentSignupIntent` + pre-stage admission lease; leaves live request, priority, and proof intact |
| Complete new intent | Requires exact mailbox proof + existing account auth/2FA; replaces current answers and appends `StudentSignupRevision` with stage-time consent |
| Exact network retry | Returns bound acknowledgement/receipt before CAPTCHA or mail admission |
| Resend verification link | Failed delivery preserves usable link; successful delivery replaces it |
| Edit owned `OPEN` signup ([`student-signup-editor.ts`](../../src/server/student-signup-editor.ts), [`student-signup-answers.ts`](../../src/server/student-signup-answers.ts)) | Allowed after intake closes; preserves assigned choices (`StudentRequestExecutionAssignment`), original email/consent, and canonical identity; sets `editedAt` (displaying **Edited**) only when answers actually differ from the prior snapshot |
| Admin/Head edit assigned choices | `headEditSignup` / `headUnassign` require Admin/Head + consequence ticket; releases exact execution authority while keeping historical sessions/attendance |
| Recall unmatched request | Permanently closes request; reapplying gets a new priority |
| Approve withdrawal ([`student-quarter-withdrawal.ts`](../../src/server/student-quarter-withdrawal.ts)) | Atomically ends all owned current-period requests/enrollments, releases assignments/future sessions, and blocks re-signup for the period |
| Expire unverified assignment | Permanently disqualifies request after fixed 7-day `verificationDueAt` and releases assignments |

**Interrupted withdrawal & declined retry:** `applyAbort` uses a deterministic domain-separated review ID as an exact receipt, read via unbatched POST `studentWorkflow.abortReceipt` under the ticket lock. `SURVEY_ABORT` tickets store versioned `SURVEY_ABORT_V1` proof so **Check submission** / **Start fresh review** cleanly resolves interrupted attempts. Observing an exact **declined** review on an `OPEN` source clears the retained receipt and permits a fresh ticketed withdrawal attempt.

**Historical records & deadlines:** `StudentProfileOwnership` tracks explicit ownership across intakes (`revision` incremented on transfers/combines). Historical invitation replacement separates durable `TuteeHistoryInvitationAttempt` admission (before SMTP) from locked publication (see [identity lifecycle](identity-lifecycle.md#frozen-historical-invitations-and-claim-receipts) and [historical transition guide](../guides/historical-participant-transition.md#technical-map)). The Node deadline worker checks at startup and every minute; DB locks serialize transitions and downtime never extends deadlines.

### Prior-quarter continuation

[`student-continuation.ts`](../../src/server/student-continuation.ts), [`continuation-opening.ts`](../../src/server/program/continuation-opening.ts), and [`student-continuation-assignment.ts`](../../src/server/student-continuation-assignment.ts) power [`legacy-continuation.tsx`](../../src/app/student/legacy-continuation.tsx):

- Eligible only after an actual same-year `Q1 → Q2` or `Q3 → Q4` refresh in quarter mode (`Term.continuationSourceTermId`), for explicitly owned prior-quarter pairings during the **1-hour window** after `signupFirstOpenedAt` (settled under `program:period`).
- Preserves the 2-distinct-subject cap; first join creates `StudentSurvey`, later joins append signed `StudentSignupRevision`; `StudentContinuationReceipt` deduplicates retries; `StudentContinuationPairing` prevents duplicate physical teaching blocks.
- Ordinary public mailbox confirmation sets immutable `StudentSurvey.publicSignupEmailConfirmedAt`, suppressing further continuation joins. The UI automatically hides the continuation interface and closes unsubmitted reviews at the server-anchored 1-hour expiry, retaining only active receipts/recovery.
- Later tutor availability invalidation releases the affected continuation assignment while keeping the signup request open and notifying staff/participants (already-approved withdrawals remain withdrawn).

### Membership changes

Tutor and Crew membership requests lock the member and recheck current state before committing membership, notification, and audit together. Opt-out approval requires 7 days; reentry has no wait; opting out never auto-requeues students. Self-service Tutor/Crew opt-out and pending-tutor direct opt-out use a 3-second local `useReviewDelay` pause (monotonic clock, Cancel immediate, never auto-submits). Non-survey tutor-relayed tutee removals ([`discipline/removal.ts`](../../src/server/discipline/removal.ts)) remain separate from account-wide survey withdrawals.

### Assigned-block workload and advisory preference

[`tutor-workload.ts`](../../src/server/tutor-workload.ts) (pure helpers in [`lib/tutor-workload.ts`](../../src/lib/tutor-workload.ts), cache helper [`workload-cache.ts`](../../src/lib/workload-cache.ts)) computes current-quarter estimated block load in one Repeatable Read snapshot:

- Counts only pairings with ≥1 non-`INACTIVE` tutee (including `PENDING`) on active non-revoked tutors. Each valid explicit `PairingGroup` counts as **1** block (even while `Awaiting schedule`); independent pairings count separately even at matching times; repair groups do not collapse.
- `admin.assignmentWorkloads` renders `(count/preference)`, `(count)`, or `(?)` in selectors and shares `WorkloadAssignmentConfirmation` ([`assignment-workload.tsx`](../../src/app/_components/assignment-workload.tsx)) with qualification review (advisory only—never a hard cap).
- `workloadPreference` / `setWorkloadPreference` accepts `null` or `0–4` (new tutors default `1`; DB trigger resets inactive tutors to `0` and bumps independent preference version; preserves `Tutor.updatedAt` and `User.profileVersion`). Edited via [`WorkloadPreferenceChoices`](../../src/app/_components/workload-preference-choices.tsx) inside the **Preferences** tab's availability modal independently of weekday slot drafts.

### Assignment qualification confirmations

[`assignment-qualification.ts`](../../src/server/assignment-qualification.ts) verifies stored `QualificationGrant` rows under the catalogue lock. Unqualified assignments require a one-use `ASSIGNMENT_OVERRIDE` confirmation ticket (2-second delay, 5-minute expiry, hashing operation + complete parsed payload) independently confirmed by proposer and reviewer. Assignment never restores `tutorAccessRevoked`.

## Scheduling, hours and discipline

### Automatic room allocation contract

[`room-allocation.ts`](../../src/server/room-allocation.ts) allocates per reservation unit (an explicit `PairingGroup` via its primary assignment, or an independent `Pairing`) under the planned-room transaction lock:

- **Fixed vs. automatic:** staff-fixed rooms are never displaced; intentional `NONE` stays sticky; an eligible existing automatic room is retained. New automatic choices rank by familiar participants count → tutor familiarity → fewer planned weekly occupied minutes → stable room ID (continuity outranks balancing).
- **Shortages & bulk assignment:** saving a confirmed schedule with no available room sets `roomNeedsAssignment` (**Needs room**, amber `x` badge via `PairingRoomSummary`, notifying Admin/Head once per material shortage). Bulk **Auto assign all unassigned sessions** reviews up to 500 scheduled `AUTO`/`LEGACY` roomless pairings per reservation unit in one transaction.
- **Creation receipts & locks:** [`pairing-creation.ts`](../../src/server/pairing-creation.ts) binds creation drafts to requester-scoped semantic UUID receipts so lost-response retries return the saved pairing without duplicate allocation. Room deletion acquires planned-room + Room row locks so PostgreSQL key-share locks serialize with concurrent attendance writes.
- **Feature default:** **Auto-assign rooms** defaults ON; staged toggles take effect at next refresh without reassigning existing bookings.

### Unified tutor workspace and personal schedule

- **Unified tabbed workspace ([`tutor-workspace.tsx`](<../../src/app/(tutor)/_components/tutor-workspace.tsx>)):** `/dashboard` and `/schedule` (`schedule/page.tsx` re-exports `dashboard/page.tsx`) render one tabbed `TutorWorkspace` opening on **Schedule** with local tabs **Schedule**, **Pairings**, **Preferences**, and **History & hours** (preserving drafts across tab switches), plus a conditional **Interview chair** tab (`#chair-interviews`, legacy `/dashboard#tutor-interviews`) for active Admin/Head chairs or tutors retaining a legacy `isHead` assignment. **Room Schedule** (`tutor-room-schedule.tsx`) sits inside a collapsed disclosure in **Schedule** alongside **Needs attention**, while chair **Interviews to Conduct** (`my-interviews.tsx` with `audience="chair"`) lives in **Interview chair**—handling scheduling, panel-vote review with manual **Refresh**, and final decisions without duplicating `VoteForm`, and linking back to **Schedule** to vote. **Preferences** renders entrance cards (**Edit availability ↗**, **Edit willingness ↗**, **Request qualification ↗**) opening `ProfileDialog` modals that retain drafts across close/reopen.
- **Personal schedule ([`tutor-schedule.tsx`](<../../src/app/(tutor)/_components/tutor-schedule.tsx>), [`personal-schedule.ts`](../../src/server/api/routers/personal-schedule.ts), [`agenda-event-card.tsx`](../../src/app/_components/agenda-event-card.tsx)):** interleaves dated tutoring, assigned interviews, and personal meetings across the current and next Monday–Sunday weeks (independent 30 s polling; failed/denied source never erases siblings). Left rail colors: yellow (action needed), green (completed or `EXCUSED_ABSENT`), gray (upcoming/waiting/`Vote recorded`). `ScheduleInterviewDetails` opens member voting lazily for every assigned panelist including the chair (`chairActions={false}`, with a close-and-switch link to `#chair-interviews`), `action: "vote"` routes to Schedule voting even for chairs, and accepted votes refresh `tutor.myInterviews` and all `personalSchedule.interviews` variants via `invalidateAndReport` + `settleRefreshes`.
- **Meeting excuse cutoff:** authoritative 45-minute pre-start cutoff; meeting reads return `serverNow` so a server-anchored monotonic clock automatically hides excuse/cancel controls (and drops expired meetings from actionable previews) once the 45-minute boundary passes.
- **Dated session planning:** full agreement, room occupancy, tutoring pause exception, and private iCalendar contracts live in [session planning](session-planning.md) and [session planning delivery](session-planning-delivery.md).

### School calendar dates and timetable mapping

[`SchoolCalendarDay`](../../prisma/schema.prisma) stores actual program-local `YYYY-MM-DD` overrides (`isSchoolDay`, optional ISO `timetableWeekday` `1–7`, note, `active`, editor `version`, semantic `scheduleRevision`). [`lib/school-calendar.ts`](../../src/lib/school-calendar.ts) defaults Mon–Fri open and Sat–Sun closed; `groupSchoolCalendarHolidays` coalesces contiguous closed dates sharing a note (≤366 days).

- [`server/program/school-calendar.ts`](../../src/server/program/school-calendar.ts) provides `set`/`reset` plus range mutations `student.setCalendarHoliday`, `updateCalendarHoliday`, and `resetCalendarHoliday` (Admin/Head apply; Coordinators propose with captured version maps), reconciling dated session planning once per transaction. Note-only edits bump editor `version` only; schedule changes bump `scheduleRevision` and enqueue idempotent [`school-calendar-notifications.ts`](../../src/server/school-calendar-notifications.ts) (change notices + advance reminders 18:00 prior day to 12:00 actual day; optional email channel, no staff notes).
- In **Program Settings**, grouped `SchoolCalendarDay` holidays appear alongside `ProgramCalendarDay` tutoring pauses/notices under **Holidays & Tutoring Pauses** (with **Review impact**), while **Weekday Overrides** manages open/make-up timetable mappings; appeal-day counting uses `SchoolCalendarDay.isSchoolDay` only.
- [`school-calendar-session-audience.ts`](../../src/server/school-calendar-session-audience.ts) includes actual scheduled cohorts (including moved/extra sessions) in affected audiences.

### Scheduling, hours, pairing groups, patrol, and timezone contracts

- **Mutual availability & tutor occupancy:** [`mutual-availability.ts`](../../src/lib/mutual-availability.ts) and [`planned-scheduling.ts`](../../src/lib/planned-scheduling.ts) rank catalog slots into **Both Available**, **Other Time Slots**, and disabled **Unavailable** (overlapping independent tutor blocks take precedence; adjacency allowed). [`tutor-scheduling.ts`](../../src/server/tutor-scheduling.ts) enforces occupancy under the planned-room fence before room-mode returns; [`room-blocks.ts`](../../src/lib/room-blocks.ts) / [`room-block-proposals.ts`](../../src/server/room-block-proposals.ts) serialize recurring blackouts; attendance, crew patrol, and program room reordering treat room IDs as opaque nonempty strings via [`roomReference`](../../src/lib/room-reference.ts) ([`room-references.ts`](../../src/server/room-references.ts) verifies physical rooms under key-share locks; [`room-order.ts`](../../src/server/room-order.ts) verifies exact catalog membership under `lockProgramRooms` for direct writes and Coordinator proposals).
- **Reusable pairing groups & dynamic combine selection:** [`pairing-groups.ts`](../../src/server/pairing-groups.ts) manages 2–6 member tutor groups under period + tutor + planned-room locks with SHA-256 draft fingerprints and complete student×subject coverage ([`pairing-group-eligibility.ts`](../../src/lib/pairing-group-eligibility.ts)). Supports `Awaiting schedule` (`slotId: null`), `retainSchedule`, and dynamic `needsRepair` flagging on lifecycle removals. In [`tutor-pairings.tsx`](<../../src/app/(tutor)/_components/tutor-pairings.tsx>), [`pairing-group-selection.ts`](../../src/lib/pairing-group-selection.ts) (`MAX_COMBINED_ASSIGNMENTS = 6`, `combineSelectionOptions`, `resolveCombineAddition`, `resolveCombineRemoval`) drives **Combine groups**: incompatible cards dim/disable automatically, adding a card auto-selects minimal companion groups along a shared student/subject axis with a notice, and unticking prunes dependent companions. [`pairing-group-editor.tsx`](<../../src/app/(tutor)/_components/pairing-group-editor.tsx>) commits combine/split and invalidates workloads; [`pairingEntries`](../../src/lib/pairing-groups.ts) keeps grouped rows adjacent in Management Pairings.
- **Hours, meetings, and school reports:** [`service-hours.ts`](../../src/lib/service-hours.ts) owns session rounding; [`interview-hours.ts`](../../src/server/interview-hours.ts) records canonical `interviewService.record` receipts with monotonic `sourceRevision`, validates original evidenced physical-panel candidates (`completionEvidence`), enforces `reviewInterviewCompletion` version checks (keeping exact full-ledger matches no-ops), and checks imported provenance before row-shape collision checks in `clearInterviewHours`; [`interview-adjustment-source.ts`](../../src/server/interview-adjustment-source.ts) proves live interview credit ownership independently of mutable owner/type/reason fields, blocking generic `admin.deleteAdjustment` (direct and Coordinator proposal admission/replay) while projecting observer-safe coarse `INDEPENDENT`/`INTERVIEW` metadata in `admin.adjustments` and bounded `#interview-completion-<id>` arrival links to `InterviewManagement`; [`meeting-hours.ts`](../../src/server/meeting-hours.ts) enforces the 3-absence semester allowance (skipping `ImportedRecordProvenance` meetings/amendments); [`meeting-periods.ts`](../../src/server/meeting-periods.ts) groups meetings by recorded term (retaining mounted drafts across live mode changes until explicit **Reload groups**); [`service-hours-summary.ts`](../../src/server/service-hours-summary.ts) & [`school-hours-format.ts`](../../src/lib/school-hours-format.ts) preserve exact fractional hours. Individual school month reporting lives in [school reporting contract](school-hours.md).
- **Discipline & catalog propagation:** [`discipline.ts`](../../src/lib/discipline.ts) + [`discipline/removal.ts`](../../src/server/discipline/removal.ts) enforce 3 yellow = 1 effective red, 2 effective reds → auto-inactivation, and 5-school-day appeals. [`attendance-schedule.ts`](../../src/server/attendance-schedule.ts) propagates catalog clock edits to native attendance blocks under an exclusive advisory barrier (freezing imported attendance blocks and preserving imported patrol observations/flags under [`crew/flags.ts`](../../src/server/crew/flags.ts)).
- **Patrol credit ([`patrol-credit.ts`](../../src/server/crew/patrol-credit.ts)):** rolling 20-minute server cooldown across combined identities + immutable UTC `:00`/`:20`/`:40` `PatrolCreditWindow` claims (0.5 h only when all observations are within 20 min + 1 min clock allowance; older/cooldown sweeps save as 0 h evidence).
- **Timezone & UTC storage:** `TIMESTAMP(3)` columns store UTC enforced via `timezone=UTC` in [`database-url.ts`](../../src/server/database-url.ts) (allowing absent `DATABASE_URL` during `SKIP_ENV_VALIDATION=1` Docker builds). Changing program timezone updates the singleton setting without rewriting historical timestamps; [`program-time-zone-label.ts`](../../src/lib/program-time-zone-label.ts) formats localized display labels for explicit instants. See [program time zone](../guides/program-configuration.md#program-time-zone).

## Communication

- **Notifications & bell:** [`notification-details.ts`](../../src/lib/notification-details.ts) renders captured bilingual details ahead of generic event copy; email copies only allowlisted factual snapshots (never private message bodies, review reasons, or secrets). Full emitter/audience/copy contract: [notification event inventory](notification-events.md).
- **Private messaging & supervision:** [`messaging-permissions.ts`](../../src/server/messaging-permissions.ts) evaluates role contact unions and user overrides consistently across search, send, and reply; sends commit separate deliveries, retry receipts, and notifications atomically under a sender lock. Supervision requires recorded disclosure (older participant-only messages stay excluded). [`message-inbox.tsx`](../../src/app/_components/message-inbox.tsx) and [`student-support.tsx`](../../src/app/_components/student-support.tsx) latch authoritative denials until fresh authorized reads succeed.
- **Announcements:** freeze tutor recipient IDs at publication/approval; tutor workspace displays pinned-first (`📌`, non-dismissible) then unacknowledged ordinary posts.

### Account emails and delivery

- **11 categories & locks ([`notification-categories.ts`](../../src/lib/notification-categories.ts)):** `messages`, `reviews`, `applications`, `tutoring`, `attendance`, `membership`, `account`, `announcements`, `management`, `program`, and email-only `reminders`. `ProgramSettings.notificationLocks` (Admin/Head-only `program.setNotificationLocks`) ORs administrator-required badge/email locks over preserved personal preferences (expected-lock snapshots reject stale saves).
- **Single-language email (`User.emailLocale`):** independent of website locale and optional switches (`en` default or `zh`, checked by DB constraint). Public signup sources persist `NEXT_LOCALE` to initialize new accounts without overwriting existing preferences; dispatch reads the exact verified recipient's preference.
- **Associated emails & 2FA settings ([`account-emails.ts`](../../src/server/auth/account-emails.ts), [`account-emails.tsx`](../../src/app/_components/account-emails.tsx), [`email-change.tsx`](../../src/app/_components/email-change.tsx), [`two-factor-settings.tsx`](../../src/app/_components/two-factor-settings.tsx)):** `AccountEmail` enforces global uniqueness for primary + up to 5 verified secondaries (pending requests live in `EmailVerificationCode` only), serialized under `secondary-email-binding-setting` and account locks. Primary email replacement stays exposed in a retained disclosure on both account routes even when secondary binding is disabled, calling `router.refresh()` after synchronized confirmation. `two-factor-settings.tsx` distinguishes unknown/failed preference or feature reads from `Disabled`, conceals cached settings on denial, fences same-turn toggles, and still permits password-confirmed Disable when program 2FA is off or mail delivery is unavailable.
- **Outbox & workers ([`notification-delivery.ts`](../../src/server/email/notification-delivery.ts), [`sender.ts`](../../src/server/email/sender.ts)):** DB triggers enqueue `EmailDelivery` atomically; `sender.ts` selects `SECURITY` vs. `PROGRAM` SMTP per purpose. Ordinary optional notices allow one transport admission (rejected/abandoned admitted rows become `UNCERTAIN`, never replayed); security and `request_service` mail bypass optional gates; reminder admission revalidates source, preference, and due window under nonblocking domain locks (250 ms budget → 30 s deferral). Audited direct sends use [`direct-delivery.ts`](../../src/server/email/direct-delivery.ts) post-commit receipts; HTML/plain-text copy uses [`direct-email-copy.ts`](../../src/server/email/direct-email-copy.ts).
- **Delivery diagnostics, resend, and unsubscribe:** `program.emailDeliveryStatus` ([`delivery-status.ts`](../../src/server/email/delivery-status.ts)) caches non-pooled SMTP checks for 60 s (15 s timeout) alongside retryable/failed/uncertain outbox counts. Admin/Head `program.resendStuckEmails` ([`resend-stuck.ts`](../../src/server/email/resend-stuck.ts)) requeues up to 100 eligible failed/retrying rows (`FOR UPDATE SKIP LOCKED`). Optional emails include a 90-day signed `/unsubscribe` link (GET read-only; POST stops the exact topic or all unlocked topics across primary + secondaries without affecting badges or admin-required locks).
- **Aliyun Email Quota ([`email-quota-card.tsx`](<../../src/app/(admin)/admin/email-quota-card.tsx>), [`aliyun-quota.ts`](../../src/server/email/aliyun-quota.ts)):** rendered for Admin/Head on **both** `/admin` Dashboard and **Program Settings → Deployment Configurations → Delivery settings**. Calls Hangzhou `DescAccountSummary` (`dm.aliyuncs.com`, 2 s connect / 3 s read timeout, 60 s shared cache, `DAILY_FREE_EMAIL_LIMIT = 200`, low thresholds `<= 40` daily / `<= 200` balance, `Asia/Shanghai` reset time) using independent read-only credentials. See [quota setup](../guides/deployment.md#show-the-direct-mail-quota-on-the-dashboard).

### Public-request invalidity notices and appeals

[`request-invalidity.ts`](../../src/server/request-invalidity.ts) atomically enqueues one unique `(requestKind, requestId, requestVersion)` essential `request_service` receipt (`EmailDelivery`, `PROGRAM` transport, bypassing optional switches and secondary expansion) on each applied flag, clear, or reflag. [`request-notice.ts`](../../src/server/email/request-notice.ts) and [`request-notice-copy.ts`](../../src/server/email/request-notice-copy.ts) send only to the request's submitted address and mask unverified recipients to request kind + submission time (disclosing the reason only with request-specific mailbox proof).

Transport admission acquires source + notice + outbox locks and commits `SENDING` with a unique attempt ID (budget: 5 attempts) before SMTP; clear/reflag marks unadmitted receipts `SUPERSEDED`. Admin/Head retries reset failed/retrying budgets without replaying the flag.

For initial tutor applications and legacy self-service tutees, [`request-appeal-token.ts`](../../src/server/email/request-appeal-token.ts) issues a 90-day HMAC token for `/request-appeal` (GET status only; POST origin-checked JSON, 1 immutable appeal per notice). [`request-appeal.ts`](../../src/server/email/request-appeal.ts) notifies active Admin/Head without clearing the flag; Admin/Head may decline with reason, while clearing uses the standard invalidity mutation.

### Integrated survey appeal authority and delivery

Modern survey flags create one shared `EmailDelivery` receipt paired with a version- and account-bound `StudentSignupNotice` appeal capability (valid until active-period rollover; retired generic survey tokens remain staff-readable history only). Admitting a modern appeal emits `request_invalidity_appeal_pending` to Admin/Head atomically; final rejection closes the survey and ends its priority.

Same-owner recovery rotates the appeal capability only in the same transaction that queues a delivery receipt (never while `SENDING`). Verified-alias removal/transfer revokes captured links under the username namespace lock; terminal signups supersede pending flag receipts before transport.

### Management registration codes

Registration Codes supports **Tutor**, **Crew**, **Admin**, and **Coordinator** invitations (Admin/Head issue all directly; Coordinators propose Tutor/Crew only; no Head code exists). Email-bound 5-character codes (manual issuance, accepted tutor applications, and accepted Crew applications) are emailed automatically best-effort after commit.

Auto-issued codes record the approving staff member as issuer, adopt the promoted tutor label, and display localized source badges (**Interview**, **Accepted application**, **Crew application**), bound email (masked for observers), and a **View application** link. Registration Codes and Interview Records check live attempt limits (10 failures), plaintext presence, and source-application validity/acceptance so blocked, invalidated, or deleted-application codes show **Unavailable** with the exact reason rather than active share controls (deleting an application expires its unused codes atomically). Redemption requires mailbox verification, preserves existing credentials/participation, upgrades to `max(existing, invited)` rank, and transitions out of exclusive Viewer.

## Policy documents and translations

- **Policies:** bundled [policy drafts](../guides/policies/README.md) are development sources; live sites read `PolicyDocument`. `PolicyConsent` opens read-only `CurrentPolicyDialog` (fresh fetch, no cached fallback on error). [`admin/policies/page.tsx`](<../../src/app/(admin)/admin/policies/page.tsx>) conceals editors on denial while keeping accepted-write recovery. [`student/layout.tsx`](../../src/app/student/layout.tsx) and [`personal-view.tsx`](../../src/app/student/personal-view.tsx) allow exact `?view=account` / `?view=messages` access during policy renewal without recording consent.
- **Translations (`/localization`):** drafts capture destination fingerprints checked under a shared lock at publication (covering UI strings, fixed landing text, news, sections, and page titles). Page-title review displays live title/locale/slug/ID and blocks publication for deleted pages. Coordinator edits create drafts; Admin/Head publication uses a single-operation `translationPublicationScope` without granting `canTranslate`.
- **Landing slugs & localization:** custom pages and page-mode sections share `/p/<slug>` via [`home/slugs.ts`](../../src/server/home/slugs.ts) (≤60 chars, namespace lock, unpublished slugs reserved). [`page-blocks.ts`](../../src/lib/page-blocks.ts) resolves per-field `lang` fallback (locale → English → first entry; explicit empty wins). [`landing-editor.tsx`](<../../src/app/(admin)/admin/landing/landing-editor.tsx>) normalizes slugs on blur and acknowledges canonical collision suffixes only for the submitted revision.

## Subject groups and qualification snapshots

`CourseGroup` orders offered groups; `Subject` is the stable variant (`baseName` + `SubjectLevel.prefix`). All catalogue writers use [`course-catalogue.ts`](../../src/server/course-catalogue.ts) under the catalogue lock (preserving archived variants, syncing pairing labels transactionally, ordering pickers by `courseChoices` / `sortCourseChoices`).

[`qualifications.ts`](../../src/server/qualifications.ts) (`approveQualification`) snapshots concrete `QualificationGrant` rows for the approved variant and lower offered levels at approval time. Eligibility reads filter `TutorQualification.status = APPROVED` and never recalculate from later level reordering. `TutorSubjectWillingness` is stored separately (absent = not recorded) and intersected with approved grants for `availableSubjectIds`.

## Signup field configuration

[`src/lib/signup-fields.ts`](../../src/lib/signup-fields.ts) defines fixed field order, immutable essentials (name, email, first subject, policy), and defaults stored in `ProgramSettings.signupFields` (`program.setSignupField`: Admin/Head apply, Coordinator propose, expected-state version lock). New submissions read live settings on the server and strip hidden answers; existing surveys decode without applying later settings.

The tutee form always refetches signup options on mount before enabling inputs. Enabled CAPTCHA stages an intent while rendering its panel outside disabled fieldsets so Verify/Cancel/Retry stay interactive. Tutor applications store immutable application-level policy evidence without fabricating user-level `PolicyAcceptance`.

## CSV archive internals

- **Historical academic overlays:** `HistoricalAcademicRecord` (linked to exactly one Tutor or Tutee) and append-only `HistoricalAcademicCorrection` are managed by [`historical-academics.ts`](../../src/server/historical-academics.ts) (signed previews via POST, serialized under username-namespace + account + participant + record locks; Admin/Head apply, Coordinator propose). Original baselines belong to the archive allowlist; correction overlays stay outside CSV import/export. See [historical transition guide](../guides/historical-participant-transition.md#correct-historical-academics).
- **Export / preview / import ([`record-transfer.ts`](../../src/server/record-transfer.ts), [`routers/record-transfer.ts`](../../src/server/api/routers/record-transfer.ts), [`lib/record-transfer.ts`](../../src/lib/record-transfer.ts)):** Admin/Head-only (never Coordinator-proposable; Repeatable Read export; Serializable preview/import with shared import lock and username-namespace fence for Tutor/HistoricalAcademicRecord). Limits: **5 MiB** and **5,000 rows**; formula-safe CSV encoding; ZIP path/size checks in `record-transfer-archive.ts`.
- **Admission & provenance boundaries:** only allowlisted tables/columns enter SQL via `jsonb_populate_record` (`User.csv` validates existing accounts without writing; private retry keys and survey tokens are excluded). New archive rows must represent inactive/completed historical state (`ImportedRecordProvenance` tags every newly inserted row atomically so school reports, meeting allowances, patrol flags, catalog propagation, and interview admission never treat imported archive rows as live operational work). Pretracking imports with exact candidate keys from original import files or retained evidence are reconciled through the reviewed host CLI ([recovery reference](recovery.md#archive-provenance-reconciliation-boundary), [recovery guide](../guides/recovery.md#reconcile-pretracking-archive-provenance)) with typed composite recovery references and durable `ArchiveProvenanceReceipt` records. Preview runs full validation/insertion and rolls back, issuing a 15-minute HMAC ticket bound to files and actor; exact existing-ID matches are skipped and conflicting rows abort.

## Data and deployment

See the [deployment runbook](../guides/deployment.md) for Docker images, bootstrap, SMTP, migrations, backups, and launch checks. The container image runs Prisma migrations before starting the standalone Next.js server; PostgreSQL data and uploaded media must persist across container replacements. Never use development seeding in production.

## Validation and development

[Verification guidance](../contributing/verification.md) defines required checks; [local development](../contributing/local-development.md#5-run-the-tests) covers commands and isolated test database setup. The [CI workflow](../../.github/workflows/docker-build.yml) runs the full build and verification pipeline. Regression tests live beside their owning modules (`*.test.ts`, `*.test.tsx`, `*.integration.test.ts`); integration fixtures reset the isolated `shbs_shipping_test` database.
