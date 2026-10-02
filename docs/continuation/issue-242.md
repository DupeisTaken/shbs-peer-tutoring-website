# Issue 242 cloud continuation

This is a portable checkpoint for [issue #242](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/242), not completion of production verification. All eight actual production acceptance rows remain **UNKNOWN**. Do not close the issue from this source work or a draft PR.

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
