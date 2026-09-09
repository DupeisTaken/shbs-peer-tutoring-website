# Contributor guidance

Start with the [README](README.md), [technical report](docs/technical-report.md) and [local setup](README-LOCAL.md). This file holds implementation conventions; role instructions and policy wording live in their linked guides.

## Required checks

- Run `npm run check` before every commit, plus relevant tests. Run `npm run build` for changes to routes, environment or Prisma.
- Run `npm run docs:build` after editing report Markdown, then `npm run docs:check`. Commit generated reports with their sources.
- Use only isolated local databases for integration tests; the combined suite accepts `shbs_shipping_test` and resets its fixtures. Run serially.
- The development seed must contain states reachable through the current application. After changing it, run it twice on a disposable database and confirm idempotence. Never seed production.
- Keep one bounded dev server/browser at a time and stop owned processes. Verify UI changes with desktop/mobile screenshots. Never kill unrelated Node processes.

## Implementation conventions

- Explain core ideas and non-obvious invariants in code comments. Derive calculations and authorization from shared helpers, with regression tests for broader scenarios.
- Prisma 7 reads CLI configuration from `prisma.config.ts`. The server and seed use the PostgreSQL driver adapter. Schema changes require a new committed migration; `db push` is for disposable local state only.
- Management writes must be classified in [approval-policy.ts](src/lib/approval-policy.ts). Coordinators queue sensitive changes; unknown management writes fail closed. Reuse the approval transaction and existing validation. Keep external delivery after commit.
- Role, linked tutor identity, crew membership and translator assignment are separate capabilities. Authorization belongs on the server. Never infer student ownership from a matching name/email.
- Preserve survey priority, fixed deadlines, terminal requests, historical ownership and exact accepted policy snapshots. Use the shared workflow helpers and timed confirmation tickets.
- Use the current [hour calculator](src/lib/service-hours.ts); session rounding is deliberately unusual and must not be replaced with nearest-half-hour rounding. Completed interviews use actual duration. Meeting penalties follow the semester allowance.
- Use “subjects” in interface copy, not “courses.” Keep labels localized in the existing message catalog and preserve accessibility and responsive layouts.
- Keep runtime policy records distinct from [bundled policy drafts](docs/policies/README.md). Do not republish archived translations or assume a Git change updated a running database.
- Windows production builds use the existing Turbopack build command; a bounded webpack dev server is acceptable for investigation. Do not change global runtime configuration to work around local resource limits.

The [pre-integration developer notes](docs/archive/pre-integration-developer-notes.md) are historical reference only; they contain superseded permissions, interview rules and meeting deductions. Use current code, tests and the technical report as authority.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
