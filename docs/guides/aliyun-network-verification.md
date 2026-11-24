# Check the production network settings in Aliyun

Use this read-only runbook to verify which Internet connections can reach the
production server, through which addresses, and under which cloud rules. Console
labels vary by language; Chinese labels are included where helpful.

> [!IMPORTANT]
> **Guardrails for every step:**
> - **Read-only only:** Do not click Edit, Add, Modify, Authorize, Create, Bind,
>   Unbind, Enable, or Release. Preserve current SSH, HTTP/HTTPS, volumes and settings.
> - **Do not extrapolate from timeouts:** An external timeout or empty page without
>   permissions does not prove a cloud deny rule — record **unknown** instead.
> - **Protect secrets:** Keep raw exports, IPs and account IDs in private storage;
>   never post credentials, AccessKeys or cookies in GitHub or chat.
> - **Issue #242 handoff:** Closing [#242](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/242)
>   handed these checks to the cloud account owner and does **not** certify that
>   cloud verification has passed.

## Status and access needed

Host inspection and independent external observations confirmed that the app and
database had no host port publications and Caddy's admin listener was
container-local, while SSH, HTTP and HTTPS responded externally (see the
[archived baseline record](https://github.com/DupeisTaken/shbs-peer-tutoring-website/blob/6357007373d1efd177e36140d9e0ba7c80d2f237/docs/continuation/issue-242.md#production-inspection--9-october-2026)).
Those are dated point-in-time observations, not proof of today's cloud rules.

The unresolved evidence lives in the **Alibaba Cloud account** (SSH/root access
on the Linux host does not grant cloud-console access): effective security-group
attachments, full public IPv4/IPv6 inventory, NAT/forwarding paths and ingress
rules. Ask the account owner to perform these steps or provide a read-only
console session.

## 1. Identify the instance and its network interfaces

- **Console path:** **ECS / 云服务器 ECS → Instances / 实例** (select the production
  region and resource group), then **Security Groups / 安全组** and **Elastic
  Network Interfaces / 弹性网卡** ([Aliyun security groups guide](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups)).
- **Record:** Instance ID, region, VPC, vSwitch, primary/secondary private IPs,
  displayed public IPv4/IPv6 addresses, and every ENI → security group binding
  (secondary ENIs can carry different groups). Reconcile against host records and
  current DNS before continuing.
- **Leave out:** Unverified assumptions from display names or old IPs; if access
  is denied or filtered, record **unknown**.

## 2. Read all effective inbound rules

- **Console path:** Open each attached security group → **Inbound / 入方向** (capture
  every page, not a port-filtered view; [Aliyun rule evaluation](https://help.aliyun.com/zh/ecs/user-guide/security-group-rules)
  — lower priority numbers evaluate first, deny beats allow at equal priority).
- **Record:** Group/rule ID, allow/deny, priority, protocol, destination port/range,
  source IPv4/IPv6 (`0.0.0.0/0` / `::/0` literally), referenced groups/prefix lists
  and broad all-protocol rules covering:

| Destination | What to establish |
| --- | --- |
| TCP 80 and 443 | Intended public web path and any intermediate proxy |
| TCP 22 (and any admin ports) | Exact permitted source ranges vs. confirmed operator policy |
| TCP 3000, 5432, 2019, 5555, 8080 | Whether cloud rules permit traffic toward private service ports |
| Other ports/protocols | Explain any broad allowances, UDP or additional services |

- **Leave out:** Unrequested SSH edits (Aliyun's guide recommends tightening SSH,
  which requires a separate operator decision).

## 3. Find every public address and forwarding path

- **Elastic IPs:** **Elastic IP Address / 弹性公网 IP** ([binding guide](https://help.aliyun.com/zh/eip/bind-an-eip-to-a-cloud-resource/)).
  Record every public-IP/EIP → bound resource → production destination and compare
  with DNS A/AAAA (an IP without DNS can still be reachable).
- **Internet NAT / DNAT:** **NAT Gateway / NAT网关 → Internet NAT Gateway / 公网NAT网关 → DNAT / DNAT管理**
  ([NAT guide](https://help.aliyun.com/zh/nat-gateway/user-guide/use-internet-nat-gateway-for-public-network-access)).
  Record every DNAT entry targeting any production private IP (including **Any Port / 任意端口**
  and non-standard port translations such as external `15432 → 5432`) alongside
  associated route tables. SNAT alone is not inbound forwarding.
- **Load balancers / front doors:** Inspect any public ALB/NLB/CLB listeners,
  forwarding rules and backend server groups ([ALB](https://help.aliyun.com/zh/slb/application-load-balancer/create-and-manage-a-server-group) ·
  [NLB](https://help.aliyun.com/zh/slb/network-load-balancer/user-guide/create-and-manage-a-server-group) ·
  [CLB](https://help.aliyun.com/zh/slb/classic-load-balancer/user-guide/backend-server-overview))
  plus any CDN/WAF or cross-account proxy; record owner-confirmed absence where
  none apply.
- **IPv6:** Check ENI IPv6 addresses, **IPv6 Gateway / IPv6网关**, **IPv6 Internet
  Bandwidth / IPv6公网带宽** and **egress-only / 仅主动出** rules ([gateway](https://help.aliyun.com/zh/ipv6-gateway/) ·
  [bandwidth](https://help.aliyun.com/zh/ipv6-gateway/user-guide/enable-and-manage-ipv6-internet-bandwidth)).
  Absence of a DNS AAAA record does not prove IPv6 is unreachable.

## 4. Check additional cloud controls and reconcile with the host

- **Console path:** **VPC / 专有网络** vSwitch **Network ACLs** (stateless — inspect
  both inbound and return rules; [ACL guide](https://help.aliyun.com/zh/vpc/network-acl-overview))
  plus Cloud Firewall if actively deployed.
- **Reconcile each public path:**
  `Public endpoint/port -> EIP / NAT / LB (or direct) -> ENI & cloud rules -> host firewall & Docker -> service listener`
- Compare against the [host verification worksheet](deployment.md#complete-the-effective-policy-worksheet).
  Refresh host evidence if containers, addresses or rules changed; keep running
  image digest, revision and UTC time.

## 5. Corroborate from an independent network

Follow [independent external verification](deployment.md#independent-external-verification)
from an external network outside the VPC.

The [Production network observation workflow](../../.github/workflows/production-network-observation.yml)
(`workflow_dispatch`) probes canonical DNS addresses (up to 4) across 8 fixed TCP
ports (`22, 80, 443, 3000, 5432, 2019, 5555, 8080`) and retains artifacts for 7
days. Note that [`scripts/observe-production-network.mjs`](../../scripts/observe-production-network.mjs)
defaults to `HOST = "pt.shbs.org.cn"` (adjust it for a different domain) and does
not cover undiscovered EIPs, translated ports or trusted-source restrictions.

## 6. Record the worksheet handoff

Store raw exports in private storage; use consistent aliases (`production-eni-1`,
`admin-range-A`) in GitHub. Classify each row per
[effective-policy worksheet](deployment.md#complete-the-effective-policy-worksheet)
(`verified`, `mismatch`, or `unknown`):

| Check | Observation and intended policy | Private evidence & UTC time | Reviewer and result |
| --- | --- | --- | --- |
| Account/region/instance and every ENI | Pending | Pending | Unknown |
| Attached groups and effective IPv4/IPv6 ingress | Pending | Pending | Unknown |
| Fixed public IPs, EIPs and DNS comparison | Pending | Pending | Unknown |
| DNAT, load balancers and alternate paths | Pending | Pending | Unknown |
| IPv6 gateway and public-address status | Pending | Pending | Unknown |
| Network ACLs and other applicable controls | Pending | Pending | Unknown |
| Current host/container/SSH and image identity | Link dated evidence; refresh if changed | Pending | Unknown |
| Independent external results and coverage gaps | Pending | Pending | Unknown |

Assign an owner to every remaining `unknown` or `mismatch`. Any future firewall or
SSH policy change requires its own reviewed procedure and access-recovery plan.

[Deployment runbook](deployment.md) · [Documentation home](../README.md)
