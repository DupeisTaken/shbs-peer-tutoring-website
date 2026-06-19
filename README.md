# SHBS Peer Tutoring

A web app for managing a high-school peer-tutoring program: tutor–tutee pairings,
attendance submissions, tutor-meeting tracking, and automatic service-hour accounting.

Tutors sign in, see their schedule, and submit attendance with quality ratings for each
session. The app derives service hours from each submission and rolls them up by month.
Coordinators and admins manage the roster (tutors, tutees, rooms, pairings, terms),
run tutor meetings, apply per-tutor hour adjustments, record tutee punishments, and
review the monthly summary.

## Stack

Built on the [T3 Stack](https://create.t3.gg/):

- **[Next.js](https://nextjs.org)** 15 (App Router) + **React** 19
- **[Auth.js](https://authjs.dev)** (NextAuth v5) — email + password (Credentials), JWT sessions
- **[Prisma](https://prisma.io)** 6 + **PostgreSQL**
- **[tRPC](https://trpc.io)** 11 for the typed API
- **[Tailwind CSS](https://tailwindcss.com)** 4
- **[Vitest](https://vitest.dev)** for unit/integration tests

## How it works

### Roles

Every signed-in user has one role (stored on `User.role`, carried in the JWT):

| Role          | Can do                                                              |
| ------------- | ------------------------------------------------------------------- |
| `TUTOR`       | View their own dashboard and submit attendance for their pairings.  |
| `COORDINATOR` | Tutor abilities plus access to the `/admin` management area.        |
| `ADMIN`       | Everything, including managing users/roles.                         |

There is no self-service sign-up: a `User` account (with a password) must exist before
someone can sign in — created by the seed or by an admin. An account whose email is listed
in `AUTH_BOOTSTRAP_ADMIN_EMAILS` is promoted to `ADMIN` on its first sign-in; after that,
admins promote others in-app. A signed-in `User` is optionally linked to a domain `Tutor`
record (matched by email) so tutors see their own pairings.

### Authentication

Sign-in is **email + password** (Auth.js Credentials provider; passwords are hashed
server-side with scrypt — `src/server/auth/password.ts`). Sessions are JWTs carrying the
user's `role` and `tutorId`.

**Email-based 2FA (one-time codes) is scaffolded but not implemented.** The schema
(`User.twoFactorEnabled`, `EmailVerificationCode`), the second-factor seam
(`src/server/auth/two-factor.ts`), and a provider-agnostic email seam
(`src/server/email/sender.ts`) are in place; wiring them up — and choosing an email
provider — is future work.

### Routes

- `/` — public landing page with sign-in.
- `/signin` — public email + password sign-in form.
- `/dashboard`, `/attendance` — tutor area (any signed-in user).
- `/admin/*` — management area (coordinator/admin): tutors, tutees, rooms, pairings,
  submissions, meetings, adjustments, punishments, users, and the monthly summary.

Route gating is handled by `src/middleware.ts` (Edge); the tRPC procedures
(`src/server/api/routers/`) enforce role and ownership checks server-side.

### Service hours

`src/lib/service-hours.ts` is the single source of truth (pure and unit-tested). For each
attendance submission it computes, server-side, and stores on the `Session` row:

- **duration** = `endMin − startMin`
- **factor** — `0` for an excused tutee absence or tutor absence, `1` for an unexcused tutee
  absence (tutor still credited solo), otherwise `tuteeCount + 1`.
- **count** = duration rounded to the nearest half-hour (≤10 min leftover rounds down) × factor.

A tutor's monthly total = `SUM(session shCount)` adjusted by `ServiceHourAdjustment` rows
(`EXTRA` adds, `PUNISHMENT` subtracts).

## Getting started

Prerequisites: **Node 20+**, **npm**, and a **PostgreSQL** database.

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill in the values (see below)
npm run db:push                  # apply the schema to your database
npm run db:seed                  # sample data + dev login users (see README-LOCAL.md)
npm run dev                      # http://localhost:3000
```

The seed creates dev login accounts (e.g. `admin@example.edu`) you can sign in with —
credentials are printed by `db:seed` and documented in README-LOCAL.md.

The minimum `.env` you need for local work is `DATABASE_URL` and `AUTH_SECRET`.
See **[README-LOCAL.md](./README-LOCAL.md)** for a full local setup and testing walkthrough
(including running a throwaway Postgres without Docker).

### Environment variables

All variables are validated at startup by `src/env.js`. See `.env.example` for the full,
commented list. The essentials:

| Variable                       | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `AUTH_SECRET`                  | Session/JWT signing secret (`npx auth secret`).          |
| `AUTH_BOOTSTRAP_ADMIN_EMAILS`  | Comma-separated emails granted `ADMIN` on first sign-in. |
| `DATABASE_URL`                 | PostgreSQL connection string.                            |

## Scripts

| Script                | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Next.js dev server (Turbopack).                       |
| `npm run build`       | Production build (Turbopack — see note below).        |
| `npm run start`       | Serve the production build.                           |
| `npm run check`       | `next lint` + `tsc --noEmit`.                          |
| `npm test`            | Run the Vitest suite once.                             |
| `npm run test:watch`  | Vitest in watch mode.                                  |
| `npm run db:push`     | Push the Prisma schema to the DB (no migration files). |
| `npm run db:generate` | Create + apply a dev migration.                        |
| `npm run db:migrate`  | Apply migrations (`prisma migrate deploy`).            |
| `npm run db:seed`     | Seed sample reference data.                            |
| `npm run db:studio`   | Open Prisma Studio.                                    |

> **Build note:** `build` uses `--turbopack` on purpose. The classic webpack build can fail
> on Windows during output file-tracing; Turbopack still emits a working standalone output.

## Project layout

```
src/
  app/                 # Next.js App Router
    (tutor)/           # dashboard + attendance (signed-in users)
    (admin)/admin/     # roster & program management (coordinator/admin)
    api/               # Auth.js + tRPC route handlers
  server/
    api/routers/       # tRPC routers (tutor, admin) + tests
    auth/              # Auth.js config (Credentials/password, role/JWT logic)
                       #   password.ts (scrypt) + two-factor.ts (2FA scaffolding)
    email/sender.ts    # provider-agnostic email seam (scaffolding)
    db.ts              # Prisma client
  lib/service-hours.ts # service-hour computation (pure, unit-tested)
  trpc/                # tRPC client/server wiring
prisma/
  schema.prisma        # data model
  seed.ts              # sample data
```

## Deployment

Production runs as a single-VPS Docker Compose stack (Caddy + app + Postgres) with the
image built in CI and pulled to the host. See **[README-DEPLOY.md](./README-DEPLOY.md)**.
