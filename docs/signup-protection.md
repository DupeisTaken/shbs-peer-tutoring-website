# Public signup protection

Tutee submit (including `requestSignup`) and resend, plus viewer start/resend, use
the same mail admission lane. Confirmation, inspection and viewer verification /
completion have a separate lane; exhausting signup mail does not consume their
capacity. Existing-account sign-in and password recovery are outside these quotas.
Recruitment windows and the viewer feature switch still apply. This is application
abuse mitigation, not protection against a saturated network or volumetric DDoS.

## Defaults and tuning

Each admitted operation consumes one count in each applicable quota, even if later
business validation or delivery fails. Limits are fixed windows starting with the
first admission, not monthly traffic estimates. Values below cover both audiences.

| Environment variable | Default | Counts / window |
| --- | --- | --- |
| `SIGNUP_MAIL_GLOBAL` | 400 | Submit / resend attempts per 15 minutes, all networks |
| `SIGNUP_MAIL_NETWORK` | 300 | Submit / resend attempts per 15 minutes, one network |
| `SIGNUP_COMPLETE_GLOBAL` | 2000 | Confirmation / inspection / viewer verify / complete per 15 minutes |
| `SIGNUP_COMPLETE_NETWORK` | 1200 | Same, one network |
| `SIGNUP_READ_GLOBAL` | 6000 | Public tutee options and policy reads per 15 minutes |
| `SIGNUP_READ_NETWORK` | 3000 | Same, one network |
| `SIGNUP_RESEND_SECONDS` | 60 | Minimum interval between mail-producing attempts for one normalized email |

Mail also allows six attempts per normalized email per 15 minutes; completion
allows 20 per email/token. A school can register 100 people with headroom for
multi-step flows and ordinary retries. These numbers are emergency ceilings, not
availability guarantees: an attacker can intentionally exhaust a global budget.
Tune using actual admissions and legitimate peak demand. Invalid overrides fail
closed. Restart the application after changing environment limits.

Before sessions or JSON parsing, HTTP requests allow at most 20 tRPC operations,
32 KiB bodies for batches containing protected routes, a 32 KiB query string, and
a five-second body deadline. Other API bodies allow 32 MiB to retain existing
record-transfer capacity. A process accepts at most 32 concurrent HTTP requests.
Each public operation in a batch counts separately, including malformed input.
Three independent memory burst stores permit 240 operations/network/minute and
600 globally/minute, with at most 2048 keys each; unknown keys fail closed at
capacity. Router admissions also count against these burst stores. Shared legacy
in-memory limits now have a 10,000-key hard cap. Bursts reset on restart.

## Durability and concurrency

Run database migrations before starting this version. PostgreSQL `SignupQuota`
counters and `SignupLease` reservations survive process restarts and coordinate
replicas. A short admission transaction commits before business work, so rejected
transactions cannot reset attempts. Global admission precedes identity insertion;
each admission prunes at most 100 expired counters and leases using indexed quota
expiry. No participant/survey/challenge records are deleted by quota cleanup.
Idle expired counters remain until the next admission; storage does not grow while idle.

Eight durable work slots per lane and one slot per active email bound concurrent
signup work without a queue. Slots expire after 120 seconds for crash recovery and
are released on completion/failure. Signup SMTP uses separate connections with a
30-second overall deadline. Recovery/sign-in mail retains its independent pool.
Public concurrent retries cannot rotate tokens or send duplicate mail. SMTP cannot
provide exactly-once delivery after a crash or an ambiguous transport timeout;
retry after the cooldown. Failed tutee mail retains the original timestamp and
place; failed viewer resends restore the previous challenge using a conditional write.

## Trusted network boundary

Set `SIGNUP_TRUST_PROXY=true` only with the included Caddy configuration and an
application port reachable solely by that proxy. Compose sets it for this private
network. Caddy overwrites `X-Signup-Client-IP` with the direct connection address;
signup ignores caller-supplied `X-Forwarded-For` / `X-Real-IP`. Without explicit
trust, or with a malformed/missing value or chain, clients share `unknown`.
IPv4-mapped IPv6 shares the IPv4 bucket; IPv6 uses a canonical /64. A new upstream
proxy requires a reviewed trust configuration; do not blindly trust forwarded chains.

## Operations and verification

Throttles return translated retry guidance. tRPC errors carry `retryAfterSeconds`;
HTTP admission failures include `Retry-After`. Keep form values and retry explicitly.
Logs aggregate fixed event categories at most once per minute, without submitted
addresses, credentials or tokens. SMTP production delivery logs omit recipients.
Development's existing unconfigured mail logger is local-only and still prints
verification mail for development; never use it for participant traffic.

If budgets are repeatedly exhausted, inspect aggregate `signup` events, SMTP
availability and configured limits. Use the existing tutee recruitment/viewer
availability controls for an operational pause. Keep confirmation capacity enabled.
No CAPTCHA or paid service is needed for these protections.

Automated tests use an isolated local PostgreSQL database and mocked email. They
exercise the final allowance concurrently through separate clients and a reconnect,
failed transactions, cooldowns, leases, failed SMTP, and 100 mixed full registrations
over a simulated 800 seconds from one school network (including reads and wrong-code
retries). Existing expiry, replay, priority and account-linking regressions also run.
This is functional acceptance testing, not a production flood test or upstream
network-capacity guarantee.

[Desktop and mobile verification evidence](evidence/issues-181-182/README.md).
