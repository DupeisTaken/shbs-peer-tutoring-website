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
- **All user-facing text must be translatable — never hardcode UI copy.** i18n is **next-intl**.
  Add the string to `messages/en.json` (and the other locales, e.g. `messages/zh.json`) as a
  nested key, then render it: in **client** components `const t = useTranslations(); t("dashboard.attendance.title")`;
  in **server** components `const t = await getTranslations(); …`. Keys are dot-pathed by area
  and support ICU `{placeholder}` args. The active locale comes from the `NEXT_LOCALE` cookie
  (the `LanguageSwitcher` in the header sets it — no locale routing, so the auth middleware is
  untouched); config in `src/i18n/request.ts`. Orgs can white-label without editing the files
  via the `MESSAGES_OVERRIDE` env (deep-merged JSON). Migrating the remaining hardcoded strings
  is in progress — always route new/edited copy through next-intl. **Policy documents** are
  localized too: `PolicyDocument` is one row per `(slug, locale)`; the public signup forms
  request the active locale (`localizedPolicy`, English fallback) and `/admin/policies` edits each
  language under a tab. Shared UI glyphs (collapse/expand, etc.) live in `src/lib/symbols.ts` /
  `~/app/_components/icons.tsx` — reuse `DisclosureIcon`, don't hand-write triangles.
- **Env vars are validated in `src/env.js`** (`@t3-oss/env-nextjs`). Add server vars to
  `server`, public vars to `client` (must be `NEXT_PUBLIC_*`), and wire **both** into
  `runtimeEnv`. Give defaults so the app runs unconfigured.
- **API is tRPC** under `src/server/api/routers/` (`tutor`, `tutee`, `admin`,
  `application`). Use the right procedure: `publicProcedure`, `adminProcedure` (write; ADMIN/
  COORDINATOR), `adminOnlyProcedure` (strictly ADMIN), or **`viewerProcedure`** for admin
  **reads** — it also admits the read-only `VIEWER` role and masks PII (emails / phone /
  preferred contact) in the result for viewers. Keep admin queries on `viewerProcedure` and admin
  mutations on `adminProcedure` so VIEWER can browse but never write. Routers enforce
  role/ownership server-side; `src/middleware.ts` (Edge) gates routes.
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
- **Email delivery is Aliyun Direct Mail (SMTP via nodemailer)** in
  `src/server/email/sender.ts`. Active when `EMAIL_FROM` + `SMTP_PASSWORD` are set, else it
  logs in dev / warns in prod (never throws). Forgot-password emails the reset link through it
  (`src/server/auth/password-reset.ts`). **Email 2FA stays scaffolded** and intentionally NOT
  implemented (`src/server/auth/two-factor.ts`) — it can reuse the sender. Note: `.npmrc` sets
  `legacy-peer-deps=true` for the next-auth v5 ⇄ nodemailer optional-peer clash.

## Domain notes

- **Tutor identity**: `Tutor` has `firstName`/`lastName` (with `englishName` kept as the
  canonical "First Last" display name), a unique `username` auto-derived as first-initial
  + last name + **2-digit graduation year** (`jsmith` class of 2027 → `jsmith27`), and a
  `gradeLevel` (G-number). The class-of year comes from `gradeLevel` + the active school year
  (`graduationYear`); without a known grade it falls back to the bare `jsmith`. Uniqueness is
  enforced by `ensureUniqueUsername` (`src/server/auth/username.ts`): on a clash it appends a
  letter (`jsmith27b`), then a numeric counter as a last resort.
  On a program **refresh**, graduating tutors (G12+) are archived **at the start of Q4** (not the
  year boundary) and everyone remaining ages up one grade at the school-year boundary — see the
  `refresh` mutation + `src/lib/period.ts`. New tutors hit a first-login gate
  (`/onboarding/email`) before the dashboard, tracked by `User.emailVerifiedAt`. Tutors
  self-serve their own alt-name / contact email / password at `/settings`. A coordinator/admin
  can be given a `Tutor` link via the **"Can tutor"** toggle on `/admin/users`.
- **Tutee flow**: public signup → `PENDING` tutee → admin assigns **each course choice
  (1st/2nd) to a tutor independently** on `/admin/requests` (each pick creates one pairing).
  The signup stays `PENDING` until **every** provided choice has a tutor; that last assignment
  flips it to `ACTIVE` (`assignSignup` computes "fulfilled"). Fulfilled requests don't vanish —
  they stay in place tagged + collapsed for the session so the queue numbering doesn't jump.
  Then the **tutor** picks the default time slot from their dashboard.
- **Tutor flow**: public application → admin assigns up to 3 interviewers (one **head**)
  → head schedules the interview, which shows for every panelist.
- **Courses** are tagged `AP` / `HONORS` / `STANDARD`. The tag gates the AP-score field
  on tutor applications. Each course row on `/tutor-signup` puts the qualification **ticks
  first** (taken / has-AP-score / self-studied), and each detail box appears **only when its
  tick is set** — the grade box when "taken", the AP-score box when "has AP score" (and only
  for AP-tagged courses), and the self-study note when "self-studied". Personal-contact inputs
  sit at the bottom of the form, below the course ticks and the policy agreement.

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
