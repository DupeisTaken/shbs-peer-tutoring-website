# Local development & testing

Run the app locally, seed synthetic data and verify changes from the repository
root. For production, use the [deployment runbook](../guides/deployment.md).

## Worktree and resource safety

Before changing a checkout, inspect `git status --short`,
`git branch --show-current` and `git rev-parse HEAD`. Confirm which checkout and
revision your task owns, and preserve unrelated changes and running previews.

- **Dependencies:** Inspect whether `node_modules` is a directory, symlink or
  Windows junction (`Get-Item node_modules | Format-List FullName,LinkType,Target`).
  Never run `npm ci` against a shared junction while another checkout uses it.
  Sibling worktrees sharing a `node_modules` junction must set
  `SHBS_WORKSPACE_ROOT` to the absolute common parent directory so Turbopack and
  standalone tracing allow the junction. `node_modules/.cache/` may also hold an
  embedded PostgreSQL instance — inspect ownership before deleting caches.
- **Prisma client:** [schema.prisma](../../prisma/schema.prisma) generates into
  this checkout's ignored `generated/prisma` (imported by [db.ts](../../src/server/db.ts)).
  Inspect both `generated` and `generated/prisma` for links before running
  `npx prisma generate` (also run by `npm ci` `postinstall`). Keep
  `npm run db:generate` (`prisma migrate dev`, for authoring migrations) separate
  from `npm run db:migrate` (`prisma migrate deploy`, for applying migrations).
- **Database isolation:** Verify the resolved host, port and database name without
  exposing secrets. Use separate databases for demo/browser work and destructive
  integration fixtures (`shbs_shipping_test`); never migrate, seed or reset a
  database owned by another preview. On Windows, create disposable databases with
  UTF-8 encoding (`TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`)
  so Chinese text and emoji are supported.
- **Serial verification:** Run one heavy check, build, test suite or browser
  session at a time. Do not run `npm run check` or `npm run build` alongside
  `npm run dev` in the same checkout (shared Next output). Use `SHBS_BUILD_CPUS=1`
  to bound build workers, `--maxWorkers=1` for Vitest, and
  `SHBS_DISABLE_BUILD_CACHE=1` to bypass a stale Turbopack module-graph cache
  without deleting it.
- **Parallel work & cleanup:** Delegate independent research/reviews to subagents,
  run heavy local checks serially, and coordinate pushes under the
  [CI capacity budget](verification.md#ci-capacity-and-queue-discipline). Record
  any processes, ports or temp databases you start and stop only those you own.
  Keep local screenshots and logs in ignored `outputs/` or `.validation/`.

Documentation-only edits need no server, browser or database — run
`npm run docs:check` plus [required checks](verification.md#required-checks).

## Updating an existing checkout

After pulling schema changes, verify the target local database, run
`npm run db:migrate` and `npx prisma generate`, then restart the app. Apply the
migration chain instead of resetting an existing database. See the
[technical guide](../reference/technical-report.md) for code ownership and
[program configuration](../guides/program-configuration.md) for settings.

### Dependency compatibility checks

- Keep `next` and `eslint-config-next` on the same version, preserve
  `tools/next-lint-glob` and deliberate `package.json` overrides, and run
  `npm audit` across the full tree (dev advisories fail CI).
- Preserve Zod 4 contracts: explicit string keys on dictionary schemas,
  `prefault({})` on omitted announcement audiences, nullable transforms on
  observer projections, and raw-vs-parsed ratings in attendance forms.
- After validation, mail or CAPTCHA updates, run `student-signup.test.ts`,
  `smtp-runtime.test.ts`, `aliyun-runtime.test.ts` (real SDK client/models with
  stubbed transport) and the affected domain suites before running full tests.

## Prerequisites

- **Node 22 (CI baseline)** and **npm**
- **PostgreSQL 16** (Docker/Podman or local install; UTF-8 encoding on Windows)
- _(Optional)_ **Docker** for the Compose smoke test

## 1. Install and configure

```bash
npm ci                      # installs locked dependencies and generates Prisma
cp .env.example .env
```

Edit `.env`: local development needs `DATABASE_URL` and a stable `AUTH_SECRET`
(`npx auth secret`). Sign-in uses username or email + password (no external IdP).

The first address in `AUTH_BOOTSTRAP_ADMIN_EMAILS` promotes to `HEAD` on sign-in
when no Head exists; later entries promote to `ADMIN`. To create an initial
account without seeding, run `npm run admin:create` per
[first-admin bootstrap](../guides/deployment.md#create-the-first-admin-first-deploy).

> **Email 2FA:** Active when both the `EMAIL_2FA` program feature (on by default)
> and the user's opt-in preference are enabled. Without SMTP, development logs
> single-use codes to the console (`src/server/auth/two-factor.ts`).

## 2. Get a database running

### Option A — Docker / Podman (`start-database.sh`)

Run `./start-database.sh` (from WSL on Windows; directly on Linux/macOS). It reads
`DATABASE_URL` from `.env` and binds `127.0.0.1:<port>:5432` by default.

- Optional `DB_BIND_ADDRESS` (host-only literal IPv4, default `127.0.0.1`) allows
  explicit remote binding; prefer SSH/VPN tunnels instead of `0.0.0.0`.
- Existing containers with mismatched, wildcard or host-network bindings are
  refused without modifying or deleting data. Inspect mounts with
  `docker inspect --format '{{json .Mounts}}' <container>` before recreating.
- Verify the active mapping with `docker port <container> 5432/tcp` and check
  Docker's [localhost-publishing caveat before Engine 28.0.0](https://docs.docker.com/engine/network/port-publishing/).

### Option B — Existing local PostgreSQL

Create a UTF-8 database and point `DATABASE_URL` at it:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs_program_demo"
```

## 3. Apply the schema and seed

Use a fresh local database named `shbs_program_demo` with `SHBS_DEMO_SEED=1`
(PowerShell: `$env:SHBS_DEMO_SEED="1"`). The seed refuses remote hosts, production
mode, and database names outside `shbs_*_demo` / `shbs_*_test`.

```bash
npm run db:migrate
npm run db:seed
npm run db:seed
npx tsx --conditions=react-server prisma/verify-demo.ts
```

Seeding is idempotent for demo rehearsal and preserves immutable request history,
but it can overwrite exploration edits — create a fresh database for a clean
restart and never seed real program data.

### Demo accounts and workflows

All seeded accounts use password `Password123!` at `/signin`:

| Account | Role / example | Start |
| --- | --- | --- |
| `admin` / `admin@example.edu` | Head; oversight, decisions and configuration | `/admin/activity` |
| `manager@example.test` | Admin; management review without a tutor profile | `/admin` |
| `chair@example.test` | Admin + tutor (Alex Interview Chair); scheduling and decisions | `/dashboard`, `/admin` |
| `carol@example.edu` | Coordinator + tutor; approval proposals | `/dashboard`, `/admin` |
| `alice@example.edu` | Active tutor; attendance, pairings, hours, panel voting | `/dashboard` |
| `crew@example.edu` | Crew-only member; room patrol and membership | `/patrol` |
| `iris@example.edu` | Tutor + Crew member | `/patrol` |
| `emma@example.test` | Assigned tutee; sessions, feedback and messages | `/student` |
| `frank@example.test` | Assigned tutee; pending card appeal and withdrawal review | `/student` |
| `grace@example.test` | Assigned tutee; tutor schedule-conflict review | `/student` |
| `kate@example.test` | Verified tutee awaiting assignment | `/student` |
| `recalled@example.test` | Recalled request retained as history | `/student` |
| `withdrawn@example.test` | Approved quarter withdrawal and resubmission block | `/student` |
| `translator@example.test` | Explicit Translator (without Viewer access); pending draft | `/localization` |
| `parent@example.edu` | Ordinary Viewer | `/` |
| `viewer2@example.edu` | Suspended Viewer with account appeal | `/` |

The seed populates ordinary and edge-case participant records (appeals, discipline,
membership requests, incomplete academics, username collisions, multi-assignment
combined pairing groups, fixed/automatic/roomless room examples, interview panels
including a tie-break, school-calendar overrides, custom pages, and a synthetic
first School Month Report). Opening a tutor or tutee agenda publishes upcoming
dated sessions; rescheduling negotiations, extra sessions and coordinator
proposals are created interactively through the UI. Seeded survey tokens are
deliberately unusable — request fresh links through the form using local console
email capture.

- **Selective demo-DB helpers** (when upgrading an untouched disposable demo DB
  without full reseed, with `SHBS_DEMO_SEED=1`):
  - `npx tsx --conditions=react-server prisma/seed-scenarios.ts` — backfill missing scenario fixtures
  - `npx tsx --conditions=react-server prisma/seed-academics.ts` — backfill missing academic details
  - `npx tsx --conditions=react-server prisma/seed-pairings.ts` — upgrade untouched pairing shapes
  - On a separate `shbs_*_test` database only (never the exploration demo):
    `prisma/verify-demo-academics.ts`, `prisma/verify-demo-scenarios.ts`, and
    `npm test -- src/test/demo-seed.test.ts --maxWorkers=1` (also in CI).

## 4. Run the app

```bash
npm run dev         # http://localhost:3000
```

Sign in at `/signin` (e.g., `admin` / `Password123!`). Switch language any time
with **EN / 中文**. The dev server logs `[trpc] <type> <path> <ms>`; leave
`TRPC_DEV_DELAY` unset when measuring handlers.

Public forms (no login required):
- **Tutee signup** (`/tutee-signup`; `/signup` redirects): collects application,
  policy agreement and priority timestamp, verifies via 4-digit mailbox code, then
  opens the invitation receipt popup to continue to `/register-account`.
- **Viewer signup** (`/viewer-signup`): verifies mailbox code and opens the shared
  receipt popup (existing accounts take the login path without changing access).
- **Invitation entry** (`/register-account`; `/register` redirects): single code
  card for 5-character mixed invitations; signed-in accounts use **Add access** in
  the account menu or Account Settings.
- **Tutor application** (`/tutor-signup`): starts recruitment and interview panel
  review (3+ active tutor panelists, Admin/Head chair, majority vote with chair
  tie-break; Admin/Head chair applies approval or initial rejection directly).
- **Crew application** (`/crew-signup`): mailbox-verified pending application;
  after staff approval at `/admin/crew`, retrieve the receipt via the public page.
- **History-only claim** (`/history/claim`): staff-issued historical invitation +
  mailbox code for claiming archived records without current enrollment.

Follow [design conventions](design.md#invitation-and-verification-code-presentation)
for 5-char invitation / 4-digit email code presentation and legacy compatibility.
Generate synthetic HTML and plain-text email previews (sending no mail) into
ignored `.validation/email-previews` with:

```bash
npx tsx scripts/preview-emails.ts
```

### UI verification

Follow the [UI pattern gallery and verification matrix](verification.md#ui-pattern-gallery).

## 5. Run the tests

```bash
npm run check       # next typegen + eslint . --max-warnings=0 + tsc --noEmit
npm run docs:check  # links, headings, discoverability, issue forms, help:check
npm test            # full Vitest suite (one-shot)
npm run test:watch  # Vitest watch mode
```

Application tests (`src/**/*.test.{ts,tsx}`) include pure unit tests, jsdom UI
tests, and serial PostgreSQL integration tests (`fileParallelism: false`).

### Isolated integration-test database

`src/test/setup.ts` supplies dummy fallback URLs for unit tests only; integration
tests require a real loopback database named `shbs_shipping_test` (enforced by
[database-guard.ts](../../src/test/database-guard.ts) and
[database-test-safety.ts](../../src/server/database-test-safety.ts)). Under
Vitest / `NODE_ENV=test`, [`src/server/db.ts`](../../src/server/db.ts) refuses
to construct a Prisma/pg pool or run any query, write, or `afterAll` cleanup
against a rejected URL while keeping `$disconnect()` safe and allowing unit
tests with mocked or unused DB imports to run without PostgreSQL. Never point
tests at a demo or production database.

```bash
# Bash (in PowerShell, set $env:DATABASE_URL="...")
export DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs_shipping_test"
npm run db:migrate
npm test -- --maxWorkers=1
```

To reproduce one of CI's three balanced shards locally (run shards serially if
sharing one DB):

```bash
npm test -- --shard=1/3 --maxWorkers=1
```

Recovery checkpoint integration tests (`correction-checkpoints.integration.test.ts`)
and room-allocation tests (`room-allocation.test.ts`) both use a schema-wide
`TRUNCATE` (required to fire calendar/scheduling triggers even on empty tables)
inside a 20-second fixture-specific reset hook with bounded `lock_timeout` (1 s)
and `statement_timeout` (6 s); set `SHBS_PROFILE_RECOVERY_FIXTURE=1` or
`SHBS_PROFILE_ROOM_ALLOCATION_FIXTURE=1` for phase timing diagnostics.

### Browser layout and URL smoke scripts

Run against a running loopback demo site (`TEST_BASE_URL`). Authenticated scripts
accept `SHBS_BROWSER_STATE` (staff Playwright storage-state JSON), plus optional
`SHBS_BROWSER_MODULE`, `SHBS_BROWSER_CHANNEL`, and `SHBS_BROWSER_OUTPUT` (ignored
evidence directory). None of these submit mutations.

| Script | Checks |
| --- | --- |
| `node scripts/test-code-fields.mjs` | 5-char invitation & 4-digit email code inputs (plus optional `SHBS_EMAIL_PREVIEWS`), legacy codes, EN/ZH, 390/1440 px, 200% text, 6 themes |
| `node scripts/test-table-action-layout.mjs` | Shared table-action targets (`24 px` desktop / `44 px` narrow), sticky actions and dialogs across Time Slots, Users & Roles, Tutee Roster and gallery |
| `node scripts/test-tutor-form-layout.mjs` | Tutor creation dialog layout, draft retention, focus and validation across 5 widths in EN/ZH |
| `node --test --test-concurrency=1 scripts/test-public-signup-urls.mjs` | Canonical public signup routes, permanent redirects, query preservation and feature-disabled states (see [URL convention](../reference/technical-report.md#public-signup-url-convention)) |

### Runtime packaging checks

Run daemon-free packaging, deployment-helper and archive-accounting checks:

```bash
npm run test:deployment
python3 scripts/test_image_storage_metrics.py
```

`npm run test:deployment` requires Bash (on Windows, set `SHBS_TEST_BASH` to Git
Bash) and tests `start-database.sh`, `scripts/backup.sh`,
`scripts/collect-network-evidence.sh`, `scripts/check-storage-capacity.sh`,
`scripts/assemble-runtime.mjs` and canonical file-inventory comparisons against
synthetic stubs without contacting Docker or reading `.env`.

Stage new operator-CLI sources (`admin:create`, `identity:reconcile`, `recovery`)
into `runtime-files` in `Dockerfile` so the runner copies disjoint dependency and
application layers without duplicating Next-traced files. Do **not** set `CI=1`
locally to run the four-image `image-storage` comparison against a shared daemon;
use the CI job's JSON artifacts or the Compose smoke test below. See
[verification](verification.md#required-checks) for CI packaging details.

## 6. Smoke-test the production Docker stack (optional)

Exercises production `docker-compose.yml` (app + Postgres + Caddy) against a local
build (**requires Docker**):

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
docker compose down          # add -v to drop Postgres/Caddy volumes
```

Caddy requires a public `DOMAIN` for Let's Encrypt; for localhost inspection, run
`docker compose up --build app db` and skip Caddy. Inside Compose, `DATABASE_URL`
is derived from `POSTGRES_*` (host `db`).

## Troubleshooting

- **Expired/unverifiable session cookie:** Keep `AUTH_SECRET` stable; localhost
  ports share cookies, so use separate browser profiles across worktrees.
- **`Invalid environment variables`:** Compare `.env` with `.env.example` and
  `src/env.js`.
- **Prisma can't connect:** Confirm Postgres is running and `DATABASE_URL` matches.
- **Missing table or column after sign-in:** Local DB is behind the checkout; run
  `npx prisma migrate status` then `npm run db:migrate` (no reset needed).
- **Integration tests fail to connect:** Migrate the isolated `shbs_shipping_test`
  `DATABASE_URL` before running `npm test`.
- **`next build` fails on Windows (`EPERM`):** Use `npm run build` (`--turbopack`).

## Browser tab icon (favicon)

Replace **`src/app/icon.png`** with a square PNG (512 × 512 recommended, readable
at 16 × 16). This single PNG supplies the browser tab/bookmark icon, the in-page
header `BrandMark`, and the email footer icon. Do not add a competing
`public/favicon.ico` or `src/app/favicon.ico`.
Restart dev or rebuild production, then verify against a running site with:

```bash
node --test scripts/test-tab-icon.mjs
```

## Runtime branding

Set `APP_TITLE`, `TEAM_TITLE`, `ORG_NAME`, `SUPPORT_EMAIL` and
`PROGRAM_TERM_LABEL` in `.env` and restart the server (no rebuild needed; blank
values use defaults). See [updates](../guides/deployment.md#6-updates) for VPS
recreation and [reset and redeploy](../guides/deployment.md#start-fresh-from-an-existing-deployment)
for a fresh start. Verify against a running production build with:

```bash
node --test scripts/test-runtime-branding.mjs
```

## Workflow and maintenance references

See the [user guide](../guides/user-guide.md) for product workflows and
[documentation ownership](documentation.md#retain-source-and-owned-resources)
before deleting caches or branches.
