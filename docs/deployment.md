# Deployment runbook — SHBS Peer Tutoring

Single-VPS deploy (2 vCPU / 4 GB / 40 GB) with Docker Compose + Caddy (auto HTTPS).
The memory-heavy image build runs in **GitHub Actions → GHCR**; the VPS only pulls.

## Architecture

```
Internet ──443/80──▶ caddy ──▶ app:3000 ──▶ db:5432
                     (TLS)      (Next.js)     (Postgres, internal only)
```

- Only **caddy** publishes ports (80/443). `app` and `db` are internal-only.
- `app` waits for `db` to be healthy (`pg_isready`), then runs `prisma migrate deploy` and starts.
- Postgres data lives on the `db-data` named volume; Caddy certs on `caddy-data`.
- The image runs a non-root Node 22 / Next.js 16 standalone server, with Prisma 7
  migrations and PostgreSQL 16. Uploaded `HomeImage` bytes are stored in PostgreSQL,
  so they are included in the database backup; repository assets are in the image.
- GitHub Actions publishes images after verification; it does **not** update the VPS.
  The host must pull and recreate the app. There is no automatic deployment agent
  or separate notification service in the supplied Compose stack.

## Start fresh from an existing deployment

Use this path when the old deployment's data is disposable. For a first installation,
start at [prerequisites](#1-prerequisites); for an update that retains data, use
[updates](#6-updates).

**The reset deletes the project's PostgreSQL database, including all accounts,
program settings, published content and uploaded images, plus Caddy's certificate
and configuration volumes.** Caddy obtains certificates again on the next start.
It does not remove the checkout, host backup files or other Compose projects.

Review the desired release and confirm its image has been published before taking
anything down. Run the following stages separately on the VPS and stop on errors.
Use the existing deployment directory and any existing Compose project-name
options so the reset targets the intended stack.

1. Inspect the stack, then remove its containers and volumes:

   ```bash
   cd /opt/shbs  # substitute the existing deployment directory
   docker compose ps
   docker compose config --volumes
   # Optional, if you want a recovery copy before discarding the data:
   # bash scripts/backup.sh
   # (umask 077; cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)")
   docker compose down --volumes
   ```

2. Update the checkout to the selected release. For a checkout following `main`,
   use the commands below, reconciling local changes if the pull refuses. Replace
   the old environment file with the current template only after the reset:

   ```bash
   git pull --ff-only
   (umask 077; cp .env.example .env)
   chmod 600 .env
   nano .env
   ```

   Follow [runtime configuration](#3-configure-runtime-settings-and-secrets): set
   the real `DOMAIN`, published `APP_IMAGE`, a new `AUTH_SECRET` of at least 32
   characters, and new `POSTGRES_*` credentials with a URL-safe password. Configure
   the verified SMTP sender/password and use the current unprefixed branding keys
   (`APP_TITLE`, `TEAM_TITLE`, `ORG_NAME`, `SUPPORT_EMAIL`, `PROGRAM_TERM_LABEL`).
   No old-key migration is needed when starting from the current template.
   SMTP credentials can be reused; they belong to the mail provider, not the deleted
   database. Keep the DNS pointing at the VPS if the domain and host are unchanged.

3. Start the fresh stack:

   ```bash
   docker compose config --quiet
   docker compose pull
   docker compose up -d
   docker compose ps
   docker compose logs --since=10m --tail=100 app
   docker compose exec app node node_modules/prisma/build/index.js migrate status
   ```

   The database initializes from `POSTGRES_*`; the app applies migrations and starts
   with no accounts or program data. Complete [first-admin bootstrap](#create-the-first-admin-first-deploy),
   then configure the program and publish content through the website. Do not run
   the demonstration seed. Finish with [deployment verification](#verify-either-update)
   and [intake checks](#verify-before-opening-intake).

## 1. Prerequisites

1. A VPS running Ubuntu (22.04/24.04), with a public IP.
2. A domain, with an **A record pointing at the VPS IP** — set this _before_ first start so
   Caddy's Let's Encrypt challenge succeeds.

Sign-in is username or email + password (no external identity provider to register). Logins are created only
through gated paths: the first admin is created by `npm run admin:create`;
recruits self-register at **`/register`** with an admin-issued single-use code plus an emailed
verification code; and outsiders can self-register a **read-only viewer (VIEWER)** account at
**`/viewer-signup`** (email-validated, behind the `VIEWER_SIGNUP` feature flag). The public tutee
signup (`/signup`) first saves a survey; email confirmation then creates or links a student login. Tutor application (`/tutor-signup`) and crew application (`/crew-signup`) create pending records for review. Credential sign-in, the
registration steps, and viewer signup are all **rate-limited in-app** (per IP + per code / email /
identifier; `src/server/rate-limit.ts`); a CAPTCHA in front is still worth considering at scale.
Transactional email (reset links plus sign-in and password-change 2FA codes) goes through Aliyun
Direct Mail — see "Email" below. Sign-in 2FA is enforced when the `EMAIL_2FA` program feature and
the user's 2FA preference are both enabled.

## 2. Host setup (once)

```bash
sudo ./scripts/setup.sh          # installs Docker + Compose, ufw allows only 22/80/443
```

## 3. Configure runtime settings and secrets

Run deployment commands from the same VPS checkout (for example `/opt/shbs`)
throughout its lifetime. Its Compose project name selects the existing named
volumes; keep the directory/project name stable.

For a **first installation only**:

```bash
cd /opt/shbs
# Never overwrite an existing .env during an update.
[ -f .env ] || (umask 077; cp .env.example .env)
chmod 600 .env
nano .env
# Set DOMAIN, APP_IMAGE=ghcr.io/<owner>/shbs-peer-tutoring-website:latest
# Generate AUTH_SECRET once: openssl rand -base64 32 (at least 32 characters)
# Choose POSTGRES_USER, POSTGRES_DB, and a URL-safe POSTGRES_PASSWORD once:
# openssl rand -hex 32
# Set EMAIL_FROM, SMTP_PASSWORD and the provider's SMTP_HOST / SMTP_PORT.
docker compose config --quiet
```

Keep production values in the private VPS `.env`, not Git, GitHub Actions build
arguments, Dockerfile `ENV`, or `NEXT_PUBLIC_*` fields. `.dockerignore` excludes
real `.env` files. CI uses disposable test credentials and builds the image without
production secrets or branding arguments.

| Configuration | Where it is set / default | Apply a change |
| --- | --- | --- |
| Application/UI source, `src/app/icon.png`, repository logos/assets, bundled translations and branding defaults in `src/lib/branding-config.ts` | Git; the tab icon is the single repository-owned PNG | Commit → main → CI → GHCR → pull app image |
| `APP_TITLE`, `TEAM_TITLE` | VPS `.env`; `SHBS Peer Tutoring`, `SHBS Peer Tutoring Team` | Recreate app; no rebuild |
| `ORG_NAME`, `SUPPORT_EMAIL`, `PROGRAM_TERM_LABEL` | VPS `.env`; organization falls back to app title, other labels are empty | Recreate app; no rebuild |
| `MESSAGES_OVERRIDE`, `AUTH_BOOTSTRAP_ADMIN_EMAILS` | VPS `.env`; empty by default | Recreate app; existing published content can override messages |
| `AUTH_SECRET`, `SMTP_PASSWORD` | VPS `.env`; no production secret defaults | Recreate app; keep the auth secret stable across restarts/instances |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | Server-only VPS `.env`; host `smtpdm.aliyun.com`, port `465`, login falls back to sender address, display name to `APP_TITLE`; sender/password unset | Recreate app; verify real delivery |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | VPS `.env`, chosen at database initialization | Preserve for existing volume; credential changes need a separate database operation |
| `DATABASE_URL`, `AUTH_URL`, `AUTH_TRUST_HOST`, `NODE_ENV` | Compose derives database URL from `POSTGRES_*`, sets `https://${DOMAIN}`, `true`, `production` | Do not override derived values in `.env` |
| `DOMAIN` | VPS `.env`; replace example domain with real DNS name | Update DNS; recreate app **and Caddy** |
| `APP_IMAGE` | VPS `.env`; replace `OWNER` with lowercase GitHub owner | Pull and recreate app |
| `BACKUP_DIR`, `BACKUP_RCLONE_REMOTE`, `BACKUP_S3_URI`, `BACKUP_SCP_DEST` | Host `.env`; output defaults to checkout `backups/`, destinations empty | Next host backup invocation; no container recreation |
| `TRPC_DEV_DELAY` | Local development `.env`; `false` | Restart development server; no effect in production |

Only the five branding fields are deliberately projected into the browser. They
are public information; never place credentials in them. Server-rendered UI,
client components, page metadata and email subjects use the same runtime titles.
An explicit `EMAIL_FROM_NAME` overrides only the email sender display name.
Blank branding values use repository defaults. Rename existing
`NEXT_PUBLIC_APP_TITLE`, `NEXT_PUBLIC_TEAM_TITLE`, `NEXT_PUBLIC_ORG_NAME`,
`NEXT_PUBLIC_SUPPORT_EMAIL`, and `NEXT_PUBLIC_PROGRAM_TERM_LABEL` keys by removing
`NEXT_PUBLIC_`; the old names are no longer read. No GitHub Actions variables are
needed for branding.

`MESSAGES_OVERRIDE` is JSON read directly by the server, outside the `src/env.js`
schema; malformed JSON is ignored. Message precedence is bundled locale JSON →
environment override → database translations edited in `/localization`.
`SKIP_ENV_VALIDATION` is a build/test escape hatch; leave it unset in production
(even the string `false` is nonempty and skips validation). Local build controls
`SHBS_WORKSPACE_ROOT`, `SHBS_BUILD_CPUS` and `SHBS_DISABLE_BUILD_CACHE` are not
required VPS runtime settings.

PostgreSQL applies `POSTGRES_*` only when initializing an **empty** data directory.
Editing those values later does not rename the database/user or change its password;
it instead breaks app connections or backups. Preserve the existing `.env` and
`db-data` volume. Do not regenerate credentials, rename the Compose project, run
`docker compose down -v`, delete volumes, or reseed as part of an application update.
If a credential must change, back up first and plan a coordinated PostgreSQL role
change and app/backup configuration update separately.

> **Accepted applicants self-register:** accepting a tutor application issues a single-use
> registration code (bound to their email, re-viewable on `/admin/registration-codes`); the recruit
> redeems it at `/register` to verify their email and set their own password. No shared default
> password is involved.

`DATABASE_URL`, `AUTH_URL`, and `AUTH_TRUST_HOST` are set automatically in `docker-compose.yml`.

## Email — Aliyun Direct Mail (邮件推送)

Transactional email — password-reset and tutor-setup links, emailed sign-in and password-change
2FA codes, and registration / viewer one-time codes — is sent through **Aliyun Direct Mail** over SMTP
(`src/server/email/sender.ts`: a pooled, TLS-enforced, timeout-bounded transporter that logs each
send and failure). Until `EMAIL_FROM` + `SMTP_PASSWORD` are set the app logs mail in development
and rejects production flows that require email. SMTP is optional for a first boot only if those
flows remain unused; it is **required** for password resets, registration/viewer verification, and
any emailed code. The `EMAIL_2FA` feature defaults off and cannot be enabled until delivery is
configured.

**Set it up in the Aliyun console** (https://dm.console.aliyun.com):

1. **Open Direct Mail** (邮件推送 / DirectMail) and pick a **region** near your users. The region
   decides your SMTP host: Hangzhou → `smtpdm.aliyun.com`; new Singapore endpoint → `smtpdm-ap-southeast-1.aliyuncs.com`.
2. **Email Domains → New Domain** (发信域名): add a subdomain you control, e.g. `mail.your-school.edu`.
   Copy the exact DNS names, types and values generated by Aliyun for that domain and region,
   including its required verification and mail-authentication records. Do not substitute guide
   examples. Add them, then click **Verify** until all required checks pass.
3. **Sender Addresses → New Sender Address** (发信地址): create e.g. `noreply@mail.your-school.edu`,
   type **Triggered/Transactional** (触发).
4. On that sender address, **set an SMTP password** (设置 SMTP 密码). This is a dedicated password,
   **not** your Aliyun account password — copy it once.
5. (Recommended) Raise the address's daily quota / verify a **reply-to** if you want replies.

**Then fill `.env`:**

```bash
SMTP_HOST="smtpdm.aliyun.com"            # or your region's host
SMTP_PORT="465"                          # 465 = implicit TLS; Aliyun also lists 25/80 with STARTTLS
EMAIL_FROM="noreply@mail.your-school.edu" # the verified sender address
EMAIL_FROM_NAME="SHBS Peer Tutoring"     # optional From display name
SMTP_PASSWORD="<the SMTP password from step 4>"
# SMTP_USER is optional — it defaults to EMAIL_FROM (Aliyun logs in as the sender address).
```

Recreate the app container (`docker compose up -d --force-recreate app`) and test via **Forgot password** at `/signin`.
If mail doesn't arrive: confirm the domain shows verified, the `From` exactly equals the sender
address, outbound port 465 is open from the host, and check `docker compose logs app` for SMTP errors.

## 4. Image build (CI → GHCR)

Pushing to `main` triggers `.github/workflows/docker-build.yml`, which builds and pushes
`ghcr.io/<owner>/shbs-peer-tutoring-website:latest`.

Only a push or manual dispatch for the `main` ref can publish. Runs for the same pull request or
ref cancel older runs, and the publish job rechecks that its commit is still the current
`origin/main` immediately before building and pushing. A superseded run fails closed, so a slower
older build cannot replace `latest`; the accompanying SHA tag identifies the published revision.

If the package is private, authenticate the VPS to GHCR once:

```bash
echo <GITHUB_PAT_with_read:packages> | docker login ghcr.io -u <github-user> --password-stdin
```

## 5. Deploy

```bash
docker compose pull            # pull the prebuilt app image (+ postgres, caddy)
docker compose up -d           # start everything; app runs migrations on boot
docker compose ps              # all services should be "running"/"healthy"
docker compose logs -f app     # watch migrations + startup
```

Visit `https://<your-domain>` — Caddy issues the cert on first request, then sign in with
email + password at `/signin` after the bootstrap command below.

### Create the first admin (first deploy)

You need at least one `User` with a password before anyone can sign in. The first address in
`AUTH_BOOTSTRAP_ADMIN_EMAILS` is promoted to the singleton `HEAD` when no HEAD exists; later
addresses are promoted to `ADMIN`. This promotion applies when an existing account signs in—it
does not create the account.

> ⚠️ **Do not run the bundled `prisma/seed.ts` as-is in production.** It creates sample
> people _and_ demo login accounts (`admin@example.edu`, `alice@example.edu`) with the
> well-known dev password `Password123!`. That's strictly for local development.

Run the bootstrap command inside the deployed image. The Compose network supplies the database
connection; no database port needs to be published and no demo seed is needed:

```bash
export BOOTSTRAP_ADMIN_EMAIL='you@school.edu'
export BOOTSTRAP_SCHOOL_YEAR='26-27'
export BOOTSTRAP_QUARTER='Q1'
read -r -s -p 'Initial admin password: ' BOOTSTRAP_ADMIN_PASSWORD
echo
export BOOTSTRAP_ADMIN_PASSWORD
docker compose exec -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD \
  -e BOOTSTRAP_SCHOOL_YEAR -e BOOTSTRAP_QUARTER \
  app node node_modules/tsx/dist/cli.mjs scripts/create-admin.ts
unset BOOTSTRAP_ADMIN_PASSWORD
```

The command requires at least 12 password characters. It creates one HEAD and an active period
when missing; rerunning it preserves the HEAD and existing active period while deliberately
resetting the named account's password. A second account becomes ADMIN. Without period arguments,
the school year defaults at the August boundary and the initial quarter is Q1. Set them explicitly
for the first deployment. No tutors, students, subjects, rooms or sample content are seeded.

After signing in, configure Subjects & Levels, Time Slots, Rooms, signup timing and public content
through the website. The existing development database is disposable and is not copied to the VM.
Production migrations still run on every boot so later upgrades preserve production data.

The image includes the complete production Prisma CLI dependency tree plus the bootstrap script.
CI boots that exact image against an empty `shbs_boot_test` database, verifies the health and
sign-in routes, runs bootstrap twice, checks default and runtime branding, metadata and public-bundle secret exclusion, and recreates that same image with changed branding to verify record preservation and automatic expiry of overdue unverified assignments. Image publishing depends on that gate passing. The integrated test suite uses only the loopback `shbs_shipping_test` database; never point destructive fixtures at production.

> Password reset works once Aliyun Direct Mail is configured (see "Email" above). After the first
> HEAD exists, tutor accounts and setup links can be managed from the admin UI.

## 6. Updates

### Application, UI and repository assets

Edit locally, including `src/app/icon.png` or logos when needed → commit → push or
merge to `main` → wait for successful CI publication → GHCR → update the VPS:

```bash
cd /opt/shbs
docker compose pull app
docker compose up -d app
```

Do not edit application source inside the VPS checkout or running containers to
change the deployed UI. The app runs the published image, not that checkout's
source. If a release changes Compose, Caddy or host scripts, also update those
tracked deployment files with `git pull --ff-only` after reviewing the release;
preserve `.env` and keep the Compose project name unchanged. An image update
reruns pending migrations and preserves the database volume and existing records.
A customized runtime title takes precedence over a changed repository default.
Database-managed landing content/translations remain as published; update those
through their administration screens when required.

### App runtime settings and branding

```bash
cd /opt/shbs
nano .env
# Validate interpolation without printing secrets.
docker compose config --quiet
docker compose up -d --force-recreate app
```

This applies `APP_TITLE`, `TEAM_TITLE`, contact labels, SMTP and other server
settings without rebuilding. `docker compose restart` alone does not reload the
container environment. Compose validation checks structure/interpolation; app
startup validates required runtime values and logs connection/migration failures.

For a domain change, update DNS and `DOMAIN`, then recreate both consumers:

```bash
docker compose config --quiet
docker compose up -d --force-recreate app caddy
```

Caddy keeps ports 80/443 and its certificate volume. Host backup settings are read
by `scripts/backup.sh` on its next run; edit `.env`, keep values shell-compatible
and quoted, and run `./scripts/backup.sh` to verify a changed destination. Provider
CLI credentials stay in the host's private provider configuration, never the image.

### Verify either update

```bash
docker compose ps
docker compose logs --since=10m --tail=100 app
docker compose logs --since=10m --tail=50 caddy
# Substitute the actual DOMAIN; do not use --insecure to bypass TLS validation.
curl --fail --show-error --silent https://tutoring.example.edu/signin -o /dev/null
curl --fail --show-error --silent https://tutoring.example.edu/api/trpc/health
curl --fail --show-error --silent https://tutoring.example.edu/icon.png -o /dev/null
```

Confirm app startup completed after successful Prisma migrations (or no pending
migrations), `db` is healthy, Caddy is running, and health returns
`result.data.json.ok: true`. Open the HTTPS homepage and signup pages, check their
titles and browser tab icon, then sign in and check the management title and an
existing record. Refresh open tabs after runtime changes. For a replaced icon,
close/reopen the tab or clear cached site data. Check a password-reset email's
subject and sender after changing branding/SMTP. Keep operational evidence private.
The public icon smoke test can also target the deployment from your local checkout:

```bash
TEST_BASE_URL=https://tutoring.example.edu node --test scripts/test-tab-icon.mjs
```

## 7. Backups

```bash
./scripts/backup.sh            # pg_dump | gzip into ./backups, 14-day rotation
# Schedule daily:
#   crontab -e
#   0 3 * * *  /opt/shbs/scripts/backup.sh >> /var/log/shbs-backup.log 2>&1
```

Set one or more optional destinations in `.env` to copy each successful dump off-box:
`BACKUP_RCLONE_REMOTE`, `BACKUP_S3_URI`, or `BACKUP_SCP_DEST`. The matching CLI must be
installed on the host; the script exits non-zero if a configured upload cannot run.

Restore:

```bash
# Rehearse restoration into a NEW disposable database first; never overlay a running database.
docker compose exec -T db createdb -U "$POSTGRES_USER" shbs_restore_test
gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" shbs_restore_test
# Check restored records and application behavior before planning a production recovery.
```

## Troubleshooting

- **Cert not issued:** confirm DNS A record resolves to the VPS and ports 80/443 are open.
- **App restarting:** `docker compose logs app` — usually a bad `.env` value or DB not reachable.
- **Fresh sign-ins fail or alternate between servers:** confirm every instance uses the same stable `AUTH_SECRET`, canonical `AUTH_URL` and HTTPS proxy settings.
- **DB healthcheck failing:** `docker compose logs db`; ensure `POSTGRES_*` match across `.env`.

## Optional notification delivery

For the supplied Docker deployment, pull and recreate the app as above: the image
contains the generated Prisma client and its entrypoint runs migrations. For a
source-based deployment outside Docker, apply all migrations with `npm run db:migrate`,
regenerate Prisma with `npx prisma generate`, build the application and restart the
persistent Node process before enabling optional notifications. The account-email migration atomically backfills primary addresses and recovery-token destinations; normalized collisions abort instead of merging accounts. Resolve legacy collisions before retrying. The follow-up migration releases any unverified secondary claims created by an earlier version and revokes their grants, preserving primary and verified secondary addresses. Affected users can request a new verification code.

The worker polls every 30 seconds and leases up to ten deliveries per batch for five minutes. Row locking coordinates concurrent workers. Failures retry with exponential backoff, up to five attempts; the Program settings panel shows terminal failures. Inspect `EmailDelivery` status and safe failure summaries when diagnosing transport problems. A stable Message-ID identifies retries, but SMTP cannot guarantee exactly-once delivery after a process stops between acceptance and recording success. Short-lived deployments require an external scheduler calling the dispatcher.

Configure and test the real email transport before enabling the immediate ADMIN/HEAD switch. Disabling cancels queued optional notices without discarding preferences; security alerts continue through the same worker, and essential authentication mail remains independent. The optional-email availability migration adds the independent secondary-binding flag (default on) without changing stored addresses or preferences, and updates enqueue rules so security alerts cannot be suppressed. Apply the migration and updated dispatcher together; legacy `emailSecurity` values are retained but no longer control delivery. See [notification controls](program-reference.md#optional-email-notifications) and [personal preferences](user-guide.md#optional-email-notifications).

## Verify before opening intake

Complete these checks on the actual host after bootstrap or an update:

1. Confirm the canonical HTTPS domain, application health and a successful container restart with all migrations applied.
2. Confirm PostgreSQL and uploaded media persist after replacing the app container.
3. Deliver signup, password-reset and verified email-change messages to real inboxes; check sender identity and usable links.
4. Publish the [reviewed policies](policies/README.md#publish-a-revision) and school-specific public content. Review translations before enabling hidden languages.
5. Configure the current school year/intake, subjects, slots, rooms, tutor qualifications, opening time, school calendar and feedback visibility using the [program reference](program-reference.md). Check a test participant's signup and consent flow.
6. Restore a backup into a separate database and confirm usable records. Check backup retention and off-host copies.

A successful build or published GHCR image does not verify target-host TLS, persistence, delivery or restore readiness. Use current CI results for code verification and record operational evidence privately.

### Public application forms show a loading error

On a fresh deployment, inspect the public `tutee.signupOptions`, `application.options`, `tutee.surveyPolicy`, and `application.policy` requests. Before the recruitment-preview fix, an unpublished English policy returned HTTP 412 and appeared as a generic “could not load” error. Empty subjects or required tutee slots are separate setup gaps. Retrying or restarting does not create this configuration.

Apply migration `20260922140000_recruitment_windows` with the release, regenerate the Prisma client when running from source, and restart the app. The updated public policy reads return an explicit absent-policy state; forms render a read-only preview with the missing prerequisites listed. Database/network failures still surface as loading errors. Use **Policy Documents**, **Subjects & Levels**, **Time Slots**, and the separate recruitment panels in **Program & Refresh** to complete setup. Publish reviewed school policy content; do not seed demo data in production. Verify both public forms before and after their configured opening/closing boundaries.
