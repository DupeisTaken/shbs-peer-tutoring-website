# Verification and handoff

Choose checks for the affected behavior and run them serially on the local machine.
Follow [resource safety](local-development.md#worktree-and-resource-safety) before
setup. A documentation change requires no running app, browser or database.

## Required checks

Run commands from the repository root:

`npm run check` generates Next.js route/framework types before lint and TypeScript
checks, so it also works in a fresh checkout that has never started the dev server.

| Change                        | Verify with                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Any commit                    | `npm run check` and relevant tests                                                                    |
| Documentation                 | `npm run docs:check`                                                                                  |
| Application behavior          | Focused tests, then the relevant integration suite with `npm test -- --maxWorkers=1`                  |
| Routes, environment or Prisma | `npm run build` in addition to relevant tests                                                         |
| Schema                        | A committed migration, `npm run db:migrate`, and schema agreement against an isolated database        |
| Demo seed                     | Run it twice on a disposable database, then `npx tsx --conditions=react-server prisma/verify-demo.ts` |
| User interface                | Desktop/mobile screenshots and checks of interaction, loading, errors and permissions                 |

Integration tests reset fixtures. Use the isolated loopback `shbs_shipping_test` database for the combined suite and follow [test setup](local-development.md#5-run-the-tests). Never seed or run destructive tests against real program data. Run one bounded server/browser at a time and stop processes you started; do not kill unrelated Node processes.

The [CI workflow](../../.github/workflows/docker-build.yml) also checks dependency installation, migrations, schema agreement, dependency audit, production build and image boot/restart. Use its result for the commit being reviewed; old test totals are not current verification.

CI runs static/tooling checks, five test shards, and image build/smoke verification
in parallel. Each job has a nine-minute timeout (the short `verify` gate uses two
minutes). This is a whole-job limit, including setup, installation and migrations;
it fails an over-budget job rather than treating partial coverage as success.
Each shard owns a PostgreSQL service named `shbs_shipping_test` and
keeps test files serial; do not enable parallel database fixtures against one
database. The required `verify` check succeeds only when every job succeeds,
including every shard. Failed, cancelled, skipped or missing prerequisites fail
the gate. Keep `verify` as the branch-protection check when changing job names.

Run `npm run test:ci` for workflow and image-promotion regressions. It also checks
that Vitest's five shards cover every discovered file exactly once without running
database fixtures. Each CI shard uploads a seven-day JSON report with test timings
and failures. Use these reports and whole-job durations to assess shard balance
before adding more runners. The matrix size supplies Vitest's shard denominator;
keep the matrix contiguous from 1 and preserve serial files within each runner.
Local `npm test` still runs the complete suite serially.

The sizing baseline is successful [run 39441513352](https://github.com/DupeisTaken/shbs-peer-tutoring-website/actions/runs/39441513352)
at `6357007373d1efd177e36140d9e0ba7c80d2f237`: 467 files and 5,569 passing
tests. Its two whole test jobs took 11m44s and 13m19s; checks took 3m54s and
image verification took 5m33s. Replaying Vitest's path-hash partitioning over its
file timings estimates the slowest five-shard job at roughly 7–7½ minutes with
the observed setup and per-file runner overhead. Four shards estimate about
8m20s, leaving less room for variation. These are projections, not a hosted
five-shard result: confirm the complete jobs on the changed revision, including
cleanup and report upload. Runner queues are outside the job execution budget.
Preserve assertions and database isolation; refactor measured slow fixtures or
split an oversized file only when timings show that partitioning is insufficient.

For a dependency-audit failure, inspect the reported advisory and dependency path,
then update the affected lockfile entries within the supported version range.
Keep the audit gate enabled. For Vite/Vitest tooling updates, run `npm audit`,
`npm run test:ci` (including shard discovery) and a focused test suite before
relying on the complete CI test shards and image build for the new commit.

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

The `vite` override pins the test runner's transitive toolchain to 8.1.6, which
contains the patched editor launcher (see
[GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv)).
Keep the lockfile and override together; run `npm audit`, the affected Vitest
suites and CI before changing this pin. It does not replace the dependency audit
or suppress advisory findings.

When adding, renaming or removing interface message keys, update every bundled
catalog in `messages/`, including languages hidden from the default picker. Run
`npm test -- src/i18n/locales.test.ts --maxWorkers=1` to check key parity, nonblank
values and ICU placeholders before the complete CI suite.

## Verify and document a UI change

For a new reusable pattern, add an interactive example and behavior tests after implementation. Follow the [UI verification matrix](#ui-verification-matrix), including English/Chinese, keyboard focus, all six accent palettes, long labels and narrow screens. Capture screenshots from the running application as well as the gallery; gallery fixtures cannot prove feature permissions or mutations. Check the [technical boundaries](../reference/technical-report.md#shared-ui-patterns) before migrating existing workflows.

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
of component rules. New features follow the same [extension recipe](implementation.md#add-an-action-or-feature)
and [page-composition roles](design.md#compose-a-page-by-its-purpose) from their first caller.

## UI pattern gallery

While `npm run dev` is running, sign in with a local demo account and open `/ui-gallery`. The gallery renders real shared components with synthetic data and no application mutations. Language, accent theme and form-state controls expose English/Chinese, all six palettes and editable/saving/error/read-only examples. Theme previews do not write the theme cookie and restore the previous theme when leaving the gallery. Reload resets the example data.

Resize the browser to test the actual viewport and breakpoints; a narrow card inside a desktop window does not simulate mobile CSS. Check the form save scope, selection state, tab keyboard navigation, dialog focus, brief table columns, rightmost text-link detail entries, comparison-table scrolling and recovery controls. Confirm actions remain reachable before and after horizontal scrolling. Follow the [control-height hierarchy](design.md#control-height-hierarchy) for rendered control measurements. Store screenshots in ignored `outputs/` or `.validation/` and include real pages in visual verification.

The composition examples include a wide editor with nested review and policy reader, four-part participant identity, a wrapping filter toolbar, explicit disclosure lifetimes, three different settings/save models, versioned change review and background failures that retain drafts. Exercise nested Escape and focus return, save failure/retry, preview invalidation and collapse/reopen. The public card reuses production framing. These examples use synthetic state; verify domain permissions and real versioned writes on the actual pages as well.

The `/ui-gallery` server page calls `notFound()` in production, and normal authentication still applies in development. Focused gallery tests require no database:

```bash
npx vitest run src/app/ui-gallery --maxWorkers=1
```

For the additional-qualification entry dialog, run `npx vitest run src/app/_components/qualification-review.test.tsx src/app/_components/qualification-review-dialog.test.tsx src/app/_components/qualification-review-cache.test.tsx --maxWorkers=1`. The real-database counterpart is `npx vitest run src/server/qualification-applications.test.ts --maxWorkers=1` against the isolated `shbs_shipping_test` database described below. On `/admin/applications`, rehearse both additional-subject and higher-level requests: initially closed review, entry without a write, Cancel/Escape and focus return, required notes, direct approval with no reject action, rejection only through the interview chair/voting workflow, delayed/failed writes, stale draft Reload, and saved-decision refresh recovery. Include server refusal of direct rejection for both request types and Admin/Head roles, interviews enabled/disabled, assigned-panel non-bypass and restricted roles at desktop/mobile sizes in English/Chinese.

For initial, additional-subject and higher-level interviews, include an Admin chair with a Head panelist, a Head chair, and a rejected Coordinator chair. Legacy panels with a missing or demoted chair need a valid Admin/Head chair assignment before scheduling, new decisions or first completion. Check that the tutor dashboard hides chair actions for an ineligible saved chair while preserving permitted panel voting and history. Scheduling checks the chair's current account role and tutor link without requiring all other panelists to remain eligible; decisions and first completion revalidate the full panel. For already completed interviews, verify hour corrections and idempotent retries with a recorded Coordinator or demoted chair: today's chair-role check is skipped, while the recorded chair, other panel/qualification checks and correction approvals remain. Corrections must not replace the historical panel or reopen admission.

See [contributor guidance](interaction-patterns.md#reuse-interaction-patterns) for adding patterns and [technical boundaries](../reference/technical-report.md#shared-ui-patterns) for their responsibilities.

After a refused interview approval, verify the retained draft's stale-evidence
notice in English and Chinese: below `sm`, its full-width guidance precedes the
explicit replace-draft action. Measure the text and button bounds, keep the
button at least 44 px tall, and confirm the long dialog scrolls to its footer.

## UI verification matrix

Use one running local site with synthetic data and one browser session at a time.
Record the commit, role, language, viewport, interaction and observed result beside
the screenshots. Verify the affected application pages; a gallery screenshot alone
does not establish authorization, native browser focus or persisted behavior.

| Surface                                   | Check in the running application                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application and interview discovery | Check both Tutor Applications cards and Interview Records: completion is separate from admission status; newest/oldest completion and application dates, name order, missing dates last, global history sorting beyond the first 20 records, result counts and reset. Verify legacy saved filters, exact application links, retained approval/search/completion drafts and loading/error recovery. On first and repeated links to a tall expanded card, measure that its name/status remain below the actual sticky header; correct focus alone is insufficient. Retain native centering for short targets and the independent desktop scroll pane. Capture EN/ZH desktop/mobile controls and completion-date summaries; sorting and filtering must make no workflow writes. |
| Combined interview approval | Check all votes, majority/tie, Admin and Head chair, missing/invalid service, explicit attendance, existing exact completion, stale versions, revoked authority, lost-response receipt and saved-but-refresh-failed recovery. Verify accepted rows survive filters while their approval dialog owns recovery. Check initial code vs linked account and qualification approval without a code; retries must not duplicate credits or notifications. Use the disposable demo database only. |
| Interview setup links | Open Set up account on an accepted initial application; verify active code, linked account, pending verification, restricted account, expired/used/missing and conflicting references, and failed read/Retry. Observers and participants must not read codes. Opening/refreshing must issue nothing. Follow the popup’s Users & Roles link to the exact tutor ID with saved search, role/account filters and hidden historical/unverified records. Include the unambiguous application-linked registration-code tutor fallback when `promotedTutorId` is absent, and no inferred target for ambiguous links. Check the highlighted row, keyboard focus, unavailable/deleted target, read failure/retry and denied access; **Return to directory** restores the saved view. Opening the link must not create an account or issue an invitation. Check EN/ZH at desktop/mobile sizes. |
| Tables                                    | Brief cells; authorized text actions at the right edge before/after local scrolling; named region reachable by keyboard; populated, empty, error and read-only states                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Combine login accounts                    | Choices match displayed Users & Roles login rows after filters/search; default visibility and explicit reveal, accountless exclusion, zero+zero/zero+signup in both directions, unfinished duplicate/ready survivor, pending filters and delayed preview invalidation. Include server/component combine tests and the Users page. Check EN/ZH at 1440/390 px, actual control bounds and matched desktop-English before/after separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Forms and dialogs                         | Save scope; pending fields/dismissal; failed-save draft retention; nested Escape/Tab and focus return; successful child write with pending refetch; actual long-content scrolling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Account deletion step-up                  | Users & Roles: fresh consequence/fingerprint review, precise current singleton/history counts, retained ownership/intake/Head blockers and explicit stale-review Reload. Check delayed password focus, named native dialog, label/opener restoration, same-turn admission, pending dismissal, rejected draft and accepted-write/read recovery. Include `delete-account.test.ts`, the deletion component, Users page and auth/ownership regressions. Use synthetic EN/ZH desktop/mobile records; opening and canceling proves layout/focus, while database tests prove deletion, concurrency and rollback                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Request disclosure                        | Measure the sole Expand/Collapse target at desktop and mobile widths and the actual arrow leaf's contrast. Verify Enter/Space, focus, expanded state, retained selections, fulfilled auto-collapse and visible invalid-record review controls; include long labels and enlarged text without document overflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Repeat profile edits                      | Account, tutor, tutee and Head username: Save → automatic refresh → Save without closing or a restart action; forced fresh version read; Retry refresh without a POST; automatic completion leaves sibling focus alone; retained academic/history drafts and original versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tutee detail reader                       | Actual Tutees roster: one trailing View details action; ordered subject choices, email copy and paginated history in one wide dialog; current versus historical academics; missing email and retained-owner setup restrictions. Check EN/ZH, long names/subjects/email, desktop/mobile scrolling, sticky Close, Escape/focus return and pending verification dismissal. History mounts on opening, refreshes on reopening, and retains cached content with Retry after failure. Viewers and departure observers must retain summary/subject access without contact or history queries                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Named destructive review                  | Rooms, hour adjustments, pairings, time slots, subject levels, tutees and registration invitations: exact target/consequence, Cancel/Escape without writes, one confirmed mutation, queued versus applied result, failed-write retry, held refresh and read-only recovery after Close. Viewers retain only authorized read access                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Timed confirmations                       | Hold a schedule-conflict write and press Escape repeatedly: the dialog and reason remain. After rejection, retry retains the reason/ticket; idle Cancel restores the opener. Mandatory policy review blocks repeated Escape even when idle while keeping explicit Sign out available. Verify native behavior separately from jsdom handlers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tutor attendance                          | Submit twice before the first response and verify one feature POST; reject it and retry the retained draft. Hold/fail totals refresh after acceptance, verify read-only Retry issues no attendance POST, then use Submit another entry to start a new draft. Server deduplication is a separate integration assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tutor pairing groups                      | Create without a time → reload → schedule → split/rejoin. Check complete student × subject coverage, missing combinations, shared schedule/primary room, distinct roster and matching management group references. Verify Both Available / Other Time Slots / Unavailable, exact/partial overlaps and adjacency. Review/Cancel without writes; stale draft/explicit Reload; pending dismissal; accepted-save read Retry without another POST. Record attendance, regroup and compare saved evidence/hours, including background primary changes. Check member and catalog slot edits, foreign/inactive/old-period denial, archived groups with departed students, unrelated room conflicts and concurrent saves. Capture desktop/mobile English/Chinese on the real portal, measure 44 px phone controls and retain independent attendance drafts.                                                                                                                                                                                |
| Cached queries                            | Initial loading/error/empty are distinct; background failure retains content and draft; Retry completes without a mutation; explicit conflict Reload adopts data only on success. Use a real QueryClient for denial → cache eviction → transport failure → authorized recovery, including independent query scopes and unchanged observer restrictions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Retained editor contexts                  | Policy/landing languages, meeting selection and translation targets keep independent drafts. Collapse, search and tab changes retain pending/error state without eagerly mounting untouched contexts. Accepted writes with failed synchronization recover through reads only; leaving or reloading the feature ends local draft retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Review evidence and revocation            | Policy archives use the exact selected language/version. Appeals and Crew reviews expose original full text. Exercise named dialogs, Escape and exact focus return. In the gallery and Crew, authoritative access revocation conceals the active evidence; pending generations still settle, accepted/queued keys stay blocked and stale callbacks cannot affect a later authorized review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Feedback audience and recurring schedules | Verify unknown/loading, failed, cached-true, cached-false and confirmed audience settings without inventing a privacy guarantee. Check all seven stored weekdays in English/Chinese, including availability headings and accessible group names, confirmed/unconfirmed schedules and empty room/slot states. Measure active weekday text against its actual background (at least 4.5:1), not a parent color. Confirm unchanged numeric weekdays, slot IDs and Save/review payloads; do not infer a next session date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Invalid public requests                   | Tutor Applications and Signup Requests, including older public entries: required reason, invalid badge/filter, recorded staff reason, clear with reason, unchanged original status and blocked processing. Check Admin/Head direct changes, Coordinator proposals, observer badge without private details, EN/ZH at 1440/390 px, Escape/focus return, retained draft, pending dismissal and read-only refresh recovery. Include `request-invalidity.test.ts`, the shared dialog/page tests and invitation regressions; verify concurrent processing cannot pass a newly committed flag.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Filters and settings                      | Pressed selections versus content tabs; filter/page reset rules; consistent control heights, including the tutor qualification Request/Cancel action pair at 40 px desktop and at least 44 px mobile; immediate switches, unknown/yes/no choices and staged saves keep their own semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Roster search and pairing selection       | Search within the authorized role/participation scope using four-part and legacy names plus permitted identifiers. Clearing search preserves other filters. Select → search away → clear retains exact IDs; removing one leaves others intact. Use long names and at least 50 candidates on mobile without document overflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Creation and grouped workspaces           | Pairings, Announcements, Time Slots and Hour Adjustments: one creation entry, close/reopen draft retention, independent create/edit drafts, rejected saves, pending dismissal and nested review. Program, Crew and Support: inventory every existing control, retained panel drafts/filters/pagination, review and accepted-write recovery outside hidden panels, keyboard tabs and unchanged roles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Last-resort creation warning              | Management New Pairing, Add a Tutee and Add Tutor: warning before fields on every opening; fresh unchecked acknowledgement and disabled Continue; Cancel/Escape restores the opener without opening fields or writing; acknowledged Continue opens fields without a mutation/proposal. Close/reopen requires acknowledgement while preserving unfinished drafts. Check EN/ZH desktop/mobile, long warning text, keyboard focus, pending-save dismissal, role restrictions and existing save tickets/approvals in the actual pages as well as the gallery                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Save scope and tutor orientation          | Blur guidance describes only existing immediate fields; focus without changes writes nothing. Top/footer layout Save share one pending state and admission guard. Tutor attention counts exclude paused interviews and distinguish unavailable from empty reads; task-specific attention links and today's schedule remain, while the duplicated permanent section-link strip is removed. Actual workspace navigation stays reachable. WorkflowShell keeps one shared utility set and correct role/return context at 1024 px and narrow widths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Long table readers and pagination         | Room-grid and original Crew text: header Close remains reachable after scrolling; lazy mounting, nested Escape/focus return and pending child writes. Participant/support/message lists: distinct navigation names, first/middle/final/empty states, independent page resets and 44 px narrow controls with enlarged text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Readable historical states                | Measure actual foreground/background contrast for undone audit entries, inactive announcements and fulfilled request metadata/actions. Inspect the painted text or glyph leaf: a parent color does not establish a child icon's contrast when the child overrides it. Keep status meaning without fading whole records; verify selected recipients and unread messages under all six accent themes. A passing body-text ratio does not establish metadata, action or focus contrast                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Mixed review/filter rows                  | Measure Discipline note/actions, Service Hours month/Clear/History, and Session Flags penalty/actions at 1440 and 390 px in EN/ZH, including long labels and 200% text. Check 32 px desktop baselines, at least 44 px mobile targets, wrapping and retained pending/error drafts. Session Flags must not label unknown or failed reads as an empty queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Headers and navigation                    | Public, patrol, localization, management, tutor, tutee and standalone account headers: single utilities, 32 px desktop / 44 px narrow controls, wrapping labels, one H1; native route Back/Forward and manual local tab activation with retained drafts. At 200% text size, check actual control bounds and pixels for overlap: workspace utilities may wrap within their mobile grid area, preserving target sizes and keeping navigation unobscured. Document width alone cannot detect controls overlapping inside the header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Registration and reply                    | EN/ZH invitation code card, numbered later steps and heading focus; separate Viewer/tutee entrypoints; full tutee form before OTP verification and legacy-link confirmation; receipt copy, optional email success/failure, prefilled continuation, Close/reopen and exact focus return; bound email, edit/reverify, resend failure and pending locks. Check signed-in Add access, new-account prefill, primary/verified-secondary ownership, additive Tutor/Crew/tutee access, exclusive Viewer transition and management max-rank/no-demotion. Existing Viewer-source LOGIN changes no membership. Preserve MFA, suspension, participation departure refusal, credentials, intake priority and policy evidence; departure alone must not block an authorized management grant. Verify the short-lived HttpOnly handoff cookie and absence of proofs/passwords from URLs or JavaScript storage. Reply retains recipient context, separate drafts, cancel focus return, retry keys and permission failures below the sticky header |
| Enabled signup CAPTCHA                    | Use an isolated local SDK fixture without paid provider calls. On tutee signup/resend and Viewer identity/code resends, check native Verify/Cancel/Retry reachability outside disabled ancestors, frozen drafts, cancellation/rejection recovery, one write per accepted proof and rejection of a spent server grant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Participant/public flows                  | Native invalid-name correction, legacy names, requirement markers, creation collapse/reopen, translated back/language navigation and existing consent boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Use an actual narrow viewport such as 390 CSS pixels and a desktop viewport such
as 1440 pixels; include the 1024 px boundary when sizing rules change. Check
English/Chinese, long labels and enlarged text, and inspect all six accent palettes
when shared styles change. Measure control bounds with `getBoundingClientRect()`
against [the height hierarchy](design.md#control-height-hierarchy). Check normal,
hover, selected, disabled and focus states where the patch changes them. Distinguish
palette layout checks from measured foreground/background contrast.

Take clean screenshots after loading completes and separate captures for deliberate
failure/pending scenarios. Wait for the specific recovery notice to clear before
claiming Retry succeeded; another query may have its own error banner. Keep full
mobile forms reviewable across multiple captures. Inspect the screenshots, record
test limitations, and stop owned browser/server/database processes after checking.

For confirmation timing changes, use the [action matrix](../reference/technical-report.md#confirmation-timing-contract).
Capture real countdown states before and after using the same synthetic record,
role, locale and viewport; record the rendered label as well as the nominal server
delay. Check exact readiness/expiry boundaries, client clock jumps, throttled
background callbacks and focus/visibility resume, cancelled/reopened or changed
targets, late preparation, same-turn duplicates and repeated identical write
rejections. Verify policy read/agreement evidence and the assignment-to-qualification
ticket handoff. The dedicated timing, dialog and submission tests cover these
boundaries; the survey and assignment router suites verify actual stored ticket
consumption, cancellation scope and unchanged lifetimes against the isolated DB.

For each rollout phase, capture the before and after state using the same synthetic
record, role, language, viewport and interaction. Compare the affected content
edges, heading hierarchy, card spacing, text wrapping and reachable actions against
the [page-composition roles](design.md#compose-a-page-by-its-purpose); different
task widths are not themselves a defect. Label changed fixtures or environments
explicitly, and keep hosted observations separate when its deployed revision is
unknown. Put cases, measurements, focused/full-suite results and remaining gaps in
that phase's collapsed local HTML report log. Screenshots establish appearance in
the recorded state; tests and interaction checks establish the corresponding draft,
permission, pending-write and recovery behavior.

## Evidence for a UI review batch

Keep a separate before/after evidence matrix for **desktop English**, **desktop
Chinese**, **mobile English** and **mobile Chinese**. Use the same synthetic record,
role, locale, viewport and interaction for each pair. A desktop English crop does
not stand in for mobile Chinese verification. Record actual client width as well
as the requested viewport, the source revision and whether the capture shows a
summary, editor, pending state or intentional read failure.

Measure the intended visual row: compare badge/action centers with the input box
when labels and helpers sit outside it, and compare whole-card actions with the
summary's bounds. Check wrapping application metadata starts at the name edge.
For room grids, include at least 20 rooms, overlapping occupied slots, unavailable
periods, empty room selection, both view modes and long translated room names.
For navigation, leave and return through links and Back/Forward; verify the actual
management content scroller as well as document scroll and identity changes.

Reports explain the design rules and implementation alongside each numbered
request, then expose the four evidence groups separately. Keep logs, raw immutable
evidence, user-annotated references and failure/recovery cases collapsed. Identify
missing baselines and test-only behavior explicitly; a source inspection or an
annotated user crop is not a measured browser result. Preserve earlier reports
with their original revisions instead of rewriting their historical claims.

## UI handoff safeguards

- Follow the [UI verification matrix](#ui-verification-matrix)
  on the affected real pages as well as the gallery. Use actual desktop/mobile
  viewports, English/Chinese, long labels, keyboard navigation and role restrictions.
- Keep browser/server work serial and tests bounded. Stop only processes you own;
  inspect shared dependency junctions and database ownership before cache cleanup.
- Document which commit, cases and measurements were checked. Distinguish full-suite
  results from focused reruns, and gallery layout checks from contrast measurements.
- Keep human guidance in the existing `docs/` guides and local HTML/screenshot
  evidence in ignored `outputs/` or `.validation/`. Track new proposals through the
  [issue conventions](issues.md), link PRs to their issues, and keep broader
  migration trackers open when only part of their scope is delivered.

## Behavior and data-integrity cases

For behavior changes, include stale versions, competing writes, authorization
changes and rollback cases where they apply. Test rejected writes separately
from accepted writes whose synchronization fails. State which cases used real
database transactions, component fixtures or actual browser interactions.

## Handoff record

Record the source revision, affected files/pages, checked scenarios and exact
commands/results in the PR. Distinguish complete suites from focused reruns,
current evidence from historical reports, and verified cases from remaining scope.
Keep local evidence in ignored `outputs/` or `.validation/`; see
[documentation ownership](documentation.md#historical-evidence-and-continuation-notes).
