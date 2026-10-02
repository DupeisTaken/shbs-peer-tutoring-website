# Shared UI integration: cloud continuation

This is an incomplete checkpoint for continued development, not merge or deployment approval. Source and automated checks received partial review; current-composition live verification and the whole HTML report remain held.

## Checkout identity and scope

- Repository: `DupeisTaken/shbs-peer-tutoring-website`.
- Branch: `codex/pr244-current-main-integration`; PR target: `main`.
- Verified application-source HEAD: `d7ca4d7a850f2cb79fb88a087c42bc98da148f84`.
- Observed remote main and merge base: `d3a98dad232902ccf6a6ebe772c6467a095e5eba` (2026-10-02).
- The human-confirmed 2% usage checkpoint authorizes publishing this branch as a draft. This document is a documentation-only descendant of the verified application-source HEAD above. The exact published checkpoint SHA is recorded in the draft PR; use that SHA when cloning. Publication does not lift the live-verification or HTML-report hold.
- Related: [#219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219), [#220](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/220), [#223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223), [#231](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/231), [#232](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/232), [#233](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/233), [#234](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/234), [#235](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/235), [#236](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/236), [#237](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/237). Keep the broader #219 migration tracker open; this checkpoint does not claim every issue complete.
- [Original PR #244](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/244) is open on the different `codex/ui-pattern-rollout` branch, observed at `a63a2c929c945f26b4ce4c70c804bc74f1c14f28`. That commit is an ancestor of this branch. Do not overwrite its branch or silently change its PR.

## Implemented behavior

The branch integrates PR #244's responsive headers, summary tables, shared form/dialog patterns, gallery recipes and feature migrations with the observed main. Shared UI guidance is in [contributing](../contributing.md) and [technical boundaries](../technical-report.md#shared-ui-patterns).

The latest composition repairs independent profile operations:

- Account, tutor, tutee and username saves keep the editor open until deliberate Close, including all-success cases. A committed section is read-only until reopening and cannot replay its write.
- Failed sibling drafts retain their own fields, original expected version and errors after another section succeeds. Background refresh does not replace them.
- Every form registers only its own pending work. Aggregate dialog pending state may disable siblings but must not be registered again. Repeated Escape and nested focus behavior remain guarded while writes or required refreshes are pending.
- `settleRefreshes` waits for all callbacks, including a synchronous throw. `invalidateAndReport` preserves normal waiting for all matching active queries, then reports newly recorded query errors. Enabling `throwOnError` alone is insufficient because another read may remain pending.
- `invalidateTuteeViews` enables reporting only for the scoped profile caller; its other callers retain their error handling. A committed write with failed synchronization shows refresh recovery rather than resubmitting the write.
- Explicit Academic Reload replaces the draft only when both academic and profile-policy reads succeed. Failed/cached-error/thrown reads preserve the draft, captured year and version; the pending guard lasts until both reads settle.

Earlier reviewed repairs also cover discipline/attendance drafts, subject-willingness pending dismissal, username save/reload exclusion and explicit reads that bypass fresh caches. The latest composition changes presentation and refresh ownership without changing server authorization, confirmation tickets or historical evidence ownership.

## Integration order and shared files

Treat this branch as the shared foundation before resolving downstream feature migrations. Coordinate overlapping changes to `src/app/_components/ui/`, `profile-dialog.tsx`, the four profile editors, `academic-profile.tsx`, `src/lib/invalidate-refresh.ts`, `src/lib/tutee-cache.ts`, `src/lib/settle-refreshes.ts`, gallery recipes, roster pages, message catalogs and the contributor/technical guides.

The query helper comes from the reviewed [#206](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/206) dependency commit `0268ffa6dbd27bb6ec0fe7e7d2f8a7d71542e20f`. Its final `invalidate-refresh.ts` blob is `27724c63a36eaaac6597042a34d6c77427986533`. Only the agreed helper composition was imported; this does not integrate or approve #206's separate history/schema/server feature work. Academic Reload repair is already integrated by `f4049eb24535a02b8b05d640a221866b1c8ae631`. Avoid reapplying either repair or replacing the final helper with the earlier swallowed-error/early-rejection variants.

Refresh `origin/main` before later integration and reassess overlaps; the recorded base is a snapshot. Preserve any independent drafts/version semantics when resolving conflicts. Do not merge both overlapping PR lines without deciding their relationship.

## Validation provenance

Local environment: Windows, Node 24.16.0, Next 16.3.6, one worker, bounded serial runs; CI uses Node 22. Database tests used a separate loopback `shbs_shipping_test` database, never the demo database.

| Stage | Result and source |
| --- | --- |
| Initial focused UI/helper tests | 227 passed in 17 files on `b8d3071788439299222f8c272103303fa8d09f61` |
| Affected outcome/helper rerun | 101 passed in 3 files on final source `d7ca4d7` |
| Shared-consumer rerun | 39 passed in 8 files on final source |
| Account-profile, academics, departure database tests | 72 passed in 3 files on final source |
| Distinct session cases | 338 in 28 files: 212 in 14 files on final source; 126 unchanged cases in 14 files retained from the initial run |
| `npm run check` | Passed on final source: type generation, ESLint and TypeScript; 0 errors, 17 inherited warnings |
| `npm run docs:check` | Passed: 24 Markdown documents and 13 tests |
| `SHBS_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=2048 npm run build` | Passed on final source; 68 generated routes |
| Negative controls | Old auto-close: 10 expected failures; early query rejection: 8; swallowed query errors: 12. Runtime files restored exactly before final checks |
| Full suite | Not rerun for this final composition. The older 2,418-case/271-file result belongs to `b987011` and is historical only |
| Current-composition browser/screenshots | Not run; no native browser focus, actual-page mutation or screenshot approval for this composition |
| Final HTML report | Not regenerated; whole-report approval remains held |

The only change from the initial test candidate to final source outside the already-tested runtime fixes was seven test callbacks made explicitly void to satisfy lint. The affected outcome file and both helper tests were rerun. A first negative-control selection matched no cases; the corrected controls produced the failures above. Do not count skipped cases as validation.

Focused commands from the repository root (use one worker):

```bash
npm test -- --maxWorkers=1 src/app/_components/profile-editors.outcomes.test.tsx src/lib/tutee-cache.test.ts src/lib/invalidate-refresh.test.ts
npm test -- --maxWorkers=1 src/app/_components/attendance-correction.pending.test.tsx src/app/_components/attendance-correction.test.tsx src/app/_components/membership-editor.test.tsx src/app/_components/school-departure.test.tsx src/app/_components/subject-availability-navigation.test.ts src/app/_components/subject-availability.test.ts 'src/app/(tutor)/_components/subject-willingness.test.tsx' 'src/app/(admin)/admin/discipline/page.test.tsx'
# With DATABASE_URL set to the separate local shbs_shipping_test database:
npm test -- --maxWorkers=1 src/server/academics.test.ts src/server/account-profile.test.ts src/server/school-departure.test.ts
# Relevant Academic Reload and pending checks when continuing those behaviors:
npm test -- --maxWorkers=1 src/app/_components/academic-profile.reload.test.tsx src/app/_components/academic-profile.test.tsx src/app/_components/profile-editors.pending.test.tsx src/app/_components/account-username-editor.test.tsx
```

## Known blocker and review limits

The original Windows PowerShell invocation set process-scoped local fixture variables and requested hidden `Start-Process` execution of Node running `next dev --hostname 127.0.0.1 --port 3376`, with local output redirection and subsequent PID recording. The tool rejected that concrete invocation before process creation with only `blocked by policy`. The browser call following it was not reached. The owned fixture database was stopped and the exclusive runtime lock released.

Bounded read-only inspection of the corresponding session, runtime logs and history projection did not recover a more specific reason or rule. This does not establish a general ban on servers, Node, Next, a particular port or worktree. No application setting defect was identified. No alternate launcher, retry or permission change was attempted. No further source/product clarification or hidden diagnostic is required from the human.

Any future runtime operation must be permitted by its environment and coordination reservation. Cloud continuation is not authorization to route around a rejected operation. Preserve the existing report-review gate regardless of draft PR publication. Remaining uncertainty is live integration, not a known outstanding source-review defect.

## Minimal cloud continuation

1. After publication, clone the repository and check out `codex/pr244-current-main-integration`. Compare `git rev-parse HEAD` with the draft PR's published SHA. Read `AGENTS.md`, [local development](../local-development.md) and the relevant installed Next guides before edits. Keep the original PR #244 branch separate.
2. Use Node 22 and the repository lockfile; run `npm ci`. Create a private `.env` from `.env.example`, generate a fresh local auth secret, and set local URLs. Obtain credentials from the receiving environment; none is provided here. Disable external email delivery for synthetic rehearsals. Do not copy a local dependency junction, database cluster or cached browser profile.
3. Provision two disposable UTF-8 loopback PostgreSQL databases: `shbs_program_demo` for the website and `shbs_shipping_test` for destructive tests. Follow the local-development database instructions. For the demo only, set `SHBS_DEMO_SEED=1`, run `npm run db:migrate`, run `npm run db:seed` twice, then `npx tsx --conditions=react-server prisma/verify-demo.ts`. Use the existing guide's synthetic accounts; do not import raw local data.
4. Run the focused commands above, `npm run check` and `npm run docs:check`. Run the one-worker build when new code/environment changes justify it. Record results under the actual checkout SHA; do not relabel historical counts as cloud results.
5. Once runtime work is permitted and an exclusive reservation is recorded, start the documented development server on loopback with one browser session. Use the receiving environment's supported browser tooling. The previously prepared local harness is unexecuted and is not part of this portable checkpoint; recreate its cases below using the committed UI/tests and synthetic data.
6. Capture and inspect actual-page and gallery screenshots using the [UI verification matrix](../local-development.md#ui-verification-matrix). Preserve pending/failure captures separately from settled screenshots. Measure affected controls with `getBoundingClientRect()`, including 44 px mobile targets. Check roles, keyboard navigation, long labels and English/Chinese.

### Remaining live cases

Run account identity, tutor identity, tutee identity and username editor cases at 1440 and 390 CSS-pixel widths in English and Chinese: 16 combinations on `/admin/users`, `/admin/tutors` and `/admin/tutees`.

For each, fail an independent academic write and retain its draft/node/version; commit the primary write while holding its matching roster GET; verify saved read-only state, disabled siblings, repeated Escape protection and focus containment. Fail the refresh and verify the refresh warning, retained sibling draft and no replay of the committed POST. Retry the sibling with its original payload and observe the real version conflict. For account cases, fail explicit Academic Reload and confirm that draft/version remain unchanged. Complete Reload successfully, save a fresh academic confirmation, verify both successful sections still require manual Close, then reopen and restore the synthetic primary identity through a fresh versioned UI write.

Snapshot fixture identity/permissions and immutable domain/confirmation records before writes. Verify unchanged historical records, expected new confirmation records and expected version increments after a complete run. If a case fails partway, inspect state before resuming rather than assuming restoration or a fresh baseline. Add real read-only/unauthorized-role and gallery keyboard/long-content checks; unit tests do not substitute for those.

Record commit, role, locale, viewport, interaction, measured bounds and observed result with each capture. Request the required full source/live review only after evidence is concrete. Regenerate the HTML report only after that hold is explicitly lifted. Stop only owned browser/server/database processes and release only the owned reservation on exit. Keep #219 and incomplete feature issues open.

## Evidence portability and next action

Raw local receipts, screenshots, the unexecuted local harness and the large HTML report are deliberately excluded. They will not exist in a fresh clone. This note preserves curated results and reproducible steps, not substitute visual evidence. No credentials, connection strings, participant data, dumps, caches or dependency payloads belong in the checkpoint.

Next action: complete the permitted live matrix and role/gallery evidence, review the composed behavior, then resolve the report gate. The source candidate is ready for that validation; it is not declared finished.
