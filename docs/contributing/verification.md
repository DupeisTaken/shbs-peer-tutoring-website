# Verification and handoff

Choose checks for the affected behavior and run them serially on the local machine.
Follow [resource safety](local-development.md#worktree-and-resource-safety) before
setup. A documentation change needs no running app, browser or database.

## Required checks

Run all commands from the repository root:

- `npm run check` runs `next typegen`, ESLint with `--max-warnings=0`, and
  `tsc --noEmit` (works in a fresh checkout without starting the dev server). Fix
  warning root causes instead of suppressing diagnostics.
- Typed lint can exceed Node's 4 GiB heap; CI scopes
  `NODE_OPTIONS=--max-old-space-size=6144` to `npm run check` only. Scope the same
  override locally if needed and restore the environment afterward.

| Change | Verify with |
| --- | --- |
| Any commit | `npm run check` and relevant tests |
| Documentation | `npm run docs:check` (links, headings, discoverability, issue forms, `help:check`) |
| Application behavior | Focused tests, then integration suites with `npm test -- --maxWorkers=1` |
| Routes, environment or Prisma | `npm run build` plus relevant tests |
| Runtime image packaging | `npm run test:deployment`, `python3 scripts/test_image_storage_metrics.py`, CI `image` and `image-storage` jobs |
| Schema | Committed migration, `npm run db:migrate`, schema agreement on an isolated DB |
| Demo seed | Run twice on a disposable DB, then `npx tsx --conditions=react-server prisma/verify-demo.ts` |
| Interface copy | Update every catalog in `messages/` per [Writing UI copy](design.md#writing-ui-copy) and run `npx vitest run src/i18n --maxWorkers=1` |
| User interface | Desktop/mobile EN/ZH screenshots and checks of interaction, loading, errors and permissions |

Integration tests reset fixtures. Use the isolated loopback `shbs_shipping_test`
database per [test setup](local-development.md#5-run-the-tests); never run
destructive tests or demo seeds against real program data.

The [CI workflow](../../.github/workflows/docker-build.yml) runs `checks`
(`npm run check`, `npm run docs:check`, `npm run test:ci`, `npm run test:lint-glob`,
`npm run test:pr-size`, `npm run test:recovery`, `npm audit`), three parallel test
shards, `image` (unpacking CI-baked Help screenshots via
`scripts/unpack-help-assets.mjs`, production Docker build, and image/CLI smoke),
`image-storage` (layout comparison on packaging changes), and the required `verify`
gate. Always cite the current revision's CI run rather than historical test totals.

## CI capacity and queue discipline

Budget every workflow triggered by a PR within the account's 20 standard hosted
runner slots. **Displayed checks are not simultaneous runners.** Core CI has 8
displayed jobs (including the skipped PR publish job) and uses at most 4 runners
at once; PR Size adds 1 check/runner. **Allow each PR 4 additional concurrent
scheduling benchmark slots** when profiling triggers. Four core-only PR runs fill
the 20-slot budget; main-branch runs, manual campaigns and other repos share the
same pool.

| Workflows triggered for one PR revision | Displayed checks | Conservative peak runners |
| --- | ---: | ---: |
| Core build and PR Size | 9 | 5 |
| Core plus admitted scheduling profile | 20 | 9 |
| Also isolated recovery rehearsal | 21 | 10 |
| Also production network observation | 22 | 11 |

- **Scheduling profile** ([scheduling-profile.yml](../../.github/workflows/scheduling-profile.yml))
  adds **11 checks**: planning, 1 serial preflight group (5 diagnostics), 8 scenario
  groups (`cold`, `warm`, `Sunday`, `negotiation`, `allocation`, `catalog`,
  `contention`, `backlog`, `max-parallel: 4`) and aggregation across **60 latency
  partitions and 10 diagnostics**. It matches file paths (including admin/tutor
  routers, `prisma/**`, `package.json`, `package-lock.json`, scheduling and
  benchmark helpers). Check the admission artifact before calling a green run a
  measured PASS — both clock-deferred (`DEFERRED`) and reviewed non-scheduling
  dependency (`NOT_APPLICABLE`, via `pr-<number>-admission.json` or manual
  `admission-manifest`) runs exit green with workers and aggregation skipped
  (`measured: false`), while scheduling-relevant dependency or code changes fail
  closed (`BLOCKED`) at admission without downstream `Missing PROFILE_CAMPAIGN`
  noise. See the
  [profiling contract](../reference/session-planning.md#request-profiling-and-comparison-contract).
- **Queue discipline:** Check active/queued runs before pushing or rerunning.
  Batch verified changes from subagents into one push. Per-PR concurrency cancels
  superseded revisions; cancel only superseded runs owned by the task.
- **Core shards and gates:** Three balanced shards (`max-parallel: 3`) each use an
  isolated PostgreSQL 16 service and run serially (`--maxWorkers=1`) while
  `checks` → `image` → `image-storage` run sequentially in a fourth slot (30-minute
  timeout per job). Required `verify` fails on any failed, cancelled, skipped or
  missing prerequisite.
- **CI regression tests:** Run `npm run test:ci` after workflow or shard changes.
  After editing the scheduling group plan, regenerate worker steps with
  `node scripts/scheduling-profile/generate-workflow.mjs` so CI rejects no drift.

### Shard sizing and dependency/packaging gates

- **Shard sequencer:** [ci-shard-sequencer.ts](../../scripts/ci-shard-sequencer.ts)
  places the longest files first onto the lightest of 3 shards using measured
  durations from [ci-shard-timings.json](../../scripts/ci-shard-timings.json)
  (11 s default for unmeasured files; tie-break by path then shard index). Refresh
  timings after major fixture or dependency changes and run `npm run test:ci` to
  confirm every test file is assigned to exactly one shard.
- **Dependency audit & overrides:** Keep `npm audit` enabled and fix advisories by
  updating lockfile entries within supported ranges. `package.json` maintains
  deliberate scoped overrides (`tools/next-lint-glob` for `@next/eslint-plugin-next`'s
  `fast-glob`, `tools/next-lint-glob/minimatch-compat` for legacy ESLint consumers,
  and `vite` pinned to a patched release) without disabling lint rules or audit
  checks. Run `npm run test:lint-glob` and `npm audit` when changing lint or test
  toolchain dependencies, and remove scoped overrides once upstream ships clean chains.
- **Docker cache & promotion:** `image` imports GHA cache (`cache-from: type=gha`)
  without exporting cache, because unbounded BuildKit cache export previously
  stalled jobs before smoke checks. `main` runs save the smoke-tested image as a
  one-day artifact and promote it by verified image ID without rebuilding.
- **Runtime packaging & CLI smoke:** [Dockerfile](../../Dockerfile) prunes
  production dependencies after build and [assemble-runtime.mjs](../../scripts/assemble-runtime.mjs)
  stages disjoint dependency and application trees. Keep explicit operator CLI
  sources (`admin:create`, `identity:reconcile`, `recovery`) complete in
  `runtime-output/app` — image smoke verifies all three CLIs in addition to web
  boot. Packaging changes trigger `image-storage`, which compares baseline and
  candidate `/app` inventories, runtime configuration and two-release layer-growth
  proxies. See [local packaging checks](local-development.md#runtime-packaging-checks).

## Verify and document a UI change

- For a new reusable pattern, add an interactive `/ui-gallery` example and
  behavior tests. Check [technical boundaries](../reference/technical-report.md#shared-ui-patterns)
  before migrating existing workflows.
- Verify **real application pages** in addition to the gallery — synthetic gallery
  fixtures cannot prove permissions, native browser focus or persisted writes.
- Test four core viewports/locales on the same synthetic record: **desktop EN
  (1440 px)**, **desktop ZH (1440 px)**, **mobile EN (390 px)** and **mobile ZH
  (390 px)** — plus `1024 px` when sizing rules change, 200% enlarged text, long
  labels and all six accent palettes when shared styles change.
- Measure rendered control heights with `getBoundingClientRect()` against the
  [control-height hierarchy](design.md#control-height-hierarchy) and check painted
  foreground/background contrast separately from palette fit.
- Capture clean loaded states and deliberate pending/failure states separately.
  Wait for the specific recovery notice to clear before claiming Retry succeeded.
- For phased migrations or review batches, keep one local HTML rollout report with
  collapsed before/after logs in ignored `outputs/` or `.validation/` — never
  commit reports, screenshots or browser session logs. Preserve earlier reports as
  historical evidence rather than rewriting them.

## UI pattern gallery

With `npm run dev` running, sign in with a demo account and open `/ui-gallery`
(returns `notFound()` in production). Use its language, accent and form-state
controls to inspect shared components without mutating program data; resize the
real browser window to test responsive breakpoints. Run gallery unit tests without
a database:

```bash
npx vitest run src/app/ui-gallery --maxWorkers=1
```

## UI verification matrix

Use one local synthetic site and one browser session at a time. Record commit,
role, language, viewport, interaction and observed result beside screenshots.

| Surface | Verify in the running application |
| --- | --- |
| Application & interview discovery | Tutor Applications cards and Interview Records: completion separate from admission; newest/oldest completion and application dates, name order, missing dates last, global sorting past 20 rows, result counts/reset, exact deep-link scroll below sticky header without breaking short-target centering or desktop scroll pane; no writes on filter/sort. |
| Additional-qualification review | On `/admin/applications`, rehearse additional-subject and higher-level requests: initially closed review, Cancel/Escape focus return, required notes, direct approval with no reject button, rejection only via chair/voting, server refusal of direct reject, stale Reload, saved-decision refresh recovery (`qualification-review*.test.tsx`, `qualification-applications.test.ts`). |
| Interviews & combined approval | Admin/Head chair and rejected Coordinator chair; legacy missing/demoted chair blocked until valid chair assigned; completed-interview hour corrections preserving legacy chair; all votes, majority/tie, duration/attendance, stale versions, revoked authority, lost-response receipt, saved-but-refresh-failed recovery, no duplicate credits/notices, and stale-evidence notice layout (`>=44 px` replace button below `sm`). |
| Interview setup links | Accepted initial application **Set up account**: active code, linked account, pending verification, restricted/expired/used/missing/conflicting states, failed read Retry; observer denial; **Users & Roles** deep link (including unambiguous registration-code fallback) preserving filters and **Return to directory**; zero writes on open. |
| Tables & long readers | Brief cells; rightmost unboxed text actions reachable before/after local scroll (`24 px` desktop / `44 px` mobile); named keyboard scroll region; populated/empty/error/read-only states. Tall readers (`TableDetails longReader`, room grids, Crew text, Audit evidence, Meetings attendance): sticky Close reachable at deep scroll, no nested sticky action overlap over header, lazy mount, Escape/focus return. |
| Unified Combine records & history links | Users & Roles and participant editors: search all authorized User/Tutor/Tutee records independent of directory filters; preserve selection across searches; Admin vs. Head authority (no false submitted-request claim on denial), Head password, retained-login choice, safe retirement; multi-active review-required grouping; `44 px` checkboxes; failed preview/denial concealment, interrupted-response receipt lookup and read-only Retry; linking multiple accountless archives removes standalone rows while keeping original evidence. |
| Personal tutoring history (`/history`) | Separate received/provided tables, original IDs/periods and stored session hours; independent >50-row pagination for sessions, meetings and amendments; reopening resets cursors and refreshes; cached failure Retry, foreign denial, revoked participation with retained ownership. |
| Forms, dialogs & repeat profile edits | Save scope, pending fields/dismissal, failed-save draft retention, nested Escape/Tab and exact opener focus return, long-content scroll. Profile/username editors: Save → automatic fresh refresh → Save across repeat cycles without closing; Retry refresh without POST; sibling focus and drafts untouched; academic conflict Reload waiting on both academic and policy reads. |
| Account deletion step-up | Users & Roles: fresh consequence/fingerprint review, current singleton/history counts, ownership/intake/Head blockers, stale Reload, delayed password focus, same-turn admission, pending dismissal, accepted-write read recovery (`delete-account.test.ts` proves DB rollback/concurrency). |
| Copy, disclosures & chrome | EN/ZH copy follows [Writing UI copy](design.md#writing-ui-copy): 1–2 sentence inline notices, collapsed secondary rules, prerequisite inputs above gated actions, `FieldRequirement` markers without manual `*`, DB IDs only on name collisions; disclosure target sized independently of arrow glyph contrast. |
| Tutee detail reader | Tutees roster: single rightmost **View details** opening wide dialog with ordered subjects, email copy and lazy paginated history; current vs. historical academics; viewer/observer restriction without private queries. |
| Named destructive review & creation risk | Rooms, hour adjustments, pairings, time slots, subject levels, tutees, registration codes: exact target/consequence, Cancel/Escape without writes, queued vs. applied result, failed-write retry and read-only recovery after Close. Manual New Pairing/Add Tutee/Add Tutor: fresh unchecked `CreationRiskDialog` on every open before fields. |
| Timed confirmations | Schedule-conflict write blocks Escape while pending and retains draft/ticket on error; mandatory policy review blocks Escape while idle while keeping Sign out available. Follow [confirmation timing contract](../reference/technical-report.md#confirmation-timing-contract) for readiness/expiry boundaries, clock jumps and focus resume. |
| Tutor attendance & pairing groups | Attendance: same-turn double-submit admits one POST; failed totals refresh uses read-only Retry; **Submit another entry** starts new draft. Pairing groups: unified single/combined 50/50 cards, create without time → schedule → split/rejoin, dynamic combine mode dimming incompatible cards and auto-selecting minimal companions with notice, complete student×subject coverage, Both Available/Other/Unavailable slots, stale Reload and read-only Retry. |
| Cached queries & retained editors | Initial loading/error/empty distinct; background failure keeps content/draft with read-only Retry; authoritative denial evicts cache and stays latched across transport errors (`useSessionAccessDenied`). Policy/landing/meeting/translation contexts keep independent drafts across collapse/search/tab changes; policy archives use exact version/language and Crew/appeals conceal evidence on revocation. |
| Feedback audience & recurring schedules | Unknown/loading/failed/cached-true/cached-false audience states without inventing privacy claims; all 7 localized weekdays via `formatWeekday`, active weekday contrast (`>=4.5:1`), unchanged numeric payloads. |
| Invalid requests & public appeals | Tutor Applications and Signup Requests: required reason, invalid badge/filter, clear with reason, Admin direct vs. Coordinator proposal, observer badge without private details, concurrent processing blocked. Emailed appeal page: neutral receipt distinct from Pending/Declined/Cleared notices, rejected-draft retention and read-only recovery. |
| Filters, settings & Preferences | Pressed `ChoiceButton` vs. `SectionTabs`; filter/page resets; `32 px` desktop / `44 px` mobile toolbar heights; Preferences entrance cards (`TimeAvailability`, `SubjectWillingness`, `QualificationRequests`) opening wide `ProfileDialog` with retained drafts across close/reopen and opener focus return. |
| Roster search, creation & grouped workspaces | `matchesPersonSearch` within authorized scope; clearing search preserves filters; selected IDs survive filtering. Pairings/Announcements/Time Slots/Hour Adjustments single creation entry with independent create/edit drafts. Program/Crew/Support tabbed workspaces retain hidden-panel drafts while keeping active reviews/recovery outside hidden panels. |
| Readable historical states & mixed review rows | Measure painted text/glyph contrast (not parent color) on undone audit entries, inactive announcements, zero-value reports and fulfilled requests across all 6 accents. Check Discipline, Service Hours and Session Flags filter/action rows at 1440/390 px and 200% text; Session Flags never labels failed reads as empty. |
| Headers & navigation | Public, patrol, localization, management, tutor, tutee and account headers: single utility set, `32 px` desktop / `44 px` narrow controls, one H1, no overlap at 200% text; native Back/Forward, `#admin-content` vs. document scroll restoration, and identity changes. |
| Registration, CAPTCHA & reply | EN/ZH green 5-char invitation / blue 4-digit email code inputs, legacy-format acceptance, bound email, separate Viewer/tutee entrypoints, full tutee form before OTP, receipt popup, signed-in **Add access**, HttpOnly handoff cookie (no tokens in URLs/JS storage). Enabled CAPTCHA (isolated local fixture): Verify/Cancel/Retry reachable outside disabled ancestors, single-use server grant. Reply keeps recipient context, separate drafts and focus return. |
| Tutor membership, tutee feedback & history claim | Tutor opt-out: named review, accepted receipt retains ACTIVE status and shows 7-day eligibility, read-only refresh recovery. Tutee feedback: pending locks inputs, background read failure blocks submit until Retry. Historical claim: failed read keeps cached identity with Retry and blocks claim; denial conceals identity and clears confirmation. |

## Behavior and data-integrity cases

For behavior changes, cover stale versions, competing writes, authorization
changes and transaction rollbacks. Test rejected writes separately from accepted
writes whose synchronization fails. Distinguish database transactions, component
fixtures and live browser checks.

## Handoff record

In the PR description, record:
- Linked issue(s), source revision, affected files/pages and shared patterns.
- Checked scenarios, rendered measurements (`getBoundingClientRect()`, EN/ZH,
  desktop/mobile) and exact commands/results.
- Full-suite runs separately from focused reruns, current evidence separately from
  historical reports, and any remaining unverified scope.
- Keep local evidence in ignored `outputs/` or `.validation/`; see
  [documentation ownership](documentation.md#historical-evidence-and-continuation-notes).
