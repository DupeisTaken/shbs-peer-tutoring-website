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
  via the `MESSAGES_OVERRIDE` env (deep-merged JSON). Strings are also editable **in-app** at
  **`/localization`** (the `localization` router + `MessageOverride` table): each row is one
  `(locale, dot-key)` override, deep-merged over the bundled JSON at request time
  (`src/i18n/request.ts`, wrapped so a missing table never breaks rendering). Access via
  `translatorProcedure` — admins/coordinators, or any user an admin flags **`canTranslate`** on
  `/admin/users` (so a tutor can be assigned to help translate). Migrating the remaining hardcoded
  strings is in progress — always route new/edited copy through next-intl. **Policy documents** are
  localized too: `PolicyDocument` is one row per `(slug, locale)` with a fixed **default language
  (`en`)** that's always present and serves as the fallback (`localizedPolicy`). `/admin/policies`
  only lists languages that actually exist; coordinators/admins add another translation via the
  **"Add language"** picker (opens a blank draft → first save creates the row) and can remove a
  non-default translation (`deletePolicyLocale`, archived first). Saving an edit snapshots the prior
  copy into `PolicyArchive`, viewable under each document's **version history**. Shared UI glyphs
  (collapse/expand, etc.) live in `src/lib/symbols.ts` /
  `~/app/_components/icons.tsx` — reuse `DisclosureIcon`, don't hand-write triangles.
- **Accent color is themeable — never hardcode `indigo`/`blue`.** Use the `accent-50…accent-950`
  Tailwind tokens (e.g. `bg-accent-600`, `text-accent-700`, `ring-accent-500`). They're backed by
  `--accent-*` CSS variables; each theme in `src/lib/theme.ts` maps them to a built-in palette under
  a `[data-theme="…"]` block in `globals.css`. The `ThemeSwitcher` (header) sets `data-theme` on
  `<html>` + a `THEME` cookie; the root layout restores it SSR (no flash). Add a theme by adding a
  `[data-theme]` block + an entry in `THEMES` and `components.theme.names.*`.
- **Env vars are validated in `src/env.js`** (`@t3-oss/env-nextjs`). Add server vars to
  `server`, public vars to `client` (must be `NEXT_PUBLIC_*`), and wire **both** into
  `runtimeEnv`. Give defaults so the app runs unconfigured.
- **API is tRPC** under `src/server/api/routers/` (`tutor`, `tutee`, `admin`,
  `application`, `registration`). **Role hierarchy: `HEAD` > `ADMIN` > `COORDINATOR` > `TUTOR` >
  `VIEWER`.** Use the right procedure: `publicProcedure`, `adminProcedure` (write; HEAD/ADMIN/
  COORDINATOR), `adminOnlyProcedure` (the **admin tier** — HEAD or ADMIN, e.g. role changes /
  program refresh / hour adjustments), **`headProcedure`** (strictly the singleton HEAD — manages
  the admin roster + leadership transfer), or **`viewerProcedure`** for admin **reads** — it also
  admits the read-only `VIEWER` role and masks PII (emails / phone / preferred contact) in the
  result for viewers. Tutor mutations that require an active membership go on
  **`activeTutorProcedure`** (a `tutorProcedure` that also asserts `Tutor.status === "ACTIVE"`), so
  inactive tutors keep read-only access but can't act. Keep admin queries on `viewerProcedure` and
  admin mutations on `adminProcedure` so VIEWER can browse but never write. Routers enforce
  role/ownership server-side; `src/middleware.ts` (Edge) gates auth, the `(admin)` layout gates
  role. **Users & Roles (`/admin/users`)** is reachable by the elevated roles (HEAD/ADMIN/
  COORDINATOR, not VIEWER); it lists every login **plus** admin-created tutors without one (the
  `accounts` query), with **filters** (role / tutor status / account state). Only HEAD may
  promote/demote ADMINs or **transfer leadership** (`transferHead` — outgoing head → ADMIN, kept
  to exactly one head so the program is never leaderless). Coordinators may only **send links** and
  toggle **their own** "can tutor" (`setUserCanTutor` self-checks).
- **Service-hour math lives in `src/lib/service-hours.ts`** — pure and unit-tested. It's
  the single source of truth; change hour logic there, not in routers. Hour **deductions**
  (and bonuses) are `ServiceHourAdjustment` rows (PUNISHMENT/EXTRA), summed into monthly totals.
  An **unexcused tutor-meeting absence** docks 0.125h: `recordMeetingAttendance` materialises one
  deterministic PUNISHMENT adjustment per meeting+tutor (id `mtgabs_<meeting>_<tutor>`), so it's
  idempotent and removed the moment the status changes away from unexcused.
- **Styling**: Tailwind v4 with shared design-system classes in `src/styles/globals.css`
  (`.btn`, `.card`, `.input`, `.select`, `.label`, `.link`, `.badge-*`, …). Reuse these
  rather than ad-hoc utility soup. Tailwind v4 needs `@utility` for `@apply`-able bases.
  **Form controls size to their content, not fixed widths** — add `field-auto` (sets
  `field-sizing: content` + `w-auto max-w-full`) alongside `.input`/`.select` with a `min-w-*`
  floor (e.g. `select field-auto min-w-40`) instead of `w-40`/`max-w-xs`. **Wide tables go in a
  `card overflow-x-auto` wrapper** (never `overflow-hidden`, which clips on small screens) so
  they scroll horizontally on mobile. **Gray submit buttons when the form is incomplete** via
  `disabled`: controlled forms test the required fields; server-action forms use a form-level
  `onChange={(e) => setValid(e.currentTarget.checkValidity())}`.
  For collapse/expand affordances use the shared `DisclosureIcon` (`~/app/_components/icons.tsx`)
  so the `▸`/`▾` gesture is consistent everywhere. The `/admin` and tutor areas share one top-bar
  theme (brand left; identity block with name + `@username` and global controls right).

## Admin design philosophies (apply to every new feature)

These are product principles the admin area must uphold — honor them whenever you add data
or actions:

1. **Full visibility.** Every record and every state must be viewable somewhere under
   `/admin`. If you add a model or a status, add (or extend) an admin page that shows it.
   Don't leave data that only exists in the DB with no admin surface.
2. **Revertibility.** Every mutating action must have a way to undo it from the UI — an
   inverse control (toggle, delete, re-decide, status change), not a one-way door. Prefer
   reversible operations: use `active` flags / status transitions over hard deletes; guard
   destructive deletes when rows are referenced (see `deleteSubject`). When an action has a
   non-obvious inverse, make it explicit (e.g. reverting an ACCEPTED application: deactivate
   the auto-created tutor on `/admin/tutors`). A full audit/undo trail is future work — until
   then, ensure a manual revert path exists and document it.
3. **Unified status surface.** `/admin/activity` is the single pane of glass — the live status
   of every request type (tutee signups, tutor applications, interview decisions, discipline
   cards, attendance surveys, **opt-out / reentry**). When you add a new request/queue, surface its
   count + items there too, each linking to the page that actions it.
4. **Explicit, reversible lifecycles — and no foot-guns.** Model a record's life as a **named
   status enum**, never a bare boolean: every state is nameable, filterable, and visible (graduated
   ≠ opted-out ≠ archived). **Member-initiated changes are gated, recallable, and reviewed** — a
   tutor's opt-out waits out a cooldown they can recall, then an admin approves with the downstream
   fallout (orphaned tutees) surfaced for action, not left dangling. And **preserve no-lockout
   invariants**: exactly one active `Term`, exactly one `HEAD` (transfer is atomic demote+promote),
   privilege grants only ever elevate. **Self-describing > implicit:** prefer a status transition or
   an explicit request row over a flag whose meaning you have to infer.

**Core philosophy (the throughline):** the admin area is a *complete, honest, reversible mirror* of
program reality — nothing happens in the DB that an admin can't see, undo, and understand the
consequences of. Computation that produces those views (hours, standings, aggregates) lives in the
**backend** (`src/lib/*` + Postgres `GROUP BY`), never recomputed ad-hoc in the client.

Process requests earliest-first where a queue exists (e.g. tutee signups are ordered by
submission time). See the `admin-philosophies` memory for the rationale.

## Security rules (do not break)

- **Public forms never create logins.** `/signup` (tutee) and `/tutor-signup` (tutor
  application) create only `PENDING` `Tutee` / `TutorApplication` records for an admin to
  review. The one public page that *does* create a login is **`/register`**, and only after the
  visitor proves an **admin-issued single-use registration code** plus an emailed email-verification
  code — so account creation is still gated by an admin, never open self-service.
- **Registration codes are short-lived, low-value secrets.** The 6-digit `code` is stored in
  **plaintext** so admins/coordinators can re-display it on `/admin/registration-codes` (revealed
  on demand via a per-row popup; withheld from the read-only VIEWER). Its value is bounded by being
  **single-use**, expiring after **7 days**, and **rate-limited** at every `/register` step (per IP +
  per code, `src/server/rate-limit.ts`). The *separate* emailed email-verification code is never
  re-displayed and IS stored hashed (HMAC, `AUTH_SECRET`). Keep these guards when touching the flow.
- **Never accept `role` or status from public input.** Roles live on `User.role`, carried
  in the JWT. The first `AUTH_BOOTSTRAP_ADMIN_EMAILS` entry resolves to the singleton **HEAD**, the
  rest to `ADMIN` — grants only ever **elevate** (a transferred head is never silently demoted).
  HEAD is otherwise set only via `transferHead`.
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
  (`graduationYear`); without a known grade it falls back to the bare `jsmith`. **Grade is
  canonical and tutor-self-reported** (`/settings`) — class-of is derived and not directly editable
  (so a retained tutor just keeps their grade and isn't force-graduated). Uniqueness is enforced by
  `ensureUniqueUsername` (`src/server/auth/username.ts`): on a clash it appends a letter
  (`jsmith27b`), then a numeric counter as a last resort.
- **Tutor lifecycle is a status, not a boolean.** `Tutor.status` is
  `ACTIVE | PENDING | GRADUATED | OPTED_OUT | ARCHIVED` (replaced the old `active` flag — one source
  of truth; migrate any `where: { active: true }` to `status: "ACTIVE"`). Only `ACTIVE` tutors are
  eligible for pairings/attendance; the rest are inactive with **read-only** access to their own
  history + handbook (dashboard hides action cards; mutations are blocked by `activeTutorProcedure`).
  On a program **refresh**, G12+ tutors become `GRADUATED` **at the start of Q4**, everyone remaining
  ages up one grade at the school-year boundary, and — on any **semester crossing** — every
  continuing `ACTIVE` tutor is set **`PENDING`** (see the `refresh` mutation + `src/lib/period.ts`).
  There's no admin "availability review" popup: a `PENDING` tutor **self-activates** from their
  dashboard (`activateAccount` → `ACTIVE` if available, or `OPTED_OUT`), and the choice syncs
  straight to the admin views. Admins can still set status (incl. reactivating a graduate) on
  `/admin/tutors`.
- **Opt-out / reentry (`TutorStatusRequest`, kinds `OPT_OUT`/`REENTRY`).** A tutor requests opt-out
  on `/settings`; a **one-week cooldown** (`eligibleAt`) must pass before an admin can approve, and
  the tutor can **recall** it meanwhile. Approval → `OPTED_OUT`; the admin then gets a button to
  **re-queue** that tutor's tutees onto `/admin/requests` (`requeueTutorTutees`). Only `OPTED_OUT`
  tutors can request **reentry** (no cooldown; approval → `ACTIVE`). Graduated reactivation stays a
  manual admin override. Admins action these on **`/admin/tutor-requests`**; counts surface on
  `/admin/activity`.
- **Account creation is self-registration via a security key.** Admins/coordinators issue a
  single-use 6-digit **`RegistrationCode`** on **`/admin/registration-codes`** (the code is stored in
  plaintext and re-viewable per row via a popup, valid 7 days or until used; see
  `src/server/auth/registration.ts`); accepting a tutor application also generates one
  (`promoteApplicantToTutor`, bound to the applicant's email + tutor). The recruit
  redeems it at public **`/register`**: enter code → verify email with a second emailed 6-digit code
  → set name/grade/password, which creates+links a Tutor and a **fully-verified** login. This
  replaced the shared-default-password auto-provision, so **every account has a validated email and
  self-set credentials.** The legacy **"Send setup link"** on `/admin/users` (`sendTutorSetup` →
  `issueTutorSetupLink`, reuses the reset-token flow) remains as an alternate admin-provisioned
  invite. The first-login `/onboarding/email` gate (`User.emailVerifiedAt`/`mustChangePassword`)
  still applies to any login that arrives unverified. Tutors read the handbook at `/handbook`.
- **Tutee flow**: public signup → `PENDING` tutee → admin assigns **each subject choice
  (1st/2nd) to a tutor independently** on `/admin/requests` (each pick creates one pairing).
  The signup stays `PENDING` until **every** provided choice has a tutor; that last assignment
  flips it to `ACTIVE` (`assignSignup` computes "fulfilled"). Fulfilled requests don't vanish —
  they stay in place tagged + collapsed for the session so the queue numbering doesn't jump.
  Then the **tutor** picks the default time slot from their dashboard.
- **Tutor flow**: public application → admin assigns up to 3 interviewers (one **head**)
  → head schedules the interview, which shows for every panelist.
- **Subjects** (Prisma model `Subject`, with `SubjectLevel` for the AP/Honors/Standard track and
  `ApplicationSubjectIntent` for application picks) are the tutoring topics. The models keep their
  original table names via `@@map` ("Course"/"CourseLevel"/"ApplicationCourseIntent") so the
  rename needed no migration. **Never call them "courses" in UI copy** — we don't provide a formal
  teaching service. The level tag gates the AP-score field on tutor applications. Each subject row
  on `/tutor-signup` puts the qualification **ticks first** (taken / has-AP-score / self-studied),
  and each detail box appears **only when its tick is set**. The admin catalogue is at
  `/admin/subjects`. (Admin routes were tidied for clarity: `/admin/service-hours`,
  `/admin/hour-adjustments`, `/admin/discipline`, `/admin/attendance`, `/admin/time-slots`,
  `/admin/subjects`.)

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
