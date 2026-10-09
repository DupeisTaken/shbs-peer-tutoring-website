# Contributor guidance

Start with [local setup](local-development.md), then use the [technical guide's code map](technical-report.md#architecture) to find the implementation you need. Keep changes focused on current behavior and document the core ideas in code comments.

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
- Put related fields in `FormSection` and place its Save/Cancel actions after all fields they affect. Keep mutation state, validation and permission checks in the feature that owns the operation.
- Use `Modal` for review and confirmation, with a specific action label and consequence. Existing action tickets, countdowns and approval rules still apply; the component does not authorize a write.
- Use `StatePanel` to distinguish loading, empty results, errors and denied access. Failed queries need recovery, and denied access must not appear as an indefinite loader.
- Use `SummaryTable` for tables: only brief names, dates, counts and statuses in columns. Put existing details and editors behind compact text links in the rightmost `TableActions` cell. Read-only history tables can omit actions; only explicit action cells become sticky. `TableDetails` opens an on-demand dialog. Keep contact, account, course and history access separate and preserve existing authorization.
- Compose new screens from the gallery's long-dialog, participant-form, filter, disclosure, settings, change-review and inline-notice examples. Reuse existing domain components. Set disclosure lifetime deliberately so collapsing a form never discards its draft.
- Register each dialog form's own pending write with `useDialogPending`; do not feed its aggregate return value back into registration. Keep independent forms and their version snapshots separate. Preserve cached drafts on refresh failure. Clear or replace them through the feature's confirmed save/synchronization path, an explicit successful reload or cancellation; a background refetch alone must not discard edits.

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

In profile editors, completion of one section must not dismiss a failed independent
draft. Profile and username saves therefore keep the editor open for deliberate
Close, even when every operation succeeds. The saved section becomes read-only
until reopening; other sections retain their own drafts and versions. The long
dialog recipe demonstrates a failed draft alongside a saved section using
`ProfileEditSection`. Completed state disables that section without registering
pending work or blocking idle Close. Verify both completion orders, failed retry,
all-success and a committed write whose synchronization fails on the actual pages.

Gate refreshes independently when testing save completion. A rejected read must not
release dismissal or sibling submission while another refresh remains pending.
Use `settleRefreshes` at each aggregate boundary, including nested groups, and
present a refresh failure only after the remaining reads settle. Saved state must
continue to prevent replay of the committed mutation.

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

For a new reusable pattern, add an interactive example and behavior tests after implementation. Follow the [UI verification matrix](local-development.md#ui-verification-matrix), including English/Chinese, keyboard focus, all six accent palettes, long labels and narrow screens. Capture screenshots from the running application as well as the gallery; gallery fixtures cannot prove feature permissions or mutations. Check the [technical boundaries](technical-report.md#shared-ui-patterns) before migrating existing workflows.

File new proposals using the [issue conventions](issues.md), with the affected workflow, expected behavior, validation and behavior to preserve. The remaining page migrations are tracked in [issue #219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219); the current gallery and pilot pages do not imply a complete site migration.

In a UI PR, state the trigger and resulting behavior, identify the shared patterns and affected page families, and link the issues it addresses. Record the tested commit and distinguish a full-suite run from later focused reruns. Cite measured control heights and the tested languages/viewports; palette fit alone is not a contrast result. Keep generated HTML reports, browser session files and local logs out of the commit. Close specific delivered issues through the PR, while referencing broader migration trackers that still have remaining scope.

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
- Classify management writes in [approval-policy.ts](../src/lib/approval-policy.ts). Sensitive coordinator writes queue proposals. Reuse the enclosing approval transaction and keep external delivery after commit.
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
| Service Hours breakdown comparison, room timetables and attendance history | Read-only comparison matrices in named keyboard-scroll regions; no artificial action column. The compact Service Hours summary retains its real Details action |

Keep pending requirements outside completed-history disclosures. Use retained
child lifetimes for collapsible editors so collapsing is not an implicit Cancel.
Test applied versus queued outcomes, cancellation without writes, failed drafts,
permission changes and keyboard focus in addition to visual layout.
## Profile editor completion

Profile and username completion must leave independent drafts mounted. Keep saved
sections read-only until the user closes and reopens the editor; completion does
not register pending work or prevent idle Close. Test failure in both completion
orders, primary failure with sibling success, all-success, same-frame duplicate
submission, unchanged versions on retry, and deliberate dismissal. Use actual
child components and the installed QueryClient for this composition coverage.

Gate refreshes independently after a committed save. Use `settleRefreshes` at
each aggregate boundary and `invalidateAndReport` to report fresh errors only
after every matching query finishes. Opt into reporting through
`invalidateTuteeViews` only where saved-section feedback handles it. Include two
active variants of one procedure and reads from separate procedures; a mocked
invalidation promise alone cannot establish error reporting or complete waiting.

Academic Reload retains its approved two-read contract: cached error data,
rejections and synchronous throws preserve the draft; only two successful reads
with data permit replacement. Historical identity previews remain separate,
dismissible reads, and a failed link needs a fresh preview and acknowledgment.

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
