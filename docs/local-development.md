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

CAPTCHA grant/admission tests use an isolated provider fixture, including the SDK
configuration and runtime-option constructors. The separate
`src/server/captcha/aliyun-runtime.test.ts` compatibility test constructs the real
installed SDK client and models, replacing only its network method. Run both when
changing that boundary. A focused pass does not replace a complete-suite pass;
retain failed full-run receipts when investigating timing failures.

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
The same serial suite tests the [private network evidence collector](deployment.md#collect-a-private-host-inventory)
against synthetic listener/Docker commands, including timeouts, permission errors,
output/inventory limits and secret exclusion. It never queries the real daemon or
probes production. Production acceptance still requires the operator worksheet and
independent external checks in the deployment runbook.

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
- **History-only access** starts from a staff-reviewed historical tutee invitation at `/history/claim`. Rehearse with synthetic archive records: send the invitation in the roster editor, verify a separate email code, create credentials, sign in and explicitly claim the record. No current enrollment or policy acceptance is needed. Keep development email tokens/codes in ignored local logs, never public evidence.

Follow the [role guide](user-guide.md) using the [demo accounts](#demo-accounts-and-workflows). Real SMTP setup and final school policy approval remain launch configuration work; local capture delivers no external mail.

### UI pattern gallery

While `npm run dev` is running, sign in with a local demo account and open `/ui-gallery`. The gallery renders real shared components with synthetic data and no application mutations. Language, accent theme and form-state controls expose English/Chinese, all six palettes and editable/saving/error/read-only examples. Theme previews do not write the theme cookie and restore the previous theme when leaving the gallery. Reload resets the example data.

Resize the browser to test the actual viewport and breakpoints; a narrow card inside a desktop window does not simulate mobile CSS. Check the form save scope, selection state, tab keyboard navigation, dialog focus, brief table columns, rightmost text-link detail entries, comparison-table scrolling and recovery controls. Confirm actions remain reachable before and after horizontal scrolling. Follow [AGENTS.md](../AGENTS.md) for rendered control measurements. Store screenshots in ignored `outputs/` or `.validation/` and include real pages in visual verification.

The composition examples include a wide editor with nested review and policy reader, four-part participant identity, a wrapping filter toolbar, explicit disclosure lifetimes, three different settings/save models, versioned change review and background failures that retain drafts. Exercise nested Escape and focus return, save failure/retry, preview invalidation and collapse/reopen. The public card reuses production framing. These examples use synthetic state; verify domain permissions and real versioned writes on the actual pages as well.

The `/ui-gallery` server page calls `notFound()` in production, and normal authentication still applies in development. Focused gallery tests require no database:

```bash
npx vitest run src/app/ui-gallery --maxWorkers=1
```

For the additional-qualification entry dialog, run `npx vitest run src/app/_components/qualification-review.test.tsx src/app/_components/qualification-review-dialog.test.tsx src/app/_components/qualification-review-cache.test.tsx --maxWorkers=1`. The real-database counterpart is `npx vitest run src/server/qualification-applications.test.ts --maxWorkers=1` against the isolated `shbs_shipping_test` database described below. On `/admin/applications`, rehearse both additional-subject and higher-level requests: initially closed review, entry without a write, Cancel/Escape and focus return, required notes, direct approval with no reject action, rejection only through the interview chair/voting workflow, delayed/failed writes, stale draft Reload, and saved-decision refresh recovery. Include server refusal of direct rejection for both request types and Admin/Head roles, interviews enabled/disabled, assigned-panel non-bypass and restricted roles at desktop/mobile sizes in English/Chinese.

See [contributor guidance](contributing.md#reuse-interaction-patterns) for adding patterns and [technical boundaries](technical-report.md#shared-ui-patterns) for their responsibilities.

### UI verification matrix

Use one running local site with synthetic data and one browser session at a time.
Record the commit, role, language, viewport, interaction and observed result beside
the screenshots. Verify the affected application pages; a gallery screenshot alone
does not establish authorization, native browser focus or persisted behavior.

| Surface | Check in the running application |
| --- | --- |
| Tables | Brief cells; authorized text actions at the right edge before/after local scrolling; named region reachable by keyboard; populated, empty, error and read-only states |
| Forms and dialogs | Save scope; pending fields/dismissal; failed-save draft retention; nested Escape/Tab and focus return; successful child write with pending refetch; actual long-content scrolling |
| Repeat profile edits | Account, tutor, tutee and Head username: Save → automatic refresh → Save without closing or a restart action; forced fresh version read; Retry refresh without a POST; automatic completion leaves sibling focus alone; retained academic/history drafts and original versions |
| Named destructive review | Rooms, hour adjustments, pairings, time slots, subject levels, tutees and registration invitations: exact target/consequence, Cancel/Escape without writes, one confirmed mutation, queued versus applied result, failed-write retry, held refresh and read-only recovery after Close. Viewers retain only authorized read access |
| Timed confirmations | Hold a schedule-conflict write and press Escape repeatedly: the dialog and reason remain. After rejection, retry retains the reason/ticket; idle Cancel restores the opener. Mandatory policy review blocks repeated Escape even when idle while keeping explicit Sign out available. Verify native behavior separately from jsdom handlers. |
| Tutor attendance | Submit twice before the first response and verify one feature POST; reject it and retry the retained draft. Hold/fail totals refresh after acceptance, verify read-only Retry issues no attendance POST, then use Submit another entry to start a new draft. Server deduplication is a separate integration assertion. |
| Cached queries | Initial loading/error/empty are distinct; background failure retains content and draft; Retry completes; explicit conflict Reload adopts data only on success |
| Filters and settings | Pressed selections versus content tabs; filter/page reset rules; consistent control heights; immediate switches, unknown/yes/no choices and staged saves keep their own semantics |
| Mixed review/filter rows | Measure Discipline note/actions, Service Hours month/Clear/History, and Session Flags penalty/actions at 1440 and 390 px in EN/ZH, including long labels and 200% text. Check 32 px desktop baselines, at least 44 px mobile targets, wrapping and retained pending/error drafts. Session Flags must not label unknown or failed reads as an empty queue. |
| Headers and navigation | Public, patrol, localization, management, tutor, tutee and standalone account headers: single utilities, 32 px desktop / 44 px narrow controls, wrapping labels, one H1; native route Back/Forward and manual local tab activation with retained drafts. At 200% text size, check actual control bounds and pixels for overlap: workspace utilities may wrap within their mobile grid area, preserving target sizes and keeping navigation unobscured. Document width alone cannot detect controls overlapping inside the header. |
| Registration and reply | EN/ZH step count and heading focus; bound email, edit/reverify, resend failure and pending locks; reply below the sticky header, recipient context, separate drafts, cancel focus return, retry keys and permission failures |
| Enabled signup CAPTCHA | Use an isolated local SDK fixture without paid provider calls. On tutee signup and Viewer identity/code/password resends, check native Verify/Cancel/Retry reachability outside disabled ancestors, frozen drafts, cancellation/rejection recovery, one write per accepted proof and rejection of a spent server grant |
| Participant/public flows | Native invalid-name correction, legacy names, requirement markers, creation collapse/reopen, translated back/language navigation and existing consent boundaries |

Use an actual narrow viewport such as 390 CSS pixels and a desktop viewport such
as 1440 pixels; include the 1024 px boundary when sizing rules change. Check
English/Chinese, long labels and enlarged text, and inspect all six accent palettes
when shared styles change. Measure control bounds with `getBoundingClientRect()`
against [the height hierarchy](../AGENTS.md#control-height-hierarchy). Check normal,
hover, selected, disabled and focus states where the patch changes them. Distinguish
palette layout checks from measured foreground/background contrast.

Take clean screenshots after loading completes and separate captures for deliberate
failure/pending scenarios. Wait for the specific recovery notice to clear before
claiming Retry succeeded; another query may have its own error banner. Keep full
mobile forms reviewable across multiple captures. Inspect the screenshots, record
test limitations, and stop owned browser/server/database processes after checking.

## 5. Run the tests

For public signup URL changes, run `node --test --test-concurrency=1
scripts/test-public-signup-urls.mjs` against a running synthetic local site with
`TEST_BASE_URL` set to its loopback origin. This checks permanent redirects,
repeated/encoded query values and adjacent private routes. Capture the canonical
forms at desktop/mobile widths in English/Chinese, including legacy-link arrival,
native Back/Forward and feature-disabled Viewer/Crew access. The full mapping is
in the [URL convention](technical-report.md#public-signup-url-convention).

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

Email ownership and notification regressions live in `src/server/auth/account-emails.test.ts`, with migration compatibility in `account-email-migration.test.ts` and component interaction coverage in `src/app/_components/account-emails.test.tsx`. Include expiry, failed delivery, legitimate registration, simultaneous claims, removal/recovery, gating and retry scenarios. Use synthetic accounts and captured mail for browser rehearsal; follow [email operations](deployment.md#optional-notification-delivery) for real deployments.

History-only credentials and cancellation use `src/server/history-account-setup.test.ts` alongside `src/server/api/routers/tutee-history.test.ts`. These suites require the isolated `shbs_shipping_test` database and check archive preservation, shared email ownership, retries, cancellation/expiry, access scoping and transaction rollback. Include the existing account-combination and school-departure regressions when changing this boundary.

Historical tutor linking uses `src/server/tutor-history.test.ts` and
`src/app/_components/tutor-history-link.test.tsx`. Include account-combination,
historical-academic, registration and roster-editor regressions when changing its
ownership boundary. Apply `20261007010000_tutor_history_ownership` to the isolated
database first. On the running site, check **Tutors → Show past tutors → Edit Profile →
Link Historical Records**, then verify **My Tutoring History** with the target login.
Cover Admin/Head linking, Coordinator denial, a competing current login, retained-owner
correction, several archives alongside a current tutor, and unchanged stored hours.
Use EN/ZH at 1440/390 px and enlarged text; verify native selector names and actual
control heights as well as pending/error recovery in the component tests.

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
remains readable at 16 × 16. Transparency is supported. The current artwork is the
official interlocking PT logo on a green, blue and gold rounded square. It is a
472 × 472 lossless crop of the supplied artwork, with transparent corners and the
outer margin and detached marks removed; its lettering and colors are unchanged.

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
production rebuild. See [configuration and update workflows](deployment.md#6-updates)
for Compose deployment and secret handling.

An existing `.env` is not upgraded by `git pull`. Compare its keys with
`.env.example` and rename those five old keys in place, preserving values; do not
replace the file or regenerate credentials. Your local `.env` is independent of
the VPS file. See [production updates](deployment.md#6-updates) to retain server
data, or [reset and redeploy](deployment.md#start-fresh-from-an-existing-deployment)
to start with an empty database and a new environment file.

With a running production build, `node --test scripts/test-runtime-branding.mjs`
checks public metadata, the client branding payload and browser bundles. Set
`TEST_BASE_URL` and the expected branding environment variables to match the server;
provide only disposable secret sentinels when exercising secret-exclusion checks.
CI runs this with defaults and overrides against the same image across recreation.
