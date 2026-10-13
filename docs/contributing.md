# Contributor guidance

Start with [local setup](local-development.md), then use the [technical guide's code map](technical-report.md#architecture) to find the implementation you need. Keep changes focused on current behavior and document the core ideas in code comments.

For a new UI entry point, follow [Add an action or feature](#add-an-action-or-feature)
for the default implementation recipe and an existing typed review adapter.

## Required checks

Run commands from the repository root:

| Change | Verify with |
| --- | --- |
| Any commit | `npm run check` and relevant tests |
| Documentation | `npm run docs:check` |
| Application behavior | Focused tests, then the relevant integration suite with `npm test -- --maxWorkers=1` |
| Routes, environment or Prisma | `npm run build` in addition to relevant tests |
| Schema | A committed migration, `npm run db:migrate`, and schema agreement against an isolated database |
| Demo seed | Run it twice on a disposable database, then `npx tsx --conditions=react-server prisma/verify-demo.ts` |
| User interface | Desktop/mobile screenshots and checks of interaction, loading, errors and permissions |

Integration tests reset fixtures. Use the isolated loopback `shbs_shipping_test` database for the combined suite and follow [test setup](local-development.md#5-run-the-tests). Never seed or run destructive tests against real program data. Run one bounded server/browser at a time and stop processes you started; do not kill unrelated Node processes.

The [CI workflow](../.github/workflows/docker-build.yml) also checks dependency installation, migrations, schema agreement, dependency audit, production build and image boot/restart. Use its result for the commit being reviewed; old test totals are not current verification.

CI runs static/tooling checks, two test shards, and image build/smoke verification
in parallel. Each shard owns a PostgreSQL service named `shbs_shipping_test` and
keeps test files serial; do not enable parallel database fixtures against one
database. The required `verify` check succeeds only when every job succeeds,
including both shards. Failed, cancelled, skipped or missing prerequisites fail
the gate. Keep `verify` as the branch-protection check when changing job names.

Run `npm run test:ci` for workflow and image-promotion regressions. It also checks
that Vitest's two shards cover every discovered file exactly once without running
database fixtures. Each CI shard uploads a seven-day JSON report with test timings
and failures. Use these reports to assess shard balance before adding more runners.
Local `npm test` still runs the complete suite serially.

The Docker build owns production-build validation; there is no duplicate host
build. Publishable `main` runs save the smoke-tested image as a one-day artifact,
then a separate publishing job verifies its image ID and pushes it without a
rebuild. PR runs skip the image archive/upload. Image-transfer costs and GitHub
runner queues still affect total latency; compare successful runs at the same
scope rather than treating a failed early exit as a speed improvement.

The `@next/eslint-plugin-next` override replaces only its `fast-glob` dependency
with the local adapter in `tools/next-lint-glob`, backed by `tinyglobby` 0.2.17.
It implements only Next's CommonJS `globSync` call with `onlyDirectories`,
preserving literal-directory and absolute-path behavior and rejecting unsupported
options. This removes the unpatched `braces`
dependency ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm))
without disabling any lint rules or audit findings. Run `npm run test:lint-glob`
and `npm audit` when updating the lint dependencies; CI runs both. The tests
exercise Next's installed root-discovery helper and internal-link rule. Remove
the scoped override when Next ships an unaffected dependency chain.
The direct development dependency anchors the local package at the repository
root; the override references it with `$fast-glob`. Keep the adapter's Docker
`COPY` before `npm ci` so clean image builds resolve the same package.

## Reuse interaction patterns

Review the development-only [UI gallery](local-development.md#ui-pattern-gallery) before building a new interaction. Its examples use the same [shared components](../src/app/_components/ui) as the application. Keep the existing slate surfaces, white cards and accent themes. The [agent entry point](../AGENTS.md#start-with-the-shared-patterns) maps interactions to components and owns the control-height, table-action and responsive-header conventions.

- Use links for navigation, `SectionTabs` for in-page panels and `ChoiceButton` for persistent selections. A selected value is not a submitted action.
- Use the shared `Pager` from `student-portal.tsx` for participant and message lists. Give separate lists distinct translated labels, preserve their own page/filter state and use their existing `more` signal. Show the known current page; do not invent a total from a full batch or another list's count.
- Put related fields in `FormSection` and place its Save/Cancel actions after all fields they affect. Keep mutation state, validation and permission checks in the feature that owns the operation.
- Use `Modal` for review and confirmation, with a specific action label and consequence. Existing action tickets, countdowns and approval rules still apply; the component does not authorize a write.
- For a `useActionReview` containing private evidence, the feature must conceal it when authoritative access is revoked and call `revoke()` to release the stored review. Preserve accepted keys and pending writes; ordinary read failures should retain the review and its recovery.
- Use `StatePanel` to distinguish loading, empty results, errors and denied access. For a query with cached content, [QueryFeedback](../src/app/_components/ui/query-feedback.tsx) composes the initial panel and background `InlineNotice`; supply task-specific translated text and a read-only Retry. `hasData` means a completed response exists, including an empty array. The feature retains its content and drafts, controls dependent writes, and owns denial/cache handling. Failed queries need recovery, and denied access must not appear as an indefinite loader.
- Use `SummaryTable` for tables: only brief names, dates, counts and statuses in columns. Put existing details and editors behind compact text links in the rightmost `TableActions` cell. Read-only history tables can omit actions; only explicit action cells become sticky. `TableDetails` opens an on-demand dialog. Related contact, account, course and history sections may share a feature-owned reader, as in Tutee details, while retaining their separate authorization. Never mount private query or mutation children for observers.
- Compose new screens from the gallery's long-dialog, participant-form, filter, disclosure, settings, change-review and inline-notice examples. Reuse existing domain components. Set disclosure lifetime deliberately so collapsing a form never discards its draft.
- Register each dialog form's own pending write with `useDialogPending`; do not feed its aggregate return value back into registration. Keep independent forms and their version snapshots separate. Preserve cached drafts on refresh failure. Clear or replace them through the feature's confirmed save/synchronization path, an explicit successful reload or cancellation; a background refetch alone must not discard edits.

For potentially long table details, opt into `TableDetails longReader` as the room
grid and Crew original-text readers do. This composes the existing `ProfileDialog`
with a reachable header Close while preserving on-demand mounting. Keep brief
reviews compact; the feature still owns any pending writes and access checks.

`ProfileDialog` keeps its body in a stacking context below the sticky Close header.
Nested summary-table action cells retain their own horizontal stickiness, but must
not paint over the title or Close during vertical scrolling. Verify the long-reader
gallery with a sticky-action table and the actual room-order editor at deep scroll
in English and Chinese on desktop and mobile. Component tests check the stacking
boundary and keyboard lifecycle; saved browser images establish actual paint order.

Start by identifying the save boundary, query lifetime and authorized audience, then select a composition. Use an existing feature integration as well as a gallery example: long editors, immediate settings and staged forms intentionally have different save behavior. Keep new domain logic in the owning feature; a generic component must not infer permissions or expected versions from its visual state.

The [gallery compositions](../src/app/ui-gallery/recipes.tsx) have these
production references and boundaries. Each example supports English and Chinese;
verify it at real desktop and mobile viewports. The global form-state selector
controls the participant example; other recipes expose their own state transitions.

| Recipe and intent | First production references | States to verify | Boundary / non-goal |
| --- | --- | --- | --- |
| Navigation and registration: distinguish routes from local steps | [Public header](../src/app/_components/public-header.tsx), [tutee navigation](../src/app/student/navigation.tsx), [invitation flow](../src/app/register/register-flow.tsx) | One utility instance, wrapping labels, native Back/Forward, numbered progress and focused headings ([#221](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/221)) | The demo does not verify identities; features own proof invalidation, draft lifetime and server permissions |
| Long dialog: keep a large editor or reader usable | [Profile editor](../src/app/_components/profile-dialog.tsx), [policy reader](../src/app/_components/current-policy-dialog.tsx) | Nested Escape/Tab, exact focus return, long scroll, pending dismissal, rejection ([#231](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/231)) | Does not decide consent, review consequences or write authorization |
| Participant form: group one identity save | [Account](../src/app/_components/account-profile-editor.tsx), [tutor](../src/app/_components/tutor-profile-editor.tsx), [tutee](../src/app/_components/tutee-editor.tsx) editors | Editable, pending, failed and read-only; four-part/legacy names and retained drafts ([#232](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/232)) | Academic, membership and historical-link writes retain separate drafts and versions |
| Filter toolbar: select which records to show | [Management actions](../src/app/_components/management-actions.tsx), [account roster](../src/app/(admin)/admin/users/page.tsx) | Selected filters, native search/select, reset/count, pending refresh and pagination reset ([#237](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/237)) | Filters are not content tabs or commit actions |
| Disclosure: choose when content mounts | [Tutee creation](../src/app/(admin)/admin/tutees/page.tsx), [tutor details](../src/app/_components/tutor-details.tsx) | Closed/open, lazy read queries, retained drafts, collapse/reopen | Does not infer a draft lifetime or grant detail access |
| Setting row: explain when a choice saves | [CAPTCHA](../src/app/_components/program-captcha-settings.tsx), [Names and Grades](../src/app/_components/program-profile-settings.tsx), [subject willingness](../src/app/_components/subject-availability.tsx) | Immediate switch, staged save, unknown/yes/no, unavailable provider, read-only and failed refresh ([#234](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/234)) | Does not turn unknown into No or merge independent mutation/version rules |
| Change review: show the proposed consequence | [Approval evidence](../src/app/_components/approval-review-details.tsx), [departure review](../src/app/_components/school-departure.tsx) | Before/after, acknowledgement, changed input invalidating preview, pending commit | Does not generate confirmation tickets or replace immutable evidence |
| Inline notice: recover alongside usable content | [Profile settings](../src/app/_components/program-profile-settings.tsx), [availability](../src/app/(tutor)/_components/availability-editor.tsx) | Initial versus background failure, retained draft, successful Retry, explicit conflict Reload ([#233](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/233), [#223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223)) | Does not silently replace a version snapshot or repeat an accepted write |

For a recipe migration, link its feature issue and the corresponding running-page
and gallery screenshots in the local verification report. Record language, viewport,
role and state for each capture; keep the images and report in ignored `outputs/`.

### Compose a page by its purpose

Choose a frame for the task before adjusting individual cards. These are composition
roles using existing utilities, not new CSS tokens or a requirement to resize every
page. Preserve the slate background, white `.card` surfaces, existing font family
and accent themes. Use semantic warning/error/success treatments for outcomes;
changing the user's accent must not change what an outcome means.

| Role | Frame and current reference | Composition rule |
| --- | --- | --- |
| Management workspace | `max-w-7xl` (1280 px), [admin layout](../src/app/(admin)/layout.tsx) | This outer frame includes navigation and its gap; it is not a 1280 px editor. Keep the shared content edge and local table scrolling. |
| Participant workspace | `max-w-6xl` (1152 px), [student layout](../src/app/student/layout.tsx) and [tutor dashboard](../src/app/(tutor)/dashboard/page.tsx) | Allow schedule, roster and overview content to use the workspace. Do not shrink it to a reading column. |
| Standalone workflow | `max-w-5xl` (1024 px), [WorkflowShell](../src/app/_components/workflow-shell.tsx) | Use for a broad task outside the main workspace; keep explicit return context and the existing header contract. |
| Reader or long form | `max-w-3xl` (768 px), [handbook](../src/app/(tutor)/handbook/page.tsx) and wide [PublicFormPage](../src/app/_components/public-form-page.tsx) | Favor readable lines and one clear save scope. A feature may use a narrower frame when its fields warrant it. |
| Compact public form | `max-w-lg` (512 px), default `PublicFormPage` | Center the outer frame and its short introduction; keep fields and labels left-aligned through `PublicFormCard`. |

Pixel values describe maximum widths at the default root font size, not fixed
viewport widths. Keep responsive gutters and let enlarged text grow. Center an
outer reader/form frame when useful; align its fields, notices and actions to one
content edge. Do not center table data or form labels merely to make unlike pages
look identical. Embedded sections inherit the host's width and heading hierarchy.

Use a small spacing vocabulary: 4–8 px between a label and its helper, 12–16 px
between related controls, and 24–32 px between independent page sections. Prefer
16 px narrow / 20 px wider padding (`p-4 sm:p-5`) for compact workspace cards;
independent settings forms may use 20/24 px (`p-5 sm:p-6`). Match adjacent cards
with the same purpose before changing unrelated surfaces. The existing
`PublicFormCard` deliberately uses a roomier 24/32 px (`p-6 sm:p-8`) composition.
A proposed denser 20/24 px public long-form variant needs an explicit shared
contract and real-page verification; it is not an existing prop or a reason for
per-caller padding overrides. Follow the [control-height hierarchy](../AGENTS.md#control-height-hierarchy)
and [table-summary rules](../AGENTS.md#table-summaries-and-detail-submenus) for
interactive spacing rather than deriving target sizes from these content gaps.

Keep one page H1. Use the existing `.page-title` (24 px) and `.section-title`
(18 px) for workspace hierarchy; body/form text is normally 14–16 px and secondary
metadata 12–14 px. Public entry pages intentionally use a larger 30 px title.
Preserve semantic heading order independently of font size. Do not add a heading
to every wrapper or repeat the active tab name as an otherwise empty section title.
Essential evidence and instructions must remain readable; do not fade an entire
historical record or truncate the text needed to make a decision.

Start a page with its task title and only the context needed to act, followed by
local navigation/filters and the working content. Use specific section names such
as “Availability” or “Email addresses” instead of generic “Management” or “Details”
headings that convey no context. Keep descriptions only when they explain a
consequence, eligibility, save boundary or recovery step. Place field guidance by
its labelled control and decision evidence beside its action. Preserve permission,
consent and historical-ownership explanations even when they require more text.
Use existing schedule/request data when prioritizing work; layout changes alone
must not introduce a new computed next-session feature or domain rule.

### Align controls to their visual row

Choose the alignment reference before choosing flex or grid alignment. A labelled
field contains three different regions: label, interactive control and optional
guidance. A sibling badge, checkbox or action belongs at the vertical center of
the **control box**, not the center or bottom of all three regions. Put guidance
in its own grid row and associate it with the field using `aria-describedby`.
Announcement badges align with the title input; assignment labels and actions
align with the tutor selector; report checkboxes align with the adjacent selects.
Do not use ad hoc top margins that depend on English labels being one line.

A summary card has a different reference: center its action group against the
whole summary, including its secondary line. Within a participant heading,
center badges on the name line. Wrapped metadata starts at the name's content
edge, after the reserved disclosure space. Keep action typography consistent even
when one action navigates and another opens a dialog. Use a shared minimum row
height for lists containing both buttons and non-interactive badges; badges need
not grow to fill the row. Translated or enlarged text may grow beyond that minimum.

### Keep summaries compact and editing explicit

Show each subject as a brief row with its name, level badge, qualification and
willingness. Do not repeat a Qualification heading beside a Qualified badge.
Order qualified and willing subjects first, qualified and unwilling next, then
qualified subjects whose willingness is not recorded, then unqualified subjects.
Keep the current catalog order within a group. Unknown willingness is a distinct
state, not an inferred No. Put editing behind a rightmost Edit action and retain
the feature's independent mutation, approval and failed-save recovery rules.

Bulk selection is a deliberate exception to the trailing-action rule: a checkbox
column goes at the far left, with a named select-all control. Details and editors
remain in the rightmost Actions column. Selection remains stable while filtering;
subject catalogs use the same default order as signup forms.

Use one compact warning for an academic value needing review rather than an
unknown-value sentence followed by the same review instruction. Put full reasons,
self-excused absences, comments, evaluations and recorded service hours in named
detail readers. Attendance abbreviations such as P, EA and UA require a visible
legend and accessible expanded column names. Keep all columns and trailing actions
reachable on narrow screens; avoid side-by-side tables that compress either table
below its useful width.

Consequential actions use a neutral outlined boundary at rest and danger styling
on hover, keyboard focus and activation. The visible action label never disappears.
Keep consequential actions at the trailing edge of their own decision group when
this improves scanning; do not move an unrelated form's Save with them. Existing
confirmation, approval and pending-dismissal rules still apply. Touch users must
not depend on hover to identify the action or understand its consequence.

### Keep settings and navigation predictable

The Program Settings information architecture groups independent controls into
Recruitment and Refresh; Account Settings; Deployment Configurations; and Optional
Features. Calendar dates belong with the program period, messaging permissions with
account policy, and mail delivery/CAPTCHA with deployment. Moving controls does not
combine their save operations or broaden their authorized audience.

An invalid-record filter defaults to Active entries, followed by Invalid entries
and All entries. Here Active means not marked invalid, not a particular approval
or membership status. Preserve the underlying statuses and permission checks.

For repeated blur-save fields, put one clear save-boundary explanation at the top
of the group and associate it with the relevant controls. Use compact file-picker
actions with the selected filename beside them. Keep required descriptions and
native file selection accessible without redundant headers.

Temporary navigation may restore the current tab, filters, pagination and scroll
within the same browser session. Restore the correct scroll owner: management may
scroll an inner content region while participant pages scroll the document. Scope
state to the signed-in identity and route, validate restored values, and let an
explicit destination/hash or access change take precedence. Store no form drafts,
passwords, private record text or authorization results in navigation storage.

### Retain local work while changing panels

For a long settings workspace, group existing owners with `SectionTabs` rather
than introducing a combined Save. Program settings and Crew illustrate separate
settings, records and review panels. Choose initial mounting deliberately: keep
already-mounted form owners, or mount on first access when the feature permits it.
Retain the owner while its panel is hidden. Hidden controls must leave the keyboard and
accessibility trees. Keep an active review, its accepted-operation keys and its
refresh recovery outside a panel that can be hidden. A tab change must neither
discard a draft nor replay an accepted write; permission revocation still removes
protected content.

Put creation behind one title-row action when an always-open form delays the
primary records. Compose the existing `ProfileDialog`, with draft state above its
visibility toggle. Give creation and row editing independent drafts, even when
they share field markup. Verify close/reopen, failed saves, nested confirmation,
pending dismissal and exact opener focus before migrating another caller.

Search only the records already authorized for the current roster scope. Reuse
`matchesPersonSearch` for four-part, preferred, alternative and legacy names, and
match identifiers only when the query already supplies them. Apply search before
sorting; clearing it must preserve the other filters. In an explicit-ID participant
picker, filtering hides candidates without changing selection. Keep a selected
summary and deliberate removal so a long list never conceals the submitted IDs.

Explain the existing save boundary beside the relevant fields: a blur save, one
form Save and publication are different operations. Additional actions at the end
of a long editor must reuse the same admission guard, pending state and payload as
its top actions. Do not introduce autosave, a global action registry or draft
storage merely to make controls look consistent.

### Profile editor completion

In profile editors, completion of one section must not dismiss a failed independent
draft. Profile and username saves therefore keep the editor open for deliberate
Close, even when every operation succeeds. The saved section refreshes automatically
after Save, reading the server even if the cache is fresh and adopting only its
own fields and expected version before becoming editable again. Other sections
retain their drafts and versions. A failed or missing-record read keeps the saved
section locked and exposes **Retry refresh** outside its disabled fieldset. This
recovery performs reads only and never repeats the accepted mutation. The long
dialog recipe demonstrates a failed draft alongside a saved section using
`ProfileEditSection`. Saved feedback is separate from the refresh lock; failed
synchronization does not block idle Close. Verify both completion orders, failed retry,
all-success and a committed write whose synchronization fails on the actual pages.
For [repeat profile editing (#282)](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/282),
verify a third edit/save cycle without a restart action, failed automatic reads,
current version fences, same-frame duplicate submission, unchanged sibling focus and
retained drafts, including history editors. Use actual child components and the
installed QueryClient for composition coverage.

Gate refreshes independently when testing save completion. A rejected read must not
release dismissal or sibling submission while another refresh remains pending.
Use `settleRefreshes` at each aggregate boundary, including nested groups, and
present a refresh failure only after the remaining reads settle. Saved state must
continue to prevent replay of the committed mutation until its automatic matching
read or explicit recovery succeeds. Unrelated background refreshes never replace drafts.

Also test two active query variants under the same procedure prefix using the
installed QueryClient. Default invalidation can suppress GET errors; enabling
`throwOnError` alone can reject before another matching query finishes. The save's
refresh boundary must report actual read failures and own every matching read.
Mocked invalidation promises alone cannot establish either behavior.
Use `invalidateAndReport` inside `settleRefreshes` for these saved-section handlers:
it retains ordinary all-read waiting, then reports newly recorded errors from the
matching queries. `invalidateTuteeViews` exposes this behavior through its scoped
`reportErrors` option; its other callers retain their existing error handling.

For academic conflict Reload, verify academic and policy read failures separately,
including cached error results and thrown reads. The original draft, version and
school year must survive a failed read. Discard it only after both required reads
succeed; keep the reload guard until both settle even when the first read fails.
Historical identity previews remain separate, dismissible reads; a failed link
requires a fresh preview and acknowledgment.

### Verify and document a UI change

For a new reusable pattern, add an interactive example and behavior tests after implementation. Follow the [UI verification matrix](local-development.md#ui-verification-matrix), including English/Chinese, keyboard focus, all six accent palettes, long labels and narrow screens. Capture screenshots from the running application as well as the gallery; gallery fixtures cannot prove feature permissions or mutations. Check the [technical boundaries](technical-report.md#shared-ui-patterns) before migrating existing workflows.

File new proposals using the [issue conventions](issues.md), with the affected workflow, expected behavior, validation and behavior to preserve. The completed shared-pattern migration is recorded in [issue #219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219). For subsequent changes, inspect the current page and domain tests rather than treating an old migration checklist as outstanding work.

In a UI PR, state the trigger and resulting behavior, identify the shared patterns and affected page families, and link the issues it addresses. Record the tested commit and distinguish a full-suite run from later focused reruns. Cite measured control heights and the tested languages/viewports; palette fit alone is not a contrast result. Keep generated HTML reports, browser session files and local logs out of the commit. Close specific delivered issues through the PR, while referencing broader migration trackers that still have remaining scope.

For a phased UI migration, establish the composition and ownership contract first,
then address lost work, inaccessible interactions and misleading states before
pattern alignment and broader journey changes. Give each scoped fix a linked issue
and each wave a separate PR. Distinguish reproduced defects, source risks awaiting
a scenario and design opportunities; old audit entries are not proof that current
code is still broken. Shared component changes require checks of their actual
callers, while feature-only changes should not trigger an unrelated visual rewrite.

Keep one local HTML rollout report with a collapsed log for each phase: linked
issues/PR, scope, tested revision, before/after screenshots, behavior cases,
measurements, results and remaining limits. Finish the affected cases and required
checks before advancing; record full-suite results separately from focused reruns.
The final pass revisits every affected route and nested tab, including read-only,
empty/error, long-content and translated states. Keep durable guidance here and in
the technical/development guides; the local report is evidence, not a second set
of component rules. New features follow the same [extension recipe](#add-an-action-or-feature)
and [page-composition roles](#compose-a-page-by-its-purpose) from their first caller.

## Pull request size labels

The [PR Size workflow](../.github/workflows/pr-size.yml) automatically maintains one
size label when a PR is opened, reopened, updated, edited (including a new base),
or switched between draft and ready. It applies to all target branches and forks.
It becomes active after the workflow is merged into the default branch; existing
PRs receive labels on their next matching event.

Following [t3code's sizing rules](https://github.com/pingdotgg/t3code/blob/main/.github/workflows/pr-size.yml),
size counts added plus deleted lines from the PR's merge base, ignoring whitespace
and blank-line changes. Binary files contribute zero lines. Tests are excluded
when non-test lines change; test-only PRs use their full count. Lockfiles and
documentation count normally.

| Label | Effective changed lines |
| --- | --- |
| `size:XS` | 0–9 |
| `size:S` | 10–29 |
| `size:M` | 30–99 |
| `size:L` | 100–499 |
| `size:XL` | 500–999 |
| `size:XXL` | 1,000+ |

Test paths include `test/`, `tests/`, `__tests__/`, files containing `.test.`,
`.spec.`, `.browser.` or `.integration.`, and `scripts/test-*` / `scripts/smoke-*`.
Keep the workflow's exclusions aligned with new test entrypoints.

Missing label definitions are created automatically; colors and descriptions stay
synchronized while unrelated PR labels are preserved. The workflow uses the
built-in GitHub token. Its `pull_request_target` job reads PR commits only as Git
data: never add PR checkouts, dependency installation, builds or cache restores.
Run `npm run test:pr-size` to verify sizing and label updates locally; CI also runs
these tests.

## Implementation conventions

- Validate permissions and invariants on the server. Role, tutor linkage, crew membership and translation assignment are distinct; a matching name or email never establishes student ownership.
- Classify management writes in [approval-policy.ts](../src/lib/approval-policy.ts). `classifyApproval` defines direct, requester and reviewer authority, including payload-dependent reversals. Coordinator daily operations and Admin significant settings/profile edits have different review routes; see the [responsibility matrix](program-reference.md#management-responsibilities-and-review). Reuse the enclosing approval transaction and keep external delivery after commit.
- Preserve original survey priority, fixed deadlines, terminal request state, explicit historical ownership and exact policy acceptance snapshots. Use shared domain helpers and confirmation tickets.
- Use [service-hours.ts](../src/lib/service-hours.ts) for session calculations. Interviews use actual duration; meeting penalties use the semester allowance. Do not substitute generic rounding.
- Prisma CLI configuration lives in [prisma.config.ts](../prisma.config.ts). Schema changes need migrations; `db push` is for disposable experimentation and does not replace committed SQL constraints.
- Keep display names synchronized through the shared account-profile helper and account settings through the shared component. Do not import another route's page as a reusable component.
- Public sign-in, registration, recovery and tutoring-request pages use [PublicFormPage](../src/app/_components/public-form-page.tsx). Keep short forms in `PublicFormCard`; the longer tutoring request uses the wide frame and retains its own sections. Use `PublicFormRoute` for centered secondary links with descriptions on separate lines. The scoped `.public-form` styles follow the active accent theme without changing workspace controls. Keep long field examples in associated hints so they can wrap on mobile.
- Use “subjects” in interface copy and localize in [messages](../messages). Catalog tests validate ICU syntax and argument parity; review translations before enabling hidden languages.
- Keep bundled policy drafts separate from published database documents. Follow [policy publication](policies/README.md) when wording changes.
- Before changing Next.js behavior, read the relevant bundled guide under `node_modules/next/dist/docs/`. Use the existing Turbopack build command and local resource settings rather than global runtime changes.

### Consequential action inventory

Choose interaction by consequence, retaining the domain's stronger requirements.
Canceling a draft or confirmation must not invoke a write. A failed write retains
the editable draft and actionable error; freeze that draft during a pending write.
An approval ID means a queued proposal, never a successful application.

| Surface / action | Interaction and preserved safeguards |
| --- | --- |
| Subject willingness, announcement acknowledgement, meeting-excuse recall | Immediate action with pending protection and visible result/error |
| Availability, qualification evidence, meeting excuse, interview time/comment, roster profile or creation | Local draft with explicit Save/Submit and Cancel; retain failed drafts and independent editor snapshots |
| Tutor activation/opt-out, pairing schedule, legacy removal request/recall, interview final decision | Named consequence confirmation; preserve current version, panel vote, role and server permission checks |
| Student schedule conflict, policy acceptance, withdrawal and assignment | Existing domain dialog, server confirmation ticket, review delay, policy revision and immutable evidence remain authoritative |
| Tutors/Tutees/Users membership, school departure, account combination and deletion | Existing named domain confirmation/review; retain password checks, role restrictions, versions, proposals and before/after evidence |
| Users & Roles account deletion | The feature-owned password form composes `Modal`. Bind its label and form, preserve the captured target and failed password draft, admit one pending write, and restore the opener after idle dismissal. Keep Head eligibility and server password checks; do not replace this step-up with an ordinary generic deletion review |
| Room, time-slot, pairing, tutee, hour-adjustment and subject-level deletion; invitation revocation | `useActionReview` composes the shared modal around the exact record and consequence. Features supply the original authorized mutation, optional proposal recognition and read-only refresh. Failed writes retain the review; accepted writes never run again when refresh fails. Cancel and Escape before submission perform no write |
| Crew application/request decisions, activation/inactivation and account deletion; public announcement, news, image, section, page and saved-translation deletion | Name the affected person/content in `useActionReview`. The route or list owns review lifetime so card removal/tab changes cannot discard pending work or read recovery. Reversible crew status changes and re-creatable translations explicitly permit another review after a successful refresh; one accepted review never replays its mutation |
| Service Hours breakdown comparison, room timetables and attendance history | Read-only comparison matrices in named keyboard-scroll regions; no artificial action column. The compact Service Hours summary retains its real Details action |

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
[extension boundaries](technical-report.md#ui-extension-boundaries). Reuse a
current caller with the same consequence and lifetime; an old issue's unchecked
list is not proof that its implementation is still missing. The shared foundation
and navigation/form recipes shipped through
[PR #257](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/257),
which deliberately retained domain ownership and recorded unfinished live acceptance
separately from its passing CI. For example,
[issue #219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219)
was completed by [PR #275](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/275).
Later [PR #285](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/285)
added repeat profile saves, [PR #292](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/292)
set the current 24/44 px table-action sizes, and
[PR #293](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/293)
consolidated tutee details. Inspect those current components before extending them.

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
   below and the real page in the [UI verification matrix](local-development.md#ui-verification-matrix).
   Update this inventory when introducing another action family. Add a gallery
   example and behavior tests only when introducing or extending a reusable contract;
   a feature-only composition still needs its own behavior and permission tests.

For a named deletion, this adapter follows the existing
[Announcements integration](../src/app/(admin)/admin/announcements/page.tsx).
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

The bilingual `/p/about` example in `prisma/seed.ts` is development seed content. Existing custom pages retain their stored blocks; missing block translations fall back to English. Update a published page through the landing editor after review, never by running the demo seed on real data. Policies likewise use published database documents with English fallback, not live reads of sample files. Preserve accepted text/version snapshots and follow [policy publication](policies/README.md) to publish a reviewed revision.

## Documentation and repository hygiene

The public `/privacy` notice is maintained in [privacy-policy.ts](../src/lib/privacy-policy.ts), with English and Chinese text and an explicit English fallback. Update both versions and `PRIVACY_POLICY_UPDATED` when information handling changes. Its homepage links are permanent and independent of editable landing blocks. This notice is separate from database-backed participation agreements and acceptance snapshots. Before deployment, the operator should review the wording against actual hosting, email, storage and retention arrangements and configure `ORG_NAME` and `SUPPORT_EMAIL`. The page supplies a school-contact fallback when no support email is configured; it does not invent a provider, retention deadline or legal compliance guarantee.

Keep human-facing guides under `docs/`, with only `README.md` at the repository root. The root [AGENTS.md](../AGENTS.md) is the explicit exception: coding agents discover its UI conventions automatically. Keep control-height and responsive-header implementation guidance there rather than duplicating it in feature guides. Put other instructions in the existing guide for their audience:

| Reader's task | Maintained source |
| --- | --- |
| Find the right guide | [Documentation hub](README.md) |
| Use role-specific controls | [User guide](user-guide.md) |
| Configure the program | [Program reference](program-reference.md) |
| Understand code responsibilities and invariants | [Technical guide](technical-report.md) |
| Install, seed, test or troubleshoot locally | [Local development](local-development.md) |
| Deploy, bootstrap, back up or recover | [Deployment](deployment.md) |
| Adapt policy drafts and publish approved revisions | [Policy drafts and publication](policies/README.md) |
| Contribute, verify or maintain the repository | This guide |
| Report a reproducible problem or request a change | [Issue guide](issues.md) |

Keep each procedure in one place and link to it elsewhere. Update the relevant section when behavior changes; do not append a feature diary or create a page for every fix. Keep PR narratives, old audits, superseded policies and compatibility notes in Git/issue history. Documentation describes the current application; its real data-integrity and privacy boundaries still need to be stated.

Keep Markdown, policy inputs, reusable scripts, tests and the complete migration chain versioned. `prisma/policies/` is consumed by the development seed and is not a duplicate documentation folder. Dependencies, generated Prisma clients and Next build output are rebuildable. Do not delete migrations or runtime input files just because they are old.

Keep documentation as Markdown. Local reports, screenshots and temporary logs belong in ignored `outputs/` or `.validation/`. Database dumps belong in ignored `backups/` and private operator notes in `local-operations/`. Reusable helpers belong in `scripts/` or `src/`, where checks can exercise them.

Before removing caches, check whether a running helper owns them: `node_modules/.cache/` may contain an embedded PostgreSQL database. Stop or relocate it through its own lifecycle before deleting files or running `npm ci`. Preserve private timetables and other irreplaceable local input. Before removing a branch/worktree, fetch, inspect uncommitted work and verify its commits are merged; retain unique work and active worktrees.

The standard npm check command generates Next.js route and framework types before lint and TypeScript checks. This also supports fresh CI checkouts that have never started the development server.
