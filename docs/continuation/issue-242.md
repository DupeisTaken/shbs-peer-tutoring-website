# Issue 242 cloud continuation

This is the evidence record for [issue #242](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/242). The 9 October host and hosted external inspections below supersede the earlier all-unknown checkpoint. Cloud-account evidence remains incomplete; do not close the issue without it.

## Production inspection — 9 October 2026

The operator authorized access to the canonical production host. Bounded read-only
SSH commands inspected the running host on 9 October 2026 at 01:39–01:42 UTC
(09:39–09:42 Asia/Shanghai). No deployment, account, database, volume, firewall or
SSH setting was changed. The existing root-password access policy was preserved.
Raw listener, route, namespace, firewall and image evidence remains private in the
local report bundle, rather than in Git or public issue attachments.

| Acceptance row | Observed evidence | Status |
| --- | --- | --- |
| Listeners and containers | Host TCP listeners expose SSH 22 and proxy 80/443 on both address families. DNS resolver and backup-agent listeners are loopback-only. The running Compose project has three expected containers; app and database have no host publications. | Host inventory verified |
| Cloud and host firewall | UFW is active with incoming/routed default deny, public TCP 22/80/443 allowances, and corresponding IPv6 rules. Active nftables/iptables Docker NAT forwards only 80/443 to the proxy. Cloud security-group attachment/rules remain unavailable. | Host verified; cloud unknown |
| SSH and administrative access | Active ssh service and its actual process arguments agree with the inspected configuration. Root/password and public-key login remain enabled. Root and non-root test contexts at local and external source addresses have the same authentication settings; no source restriction was inferred. Authorized root login succeeded. | Current host policy verified |
| App, database and proxy administration | Container namespace inspection finds app 3000 and database 5432 only in their respective bridge namespaces. Proxy administration listens on container-local 127.0.0.1:2019. No host mappings exist for these ports, Studio 5555 or alternate HTTP 8080. Docker has no daemon direct-routing override; the application network is an IPv4 bridge. | Host paths verified |
| Web and operator continuity | The read-only sessions completed; HTTPS sign-in returned 200 with valid TLS from the host. No service was restarted or configuration reloaded. | Observed continuity verified |
| Volumes and data | Actual PostgreSQL and proxy data/config volumes and the proxy configuration bind mount were inspected. Nothing was written to these mounts or to application records. This was not a backup restoration test. | Mounts/preservation verified |
| Deployed image identity | Running application OCI revision is `1abcaddec82818a852e499168803f0dd4c246a8c`; its immutable image identity and registry digest were recorded privately. The corresponding [publish workflow](https://github.com/DupeisTaken/shbs-peer-tutoring-website/actions/runs/37620237037) succeeded. Proxy image identity was recorded separately. | Verified |
| Independent external results | A GitHub-hosted runner observed an SSH greeting, HTTP 308 to the canonical HTTPS origin, and HTTPS sign-in 200 with valid TLS. TCP 3000/5432/2019/5555/8080 timed out; these negative observations remain inconclusive. The precise run is recorded below. | Public protocols corroborated; negative observations require policy evidence |

The instance reports a public IPv4 address matching production DNS and no global
IPv6 address/default route. Container IPv6 is disabled; host IPv6 listeners and
firewall rules were nevertheless included. This observation does not substitute
for the cloud account's complete address, NAT and security-group inventory.

The operator reported that they do not have access to the Alibaba Cloud account.
The browser opens at cloud sign-in, the host has no Alibaba Cloud CLI, and no
instance RAM-role name was available from the selected metadata query. No cloud
credentials or metadata credential values were requested or collected. A cloud
account owner must supply the effective attached-rule inventory; host root access
alone does not provide that control-plane authorization. Alibaba Cloud documents
the required read permission and rule query in
[DescribeSecurityGroupAttribute](https://www.alibabacloud.com/help/en/ecs/developer-reference/api-ecs-2014-05-26-describesecuritygroupattribute).

Remaining work is specific: corroborate the effective cloud attachment/ingress/NAT
policy, including alternate public addresses. Keep #242 open until that inventory
has evidence. Public SSH and root-password authentication are reported
as the existing operational policy, not judged against an invented key-only policy.

### Independent hosted observation

The `Production network observation` workflow collects the fixed canonical-host
matrix from a GitHub-hosted Ubuntu runner without credentials or production writes.
It resolves `pt.shbs.org.cn`, visits each returned address serially (at most four),
and makes one bounded observation on TCP 22, 80, 443, 3000, 5432, 2019, 5555 and
8080. HTTP uses `/signin`, HTTPS validates the certificate with the canonical SNI,
SSH reads only its greeting, and PostgreSQL receives only an unauthenticated SSL
negotiation request. No redirect is followed and no login is attempted.

Each connection has a five-second wall-clock deadline and a 4 KiB response cap;
the job has a five-minute outer limit. Only sanitized protocol summaries are saved
in a seven-day CI artifact. Silent or refused connections remain inconclusive and
must be assessed beside host and cloud rules. A successful collection job does not
mean the perimeter is approved. Synthetic regression tests exercise bounds and
response-data exclusion; the hosted run supplies the actual external observations.

The workflow runs for same-repository PR changes to its own script/test/workflow,
or by explicit dispatch after merge. It does not run on ordinary application PRs
and does not grant fork PRs access to production probing or repository secrets.

The first [hosted observation run](https://github.com/DupeisTaken/shbs-peer-tutoring-website/actions/runs/37874516356)
completed successfully at 02:26:09 UTC on 9 October 2026. Its source head was
`f4891c8150f7dd97787fd20ea56fd844ce203d20`; GitHub checked out the PR merge revision
`2e942491d977345de29a6304eeb4f908681defde`. The artifact identifies the hosted Linux
runner and run ID. DNS returned one IPv4 address matching the privately observed
host address; no IPv6 address was returned by this runner's resolver.

| Port | Protocol observation |
| --- | --- |
| 22 | SSH greeting received; no authentication attempted. |
| 80 | HTTP 308 redirect to the canonical HTTPS origin; no redirect followed. |
| 443 | HTTP 200 for sign-in with certificate and hostname validation. |
| 3000, 5432, 2019, 5555, 8080 | Each connection timed out after five seconds, with no service response. These are observations, not proof that a particular cloud rule denies access. |

All five synthetic collector tests passed in that hosted job. The public protocol
results corroborate the earlier host inspection; the missing cloud inventory still
prevents a complete perimeter conclusion. No runtime configuration or data changed.

## Earlier source-only checkpoint

The sections below retain the earlier source-tooling handoff and its historical
validation. Its statements about unavailable host access describe that earlier
checkpoint, not the 9 October inspection above.

## Identity and scope

- Branch: `codex/issue-242-operator-verification`.
- Reviewed source head: `5ac94a17afd5fe4df27c8e9c8f13b0aaab391dde`.
- Source base: `d3a98dad232902ccf6a6ebe772c6467a095e5eba` (merged PR #246).
- Dependency: [PR #245](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/245), commit `aae8a50`, is already an ancestor. It improved source defaults but left production evidence pending.
- A later handoff-only commit may add this document. Its exact published SHA must be recorded in the draft PR and publication receipt; the source-validation results below belong to the reviewed source head, not an untested later implementation.
- Scope is VPS/SSH and infrastructure access, not the website `/admin` interface. No application UI, schema, deployment configuration, firewall or SSH configuration changed.

The latest human instruction is to **preserve and report the current policy**, including root password login under technical/maintenance constraints. Do not infer a key-only requirement from “ssh only.” Do not propose or make authentication, root-login, source-rule, firewall or deployment changes. Report actual settings without substituting an ideal policy. Passwords and other credentials must not be requested in chat or committed.

## Completed behavior

`scripts/collect-network-evidence.sh` collects selected local IPv4/IPv6 listeners, interfaces/routes, rootful Docker container/network mappings, mount identities and image IDs/digests/OCI provenance. Every Docker call is pinned to `unix:///var/run/docker.sock`; ambient remote/TLS options are removed within the script. It does not read `.env`, interpolate Compose, query a registry, probe public ports or change services/volumes.

The collector uses private unique output directories, serial commands, an 8-second command limit, a 120-second command budget, 64 KiB per result and caps of 12 containers/8 networks. Failed stdout/stderr are discarded. Missing, invalid, capped or unavailable observations remain explicit gaps. Exit 0 means collection completed; exit 2 means gaps. Both retain `OPERATOR VERIFICATION PENDING`.

The source change also adds 16 collector regression cases, adds the suite to `test:deployment`, and expands `docs/deployment.md` and `docs/local-development.md`. Core decisions are annotated in the code. Rootless/other engines, effective cloud/firewall/SSH/Caddy runtime policy and external reachability still require operator evidence.

## Validation and review status

| Stage | Status and scope |
| --- | --- |
| `npm run test:deployment` | Passed on reviewed source: 44/44, comprising 16 collector and 28 existing deployment cases. Synthetic commands only. |
| `npm run docs:check` | Passed on reviewed source: 13 tests; 24 Markdown documents and four issue forms. |
| Checkpoint documentation | Fresh `npm run docs:check` passed with this continuation note and its index link: 13 tests, 25 Markdown documents and four issue forms. No redundant application build or fixture rerun was performed. |
| `npm run check` | Passed on reviewed source: Next type generation, ESLint and TypeScript; zero errors, 18 warnings in unchanged files. |
| Bash syntax and Git whitespace | Passed on reviewed source. |
| Environment | Windows, Node 24.16.0, Git Bash 5.3.9; deployment tests serial, Node memory capped at 2 GiB. Matching local dependency/runtime artifacts were reused; cloud setup must install its own locked dependencies. |
| Linux/Node 22, POSIX modes, real Docker templates | Not run for this unpublished source candidate. Timeout tests inject failure/clock conditions; they are not a live 120-second production rehearsal. |
| Application integration/build/database/browser | Not run for this source-only tooling change. No application behavior or UI changed. Future PR CI results must be checked against the exact published SHA. |
| Source review | Coordinator approved the unchanged source candidate. No unresolved source review finding is recorded. |
| Local HTML report | Final coordinator review passed. Five widths (375/414/768/1024/1440), 150% text, keyboard navigation/disclosures, internal/external links and embedded images passed; no browser errors/external assets. Initial enlarged-text grid overflow was repaired in the ignored report only. |
| Production acceptance | Blocked: all eight rows UNKNOWN; no production probe or change performed by this task. |

The reviewed standalone report SHA256 is `984600fd57ac5a372c5ceb2efe34d7317e648449470571b9e8c8b34799eb3351`. Local reports, screenshots and raw receipts are deliberately excluded from Git and will not exist in a fresh clone. Their summaries above are historical evidence, not fresh cloud verification. Recreate a report from current command output if another report is needed; label synthetic output and obtain review before treating a new HTML artifact as approved. Never fabricate production or application screenshots. Draft publication itself does not waive that report gate.

## Minimal cloud continuation

Use your own checkout, the exact branch and Node 22 (CI baseline), with Bash/GNU coreutils available. Inspect `AGENTS.md`, `docs/contributing.md`, `docs/local-development.md` and any current coordination instructions first. Do not create subagents. If sharing the same local machine, claim the existing exclusive validation lock with atomic CreateNew before heavy work and release only your own lock after owned services stop. A fresh cloud machine must use its own coordination mechanism rather than the old machine's absolute paths.

```bash
git fetch origin codex/issue-242-operator-verification
git switch --track origin/codex/issue-242-operator-verification
git rev-parse HEAD
git status --short
export NODE_OPTIONS=--max-old-space-size=2048
export RAYON_NUM_THREADS=1
export SHBS_BUILD_CPUS=1
npm ci
bash -n scripts/collect-network-evidence.sh
npm run test:deployment
npm run docs:check
SKIP_ENV_VALIDATION=1 npm run check
```

Use `git switch codex/issue-242-operator-verification` if that local branch already exists. Do not overwrite local changes or reset to make checkout succeed. `npm ci` generates Prisma through the existing postinstall; do not use the misleading `db:generate` script, which runs `prisma migrate dev`. The focused collector/deployment suite provides isolated fake commands and requires no running Docker daemon, database, application server or production credentials. Do not run the collector directly on the cloud development machine and label that as production evidence.

No browser/app fixtures are needed to continue this collector-only work. If later application work needs them, follow the local-development guide with an isolated loopback `shbs_shipping_test` database and synthetic fixtures; run one worker and one browser/server serially, capture desktop/mobile evidence, and stop only owned services. Never seed/reset production. Read the bundled Next docs before any Next code changes.

## Minimal operator action and missing evidence

The current authentication-policy decision is settled: preserve it. The smallest next human action is to confirm the production host/URL and identify an operator with an existing authorized session, including the current root-password SSH method. That operator can collect host evidence while an outside vantage is arranged.

Missing information is the operator-confirmed canonical hostname, hosting/instance identity, public address families (or absence of IPv6), existing deployment location/engine, authorized operator and private transfer channel, cloud-rule attachment reviewer, observed current SSH source/authentication settings, and an independently controlled outside network. Do not guess a target from example domains, old issue observations or source configuration. This worktree had no production `.env` or private operator evidence. The earlier issue SSH response remains historical and does not establish current policy.

Copy only the reviewed collector through an approved operator channel, without pulling/deploying/installing on production. In the existing Bash session, fill the absolute path and run once:

```bash
(
  umask 077
  collector='/ABSOLUTE/PATH/TO/REVIEWED/collect-network-evidence.sh'
  expected='f40287974a8587afea9529941118f26bd6fa07fd971ce55d066b4df5a3826c6b'
  printf '%s  %s\n' "$expected" "$collector" | sha256sum --check --status || exit 1
  evidence_base="$(mktemp -d "${TMPDIR:-/tmp}/shbs-242.XXXXXXXX")" || exit 1
  bash "$collector" "$evidence_base"
  collector_status=$?
  printf 'collector_exit=%s\nprivate_evidence_base=%s\n' "$collector_status" "$evidence_base"
)
```

Retain `evidence.txt`, exit, UTC time, host alias and reviewer privately. Missing tools/rights or `UNAVAILABLE` remain gaps; do not install, grant rights or switch daemons automatically. The checksum is for the reviewed LF bytes. If the collector is changed later, obtain review and a new checksum before operator execution.

Then follow the maintained `docs/deployment.md` effective-policy worksheet, applying the latest human preservation constraint:

1. Explain actual listeners/container paths, Caddy runtime/admin behavior, cloud attachments and active host INPUT/forwarding/NAT for both families. Use only the applicable backend's read-only commands, bounded with `sudo -n timeout --kill-after=1s 8s ...` where already authorized; an existing authorized root session needs no sudo.
2. Inspect actual SSH service/socket startup and configuration overrides privately. Run bounded `sshd -T -C` for relevant actual user/source/local-address/port contexts with the same startup overrides. Record effective password/key/keyboard-interactive/MFA/root/allow-deny behavior without changes or login experiments.
3. Correlate actual DB/certificate mounts, existing backup/record evidence, intended web/operator continuity, app/Caddy image IDs and registry digests, app OCI source/revision and the exact successful CI publication. Source checkout or mutable tags are insufficient.
4. Approve a finite outside address/port/protocol matrix and vantage first. Use one serial observation per cell, 3-second connect and 8-second total bounds. Preserve SNI/TLS verification for web checks. No sweep, credential attempts or unapproved destinations. Report current SSH source policy; do not assume it must block ordinary external sources. A timeout, bare handshake or absent protocol reply alone is inconclusive.

Record UTC time, reviewer/vantage, current policy, private evidence reference, observed result and VERIFIED/MISMATCH/UNKNOWN for each of the eight rows: listeners/Docker; cloud/host firewall; SSH/admin; app/DB/Caddy admin; web/operator continuity; volumes/data; deployed identity; independent external results. Root password login or unrestricted SSH must not be treated as a mismatch against an invented stricter policy. Remaining gaps keep #242 open.

## Integration and next actions

The base already includes PR #245 and #246; no other unmerged feature dependency is required. This branch edits shared `package.json`, `docs/deployment.md` and `docs/local-development.md`. Coordinate with other issue branches touching those files, especially deployment/header documentation; preserve their changes and this branch's serial collector suite. Other branches' final overlaps have not been recomputed here. Do not merge, rebase another branch or deploy as part of checkpoint publication.

Next: verify the draft PR's exact SHA and CI state, run the focused Linux checks when appropriate, obtain the missing operator evidence, and compare observations with the preserved current policy. Keep unfinished stages explicit. Any additional source work needs its own tests/review; any changed HTML report needs renewed artifact review. No issue closure or production mutation is authorized by this checkpoint.
