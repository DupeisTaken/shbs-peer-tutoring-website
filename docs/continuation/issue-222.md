# Issue #222 cloud continuation

## 2026-10-09 verified completion

Official [PR #275](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/275)
completes the remaining shared task/consequential-action scope. Tested application
source is `d8a702bdad22c0130dab86add5b2e15d2b919557`; the
[shared ledger](shared-ui-integration.md) records the passing 3,162-test CI run,
16 real profile cases and immutable-record audit, layouts, independent review and
visually verified self-contained HTML report. No merge or deployment was performed.

The current task matrix covers active/pending/inactive/suspended roles in EN/ZH at
desktop/mobile widths, with actionable work before optional history/preferences.
Twelve workflow cases cover willingness, discipline, attendance correction, nested
departure, raw timed schedule dialogs and attendance. Pending writes block repeated
Escape and editing; rejected drafts retain their reasons and original versions.
Schedule preparation uses real server tickets. Attendance retains all 25 native
rating choices with 44 px mobile targets; keyboard arrows work. Failed writes retry
the original payload, accepted-write/totals-read failure retries only reads, and
Submit Another opens a fresh enabled draft without another POST.

Twelve additional task/navigation cases cover meeting reason rejection/retry,
pairing and activation cancellation without writes, the actual interview chair's
decision comment/version retention, pending qualifications outside collapsed or
terminal-filter history, explicit fresh discipline/attendance Reload and route
navigation/access restrictions. The meeting form row measures 40 px desktop and
44 px mobile.

All 13 migrated review families have EN/ZH desktop/mobile named-target, keyboard,
Cancel-without-write and layout receipts. Real room deletion and reversible Crew
status changes prove accepted-result lifetime and read-only recovery after Close.
Six additional caller-specific workflows cover hour adjustments, pairings, time
slots, subject levels, tutees and invitation revocation: controlled rejection,
unchanged Retry, one accepted response, held/failed read, Close, read-only Retry and
post-delete list removal. Those streamed outcomes are explicitly simulated; they
do not claim six real deletions. The real coordinator queued-proposal receipt is
separately attributed to `8631228` and remains distinct from an applied result.

The Head/Viewer roster and gallery matrix now includes authorized detail access,
Viewer Users denial, rightmost actions reachable before/after local keyboard scroll,
six-column Service Hours comparison and independent saved/failed gallery sections.
Six translated headers are measured after 200% text enlargement, with no overlap or
page overflow and retained touch targets. Owned runtime processes are stopped.

Public onboarding/wizards/CAPTCHA remain assigned to #268 / PR #276 as the separate
remaining #221 layer. The draft/runtime/report holds below are historical records,
not current limitations or instructions to repeat completed implementation.

## Historical checkpoint

> Historical checkpoint: the tutor-task implementation below was subsequently
> integrated by PR #257 and refined by PR #259. Its old draft/publication and
> runtime limitations describe that session, not current task instructions. The
> remaining management deletions now use the named review composition described
> in the contributor action inventory; stronger domain reviews remain in place.

This is an incomplete draft checkpoint for [issue #222](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/222), not approval to merge or deploy. The requested final HTML report remains gated on current live evidence and independent review. Continue the existing branch; do not repeat completed work solely to recreate local receipts.

## Revision and integration order

- Branch: `codex/issue-222-tutor-tasks`; PR target: `main`.
- Reviewed application/source head: `ce59dad239067e6cb58e5e1448158dda6047c125`.
- Recorded merge base with local `origin/main`: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`.
- Original #222 feature commit: `d2c7c45a8b83920ef065a0705a854d0ac8fa62f0`, on foundation `ea063372d12b3d62e5b0e6ea143e2afa00fc7d4e`.
- Shared repairs were integrated through source-approved foundation `d7ca4d7a850f2cb79fb88a087c42bc98da148f84`, including the earlier `cc3009ad15c1832f4bda5c8320af7372ce26d96f` dialog fix and consumer group through `25ac0257020dd2955a00c96ed685c0c38c3ac77d`. They have different cherry-pick SHAs on this branch.
- The publication commit may add only this continuation document and its documentation-hub link after the reviewed source head. Read the PR's published SHA and `git rev-parse HEAD` for that exact tip; the source validation below applies to the named commits, not arbitrary future changes.

Integrate the shared foundation [PR #244](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/244) first, then reconcile this branch with the accepted foundation. Its remote head may have advanced beyond the shared source recorded here: inspect the actual delta before integration. Do not blindly cherry-pick the entire foundation again. The main-target diff includes substantial inherited foundation work; it is not all #222-specific.

Shared overlaps include `src/app/_components/ui/`, profile/account/tutor/tutee editors, academics, discipline and attendance correction, `src/lib/invalidate-refresh.ts`, `settle-refreshes.ts`, `tutee-cache.ts`, gallery recipes, message catalogs and contributor/user/technical guides. Coordinate with [#206](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/206) for shared consumers. [#216](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/216) owns mobile roster placement; [#210](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/210) owns management review wording. Keep the broader [#219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219) migration open.

## Completed behavior

- Tutor dashboard prioritizes actionable tasks, attendance and current commitments. Pending requirements remain visible; only completed/optional history collapses.
- Attendance preserves drafts on write failure, freezes pending inputs and differentiates a committed write from failed refresh. Refresh Retry must not duplicate the accepted POST. Ratings retain 25 native choices and keyboard behavior.
- Pairing, participation and interview decisions use named confirmations with cancellation without writes. Meeting/schedule failures retain reasons. Approval proposals are reported as queued, not applied. Server permissions, versions, tickets, deadlines and immutable evidence remain authoritative.
- Service Hours comparison keeps six brief columns with local keyboard scrolling. Shared roster patterns retain authorized detail/editor entries in the rightmost Actions column.
- Shared profile/username saves now require deliberate Close, including all-success. Saved sections stay read-only until reopening; failed independent drafts remain mounted and retryable. Each form registers only its own pending write.
- Refresh groups await every owned read before releasing pending protection. Actual matching-query failures are reported after settlement. Academic Reload adopts fresh state only after both academic and policy reads succeed.
- English/Chinese copy and existing contributor, technical and user guides were updated. Other catalog additions use the established English fallback.

## Evidence and limitations

Checks were serial on Windows with Node/npm, Next 16.3.6, TypeScript strict mode, one test/build worker, a 2048 MiB Node heap and one Rayon thread. PostgreSQL and Edge were used for the earlier feature rehearsal. No current application/database/browser runtime was started in the latest automated session.

| Stage                  | Result and exact scope                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source review          | Independent source/automated review accepted `ce59dad`; clean tracked tree at preparation. All 24 original feature TS/TSX files remained unchanged during shared repair integration.                                                                                                                   |
| Affected tests         | 314 passed across 33 files at `055fa1df7f82d1dce292f3214b287249f5469392`.                                                                                                                                                                                                                              |
| Final formatting delta | `ce59dad` changes one test callback's line wrap. Its 9 academic Reload tests and targeted ESLint passed again; these are not 9 additional unique cases.                                                                                                                                                |
| Check/docs/format      | `npm run check`: 0 errors, 17 existing warnings; `npm run docs:check`: 13 tests and 24 documents; final changed-file formatting: 36 files passed; `git diff --check` passed.                                                                                                                           |
| Final build            | One-worker `npm run build` at `ce59dad` passed, including TypeScript. Seven unavailable-database messages occurred during page generation; this is not live-data verification.                                                                                                                         |
| Earlier #222 evidence  | At `d2c7c45`: 119 UI/i18n tests plus 230 backend tests; 91 capture scenarios and 192 PNGs. Active/pending/inactive tutor, EN/ZH, desktop/mobile, Head/Viewer, confirmations, errors, attendance recovery and keyboard states were exercised. These results are historical for the current composition. |
| Not replayed           | Full repository suite and upstream negative-control experiments were not rerun on this branch. Upstream results are not this branch's results.                                                                                                                                                         |
| Current live/report    | Unrun and unapproved. Do not relabel historical screenshots as current. No final HTML report was generated.                                                                                                                                                                                            |

Raw local receipts, browser harnesses, screenshots and report tooling were ignored local files and are **not available in a fresh clone**. Reconstruct focused live checks from the matrix below; regenerate evidence instead of depending on Windows paths. Existing local records should remain intact if work later returns to that machine.

The local foundation's ordinary Next.js server launch was rejected before execution by automatic approval review with only “blocked by policy.” No alternate launcher, port or worktree was tried. Do not retry as a workaround; resolve applicable startup policy first. The last local runtime session released its own lock and stopped its owned processes; caches were retained after a separate cleanup rejection. Shared local heavy work required an explicit coordinator reservation after foundation. Re-establish ownership/coordination on the new host rather than using a stale Windows lock path.

## Cloud checkout and setup

Follow [local development](../local-development.md), [contributor guidance](../contributing.md), the repository [AGENTS.md](../../AGENTS.md), and the bundled Next guide before source changes.

1. Fetch and check out `codex/issue-222-tutor-tasks`; confirm the published tip against the PR. Inspect `git status`, the merge base and foundation dependency state. Preserve other work; do not force-push.
2. Use Node 22 (CI baseline) and the package's pinned npm. Run `npm ci` in a normal standalone checkout. Prisma generation runs during installation. Avoid a shared dependency junction or global configuration changes.
3. Create a private local `.env` from `.env.example`; generate your own stable local auth secret. Configure a loopback PostgreSQL database, canonical local app URL and no external mail delivery. Keep all credentials outside Git and reports.
4. Use a **fresh disposable** UTF-8 database named `shbs_issue222_demo` for browser fixtures. Apply `npm run db:migrate`; with `SHBS_DEMO_SEED=1`, run `npm run db:seed` and `npx tsx --conditions=react-server prisma/verify-demo.ts`. Demo account instructions are in the local-development guide. Never seed an existing real database or import private dumps.
5. Use a different migrated database named `shbs_shipping_test` for destructive integration suites. Do not run them against the browser fixture database.
6. When ordinary startup is permitted and resources are reserved, start one `npm run dev` process on the chosen loopback port. Use one available browser serially; record its version. Original browser evidence used Edge only. Keep auth/storage-state files ignored.
7. Save fresh evidence under ignored `outputs/issue222/` with source SHA, language, viewport, role, request counts, measurements and screenshot hashes. Stop only processes you own.

Set resource limits in the command environment, not globally: `NODE_OPTIONS=--max-old-space-size=2048`, `SHBS_BUILD_CPUS=1`, `RAYON_NUM_THREADS=1`. Use `npm run check`, `npm run docs:check` and `npm run build` when warranted by new changes. Do not spend the checkpoint allowance repeating an unchanged build. A documentation-only publication should validate its new document.

The exact 33-file affected-suite command is below (Bash; unit/component tests need no running database). It is a reproducibility reference, not a claim of execution on the cloud host:

```bash
npm test -- --maxWorkers=1 --no-file-parallelism \
  'src/app/_components/academic-profile.reload.test.tsx' \
  'src/app/_components/academic-profile.test.tsx' \
  'src/app/_components/account-username-editor.test.tsx' \
  'src/app/_components/attendance-correction.pending.test.tsx' \
  'src/app/_components/attendance-correction.test.tsx' \
  'src/app/_components/confirm-dialog.test.tsx' \
  'src/app/_components/legacy-profile-editors.test.tsx' \
  'src/app/_components/people-summary-tables.test.tsx' \
  'src/app/_components/profile-dialog.test.tsx' \
  'src/app/_components/profile-editors.outcomes.test.tsx' \
  'src/app/_components/profile-editors.pending.test.tsx' \
  'src/app/_components/school-departure.test.tsx' \
  'src/app/_components/service-hours-comparison.test.tsx' \
  'src/app/_components/timed-action-dialog.test.tsx' \
  'src/app/_components/tutor-profile-editor.test.tsx' \
  'src/app/_components/ui/modal.test.tsx' \
  'src/app/_components/ui/patterns.test.tsx' \
  'src/app/(admin)/admin/discipline/page.test.tsx' \
  'src/app/(tutor)/_components/announcements-banner.test.tsx' \
  'src/app/(tutor)/_components/attendance-form.test.tsx' \
  'src/app/(tutor)/_components/dashboard-tasks.test.tsx' \
  'src/app/(tutor)/_components/my-interviews.actions.test.tsx' \
  'src/app/(tutor)/_components/my-interviews.test.tsx' \
  'src/app/(tutor)/_components/qualification-requests.test.tsx' \
  'src/app/(tutor)/_components/student-schedule-action.test.tsx' \
  'src/app/(tutor)/_components/subject-willingness.test.tsx' \
  'src/app/(tutor)/_components/tutor-activation.test.tsx' \
  'src/app/(tutor)/_components/tutor-meetings.test.tsx' \
  'src/app/(tutor)/_components/tutor-pairings.test.tsx' \
  'src/app/ui-gallery/recipes.test.tsx' \
  'src/i18n/messages.test.ts' \
  'src/lib/invalidate-refresh.test.ts' \
  'src/lib/tutee-cache.test.ts'
```

After changes, run meaningful affected checks first. For the complete integration suite, point `DATABASE_URL` at the separate migrated `shbs_shipping_test` database and use `npm test -- --maxWorkers=1`; record the actual commit, suite and totals.

## Required next live checks

Use EN and ZH at actual 1440 px and 390 px widths on the real pages and gallery. Include keyboard, role restrictions, long labels/enlarged text and the project's palette matrix. Measure rendered rectangles: header entry/return and language controls 32 px desktop/at least 44 px below 1024; table actions at least 28 px desktop/44 px mobile, with no added stacked gap. Keep actions reachable and tables locally scrollable.

1. **Composed editors:** Account, tutor, tutee and username: saved section beside failed sibling draft; both completion orders for already-admitted work; held/failed refresh; original-version Retry; all-success manual Close; read-only saved-section duplicate exclusion; exact opener focus and nested review. Confirm durable writes and preserve immutable history.
2. **Academic Reload:** Fail/hold the academic and policy reads separately, including cached errors; preserve draft/version/year/conflict until both fresh reads succeed.
3. **Pending consumers:** Willingness, discipline, attendance correction and departure: repeated Escape, focus containment, sibling locking, retained failures, explicit fresh Reload, queued/applied distinction and Viewer restrictions.
4. **Tutor tasks:** Active/pending/inactive ordering, attendance failure and saved-refresh Retry without duplicate POST, all 25 rating targets/keyboard controls, meeting excuses, pairing/participation cancellation, interview decisions and visible pending qualifications.
5. **Separate timed dialog:** `StudentScheduleAction` uses raw-native `TimedActionDialog`. Test repeated Escape during a pending request and failed reason retention explicitly; do not infer its behavior from the shared `NativeDialog` repair.
6. **Rosters/gallery:** Head/Viewer Tutors, Tutees, Users and Service Hours; Viewer Users access remains denied. Check rightmost actions, six-column comparison scrolling and the gallery's independent saved/failed sections. Gallery saves are simulations, not server evidence.

Known harness preparation findings: the earlier local username script still expected automatic closure after success; replace those assertions with saved/read-only/still-open state, deliberate Close and focus return. The gallery script covered only EN desktop and ZH mobile and lacked the independent saved section; expand all four combinations. The upstream prepared composition harness was never run and covered sequential failure-then-success, not every completion ordering or permission state. Adapt/rebuild it for this host and inspect partial-run fixture state before resuming; never silently reseed or reuse an incomplete ledger.

Once current live checks and independent exact-candidate review pass, create the requested self-contained HTML report with current screenshots, source provenance, measured controls and all affected states. Full-resolution screenshots must remain inspectable with zoom and keyboard access. Verify desktop/mobile layout, image viewing, filtering and embedded assets serially. Historical evidence may be labeled separately if available, but cannot replace fresh captures. Keep the report and images ignored; do not attach giant payloads or private data to this checkpoint.
