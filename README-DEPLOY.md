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

## Division of labor

**You (operator):** provision the VPS, point DNS, supply real secrets in `.env`, run the deploy.
**Code/config:** everything in this repo (already written).

---

## 1. Prerequisites

1. A VPS running Ubuntu (22.04/24.04), with a public IP.
2. A domain, with an **A record pointing at the VPS IP** — set this _before_ first start so
   Caddy's Let's Encrypt challenge succeeds.

Sign-in is username or email + password (no external identity provider to register). Logins are created only
through gated paths: the first admin comes from the seed (or `AUTH_BOOTSTRAP_ADMIN_EMAILS`);
recruits self-register at **`/register`** with an admin-issued single-use code plus an emailed
verification code; and outsiders can self-register a **read-only viewer (VIEWER)** account at
**`/viewer-signup`** (email-validated, behind the `VIEWER_SIGNUP` feature flag). The public tutee
signup (`/signup`), tutor application (`/tutor-signup`), and crew application (`/crew-signup`) only
create `PENDING` records for admin review — **none creates a login**. Credential sign-in, the
registration steps, and viewer signup are all **rate-limited in-app** (per IP + per code / email /
identifier; `src/server/rate-limit.ts`); a CAPTCHA in front is still worth considering at scale.
Transactional email (reset links plus sign-in and password-change 2FA codes) goes through Aliyun
Direct Mail — see "Email" below. Sign-in 2FA is enforced when the `EMAIL_2FA` program feature and
the user's 2FA preference are both enabled.

## 2. Host setup (once)

```bash
sudo ./scripts/setup.sh          # installs Docker + Compose, ufw allows only 22/80/443
```

## 3. Configure secrets

```bash
cp .env.example .env
# Edit .env and set:
#   DOMAIN, APP_IMAGE (ghcr.io/<owner>/shbs-peer-tutoring-website:latest)
#   AUTH_SECRET           (required in prod, ≥32 chars — generate: openssl rand -base64 32)
#   POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
#   AUTH_BOOTSTRAP_ADMIN_EMAILS=you@school.edu   (first entry becomes HEAD when no HEAD exists)
#   EMAIL_FROM / SMTP_PASSWORD / SMTP_HOST / SMTP_PORT   (Aliyun Direct Mail — see below)
```

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
   decides your SMTP host: mainland China → `smtpdm.aliyun.com`; Singapore → `smtpdm-ap-southeast-1.aliyun.com`.
2. **Email Domains → New Domain** (发信域名): add a subdomain you control, e.g. `mail.your-school.edu`.
   Aliyun shows DNS records to add at your DNS provider — typically a **TXT (SPF)**, a **TXT (DKIM)**,
   an **MX**, and a CNAME/`_dmarc` record. Add them, then click **Verify** until all are green.
3. **Sender Addresses → New Sender Address** (发信地址): create e.g. `noreply@mail.your-school.edu`,
   type **Triggered/Transactional** (触发).
4. On that sender address, **set an SMTP password** (设置 SMTP 密码). This is a dedicated password,
   **not** your Aliyun account password — copy it once.
5. (Recommended) Raise the address's daily quota / verify a **reply-to** if you want replies.

**Then fill `.env`:**

```bash
SMTP_HOST="smtpdm.aliyun.com"            # or your region's host
SMTP_PORT="465"                          # 465 = SSL (recommended); 587 = STARTTLS
EMAIL_FROM="noreply@mail.your-school.edu" # the verified sender address
EMAIL_FROM_NAME="SHBS Peer Tutoring"     # optional From display name
SMTP_PASSWORD="<the SMTP password from step 4>"
# SMTP_USER is optional — it defaults to EMAIL_FROM (Aliyun logs in as the sender address).
```

Recreate the app container (`docker compose up -d app`) and test via **Forgot password** at `/signin`.
If mail doesn't arrive: confirm the domain shows verified, the `From` exactly equals the sender
address, outbound port 465 is open from the host, and check `docker compose logs app` for SMTP errors.

## 4. Image build (CI → GHCR)

Pushing to `main` triggers `.github/workflows/docker-build.yml`, which builds and pushes
`ghcr.io/<owner>/shbs-peer-tutoring-website:latest`.

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
email + password at `/signin`. (Bootstrap your first admin by setting
`AUTH_BOOTSTRAP_ADMIN_EMAILS` and creating that user with a password — see the seed.)

### Create the first admin (first deploy)

You need at least one `User` with a password before anyone can sign in. The first address in
`AUTH_BOOTSTRAP_ADMIN_EMAILS` is promoted to the singleton `HEAD` when no HEAD exists; later
addresses are promoted to `ADMIN`. This promotion applies when an existing account signs in—it
does not create the account.

> ⚠️ **Do not run the bundled `prisma/seed.ts` as-is in production.** It creates sample
> people _and_ demo login accounts (`admin@example.edu`, `alice@example.edu`) with the
> well-known dev password `Password123!`. That's strictly for local development.

From a trusted checkout that can reach the production database (an SSH tunnel is recommended),
create the first account without loading any demo data:

```bash
export DATABASE_URL='postgresql://...'
export BOOTSTRAP_ADMIN_EMAIL='you@school.edu'
read -s -p 'Initial admin password: ' BOOTSTRAP_ADMIN_PASSWORD && export BOOTSTRAP_ADMIN_PASSWORD
npm ci
npm run admin:create
```

The command requires at least 12 password characters, creates a HEAD when none exists (otherwise
an ADMIN), and can be rerun deliberately to recover that account. Do not run `npm run db:seed` in
production; it contains well-known development users and sample program data.

> Password reset works once Aliyun Direct Mail is configured (see "Email" above). After the first
> HEAD exists, tutor accounts and setup links can be managed from the admin UI.

## 6. Updates

```bash
docker compose pull app && docker compose up -d app   # pull new image, recreate; migrations re-run
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
gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## 8. Build on the VPS instead of CI (fallback)

If you can't use GHCR, build on the box (needs RAM — add swap on a 4 GB host):

```bash
docker compose build && docker compose up -d
```

## Troubleshooting

- **Cert not issued:** confirm DNS A record resolves to the VPS and ports 80/443 are open.
- **App restarting:** `docker compose logs app` — usually a bad `.env` value or DB not reachable.
- **DB healthcheck failing:** `docker compose logs db`; ensure `POSTGRES_*` match across `.env`.
