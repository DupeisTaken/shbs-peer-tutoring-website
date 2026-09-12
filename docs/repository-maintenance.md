# Repository maintenance

[Documentation hub](README.md) · [Local development](../README-LOCAL.md)

The 10 September 2026 audit used main commit `93485c2`, after the configurable-icon
change merged. It checked tracked files, source imports, package usage, documentation
references, generated artifacts and local branch ancestry. It does not certify a running
school database, real email delivery or the accuracy of privately supplied timetables.

## What belongs in the repository

| Files | Required / useful purpose | Currency and retention decision |
| --- | --- | --- |
| `src/`, including tests | Website behavior, access controls and regression coverage | Retain. Every application module has a reference or a framework/test entry point; no unresolved local imports were found. |
| `prisma/schema.prisma`, migrations and configuration | Fresh installation and upgrades of existing databases | Retain the complete migration chain, including old migrations. Their age does not make them obsolete. |
| Development seed and verification helpers | Reproducible synthetic demonstrations | Retain with their existing opt-in and database guards; never substitute them for production bootstrap. |
| `prisma/policies/` and policy catalog | Maintained English/Chinese policy drafts | Retain. Publication and school approval remain separate operator actions. |
| `messages/` | Eight referenced UI language catalogs | Retain. Hidden languages remain available to translators; visibility is not evidence of an unused file. |
| `docs/`, root guides and issue forms | User instructions, technical explanations and operation | Retain maintained guides. Correct local setup instructions and distinguish dated release evidence from current behavior. |
| `docs/archive/policies-2025/` | Explicitly labeled policy history for comparison | Retain as historical evidence, excluded from seeding; it is not current policy. |
| `docs/handbook-drafts/` and root workflow link pages | Compatibility links from older documentation | Retain: these point to maintained sources and no longer duplicate policy text. |
| `docs/reports/` and referenced screenshots | Printable guides and dated release evidence | Retain. Two guides are generated and freshness-checked; the release audit is an authored historical report. |
| `scripts/`, CI, Docker, Caddy and root tool configuration | Setup, build, deployment, backup and validation | Retain; align exclusions for local evidence and backups across tools. |
| `src/app/icon.png`, `public/.gitkeep` | Configurable browser icon and a directory required by Docker COPY | Retain, including the empty placeholder. The icon is still the documented T3 placeholder awaiting school artwork. |
| `package.json`, lockfile, `.npmrc` | Reproducible dependency installation | Retain. Remove unused direct Auth.js Prisma-adapter and legacy ESLint-config dependencies, plus unused scaffold-version metadata. ESLint still owns its transitive config dependency. |
| `LICENSE`, `.gitattributes` | Licensing and portable shell-script line endings | Retain. |

## Removed and corrected material

- Remove `docs/archive/pre-integration-readme.md` and
  `docs/archive/pre-integration-developer-notes.md`: they duplicate superseded guidance
  about permissions, signup and meeting deductions. Their exact text remains in Git history.
- Move obsolete local review outputs out of the working directory after verifying a recovery
  archive. One-off merge/publish scripts, old screenshots, PID snapshots, test logs and stale
  readiness reports are not maintained application code or current release status.
- Keep files used by running local helpers and their databases. Keep privately supplied
  timetable workbooks; their authoritative replacement is not established by repository history.
- Correct the bootstrap-role explanation and require `shbs_shipping_test` for the combined
  suite. A generic local `_test` name satisfies the shared guard but not every suite's allowlist.

## Prevent recurring clutter

The locale guard parses every bundled message as ICU, including nested plural/select
branches and rich-text tags, and compares arguments with English. Run
`npm test -- src/i18n src/app/_components/message-inbox.test.tsx` when changing catalogs.
Matching keys and valid syntax do not prove translation completeness: the six languages
hidden by default still include inherited English fallback text. Review their wording
before enabling them. Chinese workflow and account-security controls are translated;
technical examples such as email addresses, `REFRESH`, AP scores and CSV remain unchanged.

Shared account settings live in `src/app/_components/account-settings.tsx`; admin and
Tutee pages compose that component instead of importing another route's page module.

Use `outputs/` or `.validation/` for local evidence. They, `coverage/`, `backups/` and
private `local-operations/` notes are
excluded from Git, Docker context, ESLint, TypeScript input discovery and formatting.
Reusable helpers belong in `scripts/` or `src/`, where checks can exercise them.
`npm run docs:check` tests these exclusions against the real tools.

Generated Prisma clients, dependencies and Next output are rebuildable, but check running
processes before removal. In particular, `node_modules/.cache/` can contain an active embedded
PostgreSQL database; it is not necessarily disposable cache. Do not run `npm ci` over a live
database stored there. Stop or relocate that runtime through its own lifecycle first.

Before deleting a local branch, fetch and verify that its tip is an ancestor of `origin/main`,
inspect associated worktrees for changes, and retain unique work. A clean completed worktree
can be detached at the same commit before deleting its merged branch; this preserves files
used by existing tools. Keep `main`, active work and unmerged branches. Remote branch deletion
is a separate action. Preserve uncommitted work in a named stash before switching baselines;
do not automatically replay an older checkout's changes onto latest main.

Local removal manifests, recovery locations and verification results are recorded with the
cleanup's recovery archive, rather than committed as another set of transient test outputs.
