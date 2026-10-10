# Check the production network settings in Aliyun

Use this guide to answer: **which Internet connections can reach the production
server, through which addresses, and under which cloud rules?** It is the operator
handoff for [issue #242](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/242).
Official Aliyun references were checked on 10 October 2026. Console labels can
vary by language; Chinese labels are included where useful.

## Status and access needed

The [9 October evidence record](continuation/issue-242.md#production-inspection--9-october-2026)
already records the host inspection and independent external observations.
The application and database had no host port publications, and Caddy's admin
listener was container-local. SSH, HTTP and HTTPS responded externally; the tested
private-service ports timed out. These are dated observations, not a guarantee
about today's configuration or every possible public address.

The remaining evidence is in the **Alibaba Cloud account**, not on the Linux
server. Ask the account owner to perform the checks below or provide an authorized
read-only console session covering the relevant resources. SSH/root access does
not grant cloud-console access. Do not send passwords, AccessKeys or session
cookies through GitHub or chat. No new key is needed for this console procedure.

This guide records existing settings. Do not click controls that create, replace,
bind, unbind, enable, delete or edit resources. Preserve current root/password SSH
access, HTTP/HTTPS, database volumes and deployment settings. Record discrepancies
for a separate operator decision.

On 10 October 2026, the maintainer requested documentation and closure of #242.
That closure hands the checks to the cloud owner; it does **not** certify that
cloud verification has passed. Cloud evidence remains unknown until collected.

## 1. Identify the right instance and all its interfaces

1. In the Aliyun console, open **ECS / 云服务器 ECS → Instances / 实例**.
   Select the production region and confirm the account/resource-group scope.
   Have the operator identify the production instance; do not rely only on a
   similar display name or an old IP address.
2. Open its details. Privately record the instance ID, region, VPC, vSwitch,
   primary private IP and displayed public addresses. Match these to the host
   record and current production DNS. Resolve any mismatch before proceeding.
3. Open its **Security Groups / 安全组** tab and record every associated group ID
   and type. Then inspect **Elastic Network Interfaces / 弹性网卡** attached to
   this instance, including secondary interfaces, private/secondary addresses,
   IPv6 addresses and their security groups.
4. Save evidence that connects **instance → interface → group**. A screenshot
   of a rule alone cannot show that it applies to production.

Aliyun explains that instance associations apply to the primary interface and
secondary interfaces can have different groups in
[使用安全组 / Use security groups](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups).
Use its navigation for inspection only; this task does not require its change steps.

**Save:** a complete interface/group list with observation time and private
evidence references. If access is denied, a list is filtered, or some pages are
unavailable, record **unknown**, not “none.”

## 2. Read all effective inbound rules

For each group identified above, open its details and **Inbound / 入方向** rules.
Capture every page, not just a port-filtered view. Record group/rule ID, allow or
deny, priority, protocol, destination port/range, source IPv4/IPv6 range and any
referenced security group or prefix list. Resolve referenced objects privately.
Include broad port ranges and all-protocol rules that cover the ports below.

Aliyun's [安全组规则 / Security group rules](https://help.aliyun.com/zh/ecs/user-guide/security-group-rules)
describes how rules from multiple groups combine: lower priority numbers are
evaluated first; at equal priority, deny takes precedence over allow. Account for
the group type's default rules and any extra source/destination conditions.
Do not judge one group in isolation or assume every allow overrides every deny.

Use this project worksheet for each interface/address path:

| Destination | What to establish |
| --- | --- |
| TCP 80 and 443 | Intended public website path; explain any intermediate proxy. |
| TCP 22, plus any actual administrative ports | Exact permitted source ranges: trusted addresses/VPN, unrestricted, or unknown. Compare with the operator-confirmed current policy. |
| TCP 3000, 5432, 2019, 5555 and 8080 | Whether cloud rules allow traffic toward these private-service destinations; correlate with host/container routing. |
| Other ports/protocols | Explain broad allowances, UDP and any other discovered service. The supplied Compose publishes TCP web ports only. |

`0.0.0.0/0` means any IPv4 source; `::/0` means any IPv6 source. Record these
literally in the private worksheet. Aliyun recommends limiting management access
to trusted sources in its security-group guide, but this review must preserve and
report the current policy. A recommendation is not authorization to change SSH.

**Save:** the complete rules plus a short explanation of the matching result for
each path. An allowed cloud port is not proof of a listening service; an external
timeout is not proof of a cloud deny rule.

## 3. Find every public address and forwarding path

### Public IPv4 and Elastic IP addresses

Open **Elastic IP Address / 弹性公网 IP**, in the relevant region and account
scope. Inspect the bound-resource details. Reconcile the instance's fixed public
address and any EIPs bound to its interfaces or to gateways/load balancers that
forward to it. Record unresolvable relationships as unknown.

Aliyun's [EIP resource binding guide](https://help.aliyun.com/zh/eip/bind-an-eip-to-a-cloud-resource/)
lists supported destinations, including ECS, ENIs, load balancers and Internet
NAT gateways. EIPs can be translated upstream, so absence from Linux's interface
address list does not establish absence of a public route.

**Save:** public-address alias → bound resource → production destination.
Compare current DNS A/AAAA records with this inventory; an address need not have
a DNS record to be reachable.

### Internet NAT gateways and DNAT

Open **NAT Gateway / NAT网关 → Internet NAT Gateway / 公网NAT网关**. Inspect
gateways serving the production VPC and their **DNAT / DNAT管理** entries. Match
destinations against every production private address, including secondary ENIs.
Record the external EIP, protocol, external port/range, internal destination and
internal port/range. Include **Any Port / 任意端口** mappings.

Aliyun's [Internet NAT access guide](https://help.aliyun.com/zh/nat-gateway/user-guide/use-internet-nat-gateway-for-public-network-access)
explains incoming DNAT and outgoing SNAT. Inspect associated route tables as part
of tracing the path. A SNAT entry alone does not establish inbound forwarding.
For example, external TCP 15432 mapped to internal 5432 would need review even
if an external test of port 5432 timed out.

**Save:** every matching DNAT path, or evidence of no matching entries across the
relevant gateways. An empty page with insufficient permissions is not evidence.

### Load balancers and other front doors

If public ALB, NLB or CLB resources can reach this instance, open their listeners,
forwarding rules and backend server groups. Match ECS/ENI identities and private
addresses to the inventory. Record each public endpoint and listener port,
destination port, and applicable access controls. Ask the owner to account for
any other proxy, CDN/WAF origin or cross-account forwarding path.

Aliyun documents the relationship between listeners and destinations in its
[ALB server-group guide](https://help.aliyun.com/zh/slb/application-load-balancer/create-and-manage-a-server-group),
[NLB server-group guide](https://help.aliyun.com/zh/slb/network-load-balancer/user-guide/create-and-manage-a-server-group)
and [CLB server-group guide](https://help.aliyun.com/zh/slb/classic-load-balancer/user-guide/backend-server-overview).
Follow the guide for the product actually present; do not create a load balancer.

**Save:** a public-to-backend path list, or owner-reviewed evidence that no such
resources serve this deployment. Scope the conclusion to the inspected accounts
and regions.

### IPv6

Check interface IPv6 addresses and the VPC's **IPv6 Gateway / IPv6网关**. Inspect
**IPv6 Internet Bandwidth / IPv6公网带宽** and any **egress-only / 仅主动出** rules
for those addresses, then correlate with IPv6 security-group and host rules.

See Aliyun's [IPv6 gateway overview](https://help.aliyun.com/zh/ipv6-gateway/) and
[IPv6 public-bandwidth guide](https://help.aliyun.com/zh/ipv6-gateway/user-guide/enable-and-manage-ipv6-internet-bandwidth).
Do not enable bandwidth to perform this check. “DNS has no AAAA record” and
“the host had no global IPv6 address on 9 October” do not replace this inventory.

**Save:** the actual IPv6 path and controls, or evidence-backed absence.

## 4. Check additional cloud controls and reconcile with the host

In **VPC / 专有网络**, inspect whether each relevant vSwitch has a network ACL.
Where attached, record its inbound/outbound rules, ordering and address-family
scope. Aliyun's [network ACL guide](https://help.aliyun.com/zh/vpc/network-acl-overview)
explains this separate vSwitch-level control, including exceptions to its scope.
ACLs are stateless, so inspect return-traffic rules too. If Cloud Firewall or another managed
control is deployed on the path, have its owner supply the effective policy too.
Do not assume a product is enabled merely because it appears in the console menu.

Build one path record for each public endpoint:

```text
Public endpoint and protocol/port
  -> EIP / NAT / load-balancer mapping (or direct instance path)
  -> destination ENI and applicable cloud controls
  -> host firewall and Docker forwarding
  -> actual service listener and namespace
```

Compare with the [host verification worksheet](deployment.md#complete-the-effective-policy-worksheet).
Reuse dated host evidence only when the operator confirms it still describes the
deployment. If containers, addresses or rules changed, refresh the relevant
read-only evidence. Keep running image digest/source revision and observation
time with the record. Do not deploy or restart services to perform verification.

## 5. Corroborate from an independent network

After the owner confirms the targets and intended policy, follow
[independent external verification](deployment.md#independent-external-verification).
Use an external network outside the server/VPC and any local interception proxy.
Test serially with bounded timeouts, preserving HTTPS hostname/certificate checks.
No credentials, login attempts or broad port scans are needed.

The existing [Production network observation workflow](../.github/workflows/production-network-observation.yml)
can be run through **GitHub Actions → Production network observation → Run workflow**
on the reviewed branch. It checks only the canonical DNS addresses (at most four)
and its fixed eight TCP ports. It does not cover undiscovered EIPs, translated
ports, every IPv6 path or trusted-source behavior. Review its coverage before use;
additional owner-confirmed endpoints need a separately bounded test matrix.

Save the run URL, tested revision, UTC time, vantage/address family and sanitized
protocol results. Download the artifact before its seven-day retention expires.
Where a restricted-source policy is intended, compare permitted and outside
sources. A timeout/refusal stays inconclusive; explain it alongside the actual
rules. Unexpected responses require investigation, not an automatic firewall edit.

## 6. Save the handoff and distinguish unknown from verified

Keep raw console exports/screenshots and exact account IDs, addresses and operator
identities in private operational storage. For GitHub, use consistent aliases
such as `production-eni-1` and `admin-range-A`; preserve relationships and whether
sources are unrestricted. Exclude credentials, cookies and participant data.

Copy this worksheet into the private record and fill every row. Use **verified**
for supported observations consistent with the confirmed policy, **mismatch** for
a demonstrated policy difference, and **unknown** for missing or ambiguous evidence.

| Check | Observation and intended policy | Private evidence reference and UTC time | Reviewer and result |
| --- | --- | --- | --- |
| Account/region/instance and every ENI | Pending | Pending | Unknown |
| Attached groups and effective IPv4/IPv6 ingress | Pending | Pending | Unknown |
| Fixed public IPs, EIPs and DNS comparison | Pending | Pending | Unknown |
| DNAT, load balancers and alternate paths | Pending | Pending | Unknown |
| IPv6 gateway and public-address status | Pending | Pending | Unknown |
| Network ACLs and other applicable controls | Pending | Pending | Unknown |
| Current host/container/SSH and image identity | Link dated evidence; refresh if changed | Pending | Unknown |
| Independent external results and coverage gaps | Pending | Pending | Unknown |

A complete technical review needs evidence for all applicable paths and an
explanation of absent resources. Identify an owner for each remaining unknown or
mismatch. Closing #242 on the maintainer's documentation request does not change
those results. Any later access-policy change needs its own reviewed procedure,
operator-access recovery plan and validation.

[Deployment runbook](deployment.md) · [Documentation home](README.md)
