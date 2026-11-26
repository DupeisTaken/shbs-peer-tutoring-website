# Implementation guidance

Keep feature logic with its owner and document the core implementation ideas in
code comments. [Technical reference](../reference/technical-report.md#architecture) maps the
current code; this guide explains how to extend it safely.

## Implementation conventions

- Validate permissions and invariants on the server. Role, tutor linkage, crew membership and translation assignment are distinct; a matching name or email never establishes student ownership.
- Classify management writes in [approval-policy.ts](../../src/lib/approval-policy.ts). `classifyApproval` defines direct, requester and reviewer authority, including payload-dependent reversals. Coordinator daily operations and Admin significant settings/profile edits have different review routes; see the [responsibility matrix](../guides/program-configuration.md#management-responsibilities-and-review). Reuse the enclosing approval transaction and keep external delivery after commit.
- Preserve original survey priority, fixed deadlines, terminal request state, explicit historical ownership and exact policy acceptance snapshots. Use shared domain helpers and confirmation tickets.
- Use [service-hours.ts](../../src/lib/service-hours.ts) for session calculations. Interviews use actual duration; meeting penalties use the semester allowance. Do not substitute generic rounding.
- Prisma CLI configuration lives in [prisma.config.ts](../../prisma.config.ts). Schema changes need migrations; `db push` is for disposable experimentation and does not replace committed SQL constraints.
- Keep display names synchronized through the shared account-profile helper and account settings through the shared component. Do not import another route's page as a reusable component.
- Public sign-in, registration, recovery and tutoring-request pages use [PublicFormPage](../../src/app/_components/public-form-page.tsx). Keep short forms in `PublicFormCard`; the longer tutoring request uses the wide frame and retains its own sections. Use `PublicFormRoute` for centered secondary links with descriptions on separate lines. The scoped `.public-form` styles follow the active accent theme without changing workspace controls. Keep long field examples in associated hints so they can wrap on mobile.
- Use “subjects” in interface copy and localize in [messages](../../messages) following [UI copy conventions](design.md#writing-ui-copy). Catalog tests validate ICU syntax, argument parity and EN/ZH register/glossary consistency; review translations before enabling hidden languages.
- Keep bundled policy drafts separate from published database documents. Follow [policy publication](../guides/policies/README.md) when wording changes.
- Before changing Next.js behavior, read the relevant bundled guide under `node_modules/next/dist/docs/`. Use the existing Turbopack build command and local resource settings rather than global runtime changes.

### Consequential action inventory

Choose interaction by consequence, retaining the domain's stronger requirements.
Canceling a draft or confirmation must not invoke a write. A failed write retains
the editable draft and actionable error; freeze that draft during a pending write.
An approval ID means a queued proposal, never a successful application.

| Surface / action                                                                                                                                                 | Interaction and preserved safeguards                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject willingness, announcement acknowledgement, meeting-excuse recall                                                                                         | Immediate action with pending protection and visible result/error                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Availability, qualification evidence, meeting excuse, interview time/comment, roster profile or creation                                                         | Local draft with explicit Save/Submit and Cancel; retain failed drafts and independent editor snapshots                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pending tutor activation choice, pairing schedule, legacy removal request/recall, interview final decision                                                      | Named consequence confirmation; preserve current version, panel vote, role and server permission checks. The pending tutor's available/opt-out choice applies directly; it is separate from an active tutor's membership request                                                                                                                                                                                                                                                                             |
| Agreed extra-session cancellation | The retained dated-session editor captures one/all current participants and reviews the exact lesson before proposing cancellation. Submission is a request receipt; the lesson stays scheduled until agreement. Reuse delivery clocks, version/ownership checks and accepted-write read recovery; Cancel before submission writes nothing |
| Active tutor opt-out in Account Settings                                                                                                                                 | Named `useActionReview` captures the tutor and optional reason. Cancel/Escape writes nothing. A successful submission creates a pending membership request: the tutor stays ACTIVE until admin approval, available only after seven days. Keep the existing recall/reentry flows independent, freeze pending input and recover accepted submissions through reads only                                                                                                                                            |
| Student schedule conflict, policy acceptance, withdrawal and assignment                                                                                          | Existing domain dialog, server confirmation ticket, review delay, policy revision and immutable evidence remain authoritative                                                                                                                                                                                                                                                                                                                                                                              |
| Tutors/Tutees/Users membership, school departure, account combination and deletion                                                                               | Existing named domain confirmation/review; retain password checks, role restrictions, versions, proposals and before/after evidence                                                                                                                                                                                                                                                                                                                                                                        |
| Users & Roles account deletion                                                                                                                                   | The list-owned `AccountDeletion` composes the existing password `Modal` with a fresh server consequence/fingerprint review. Bind the label/form, preserve the captured target and rejected password draft, admit one pending write, and restore the opener after idle dismissal. A stale review needs explicit Reload; accepted deletion uses read-only recovery and removes its cached row. Keep Admin/Head eligibility and live password checks; no countdown or ordinary generic review replaces this step-up |
| Room, time-slot, pairing, tutee, hour-adjustment and subject-level deletion; invitation revocation                                                               | `useActionReview` composes the shared modal around the exact record and consequence. Features supply the original authorized mutation, optional proposal recognition and read-only refresh. Failed writes retain the review; accepted writes never run again when refresh fails. Cancel and Escape before submission perform no write                                                                                                                                                                      |
| Crew application/request decisions, activation/inactivation and account deletion; public announcement, news, image, section, page and saved-translation deletion | Name the affected person/content in `useActionReview`. The route or list owns review lifetime so card removal/tab changes cannot discard pending work or read recovery. Reversible crew status changes and re-creatable translations explicitly permit another review after a successful refresh; one accepted review never replays its mutation                                                                                                                                                           |
| Initial application name corrections | Composes `ConfiguredPersonNameFields` with existing dialog/recovery rules for four name fields and a reason (Admin/Head apply; Coordinator proposes). Request-local only — never reuse the account-profile writer or alter invalidity, interview completion or promotion |
| Service Hours breakdown comparison, room timetables and attendance history | Read-only comparison matrices in named keyboard-scroll regions; no artificial action column. The compact Service Hours summary retains its real Details action |

Manual Tutor, Tutee and Pairing entry points first mount a fresh `CreationRiskDialog`; Continue opens the retained feature editor without writing. Recheck live admission before transitioning and return `false` from `onContinue` if the editor cannot open so Cancel stays usable. Pairing creation keeps its draft UUID across edits and failed requests; see the [creation receipt contract](../reference/technical-report.md#automatic-room-allocation-contract).

Keep pending requirements outside completed-history disclosures, use `retained` child lifetimes for collapsible editors so collapsing never acts as Cancel, and size disclosure buttons independently of their arrow icons (checking painted glyph contrast).

### Add an action or feature

Start here for a new entry point, using the inventory above and
[extension boundaries](../reference/technical-report.md#ui-extension-boundaries).
Reuse an existing caller with the same consequence and lifetime, and inspect current
components and domain tests before extending them.

1. **Define the operation in the feature.** Record the actor, affected record,
   intent, direct/request-only/read-only audiences, version or ticket requirements,
   save boundary, and queries that become stale. Describe the user-visible result
   for applied, queued, rejected and accepted-but-refresh-failed outcomes. Classify
   management writes in the existing approval policy; UI visibility is not authorization.
   Register new management operations in the [semantic summary inventory](../../src/lib/approval-summary.ts),
   add authored review titles to every [message catalog](../../messages), and keep
   expected snapshots in the [technical review fields](../../src/lib/approval-review.ts)
   so they do not appear as business changes.
2. **Choose the interaction by effect.** A destination is a link; a local panel is
   `SectionTabs`; a filter is `ChoiceButton` in `FilterToolbar`. A reversible
   immediate setting uses `SettingRow` with feature-owned pending/error state.
   Related draft fields use `FormSection`/`FormActions`. A named consequential
   action can use `useActionReview`; ticketed, password, assignment and profile
   workflows keep their stronger existing domain reviews.
3. **Keep the owner alive.** Put a review controller above removable rows and
   replaceable panels, render its `dialog` once, and pass it to entries. Keep each
   independent draft and captured version with its feature. Choose disclosure/tab
   lifetime deliberately; authorization revocation must still unmount private
   children. Mount private reads and mutation observers only for authorized users.
4. **Adapt the existing contract.** Supply concise, outcome-focused record/consequence text per [Writing UI copy](design.md#writing-ui-copy),
   the exact authorized mutation, read-only refresh and the feature's proposal/error
   adapters. Keep mutation acceptance separate from synchronization. Prefer a
   feature-owned adapter over new global runtime machinery; extract shared behavior
   when real callers share its contract. Keep feature permissions out of buttons.
5. **Verify the integration, then document it.** Start with the acceptance cases
   below and the real page in the [UI verification matrix](verification.md#ui-verification-matrix).
   Update this inventory when introducing another action family. Add a gallery
   example and behavior tests only when introducing or extending a reusable contract;
   a feature-only composition still needs its own behavior and permission tests.

For a named deletion, this adapter follows the existing
[Announcements integration](<../../src/app/(admin)/admin/announcements/page.tsx>).
Here `review` is created once by the authorized list owner; `a`, `del`, `utils`
and the root `useTranslations()` function `t` belong to the feature. Its entry is
hidden from read-only users and uses
`review.blocked(a.id)` for its disabled state. `ReviewedAction` is an existing
export, not a new application-wide action schema.

```tsx
import type { ReviewedAction } from "~/app/_components/ui/action-review";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

const action = {
  key: a.id,
  title: t("admin.announcements.card.confirmDelete"),
  description: t("actionReview.announcementHelp"),
  confirmLabel: t("common.delete"),
  details: <p>{a.title}</p>,
  // Commit owns only the write. Refresh failure must not make it retryable.
  commit: () => del.mutateAsync({ id: a.id }),
  refresh: () => invalidateAndReport(utils.admin.announcements),
  approvalId: queuedApprovalId,
} satisfies ReviewedAction;

review.open(action); // Only from the authorized entry's deliberate activation.
```

Keep cache invalidation out of `commit` — put `invalidateAndReport` (wrapped in
`settleRefreshes` for multiple query families) inside `refresh` so rejected writes
stay distinct from accepted writes whose refresh fails. Use a stable key (include
operation kind when one controller handles multiple actions on the same record); an
accepted key stays disabled for the page instance, and closing a failed-refresh
review leaves an inline read-only retry. Set `repeatAfterRefresh` only when the
domain permits another deliberate action after refresh (e.g., reversible crew
status). Use `renderError` only for known server error codes, keep `{review.dialog}`
mounted in the owner, and supply `successMessage` / `renderResult` when a write
queues a separate review (such as tutor opt-out) rather than applying immediately.
`useActionReview` does not replace timed tickets, password step-up, profile versions
or assignment reviews.

Verify Cancel/Escape without writes, same-turn deduplication, rejected draft
retention, queued vs. applied receipts, failed-refresh read-only recovery and role
changes per the [UI verification matrix](verification.md#ui-verification-matrix).

## English peer-tutoring wording

Use **tutor** and **tutee** for the two participant roles in English interface copy,
notifications and documentation (and English fallback text in other catalogs).
Display wording never renames message keys, identifiers or role enums, and repo
edits do not rewrite stored content or acceptance evidence.

## Chinese peer-tutoring wording

Use **辅导伙伴** (Tutor), **学习伙伴** (Tutee), **辅导** (tutoring) and **参与中**
(active participation) — not 授课 or 在职 — while keeping genuine school terms
(学生家长, 数学教师, 上课日). Follow the shared EN/ZH glossary and register in
[Writing UI copy](design.md#writing-ui-copy) and keep message keys, ICU arguments
and permission rules unchanged.

The homepage introduction and role cards use `messages/en.json` and `messages/zh.json` defaults. Environment message overrides take precedence over bundled messages, and published database message overrides take precedence over both. A locale-specific `HomeContent` override wins over the resolved homepage message; clearing that override restores the resolved default. Review existing overrides through localization and landing editors to adopt new wording. Repository edits do not overwrite them.

The dedicated `/about` page (`src/app/about/page.tsx` and `src/lib/about-content.ts`) is repository-owned and renders without seeding; legacy `/p/about` links redirect to `/about`. Staff can optionally toggle an editor-authored custom alternative in **Landing Page → Pages** (`home.setAboutMode`, backed by `CustomPage` slug `"about"` and reserved `HomeContent` key `about.useCustom`), while disabling or hiding it safely restores the built-in page. The bilingual `about` example in `prisma/seed.ts` remains development seed content. Existing custom pages retain their stored blocks; missing block translations fall back to English. Update published custom pages through the landing editor after review, never by running the demo seed on real data. Policies likewise use published database documents with English fallback, not live reads of sample files. Preserve accepted text/version snapshots and follow [policy publication](../guides/policies/README.md) to publish a reviewed revision.
