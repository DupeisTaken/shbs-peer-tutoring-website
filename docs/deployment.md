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
signup (`/signup`) first saves the full application and policy agreement; mailbox code or legacy
email-link confirmation opens an invitation popup before shared account/access review. Displaying
an invitation alone creates no credentials or participation. Tutor application (`/tutor-signup`)
creates pending records for review. Crew application (`/crew-signup`) first verifies
the mailbox before creating a pending record; staff approval and fresh mailbox proof
then permit shared invitation retrieval. Credential sign-in, the
registration steps, and viewer signup are all **rate-limited in-app** (per IP + per code / email /
identifier; `src/server/rate-limit.ts`). Public tutee/viewer signup and Crew verification/status
mail also use [durable signup quotas](signup-protection.md) and support
[optional Aliyun CAPTCHA](captcha.md), disabled by default.
Transactional email (reset links plus sign-in and password-change 2FA codes) goes through Aliyun
Direct Mail — see "Email" below. Sign-in 2FA is enforced when the `EMAIL_2FA` program feature and
the user's 2FA preference are both enabled.

New invitation and staff registration codes use the five-character uppercase Steam-style
format, containing both letters and digits, including canonical `0` and `I`. Input accepts
`O`/`o` as `0` and, in five-character codes, `1` as `I`. Existing receipt hashes select
the original derivation, preserving older invitations without a new migration.
Mailbox verification remains separate and retains its existing formats. The additive
short-code migration preserves older receipt lookup while recording new code retry nonces.

Public tutor and crew intake share database-backed limits: five distinct accepted submissions per normalized email in 24 hours, and 500 per network address in one hour. Pending retries return the same confirmation without another record, counter increment or notification; tutor applications awaiting an interview also count as pending. Decided applications may be submitted again within these limits. Counters, application writes and in-app notifications commit together, and counters survive server restarts and multiple instances. New distinct submissions prune hashed counter keys that expired more than seven days ago, in bounded batches; an idle deployment retains those expired keys until intake resumes.

Tutor intake and credential sign-in use the proxy-supplied `X-Forwarded-For`/`X-Real-IP`; configure the proxy to replace visitor-supplied values and keep the application port private. Tutee/viewer signup and Crew verification/status use the dedicated `X-Signup-Client-IP` boundary and `SIGNUP_TRUST_PROXY=true`, already configured in the supplied Caddy/Compose stack; see [proxy trust and network buckets](signup-protection.md#trusted-network-boundary). Network addresses are abuse signals, not identity. Tutor applications do not verify email ownership; Crew applications do so before entering review.

## 2. Host setup (once)

```bash
sudo ./scripts/setup.sh          # installs Docker + Compose and configures UFW host rules
```

The setup script allows SSH from any source and does not configure SSH authentication.
Its UFW INPUT policy is not proof of container isolation: Docker manages forwarding
rules separately. Complete the [effective network review](#effective-network-and-ssh-review)
before treating a host as verified.

### Effective network and SSH review

Use an existing authorized operator session; these are read-only checks, not a
firewall/SSH change procedure. Record the date, host identity, vantage point and
deployed image/source identity. Keep raw output private: mappings, addresses and
operator identities may be sensitive. Do not paste full `.env`, `docker inspect`,
`docker compose config` or authenticated response headers into public issues.

For the current [issue #242 review](continuation/issue-242.md), preserve and report
the existing operational policy, including root password login under the current
maintenance constraints. This review does not impose key-only authentication,
disable root/password login or require a new source allowlist/VPN. Have the
operator confirm the intended current policy separately from observed settings:
an observed setting alone is not approval, and a missing policy remains unknown.
Compare evidence with that confirmed policy, without changing access rules.

| Boundary | Required evidence and expected result |
| --- | --- |
| Host listeners | `sudo ss -lntup` for IPv4 **and** IPv6, including listening address/process; explain every listener. Public HTTP/HTTPS are intended. App 3000, PostgreSQL 5432, Caddy admin 2019, Prisma Studio 5555 and alternate web 8080 must not have unintended Internet paths. |
| Effective containers | `docker compose ps --all` plus `docker ps --format 'table {{.Names}}\t{{.Ports}}'` for other stacks. Inspect actual container mappings, network mode and network options as below; source Compose alone does not cover overrides, stale containers or direct routing. |
| Cloud perimeter | Review the instance's attached security groups, ingress rules, IPv4/IPv6 ranges, load balancers/NAT and any alternate public addresses in the cloud console. Record approved sources per administrative port; retain a sanitized rule inventory. |
| Host firewall | `sudo ufw status verbose`, `sudo nft list ruleset`, and/or `sudo iptables-save` / `sudo ip6tables-save`, as applicable to the active backend. Inspect Docker forwarding/NAT and direct-routing rules, not only INPUT. Do not disable Docker's firewall management as a shortcut. |
| SSH | `sudo sshd -T` and `sudo sshd -T -C user=<operator>,addr=<client-ip>,host=<client-hostname>,laddr=<server-ip>,lport=<ssh-port>` for each relevant `Match` context. Review `listenaddress`, `port`, `permitrootlogin`, `pubkeyauthentication`, `passwordauthentication`, `kbdinteractiveauthentication`, `authenticationmethods`, `allowusers`/`allowgroups` and any deny rules. Record effective authentication, root-login and source-access behavior against the operator-confirmed current policy, including password login or unrestricted sources where intended. |
| Independent external vantage | Verify DNS A/AAAA against the cloud IPs and use a network outside the server and local proxy/TUN. Check protocol responses as well as host/cloud rules. A TCP handshake alone may come from an interception proxy; timeout/no protocol reply is **inconclusive**, not proof a port is closed. |

#### Collect a private host inventory

First agree with the operator on the canonical hostname, public IPv4/IPv6 addresses,
HTTP/HTTPS behavior, SSH port, current source-access policy (including any trusted
ranges/VPN or unrestricted sources) and password/key/MFA/root-login policy.
Identify who can review the cloud rules and an independent external network.
If these details or authorized host access are unavailable, record them as missing;
do not guess credentials, scan addresses or change access rules.

On the actual Linux VPS, from an existing authorized session, use the optional
[collector](../scripts/collect-network-evidence.sh). It needs Bash, GNU coreutils,
`ss`/`ip` (iproute2) and the existing Docker CLI; it installs nothing and never invokes `sudo`.
Run as an operator already permitted to inspect the daemon. Without sufficient
privileges, `ss` may omit process identities even when it exits successfully;
have the operator complete that gap separately.

```bash
cd /opt/shbs  # existing deployment checkout; do not update or deploy for this check
(umask 077; mkdir -p local-operations)
bash scripts/collect-network-evidence.sh local-operations
```

Review/copy the script to the operator host through the approved channel if it is
not yet in that checkout. Each run creates a new mode-700 directory and mode-600
`evidence.txt`. Keep it private: selected fields exclude container environment,
logs, arbitrary labels and arbitrary network driver options, but IPs, mounts and
image names still reveal infrastructure. Listener, interface-address and IPv4/IPv6
route snapshots stay in that file. Failed-command stdout/stderr are omitted.
The script never reads `.env`, interpolates Compose, connects to a registry, probes
public ports, starts/stops containers or changes volumes/firewall/SSH. Ambient
Docker remote contexts and TLS options are ignored: every Docker call targets
`unix:///var/run/docker.sock`. Rootless/other daemons, Swarm services and other
container engines need a separate explicit inventory; an empty rootful daemon is
not proof that the deployed services are absent.

Collection is serial: at most 12 containers, 8 networks, 64 KiB per command,
8 seconds per command and a 120-second command budget (plus bounded termination
overhead). Exit **2** or `UNAVAILABLE` means collection gaps, including truncation,
missing commands, denied access or a timeout. Exit **0** only means those commands
completed; all outputs retain **OPERATOR VERIFICATION PENDING**. No automatic
port-policy verdict is made. A report without `finished_utc` was interrupted and
must be treated as incomplete. A snapshot can race a deployment: collect during a
quiet interval and resolve inconsistent image/container identities before review.

`app`/`db` should have no host publication; Caddy should publish only 80/443.
Caddy's admin endpoint should remain container-local. `ss` alone can miss
NAT-published listeners. [Docker's firewall guide](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
explains why published containers can bypass UFW rules; apply the guidance for the
host's actual iptables/nftables backend before planning changes. Public SSH by
itself is not a vulnerability: document the effective source/authentication policy.
Any hardening change requires a separate maintenance plan with tested recovery
console access and a second verified operator session to avoid lockout.

#### Complete the effective-policy worksheet

Keep one private worksheet next to the inventory. Record observation time in UTC,
host alias, operator reviewer, approved policy, evidence file/command or console
reference, observed result and disposition (**verified**, **mismatch**, **unknown**)
for every row. A screenshot of a cloud rule is useful only when its attachment to
this host/interface and its IPv4/IPv6 scope are established. Use sanitized aliases
in shared summaries and retain exact addresses/account names privately.

| Review row | Completion evidence |
| --- | --- |
| Scope and intended access | Canonical domain, all public IPs/A/AAAA records, approved TCP 80/443 behavior, administrative ports and current source policy (restricted ranges/VPN or unrestricted), operator authentication and root-login requirements. Explicitly account for absent IPv6 and for any intended UDP 443/QUIC; the supplied Compose only publishes TCP. |
| Listener and container paths | Explain every IPv4/IPv6 TCP/UDP listener and match the expected `app`, `db`, `caddy` services to their actual Compose project labels. Review other stacks, host/macvlan/ipvlan networking, direct routing, IPv6 and alternate ports. Empty port mappings alone are insufficient. |
| Caddy administration | Review the running proxy's startup options, mounted configuration and any API-loaded configuration privately. Establish the admin listener's actual namespace/interface and absence of external routing. A repository Caddyfile or mount path alone cannot establish the runtime setting. Do not export the full admin API/configuration publicly. |
| Cloud ingress and host forwarding | Review every attached security group/ACL, load balancer/NAT/public address and the active host INPUT, forwarding and NAT policy for both families. Account for Docker's active firewall backend and daemon direct-routing settings. Record effective administrative source rules, including unrestricted access if present, not just a UFW summary. |
| Effective SSH policy | Inspect the actual service/socket unit, startup flags and configuration path privately, then run bounded `sshd -T` checks with the same `-f`/`-o` overrides and each relevant user/source/local-address/local-port `Match` context. Include approved operator, root, another/disallowed user, and trusted/untrusted source cases; explain `Include`, PAM/MFA, allow/deny and key-command behavior. Do not copy keys, authorized-key contents or helper credentials into evidence. |
| Data and operator access preserved | Record the existing Compose project and actual database mount type/name/source/destination, plus Caddy certificate volumes. This collection makes no changes; verify the authorized operator session and intended web access still work. Use existing backup/record evidence privately; do not restart, reset, reseed or test restoration on production just to collect evidence. |
| Image/source identity | App and Caddy container image IDs and RepoDigests, app OCI revision/source, reviewed mounted files/overrides and matching successful CI publish run. Record missing/mismatched identity as unknown. |
| Independent external check | Complete the bounded matrix below from approved trusted and untrusted sources, for every public address/family and any relevant direct-routing address. Correlate outcomes with host/cloud rules. |

For host policy commands in the table above, use
`sudo -n timeout --kill-after=1s 8s ...` where authorized; permission failures remain **unknown**, not a reason to
change privileges. Review raw firewall and service output locally, since comments,
paths and command arguments may be private. [OpenSSH's test mode](https://man.openbsd.org/sshd)
applies `Match` contexts; its result must correspond to the daemon's actual startup
options. Do not send a signal, reload SSH, enable a firewall or rerun host setup.

#### Independent external verification

Have the operator approve a finite address/port/protocol matrix first. Use an
independent network outside the VPS, its LAN and local proxy/TUN, and identify its
source address privately. Check one endpoint at a time, one attempt per approved
cell, with a 3-second connect timeout and 8-second total limit. Stop on an
unexpected service response and review its path before testing further; do not
expand into a port sweep, credential attempt or vulnerability scan.

| Approved target | Expected observation and interpretation |
| --- | --- |
| Canonical HTTP/HTTPS, each public A/AAAA address | HTTP redirects to the intended HTTPS host; HTTPS validates its certificate and serves sign-in/health. Resolve each approved address explicitly when several exist, preserving hostname/SNI. Verify intended web access from both trusted and ordinary external clients. |
| Approved SSH port | Operator confirms normal access using their existing approved method. From an independent external source, compare reachability with the confirmed current source policy: intended source restrictions should prevent the SSH protocol from being reached by excluded clients; intended unrestricted access may expose the SSH protocol. A public banner alone does not establish authentication policy or compromise. Unknown policy remains unknown; do not treat root password login or unrestricted SSH as a mismatch against an invented stricter policy. Do not attempt passwords, keys or root logins to test denial. |
| App 3000, DB 5432, Caddy admin 2019, Studio 5555, alternate web 8080, plus reviewed override ports | No unintended external service path. A protocol response is a mismatch requiring investigation. TCP success alone, a timeout or lack of a protocol reply is **inconclusive**; corroborate negative results with effective routing/firewall policy and an independently controlled vantage. |

For an approved public-web cell, a bounded unauthenticated request can be recorded
without cookies, headers or body. Substitute the approved hostname; `--disable`
ignores local curl configuration and `--noproxy` avoids an explicit HTTP proxy.
Neither option proves absence of transparent interception or VPN routing.

```bash
curl --disable --noproxy '*' --connect-timeout 3 --max-time 8 \
  --silent --show-error --output /dev/null \
  --write-out 'remote=%{remote_ip} code=%{http_code} tls=%{ssl_verify_result}\n' \
  https://tutoring.example.edu/signin
```

Do not use `--insecure`. Record the selected address/family, vantage, UTC time,
command exit and protocol outcome; review redirects and health privately using
the [update checks](#verify-either-update). For private/admin service cells, agree
the minimal protocol observation with the operator in advance; the collector does
not issue those probes. A client-side timeout by itself cannot close the issue.

#### Correlate the release and decide completion

Record what is actually running, separately from the checkout or mutable tag:

```bash
git rev-parse HEAD
git status --short
sha256sum Caddyfile docker-compose.yml
app_container=$(docker compose ps -q app)
app_image_id=$(docker inspect --format '{{.Image}}' "$app_container")
docker inspect --format 'requested={{.Config.Image}} image_id={{.Image}}' "$app_container"
docker image inspect --format 'digests={{json .RepoDigests}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} source={{index .Config.Labels "org.opencontainers.image.source"}}' "$app_image_id"
```

Match the digest/revision to the exact successful CI publish run. A local build may
lack a registry digest or revision label; record that gap instead of assuming the
checkout is deployed. The local image ID is not the registry manifest digest;
record both, and do not use a mutable `latest` tag as release proof. Record the
Caddy image ID/digest and mounted configuration
too, including any Compose overrides. The effective network/SSH review remains
**operator verification pending** until host, cloud and independent external
evidence agree. Missing host access does not resolve issue #242; keep it open.
Publish only a sanitized acceptance summary: approved public services, whether each
administrative/private boundary met its policy, verified image revision/digest,
evidence timestamps/references and unresolved rows. **Unknown or mismatched rows
keep issue #242 open.** Source defaults and successful collector tests do not meet
its production acceptance criteria. If changes are needed, prepare a separate
reviewed maintenance plan with recovery console, backup/volume preservation,
second-session access, rollback and explicit production authorization; this
read-only procedure authorizes none of those changes.

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
| `AUTH_SECRET`, `SMTP_PASSWORD`, `SMTP_SECURITY_PASSWORD`, `SMTP_PROGRAM_PASSWORD` | VPS `.env`; no production secret defaults | Recreate app; keep the auth secret stable across restarts/instances |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_SECURITY_FROM`, `SMTP_SECURITY_USER`, `EMAIL_PROGRAM_FROM`, `SMTP_PROGRAM_USER` | Server-only VPS `.env`; host `smtpdm.aliyun.com`, port `465`, login falls back to sender address, display name to `APP_TITLE`; sender/password unset | Recreate app; verify real delivery |
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

The application, Prisma migration CLI, seed/demo utilities and administrator bootstrap enforce UTC on every database connection through a shared URL policy. This is independent of the school's program timezone and the host operating-system timezone. Deploying this policy requires restarting the application so its pool uses new connections; it does not require a schema migration or timestamp rewrite. For manual SQL or external import tools, explicitly use a UTC session (`SET TIME ZONE 'UTC'`) because existing `TIMESTAMP(3)` instant fields follow the UTC convention. Previously written data is not repaired automatically; audit any suspected historical offset before correcting it.

> **Accepted applicants self-register:** accepting a tutor application issues a single-use
> registration code (bound to their email, re-viewable on `/admin/registration-codes`); the recruit
> redeems it at `/register` to verify their email and set their own password. No shared default
> password is involved.

`DATABASE_URL`, `AUTH_URL`, and `AUTH_TRUST_HOST` are set automatically in `docker-compose.yml`.

## Email — Aliyun Direct Mail (邮件推送)

Transactional email — password-reset and tutor-setup links, emailed sign-in and password-change
2FA codes, and registration / viewer one-time codes — is sent through **Aliyun Direct Mail** over SMTP
(`src/server/email/sender.ts`: a pooled, TLS-enforced, timeout-bounded transporter that logs each
send and failure). Every call declares its category; sender choice is centralized and never inferred
from the subject. Each category uses its own complete sender account, falling back to the legacy
`EMAIL_FROM` + `SMTP_PASSWORD` pair. Without either, the app logs that category
in development and rejects production flows that require it. SMTP is optional for a first boot only if those
flows remain unused; it is **required** for password resets, registration/viewer verification, and
any emailed code. The `EMAIL_2FA` feature defaults on; users opt into sign-in 2FA in Settings.
The same program feature requires an emailed verification code for password changes, regardless
of personal sign-in 2FA enrollment. Enrollment and emailed-code flows require configured delivery
in production. Explicitly saved program feature settings are preserved when upgrading.

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

**Separate sender identities (recommended):**

| Category | Messages | Dedicated account |
| --- | --- | --- |
| `SECURITY` | Account/tutor setup and reset links; sign-in and step-up codes; email changes and binding; registration and viewer verification; account security notices | `EMAIL_SECURITY_FROM`, `SMTP_SECURITY_PASSWORD`, optional `SMTP_SECURITY_USER` |
| `PROGRAM` | Student signup confirmation links and already-confirmed reminders; program, information, and private-message notification emails | `EMAIL_PROGRAM_FROM`, `SMTP_PROGRAM_PASSWORD`, optional `SMTP_PROGRAM_USER` |

Viewer registration proves account ownership, so it is security mail. Student signup confirmation
belongs to program intake and remains program mail, including the link into student account creation.
The signup transport deadline is independent of sender purpose: viewer mail still uses the security
identity even though it runs on a bounded signup connection.

Repeat sender creation, verification and SMTP-password setup for **each** address. Aliyun passwords
belong to individual sender addresses; never assume they can be shared. Add these server-only
settings to the VPS `.env` (the existing `env_file` passes them to the app):

```bash
EMAIL_SECURITY_FROM="credentials@mail.your-school.edu"
SMTP_SECURITY_PASSWORD="<that sender's SMTP password>"
# SMTP_SECURITY_USER defaults to EMAIL_SECURITY_FROM.
EMAIL_PROGRAM_FROM="noreply@mail.your-school.edu"
SMTP_PROGRAM_PASSWORD="<that sender's own SMTP password>"
# SMTP_PROGRAM_USER defaults to EMAIL_PROGRAM_FROM.
```

Both use `SMTP_HOST`, `SMTP_PORT`, and the optional `EMAIL_FROM_NAME` display name. Dedicated
passwords and usernames are never inherited from the legacy account. Each category switches as
soon as its own address **and** password are present; the other category can keep using the legacy
account during rollout. A partial dedicated configuration falls back to the **entire** legacy
account, including its From address. If neither complete account exists, only that category is
unavailable in production. Keep the legacy pair until both dedicated senders pass their inbox tests;
afterward it may be removed. Changing `.env` requires recreating the app container. A configured
account with a bad password fails delivery; the application does **not** silently retry through a
different identity. Failed essential/security sends never report successful delivery. Deferred
notification jobs retain their existing bounded retry policy; an unconfigured category stays pending.

**Real-inbox smoke test (operator action, after configuring real sender secrets):**

1. Recreate the app with `docker compose up -d --force-recreate app`.
2. **Security:** use Forgot password for a known test account with an inbox you control. Check inbox
   and spam, open the received message, confirm From is `credentials@...`, and follow the reset link
   to verify that it is accepted. Exercise viewer registration with another controlled address and
   verify its code comes from the same security sender. Do not use participant accounts for testing.
3. **Program:** during an open intake window, submit a test student signup using a controlled inbox.
   Confirm From is `noreply@...`, follow the confirmation link, and confirm the request successfully.
   Clean up the test request through the management interface afterward.
4. Check each message's raw headers for the expected sender and provider authentication results
   (SPF/DKIM/DMARC); record only sender identity, timestamp, and success in the release evidence.
   Never copy OTPs, reset links, participant addresses, or credentials into reports or logs.
5. In staging, temporarily give only the security sender an invalid SMTP password and repeat its
   test: the flow must fail without exposing credentials, while a program signup still sends.
   Restore the correct secret and recreate the app. Test legacy fallback in staging by removing a
   dedicated pair while keeping a valid legacy pair; From should become the legacy address.

These inbox checks are separate from mocked automated tests and must be completed by the deployment
operator; automated tests do not establish real Aliyun delivery. If mail does not arrive, confirm the
domain and each sender show verified, From exactly matches the account, and outbound SMTP is allowed.
Application logs identify the category and failure without printing provider exceptions or secrets.


## 4. Image build (CI → GHCR)

Pushing to `main` triggers `.github/workflows/docker-build.yml`, which builds and pushes
`ghcr.io/<owner>/shbs-peer-tutoring-website:latest`.

Only a push or manual dispatch for the `main` ref can publish. Runs for the same pull request or
ref cancel older runs. Static checks, two isolated test shards, and the production image
build/boot checks run in parallel, followed by the required `verify` gate. Every prerequisite
must succeed; failed, cancelled or skipped jobs cannot authorize publication.

The image job applies OCI metadata before building and smoke-testing. On publishable runs,
it saves that image as a one-day artifact. The publishing job downloads that exact artifact
by ID from the same run, loads it, and checks its image ID against the build output. It does
not rebuild or export a second build cache. It pushes the SHA tag first, then `latest`,
rechecking `origin/main` immediately before each push. A stale commit or image mismatch
fails closed. As with any check followed by a registry write, the remote check and push
are not atomic; concurrency cancellation also limits superseded runs.

PR runs exercise the full build and smoke checks without uploading the image or publishing.
Test JSON reports are retained for seven days; use them to investigate failures and shard
imbalance. If the one-day image artifact has expired, rerun image verification before
retrying publication. A publish-only retry reuses the original successful image job's artifact.

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
The pairing-scheduling migration preserves all existing copied schedules as confirmed, including records with no catalog link. Their historical provenance is unknown, so it does not guess which old values were placeholders or rewrite attendance. New assignments default to **Awaiting schedule** until a slot is selected. Deploy the migration and application together; do not replace the migration chain with `db push`, which omits the room guards.

A customized runtime title takes precedence over a changed repository default.
Database-managed landing content/translations remain as published; update those
through their administration screens when required.

### Password-session revocation release

Apply migration `20260922200000_session_revocation` before serving this release; the standard container startup runs it automatically. No database reset is needed. The migration adds a database-maintained credential generation. Every password change, reset or setup invalidates all prior sessions, including the browser making the change. Sessions created before this release lack the generation and must sign in once again. Keep `AUTH_SECRET` stable; do not rotate it to perform this migration.

Email two-factor requirements and preferences remain unchanged. Legacy onboarding sends a setup link only to the stored primary address, and the account owner must open it before any password or verification state changes. Account data and history are preserved. Revocation is checked on subsequent authenticated requests; already-running work is not cancelled.

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

### Browser response policy and rollout

The public policy lives in [Caddyfile](../Caddyfile), with deferred header writes
so upstream headers cannot undo it. `next.config.js` also disables `X-Powered-By`
at source. The same policy applies in Caddy's error handler when an upstream
connection fails, preserving the error status without exposing internal details.
Direct access to the app still bypasses the proxy policy and must stay
private. The existing `X-Signup-Client-IP {remote_host}` request-header overwrite
is unchanged; never turn it into an append or trust a visitor-provided value.

| Policy | Current behavior |
| --- | --- |
| HTTPS/HSTS | Automatic HTTPS stays enabled. `max-age=86400` initially remembers HTTPS for one day on the exact hostname, without `includeSubDomains` or `preload`. Increase only after certificate renewal/HTTPS stability is verified. |
| Framing and document context | Enforced CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` plus `X-Frame-Options: DENY`. Pages cannot be embedded, even by the same origin. No current application workflow requires embedding. |
| MIME/referrer | `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`. Cross-origin navigation sends the origin rather than account/signup URL paths or queries. |
| Resource CSP | **Report-only**, not an XSS-prevention claim: first-party resources, the known Aliyun CAPTCHA script origin, image data/blob URLs and existing inline styles are listed. Inline scripts and additional CAPTCHA endpoints intentionally remain visible as violations for inventory. |
| Cookies and TLS | No cookie header rewriting, TLS relaxation, or authentication change. Verify Secure, HttpOnly and SameSite on disposable authenticated sessions. |

The report-only policy has **no reporting collector** or `report-to` endpoint.
It does not collect production telemetry or block resource loads. Inspect browser
console/`securitypolicyviolation` events during the controlled rehearsal; preserve
only sanitized evidence. The optional CAPTCHA SDK dynamically loads resources,
so its full destination set must be observed with synthetic provider test settings.
See [Caddy headers](https://caddyserver.com/docs/caddyfile/directives/header) and
[Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).
Next emits inline framework scripts; a strict enforced script policy needs fresh
per-request nonces integrated with rendering/caching. Do not simply rename the
report-only header to an enforced CSP or add a static nonce. A future reporting
collector needs explicit retention/privacy and rate/size limits; reports can
contain sensitive document URLs.

Before rollout, run `npm run test:deployment`, `npm run check`, `npm run docs:check`
and a production build, then rehearse the exact Caddy config with an isolated
application/database on loopback. Use a local test domain/certificate trusted only
for that rehearsal; preserve production TLS verification. Validate/adapt the
config with the selected Caddy version and ensure only test web ports are bound.
Do not repurpose a production database or start a shared daemon just for this test.

1. Run `TEST_BASE_URL=https://<test-host> node --test scripts/test-security-headers.mjs`
   through Caddy, not the internal app port. Check HTTP→HTTPS redirect separately.
   The probe uses unauthenticated GETs and does not establish authenticated page behavior.
2. In one bounded browser session, capture desktop/mobile screenshots and exercise
   sign-in/sign-out, each signup flow (including CAPTCHA off/on), language switching,
   `/localization`, management navigation/writes and uploaded images. Use disposable
   accounts and local email capture. Inspect final HTML, assets, redirects, 404s,
   MIME types, CSP console events and cookie attributes. Confirm hydration/navigation
   works and an embedding test is blocked by the enforced frame policy.
3. Check a request with a synthetic `X-Signup-Client-IP` at an isolated upstream:
   Caddy must replace it with the connection address. Check a mock upstream response
   carrying conflicting policy headers: the final public values must win, while
   `Set-Cookie` attributes and TLS remain intact. Include an upstream failure response.
4. Only after approval, update the host checkout/config and verify it with
   `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
   Reload with `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`
   and repeat the public/interactive checks. If the bind-mounted file was replaced
   and the running container sees an old inode, recreate **only Caddy** with the
   existing project/volumes. App header suppression additionally needs the new image.

Retain the prior Caddyfile for rollback and validate/reload it if compatibility
breaks. HSTS already stored by a browser cannot be undone over HTTP: keep HTTPS
working; an approved `max-age=0` response over valid HTTPS clears it on the next
visit. Keep report-only CSP until the nonce/resource work and browser matrix pass.
Repository checks alone do not prove the new policy is deployed or resolve the
operational verification items.

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

Email actions require `AUTH_URL` to be the canonical public HTTPS origin in production (no path, query, credentials or localhost). Notification, password/setup and signup link builders share this validation; invalid configuration fails delivery instead of emailing a localhost link. Development alone may fall back to `http://localhost:3000`.

Apply `20260929120000_email_notification_destinations` and regenerate Prisma before starting the updated worker. It retains each notification's internal destination in the outbox, in the same transaction as the event. Legacy program-update rows without a destination fall back to the home page. Account notices retain account settings; message notices use the role-aware inbox entry. A role downgrade falls back from staff-only links, and destination pages still enforce current access. Query parameters and fragments survive the notification's sign-in link, password/2FA completion, and expired-session recovery.

Outgoing mail includes a shared branded HTML layout plus the original plain-text content. Its Graphite design uses a neutral charcoal canvas (`#181B20`), graphite card (`#272D35`), pale blue highlights and primary blue `#0D59E6` for the action and short signature rule. Sans-serif headings, a divided message area and a separate copyable-link panel keep the content readable. The same dark palette is requested in light and dark clients, with inline color and table-background fallbacks; clients that force their own color conversion still need inbox verification. The runtime brand (normally **SHBS Peer Tutoring**) appears both above the card and in the centered footer. A centered 48 px site icon from the canonical application's `/icon.png` appears above the footer brand, followed by the privacy reminder. It is the only external image; all essential content remains readable with images blocked, and no external fonts or scripts are needed. Inspect representative clients, mobile widths, dark mode and images-disabled mode before rollout. Notification timestamps use the configured program timezone. Mail copy remains English, with existing bilingual signup instructions preserved: account records currently have no persisted mail-language preference. Configure and test the separate SECURITY and PROGRAM senders under [Email](#email--aliyun-direct-mail-邮件推送); each category needs a complete dedicated account or the complete legacy fallback.

Generate synthetic, offline previews with `npx tsx scripts/preview-emails.ts`; output defaults to `.validation/email-previews`. These files never use the database or live SMTP. Browser previews supplement, but do not replace, the real-inbox checks below.

Optional notification mail includes an **Unsubscribe** footer link and a plain-text equivalent. `/unsubscribe` is a public confirmation page: link scanners and GET requests do not change preferences. The signed link expires after 90 days and permits only disabling its notification category or all optional categories for the account, including included secondary destinations. Security alerts and essential direct mail never include this control; student signup confirmation is essential even though it uses the PROGRAM sender. No SMTP provider subscription list is involved. Treat unsubscribe URLs as private capabilities and do not add them to logs or analytics. Verify confirmation, expired/invalid links, category-only and all-optional changes, and continued security delivery before rollout.

For the supplied Docker deployment, pull and recreate the app as above: the image
contains the generated Prisma client and its entrypoint runs migrations. For a
source-based deployment outside Docker, apply all migrations with `npm run db:migrate`,
regenerate Prisma with `npx prisma generate`, build the application and restart the
persistent Node process before enabling optional notifications. The account-email migration atomically backfills primary addresses and recovery-token destinations; normalized collisions abort instead of merging accounts. Resolve legacy collisions before retrying. The follow-up migration releases any unverified secondary claims created by an earlier version and revokes their grants, preserving primary and verified secondary addresses. Affected users can request a new verification code.

The worker polls every 30 seconds and leases up to ten deliveries per batch for five minutes. Row locking coordinates concurrent workers. Failures retry with exponential backoff, up to five attempts. **Program & Refresh → Email delivery status** shows notices waiting to retry after a failed attempt separately from notices that exhausted retries. Inspect `EmailDelivery` status and safe failure summaries when diagnosing transport problems. A stable Message-ID identifies retries, but SMTP cannot guarantee exactly-once delivery after a process stops between acceptance and recording success. Short-lived deployments require an external scheduler calling the dispatcher.

The same panel checks SECURITY and PROGRAM SMTP connection/authentication separately, including when optional notifications are off. Missing production configuration and unsuccessful checks show warnings; development logging is identified as local-only delivery. Each check has a 15-second deadline and uses an isolated connection, with concurrent checks shared and results cached for 60 seconds per application process. The visible page refreshes status once a minute; **Refresh status** reads the latest available status and fresh queue counts without sending mail, retrying deliveries or changing settings. After correcting credentials, recreate the app; after a network repair, allow the cache to expire and refresh. A successful check does not prove sender/recipient acceptance or inbox delivery: complete the real-inbox smoke test above. Direct signup/authentication send failures are not outbox records, so their history is not included in queue counts. Provider errors, credentials and recipient details are never returned by this panel.

After correcting the transport, ADMIN/HEAD can use **Resend stuck emails** to queue up to 100 oldest eligible failed or retrying notifications for the normal worker. This starts a fresh retry cycle; the result reports how many were queued, not delivered. Active leases, completed/skipped mail and untouched pending mail are excluded. Unconfigured production categories and disabled optional notifications stay excluded; security notices remain independent. The worker rechecks current preferences and recipient ownership before sending and retains each message's existing ID. Repeated or concurrent clicks cannot requeue a row that is already waiting with a fresh retry budget. Each request records an aggregate audit entry. SMTP still cannot guarantee exactly-once delivery across an expired lease or a process failure after acceptance. If queuing succeeds but status refresh fails, use the read-only **Refresh status** recovery rather than submitting the resend again.

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

## Public signup abuse controls

Apply `20261009210000_crew_signup_verification` before deploying Crew application verification. The additive table stores pending drafts, mailbox challenges and private-status proof state; existing reviewed Crew applications and registration codes remain unchanged. No migration approves applications or creates accounts. Crew mail submission/status checks require the same trusted signup proxy configuration as tutee and Viewer signup. If CAPTCHA is enabled, Crew reuses the configured tutee scene with its own action-bound grants; no additional provider scene or paid service activation is required by this change.

Apply migrations and review [public signup protection](signup-protection.md) for
quota defaults, the trusted Caddy boundary, SMTP deadlines and outage troubleshooting.
Keep the application port private. No paid external service is required.

## Optional CAPTCHA

See [Aliyun CAPTCHA configuration and rollout](captcha.md) before enabling the
management switch. Install provider credentials as deployment secrets, apply the
migration, and perform the bounded operator smoke check after separate service
activation. The switch defaults off and is independent of period refresh.

## School departure migration

After deploying the school-departure schema, inspect existing graduated tutor accounts:

```powershell
npx tsx scripts/backfill-school-departures.ts
```

This defaults to a dry run. After reviewing its counts and account IDs, apply with
`npx tsx scripts/backfill-school-departures.ts --apply`. Repeating the command skips
accounts already confirmed. Revoked/suspended accounts, standalone Viewers and accounts
with active learning participation are reported for individual Head review.

The migration preserves account roles and historical records. Self-reported academic
graduation, ordinary archives and opt-outs do not grant access. New imports never run this
migration automatically. Review later-linked historical accounts explicitly.

The new `TRANSFERRED` tutor enum requires compatible application code. To disable the
feature, revoke departure-based observer grants or deploy a compatible corrective release;
do not run an older application that cannot read the enum or remove departure data to
restore participation implicitly.

The generic account-combine tool refuses accounts with departure history, including
reviewed returns. Combining those identities needs a reviewed data migration that keeps
departure events and explicit access revocations; do not delete departure rows to bypass it.

## Combined-account identity retention

Deploy `20260929010000_combine_accounts` and
`20260929020000_retired_credential_grants` before running code with the Head-only
account-combine workflow. The nullable `User.mergedIntoId` self-reference records an
explicit, one-level historical ownership relationship. Existing accounts remain active.
The database guards reject deleting either side of a combined identity, restoring
retired credentials/links, and issuing new recovery or verification grants to a retired
login. Duplicate primary/secondary addresses and usernames remain reserved; they are
not aliases of the surviving login. Merge chains are deliberately blocked.

Rollback of a completed combine is not an ordinary account edit or audit undo. Preserve
the original accounts, messages, policy evidence and audit records; use a reviewed data
migration if the ownership decision needs correction. Never remove the database guards
or reuse a retired identifier as a shortcut. The application checks retirement on login,
JWT validation, recovery, signup and live API authorization. Concurrent credential issuance
is fenced by a User-row lock, and the merge's actor/evidence audit commits atomically.

## Historical tutor ownership migration

Before deploying historical tutor linking, apply `20261007010000_tutor_history_ownership`
and regenerate Prisma. It adds explicit retained ownership with restrictive foreign keys
and guards against a different current login claiming the same tutor. It performs no
automatic matching or historical data rewrite. These ownership decisions and their
audit evidence require a full database backup; Program Records CSV exports are not an
ownership backup. Keep the new table and guards during application rollback; an older
application will not display retained tutor links. Review any ownership correction through
the staff workflow, and never remove guards to force a conflicting account attachment.

## Patrol credit migration

Apply `20261002010000_patrol_credit_budget` before starting the updated application. It adds server award timestamps and unique UTC 20-minute evidence reservations. Existing positive-hour patrols retain their hours, notes, observations and update timestamps; their recorded creation time becomes the historical award time. All observed intervals are reserved. A patrol without observations reserves its creation interval. For overlapping legacy awards, the earliest submission owns the reservation, with ID as the tie-breaker. No duplicates are deleted and no historical totals are reduced. Zero-hour records receive no award time or reservation.

Combined identities retain their original authors and reservations; the application checks their union. Corrections retain original reservations and add corrected intervals without creating another award. Program-record exports include the interval ledger. Importing an older archive backfills reservations and missing award times in the same transaction without changing its hour totals or update timestamps. Back up before migration and review legacy duplicate totals separately if needed. Do not run older application code after migrating: it would create unbudgeted awards without reservations. Test the migration and schema agreement on a disposable database before deployment.
