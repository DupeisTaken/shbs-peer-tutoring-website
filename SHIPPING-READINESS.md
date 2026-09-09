# Integrated release candidate

This branch combines PRs #6–#9 into a single application. It includes the complete deployment bootstrap, participant workflows, survey-first intake, coordinator approvals and the fixes from the merge-readiness review. Use the integrated candidate as the release unit; independently merging the earlier overlapping student/authentication implementations is unnecessary.

## Changes made for shipping

- One student portal includes intake actions, assignments, attendance, feedback, appeals and private support. Explicit profile ownership preserves history across new intakes and verified email changes. Quarter withdrawal also follows the account identity.
- Coordinator corrections, qualifications, interview completion, calendar, feedback visibility, appeals, survey assignments and translation decisions enter the approval queue. Unknown management writes still fail closed. A coordinator chair retains authorship of the interview outcome through review.
- Student proposals consume the requester's timed confirmation, then require a fresh reviewer confirmation. A failed approval rolls back the assignment, decision, notifications and ticket consumption. Assignment email occurs after commit, with an explicit retry result on delivery failure.
- Migration collisions are resolved for the shared student prerequisites and audit evidence column. Historical meeting penalties are reconciled to the three-absence allowance and 0.25-hour rule. Manual adjustments are preserved.
- All suites share an explicitly allowed loopback `shbs_shipping_test` database. CI requires static checks, tests, production audit, production build, and image boot. The exact image is restarted to verify deadline enforcement resumes automatically.
- The dependency lockfile matches the production bootstrap requirements. Vitest 4.1.11 fixes [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9); CI audits development dependencies as well as production packages.

## Local verification

Run the complete suite only on an isolated test database:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shbs_shipping_test
export AUTH_SECRET=local-test-secret-at-least-thirty-two-characters
npm ci
npm run db:migrate
npm run check
npm test -- --maxWorkers=1
npm audit
npm run build
```

The fixtures truncate their dedicated test database. Never use a production database URL. Fresh production bootstrap remains seed-free. The pre-release branches have overlapping migrations; use a fresh disposable database when switching between independently tested branches, and do not reset production data.

Browser verification uses one headless browser and one bounded webpack development server. It covers public survey submission, verification, sign-in, desktop/mobile student history, coordinator assignment submission, fresh administrator confirmation, and access to history/messages during policy renewal. Delivery in these checks uses local development mail capture; no real inbox or provider is involved.

## Deferred launch setup, by request

No deployment or real email-provider configuration is authorized for this task. Before opening real intake:

1. Provision the Ubuntu host and canonical HTTPS domain; use the [deployment runbook](README-DEPLOY.md).
2. Configure transactional email and prove delivery to a real inbox for signup, password reset and verified email change.
3. Review and publish the [English/Chinese handbook drafts](docs/handbook-drafts/README.md), replace school-specific placeholders, and align every published policy language. The historical demo seed is not launch content.
4. Set up the real school year/intake, subjects, slots, rooms, qualifications, calendar overrides and signup timing.
5. On the target host, verify TLS, durable database/uploads, restart behavior, and an off-host backup restoration into a separate database.

These operator checks are intentionally separate from the tested code release. Production email, school content and target-host restoration cannot be certified by local tests or CI.
