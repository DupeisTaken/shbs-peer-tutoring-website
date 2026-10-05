# Continue issue #221: navigation and form recovery

This is an incomplete-work checkpoint for [issue #221](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/221). Keep the PR draft. Current-source automation passed; current live verification, whole-change review and HTML approval remain outstanding. Do not close the issue from this checkpoint.

## Exact source and integration

- Repository: `DupeisTaken/shbs-peer-tutoring-website`.
- Branch: `codex/issue-221-navigation-forms`.
- Reviewed and tested application source: `5348016ec273aa2a850a358ccbdd18235c2ab0b4` (2026-10-02).
- Main and merge base at preparation: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`. Refresh remote state before integrating; do not silently rebase a reviewed candidate.
- Previous navigation/CAPTCHA source: `b43a239b4900b9c89c4f1ee0e870df8537a58fac`.
- Foundation baseline: `ea063372d12b3d62e5b0e6ea143e2afa00fc7d4e`. The final 28-file composition applies the reviewed foundation delta `25ac0257020dd2955a00c96ed685c0c38c3ac77d..d7ca4d7a850f2cb79fb88a087c42bc98da148f84`: 16 exact foundation blobs and 12 branch-specific merges. All 12 protected navigation/CAPTCHA/portal/patrol/modal source blobs remained unchanged from `b43a239`.
- Integrate shared foundation first, then reconcile this branch's navigation/forms composition. This branch already contains shared work; do not blindly cherry-pick foundation again. Overlaps include profile editors, refresh helpers, shared dialogs/form sections, gallery code/tests, eight message catalogs, contributor guidance and the technical guide. Preserve both navigation recipes and saved/failed-section regressions. Compare other consumer branches before resolving overlaps.
- Related shared rollout: [#219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219). Keep broader migration scope open. Shared interaction dependencies are described in `docs/contributing.md` and `docs/technical-report.md`.
- A later checkpoint commit may add this document and its hub link only. The PR head identifies that checkpoint; the SHA above identifies the application source actually tested.

## Implemented behavior

- Native route navigation stays distinct from manually activated local tabs. Public/signup headers retain the responsive hierarchy; signup fields are grouped. Registration steps focus their headings and preserve appropriate Back/Edit drafts. Reply contexts retain independent recipients/drafts and failure recovery.
- Actual CAPTCHA Verify/Cancel controls remain operable outside the disabled draft fieldset for tutee signup and Viewer initial-send, code-resend and password-resend stages. Tests exercise the real hook and native disabled behavior.
- Account, tutor and tutee profile saves, plus HEAD username saves, keep the editor open until deliberate Close. Saved sections become read-only. Independent failed drafts, errors and version snapshots remain mounted. Accepted writes are not replayed after synchronization failure.
- `settleRefreshes` owns every refresh until it settles, including synchronous throws. `invalidateAndReport` waits for matching queries and reports newly recorded read failures even with normal `throwOnError: false`; old inactive cached errors do not create a false failure. Tutee cache error reporting is opt-in for the committed profile path.
- Academic conflict Reload replaces the snapshot only after academic and policy reads both succeed. Cached failures and thrown reads preserve the draft/version. `FormSection` keeps disabled state independent from busy state, with `disabled=false` by default.
- Shared patterns, gallery examples, tests and all eight catalogs are updated. No backend/schema, authorization, approval-ticket or immutable-evidence changes were introduced by the final composition. Avoid broadening unrelated Users & Roles dialogs.

## Verification ledger

| Stage | Evidence and limits |
| --- | --- |
| Current focused application tests | **433 passed in 47 files**, zero failures/skips at `5348016`; includes 142 prepared cases in seven files and 291 retained affected cases. This is not a full-suite run. Exact file selection is below. |
| Current strict checks | Next type generation, ESLint and `tsc --noEmit` passed. ESLint retained 17 verified baseline warnings, zero errors. |
| Current documentation | 24 documents and four issue forms checked; 13 documentation tests passed. |
| Current build | One successful Turbopack build, one worker, 68 prerender attempts. Seven expected program-feature database diagnostics arose from an intentionally unreachable loopback database URL. No real database or app server was started for this run. |
| Independent review | Source and automation receipts independently reviewed: 94 changed-source entries, 28 composed paths, 16 exact foundation blobs, 12 merges, 12 protected blobs, eight catalogs and 34 raw receipts. Live behavior and HTML were not approved. |
| Current real PostgreSQL suites | **23 cases unrun on this candidate:** 19 in `src/server/captcha/captcha.test.ts`, four in `src/server/auth/viewer-signup.test.ts`. One Aliyun runtime case and six signup-ingress cases are included in the 433, with the SDK network method mocked where applicable. |
| Historical only | `b43a239`: 159 UI cases across 17 files, a seven-case final syntax rerun, 24 real-server cases across three files, 64 live cases and 260 native PNGs. Seven CAPTCHA negative controls failed against the old source as intended. These are not current-composition screenshots or database proof. Older full-suite results are also historical. |
| Warnings | Existing translation focus/React act warning, jsdom navigation limitation and expected signup-throttled logging were retained; none failed an assertion. |
| Cleanup | All seven validation phases exited successfully; all owned processes exited naturally, no owned runtime remained and the owned heavy lock was released. Caches and historical evidence were retained. |

Raw local `outputs/` and `.validation/` receipts, browser harnesses and images are intentionally absent from a cloud clone. They were not deleted or rewritten. Historical CAPTCHA runs used local SDK/provider-network fixtures; they do not establish paid-provider behavior. The reviewed automated handoff SHA-256 is `cb8b21cc735d507955a9533f3c6d0dc9eb2b0c3990bff97615823bcb27220a10` (provenance only; the private local artifact is not a cloud dependency).

## Blocker and report status

Ordinary local Next startup in the foundation worktree was rejected before execution at **2026-10-02 09:08:26 UTC**, with `CreateProcess ... rejected: blocked by policy`. Read-only investigation found no named denial rule or evidence that `AGENTS.md` caused it. The recorded turn used `approval_policy: never`, reviewer `user`, and `danger-full-access`. Calling this specifically Auto-review was an earlier overstatement: the responsible subsystem remains unknown. A later diagnostic-only JSON write received the same generic rejection. Do not retry a rejected operation using another tool, path or launcher, or weaken settings to work around it.

No current app/database/browser reservation is active on the local machine. Foundation remains first in the local heavy-work order; wait for a fresh explicit reservation and a permitted startup there. A cloud environment should follow its own approved execution and preview path; a fresh checkout does not imply that a denial may be bypassed.

Current live/screenshots, complete review and **HTML approval are held**. No current HTML report has been created. Finish current verification and return an immutable source/evidence handoff for review before creating the requested HTML report. Preserve older reports and capture evidence in a new run directory.

## Minimal cloud continuation

1. Fetch and check out the PR branch normally. Record `git rev-parse HEAD`, `git status --short` and the remote main/merge base. Confirm application changes relative to `5348016` before reusing the ledger. Read `AGENTS.md`, `docs/contributing.md`, `docs/technical-report.md` and `docs/local-development.md`. No subagents are authorized.
2. Use Node 22 (CI baseline) and project-local dependencies with `npm ci`; postinstall generates Prisma. On this Windows run Node's heap was limited to 2048 MiB, Vitest to one worker, `RAYON_NUM_THREADS=1` and `SHBS_BUILD_CPUS=1`. In a fresh clone do not copy a Windows dependency junction, absolute browser path or `SHBS_WORKSPACE_ROOT` override. Read the installed `node_modules/next/dist/docs/` before changing Next behavior.
3. Copy `.env.example` to an ignored `.env`; supply a freshly generated local `AUTH_SECRET` and an owned loopback PostgreSQL database URL. Follow the local-development guide for required variables. Never copy source-machine secrets, authentication state or database dumps. Use synthetic accounts and local email capture; obtain demo login details from the guide rather than publishing them in a handoff.
4. For browser work use a new demo database named `shbs_program_demo`, enable `SHBS_DEMO_SEED=1`, run `npm run db:migrate`, run `npm run db:seed` twice to check idempotence, then run `npx tsx --conditions=react-server prisma/verify-demo.ts`. Seed guards reject nonlocal/non-demo/test environments and production. Do not run this seed against an existing real installation.
5. For database tests use a **separate disposable** loopback database named `shbs_shipping_test`, migrate it with the same test `DATABASE_URL`, then run the two outstanding files serially. Test fixtures truncate/reset data; never share this database with the browser demo or production. Do not assume setup defaults point to an available safe database.
6. Once permitted, run the ordinary `npm run dev` path and use the environment's approved browser/preview forwarding. Keep app, browser and tests serial and bounded. Use an available approved browser runtime; the old local harnesses depended on Windows-specific paths and are not in this clone. Recreate the targeted harness from the matrix below in a new ignored output directory.
7. Record commit, fixture boundaries, commands, locale, role, actual viewport, measured control bounds, native PNGs and hashes. Inspect screenshots at original dimensions. Do not substitute gallery-only captures for real-page permissions, pending writes, persistence or recovery.
8. Restore synthetic fixture changes, provider mocks and CAPTCHA configuration; stop only owned services and release only an owned validation lock. Inspect dependency/database ownership before cleanup. Do not retry the previously rejected recursive cache deletion. Re-review actual fixes and update verification scope before requesting HTML approval.

The outstanding real-database command, after explicitly selecting and migrating the disposable test database, is:

```bash
npx vitest run src/server/captcha/captcha.test.ts src/server/auth/viewer-signup.test.ts --maxWorkers=1 --no-file-parallelism
```

Use `npm run check`, `npm run docs:check` and `npm run build` for changed-source validation as needed. Existing passing builds need not be repeated merely to publish a document checkpoint. Do not claim the deliberately disconnected build proves working database configuration.

## Remaining live matrix

Use **English/Chinese at 1440 x 1000 and 390 x 844** on affected real pages and `/ui-gallery`; add focused 375/768/1024 header widths, long labels and enlarged text. Desktop workspace/language controls must measure 32 px at `lg` (1024 px), interactive mobile controls at least 44 px. Keep one instance of each header utility, clear mobile rows and reachable actions. Check keyboard focus, role restrictions and relevant accent states; layout checks alone do not measure contrast.

- Navigation/forms: native student links, browser Back/Forward and `aria-current`; manual tabs, draft lifetime and access revocation; grouped signup configuration/native validation/background recovery; invitation-bound email verification and Back/Edit preservation; Viewer proof invalidation and resend/password preservation; independent reply recipients, cancel/opener focus, failure retry identity and pending dismissal.
- Saved sections on actual pages: account `/admin/users` (`admin.updateAccountProfile`), tutor `/admin/tutors` (`admin.updateTutor`), tutee `/admin/tutees` (`admin.updateTutee`), HEAD username `/admin/users` (`admin.updateAccountUsername`). Cover independent sibling writes and both completion orders: parent success/sibling failure, parent failure/sibling success, both success, and committed parent with a failed/held refresh. Assert manual Close, retained failed field/error/version, original Retry payload, read-only saved section and no replayed POST. Hold one matching read after another fails: busy/keyboard guards must remain until every read settles. Verify persistence and restore original synthetic identity data.
- Explicit Reload: academic and policy reads must both succeed before adopting a snapshot. Exercise each failure, cached failures, thrown reads, real conflicts and version retention. Include identity/username read failure/success and exclusion of concurrent save. Read-only refresh must not write. Check repeated Escape/Tab and exact opener restoration, plus idle Close after settlement.
- Gallery: saved read-only section next to a mounted failed draft, with disabled state independent from pending state. Restricted roles must not gain editing or private data access.
- CAPTCHA: real hook/native controls for tutee signup, Viewer initial send, code resend and password resend. Verify enabled keyboard/touch Verify and Cancel outside disabled fieldsets, Cancel/reject/retry/accept, failed-feature draft retention, one feature POST per grant and duplicate-callback suppression. Use explicitly identified local SDK/network fixtures for provider failure/success; verify actual app grant issuance/consumption, persistence and spent-grant replay rejection with the demo database. Do not claim real Aliyun UI or paid-provider verification.
- Recreated harnesses must assert **no automatic dismissal after a successful save**. Historical username scripts asserted auto-close and require adaptation; old script output locations must never be reused or overwritten. Capture full-page context and focused pending/focus states in the new run directory.

## Exact current focused test selection

The following command reproduces the 47-file selection. It is a focused regression run, not all repository tests. Use bounded process-local settings and save output under a fresh ignored run directory; do not run it concurrently with a build/browser session.

```bash
npx vitest run \
  src/app/_components/academic-profile.reload.test.tsx \
  src/app/_components/academic-profile.test.tsx \
  src/app/_components/account-username-editor.test.tsx \
  src/app/_components/admin-mobile-navigation.test.tsx \
  src/app/_components/admin-summary-tables.test.tsx \
  src/app/_components/attendance-correction.pending.test.tsx \
  src/app/_components/attendance-correction.test.tsx \
  src/app/_components/focus-visible-context.test.ts \
  src/app/_components/landing-privacy.test.tsx \
  src/app/_components/legacy-profile-editors.test.tsx \
  src/app/_components/message-admin.test.tsx \
  src/app/_components/message-inbox.test.tsx \
  src/app/_components/profile-dialog.test.tsx \
  src/app/_components/profile-editors.outcomes.test.tsx \
  src/app/_components/profile-editors.pending.test.tsx \
  src/app/_components/public-header.test.tsx \
  src/app/_components/school-departure.test.tsx \
  src/app/_components/signup-captcha-forms.test.tsx \
  src/app/_components/signup-captcha.test.tsx \
  src/app/_components/signup-error.test.tsx \
  src/app/_components/translation-editor.test.tsx \
  src/app/_components/tutor-profile-editor.test.tsx \
  src/app/_components/ui/modal.test.tsx \
  src/app/_components/ui/patterns.test.tsx \
  src/app/_components/ui/recipes.test.tsx \
  src/app/_components/workflow-shell.test.tsx \
  'src/app/(admin)/admin/discipline/page.test.tsx' \
  'src/app/(tutor)/_components/subject-willingness.test.tsx' \
  src/app/crew-signup/crew-signup-form.test.tsx \
  src/app/history/claim/page.test.tsx \
  src/app/history/page.test.tsx \
  src/app/register/signup-completion.test.tsx \
  src/app/register/signup-navigation.test.tsx \
  src/app/reset-password/page.test.tsx \
  src/app/signup/period-label.test.tsx \
  src/app/signup/signup-form.test.tsx \
  src/app/signup/survey-flow.test.tsx \
  src/app/student/tutee-workspace.test.tsx \
  src/app/tutor-signup/tutor-signup-form.test.tsx \
  src/app/ui-gallery/gallery.test.tsx \
  src/app/ui-gallery/page.test.tsx \
  src/app/ui-gallery/recipes.test.tsx \
  src/lib/invalidate-refresh.test.ts \
  src/lib/navigation-integrity.test.ts \
  src/lib/tutee-cache.test.ts \
  src/server/captcha/aliyun-runtime.test.ts \
  src/server/signup-ingress.test.ts \
  --maxWorkers=1 --no-file-parallelism
```
