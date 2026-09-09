# Local development & testing

Coordinator approval and audit changes require the migration described in
[COORDINATOR-APPROVALS.md](COORDINATOR-APPROVALS.md). The approval integration suite uses
explicitly allowed local test databases (the combined suite uses `shbs_shipping_test`); it resets that test
database between cases. Run tests serially with `npm test -- --maxWorkers=1`.

How to run the SHBS Peer Tutoring app on your own machine, point it at a local database,
seed sample data, run the test suite, and (optionally) smoke-test the production Docker
stack. For production deployment see [README-DEPLOY.md](./README-DEPLOY.md).

## Prerequisites

- **Node 22 (CI baseline)** and **npm**
- A **PostgreSQL** database (one of the options below)
- *(Optional)* **Docker** — only for the full Compose smoke test at the end

## 1. Install and configure

```bash
npm install                 # installs deps and runs `prisma generate`
cp .env.example .env
```

Edit `.env`. For local work you really only need `DATABASE_URL` and `AUTH_SECRET`
(generate the latter with `npx auth secret`; in development it may even be left blank).
Sign-in is username or email + password — there is no external identity provider to configure.

Put your own email in `AUTH_BOOTSTRAP_ADMIN_EMAILS` so that account is promoted to `ADMIN`
on its first sign-in.

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

### Option C — Embedded Postgres (no Docker, throwaway)

Useful on machines without Docker. In a scratch directory, install
[`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) and start it on a
spare port, then point `DATABASE_URL` at it:

```bash
# in a temp dir
npm i embedded-postgres
node -e "import('embedded-postgres').then(async ({default:EP})=>{const pg=new EP({port:5433,user:'postgres',password:'password',persistent:false});await pg.initialise();await pg.start();await pg.createDatabase('shbs_program_demo');console.log('up on 5433');})"
```

Then use `DATABASE_URL="postgresql://postgres:password@localhost:5433/shbs_program_demo"`.
This is the approach used to verify migrations, seeding, and the row-scoping tests on a
Docker-less Windows box.

## 3. Apply the schema and seed

Use a fresh local database named `shbs_program_demo`. Set `SHBS_DEMO_SEED=1` in this command's environment (PowerShell: `$env:SHBS_DEMO_SEED="1"`). The seed rejects remote hosts, production mode, and database names outside `shbs_*_demo` / `shbs_*_test`.

```bash
npm run db:migrate
npm run db:seed
npm run db:seed
npx tsx prisma/verify-demo.ts
```

Seeding creates synthetic fixtures and refreshes some values. It preserves immutable request history and is not a full reset; create a fresh database to restart a rehearsal. It can overwrite other rehearsal changes; never use it with real program data. See the [demo database guide](docs/demo-database.md) for all roles, example workflows, and database design decisions. Use `npm run admin:create` to bootstrap real deployments.

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
handy for spotting a slow query. (Unlike the T3 default, there's no artificial request delay
unless you set `TRPC_DEV_DELAY=true`, so the numbers reflect true DB + compute cost.)

Try the public forms (no login required):

- **Student signup** at `/signup` reserves a survey timestamp before account verification. The request queue (`/admin/requests`) tracks verified and unverified demand. The local email link confirms the request and creates the account; assignment starts a fixed verification deadline if it is still unverified.
- **Tutor application** at `/tutor-signup` starts recruitment. Assign at least three active tutor accounts, a highest-ranking management chair, and explicit subject qualification coverage. Every panelist votes; the majority determines the outcome and the chair breaks ties. A coordinator chair's decision requires ADMIN/HEAD approval.
- **Crew application** at `/crew-signup` starts the separate crew membership workflow.

Follow the [role guide](docs/user-guide.md) and [demo walkthrough](docs/demo-database.md). Real SMTP setup and final school policy approval remain launch configuration work; local capture delivers no external mail.

## 5. Run the tests

```bash
npm test            # one-shot
npm run test:watch  # watch mode
```

Two kinds of tests live under `src/**/*.test.ts`:

- **Pure unit tests** (e.g. `src/lib/service-hours.test.ts`) — no database needed.
- **Integration tests** (e.g. `src/server/api/routers/scoping.test.ts`) — exercise the tRPC
  routers against a **real database**, verifying role/ownership scoping. They run serially
  (`fileParallelism: false`) and need a reachable `DATABASE_URL` with the schema applied.

`src/test/setup.ts` supplies `AUTH_SECRET` and a default `DATABASE_URL`, so the unit
tests pass out of the box. For the integration tests, set `DATABASE_URL` to a database you've
run `db:migrate` against first. Example with embedded Postgres (Option C):

```bash
DATABASE_URL="postgresql://postgres:password@localhost:5433/shbs_shipping_test" npm test -- --maxWorkers=1
```

The workflow regression suite truncates its disposable database between cases. Run it only with
a separate local database whose name ends in `_test` (or `shbs_functional_review`); it refuses other
targets. Create that database, set `DATABASE_URL` for the test command, and run `npm run db:migrate`
before `npm test -- --maxWorkers=1`. Never point this suite at the development site or a production
database. Tests run serially to keep resource use low.

Lint and type-check the same way CI does:

```bash
npm run check       # eslint . + tsc --noEmit
```

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

- **`Invalid environment variables` on startup** — a required var in `.env` is missing or
  malformed. Check it against `.env.example` and the schema in `src/env.js`.
- **Prisma can't connect** — confirm your database is running and `DATABASE_URL` host/port
  match it (the embedded-Postgres example uses port **5433**, not 5432).
- **Integration tests fail to connect** — they need a separate real test DB; run `db:migrate` against the
  `DATABASE_URL` you pass to `npm test`.
- **`next build` fails on Windows (file-tracing / EPERM)** — expected for the classic webpack
  build; this project builds with `--turbopack` (`npm run build`), which avoids it.

## Database correction workflow

- Attendance Submissions → Correct Attendance updates a whole merged block, recalculates hours,
  withdraws corrected auto-absence cards, reconciles removal/pairing state, and reopens affected
  crew decisions while removing their linked deductions. A reason and current record version are
  required. Existing survey students are editable; changing the block's membership is separate work.
- Crew → Patrol History and Corrections edits room, count, observation time and notes; timestamps
  explicitly use Asia/Shanghai. Patrol credit remains the configured per-patrol amount.
- Tutee Roster → Edit Details works for pending, active and inactive profiles, including preferred
  contact, subject choices and availability. Assignment/removal remain their own operations.
- Account / tutor settings → Change Account Email verifies the destination before changing both
  account and roster email. This requires configured email delivery, independently of the 2FA flag.
- Audit Log keeps correction snapshots with pagination. Snapshots are evidence, not executable
  undo instructions. Card/application undo rejects changes made after the original decision.

After generating a changed Prisma client, restart the local Next server so its cached database
client includes the new fields. Confirmed product-policy decisions are in `REVIEW-QUESTIONS.md`.

Student workflow navigation and product rules are documented in [STUDENT-WORKFLOWS.md](STUDENT-WORKFLOWS.md). Tests must use the isolated local `shbs_functional_review` or a database ending in `_test`; never run the workflow fixture cleanup against the normal development database. Schema changes require restarting the local Next process after regenerating Prisma so its cached client includes the new delegates.
