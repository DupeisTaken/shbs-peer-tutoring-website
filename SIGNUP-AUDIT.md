# Student signup and participation audit — 9 September 2026

Historical audit of the standalone survey branch. The current integrated release is [SHIPPING-READINESS.md](SHIPPING-READINESS.md); current ownership and policy behavior are in the [technical report](docs/technical-report.md). Counts and pre-merge statements below describe that earlier audit.

Worktree: `D:/Working Directory/shbs-peer-tutoring-survey-first`  
Branch: `codex/survey-first-student-signup`  
Base: `cc6646d` (`origin/main` when the sibling worktree was created)

## Scope and outcome

The survey-first signup implementation now includes the confirmed priority, verification, availability, recall, quarter withdrawal, tutor schedule review and updated-policy rules. The audit was completed in an isolated sibling worktree before committing and opening the pull request. The main checkout is untouched; merging and deployment are separate release steps.

[STUDENT-SIGNUP.md](STUDENT-SIGNUP.md) documents the final workflow, schema invariants and operations. README and CLAUDE.md have also been updated. English and Chinese new UI copy is supplied; other configured locales use English fallback for new messages.

## Audit findings addressed

| Finding | Resolution |
| --- | --- |
| Failed resends could invalidate a usable link | Only publish replacement tokens after successful delivery; preserve priority and existing links on failure. |
| Confirmation could race catalog, intake or policy changes | Validate inside transactions with catalog/intake row locks and shared policy locks. |
| Public signup could inherit a legacy tutor identity | STUDENT accounts never auto-claim tutor profiles by matching email. |
| Shared school IP sign-ins could lock everyone out | Keep generous network allowance separate from the per-identifier throttle. |
| Suspended/deleted accounts and shared-device sessions | Reject suspended sign-ins, clear deleted-user sessions and support explicit account switching. |
| Legacy admin tools could bypass closed request rules | Database triggers protect terminal state/priority and reject expired/closed roster membership; all admin assignment entrypoints share request locks and first-assignment stamping. |
| Disqualification might accidentally revive the previous request | Keep terminal history permanently closed; create a new request/profile with a fresh timestamp. |
| Availability edits might alter subjects or remove assignments | Strict availability-only mutation preserves original payload, priority and pairings; add Edited badge and notifications. |
| Withdrawal and schedule conflict could have the same consequence | Withdrawal approval closes all assignments and creates a quarter block; schedule approval removes only the affected pairing, preserving priority and other assignments. |
| Tutor rejection omitted existing manually managed students | Support legacy schedule reviews in the same admin review queue. |
| Confirmation timers could be bypassed or replayed | User/action/target-bound, time-gated, single-use server tickets with expiration. |
| Admin schedule review lacked identifying context | Show the affected subject and tutor in the card and confirmation dialog. |
| Docker migration runtime dependency/config omissions | Include Prisma configuration and the production CLI dependency closure; scoped dependency remediation. |

## Validation

- Full suite: **162 tests passed across 24 files**. Tests include deadline boundaries, permanently closed requests, new submissions, quarter blocks, policy revisions, ownership, availability restrictions, legacy assignment editors, selective schedule removal, email recovery/concurrency, timer enforcement/replay and QR PNG decoding.
- TypeScript and ESLint: zero errors; **16 pre-existing unrelated lint warnings** remain.
- Production Next.js build passed. The final build uses a worktree-local CPU limiter and a bounded 1536 MB Node heap.
- All **nine migrations** applied to isolated local PostgreSQL; migration status current.
- Production worker smoke test: after restarting with an overdue fixture and no HTTP traffic, the request became DISQUALIFIED, roster membership dropped to zero and its pending review closed automatically.
- Production dependency audit: **zero reported vulnerabilities**.
- Git diff whitespace check passed with Windows line-ending handling.
- Browser QA used the local production build and dummy `.test` accounts: desktop and 390-pixel layouts; mandatory policy popup and disabled timer; availability editing with assignment/priority preserved; withdrawal and tutor rejection popups; admin matching/review groups; English and Chinese tutor controls. Policy acceptance and destructive lifecycle execution are covered by automated integration tests, with separate already-accepted fixtures for visual QA.
- Earlier signup QA covered survey/account pages, sign-in button/copy link/QR controls, existing-account confirmation, account switching and email sign-in. New-password creation is covered by service/component tests.

## Before production release

1. Smoke-test the Linux Docker image, entrypoint migrations and restart against the intended database. The local Docker daemon was unavailable; native Windows build/browser tests do not certify the Linux container.
2. Verify the actual HTTPS hostname and SMTP sender/domain configuration in staging, including inbox delivery, resends and QR use on another device. No real email was sent during this audit.
3. Reconcile overlapping schema/student/bootstrap changes from the other task before merging and rerun the checks on that combined result.
4. Publish the real English/Chinese policies and launch content, catalog and quarter configuration. Local QA policy/content is disposable test material.

No further product question blocks this implementation. Withdrawal eligibility is removed on admin approval; assignments continue while the application is pending. Quarter bans are keyed to normalized login email. Historical requests are retained without an invented automatic deletion period.

## Local resources

Tests run serially across files. Only one lightweight loopback PostgreSQL instance and one temporary web server are used for QA. The database uses 16 MB shared buffers and at most 20 connections. Temporary browser viewport changes are reset, and servers are stopped after final checks. Disposable cache/database files are retained because automatic approval review previously rejected deletion as blocked by policy; no alternative deletion mechanism was used.
