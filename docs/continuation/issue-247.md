# Issue 247 continuation

Source candidate: `2dca03a12903e4954d9971845cec94089ebdd1ed`.
Branch: `codex/issue-247-qualification-review`.
Correction baseline: `800cbf9bae7a45c61d015620ffda4268337a44a0`.
Feature integration baseline: `ea063372d12b3d62e5b0e6ea143e2afa00fc7d4e`, including PR #244 head `a63a2c929c945f26b4ce4c70c804bc74f1c14f28` and checked main `d3a98dad232902ccf6a6ebe772c6467a095e5eba`.
Target PR base: `main` at `d3a98dad232902ccf6a6ebe772c6467a095e5eba`. Related issue: [#247](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/247). The publication commit adds only this continuation document after the code-tested candidate; its exact SHA is recorded in the draft PR.

## Completed behavior

Pending additional-subject and higher-level requests have an explicit Approve without Interview entry. It opens a shared review dialog without writing. A required note precedes approval. The latest human requirement supersedes the original issue wording: direct review offers only Cancel and Approve qualification. Rejection requires the assigned Admin/Head interview chair, all panel votes and the majority rule. Both the UI and server enforce this restriction. Eight locale help texts and existing guides are updated.

Drafts, expected versions, role/self-review guards, duplicate-write protection, Cancel/Escape/focus and read-only recovery after a committed write remain covered. Initial screening is unchanged. No migration or production configuration changed.

## Verification for this candidate

- 50 UI/i18n tests in six files passed with one worker: qualification-review, qualification-review-dialog, qualification-review-cache, admin applications page, my-interviews and messages.
- 35 qualification domain cases passed against a separate loopback PostgreSQL database named `shbs_shipping_test`; the suite clears that database's public tables. Never use production or personal data.
- `npm run check` passed (type generation, ESLint and TypeScript); 17 existing warnings, zero errors.
- `npm run docs:check`: 13 passed. `git diff --check`: passed.
- 16 real app checks and 24 screenshots cover both request types, EN/ZH, 1440 x1000 and 390 x844, notes, focus, pending/error/stale/reload/refresh recovery, real approvals and an assigned-chair rejection after three synthetic panel votes. Actions measured 40 px desktop and44px mobile; no horizontal overflow/page errors.
- Earlier 294-case results belong to 800cbf9 and are historical. No full repository suite, production build, new contrast measurements or 200% text rerun was claimed for this correction.
- Runtime was Windows, Node24.16.0, Next16.3.6, React19.2.7, Vitest4.1.11 and local PostgreSQL. Dependencies were an existing shared junction, not a fresh npm ci verification.

## Review and report state

Owning parent independently audited 800cbf9 with no actionable code findings. It found duplicated/mislabeled Chinese before screenshots. New current Chinese captures verify translated titles/buttons and are genuine. The correction at 2dca03a and its current evidence passed the owning parent's independent review with no actionable code findings; its50-case independent UI/i18n rerun passed. The replacement HTML passed local desktop/mobile image, link, zoom and provenance checks; the owning parent's final independent report audit is in progress. The older local report/receipts remain preserved and are not current evidence. The planned replacement uses valid historical English before imagery and excludes the invalid Chinese baselines.

Local ignored reports, screenshots, auth state, database files and raw receipts are intentionally absent from a cloud clone. Do not claim they were reproduced in the cloud. Owned app/browser/DB processes were stopped; the exclusive validation lock was released. An earlier recursive cache-cleanup action was rejected and was not retried. Ordinary dev startup for this candidate succeeded.

## Cloud continuation

1. Check out this branch at the published candidate recorded in the PR. Read AGENTS.md, docs/contributing.md and docs/local-development.md. Install the repository's locked dependencies in that environment; do not reuse local Windows junctions.
2. Follow documented local environment and Prisma setup. Supply fresh development-only authentication configuration through the environment; no secrets are in this note.
3. Provision an isolated loopback PostgreSQL database called `shbs_shipping_test`, migrate it, and point DATABASE_URL there for integration tests. Use a separate disposable demo database for browser fixtures; never point reset tests at it.
4. Run the focused tests serially:
   `npx vitest run src/app/_components/qualification-review.test.tsx src/app/_components/qualification-review-dialog.test.tsx src/app/_components/qualification-review-cache.test.tsx "src/app/(admin)/admin/applications/page.test.tsx" "src/app/(tutor)/_components/my-interviews.test.tsx" src/i18n/messages.test.ts --maxWorkers=1`
   `npx vitest run src/server/qualification-applications.test.ts --maxWorkers=1`
5. Run `npm run check` and `npm run docs:check` when source changes justify repeating them. Complete platform/install/build/CI checks for the cloud candidate separately; old local results do not prove cloud installation.
6. Seed the separate demo per docs. Create a pending additional-subject request and a genuine higher-level request whose applicant already holds the lower qualification. Create a valid three-tutor interview panel with an Admin/Head chair and a tutor qualified in the requested subject. Use synthetic data only.
7. Start one ordinary dev server and one browser. Verify the direct dialog has no reject action, blank note blocks approval, Cancel/Escape preserve drafts and focus, roles are enforced, and direct accept:false is refused by the API. Cast all interview votes through the existing workflow, then verify rejection by the chair and retention of evidence/previous qualifications. Check EN/ZH desktop/mobile and measure actual controls.
8. Complete independent review before rebuilding final HTML. Every screenshot must bind to its actual commit and visible language. Preserve source and cleanup only owned services. No merge/deployment/issue closure is authorized here.

Shared source overlap: this feature uses PR #244's shared Modal/Button/InlineNotice and the existing applications page. Later shared UI commits are outside this pinned baseline; do not blindly overwrite their modal or cache work during integration. Reconcile and review shared UI dependencies first, then this qualification feature. No shared component was changed by 2dca03a.
