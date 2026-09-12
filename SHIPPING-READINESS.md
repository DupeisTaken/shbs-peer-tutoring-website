# Integrated release verification

[Release PR #42](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/42) integrates reviewed PRs **#26–#41**, their combined fixes and the 13 September 2026 shipping audit. Check the PR and its linked Actions run for the current merge/image status. The original feature tips are retained as merge parents; the reviewed integrated tree resolves overlapping account, period, navigation and locale changes.

## Verification evidence

- The integrated local suite passed **575 tests across 81 files**. Two additional tests verify the optional local build-cache bypass; 60 focused UI, access and locale checks also passed.
- Lint and TypeScript passed with **17 existing warnings, no errors**. Seven documentation tests, generated-guide freshness and link checks passed. Full dependency audit found no known vulnerabilities.
- Production build passed. A local read-only workload of 48 HTTP requests, at concurrency two, had zero failures (64 ms p95 in that rehearsal). This is a smoke check, not a production capacity claim.
- Production-browser checks covered management destinations, seven tutee tabs, public/custom pages, HEAD, ADMIN, coordinator, tutor, tutee, crew, viewer and translator entries, bilingual controls, dialogs, recipient selection, profile-save feedback and mobile navigation.
- CI additionally checks clean installation, fresh migrations/schema agreement, the full suite, production build and an empty-database image boot/restart. Main image publication is separate from updating a live host.

Public signup has explicit prerequisite/error states and a clear tutor application → interview → verified account journey. Management support/interviews/translations preserve navigation. Contact privacy labels, shared actions, applied crew flags and print overflow are consistent. See [supported functions and switches](docs/program-reference.md), [role guide](docs/user-guide.md), and [technical report](docs/technical-report.md).

Disposable screenshots, the per-PR HTML audit and intermediate logs are intentionally ignored under `outputs/shipping-audit/`. They contain synthetic data, not school records. Earlier dated release evidence remains in Git history and [the prior rehearsal report](docs/reports/release-audit.html).

## Target-host launch checks

Before opening real intake, verify these against the actual deployment:

1. Canonical HTTPS domain, persistent UTF-8 PostgreSQL database/uploads and successful migration/restart.
2. Transactional email delivered to a real inbox for signup, password recovery and verified email changes.
3. Published, school-approved policy revisions and reviewed school-specific content; hidden languages need wording review before enabling.
4. Real school year/intake, subjects, slots, rooms, qualifications, school calendar, feedback visibility and signup timing.
5. A backup restored into a separate database, plus target-host TLS and retention checks.

Use the [deployment runbook](README-DEPLOY.md). Local tests and a published image cannot certify public DNS, production email or backup restoration. Never seed production; all destructive tests use an isolated allowlisted database as described in [local setup](README-LOCAL.md).
