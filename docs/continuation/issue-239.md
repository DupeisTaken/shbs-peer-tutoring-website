# Issue #239 cloud continuation

## Checkpoint identity and status

- Repository: `DupeisTaken/shbs-peer-tutoring-website`.
- Intended draft PR: main <- `codex/issue-239-confirmation-budget`; relates to issue #239.
- Approved source HEAD: `93b4f8b614a766da31b7b223e7b9e134cce639c8`.
- Validated base: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`, including merged #246.
- Reused original implementation: `a9235af2b044689bc8921c5e3c82b13cf84ee535`, cherry-picked as `731adeb` before the final tests/documentation commit.
- Source, automated validation, live rehearsal and final HTML report all received coordinator approval. No in-scope source finding remains open. No merge, deployment or issue closure was performed.
- This is a portable checkpoint summary. The documentation-only checkpoint advances the branch tip; the draft PR identifies that exact published SHA. Run `git rev-parse HEAD` after checkout to identify it locally. The approved behavior revision above remains the application-test provenance. The human confirmed the conditional publication trigger at 2% remaining on 2 October 2026.

## Completed behavior and affected code

All authenticated current-password checks use `src/server/auth/password-confirmation.ts`: ten admitted checks per stable actor account ID in a sliding fifteen-minute window, reserved before synchronous scrypt. Both valid and invalid checks count; MFA failure and transaction rollback do not refund them. Denied attempts do not extend the window. New sessions, handle changes and rotating target accounts do not create another budget. The helper rejects empty or over-1,024-JavaScript-character confirmations before hashing.

Call paths include account 2FA/password settings, legacy tutor password routes, associated email add/resend/promote/remove, primary email-change requests, privileged role/membership/Head-transfer/deletion confirmations, account combination, and conflicting historical ownership corrections through the email authenticator. Existing sign-in/action/MFA/delivery limits, live authorization, transaction safeguards and successful-operation audits remain separate. No application UI source or schema changes are included.

Primary integration overlaps: `src/server/api/routers/{account,admin,tutor}.ts`, `src/server/auth/{account-emails,email-change,reauth}.ts`, `src/server/combine-accounts.ts`, and the new helper/tests. Documentation changes are in `docs/user-guide.md` and `docs/technical-report.md`. Conditional historical ownership uses the unchanged `src/server/tutee-history.ts` caller. Do not replace concurrent account/history changes wholesale during integration.

## Validation provenance

Fresh validation of the approved source used Windows, Node 24.16.0, Next 16.3.6, Prisma 7.10.0 and Vitest 4.1.11. It used isolated loopback PostgreSQL `shbs_shipping_test`, one test worker, 1,536 MB test heap, 3,072 MB check/build heap, `SHBS_BUILD_CPUS=1`, and `RAYON_NUM_THREADS=1`.

Passed: **170 application tests = 63 focused tests in 8 files + 107 integration tests in 10 files**, plus **13 documentation tests**; static check with zero errors and 18 existing warnings; production build with 67 pages generated; existing migrations, local Prisma generation and diff whitespace check. Existing pg concurrent-query deprecation warnings remain. An initial low-memory check ran out of heap and three test assertions were corrected before the final passing runs.

Exact focused command:

```bash
npm test -- --maxWorkers=1 src/server/auth/password-confirmation.test.ts src/server/auth/password-confirmation-actions.test.ts src/server/auth/credentials.test.ts src/server/auth/index.test.ts src/server/rate-limit.test.ts src/app/_components/two-factor-settings.test.tsx src/app/_components/password-session.test.tsx src/server/api/routers/management-read-models.test.ts
```

Exact integration command, only against the disposable test database:

```bash
npm test -- --maxWorkers=1 src/server/auth/password-confirmation.integration.test.ts src/server/auth/account-emails.test.ts src/server/auth/session-revocation.test.ts src/server/auth/step-up.test.ts src/server/auth/two-factor.test.ts src/server/auth/suspended-access.test.ts src/server/auth/retired-email.test.ts src/server/combine-accounts.test.ts src/server/api/routers/tutee-history.test.ts src/server/api/routers/management-read-models.integration.test.ts
```

The hash-spy suite proves ten verifier calls under 25 concurrent requests. Real-scrypt/database checks establish cutoff, rollback accounting, rename stability and audit privacy. Other regressions cover input limits, whitespace, partial expiry, later MFA rejection, independent sign-in, roles/suspension/retirement, ownership and #246 projections.

**Unrun here:** Node 22 CI, the full current repository suite, Linux container boot/restart, and any retest after future integration. The earlier combined #239/#240 run of 2,209 tests is historical and excluded from 170. Do not describe a future documentation-only checkpoint as a fresh application-suite run.

## Approved live and report evidence

The real localhost rehearsal used synthetic HEAD and VIEWER accounts, PostgreSQL, and headless Edge 154.0.4258.37 at EN/ZH 1440x1000 and 390x900 viewports. It produced **52 original application screenshots** (47 distinct PNG payloads). Four successful confirmations plus six failures exhausted the shared budget. Cross-action denial retained drafts; a fresh session stayed exhausted; another account succeeded; Viewer privileged deletion returned 403 and no Delete controls.

Natural expiry used one unchanged app worker, without clock/store changes or restart. On 2 October 2026, Asia/Shanghai: last initial admitted check completed by **13:30:00.935**; a late correct-password JSON probe was still denied at **13:40:13.045**; recovery began **13:45:30.935**, beyond the conservative fifteen-minute-plus-three-second deadline **13:45:03.935**. Four recovery confirmations succeeded. Recovery 5.30 minutes after the last denial shows denial did not restart the window. Repeated enable writes can be idempotent; this does not prove four independent toggles.

Final snapshots: eight successful HEAD settings audits, one VIEWER settings audit, both users/roles intact, zero verification codes, and no tested secret in audit metadata. Streamed UI RPC errors use HTTP 200; separate JSON probes establish 429/TOO_MANY_REQUESTS. The first two streamed bodies were unreadable by the harness, corroborated by actual UI/audit/request-count/server evidence and never retried.

Final approved HTML SHA-256: `4052932a8cb636b3a03176c9e98f0f41d807d9b48631025d3921a4739bd2c168`. It embeds the 52 PNGs and 19 safe receipts; final report-browser checks cover 320/390/768/1024/1440 widths, doubled text, 55 links, filters, native images/downloads and modal controls. A report-only enlarged-text CSS repair was retested. Final content/static/browser approval was recorded externally on 2 October 2026; the frozen HTML's historical pending-review wording was intentionally retained.

**Cloud availability:** raw local evidence, reports, screenshots and databases are deliberately excluded from Git and will not exist in a fresh clone. These are historical approved results, not downloadable PR attachments or cloud test receipts. Reproduce checks as needed; do not invent screenshots or claim access to missing evidence. Preserve local originals where they already exist.

## Limitations, findings and integration order

- The limiter is process-local, resets on restart and is not shared between replicas. Shared storage is required for distributed enforcement. Existing capacity protection rejects new live keys rather than evicting active budgets.
- Old passwords over 1,024 characters require the documented email recovery path before authenticated settings changes.
- Pre-existing Users & Roles DIV-dialog limitations remain: Tab can leave it, Escape does not dismiss, and Cancel does not restore opener focus. Coordinator confirmed they predate #239 and persist in foundation `25ac025`. Do not claim this server patch fixes them.
- Chinese labels/actions coexist with English raw server errors. No full-localization claim.
- Local synthetic/development-log delivery only: no external SMTP, production, physical-device or replica validation.
- An earlier server-start policy rejection was superseded by explicit human authorization and a successful bounded rehearsal. Later scoped cache deletion was rejected as “blocked by policy”; caches were retained without retry. Both are historical local constraints, not a reason to bypass cloud policy.
- #246 is already in the validated base. #240 is separate and excluded. Shared UI/history/foundation work (#206/#221/#195/#222) is not a prerequisite for this approved server patch; integrate their independently reviewed changes in dependency order and rerun affected suites if shared files conflict. Never import unreviewed sibling work just to satisfy the checkpoint.
- Remaining work is remote CI/current-main integration review, not additional authorized product scope. Keep the PR draft for continuation until reviewed. Any changed source or regenerated HTML needs its own relevant validation/approval; historical report approval is specific to the hashes above.

## Minimal cloud continuation

1. Clone the repository and check out `codex/issue-239-confirmation-budget` after the conditional checkpoint is published. Record `git rev-parse HEAD`, `git merge-base HEAD origin/main`, and `git status --short`. Compare with the approved source above; inspect upstream changes before integrating. Do not force-push or silently replace the branch.
2. Read `AGENTS.md`, `docs/contributing.md`, `docs/local-development.md`, and relevant bundled Next guides after installation. Use Node 22 as the CI baseline and the committed npm lockfile. A normal clone needs no Windows paths or shared-worktree dependency override.
3. Copy `.env.example` to ignored `.env`; generate a fresh private AUTH_SECRET and local database credentials. Configure a loopback PostgreSQL database named exactly `shbs_shipping_test`; never use real program data or a remote production database. See `src/test/database-guard.ts`. Do not copy local credentials, session data or fixture files from the original workstation.
4. Run `npm ci` and `npm run db:migrate`. The install generates Prisma locally. Run the focused and integration commands above serially, then the required `npm run check`, `npm run docs:check` and `npm run build` when source changes justify them. Inspect CI for the exact published SHA, including migration/schema and container gates. Conserve remaining allowance on a documentation-only checkpoint; do not replay builds merely to republish already-tested source.
5. For an independent live reproduction, use a fresh disposable database and the documented seed/bootstrap mechanisms. Create fresh synthetic HEAD and VIEWER fixtures with privately generated secrets, verified synthetic addresses, initial 2FA disabled, and EMAIL_2FA enabled. Keep runtime fixture material ignored. Leave all external mail credentials unset; development delivery logs stay private. Use one bounded loopback dev server/browser at a time, respecting the cloud host's resource coordination.
6. Exercise four successful and six incorrect settings confirmations, then cross-action/session denial and an independent Viewer check. Verify drafts, permissions, account state and audit counts. Wait for natural fifteen-minute expiry without restarting or changing the clock/store, with a late denied probe; capture all four locale/viewport cases. Preserve the HTTP transport and idempotent-write distinctions above. Stop only owned services and release only an owned validation lock.
7. Continue from any real CI/integration finding. Update safe progress notes and the draft PR, preserving source/report provenance and separating new results from historical evidence. Merge, deploy, publish and issue closure need their own authorization.

## Publication hygiene

This checkpoint adds the sanitized note under `docs/continuation/issue-239.md` and a documentation-hub link. Run `npm run docs:check` when updating it. This temporary continuation document is explicitly requested despite the normal preference against per-fix diaries. No PR template exists in the inspected checkout; the draft describes the problem/result, validation and remaining work, linking issue #239 and relevant dependencies.

Do not add `.env`, private fixture data, identifiers/passwords from the rehearsal, raw receipts/database dumps, caches, dependencies, screenshots or the large HTML report. Publication URL, exact SHA, branch and draft state are recorded in the PR and in ignored local publication metadata. Keep the PR draft for the requested cloud continuation.
