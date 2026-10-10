# Issue 242: production evidence and remaining work

This is the evidence record for [issue #242](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/242). The host and hosted external inspections below were recorded on 9 October 2026; they are dated evidence, not a live status check. Cloud-account evidence remains incomplete.

## Documentation handoff — 10 October 2026

The maintainer requested a checking guide with official Aliyun references and
closure of #242 after documentation. The maintained
[Aliyun network verification guide](../aliyun-network-verification.md) now gives
the cloud owner the console steps, evidence worksheet and external-check limits.
This request supersedes the earlier requirement to keep #242 open for cloud evidence.
Issue closure records the documentation handoff, not completed cloud verification
or a finding that all administrative access is restricted. No new cloud evidence
was collected and no production access policy was changed for this handoff.

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
policy, including alternate public addresses. Follow the new guide to collect
that evidence independently of the issue's closure. Public SSH and root-password authentication are reported
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

## Remaining work

A cloud-account owner must confirm the effective security-group attachments,
address/NAT inventory and applicable rules against the recorded host and outside
observations. Follow the maintained [production perimeter worksheet](../deployment.md#complete-the-effective-policy-worksheet)
for evidence collection and acceptance. Preserve the existing SSH authentication
policy; this record does not authorize production configuration changes.

The collector and observation workflow merged in
[PR #273](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/273).
Continue from current `main`, not the superseded draft branch. If code changes are
needed, use the [local verification guide](../local-development.md); source tests
and a successful collection job cannot substitute for the missing cloud evidence.
Earlier checkpoints and their validation receipts remain in Git history.
