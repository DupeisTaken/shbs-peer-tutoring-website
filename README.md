# SHBS Peer Tutoring

A web app for managing a high-school peer-tutoring program: tutor–tutee pairings,
attendance submissions, tutor-meeting tracking, and automatic service-hour accounting.

Tutors sign in, see their schedule, and submit attendance with quality ratings for each
session. The app derives service hours from each submission and rolls them up by month.
Coordinators and admins manage the roster (tutors, tutees, rooms, pairings, terms),
run tutor meetings (each tutor marked Present / Excused Absent / Unexcused Absent — an
unexcused absence docks 0.125 service hours; inactive tutors are exempt), apply per-tutor
hour adjustments, review tutee discipline cards, broadcast announcements, and review the
monthly summary (with a month-picker). The interface is available in English and Chinese.

## Stack

Built on the [T3 Stack](https://create.t3.gg/):

- **[Next.js](https://nextjs.org)** 15 (App Router) + **React** 19
- **[Auth.js](https://authjs.dev)** (NextAuth v5) — email + password (Credentials), JWT sessions
- **[Prisma](https://prisma.io)** 6 + **PostgreSQL**
- **[tRPC](https://trpc.io)** 11 for the typed API
- **[Tailwind CSS](https://tailwindcss.com)** 4
- **[next-intl](https://next-intl.dev)** for runtime localization (English / 中文)
- **[Vitest](https://vitest.dev)** for unit/integration tests

## How it works

### Roles

Every signed-in user has one role (stored on `User.role`, carried in the JWT):

| Role          | Can do                                                              |
| ------------- | ------------------------------------------------------------------- |
| `VIEWER`      | Read-only access to the `/admin` area. Cannot mutate anything (queries use `viewerProcedure`, mutations stay on `adminProcedure`), and personal contact details (emails / phone / preferred contact) are masked server-side. |
| `TUTOR`       | View their own dashboard and submit attendance for their pairings.  |
| `COORDINATOR` | Tutor abilities plus access to the `/admin` management area.        |
| `ADMIN`       | Everything, including managing users/roles.                         |
| `HEAD`        | Singleton program leader; all admin abilities plus leadership transfer. |

Admins can also tick **"Can tutor"** on the Users & Roles page for an admin/coordinator,
which links them to an (active) `Tutor` record so they can use both areas; unticking
deactivates and unlinks it.

Public tutee and tutor application forms do not create logins. A user can sign in after an
admin provisions an account, after redeeming an admin-issued registration code at `/register`,
or after completing the feature-gated read-only `/viewer-signup` flow. The first email in
`AUTH_BOOTSTRAP_ADMIN_EMAILS` is promoted to the singleton `HEAD`; later entries become `ADMIN`.
A signed-in `User` is optionally linked to a domain `Tutor` record so tutors see their own pairings.

A coordinator/admin who is **also** a tutor (their account links to a `Tutor` record) can use
both areas: sign-in lands them on `/admin` first, and the user menu shows **Enter tutor area** /
**Enter admin area** links to switch between `/admin` and `/dashboard`.

### Authentication

Sign-in is **username or email + password** (Auth.js Credentials provider; passwords are
hashed server-side with scrypt — `src/server/auth/password.ts`). The identifier is matched
against `User.email` or the linked `Tutor.username`. Sessions are JWTs carrying the user's
`role` and `tutorId`.

Each tutor has a **username** (default: first initial + last name, e.g. `jsmith`), managed
on the admin Tutors screen and usable as an alternate sign-in identifier
(`src/server/auth/username.ts`).

When an applicant is **accepted**, the program issues a single-use **registration code** bound to
their email (re-viewable on `/admin/registration-codes`). They redeem it at **`/register`** — entering
the code, verifying their email with an emailed one-time code, and setting their own name, grade, and
password — which creates a fully-verified `User` login linked to their tutor record. (An admin can
alternatively **send a setup link** from `/admin/users`.) Any login that arrives unverified is routed
through `/onboarding/email` on first sign-in (`User.emailVerifiedAt` records completion so it doesn't
repeat).

Tutors an admin adds directly start with **no login**. From `/admin/tutors`, **"Send setup
link"** provisions their `User` and emails a set-your-password link (the link is also shown for
the admin to copy if email delivery isn't configured); following it sets the password, confirms
the email, and drops them on the dashboard. The roster's **Account** column shows who still needs
setting up. Forgetting a username? The reset-password screen reveals it after the email is
verified.

**Email delivery uses Aliyun Direct Mail (SMTP)** via `src/server/email/sender.ts` (nodemailer).
The forgot-password flow and email-based 2FA codes use the same sender. When the SMTP env vars
aren't set, it logs messages in development and warns in production, so local work still runs.
Configure it with the `SMTP_*` / `EMAIL_FROM` vars (see [README-DEPLOY.md](./README-DEPLOY.md)
for the Aliyun console setup). When the `EMAIL_2FA` program feature and a user's 2FA preference
are both enabled, sign-in verifies the password and then requires a single-use, five-character
emailed code (`src/server/auth/two-factor.ts`).

### Routes

- `/` — public landing page with three CTAs: request a tutor, apply to tutor, and team sign-in.
- `/signup` — **public** tutee signup form: name, contact details (including a required
  free-text "how can we reach you?"), first/second course choice (from the admin-managed
  catalog), available time slots, and a typed rulebook signature. Shows the current program
  term (e.g. `25-26 S2`); the agreement checkbox unlocks only after the applicant opens and
  reads the policy in a modal. Creates a `PENDING` tutee for an admin to review and assign.
- `/tutor-signup` — **public** tutor *application*: name, contact email, a required
  "how can we reach you?" field, and up to three intended courses. For each course the applicant reports how they're qualified — took the
  class (+ grade), holds an AP score (only offered for AP-tagged courses, and only entered
  once they confirm they have one), and/or self-studied it (+ a note on how they qualify).
  Creates a `PENDING` `TutorApplication` — **no login is created**; the admin team reviews
  and arranges an interview.
- `/signin` — public **team sign-in** form (username or email + password) for tutors,
  coordinators, and admins, with a **forgot-password** link.
- `/forgot-password`, `/reset-password` — public password-reset flow; the reset link is emailed
  via Aliyun Direct Mail (or logged server-side in dev when SMTP isn't configured).
- `/onboarding/email` — first-login gate where a new tutor sets their own password and
  confirms their contact email / 2FA preference before reaching the dashboard.
- `/dashboard` — tutor home (any signed-in tutor): live monthly service hours, pairings
  (with default-slot picker), availability, the attendance form (which can **merge several
  courses into one block** — see Service hours), interviews they're on the panel for, and the
  room schedule — all on one page.
- `/settings` — tutor self-service: edit alternative name(s) and contact email, and change
  password (current password required). Linked from the avatar menu.
- `/admin/*` — the **SHBS Peer Tutoring Team** management area (coordinator/admin). The nav is
  grouped into **Tutors** (roster, applications, meetings, service hours, hour adjustments),
  **Tutees** (roster, signup requests, discipline cards), **Scheduling & Records** (pairings,
  attendance submissions, time slots, courses & levels, rooms), and **Administration** (policy
  documents, audit log, users & roles), plus an **Activity** status board and **Announcements**.

Route gating is handled by `src/middleware.ts` (Edge); the tRPC procedures
(`src/server/api/routers/`) enforce role and ownership checks server-side.

### Tutee signup & scheduling

Students request help through the public `/signup` form → a `PENDING` `Tutee`. Pending signups
queue on **Signup Requests** (`/admin/requests`), processed earliest-first. There an admin
assigns **each course choice to a tutor** (e.g. first choice → tutor A, second → tutor B) from
a dropdown that previews each tutor's current workload; submitting creates a pairing per
assignment and flips the tutee to `ACTIVE`. If a choice was left blank it shows grayed/disabled
and the request stays in the queue. The **tutor then picks the default time slot** for each
pairing from their own dashboard (slots stay reference-only — actual session times are entered
on each attendance submission).

Prospective tutors apply through the public `/tutor-signup` form (intended courses + grades).
On the **Tutor applications** screen an admin assigns a three-tutor interview panel (one marked
**head**); the head schedules the interview time from their dashboard, and the interview shows
up for every panelist. The public form never creates a login — but **accepting** an application
auto-provisions the tutor's `User` account (see Authentication).

Scheduling is built around an admin-managed **time-slot catalog** (`/admin/timeslots`) and a
**subject catalog** (`/admin/subjects`). Subjects belong to an admin-managed **level catalogue**
(`SubjectLevel`, e.g. AP / Honors / Standard); a level flagged **AP-scored** gates the AP-score
field on tutor applications. Pairings are scheduled by **picking a published time slot** on the
Pairings page (the slot sets the day/start/end). Tutors and tutees mark availability against the
slots. Rooms can have recurring **unavailability periods** (`/admin/rooms`); the slot×room
**room grid** (on the Pairings page, and read-only on the tutor dashboard) shows occupancy and
blocked cells.

### Service hours

`src/lib/service-hours.ts` is the single source of truth (pure and unit-tested). For each
attendance submission it computes, server-side, and stores on the `Session` row:

- **duration** = `endMin − startMin`
- **factor** — `0` for an excused tutee absence or tutor absence, `1` for an unexcused tutee
  absence (tutor still credited solo), otherwise `tuteeCount + 1`.
- **count** = duration rounded to the nearest half-hour (≤10 min leftover rounds down) × factor.

A tutor's monthly total = `SUM(session shCount)` adjusted by `ServiceHourAdjustment` rows
(`EXTRA` adds, `PUNISHMENT` subtracts).

**Merged sessions.** A tutor running several courses in one combined block can tick the other
pairings on the attendance form. Each course is recorded as its own `Session` (linked by
`mergeGroupId`), but the block's clock time is **counted once** — full hours land on the primary
session and the merged siblings carry `0`, so two courses in one hour never double-count.

### Concurrency

High-risk admin actions (assigning a signup, changing a tutee/application status, assigning an
interview panel, reviewing a card, deciding an interview) use **optimistic version checks**:
the client sends the `updatedAt` it loaded, and a conditional write is rejected with a
`CONFLICT` if another coordinator changed the row first (`src/server/concurrency.ts`). Mutating
admin actions are also recorded to an **audit log** (`/admin/audit`) with one-click undo where
the inverse is well-defined.

### Internationalization

UI copy is localized with **next-intl**. Strings live in `messages/<locale>.json` (`en`, `zh`)
and are rendered via `t("…")` — never hardcoded. The active locale comes from the `NEXT_LOCALE`
cookie (a language switcher in the header sets it; there is no locale routing, so the auth
middleware is untouched). Config is in `src/i18n/request.ts`; client-safe constants in
`src/i18n/config.ts`. Orgs can re-word the app without editing the files by setting the
`MESSAGES_OVERRIDE` env to a JSON object that is deep-merged over the active locale.

### Performance

Aggregations run **in the database**, not in Node: per-tutee attendance/discipline stats
(`admin.tuteeStats`) and the per-tutor monthly totals (`admin.monthlySummary`) use Prisma
`groupBy`, so they return roughly one row per tutor/tutee rather than pulling every session
or card row into memory — they stay cheap as history grows. History-spanning lists default to
a window (e.g. submissions default to the current month) instead of loading everything.

Reads are tuned with React Query: a 30 s default `staleTime`, raised to a few minutes for the
rarely-changing reference catalogs (courses, terms, rooms, time slots — `REFERENCE_STALE_TIME`).
Mutations call `invalidate()`, so edits still refetch immediately regardless of `staleTime`.

Every tRPC procedure's real handler time is logged in dev (`[trpc] <type> <path> <ms>` — see
`timingMiddleware` in `src/server/api/trpc.ts`). The T3 starter's artificial request delay is
**opt-in** via `TRPC_DEV_DELAY=true` (off by default) so local dev isn't slowed and the timing
log reflects true DB + compute cost.

### Longevity

The program is designed to run for many years unattended:

- **No wall-clock expiry.** Periods advance only by an explicit admin **Refresh**, never because a
  date passed — so nothing silently breaks as years roll over. The refresh engine (`src/lib/period.ts`)
  is pure and unit-tested, including a simulation of 15 years of quarterly refreshes that asserts
  quarters, semesters, school years, and graduation cohorts never drift.
- **Known horizon.** School years are stored as two digits (`25-26`) assumed to be 21st-century;
  this is correct through ~2098. `schoolYearEndYear` is the single place that maps the suffix to a
  calendar year — widen it to a 4-digit start year to go further.
- **Bounded growth.** At program scale, data accrues modestly over a decade (thousands of rows).
  Heavy reads stay cheap because they're indexed by period (`[schoolYear, quarter]`), aggregated in
  Postgres (`groupBy`), or windowed (submissions default to the current month; pairings to the active
  term). Refreshes archive rather than delete, so history is preserved without bloating live views.
- **Operations.** Daily Postgres backups with rotation (`scripts/backup.sh`), a pinned lockfile, and
  CI-built images keep deploys reproducible — see [README-DEPLOY.md](./README-DEPLOY.md).

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
| `NEXT_PUBLIC_APP_TITLE`        | Public brand title (default `SHBS Peer Tutoring`).       |
| `NEXT_PUBLIC_TEAM_TITLE`       | Team/admin-area title (default `SHBS Peer Tutoring Team`).|
| `MESSAGES_OVERRIDE`            | Optional JSON deep-merged over locale messages (white-label copy). |
| `TRPC_DEV_DELAY`               | Dev only: `true` injects a 100–500ms delay per tRPC call (waterfall debugging). Off by default. |
| `EMAIL_FROM` / `SMTP_PASSWORD` | Aliyun Direct Mail sender address + SMTP password. Both set ⇒ email is live; else dev-logs. |
| `SMTP_HOST` / `SMTP_PORT`      | Direct Mail SMTP host (default `smtpdm.aliyun.com`) and port (default `465`). |

Branding: the two `NEXT_PUBLIC_*` titles let you rebrand without code changes — they're
read through `src/lib/branding.ts` and fall back to the defaults above. Because they're
`NEXT_PUBLIC_*`, they're inlined at build time, so rebuild after changing them.

## Scripts

| Script                | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Next.js dev server (Turbopack).                       |
| `npm run build`       | Production build (Turbopack — see note below).        |
| `npm run start`       | Serve the production build.                           |
| `npm run check`       | `eslint .` + `tsc --noEmit`.                           |
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
    _components/       # shared UI (nav link, sign-out button, sortable table headers)
    signup/            # public tutee signup form
    (tutor)/           # combined tutor dashboard (hours, pairings, availability, attendance)
    (admin)/admin/     # roster & program management (coordinator/admin)
    api/               # Auth.js + tRPC route handlers
  styles/globals.css   # Tailwind + shared design-system classes (.btn, .card, .input, …)
  i18n/                # next-intl config (request.ts) + client-safe locale constants
  server/
    api/routers/       # tRPC routers (tutor, tutee, admin) + tests
    auth/              # Auth.js config (Credentials/password, role/JWT logic)
                       #   password.ts (scrypt) + two-factor.ts (email sign-in 2FA)
    email/sender.ts    # Aliyun Direct Mail (SMTP via nodemailer) + dev-log fallback
    concurrency.ts     # optimistic version-check helper for high-risk admin writes
    db.ts              # Prisma client
  lib/service-hours.ts # service-hour computation (pure, unit-tested)
  trpc/                # tRPC client/server wiring
messages/              # next-intl translation catalogs (en.json, zh.json)
prisma/
  schema.prisma        # data model
  seed.ts              # sample data
```

## Deployment

Production runs as a single-VPS Docker Compose stack (Caddy + app + Postgres) with the
image built in CI and pulled to the host. See **[README-DEPLOY.md](./README-DEPLOY.md)**.
