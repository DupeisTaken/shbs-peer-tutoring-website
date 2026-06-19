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
no self-service sign-up for *staff/tutor logins*: the first admin account is created by the
seed or directly, and admins create further accounts. (Students do have a public, no-login
tutee signup form at `/signup`, which only creates `PENDING` tutee records for admin review —
not login accounts.) Email-based 2FA is scaffolded but not yet implemented.

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
```

`DATABASE_URL`, `AUTH_URL`, and `AUTH_TRUST_HOST` are set automatically in `docker-compose.yml`.

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

> A proper admin "create user / set password" flow (and password reset) is future work —
> see the email-2FA scaffolding referenced in [README.md](./README.md).

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
