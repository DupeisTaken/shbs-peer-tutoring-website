# Local development & testing

Run the app locally, seed synthetic data and verify changes. Run all commands from the repository root. For production, use the [deployment runbook](../guides/deployment.md).

## Worktree and resource safety

Before changing an existing checkout, inspect `git status --short`,
`git branch --show-current` and `git rev-parse HEAD`. Confirm which checkout and
source revision the task owns; preserve unrelated changes and running previews.

- **Dependencies:** inspect whether `node_modules` is a real directory, symlink or
  Windows junction (PowerShell: `Get-Item node_modules | Format-List FullName,LinkType,Target`).
  `npm ci` replaces the dependency tree and runs `postinstall`; do not run it against
  a shared dependency target while another checkout uses it. A standalone checkout
  can follow the installation steps below. Coordinate shared dependency changes
  with their owner instead of treating a junction as disposable cache.
- **Prisma:** [the schema](../../prisma/schema.prisma) generates into this checkout's
  ignored `generated/prisma`, which is imported by [the database client](../../src/server/db.ts).
  Sharing `node_modules` does not supply that generated directory. Inspect both
  `generated` and `generated/prisma` for links before generation: a linked parent
  can redirect writes even when its child looks like a normal directory. Use an
  owned client matching this checkout's schema; do not regenerate through a link
  used by another preview. After dependency setup or schema changes, run
  `npx prisma generate` from the intended checkout;
  `npm ci` also does this through `postinstall`. `npm run db:generate` is instead
  `prisma migrate dev`, for authoring migrations. Keep that separate from applying
  committed migrations with `npm run db:migrate`.
- **Database:** verify the resolved host, port and database name without exposing
  credentials. `.env` is local and ignored, not proof of an isolated target. Use
  different databases for demo/browser work and destructive integration fixtures;
  do not migrate, seed or reset a database owned by another running preview.
  See [test setup](#5-run-the-tests) for the complete suite's database name.
- **Serial verification:** agree which task owns a shared database or runtime before
  using it. Run one bounded check, build or server/browser session at a time on the
  local machine. Vitest's serial files do not prevent a second test process from
  resetting the same fixtures. Do not run `check`/build concurrently with dev in
  the same checkout: they share generated Next output. `SHBS_BUILD_CPUS=1` limits
  local build workers; `--maxWorkers=1` bounds Vitest workers.
- **Cleanup and handoff:** record the processes, ports and temporary databases you
  start. Stop only those owned resources after verification, or document an explicit
  handoff for a retained preview. Never stop Codex/ChatGPT or unrelated browser/Node
  processes. Inspect dependency links and database ownership before any cleanup;
  prefer the cache bypass below to deleting shared or active artifacts. Keep local
  logs/screenshots in ignored `outputs/` or `.validation/`, with secrets excluded.

`node_modules/.cache/` may contain an embedded PostgreSQL database. Inspect its
owner and stop or relocate it through that helper's lifecycle before deleting
caches or running `npm ci`. A dependency directory is not proof of disposable data.

Documentation edits need no server, browser or database. Run `npm run docs:check`
for Markdown links, anchors, guide discoverability and maintenance regressions;
it does not verify application behavior or fetch external links. Also follow the
[required static checks](verification.md#required-checks) for the commit. These
commands do not require an application build or integration-test database.

## Updating an existing checkout

After pulling schema changes, confirm the intended local database, run `npm run db:migrate` and `npx prisma generate`, then restart the app. Apply the complete migration chain; do not reset an existing database just to upgrade it. See the [technical guide](../reference/technical-report.md) for code responsibilities and the [program reference](../guides/program-configuration.md) for configuration.

### Dependency compatibility checks

Keep `next` and `eslint-config-next` on the same release. Preserve the repository's
local lint-glob package and deliberate overrides when updating the lockfile.
Run `npm audit` with the complete dependency tree; development-only findings are
still part of the required CI gate. Prefer supported patch/minor updates and make
major migrations explicit rather than applying an unreviewed forced audit fix.

The application uses Zod 4. Dictionary schemas declare string keys explicitly;
an omitted announcement audience uses `prefault({})` so its nested defaults are
parsed. Observer projections accept missing private fields before transforming
them to `null`. Attendance forms distinguish raw schema input from parsed numeric
ratings. Preserve these contracts when changing validation dependencies.

[Intake validation tests](../../src/lib/student-signup.test.ts) exercise bounded
oversized collections and legitimate inputs through the real shared schema.
[SMTP runtime tests](../../src/server/email/smtp-runtime.test.ts) exercise the
installed mail parser and caller-owned sockets without external delivery. Run
these together with announcement, observer-projection, transport-error, signup,
translation and attendance tests after validation/mail upgrades, then complete
the full suite, production build and actual-page browser checks.

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
Normal builds retain Next's default cache behavior.

Keep local screenshots and verification logs in ignored `outputs/` or `.validation/`.

CAPTCHA grant/admission tests use an isolated provider fixture, including the SDK
configuration and runtime-option constructors. The separate
`src/server/captcha/aliyun-runtime.test.ts` compatibility test constructs the real
installed SDK client and models, replacing only its network method. Run both when
changing that boundary. A focused pass does not replace a complete-suite pass;
retain failed full-run receipts when investigating timing failures.

## Prerequisites

- **Node 22 (CI baseline)** and **npm**
- A **PostgreSQL** database (one of the options below)
- _(Optional)_ **Docker** — only for the full Compose smoke test at the end

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
[bootstrap instructions](../guides/deployment.md#create-the-first-admin-first-deploy).

> **Email-based sign-in 2FA is implemented** and applies when the `EMAIL_2FA` program feature
> (on by default) and the user's opt-in 2FA preference are both enabled. Existing saved feature
> settings take precedence over defaults. Without SMTP configuration, development logs
> the single-use code instead of sending it; see `src/server/auth/two-factor.ts`.

## 2. Get a database running

Pick whichever fits your setup.

### Option A — Docker / Podman (the bundled script)

`start-database.sh` reads `DATABASE_URL` from `.env` and starts a Postgres container with
matching credentials. On Windows run it from WSL; on Linux/macOS run it directly.

```bash
./start-database.sh
```

The helper publishes `127.0.0.1:<DATABASE_URL port>:5432` by default, independently
of the URL's hostname. Local clients can use `127.0.0.1` explicitly if `localhost`
resolves only to IPv6. PostgreSQL still requires the configured password.
`DB_BIND_ADDRESS` is an optional **host-only** setting in `.env` or the command's
environment; unset/empty means `127.0.0.1`. Only literal IPv4 addresses are accepted.
For deliberate remote development, set it to a specific private host address and
allow only trusted clients in the network/firewall policy. `0.0.0.0` is an explicit
all-interface opt-in, never the default. Prefer an authenticated SSH/VPN tunnel
while retaining loopback publishing. Production Compose leaves PostgreSQL unpublished.

Existing containers are checked before reuse or start. A mismatched, wildcard,
additional PostgreSQL binding, or host-network container is refused; changing
`.env` cannot change a container's existing port mapping. The helper never deletes
or recreates it automatically. Back up the database, inspect its mounts with
`docker inspect --format '{{json .Mounts}}' <container>` (or Podman), and plan a
recreation that retains/restores those data. An old anonymous volume or writable
container layer must not be discarded. Until then, review/stop an exposed local
container manually; refusal by the helper does not stop one already running.

After starting a disposable container, verify its effective mapping with
`docker port <container> 5432/tcp` (or `podman port`): expect only
`127.0.0.1:<port>` by default. Check local authenticated connectivity with `psql`
using the local `DATABASE_URL`, then confirm a separate LAN host cannot connect.
Review the daemon's routing/firewall configuration too: Docker documents a
[localhost-publishing caveat before Engine 28.0.0](https://docs.docker.com/engine/network/port-publishing/).
The daemon-free regression suite is `npm run test:deployment` (requires Bash;
on Windows set `SHBS_TEST_BASH` to the Git Bash executable). It executes the real
helper against stub commands, so it does not start Docker/Podman or a database.
The same serial suite tests the [private network evidence collector](../guides/deployment.md#collect-a-private-host-inventory)
against synthetic listener/Docker commands, including timeouts, permission errors,
output/inventory limits and secret exclusion. It never queries the real daemon or
probes production. Production acceptance still requires the operator worksheet and
independent external checks in the deployment runbook.

The same daemon-free suite covers the [storage capacity preflight](../guides/deployment.md#storage-capacity-preflight)
with synthetic byte/inode measurements and bounded command failures. It checks
headroom boundaries, input validation and unknown/insufficient results without
pulling images, inspecting a real daemon, filling disks or reading `.env`.
These fixtures establish helper behavior; the operator must still map actual
filesystems, budget overlapping allocations and observe current host capacity.

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
npx tsx --conditions=react-server prisma/verify-demo.ts
```

Seeding creates synthetic fixtures and refreshes some values. It preserves immutable request history and is not a full reset; create a fresh database to restart a rehearsal. It can overwrite other rehearsal changes; never use it with real program data. Use `npm run admin:create` to bootstrap real deployments.

### Demo accounts and workflows

All example accounts use `Password123!`. The identifiers below work at `/signin`.

| Account                   | Role / example                                                | Start                  |
| ------------------------- | ------------------------------------------------------------- | ---------------------- |
| `admin`                   | HEAD; collective oversight, decisions and configuration       | `/admin/activity`      |
| `manager@example.test`    | ADMIN; management review without a tutor identity             | `/admin`               |
| `chair@example.test`      | ADMIN and tutor; Alex Interview Chair, scheduling and decisions | `/dashboard`, `/admin` |
| `carol@example.edu`       | COORDINATOR and tutor; approval proposals                      | `/dashboard`, `/admin` |
| `alice@example.edu`       | Active tutor; attendance, assignments, hours, panel voting    | `/dashboard`           |
| `crew@example.edu`        | Crew-only member; room patrol and membership                  | `/patrol`              |
| `iris@example.edu`        | Tutor with crew membership                                    | `/patrol`              |
| `emma@example.test`       | Assigned student; sessions, feedback and messages             | `/student`             |
| `frank@example.test`      | Assigned student; pending card appeal and withdrawal review   | `/student`             |
| `grace@example.test`      | Assigned student; tutor schedule-conflict review              | `/student`             |
| `kate@example.test`       | Verified student still waiting for assignment                 | `/student`             |
| `recalled@example.test`   | Recalled request retained as history                          | `/student`             |
| `withdrawn@example.test`  | Approved quarter withdrawal and resubmission block            | `/student`             |
| `translator@example.test` | Explicit Translator, without Viewer access; pending draft     | `/localization`        |
| `parent@example.edu`      | Ordinary viewer                                               | `/`                    |
| `viewer2@example.edu`     | Suspended viewer with account appeal                          | `/`                    |

The database also includes unverified survey demand before account creation, disqualification history, exact policy acceptance snapshots, school-calendar overrides, active/inactive membership, pending and resolved removals, future meetings, valid qualified interview panels, notifications, private messages, registration codes, custom pages and historical service-hour reports. The Fiona panel has Admin tutor Alex Interview Chair and a completed interview; Hana demonstrates a tied vote resolved by that chair. Carol remains a Coordinator for approval workflows. Bundled policy text still needs school review before publication.

Current lessons contain **26 one-student subject assignments in 12 teaching
blocks**: ten saved groups and two independent assignments. This is the shape
created by **Select tutor**, followed by the tutor's **Combine / split pairings**
workflow. A list of students inside one Pairing row is not a saved group and cannot
be split by that editor. Alice's three Mathematics assignments are already combined;
splitting them returns each assignment to Awaiting schedule, preserving completed
attendance. Choosing the same subject for multiple students does not require a
multi-subject group.

Room examples include Alice's fixed room, Bob's automatically allocated room,
Carol's explicit roomless assignment and David's fixed room. The group writer
normalizes old legacy room intent when forming a current group. A synthetic
first **School Month Report** includes reviewed zero opening balances, tutoring and
crew credits, deductions, statistics and a CSV export. It uses the configured
`AUTH_SECRET` to create its local report capability. Report generation and schedule
disablement commit together; its synthetic email delivery is skipped and automatic
reporting stays off. Reseeding preserves this immutable report rather than adding
editions or changing its snapshot. Create a fresh demo database to start its report
chain again; an unrelated existing report chain is never replaced.

The current scenario manifest covers **60 role records: 42 ordinary (70%) and
18 edge cases (30%)**. Historical cohorts, inactive archives and auxiliary review
rows are retained outside that denominator. Ordinary records have defined academics,
known signup provenance and no special discipline, withdrawal or review state.
Routine waiting for matching, excused absences and normal scheduling are ordinary
cases; the pending queue remains a synthetic rehearsal, not a copy of live volume.

Current tutee sources are **30 Self-service, 10 Staff-entered and 2 Earlier signup**.
Self-service examples include confirmed synthetic surveys, account ownership and
exact policy acceptance evidence. The extra student accounts use
`demo-<fixture-key>@example.test` and the shared demo password above. The two
unknown-source examples are Mia and pending Zoe. **Earlier signup means unknown
entry provenance, not an earlier submission date.** Its badge is intentionally
retained for those examples rather than applied to the whole seed by default.
Three redundant current cards are omitted; the invalid-card example remains in
historical reporting. Edge scenarios are concentrated on nine tutors and nine
tutees, including appeals, membership requests, discipline, incomplete academics
and username collisions. The verifier checks their actual states as well as counts.

Academic details are complete for 46 of the 49 tutor/tutee demo accounts: a
confirmed grade and reference school year, or Pia's explicit graduated status.
The website derives the class/graduation year from that grade and reference year;
there is no separate class-name field. Alice and Emma have confirmed profiles.
Most current tutee roster entries also include their enrollment year, so
accountless participants show their grade and class-of without invented logins.
The two Alex/Andrea Kim roster fixtures have dated provisional tutor grades.
Evan, Oscar and Kate retain account confirmation examples; Madonna retains an
undated roster grade. Pending Zoe retains a missing enrollment-year example.
Existing historical originals and accepted survey/policy
snapshots are not rewritten.

For an existing disposable demo, add the missing scenario evidence and academics
without resetting exploration data:

```bash
npx tsx --conditions=react-server prisma/seed-scenarios.ts
```

Use the existing `DATABASE_URL` and `SHBS_DEMO_SEED=1`. This creates credentials
only for missing, unchanged synthetic self-service fixtures; it never resets an
existing password or rewrites an accepted survey. Changed or deleted fixtures are
reported as deviations, so an explored database may differ from the fresh 70/30
target. The three redundant cards are removed only when their complete fixture
values and timestamps still match and no appeal, audit or approval references them.
Existing signup priority and signature dates are preserved, even when an older
rehearsal has artificial attendance chronology. Fresh ordinary intake and pairing
creation dates precede their attendance examples.

To add only these missing academic details to an existing disposable demo, keep
its `DATABASE_URL` and set `SHBS_DEMO_SEED=1`, then run:

```bash
npx tsx --conditions=react-server prisma/seed-academics.ts
```

This helper skips existing academic confirmations and populated enrollment metadata.
It preserves historical academic originals before initializing a linked account's
current profile; only current roster-only fixtures receive missing year metadata.
It does not reseed credentials, schedules, reports
or review queues, and does nothing after the active demo term has been refreshed.
For the edit-preservation regression, seed a separate `shbs_*_test` database twice
and run `npx tsx --conditions=react-server prisma/verify-demo-academics.ts`. That
test deliberately changes Alice's grade in the test database, verifies a selective
repeat preserves it, and compares academic, report, policy, survey and historical
evidence. It refuses the exploration demo database.
Also run `npx tsx --conditions=react-server prisma/verify-demo-scenarios.ts` on that
disposable test database to verify evidence-backed provenance, exact scenario
coverage, no-op repeats and preservation of edited intake/card records. It leaves
its deliberate edits in the test database and refuses a demo database.

To upgrade untouched assignments in an existing demo without a full reseed, run
`npx tsx --conditions=react-server prisma/seed-pairings.ts`. Keep the same loopback
database guard and `SHBS_DEMO_SEED=1`. It preserves original primary pairing IDs,
completed attendance and immutable report evidence, and reports edited or missing
fixtures rather than replacing them. The original assignment rows remain the
historical anchors; current rosters use one assignment per student and subject.

On a separate migrated `shbs_*_test` database, run
`npm test -- src/test/demo-seed.test.ts --maxWorkers=1`. It verifies every current
assignment against the real Select tutor procedures, plus saved-group split/rejoin
and selective-upgrade preservation. These probes must never target the explored
demo. A passing row-count check alone does not establish that the UI can create an
assignment.

The regular integration suite includes this test: it empties
only a guarded disposable test database, runs the documented seed entry point
twice, then checks the workflow, pairing and edit-preservation verifiers. CI
supplies a fresh PostgreSQL service and the committed migration chain. This guards
against a seed that works only after manual changes in one developer's database.

Opening a tutor or tutee agenda publishes ordinary upcoming sessions from the
confirmed assignments. Rescheduling negotiations and extra sessions remain
interactive rehearsals: use the tutor and student accounts to create
the corresponding proposals and agreements. The seed does not fabricate participant
responses or reusable calendar-access tokens.

Seeded survey tokens are deliberately unusable: request a new email link through the form. Local email capture is required to rehearse verification and recovery without delivering real email. Never enable a public mail-capture endpoint on a deployed site. Create coordinator proposals through the interface so their immutable target snapshots reflect the database at submission time.

## 4. Run the app

```bash
npm run dev         # http://localhost:3000
```

Open http://localhost:3000, sign in at `/signin` with a seeded account (e.g.
`admin@example.edu` / `Password123!`). Admins/coordinators land in the **SHBS Peer Tutoring
Team** management area (`/admin`);
tutors land on their combined `/dashboard` (hours, pairings, availability, and the
dated session agenda with session-bound attendance). Tutors can edit their own name/email/password via **Settings**
in the avatar menu (`/settings`).

Switch the interface language any time with the **EN / 中文** toggle in the header.

The dev server logs each tRPC call's real handler time as `[trpc] <type> <path> <ms>` —
Use it to spot slow queries. `TRPC_DEV_DELAY=true` adds an artificial development delay; leave it unset when measuring handlers.

Try the public forms (no login required):

- **Student signup** at `/signup` collects the full application and policy agreement and reserves a survey timestamp before account verification. The request queue (`/admin/requests`) tracks verified and unverified demand. Enter the captured mailbox verification code, or explicitly confirm the existing local email link, to open the invitation receipt popup. Continue to `/register` for prefilled account/access review; issuing or displaying the invitation alone does not create credentials or confirm participation. Assignment starts a fixed verification deadline if demand is still unverified; retries preserve the original submission priority and policy evidence.
- **Viewer signup** at `/viewer-signup` collects identity, affiliation and email, verifies the captured mailbox code, then opens the same receipt popup with copy, optional email delivery and a prefilled invitation link. Existing accounts take the LOGIN path with unchanged credentials and access. Keep synthetic mail and browser proofs in ignored evidence.
- **Invitation entry** at `/register` is a single code card with Continue. Rehearse a five-character staff key containing letters and numbers, a displayed invitation code without browser proof and a verified-browser popup handoff. **Add access** in the account menu and Account Settings opens this same entry for signed-in accounts; entering a code alone makes no access write.
- **Tutor application** at `/tutor-signup` starts recruitment. Assign at least three active tutor accounts, an Admin or Head chair, and explicit subject qualification coverage. The selected chair need not outrank other panelists; a Coordinator may participate and vote but cannot chair. Every panelist votes; the majority determines the outcome and the chair breaks ties. The chair's approval includes actual duration/attendance and immediately applies hours, initial registration setup and Admin/Head notification. The current Admin/Head chair also applies initial-application rejection directly.
- **Crew application** at `/crew-signup` stages details and sends a captured mailbox code. Verify it to create a pending application; no credentials or Crew membership exist yet. Approve the synthetic applicant through `/admin/crew`, then use the public page's existing-application check and fresh mailbox code to retrieve the shared receipt. Continue to `/register` and review a new account or additive Crew access for an existing tutor. Check pending/rejected status, a revoked/expired/used grant, disabled Crew, resend proof invalidation and original-answer retry preservation. Keep staff approval separate from mailbox proof and account review.
- **History-only access** starts from a staff-reviewed historical tutee invitation at `/history/claim`. Rehearse with synthetic archive records: send the invitation in the roster editor, verify a separate email code, inspect the receipt popup, test copy/optional mail/prefilled continuation to `/register`, create missing credentials and explicitly claim the record after sign-in. Closing or showing the popup does not claim ownership. No current enrollment or policy acceptance is needed. Keep development email tokens/codes in ignored local logs, never public evidence.

Follow the [role guide](../guides/user-guide.md) using the [demo accounts](#demo-accounts-and-workflows). Real SMTP setup and final school policy approval remain launch configuration work; local capture delivers no external mail.

Verify new five-character mixed invitations and four-digit email verification codes,
including leading zeros, separately from outstanding legacy formats. Check the legacy
single wide input with gray `XXXXX`/`XXXX` placeholders, green/blue box backgrounds,
neutral text/borders, typing, full-code paste, correction, keyboard focus, invitation
letter entry, numeric email keyboards, email autofill and accessible errors.
Test at desktop/mobile sizes in English/Chinese, all accent themes and enlarged text.
Verify invitation receipts, management share cards/exports and actual generated HTML
emails as well as entry fields. Code purpose remains explicit in field labels or mail
instructions. Email must retain its legacy single code panel, typography, border and
spacing; only its background changes to dark green (`#18342C`) or blue (`#172F49`).
Check that instructions and full codes remain readable when stylesheets or images are blocked.
Use `npx tsx scripts/preview-emails.ts` to generate synthetic invitation, verification
and legacy-mail previews in ignored `.validation/email-previews`; it sends no mail.

Check copied-code mailbox verification and verified-browser handoff independently.
Older five-digit, five-character alphanumeric and twelve-character invitations must
survive typing/paste, receipt retry and optional email without truncation; preserve
their legacy letter aliases without converting a numeric `1` into `I`. Test existing
six-character tutee verification challenges against their persisted format version,
alongside replacement four-digit challenges. Include wrong-purpose/length input,
expired/used codes, each flow's existing five- or six-failure budget, resend
invalidation and failed delivery. A legacy challenge with one allowed attempt
remaining must not be rejected early merely because its format predates deployment.

### UI verification

Use the [gallery and affected-page verification matrix](verification.md#ui-pattern-gallery).
Keep screenshot requirements and UI handoff rules in that guide.

## 5. Run the tests

For invitation and email-code presentation, run `node scripts/test-code-fields.mjs`
against an isolated demo site. Set `TEST_BASE_URL` and `SHBS_BROWSER_STATE` to a
synthetic staff browser state; the public-page cases run signed out, and the state
is used only to reach the development gallery. `SHBS_BROWSER_MODULE`,
`SHBS_BROWSER_CHANNEL` and `SHBS_BROWSER_OUTPUT` select the installed browser runtime
and ignored evidence directory. To include email screenshots, first run
`npx tsx scripts/preview-emails.ts .validation/email-previews` and set
`SHBS_EMAIL_PREVIEWS` to that directory. The check types, pastes and corrects
synthetic codes without redeeming them or sending mail. It records English/Chinese,
390/1440 px, enlarged-text and all six gallery themes, including native input
scroll measurements so complete older codes remain editable without page overflow.
At 200% text on narrow screens, the retained legacy font and tracking can also
require native scrolling for a new code; verify Home/End reaches both ends and
preserves the full value without shrinking the text.
Component and integration suites separately cover submission, delivery failures,
legacy compatibility, purpose ownership and attempt budgets.

For shared table-action sizing, run `node scripts/test-table-action-layout.mjs`
against a loopback synthetic site. Set `TEST_BASE_URL` and `SHBS_BROWSER_STATE`
to an authenticated staff Playwright storage-state file; optionally set
`SHBS_BROWSER_MODULE`, `SHBS_BROWSER_CHANNEL` and `SHBS_BROWSER_OUTPUT` as for
the tutor form check below. It measures Time Slots, Users & Roles, Tutee List and
the gallery in English/Chinese at 390, 768, 1023, 1024 and 1440 px. It checks
24 px desktop / 44 px narrow targets, adjacent links, sticky actions, keyboard
detail dialogs, all six gallery palettes and enlarged long labels, saving local
screenshots and JSON evidence without submitting application data. Role denial
and empty/error states remain covered by the corresponding component tests;
gallery palette checks do not measure contrast.

For public signup URL changes, run `node --test --test-concurrency=1
scripts/test-public-signup-urls.mjs` against a running synthetic local site with
`TEST_BASE_URL` set to its loopback origin. This checks permanent redirects,
repeated/encoded query values and adjacent private routes. Capture the canonical
forms at desktop/mobile widths in English/Chinese, including legacy-link arrival,
native Back/Forward and feature-disabled Viewer/Crew access. The full mapping is
in the [URL convention](../reference/technical-report.md#public-signup-url-convention).

```bash
npm test            # one-shot
npm run test:watch  # watch mode
```

CI divides the complete suite across eight independent runners, with a nine-minute
limit per whole job including setup. To reproduce one partition locally after
configuring the isolated database below, run
`npm test -- --shard=1/8 --maxWorkers=1` (replace `1` with `2` through `8`). Run
these partitions serially on a shared local database; the CI matrix's separate
PostgreSQL services are what make parallel execution safe. `npm test` continues
to run the complete suite. See [CI checks and timing evidence](verification.md#required-checks)
for the sizing baseline and hosted verification requirements.

Application tests live under `src/**/*.test.{ts,tsx}`:

- **Pure unit tests** (e.g. `src/lib/service-hours.test.ts`) — no database needed.
- **Integration tests** (e.g. `src/server/api/routers/scoping.test.ts`) — exercise the tRPC
  routers against a **real database**, verifying role/ownership scoping. They run serially
  (`fileParallelism: false`) and need a reachable `DATABASE_URL` with the schema applied.
- **UI render tests** exercise interactive controls in jsdom without starting the website.

[`src/test/setup.ts`](../../src/test/setup.ts) loads `.env` and supplies fallback
`AUTH_SECRET`/`DATABASE_URL` values for tests that need no live database. It does
not create a database or make that fallback safe for integration tests. Set an
explicit isolated URL for both migration and test commands. For example, in Bash:

```bash
export DATABASE_URL="postgresql://postgres:password@localhost:5432/shbs_shipping_test"
npm run db:migrate
npm test -- --maxWorkers=1
```

In PowerShell, set `$env:DATABASE_URL` to the isolated connection URL before running
the same migration and test commands. Use credentials and a loopback port belonging
to your test PostgreSQL instance, then restore the environment before demo work.

Use a separate loopback database named `shbs_shipping_test` for the complete suite. The shared
[guard](../../src/test/database-guard.ts) requires a local `_test` database, and individual integration suites apply narrower name
allowlists; an arbitrary `_test` name does not satisfy every suite. Create the database, set
`DATABASE_URL` for both `npm run db:migrate` and `npm test -- --maxWorkers=1`, and never point these
destructive fixtures at a development site or production database.

For the tutor creation layout regression, run `node scripts/test-tutor-form-layout.mjs`
against a running loopback site with synthetic data. Set `TEST_BASE_URL`,
`SHBS_BROWSER_STATE` to an authenticated staff Playwright storage-state file, and
optionally `SHBS_BROWSER_MODULE` to an existing Playwright module URL and
`SHBS_BROWSER_CHANNEL` to your installed browser channel. `SHBS_BROWSER_OUTPUT`
selects the ignored evidence directory. The script checks English/Chinese at five
widths, dialog opening/dismissal, draft retention, keyboard focus, native validation
and enlarged text, captures screenshots and submits no data. The component suite
also covers pending/error/success states and read-only access to the creation dialog.

Lint and type-check the same way CI does:

```bash
npm run check       # next typegen + eslint . + tsc --noEmit
npm run docs:check  # documentation links, headings and maintenance regressions
```

Email ownership and notification regressions live in `src/server/auth/account-emails.test.ts`, with migration compatibility in `account-email-migration.test.ts` and component interaction coverage in `src/app/_components/account-emails.test.tsx`. Include expiry, failed delivery, legitimate registration, simultaneous claims, removal/recovery, gating and retry scenarios. Use synthetic accounts and captured mail for browser rehearsal; follow [email operations](../guides/deployment.md#optional-notification-delivery) for real deployments.

`src/server/student-delivery.test.ts` crosses the real audited assignment/resend and
approval APIs with the real sender and synthetic Nodemailer outcomes. It verifies
post-commit acceptance/failure, rollback without sending, previous-link preservation
and overlapping resends against the isolated test database. Run it alongside
`student-survey.test.ts`, `audit/evidence.test.ts` and the email sender/outbox suites
when changing this delivery boundary. SMTP acceptance is not an inbox-delivery check.

History-only credentials and cancellation use `src/server/history-account-setup.test.ts` alongside `src/server/api/routers/tutee-history.test.ts`. These suites require the isolated `shbs_shipping_test` database and check archive preservation, shared email ownership, retries, cancellation/expiry, access scoping and transaction rollback. Include the existing account-combination and school-departure regressions when changing this boundary.

`src/server/tutee-history-delivery.test.ts` exercises the real audited invitation API,
sender and PostgreSQL transactions with synthetic Nodemailer outcomes. It verifies
committed inactive admission, predecessor preservation, latest-admitted replacement
ordering, cancellation (including first delivery), setup/account-review progress,
authority/freshness changes and read-only recovery after uncertain publication.
Run it with the historical API/setup, account-invitation, audit and email suites;
provider acceptance is separate from inbox delivery. No production SMTP is used.

Historical tutor linking uses `src/server/tutor-history.test.ts` and
`src/app/_components/tutor-history-link.test.tsx`. Include account-combination,
historical-academic, registration and roster-editor regressions when changing its
ownership boundary. Apply `20261007010000_tutor_history_ownership` to the isolated
database first. On the running site, check **Tutors → Show past tutors → Edit Profile →
Combine Records**, then verify **My Tutoring History** with the target login.
Cover Admin/Head linking, Coordinator denial, a competing current login, retained-owner
correction, several archives alongside a current tutor, and unchanged stored hours.
Use EN/ZH at 1440/390 px and enlarged text; verify native selector names and actual
control heights as well as pending/error recovery in the component tests.

Canonical grouping and its migration are covered by `src/server/person-combine.test.ts`
and `src/server/person-identity-migration.test.ts`. The migration suite executes the
committed SQL over populated, transaction-local schemas, checking explicit-link
backfill, preserved source evidence, unresolved logins and atomic rejection of
invalid ownership. It always rolls back; use the isolated test database above.
Keep `Person.primaryUserId`'s restrictive foreign key in production. Narrow fixtures
that delete their own accounts must release only their own primary references and
remove only exclusive, unused identity metadata; never truncate unrelated people.
Profile-editor fixtures must provide the real grouping child's disabled candidate
query and read-recovery utilities even while its section is closed. Opening or
closing a review must not submit a combination.

### Runtime packaging checks

Run `npm run test:deployment` for the synthetic runtime assembler, canonical file
inventory and image-comparison regressions as well as the deployment helpers.
Run `python3 scripts/test_image_storage_metrics.py` separately with Python 3;
it uses only the standard library and synthetic Docker-save archives. These
checks do not build images, contact the Docker daemon or use a database.

The assembler combines traced standalone dependencies with full production
dependencies before final image copies, while keeping dependency and application
outputs disjoint. Its fixtures cover production-file precedence, links, metadata
and refused unsafe outputs. Inventory/comparison fixtures check content and
runtime-configuration comparisons; archive fixtures exercise layer-content and
snapshot-chain accounting. See [CI runtime packaging verification](verification.md#required-checks)
for the actual controlled-image measurement and its limits.

The full image comparison is restricted to an isolated CI job. Do not set `CI`
locally just to bypass that guard or run four image layouts against a shared
daemon. Use the current workflow's JSON evidence; coordinate any necessary local
image smoke through the existing [Compose smoke test](#6-smoke-test-the-production-docker-stack-optional)
and resource-ownership rules instead.

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

See the [user guide](../guides/user-guide.md) for record corrections and participant workflows, and [repository hygiene](documentation.md#retain-source-and-owned-resources) before deleting runtime fixtures or caches. Store local evidence in ignored `outputs/` or `.validation/`.

## Browser tab icon (favicon)

Replace **`src/app/icon.png`** with your logo as an actual PNG image, keeping the
filename. Use a square image (512 × 512 recommended) with a simple design that
remains readable at 16 × 16. Transparency is supported.

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

## Runtime branding

Set `APP_TITLE`, `TEAM_TITLE`, `ORG_NAME`, `SUPPORT_EMAIL` and
`PROGRAM_TERM_LABEL` in your local `.env` and restart the server. Blank values use
repository defaults. These values are read on the server and passed to client
components; they need no build arguments. Replace old `NEXT_PUBLIC_*` branding
keys with the unprefixed names. Static assets and source changes still require a
production rebuild. See [configuration and update workflows](../guides/deployment.md#6-updates)
for Compose deployment and secret handling.

An existing `.env` is not upgraded by `git pull`. Compare its keys with
`.env.example` and rename those five old keys in place, preserving values; do not
replace the file or regenerate credentials. Your local `.env` is independent of
the VPS file. See [production updates](../guides/deployment.md#6-updates) to retain server
data, or [reset and redeploy](../guides/deployment.md#start-fresh-from-an-existing-deployment)
to start with an empty database and a new environment file.

With a running production build, `node --test scripts/test-runtime-branding.mjs`
checks public metadata, the client branding payload and browser bundles. Set
`TEST_BASE_URL` and the expected branding environment variables to match the server;
provide only disposable secret sentinels when exercising secret-exclusion checks.
CI runs this with defaults and overrides against the same image across recreation.
