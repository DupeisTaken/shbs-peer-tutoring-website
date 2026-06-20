# CLAUDE.md

Guidance for working in this repo. Read the [README](./README.md) for the product
overview and [README-LOCAL.md](./README-LOCAL.md) for local setup; this file covers
the conventions and gotchas that aren't obvious from the code.

## What this is

A web app for a high-school peer-tutoring program: tutor–tutee pairings, attendance
submissions, tutor-meeting tracking, and automatic service-hour accounting. Built on
the **T3 Stack**: Next.js 15 (App Router) + React 19, Auth.js (NextAuth v5,
Credentials + JWT), Prisma 6 + PostgreSQL, tRPC 11, Tailwind CSS 4, Vitest.

## Commands

| Command            | What it does                                              |
| ------------------ | -------------------------------------------------------- |
| `npm run dev`      | Dev server (Turbopack).                                   |
| `npm run build`    | Production build. **Uses `--turbopack` on purpose** — the classic webpack build fails on Windows during output file-tracing. |
| `npm run check`    | `next lint` + `tsc --noEmit`. **Run before every commit.** |
| `npm test`         | Vitest suite once.                                        |
| `npm run db:push`  | Push schema to the DB (no migration files).              |
| `npm run db:seed`  | Sample data + dev login accounts.                        |
| `npm run db:studio`| Prisma Studio.                                            |

Verify changes with `npm run check` (and `npm run build` for anything touching routes,
env, or Prisma). On Windows a lingering Next worker can lock the Prisma query engine
DLL and make `prisma generate` fail with `EPERM` — don't kill the user's processes;
the existing engine binary keeps working, so confirm the generated client already has
your changes (`generated/prisma/`) and move on.

## Architecture & conventions

- **Branding is env-driven — never hardcode a title.** Import `APP_TITLE` /
  `TEAM_TITLE` from `~/lib/branding`. `APP_TITLE` (default "SHBS Peer Tutoring") is the
  public/student-facing brand; `TEAM_TITLE` (default "SHBS Peer Tutoring Team") brands
  the tutor/coordinator/admin area. They're `NEXT_PUBLIC_*` (so they work in client
  components too) and inlined at build time — **rebuild after changing them.**
- **All user-facing text must be translatable — never hardcode UI copy.** Add a key to
  `DEFAULT_STRINGS` in `~/lib/strings.ts` and render it with `t("area.key")` (supports
  `{placeholder}` interpolation), in both server and client components. This lets the app
  be translated / white-labelled for other orgs via the `NEXT_PUBLIC_STRINGS` env override
  (a JSON map of key→text, merged over the defaults at build time) with no code changes.
  Use dot-namespaced keys by area (e.g. `dashboard.attendance.title`). Give every section/
  field an explicit title string. (Migrating the remaining hardcoded strings is in progress —
  always route new/edited copy through `t()`.)
- **Env vars are validated in `src/env.js`** (`@t3-oss/env-nextjs`). Add server vars to
  `server`, public vars to `client` (must be `NEXT_PUBLIC_*`), and wire **both** into
  `runtimeEnv`. Give defaults so the app runs unconfigured.
- **API is tRPC** under `src/server/api/routers/` (`tutor`, `tutee`, `admin`,
  `application`). Use the right procedure: `publicProcedure` vs `adminProcedure`.
  Routers enforce role/ownership server-side; `src/middleware.ts` (Edge) gates routes.
- **Service-hour math lives in `src/lib/service-hours.ts`** — pure and unit-tested. It's
  the single source of truth; change hour logic there, not in routers.
- **Styling**: Tailwind v4 with shared design-system classes in `src/styles/globals.css`
  (`.btn`, `.card`, `.input`, `.select`, `.label`, `.link`, `.badge-*`, …). Reuse these
  rather than ad-hoc utility soup. Tailwind v4 needs `@utility` for `@apply`-able bases.

## Admin design philosophies (apply to every new feature)

These are product principles the admin area must uphold — honor them whenever you add data
or actions:

1. **Full visibility.** Every record and every state must be viewable somewhere under
   `/admin`. If you add a model or a status, add (or extend) an admin page that shows it.
   Don't leave data that only exists in the DB with no admin surface.
2. **Revertibility.** Every mutating action must have a way to undo it from the UI — an
   inverse control (toggle, delete, re-decide, status change), not a one-way door. Prefer
   reversible operations: use `active` flags / status transitions over hard deletes; guard
   destructive deletes when rows are referenced (see `deleteCourse`). When an action has a
   non-obvious inverse, make it explicit (e.g. reverting an ACCEPTED application: deactivate
   the auto-created tutor on `/admin/tutors`). A full audit/undo trail is future work — until
   then, ensure a manual revert path exists and document it.
3. **Unified status surface.** `/admin/activity` is the single pane of glass — the live status
   of every request type (tutee signups, tutor applications, interview decisions, discipline
   cards, attendance surveys). When you add a new request/queue, surface its count + items
   there too, each linking to the page that actions it.

Process requests earliest-first where a queue exists (e.g. tutee signups are ordered by
submission time). See the `admin-philosophies` memory for the rationale.

## Security rules (do not break)

- **Public forms never create logins.** `/signup` (tutee) and `/tutor-signup` (tutor
  application) create only `PENDING` `Tutee` / `TutorApplication` records for an admin to
  review. User accounts are made by the seed or by an admin.
- **Never accept `role` or status from public input.** Roles live on `User.role`, carried
  in the JWT. Bootstrap admins come only from `AUTH_BOOTSTRAP_ADMIN_EMAILS`.
- Passwords are hashed with scrypt (`src/server/auth/password.ts`). The dev seed password
  is for local use only — never in production.
- Sign-in accepts **username or email** + password — the identifier is matched against
  `User.email` or the linked `Tutor.username` in the Credentials `authorize()`.
- **Email delivery is NOT configured.** Email 2FA is fully scaffolded
  (`src/server/auth/two-factor.ts`); the forgot-password token logic works
  (`src/server/auth/password-reset.ts`) but the link is only logged in dev. Keep the
  `src/server/email/sender.ts` stub until a provider is chosen — don't invent one.

## Domain notes

- **Tutor identity**: `Tutor` has `firstName`/`lastName` (with `englishName` kept as the
  canonical "First Last" display name) and a unique `username` auto-derived as first-initial
  + last name. New tutors hit a first-login gate (`/onboarding/email`) before the dashboard,
  tracked by `User.emailVerifiedAt`.
- **Tutee flow**: public signup → `PENDING` tutee → admin assigns to a tutor inline
  (creates pairing, flips to `ACTIVE`) → the **tutor** picks the default time slot from
  their dashboard.
- **Tutor flow**: public application → admin assigns up to 3 interviewers (one **head**)
  → head schedules the interview, which shows for every panelist.
- **Courses** are tagged `AP` / `HONORS` / `STANDARD`. The tag gates the AP-score field
  on tutor applications: the AP-score input only appears for AP-tagged courses and is
  enabled only once the applicant confirms they have a score. Applicants can also report
  self-study (with a qualification note).

## Layout

```
src/
  app/                 # App Router; (tutor) and (admin) route groups, signup/ + tutor-signup/
  server/api/routers/  # tRPC routers + tests
  server/auth/         # Auth.js config, password.ts (scrypt), two-factor.ts (stub)
  lib/                 # service-hours.ts, branding.ts, time.ts
  styles/globals.css   # Tailwind + design-system classes
prisma/schema.prisma   # data model   ·   prisma/seed.ts  # sample data + dev users
```
