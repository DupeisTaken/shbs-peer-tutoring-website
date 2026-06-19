# Local development & testing

How to run the SHBS Peer Tutoring app on your own machine, point it at a local database,
seed sample data, run the test suite, and (optionally) smoke-test the production Docker
stack. For production deployment see [README-DEPLOY.md](./README-DEPLOY.md).

## Prerequisites

- **Node 20+** and **npm**
- A **PostgreSQL** database (one of the options below)
- *(Optional)* **Docker** — only for the full Compose smoke test at the end

## 1. Install and configure

```bash
npm install                 # installs deps and runs `prisma generate`
cp .env.example .env
```

Edit `.env`. For local work you really only need `DATABASE_URL` and `AUTH_SECRET`
(generate the latter with `npx auth secret`; in development it may even be left blank).
Sign-in is email + password — there is no external identity provider to configure.

Put your own email in `AUTH_BOOTSTRAP_ADMIN_EMAILS` so that account is promoted to `ADMIN`
on its first sign-in.

> **Email-based 2FA is scaffolded, not implemented** (see `src/server/auth/two-factor.ts`).
> No email provider or related env vars are needed yet.

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
DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs-peer-tutoring-website"
```

### Option C — Embedded Postgres (no Docker, throwaway)

Useful on machines without Docker. In a scratch directory, install
[`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) and start it on a
spare port, then point `DATABASE_URL` at it:

```bash
# in a temp dir
npm i embedded-postgres
node -e "import('embedded-postgres').then(async ({default:EP})=>{const pg=new EP({port:5433,user:'postgres',password:'password',persistent:false});await pg.initialise();await pg.start();await pg.createDatabase('shbs-peer-tutoring-website');console.log('up on 5433');})"
```

Then use `DATABASE_URL="postgresql://postgres:password@localhost:5433/shbs-peer-tutoring-website"`.
This is the approach used to verify migrations, seeding, and the row-scoping tests on a
Docker-less Windows box.

## 3. Apply the schema and seed

```bash
npm run db:push     # push the Prisma schema (no migration history)
npm run db:seed     # sample data + dev login accounts (needed to sign in locally)
```

`prisma/seed.ts` is idempotent (fixed ids + upserts), so it's safe to re-run. It also
creates **dev login accounts** so you can actually sign in:

| Email               | Role    | Password       | Notes                                  |
| ------------------- | ------- | -------------- | -------------------------------------- |
| `admin@example.edu` | `ADMIN` | `Password123!` |                                        |
| `alice@example.edu` | `TUTOR` | `Password123!` | head interviewer on a seeded applicant |
| `bob@example.edu`   | `TUTOR` | `Password123!` |                                        |
| `evan@example.edu`  | `TUTOR` | `Password123!` | inactive tutor → pending-approval gate |

These exist only for local development — change `DEV_PASSWORD` in `prisma/seed.ts` (and
don't seed them) before any real deployment. Use `npm run db:studio` to browse the data
in Prisma Studio.

> Use `npm run db:generate` instead of `db:push` if you want to create/apply a real
> migration during schema development.

## 4. Run the app

```bash
npm run dev         # http://localhost:3000
```

Open http://localhost:3000, sign in at `/signin` with a seeded account (e.g.
`admin@example.edu` / `Password123!`). Admins/coordinators land in the `/admin` area;
tutors land on their combined `/dashboard` (hours, pairings, availability, and the
attendance form on one page).

Try the public forms (no login required):

- **Tutee signup** at `/signup` → creates a `PENDING` tutee under **Admin → Tutees**, where
  you can assign it to a tutor in one click (the seed includes one example pending signup).
  The assigned tutor then picks the slot on their dashboard.
- **Tutor application** at `/tutor-signup` → creates a `PENDING` application under
  **Admin → Tutor applications**, where you assign up to three interviewers (one head). Sign
  in as the head (`alice@example.edu`) to schedule the interview from the dashboard — the
  seed wires Alice as head of one applicant.

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
run `db:push` against first. Example with embedded Postgres (Option C):

```bash
DATABASE_URL="postgresql://postgres:password@localhost:5433/shbs-peer-tutoring-website" npm test
```

The integration tests use `test-`-prefixed fixture ids so they won't collide with seed data.

Lint and type-check the same way CI does:

```bash
npm run check       # next lint + tsc --noEmit
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
- **Integration tests fail to connect** — they need a real DB; run `db:push` against the
  `DATABASE_URL` you pass to `npm test`.
- **`next build` fails on Windows (file-tracing / EPERM)** — expected for the classic webpack
  build; this project builds with `--turbopack` (`npm run build`), which avoids it.
