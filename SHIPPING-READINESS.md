# Integrated release verification

PR #9 merged the reviewed PRs #6–#9 into main on 9 September 2026 as commit `6056f6e94b7e`. The reviewed head `40427dab3127` passed 283 tests across 33 files plus static checks, full dependency audit, production build and runnable-image checks. See the [technical report](docs/technical-report.md) and [role guide](docs/user-guide.md) for the maintained documentation.

## Changes made for shipping

- One student portal includes intake actions, assignments, attendance, feedback, appeals and private support. Explicit profile ownership preserves history across new intakes and verified email changes. Quarter withdrawal also follows the account identity.
- Student Support separates pending appeals from resolved history, with independent filters, page positions and total-aware navigation so open cases remain visible while historical review stays available.
- Coordinator corrections, qualifications, interview completion, calendar, feedback visibility, appeals, survey assignments and translation decisions enter the approval queue. Unknown management writes still fail closed. A coordinator chair retains authorship of the interview outcome through review.
- Student proposals consume the requester's timed confirmation, then require a fresh reviewer confirmation. A failed approval rolls back the assignment, decision, notifications and ticket consumption. Assignment email occurs after commit, with an explicit retry result on delivery failure.
- Migration collisions are resolved for the shared student prerequisites and audit evidence column. Historical meeting penalties are reconciled to the three-absence allowance and 0.25-hour rule. Manual adjustments are preserved.
- All suites share an explicitly allowed loopback `shbs_shipping_test` database. CI requires static checks, tests, full dependency audit, production build, and image boot. The exact image is restarted to verify deadline enforcement resumes automatically.
- The dependency lockfile matches the production bootstrap requirements. Vitest 4.1.11 fixes [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9); CI audits development dependencies as well as production packages.

## Local verification

The documentation/policy follow-up was checked on 9 September 2026: **290 application tests across 35 files** and **5 documentation tests** passed, along with ESLint/TypeScript and a zero-vulnerability full dependency audit. The existing 16 advisory lint warnings remain. Two seed runs preserved row counts and loaded all four current policy sources. Desktop/mobile browser checks covered the two HTML reports, English/Chinese policy rendering and first-policy creation through the live editor, including persistence after reload.

The first-policy editor fix removes the former requirement to run demo data just to publish handbooks. [Policy publication instructions](docs/policies/README.md#publish-a-revision) now cover a blank installation. Read the [technical HTML report](docs/reports/technical-report.html) or [role-based HTML report](docs/reports/user-guide.html); their Markdown sources are linked from the [documentation hub](docs/README.md).

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
3. Review and publish the [English/Chinese policy sources](docs/policies/README.md), replace school-specific placeholders, and align every published policy language. The historical demo seed is not launch content.
4. Set up the real school year/intake, subjects, slots, rooms, qualifications, calendar overrides and signup timing.
5. On the target host, verify TLS, durable database/uploads, restart behavior, and an off-host backup restoration into a separate database.

These operator checks are intentionally separate from the tested code release. Production email, school content and target-host restoration cannot be certified by local tests or CI.
