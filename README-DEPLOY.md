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
2. A domain, with an **A record pointing at the VPS IP** — set this *before* first start so
   Caddy's Let's Encrypt challenge succeeds.

Sign-in is email + password (no external identity provider to register). Note that there is
no self-service sign-up for *logins*: the first admin account is created by the seed or
directly, and admins create further accounts. The two public forms — tutee signup (`/signup`)
and the tutor application (`/tutor-signup`) — only create `PENDING` `Tutee` / `TutorApplication`
records for admin review; **neither creates a login account**. (Consider adding rate-limiting
or a CAPTCHA in front of these public endpoints before launch.) Transactional email (password
resets) goes through Aliyun Direct Mail — see "Email" below. Email-based 2FA is scaffolded but
not yet implemented.

## 2. Host setup (once)

```bash
sudo ./scripts/setup.sh          # installs Docker + Compose, ufw allows only 22/80/443
```

## 3. Configure secrets

```bash
cp .env.example .env
# Edit .env and set:
#   DOMAIN, APP_IMAGE (ghcr.io/<owner>/shbs-peer-tutoring-website:latest)
#   AUTH_SECRET           (generate: openssl rand -base64 32)
#   POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
#   AUTH_BOOTSTRAP_ADMIN_EMAILS=you@school.edu   (gives you ADMIN on first sign-in)
#   TUTOR_DEFAULT_PASSWORD  (shared temp password for auto-created tutor logins; change
#                            it from the default — tutors are forced to reset it on first login)
#   EMAIL_FROM / SMTP_PASSWORD / SMTP_HOST / SMTP_PORT   (Aliyun Direct Mail — see below)
```

> **Auto-provisioned tutor logins:** accepting a tutor application creates that tutor's `User`
> account with `TUTOR_DEFAULT_PASSWORD` and a forced password change on first sign-in. Set a
> non-default value before going live.

`DATABASE_URL`, `AUTH_URL`, and `AUTH_TRUST_HOST` are set automatically in `docker-compose.yml`.

## Email — Aliyun Direct Mail (邮件推送)

Transactional email (the password-reset link; later, 2FA codes) is sent through **Aliyun Direct
Mail** over SMTP. Until `EMAIL_FROM` + `SMTP_PASSWORD` are set the app logs mail in dev and warns
in production, so this is optional for a first boot but required for real password resets.

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

You need at least one `User` with a password before anyone can sign in (there is no
self-service sign-up). Bootstrapping to `ADMIN` happens for any account whose email is in
`AUTH_BOOTSTRAP_ADMIN_EMAILS`.

> ⚠️ **Do not run the bundled `prisma/seed.ts` as-is in production.** It creates sample
> people *and* demo login accounts (`admin@example.edu`, `alice@example.edu`) with the
> well-known dev password `Password123!`. That's strictly for local development.

For production, create your admin with a real email and a strong password. Edit
`prisma/seed.ts` (set `DEV_PASSWORD` to a strong secret and the admin `email` to one listed
in `AUTH_BOOTSTRAP_ADMIN_EMAILS`) and run the seed, or insert the user directly with a
scrypt hash from `src/server/auth/password.ts`:

```bash
docker compose exec app node node_modules/prisma/build/index.js db seed   # if a seed image is present
# or manage tutors/tutees/rooms/pairings from the /admin UI once you are ADMIN.
```

> Password reset works once Aliyun Direct Mail is configured (see "Email" above). A proper
> admin "create user / set password" UI is still future work.

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
> The script has a TODO to copy backups **off-box** (rclone/S3/scp) — wire that up for real DR.

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
