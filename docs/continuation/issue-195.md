# Issue 195: portable continuation checkpoint

This is incomplete work for [issue 195](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/195). Source and focused automated review passed. Current-composition live verification and the final HTML report have **not** been approved. Keep the PR in draft; do not merge, deploy or close the issue from this checkpoint.

## Exact source and integration

- Repository: `DupeisTaken/shbs-peer-tutoring-website`.
- Branch: `codex/issue-195-historical-corrections`.
- Reviewed application head: `28dc7645354d132e3cae6d9f3978dce5346f2604`.
- Original base and last observed `origin/main`: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`. Refresh remote refs before integrating; this is not a claim that main will stay there.
- Initial historical feature: `ba24f44d041ef2c6fd0ce51e92ed0579d5679e82`.
- Final narrow composition: `64dd2881cd09843c446b051037a1817616777406`; subsequent `2d28fd439df13b722d279a11fad4f3d0a99c7867` and `28dc764` repair test selectors/types and the existing Transferred status label.
- Any later documentation-only checkpoint commit is a descendant of the reviewed application head. The PR and publication metadata identify its exact published SHA; do not mistake that document change for newly tested application behavior.

Shared dependencies were imported narrowly, with local adaptations. [PR 244](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/244) owns the shared UI foundation; [issue 206](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/206) owns historical account access and reviewed Academic Reload work. Coordinate overlapping history/tutee/navigation/tutor surfaces with [issue 221](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/221) and [issue 222](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/222). These links do not imply those branches are merged.

Integrate shared NativeDialog/refresh behavior first, then approved Academic/history child guards, then this composition. Do not cherry-pick the entire foundation over this branch. Preserve this branch's layouts, historical grade exclusion and domain implementation when resolving shared-file conflicts.

Key immutable dependencies:

| Dependency | Reference |
| --- | --- |
| Reviewed foundation | `d7ca4d7a850f2cb79fb88a087c42bc98da148f84` |
| Scoped refresh-error helper blob | `27724c63a36eaaac6597042a34d6c77427986533` |
| All-settled helper blob | `fb1aa58ce1eba2fdbd0d659847d558ef1ce2de7d` |
| Tutee invalidation helper blob | `182c361ea31db6920d2c5bf61dc2e06d9b60a385` |
| Approved Academic Reload source | `f0ce1a0764e7bcd34682ac54eed4757628e30aba` |
| Preserved Academic Reload test blob | `49eba0f40e301beaa9d2c92a3ac8f53d90948623` |

## Completed behavior and boundaries

- Staff can correct historical academic evidence through the website or CSV while preserving originals, original enrollment periods and every append-only correction revision. Stable record IDs identify imports; participant names do not establish identity.
- Signed previews bind the exact batch. Server transactions recheck current permissions, ownership, versions and fingerprints; a stale or invalid row rejects the entire batch. Head/Admin writes apply directly; Coordinator writes queue exact proposals for approval.
- Current account academics, account creation and ownership remain independent of historical corrections. Historical/corrected tutee contact saves omit grade and graduation fields. Program Records archives original evidence and excludes correction overlays; complete backups are needed to retain correction history.
- Website and CSV drafts remain independent through dismissal, errors and queued proposals.
- Actual child writes register their own pending work with NativeDialog. Repeated Escape cannot dismiss owned work. Membership/departure proposals do not locally grant access or departure.
- Account, username, tutor and tutee saves leave the editor open for deliberate Close. Committed sections are read-only until reopening; failed sibling drafts and original versions remain mounted. Refresh failures cannot replay a successful write.
- Required refresh groups and matching reads settle before newly observed errors are reported. Name/username Reload and identity preview remain dismissible reads; explicit Academic Reload intentionally guards both required reads and adopts data only after both succeed.
- English/Chinese saved and refresh-warning copy is present, with existing fallback policy in the other locales. The missing existing tutor Transferred label was added using each locale's existing departure wording.

Server and Prisma sources at `28dc764` are unchanged since the original `ba24f44` feature. Preserve approval, audit, version, CSV, HMAC and ownership boundaries rather than modifying them to make a browser fixture pass.

## Validation provenance

| Stage | Result and scope |
| --- | --- |
| Initial historical feature (`ba24f44`) | Earlier isolated database/schema/RPC/build/browser verification passed. Those results and 21 local screenshots are historical provenance only, not current-composition proof. |
| Current focused regressions | **212 distinct passing cases in 20 files**, composed of 83 exact-final cases, 14 unchanged cases from the repaired run and 115 unchanged cases from the initial focused run. This was not one final 212-case invocation or a full-suite rerun. |
| Actual child composition | 64 lifecycle cases plus 2 EN/ZH rendered status-label cases. The eight specifically inventoried suites now contain 121 passing cases. |
| Negative controls | Eight cases with the old `b3a105b816738de232f933fc6f95043ad3d2f484` account/tutee parents failed explicitly because parent completion discarded an independent failed draft. Exact parent source was restored. |
| Strict checks | Next type generation, ESLint and TypeScript passed on `28dc764`: zero errors, 20 warnings. Eighteen are prior baseline warnings; two concern the preserved departure/history completion effects. No suppression was added. |
| Documentation | 24 Markdown documents checked; 13 documentation tests passed. |
| Production build | Next 16.3.6, one worker, 2048 MiB heap: 68/68 static-page steps completed. Seven unavailable-local-database messages occurred because the database stayed stopped. This does not prove DB-backed runtime behavior. |
| Current live/browser | **Not run.** No current application screenshots, durable live outcome assertions or cross-browser claim. |
| Final HTML | **Not created or approved.** Whole-composition review is still required. |

The final local automated session used Windows, Node 24.16.0, npm-locked dependencies, serial phases, `--maxWorkers=1`, `NODE_OPTIONS=--max-old-space-size=2048`, `SHBS_BUILD_CPUS=1` and `RAYON_NUM_THREADS=1`. Owned check/build processes exited and the owned exclusive lock was released. No app server, database or browser was started during that session.

Initial failures were corrected rather than hidden: ten Chinese field-label selectors matched multiple name fields; test mocks had eleven lint errors and two type errors; the existing tutor status option lacked a translation. All affected suites were rerun after the respective repairs.

Raw local `.validation/` and `outputs/` artifacts are intentionally absent from a fresh clone. This document is a curated summary, not a replacement for those raw receipts. Generate new source-bound evidence in the new environment and distinguish it from the historical results above.

## Cloud checkout and safe setup

Read repository [agent guidance](../../AGENTS.md), [local setup](../local-development.md), [contributor guidance](../contributing.md) and [historical transition rules](../historical-participant-transition.md). Read the relevant bundled Next guide before changing Next code.

1. Fetch and check out `codex/issue-195-historical-corrections` from the draft PR. Record `git rev-parse HEAD`, verify ancestry from the reviewed application head and inspect any newer changes before continuing.
2. Use the lockfile with `npm ci`; do not copy a Windows dependency junction or generated cache. CI documents Node 22; the recorded local run used Node 24.16.0. Generate Prisma with the installed package if installation did not do so.
3. Copy `.env.example` to an ignored `.env`. Supply a newly generated local auth secret and a fresh, disposable loopback PostgreSQL database such as `shbs_issue195_demo`. Keep SMTP unconfigured. Never import private dumps or use real program data.
4. Follow the local-development guide to start the permitted PostgreSQL runtime, apply the entire migration chain using `npm run db:migrate`, and seed with `SHBS_DEMO_SEED=1`. Use the documented seed accounts; do not put credentials into this note, PR, logs or committed fixtures. Verify the demo with `npx tsx --conditions=react-server prisma/verify-demo.ts`.
5. Keep destructive integration tests in a separate loopback `shbs_shipping_test` database. Do not run the full suite against the browser demo or a deployed database.
6. If startup is permitted in the new environment, use ordinary `npm run dev` with the loopback URL and port configured for that environment. An existing automatic rejection must be resolved through the normal approval/policy path; moving computers, ports or launchers is not a bypass.
7. Run one browser/server flow at a time. Record owned process identities and stop only those processes on completion. If other chats share the machine, obtain the coordinator's explicit reservation and use its shared exclusive lock; never delete another owner's lock.

The original local startup blocker was an automatic approval rejection with the reason **“blocked by policy.”** It occurred before the normal Next dev server started. Available receipts did not expose a rule ID, corrective setting or Next.js error. Do not assume an application code change resolves it. The minimum missing external information is the detailed rejection/policy diagnosis or confirmation that the ordinary startup action is now permitted, plus the coordinator's reservation when sharing resources.

## Reproducible focused checks

Do not repeat already passed checks merely to consume the checkpoint's remaining allowance. In a fresh environment or after relevant source changes, use one worker and retain raw logs with the exact source SHA:

```bash
export NODE_OPTIONS=--max-old-space-size=2048
export SHBS_BUILD_CPUS=1
export RAYON_NUM_THREADS=1
npm test -- --maxWorkers=1 \
  src/app/_components/profile-failed-sibling.pending.test.tsx \
  src/app/_components/profile-edit-section.test.tsx \
  src/lib/invalidate-refresh.test.ts src/lib/tutee-cache.test.ts \
  src/app/_components/profile-editors.pending.test.tsx \
  src/app/_components/profile-consumers.pending.test.tsx \
  src/app/_components/academic-history.pending.test.tsx \
  src/app/_components/academic-profile.reload.test.tsx \
  src/app/_components/account-username-editor.test.tsx \
  'src/app/(tutor)/_components/subject-willingness.test.tsx' \
  'src/app/(admin)/admin/discipline/page.test.tsx' \
  src/app/_components/attendance-correction.test.tsx \
  src/app/_components/attendance-correction.pending.test.tsx \
  'src/app/(tutor)/_components/attendance-form.test.tsx' \
  src/app/_components/historical-academic-corrections.test.tsx \
  src/app/_components/profile-dialog.test.tsx \
  src/app/_components/ui/modal.test.tsx \
  src/lib/historical-academics.test.ts \
  src/lib/discipline.test.ts src/lib/username.test.ts
npm run check
npm run docs:check
npm run build
```

Those focused tests do not require the fixture database. DB-backed domain regressions, when warranted by a change, are in `src/server/api/routers/historical-academics.test.ts` and the related approval/history suites. Follow their isolated database setup; do not relabel earlier results as fresh executions.

## Remaining live matrix and fixture design

Run the actual application in **EN and ZH**, at **1440×1000** and **390×844 CSS pixels**. Capture native dialog content after scrolling internally, keyboard focus, overflow and rendered control dimensions. Preserve 32 px desktop header controls and at least 44 px narrow-screen interactive targets. Use normal synthetic participant names; record scenario identity in fixture IDs/metadata, not in displayed names.

Create a new fixture namespace per rehearsal. Use the committed schema and domain test fixtures to create: a tutee with a missing historical grade and an original intake period; a tutee with a raw unsupported historical grade and unknown year; an additional historical period for the first participant; a separately and explicitly reported current account academic profile; and controlled linked/unlinked ownership examples. Create Coordinator proposals through the real UI/API so immutable snapshots are genuine. Do not fabricate ownership from a matching name or email.

Before and after each accepted/failed operation, compare original records, correction revisions, audit, approval payload/state, ownership, current academics/profile versions, memberships and departure revisions. Allow only explicitly intended synthetic writes. Fresh setup is preferable to broad deletion: the old local full-flow harness reset all historical-correction approval requests in its demo database and must **not** be copied as a general reset recipe.

| Group | Required live checks |
| --- | --- |
| Historical website | Exact stable-ID preview, acknowledgment, missing/raw grade and multiple periods, atomic save, second revision, original/corrected/current separation and full audit view. |
| CSV | Round-trip/null convention, malformed and duplicate input, stale multirow batch with no partial write, deliberate fresh preview/retry, independent website and CSV drafts, download waiting for refresh. |
| Native review | Website and CSV pending write, repeated Escape, Tab/Shift+Tab containment, automatic focus recovery, retained failure/retry, idle Close and opener restoration; same-Edge `closedby` fallback is not cross-browser proof. |
| Approval/import | Coordinator proposal without live changes, actual Head/Admin exact review, held/failed inline decision with retained note, one accepted decision; original-only Program Records import/export and retained failed import selection. |
| Permissions/history | Real denied route/API actions, redacted observer projections, explicit historical linking and independently reported current academics; record the actual role used. |
| Actual children | Account/username/tutor/tutee own pending plus real Membership, departure confirmation, Academic and history link/invitation registration. Preserve captured versions and require fresh history preview/acknowledgment after a failed link. |
| Mixed outcomes | The pairs below, both completion orders, failed drafts retained, committed section read-only/no replay, deliberate Close and fresh reopening. |
| Refresh failures | Each of the four primary save handlers, accepted write followed by real failing/independently held active GETs, both completion orders, warning only after settlement, no duplicate mutation, sibling draft retained. |
| Read contracts | Failed/fresh name or username Reload; dismissible held GET and identity preview; Academic Reload guarded until both reads succeed with data, preserving failed draft/version otherwise. |
| Self-service | Willingness failure/retry and real membership/departure proposals; requested feedback must not imply a granted capability. |

Mixed pairs, each in both primary-first and sibling-first completion orders and all four locale/viewport combinations:

1. Account profile success / membership failure.
2. Username success / departure failure.
3. Account profile success / Academic failure.
4. Tutee profile success / historical link failure.
5. Tutor profile success / Academic failure.
6. Username failure / account profile success.
7. Tutee profile failure / historical link success.
8. Account profile and membership both succeed; Close must still be deliberate.

**Transport requirement:** the real client uses `httpBatchStreamLink` with up to 20 operations per batch. Holding an entire HTTP response cannot establish per-operation completion order. Observe actual procedure payloads and streamed results. A test-only delivery gate must preserve authenticated requests, real server responses, versions and signed previews; never invent success/error bodies or weaken application pending guards. Record an unobservable order as blocked, not passed. A same-frame admission exercise is an explicit test technique, not a claim that disabled controls can normally be clicked.

For two active variants of one query procedure, first establish that the real route actually mounts both. If it does not, retain the reviewed real-QueryObserver automated coverage and disclose that live limit; do not manufacture application state and claim normal-route coverage.

## Next actions and report gate

1. Resolve or precisely record ordinary startup permission; obtain an explicit shared-resource reservation where applicable.
2. Prepare scoped disposable fixtures and faithful per-operation browser gates, then execute the remaining matrix serially. Existing local harnesses are not included in this clone; derive selectors from current catalogs and real accessible markup.
3. Record exact commit, environment, fixture IDs, locale/viewport, request/result order, before/after assertions, screenshot hashes, errors and cleanup. No current screenshot exists yet; create new evidence rather than republishing old captures as current.
4. Fix only actual findings, add/retest meaningful affected coverage, commit the source and submit it for independent whole-composition review. Reconcile shared UI overlaps before treating another branch's evidence as applicable.
5. Create the final HTML report **only after** explicit whole-review approval for its exact source. It must use the new evidence ledger, disclose any remaining limit, and receive its own visual verification. Keep the draft PR's progress and blockers current until then.

Do not commit `.env`, credentials, raw database dumps, private receipts, caches, generated dependencies or giant screenshot/report payloads. The portable document and intended source are the GitHub checkpoint; local evidence remains preserved separately.
