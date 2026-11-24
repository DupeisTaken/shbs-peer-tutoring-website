# Deployment runbook — SHBS Peer Tutoring

Single-VPS deploy (example baseline: 2 vCPU / 4 GB / 40 GB) using Docker Compose
and Caddy (automatic HTTPS). Heavy image builds run in **GitHub Actions → GHCR**;
the VPS only pulls. Always check actual filesystem headroom with the
[storage preflight](#storage-capacity-preflight).

**Quick jump:** [Architecture](#architecture) · [Start fresh](#start-fresh-from-an-existing-deployment) · [Prerequisites](#1-prerequisites) · [Host setup](#2-host-setup-once) · [Runtime settings](#3-configure-runtime-settings-and-secrets) · [Email & quota](#email--aliyun-direct-mail-邮件推送) · [Image build](#4-image-build-ci--ghcr) · [Deploy & bootstrap](#5-deploy) · [Updates](#6-updates) · [Backups](#7-backups) · [Troubleshooting](#troubleshooting) · [Notification & hours delivery](#optional-notification-delivery)

## Architecture

```text
Internet ──443/80──▶ caddy ──▶ app:3000 ──▶ db:5432
                     (TLS)      (Next.js)     (Postgres, internal only)
```

- Only **caddy** publishes ports (`80`/`443`); `app` and `db` stay internal-only.
- `app` waits for `db` (`pg_isready`), runs `prisma migrate deploy`, then starts
  a non-root Node 22 / Next.js 16 standalone server (Prisma 7 / PostgreSQL 16).
- Postgres data lives on `db-data` (including uploaded `HomeImage` bytes); Caddy
  certs live on `caddy-data`.
- GitHub Actions publishes verified images to GHCR; it does **not** deploy to the
  VPS — operators pull and recreate `app`.

### Background workers

`src/instrumentation.ts` starts five persistent Node workers on boot (so a
persistent Node process — not serverless hosting — is required):

| Worker | Cadence | Purpose |
| --- | --- | --- |
| `student-deadline-worker` | Boot + every 60 s | Expires overdue unverified student assignments |
| `scheduled-refresh-worker` | Boot + every 30 s | Checks up to 10 approved program-refresh schedules (see below) |
| `notification-delivery` | Boot + every 30 s | Runs calendar/event reminder sweeps in isolated `try/catch` blocks, then drains outbox batches of 10 up to 20 s or 100 batches (1,000 rows) |
| `session-planning-delivery` | Boot + every 30 s (weekly plan prep every 15 m) | Settles response deadlines and sends `SessionNotice` batches of 10 (5-minute lease; requires configured `PROGRAM` SMTP) |
| `school-hours-worker` | Boot + every 60 s | Generates due monthly school service-hours reports |

### Scheduled program refresh worker

Checks up to 10 approved refresh schedules serially (earliest first) using
database time and the shared period lock (safe across multiple instances).
Overdue schedules catch up after restart while the reviewed settings and
approving Head's authority remain valid. Transient failures roll back and retry;
five recorded failures pause execution and notify management. Detected review or
authority conflicts block the schedule and notify Admins/Head immediately (even
before due time). See [Schedule a refresh](program-configuration.md#schedule-a-refresh).

## Start fresh from an existing deployment

Use this only when existing deployment data is disposable (otherwise use
[updates](#6-updates)).

> **Warning:** `docker compose down --volumes` deletes the PostgreSQL database
> (all accounts, settings, content and uploaded images) and Caddy's certificate
> volumes. It leaves the Git checkout and host backup files intact.

Confirm the target GHCR image is published before stopping the stack:

1. **Remove containers and volumes:**
   ```bash
   cd /opt/shbs
   docker compose ps
   # Optional safety copy before discarding:
   # bash scripts/backup.sh
   # (umask 077; cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)")
   docker compose down --volumes
   ```
2. **Update checkout and recreate `.env`:**
   ```bash
   git pull --ff-only
   (umask 077; cp .env.example .env)
   chmod 600 .env
   nano .env
   ```
   Configure `DOMAIN`, `APP_IMAGE`, a fresh 32+ char `AUTH_SECRET`, fresh
   URL-safe `POSTGRES_*` credentials, SMTP settings, and unprefixed branding keys
   (`APP_TITLE`, `TEAM_TITLE`, `ORG_NAME`, `SUPPORT_EMAIL`, `PROGRAM_TERM_LABEL`).
3. **Run [storage preflight](#storage-capacity-preflight) and start:**
   ```bash
   docker compose config --quiet
   docker compose pull
   docker compose up -d
   docker compose ps
   docker compose logs --since=10m --tail=100 app
   docker compose exec app node node_modules/prisma/build/index.js migrate status
   ```
   Then run [first-admin bootstrap](#create-the-first-admin-first-deploy), configure
   the program through the website (never run `prisma/seed.ts` in production), and
   complete [verification](#verify-either-update) and
   [pre-intake checks](#verify-before-opening-intake).

## 1. Prerequisites

1. Ubuntu 22.04/24.04 VPS with a public IP.
2. A domain with an **A record pointing at the VPS IP** before first start so
   Caddy's Let's Encrypt challenge succeeds.
3. **Proxy trust boundary:** Keep the app port private behind Caddy. Caddy
   overwrites `X-Signup-Client-IP` (`SIGNUP_TRUST_PROXY=true` in Compose) for
   public signup quotas and replaces visitor-supplied `X-Forwarded-For`/`X-Real-IP`
   for tutor intake and sign-in. See
   [signup protection](../reference/signup-protection.md#trusted-network-boundary),
   [optional CAPTCHA](../reference/captcha.md),
   [code contracts](../reference/technical-report.md#opaque-invitation-codes), and
   [public signup URLs](../reference/technical-report.md#public-signup-url-convention).

## 2. Host setup (once)

```bash
sudo ./scripts/setup.sh          # installs Docker + Compose and configures UFW rules
```

Optional `DEPLOY_USER` adds that non-root user to the `docker` group when run as
root. `setup.sh` allows SSH from any source and does not configure SSH auth or
prove container isolation (Docker manages forwarding rules outside UFW INPUT).

### Effective network and SSH review

For Alibaba Cloud console steps, see the
[Aliyun network verification guide](aliyun-network-verification.md). All steps
below are **read-only** — preserve current SSH auth/root policy, HTTP/HTTPS,
volumes and rules until a separate operator decision authorizes changes. Keep
raw outputs private (never paste `.env`, `docker inspect` or `docker compose config`
into public issues).

#### Collect a private host inventory

Confirm intended policy with the operator first (canonical hostname, public IPs,
SSH port/source/auth policy), then run the read-only collector on the VPS (needs
Bash, coreutils, `ss`/`ip`, Docker CLI; never reads `.env`, invokes `sudo`, or
probes ports; pinned to `unix:///var/run/docker.sock`; caps: 12 containers, 8
networks, 64 KiB/cmd, 8 s/cmd, 120 s total):

```bash
cd /opt/shbs
(umask 077; mkdir -p local-operations)
bash scripts/collect-network-evidence.sh local-operations
```

Creates a mode-700 directory and mode-600 `evidence.txt`. Exit `2` or missing
`finished_utc` means incomplete collection (`OPERATOR VERIFICATION PENDING`);
exit `0` only means commands ran. Expect `app`/`db` unpublished, Caddy publishing
only `80`/`443` with container-local admin (`2019`), and review Docker's active
iptables/nftables forwarding rules ([Docker firewall guide](https://docs.docker.com/engine/network/packet-filtering-firewalls/)).

#### Complete the effective-policy worksheet

Record UTC time, host alias, reviewer, approved policy, evidence reference and
disposition (**verified**, **mismatch**, or **unknown**) for every row:

| Boundary | Required evidence |
| --- | --- |
| Scope & intended access | Canonical domain, DNS A/AAAA, approved 80/443, SSH port/source/auth policy, IPv6/UDP status |
| Listeners & containers | `sudo ss -lntup` (IPv4/IPv6) + `docker compose ps --all` + `docker ps`; explain every listener, confirm `app`/`db` unpublished and no stray stacks/host-network containers |
| Caddy administration | Inspect live startup flags and mounted/API config; confirm admin `2019` is container-local |
| Cloud & host firewall | Attached security groups/ACLs/NAT/EIPs/LBs + `ufw status verbose`, `nft list ruleset` / `iptables-save` (including Docker FORWARD/NAT) |
| Effective SSH policy | Live unit/flags + `sudo sshd -T` (and `-C` per `Match` context) compared against confirmed policy — do not flag approved password/unrestricted SSH as a defect |
| Data & image identity | `git rev-parse HEAD`, `sha256sum Caddyfile docker-compose.yml`, container image IDs, `RepoDigests`, OCI `revision` label matching CI publish run (never rely on mutable `:latest`) |
| Independent external check | Bounded external matrix below correlated with host and cloud rules |

Use `sudo -n timeout --kill-after=1s 8s ...` for privileged read-only checks;
record permission failures as **unknown**.

#### Independent external verification

From an external network outside the VPS/VPC and any interception proxy, test
each approved cell once (3 s connect timeout, 8 s total; no `--insecure`, no
port sweeps or credential probes):

```bash
curl --disable --noproxy '*' --connect-timeout 3 --max-time 8 \
  --silent --show-error --output /dev/null \
  --write-out 'remote=%{remote_ip} code=%{http_code} tls=%{ssl_verify_result}\n' \
  https://tutoring.example.edu/signin
```

- **HTTP/HTTPS (80/443):** HTTP redirects to canonical HTTPS; valid cert serves `/signin` and health.
- **Approved SSH port:** Compare reachability against confirmed source policy; a banner alone does not prove auth policy.
- **Private ports (3000, 5432, 2019, 5555, 8080):** Expect no external service response. A timeout or TCP handshake alone is **inconclusive** — corroborate with host and cloud rules.

Perimeter verification stays **pending** while any row is `unknown` or `mismatch`;
see [remaining cloud checks](aliyun-network-verification.md#status-and-access-needed).

## 3. Configure runtime settings and secrets

Keep the deployment directory (e.g., `/opt/shbs`) and Compose project name stable
for the stack's lifetime so Compose attaches the same `db-data` and `caddy-data`
volumes. For a **first installation only**:

```bash
cd /opt/shbs
[ -f .env ] || (umask 077; cp .env.example .env)
chmod 600 .env
nano .env
docker compose config --quiet
```

Keep production secrets strictly in VPS `.env` (never Git, build args, or
`NEXT_PUBLIC_*`).

| Configuration | Where set / default | How to apply |
| --- | --- | --- |
| App source, `src/app/icon.png`, bundled translations, defaults in `src/lib/branding-config.ts` | Git | Commit → `main` → CI → GHCR → pull `app` |
| `APP_TITLE`, `TEAM_TITLE`, `ORG_NAME`, `SUPPORT_EMAIL`, `PROGRAM_TERM_LABEL` | VPS `.env` (public runtime branding; blank uses defaults; legacy `NEXT_PUBLIC_*` names are ignored) | Recreate `app` (no rebuild) |
| `MESSAGES_OVERRIDE`, `AUTH_BOOTSTRAP_ADMIN_EMAILS` | VPS `.env` (empty default; `MESSAGES_OVERRIDE` is JSON read outside `src/env.js`) | Recreate `app` |
| `AUTH_SECRET`, `SMTP_PASSWORD`, `SMTP_SECURITY_PASSWORD`, `SMTP_PROGRAM_PASSWORD` | VPS `.env` (32+ char `AUTH_SECRET`, keep stable across instances/restarts) | Recreate `app` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_SECURITY_FROM`, `SMTP_SECURITY_USER`, `EMAIL_PROGRAM_FROM`, `SMTP_PROGRAM_USER` | VPS `.env` (`smtpdm.aliyun.com`, port `465`, login defaults to sender) | Recreate `app` |
| `ALIYUN_DM_ACCESS_KEY_ID`, `ALIYUN_DM_ACCESS_KEY_SECRET`, `ALIYUN_DM_QUOTA_RESET_TIME_UTC` | VPS `.env` (read directly from `process.env` outside `src/env.js`; optional dashboard quota card) | Recreate `app` |
| `SIGNUP_MAIL_*`, `SIGNUP_COMPLETE_*`, `SIGNUP_READ_*`, `SIGNUP_RESEND_SECONDS` | VPS `.env` (optional tuning; see [signup protection](../reference/signup-protection.md#defaults-and-tuning)) | Recreate `app` |
| `CAPTCHA_PROVIDER`, `ALIYUN_CAPTCHA_*`, `CAPTCHA_BUDGET_*`, `CAPTCHA_CONCURRENCY` | VPS `.env` (optional; see [CAPTCHA reference](../reference/captcha.md)) | Recreate `app` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | VPS `.env`, chosen once at empty-volume init | Keep fixed for existing `db-data` volume |
| `DATABASE_URL`, `AUTH_URL`, `AUTH_TRUST_HOST`, `SIGNUP_TRUST_PROXY`, `NODE_ENV` | Derived by `docker-compose.yml` (`https://${DOMAIN}`, `true`, `true`, `production`) | Do not override in `.env` (non-Compose defaults `SIGNUP_TRUST_PROXY=false`) |
| `DOMAIN` | VPS `.env` (real DNS hostname) | Update DNS; recreate `app` **and** `caddy` |
| `APP_IMAGE` | VPS `.env` (`ghcr.io/<owner>/shbs-peer-tutoring-website:latest`) | Pull and recreate `app` |
| `BACKUP_DIR`, `BACKUP_RCLONE_REMOTE`, `BACKUP_S3_URI`, `BACKUP_SCP_DEST` | Host `.env` (`BACKUP_DIR` defaults to `backups/`) | Next `backup.sh` run |

- Leave `SKIP_ENV_VALIDATION` unset in production (any non-empty string disables validation).
- Editing `POSTGRES_*` after volume initialization does **not** change Postgres credentials — it breaks app connections and backups.
- All app/Prisma/CLI connections enforce **UTC** sessions independently of the school program timezone or host OS timezone; use `SET TIME ZONE 'UTC'` for manual SQL.

## Email — Aliyun Direct Mail (邮件推送)

Transactional email uses Aliyun Direct Mail over pooled, TLS-enforced SMTP
(`src/server/email/sender.ts`). Every send declares a category (`SECURITY` or
`PROGRAM`), using its dedicated sender pair or falling back to legacy
`EMAIL_FROM` + `SMTP_PASSWORD`. SMTP is required in production for password
resets, registration/viewer verification, and emailed codes (`EMAIL_2FA` defaults
on and requires emailed codes for password changes even if sign-in 2FA is off).

**Console setup** (`https://dm.console.aliyun.com`):
1. Pick a region (Hangzhou → `smtpdm.aliyun.com`; Singapore → `smtpdm-ap-southeast-1.aliyuncs.com`).
2. Add and verify a sending subdomain (**Email Domains → New Domain**) with Aliyun's exact DNS records.
3. Create **Triggered/Transactional** sender addresses and generate a dedicated SMTP password for **each** address.

**Recommended separate senders in `.env`:**

| Category | Messages | Dedicated env vars |
| --- | --- | --- |
| `SECURITY` | Setup/reset links, 2FA/step-up codes, email binding, registration/Viewer/Crew mailbox codes, security alerts | `EMAIL_SECURITY_FROM`, `SMTP_SECURITY_PASSWORD` (optional `SMTP_SECURITY_USER`) |
| `PROGRAM` | Tutee signup confirmation, program/information/message notices, session notices, school reports | `EMAIL_PROGRAM_FROM`, `SMTP_PROGRAM_PASSWORD` (optional `SMTP_PROGRAM_USER`) |

Partial dedicated config falls back to the complete legacy pair; bad credentials
fail closed without switching identities. Recreate `app` after editing `.env`,
then run a real-inbox smoke test (Forgot password for `SECURITY`, test tutee
signup for `PROGRAM`) verifying `From` and SPF/DKIM/DMARC headers on controlled
test inboxes.

### Show the Direct Mail quota on the dashboard

The **Email Quota** card (visible to Admin/Head on `/admin` and **Administration
→ Program Settings → Deployment Configurations → Delivery settings**) queries
`DescAccountSummary` at `https://dm.aliyuncs.com/` (`cn-hangzhou`) for
`DailyRemainFreeQuota` (200/day free cap) and `RemainFreeQuota` (one-time free
balance), caching results for 60 s with a 2 s connect / 3 s read timeout and no
retries. Warnings appear at `<= 40` daily or `<= 200` balance remaining
([API docs](https://help.aliyun.com/en/direct-mail/api-dm-2015-11-23-descaccountsummary) ·
[limits](https://help.aliyun.com/en/direct-mail/product-overview/limits)).

Set `ALIYUN_DM_ACCESS_KEY_ID` and `ALIYUN_DM_ACCESS_KEY_SECRET` (dedicated RAM
user with `dm:DescAccountSummary` on `*`) and optional
`ALIYUN_DM_QUOTA_RESET_TIME_UTC` (`HH:mm` 24-hour UTC, displayed in
`Asia/Shanghai`; malformed values are treated as unconfigured). Recreate `app`
and compare against the Aliyun console. Clear both keys to hide the card. Lookup
failures never affect SMTP delivery.

## 4. Image build (CI → GHCR)

Pushing to `main` triggers [`.github/workflows/docker-build.yml`](../../.github/workflows/docker-build.yml),
which runs static checks + 3 parallel test shards, unpacks CI-baked Help
screenshots via `scripts/unpack-help-assets.mjs` from the rolling
`help-assets-latest` release (override via `HELP_ASSETS_RELEASE_TAG`; see
[Help CI baking](help/README.md#ci-baked-screenshots-clean-git-repository)),
builds and smoke-tests the production image, runs scoped `image-storage` checks,
and promotes the verified image artifact by exact ID to `:sha-<7-char>` and
`:latest` (rechecking `origin/main` before each push).

- CI imports build cache (`cache-from: type=gha`) with **no `cache-to` export**.
- Local/source Docker builds (`docker compose up --build`) fall back cleanly to
  text-only Help unless you first run `node scripts/unpack-help-assets.mjs` or
  `npm run help:capture`.
- For private GHCR packages, authenticate once on the VPS:
  `echo <GITHUB_PAT_with_read:packages> | docker login ghcr.io -u <github-user> --password-stdin`.

## 5. Deploy

Run [storage preflight](#storage-capacity-preflight) first, then:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f app
```

### Storage capacity preflight

Before every image pull or deployment, budget **additional peak allocation** per
distinct filesystem (downloads, unpacked layers, writable layers/logs, DB/WAL
growth, overlapping backups) and run the read-only helper (requires Bash + GNU
`df`/`timeout`/`head`; never touches Docker or `.env`; `PEAK_GIB` in `1..1048576`):

```bash
bash scripts/check-storage-capacity.sh /existing/directory/on/target/filesystem 8
```

Requires `additional peak + max(5 GiB, ceil(20% filesystem capacity))` available
bytes and nonzero free inodes. Exit `0` = `HEADROOM_OK`; `1` = insufficient;
`2` = unknown/error; `64` = bad usage. Stop on any nonzero exit.

### Create the first admin (first deploy)

> ⚠️ **Never run `prisma/seed.ts` in production.** It creates demo accounts with
> `Password123!`.

Run the packaged bootstrap CLI inside `app` (requires a **12–1,024** character
password validated before hashing or opening a database connection, preserving
exact leading/trailing spaces; optional `BOOTSTRAP_ADMIN_NAME` defaults to
`"Program Head"`; creates Head and initial active period when missing, or
promotes a second account to Admin / resets password on rerun;
`AUTH_BOOTSTRAP_ADMIN_EMAILS` only promotes existing accounts on sign-in):

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

Then sign in and configure Subjects & Levels, Time Slots, Rooms, recruitment,
policies and public content through the website.

## 6. Updates

### Application, UI and repository assets

Run [storage preflight](#storage-capacity-preflight) and record current/previous
image IDs first, then:

```bash
cd /opt/shbs
# Only if Compose/Caddy/scripts changed: git pull --ff-only
docker compose pull app
docker compose up -d app
```

`app` applies pending Prisma migrations automatically while preserving `db-data`,
`.env`, published policies/landing content and translations.

### Retain current and previous tested images

Keep both the current and previous verified images on disk (`docker inspect`
image ID + `RepoDigests`, not mutable `:latest`). Retaining an old image does not
make non-reversible migrations safe to downgrade — test rollback against a backup
or deploy a corrective release. When pruning approved unreferenced images, remove
exact full IDs with `docker image rm` (no `--force`, no broad prune).

### App runtime settings and branding

`docker compose restart` does **not** reload `.env`. Recreate `app` (and `caddy`
if `DOMAIN` changed):

```bash
cd /opt/shbs
nano .env
docker compose config --quiet
docker compose up -d --force-recreate app         # add `caddy` if DOMAIN changed
```

### Verify either update

```bash
docker compose ps
docker compose logs --since=10m --tail=100 app
curl --fail --show-error --silent https://tutoring.example.edu/signin -o /dev/null
curl --fail --show-error --silent https://tutoring.example.edu/api/trpc/health
curl --fail --show-error --silent https://tutoring.example.edu/icon.png -o /dev/null
```

Expect `result.data.json.ok: true`, clean migration status, expected titles/tab
icon (`TEST_BASE_URL=https://... node --test scripts/test-tab-icon.mjs`), and
verified email sender/subject after SMTP or branding edits.

### Browser response policy and rollout

[Caddyfile](../../Caddyfile) writes deferred headers (also on upstream errors)
and `next.config.js` disables `X-Powered-By`:

| Policy | Current behavior |
| --- | --- |
| HTTPS/HSTS | Auto HTTPS; `max-age=86400` on exact host (no `includeSubDomains`/`preload`) |
| Framing/context | Enforced `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` + `X-Frame-Options: DENY` |
| MIME/referrer | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Resource CSP | **Report-only** (no collector; lists first-party, Aliyun CAPTCHA script, `data:`/`blob:`, inline styles) — do not flip to enforced without per-request nonces |
| Proxy IP header | Overwrites `X-Signup-Client-IP {remote_host}` (never append) |

Validate and reload after editing `Caddyfile` (keep prior copy for rollback;
recreate only `caddy` if a replaced bind-mount inode is stale):

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# Optional external header probe:
TEST_BASE_URL=https://<host> node --test scripts/test-security-headers.mjs
```

## 7. Backups

```bash
./scripts/backup.sh            # validated private daily dump + configured offload + rotation
# Cron example (03:00 daily):
# 0 3 * * *  /opt/shbs/scripts/backup.sh >> /var/log/shbs-backup.log 2>&1
```

- **Atomic validation:** Holds `BACKUP_DIR/.backup.lock`, writes mode-600
  `pg_dump | gzip` inside the mode-700 lock dir, verifies `gzip -t` and plain SQL
  header/footer markers, and hard-links `<db>-daily-YYYYMMDD-HHMMSS-<10chars>.sql.gz`.
- **Off-host copy:** Optional `BACKUP_RCLONE_REMOTE`, `BACKUP_S3_URI`, or
  `BACKUP_SCP_DEST` in `.env` (host CLI required). All configured uploads must
  succeed before local rotation runs.
- **Retention & `.hold` markers:** Rotates only top-level daily files for the
  current DB older than `find -mtime +14` (15 completed 24-hour periods), always
  keeping the newest file. Any `<daily-filename>.hold` marker (including symlinks),
  legacy filenames, and subdirectories (`recovery-hold/`) are exempt from
  rotation. Pause cron before adding/removing holds.
- **Interrupted runs:** Handled signals clean up temp files and lock. After
  `SIGKILL`/power loss, `.backup.lock` deliberately blocks subsequent runs until
  an operator confirms no dump/upload child is running and moves the stale lock
  directory to quarantine.

**Rehearse restore into a new disposable database** (never overlay live DB):

```bash
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" shbs_restore_test'
gunzip -c backups/<file>.sql.gz | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" shbs_restore_test'
```

## Troubleshooting

- **Cert not issued:** Verify DNS A record and ports 80/443.
- **App restarting:** `docker compose logs app` (usually `.env` validation or DB connectivity).
- **Sessions drop across instances:** Confirm identical stable `AUTH_SECRET`, canonical `AUTH_URL` and HTTPS proxy settings.
- **DB healthcheck failing:** `docker compose logs db`; verify `POSTGRES_*` match volume init.

## Public QR domain and regeneration

**Administration → Program Settings → Recruitment and Refresh → Share Signup Links**
encodes `AUTH_URL` (`https://${DOMAIN}` in Compose; strict public HTTPS origin
required in production — never derived from request `Host`). Regenerate and
replace all four transparent PNGs (`/tutor`, `/tutee`, `/crew`, `/`) after any
domain change and verify each with a scanner over a plain light background.

## Optional notification delivery

All emailed links require canonical HTTPS `AUTH_URL` in production. Outgoing
mail uses the shared Graphite dark renderer with plain-text alternatives, selects
maintained English or Chinese copy from the recipient's saved **Email language**
preference (default English; public signups use selected page language until an
account preference exists), and formats timestamps in the program timezone.
School notifications also use the shared Graphite renderer with **View Month
Report** and omit individual hour rows. See
[notification events](../reference/notification-events.md) and
[program configuration](program-configuration.md#optional-email-notifications).

The `notification-delivery` worker polls every 30 s, runs calendar and event
reminder sweeps in isolated `try/catch` blocks, and drains serial batches of 10
up to a **20-second budget or 100 batches (1,000 rows)** (5-minute row lease):

| Delivery class | Retries & recovery |
| --- | --- |
| Optional account, message, reviewer & reminder mail | 1 admitted SMTP attempt (failed/abandoned admitted attempt becomes `UNCERTAIN`, never auto-replayed); up to 5 pre-admission retries |
| Essential account security (`security`) | Up to 5 attempts with exponential backoff; independent of `emailNotificationsEnabled` |
| Essential request-service (`request_service`) & school reports | Up to 5 attempts under source/version fences; `request_service` stays independent of `emailNotificationsEnabled` |
| Essential `SessionNotice` | Separate worker (30 s poll, batch of 10, 5 attempts, requires `PROGRAM` SMTP); outside general outbox counts |
| Direct auth/setup/signup mail | Caller owns immediate send/resend |

**Email delivery status** (in Delivery settings) tests `SECURITY` and `PROGRAM`
SMTP independently (15 s timeout, 60 s cache) and separates retrying, exhausted
and uncertain outcomes. After restoring SMTP, Admin/Head can click **Resend stuck
emails** (queues up to 100 eligible failed/retrying rows; excludes uncertain,
active leases, untouched pending, unconfigured categories, and disabled optional
mail while keeping `security` and `request_service` eligible). Keep `/unsubscribe`
and `/request-appeal` capability URLs out of logs and analytics.

## Monthly service-hours delivery

Active school service-hours reporting runs via the persistent `school-hours-worker`
(boot + every 60 s; see [school-hours reference](../reference/school-hours.md)).
Legacy monthly overviews are retired.

- Automation starts disabled: review opening balances and configure school
  recipients under **Tutors → Service Hours → School reports** before enabling
  (requires Service Hours module, global program mail, and `PROGRAM` SMTP).
- **Log redaction:** Configure reverse-proxy access logs to redact
  `/reports/service-hours/*` paths (they carry the report capability token) and
  protect `AUTH_SECRET`.
- **No pre-carry downgrade:** Once a `TENTH_HOUR_CARRY_NONNEGATIVE` edition is
  generated, upgrade all instances together and never roll back to a pre-carry
  binary.

## Verify before opening intake

1. Confirm canonical HTTPS, `/api/trpc/health`, migrations, and DB/image persistence across container recreate.
2. Deliver test signup, password-reset and email-change messages to controlled inboxes (check sender & headers).
3. Publish [reviewed policies](policies/README.md#publish-a-revision) and public content; configure period, subjects, slots, rooms, qualifications, openings and school calendar per [program configuration](program-configuration.md).
4. Rehearse a backup restore into a disposable database and confirm off-host copies.

### Unified person identity migration

The production image ships the read-only identity reconciliation CLI (`REPEATABLE
READ`, `READ ONLY`, exit `0` clean / `2` findings, no mutations):

```bash
docker compose exec -T app npm run --silent identity:reconcile > identity-reconciliation.json
```

See [identity lifecycle](../reference/identity-lifecycle.md#cutover-comparison-and-rollback-limits)
for cutover comparison and rollback limits. Keep private output secure and roll
back only via compatible corrective releases (never delete `Person` metadata,
retirement guards, or audit receipts).

**Upgrade & rollback constraints:**
- Only `scripts/create-admin.ts`, `scripts/reconcile-person-sources.ts`, and
  `scripts/recovery.ts` are packaged in the Docker image. Checkout-only scripts
  such as `scripts/backfill-school-departures.ts` (dry run by default; `--apply`
  to commit) must be run from a trusted source checkout with `DATABASE_URL`:
  ```bash
  npx tsx scripts/backfill-school-departures.ts
  ```
- Do not downgrade application binaries across additive schema/enum contracts
  (`TRANSFERRED` tutor status, `User.mergedIntoId` guards, `Person` grouping,
  patrol interval reservations, or `TENTH_HOUR_CARRY_NONNEGATIVE` reports) —
  always use a compatible corrective release.
