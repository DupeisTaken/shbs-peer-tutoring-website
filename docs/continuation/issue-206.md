# Issue 206 cloud continuation

## Checkpoint identity

- Repository: `DupeisTaken/shbs-peer-tutoring-website`; target branch: `main`.
- Working branch: `codex/issue-206-alumni-history`.
- Approved implementation HEAD: `0268ffa6dbd27bb6ec0fe7e7d2f8a7d71542e20f`.
- Validated base: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`.
- Source/live composition and the final self-contained HTML report passed independent review on 2 October 2026. No unresolved issue-206 review finding remains.
- The reviewed HTML SHA-256 is `7da6b57295ba7cfd9c0559a7102d828579fc772d85e0bd943c4858486f463a4b`. The HTML, screenshots and raw receipts remain local and are deliberately not included in the portable checkpoint.
- A publication may add this continuation document after the implementation HEAD. The draft PR and publication metadata identify that exact published commit; documentation-only additions do not imply a new application validation run.

## Completed behavior and boundaries

An Admin or Head reviews one accountless historical tutee record, records identity evidence and sends an invitation to an accessible email. A recipient without a login verifies the separately emailed code, creates a neutral verified STUDENT login, signs in, and explicitly claims the reviewed history. Existing accounts use their verified primary/secondary email or account recovery. Sending, opening or scanning an invitation does not claim ownership.

Setup grants no current enrollment, tutee/tutor membership, crew, management, translation or general observer access, and creates no current academic profile or participation consent. Tutor access starts revoked. Personal history reads recheck explicit ownership on the server. Retained linked tutor sessions, stored hours, meetings and amendments remain readable without restoring revoked participation or observer access. Missing tutor identities require staff review; there is no new tutor-only self-service claim route.

Invitations expire after seven days. Email codes last 15 minutes, allow six incorrect attempts and have a one-minute resend cooldown. Each step rechecks recipient, record revision, issuer eligibility, expiry/cancellation and competing ownership. Concurrent completion uses the shared email registry and namespace lock. Successful retries reuse the completion receipt without resetting a password; audit failure rolls back credential/email ownership writes. Cancellation invalidates outstanding setup/claim but does not delete an existing login or revoke completed ownership. Existing Head-only account-combination conflict/departure blockers remain intact.

Profile, history and current-academic sections own their pending work independently and consume combined dialog busy state. Direct duplicate submissions and repeated Escape are guarded through required refreshes. A committed profile becomes read-only; successful work never auto-dismisses a failed sibling draft. Grade, reason, historical evidence and original versions survive failures. Manual Close is available after settlement and can deliberately discard remaining unsaved drafts.

Academic Discard Draft and Reload requires both academic and policy reads to succeed with data. Cached error results, rejected reads and synchronous throws preserve the mounted draft and conflict. `settleRefreshes` waits for every callback. `invalidateAndReport` retains React Query's all-read waiting and reports new scoped errors afterward; `throwOnError: true` alone can release too early when multiple active keys match one procedure. A committed write with failed refresh stays read-only and displays a refresh warning.

Original historical grades/periods and stored activity remain separate from current account academics. Linking ownership does not overwrite current enrollment, fabricate consent or rewrite retained sessions, attendance, meetings, amendments or departure state.

## Source map and integration order

- Workflow/permissions: `src/server/history-account-setup.ts`, `src/server/tutee-history.ts`, `src/server/personal-tutor-history.ts`, `src/server/api/routers/tutee-history.ts`.
- Recipient UI: `src/app/history/claim/`, `src/app/history/page.tsx`, `src/app/history/personal-tutor-history.tsx` and home routing.
- Editing: `src/app/_components/tutee-editor.tsx`, `tutee-history.tsx`, `academic-profile.tsx`, `profile-dialog.tsx`, `ui/modal.tsx`.
- Refresh: `src/lib/settle-refreshes.ts`, `invalidate-refresh.ts`, `tutee-cache.ts`.
- Additive migration: `prisma/migrations/20261002080000_history_account_setup/migration.sql`. Apply the full chain; do not substitute `db push` or delete migrations.
- Maintained guides: `docs/historical-participant-transition.md`, `docs/local-development.md`, `docs/technical-report.md`, `docs/user-guide.md`, `docs/contributing.md`. Follow `AGENTS.md` and bundled Next documentation before further framework changes.

Shared-source overlap exists with PR #244's dialog/editor foundation, #195 historical academics, #221 public forms and #222 tutor actions. Reconcile shared dialog/refresh mechanics before retesting each downstream consumer. Preserve their domain permissions/layouts and the historical/current academic split. Do not blindly copy whole unmerged branches or reuse passing evidence for a different composition.

Approved independent Academic source is `f0ce1a0764e7bcd34682ac54eed4757628e30aba`; its three source/test blobs remain unchanged at the final issue-206 head. Shared native-dialog mechanics were isolated in `cc3009ad15c1832f4bda5c8320af7372ce26d96f`. The foundation already has the identical `settleRefreshes` helper; avoid duplicate implementations. Keep final `invalidateAndReport` semantics when integrating. Foundation's separately rejected application-server startup and incomplete live proof are not resolved by issue-206 approval.

## Validation provenance

Counts are overlapping runs, not additive unique coverage.

| Stage | Recorded result and precise scope |
| --- | --- |
| Original feature, before final dialog integration/copy correction | 2,251 tests in 254 files; 56 migrations applied and empty schema diff. Later scoped runs: 142 initial, 76 after dialog integration, 75 after final UI copy correction. This was not a final-head full-suite run. |
| Profile/history guard, `79eb078` | 81 tests; EN/ZH 1440/390 native/fallback pending, failure/retry, repeated Escape and focus checks. Parent success behavior was subsequently superseded. |
| Linked academic ownership, `01565cd` | 111 tests, then 39 after equivalent lint refinement; four live cases/24 screenshots. Failed Reload was corrected afterward. |
| Academic Reload, `f0ce1a0` | 35 scoped entries including nine real QueryClient regressions; eight fail on old source. Four live cases/20 PNGs executed inside `6a751413` with identical academic blobs and zero parent POSTs. The old parent close behavior was rejected. |
| Final parent behavior, `05ff5b2` | 132 affected tests/12 files. Ten controls fail on old auto-close `6a751413`; one deeper two-observer held-read control fails on prepared `e2f0dfd`. |
| Final composition, `0268ffa` | 39 affected tests rerun after structural typing/error normalization; strict check zero errors/18 inherited warnings; 13 documentation tests/24 documents; one-worker production build/67 generated pages. |
| Final application browser | Ten serial Edge cases, EN/ZH at 1440/390, 36 native PNGs, zero page errors. Real conflicts, original-version retries, fresh history preview, manual Close and committed refresh failures. Operation orders were sequential in the browser; overlapping completion orders were component tests. HTTP 200 streaming can contain tRPC application conflicts. |
| Durable state | Original eight archive families unchanged. Final run: ten profile commits, four academic confirmations, four successful links leaving one ownership row, four synthetic concurrent revision bumps; no duplicate profile writes/implicit accounts/invitations; original historical periods/grades/activity/departures preserved. |
| Approved HTML | 108 native PNGs with stage provenance, 14 allowlisted domain projections, no sensitive values. Five widths (320/390/768/1024/1440), 200% text, keyboard, downloads, full-size viewer and image decoding passed; zero console/page errors or external requests. |

Local validation used Windows, Node 24.16.0, Next 16.3.6, Prisma 7.10, Vitest 4.1.11, isolated loopback PostgreSQL and installed headless Edge. CI's Node baseline is 22. No fresh cloud/CI/other-engine run is implied. All owned application/report servers, browsers and databases stopped; their ports and owned exclusive lock were released. Inactive caches were retained after an automatic cleanup rejection; no bypass was attempted.

## Minimal fresh cloud setup and verification

After the conditional draft checkpoint exists:

```bash
git fetch origin
git switch --track origin/codex/issue-206-alumni-history
git rev-parse HEAD
npm ci
cp .env.example .env
```

Use Node 22 and the lockfile. If already on the branch, inspect status before switching. Generate fresh local secrets; never copy old credentials or commit `.env`. Follow `docs/local-development.md` to create a fresh loopback PostgreSQL database named `shbs_shipping_test` for integration tests. Set `DATABASE_URL` only to that disposable database; tests reset fixtures. Configure local `AUTH_URL`/secret. Use development-only email capture with real outbound mail disabled; keep tokens/codes in ignored logs. A fresh standalone clone needs no Windows dependency junction or `SHBS_WORKSPACE_ROOT` override.

```bash
npm run db:migrate
npx prisma generate
npm run check
npm run docs:check
npm test -- --maxWorkers=1 src/server/history-account-setup.test.ts src/server/api/routers/tutee-history.test.ts src/app/history/claim/actions.test.ts src/app/history/claim/history-account-setup.test.tsx src/app/history/claim/page.test.tsx src/app/history/home-routing.test.ts
npm test -- --maxWorkers=1 src/app/_components/tutee-editor.pending.test.tsx src/app/_components/academic-profile.reload.test.tsx src/app/_components/academic-profile.test.tsx src/app/_components/tutee-history.test.tsx src/app/_components/profile-dialog.test.tsx src/app/_components/ui/modal.test.tsx src/lib/tutee-cache.test.ts src/lib/invalidate-refresh.test.ts src/i18n/messages.test.ts
SHBS_BUILD_CPUS=1 RAYON_NUM_THREADS=1 NODE_OPTIONS=--max-old-space-size=2048 npm run build
```

The commands above are continuation instructions, not recorded cloud results. Expand to the full relevant suite after resolving actual integration changes; do not claim old totals as new runs. The repository has no PR template at this checkpoint; use a concise problem/behavior/validation/limits description, link #206 and the dependencies, and keep the PR draft. Documentation changes require `npm run docs:check`; a committed continuation document should be linked from `docs/README.md`.

For a browser rehearsal, use a separate fresh local demo/test database and the guarded seed procedure in `docs/local-development.md`. The committed `src/server/history-account-setup.test.ts` and `src/server/api/routers/tutee-history.test.ts` are the canonical minimal-fixture examples: accountless historical tutee, verified Admin/Head, and an explicitly linked revoked tutor with sessions/meeting/amendment evidence. If adapting a local seed helper, assert loopback and the permitted demo/test database name. Never seed real data. Existing ignored local scripts and exact snapshot IDs are unavailable in a fresh clone.

Start one `npm run dev -- --hostname 127.0.0.1` server and one installed headless browser. Verify invitation/status/cancel; wrong-account switching; separate email proof, credential setup and explicit claim; personal tutee/tutor history and denied management access. In Edit Profile, verify cross-section pending protection, real stale conflicts, retained draft/version, explicit Reload failure/recovery, fresh link preview and manual Close. Hold/fail actual reads to check committed read-only/no replay behavior. Capture EN/ZH desktop/mobile screenshots and compare durable domain rows before/after. If browsers are unavailable, record the exact missing runtime; do not claim live coverage. Stop only owned processes afterward.

## Remaining work and limits

1. Continue from the draft PR's exact published SHA, fetch current main and inspect overlaps before any integration; no merge or force-push is authorized by this checkpoint.
2. Reconcile the shared-source consumers in dependency order and validate any changed composition. There are no outstanding issue-206 source/live/report findings on the approved head.
3. Obtain exact-head GitHub CI results and any newly needed cloud checks. Actual SMTP, production deployment, Docker boot/restart and original archive ZIP reconciliation were not exercised locally. The original archive ZIP was unavailable.
4. Before a separately authorized deployment, apply the complete migration chain and review operational email/privacy configuration. Six non-English/Chinese catalogs use English fallback for new text.
5. Keep report approval scoped to the frozen reviewed artifact. Raw `.validation/`, `outputs/`, database records, credential hashes, auth state, caches, dependencies and large image/report payloads must remain uncommitted. One historical handoff referenced a missing final-changed-lint log; that limitation is disclosed, and final strict/build receipts existed locally.

This checkpoint authorizes preserving work as a draft only. It does not authorize publishing a site, merging, deploying or closing the issue.
