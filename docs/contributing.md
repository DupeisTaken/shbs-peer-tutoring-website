# Contributor guidance

Start with [local setup](local-development.md), then use the [technical guide's code map](technical-report.md#architecture) to find the implementation you need. Keep changes focused on current behavior and document the core ideas in code comments.

## Required checks

Run commands from the repository root:

| Change | Verify with |
| --- | --- |
| Any commit | `npm run check` and relevant tests |
| Documentation | `npm run docs:check` |
| Application behavior | Focused tests, then the relevant integration suite with `npm test -- --maxWorkers=1` |
| Routes, environment or Prisma | `npm run build` in addition to relevant tests |
| Schema | A committed migration, `npm run db:migrate`, and schema agreement against an isolated database |
| Demo seed | Run it twice on a disposable database, then `npx tsx prisma/verify-demo.ts` |
| User interface | Desktop/mobile screenshots and checks of interaction, loading, errors and permissions |

Integration tests reset fixtures. Use the isolated loopback `shbs_shipping_test` database for the combined suite and follow [test setup](local-development.md#5-run-the-tests). Never seed or run destructive tests against real program data. Run one bounded server/browser at a time and stop processes you started; do not kill unrelated Node processes.

The [CI workflow](../.github/workflows/docker-build.yml) also checks dependency installation, migrations, schema agreement, dependency audit, production build and image boot/restart. Use its result for the commit being reviewed; old test totals are not current verification.

## Implementation conventions

- Validate permissions and invariants on the server. Role, tutor linkage, crew membership and translation assignment are distinct; a matching name or email never establishes student ownership.
- Classify management writes in [approval-policy.ts](../src/lib/approval-policy.ts). Sensitive coordinator writes queue proposals. Reuse the enclosing approval transaction and keep external delivery after commit.
- Preserve original survey priority, fixed deadlines, terminal request state, explicit historical ownership and exact policy acceptance snapshots. Use shared domain helpers and confirmation tickets.
- Use [service-hours.ts](../src/lib/service-hours.ts) for session calculations. Interviews use actual duration; meeting penalties use the semester allowance. Do not substitute generic rounding.
- Prisma CLI configuration lives in [prisma.config.ts](../prisma.config.ts). Schema changes need migrations; `db push` is for disposable experimentation and does not replace committed SQL constraints.
- Keep display names synchronized through the shared account-profile helper and account settings through the shared component. Do not import another route's page as a reusable component.
- Use “subjects” in interface copy and localize in [messages](../messages). Catalog tests validate ICU syntax and argument parity; review translations before enabling hidden languages.
- Keep bundled sample policies separate from published database documents. Follow [policy publication](policies/README.md) when wording changes.
- Before changing Next.js behavior, read the relevant bundled guide under `node_modules/next/dist/docs/`. Use the existing Turbopack build command and local resource settings rather than global runtime changes.

## Documentation and repository hygiene

Keep only `README.md` at the repository root. Put instructions in the existing guide for their audience:

| Reader's task | Maintained source |
| --- | --- |
| Find the right guide | [Documentation hub](README.md) |
| Use role-specific controls | [User guide](user-guide.md) |
| Configure the program | [Program reference](program-reference.md) |
| Understand code responsibilities and invariants | [Technical guide](technical-report.md) |
| Install, seed, test or troubleshoot locally | [Local development](local-development.md) |
| Deploy, bootstrap, back up or recover | [Deployment](deployment.md) |
| Adapt sample policies and publish approved revisions | [Sample policies and publication](policies/README.md) |
| Contribute, verify or maintain the repository | This guide |
| Report a reproducible problem or request a change | [Issue guide](issues.md) |

Keep each procedure in one place and link to it elsewhere. Update the relevant section when behavior changes; do not append a feature diary or create a page for every fix. Keep PR narratives, old audits, superseded policies and compatibility notes in Git/issue history. Documentation describes the current application; its real data-integrity and privacy boundaries still need to be stated.

Keep Markdown, policy inputs, reusable scripts, tests and the complete migration chain versioned. `prisma/policies/` is consumed by the development seed and is not a duplicate documentation folder. Dependencies, generated Prisma clients and Next build output are rebuildable. Do not delete migrations or runtime input files just because they are old.

Keep documentation as Markdown. Local reports, screenshots and temporary logs belong in ignored `outputs/` or `.validation/`. Database dumps belong in ignored `backups/` and private operator notes in `local-operations/`. Reusable helpers belong in `scripts/` or `src/`, where checks can exercise them.

Before removing caches, check whether a running helper owns them: `node_modules/.cache/` may contain an embedded PostgreSQL database. Stop or relocate it through its own lifecycle before deleting files or running `npm ci`. Preserve private timetables and other irreplaceable local input. Before removing a branch/worktree, fetch, inspect uncommitted work and verify its commits are merged; retain unique work and active worktrees.
