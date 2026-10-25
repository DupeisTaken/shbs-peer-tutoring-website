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
- Use “subjects” in interface copy and localize in [messages](../../messages). Catalog tests validate ICU syntax and argument parity; review translations before enabling hidden languages.
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
| Active tutor opt-out in Settings                                                                                                                                 | Named `useActionReview` captures the tutor and optional reason. Cancel/Escape writes nothing. A successful submission creates a pending membership request: the tutor stays ACTIVE until admin approval, available only after seven days. Keep the existing recall/reentry flows independent, freeze pending input and recover accepted submissions through reads only                                                                                                                                            |
| Student schedule conflict, policy acceptance, withdrawal and assignment                                                                                          | Existing domain dialog, server confirmation ticket, review delay, policy revision and immutable evidence remain authoritative                                                                                                                                                                                                                                                                                                                                                                              |
| Tutors/Tutees/Users membership, school departure, account combination and deletion                                                                               | Existing named domain confirmation/review; retain password checks, role restrictions, versions, proposals and before/after evidence                                                                                                                                                                                                                                                                                                                                                                        |
| Users & Roles account deletion                                                                                                                                   | The list-owned `AccountDeletion` composes the existing password `Modal` with a fresh server consequence/fingerprint review. Bind the label/form, preserve the captured target and rejected password draft, admit one pending write, and restore the opener after idle dismissal. A stale review needs explicit Reload; accepted deletion uses read-only recovery and removes its cached row. Keep Head eligibility and live password checks; no countdown or ordinary generic review replaces this step-up |
| Room, time-slot, pairing, tutee, hour-adjustment and subject-level deletion; invitation revocation                                                               | `useActionReview` composes the shared modal around the exact record and consequence. Features supply the original authorized mutation, optional proposal recognition and read-only refresh. Failed writes retain the review; accepted writes never run again when refresh fails. Cancel and Escape before submission perform no write                                                                                                                                                                      |
| Crew application/request decisions, activation/inactivation and account deletion; public announcement, news, image, section, page and saved-translation deletion | Name the affected person/content in `useActionReview`. The route or list owns review lifetime so card removal/tab changes cannot discard pending work or read recovery. Reversible crew status changes and re-creatable translations explicitly permit another review after a successful refresh; one accepted review never replays its mutation                                                                                                                                                           |
| Service Hours breakdown comparison, room timetables and attendance history                                                                                       | Read-only comparison matrices in named keyboard-scroll regions; no artificial action column. The compact Service Hours summary retains its real Details action                                                                                                                                                                                                                                                                                                                                             |

Manual Tutor, Tutee and Pairing entry points first mount a fresh `CreationRiskDialog`; Continue opens the retained feature editor and performs no write. Recheck live admission before transitioning, and return `false` from `onContinue` if the editor cannot open so Cancel remains usable. The gate does not replace assignment qualification/consent review. Pairing creation also keeps its existing draft UUID through edits and failed requests; follow the [creation receipt contract](../reference/technical-report.md#automatic-room-allocation-contract) before changing reset or retry behavior.

Keep pending requirements outside completed-history disclosures. Use retained
child lifetimes for collapsible editors so collapsing is not an implicit Cancel.
Size a disclosure's interactive target independently of its arrow artwork. Reuse
the compact control contract, expose its expanded state, and measure the actual
target and painted glyph on the affected page. A larger parent or darker parent
text does not fix a small button or an icon with its own color override.
Test applied versus queued outcomes, cancellation without writes, failed drafts,
permission changes and keyboard focus in addition to visual layout.

Do not put cache invalidation inside `useActionReview`'s `commit` callback. A
mutation rejection and a successful mutation followed by a failed read must stay
distinguishable. Use `invalidateAndReport` and, for multiple query families,
`settleRefreshes` in its `refresh` callback. An accepted record stays disabled for
the page instance, including when stale cached data still displays it. Closing a
failed-refresh review leaves an inline read-only retry; another deletion cannot
replace that recovery until it succeeds. This shared composition does not replace
timed confirmation tickets, password confirmation, profile versions or assignment
review. The gallery demonstrates rejected write, accepted write and read recovery.

### Add an action or feature

Start here for a new entry point, then use the inventory above and the
[extension boundaries](../reference/technical-report.md#ui-extension-boundaries). Reuse a
current caller with the same consequence and lifetime; an old issue's unchecked
list is not proof that its implementation is still missing. Inspect the current components and domain tests before extending them.

1. **Define the operation in the feature.** Record the actor, affected record,
   intent, direct/request-only/read-only audiences, version or ticket requirements,
   save boundary, and queries that become stale. Describe the user-visible result
   for applied, queued, rejected and accepted-but-refresh-failed outcomes. Classify
   management writes in the existing approval policy; UI visibility is not authorization.
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
4. **Adapt the existing contract.** Supply translated record/consequence text,
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

Use a stable key for the operation and record; include the operation kind when one
controller handles multiple actions on the same record. The default prevents an
accepted action from being replayed while stale rows remain. Set `repeatAfterRefresh`
only when the domain permits a new deliberate action after successful refresh,
as with reversible crew status changes. Use `renderError` only for the feature's
known server error vocabulary. The owner must keep `{review.dialog}` mounted,
including its inline recovery after Close. For several refresh families, follow
`settleRefreshes` so one rejection cannot release controls before sibling reads settle.

For a successful request whose eventual effect still needs review, supply the
feature-owned `successMessage` receipt rather than reporting that the change was
applied. Tutor Settings demonstrates this distinction with `renderResult` for the
membership review date. Approval IDs still use the queued-proposal result, and a
failed post-write refresh still uses read-only recovery; the custom receipt changes
neither admission nor domain authority.

The minimum behavior cases follow the operation, not the button's appearance:
Cancel/Escape before commit writes nothing; same-turn double activation admits one
write; rejected writes preserve drafts; queued proposals say queued; accepted writes
with failed synchronization offer reads only, including after Close; successful
recovery permits only the domain's intended next action. Also check conflict Reload,
removal of the original row, permission changes, nested-dialog focus and pending
dismissal where applicable. Pair focused component/domain tests with EN/ZH and
desktop/mobile screenshots; do not count a mocked response as a database write.

## Chinese peer-tutoring wording

Use **辅导伙伴** for Tutor and **学习伙伴** for Tutee in role labels, participant workflows, notifications and policy drafts. Both are fellow students; these names describe their roles in a particular tutoring relationship, not a teacher/student hierarchy. Use **辅导** for tutoring and **参与中** for active participation, rather than 授课 or 在职. Keep genuine school references such as 学生家长、数学教师 and the calendar's 上课日. Keep message keys, ICU arguments/plural branches, role enums and permission rules unchanged when editing display text.

The homepage introduction and role cards use `messages/en.json` and `messages/zh.json` defaults. Environment message overrides take precedence over bundled messages, and published database message overrides take precedence over both. A locale-specific `HomeContent` override wins over the resolved homepage message; clearing that override restores the resolved default. Review existing overrides through localization and landing editors to adopt new wording. Repository edits do not overwrite them.

The bilingual `/p/about` example in `prisma/seed.ts` is development seed content. Existing custom pages retain their stored blocks; missing block translations fall back to English. Update a published page through the landing editor after review, never by running the demo seed on real data. Policies likewise use published database documents with English fallback, not live reads of sample files. Preserve accepted text/version snapshots and follow [policy publication](../guides/policies/README.md) to publish a reviewed revision.
