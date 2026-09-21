# Local development & testing

Run the app locally, seed synthetic data and verify changes. Run all commands from the repository root. For production, use the [deployment runbook](deployment.md).

## Updating an existing checkout

After pulling schema changes, run `npm run db:migrate` and `npx prisma generate`, then restart the app. Apply the complete migration chain; do not reset an existing database just to upgrade it. See the [technical guide](technical-report.md) for code responsibilities and the [program reference](program-reference.md) for configuration.

On Windows, create disposable test/demo databases with UTF-8 encoding rather than
inheriting a WIN1252 template. The application stores Chinese text and emoji. A new
database can use `TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`.
Keep the existing program database separate from tests, which reset their own data.

Sibling Git worktrees can share a local `node_modules` junction. Set
`SHBS_WORKSPACE_ROOT` to the absolute common parent directory when using Turbopack;
otherwise its filesystem boundary rejects the junction. Normal standalone checkouts
need no override. The override also sets the standalone file-tracing root.

If a local Turbopack build reports a stale cached module graph, set
`SHBS_DISABLE_BUILD_CACHE=1` for that build to bypass the compiler cache without deleting it.
Normal builds retain Next's default cache behavior. `SHBS_BUILD_CPUS=1` limits local build workers.

Keep local screenshots and verification logs in ignored `outputs/` or `.validation/`.

## Prerequisites

- **Node 22 (CI baseline)** and **npm**
- A **PostgreSQL** database (one of the options below)
- *(Optional)* **Docker** — only for the full Compose smoke test at the end

## 1. Install and configure

```bash
npm ci                      # installs the locked dependencies and generates Prisma
cp .env.example .env
```

Edit `.env`. For local work you really only need `DATABASE_URL` and `AUTH_SECRET`
(generate the latter once with `npx auth secret` and keep it stable across restarts).
Sign-in is username or email + password — there is no external identity provider to configure.

The first address in `AUTH_BOOTSTRAP_ADMIN_EMAILS` becomes `HEAD` when no HEAD exists;
later entries become `ADMIN`. This promotes an existing account on sign-in; it does not
create one. Use `npm run admin:create` for a seed-free initial account, following the
[bootstrap instructions](deployment.md#create-the-first-admin-first-deploy).

> **Email-based sign-in 2FA is implemented** and applies when the `EMAIL_2FA` program feature
> and the user's 2FA preference are both enabled. Without SMTP configuration, development logs
> the single-use code instead of sending it; see `src/server/auth/two-factor.ts`.

## 2. Get a database running

Pick whichever fits your setup.

### Option A — Docker / Podman (the bundled script)

`start-database.sh` reads `DATABASE_URL` from `.env` and starts a Postgres container with
matching credentials. On Windows run it from WSL; on Linux/macOS run it directly.

```bash
./start-database.sh
```

### Option B — An existing local Postgres

Create a database and point `DATABASE_URL` at it, e.g.:

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs_program_demo"
```

## 3. Apply the schema and seed

Use a fresh local database named `shbs_program_demo`. Set `SHBS_DEMO_SEED=1` in this command's environment (PowerShell: `$env:SHBS_DEMO_SEED="1"`). The seed rejects remote hosts, production mode, and database names outside `shbs_*_demo` / `shbs_*_test`.

```bash
npm run db:migrate
npm run db:seed
npm run db:seed
npx tsx prisma/verify-demo.ts
```

Seeding creates synthetic fixtures and refreshes some values. It preserves immutable request history and is not a full reset; create a fresh database to restart a rehearsal. It can overwrite other rehearsal changes; never use it with real program data. Use `npm run admin:create` to bootstrap real deployments.

### Demo accounts and workflows

All example accounts use `Password123!`. The identifiers below work at `/signin`.

| Account | Role / example | Start |
| --- | --- | --- |
| `admin` | HEAD; collective oversight, decisions and configuration | `/admin/activity` |
| `manager@example.test` | ADMIN; management review without a tutor identity | `/admin` |
| `carol@example.edu` | COORDINATOR and tutor; interview chair and approval proposals | `/dashboard`, `/admin` |
| `alice@example.edu` | Active tutor; attendance, assignments, hours, panel voting | `/dashboard` |
| `crew@example.edu` | Crew-only member; room patrol and membership | `/patrol` |
| `iris@example.edu` | Tutor with crew membership | `/patrol` |
| `emma@example.test` | Assigned student; sessions, feedback and messages | `/student` |
| `frank@example.test` | Assigned student; pending card appeal and withdrawal review | `/student` |
| `grace@example.test` | Assigned student; tutor schedule-conflict review | `/student` |
| `kate@example.test` | Verified student still waiting for assignment | `/student` |
| `recalled@example.test` | Recalled request retained as history | `/student` |
| `withdrawn@example.test` | Approved quarter withdrawal and resubmission block | `/student` |
| `translator@example.test` | Explicit Translator, without Viewer access; pending draft | `/localization` |
| `parent@example.edu` | Ordinary viewer | `/` |
| `viewer2@example.edu` | Suspended viewer with account appeal | `/` |

The database also includes unverified survey demand before account creation, disqualification history, exact policy acceptance snapshots, school-calendar overrides, active/inactive membership, pending and resolved removals, future meetings, valid qualified interview panels, notifications, private messages, registration codes, custom pages and historical service-hour reports. The Fiona panel has a coordinator chair and a completed interview; Hana demonstrates a tied vote resolved by that chair. Bundled policy text still needs school review before publication.

Seeded survey tokens are deliberately unusable: request a new email link through the form. Local email capture is required to rehearse verification and recovery without delivering real email. Never enable a public mail-capture endpoint on a deployed site. Create coordinator proposals through the interface so their immutable target snapshots reflect the database at submission time.

## 4. Run the app

```bash
npm run dev         # http://localhost:3000
```

Open http://localhost:3000, sign in at `/signin` with a seeded account (e.g.
`admin@example.edu` / `Password123!`). Admins/coordinators land in the **SHBS Peer Tutoring
Team** management area (`/admin`);
tutors land on their combined `/dashboard` (hours, pairings, availability, and the
attendance form on one page). Tutors can edit their own name/email/password via **Settings**
in the avatar menu (`/settings`).

Switch the interface language any time with the **EN / 中文** toggle in the header.

The dev server logs each tRPC call's real handler time as `[trpc] <type> <path> <ms>` —
Use it to spot slow queries. `TRPC_DEV_DELAY=true` adds an artificial development delay; leave it unset when measuring handlers.

Try the public forms (no login required):

- **Student signup** at `/signup` reserves a survey timestamp before account verification. The request queue (`/admin/requests`) tracks verified and unverified demand. The local email link confirms the request and creates the account; assignment starts a fixed verification deadline if it is still unverified.
- **Tutor application** at `/tutor-signup` starts recruitment. Assign at least three active tutor accounts, a highest-ranking management chair, and explicit subject qualification coverage. Every panelist votes; the majority determines the outcome and the chair breaks ties. A coordinator chair's decision requires ADMIN/HEAD approval.
- **Crew application** at `/crew-signup` starts the separate crew membership workflow.

Follow the [role guide](user-guide.md) using the [demo accounts](#demo-accounts-and-workflows). Real SMTP setup and final school policy approval remain launch configuration work; local capture delivers no external mail.

## 5. Run the tests

```bash
npm test            # one-shot
npm run test:watch  # watch mode
```

Application tests live under `src/**/*.test.{ts,tsx}`:

- **Pure unit tests** (e.g. `src/lib/service-hours.test.ts`) — no database needed.
- **Integration tests** (e.g. `src/server/api/routers/scoping.test.ts`) — exercise the tRPC
  routers against a **real database**, verifying role/ownership scoping. They run serially
  (`fileParallelism: false`) and need a reachable `DATABASE_URL` with the schema applied.
- **UI render tests** exercise interactive controls in jsdom without starting the website.

`src/test/setup.ts` supplies `AUTH_SECRET` and a default `DATABASE_URL`, so the unit
tests pass out of the box. For the integration tests, set `DATABASE_URL` to a database you've
run `db:migrate` against first. For example:

```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs_shipping_test" npm test -- --maxWorkers=1
```

Use a separate loopback database named `shbs_shipping_test` for the complete suite. The shared
guard requires a local `_test` database, and individual integration suites apply narrower name
allowlists; an arbitrary `_test` name does not satisfy every suite. Create the database, set
`DATABASE_URL` for both `npm run db:migrate` and `npm test -- --maxWorkers=1`, and never point these
destructive fixtures at a development site or production database.

Lint and type-check the same way CI does:

```bash
npm run check       # eslint . + tsc --noEmit
npm run docs:check  # documentation links, headings and maintenance regressions
```

Email ownership and notification regressions live in `src/server/auth/account-emails.test.ts`, with migration compatibility in `account-email-migration.test.ts` and component interaction coverage in `src/app/_components/account-emails.test.tsx`. Include expiry, failed delivery, legitimate registration, simultaneous claims, removal/recovery, gating and retry scenarios. Use synthetic accounts and captured mail for browser rehearsal; follow [email operations](deployment.md#optional-notification-delivery) for real deployments.

## 6. Smoke-test the production Docker stack (optional)

This exercises the same `docker-compose.yml` used in production (app + Postgres + Caddy),
but against a local build. **Requires Docker** — it can't run on a Docker-less host.

```bash
# Build the app image locally and bring everything up.
docker compose up --build -d

docker compose ps          # app should be running; db healthy
docker compose logs -f app # watch migrations (prisma migrate deploy) + startup
```

Notes for local runs:

- Caddy expects a real `DOMAIN` with a public DNS record for Let's Encrypt, so HTTPS won't
  fully work on localhost. To just test the app + DB, you can `docker compose up --build app db`
  and skip Caddy, or temporarily publish the app's port for inspection.
- The app derives its `DATABASE_URL` from `POSTGRES_*` (host `db`) inside Compose — you don't
  set the app's DB URL directly there.

Tear down (add `-v` to also drop the Postgres/Caddy volumes):

```bash
docker compose down        # or: docker compose down -v
```

## Troubleshooting

- **Expired/unverifiable session or old development cookie** — sign in again when prompted. Keep `AUTH_SECRET` stable; localhost ports share cookies, so use separate browser profiles for worktrees with different secrets. If a fresh sign-in still fails, investigate the running process configuration. Confirm a stable secret on every server instance, the canonical `AUTH_URL` and proxy HTTPS settings. A private browser session helps distinguish stale cookies from a server configuration problem.

- **`Invalid environment variables` on startup** — a required var in `.env` is missing or
  malformed. Check it against `.env.example` and the schema in `src/env.js`.
- **Prisma can't connect** — confirm your database is running and `DATABASE_URL` host/port
  match it.
- **Sign-in succeeds but the admin page reports a missing table or column** (for example,
  `StudentSurvey` or `Tutee.signupSubmittedAt`) — the local database is behind the checked-out
  application. Check `npx prisma migrate status`, then run `npm run db:migrate` against the
  configured local database and reload the page. Apply pending migrations after pulling schema
  changes, even when the public homepage loads successfully; resetting or reseeding is unnecessary.
- **Integration tests fail to connect** — they need a separate real test DB; run `db:migrate` against the
  `DATABASE_URL` you pass to `npm test`.
- **`next build` fails on Windows (file-tracing / EPERM)** — expected for the classic webpack
  build; this project builds with `--turbopack` (`npm run build`), which avoids it.

## Workflow and maintenance references

See the [user guide](user-guide.md) for record corrections and participant workflows, and [repository hygiene](contributing.md#documentation-and-repository-hygiene) before deleting runtime fixtures or caches. Store local evidence in ignored `outputs/` or `.validation/`.

## Browser tab icon (favicon)

Replace **`src/app/icon.png`** with your logo as an actual PNG image, keeping the
filename. Use a square image (512 × 512 recommended) with a simple design that
remains readable at 16 × 16. Transparency is supported. The current artwork is a
temporary placeholder until a replacement logo is supplied.

Next.js serves this file and generates the browser icon link on every page,
including pages with their own titles. No TypeScript or environment changes are
needed. Keep this as the single icon source; do not add a competing
`public/favicon.ico` or `src/app/favicon.ico`.

Restart the development server after replacing the image. For production, rebuild
and redeploy the app (including rebuilding the Docker image if used). If a browser
still shows the old icon, close and reopen the tab or clear its cached site data.
This controls the browser tab/bookmark icon, not an image inside the page.

With the app running locally, verify the icon and its page metadata with:

```bash
node --test scripts/test-tab-icon.mjs
```

The smoke test defaults to `http://localhost:3000`; set `TEST_BASE_URL` to test a
different local port. It only reads public pages and image assets.
