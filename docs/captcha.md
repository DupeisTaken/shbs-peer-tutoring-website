# Optional Aliyun CAPTCHA for public signup

## Architecture decision

Use **Web/H5 V2**, `VerifyIntelligentCaptcha`, mainland client region `cn`, and
the fixed HTTPS endpoint `captcha.cn-shanghai.aliyuncs.com` (`cn-shanghai`).
V3 and invisible verification are not supported by this adapter. Create at most
two ordinary Web/H5 scenes: one tutee scene, one viewer scene. Crew application and
status mail reuse the tutee scene with separate action-bound grants. Choose a supported
interactive challenge in Aliyun; do not enable paid custom policies by default.

V2 places the billable verification call on the business server. That makes local
budgets useful for calls this application initiates; V3 instead bills client risk
checks, including possible additional invisible checks. Neither design guarantees
a hard provider-bill cap against direct abuse of a public scene or other callers.
This implementation does not activate a service, buy a resource pack or modify a
provider account. Verify the actual account storefront before activation.

The browser sends opaque V2 proof unchanged to `program.verifySignupCaptcha`.
Cheap validation and [signup admission](signup-protection.md) precede any provider call. The server selects
the expected scene, claims a keyed hash of its certify ID, and uses the official
Aliyun SDK with retries disabled, 2-second connect and 3-second read timeouts.
Only a normal T001 result is accepted. Test-pass T005 is rejected, even locally.
Aliyun rejects expired/replayed evidence; our durable 24-hour replay ledger also
prevents concurrent reuse and alternate JSON encodings. Expired rows are pruned in
batches of 100. Raw proof, device data and credentials are never stored or logged
by the application.

Acceptance produces an opaque **two-minute, single-use server grant**, stored only
as a keyed hash, bound to normalized email, scene, action and setting version.
Tutee submit (including `requestSignup`), tutee resend, viewer start/resend and Crew application/status mail
consume that grant atomically before pending-record writes, token rotation or mail.
Business failure consumes it too. There is no reusable `captchaPassed` flag.
Verification reserves signup mail capacity once; consuming its grant does not double
charge admission. A separate send-time cooldown prevents banking grants for a later burst. Already-issued email confirmation and account completion need
no CAPTCHA and keep independent abuse controls.

The typed provider interface is in `src/server/captcha/provider.ts`. Provider SDK
types stay in the Aliyun adapter. Another provider must implement normalized
accepted/rejected/unavailable outcomes and its own public widget adapter; adding
an environment value alone never enables an unreviewed provider.

## Configuration and operator switch

Apply migrations before deployment. New and existing deployments default **off**.
Set these server-side deployment secrets/settings (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `CAPTCHA_PROVIDER=aliyun-v2` | Supported adapter |
| `ALIYUN_CAPTCHA_REGION=cn-shanghai` | Only supported server region |
| `ALIYUN_CAPTCHA_PREFIX` | Public identity prefix from the console |
| `ALIYUN_CAPTCHA_TUTEE_SCENE` | Public tutee scene ID |
| `ALIYUN_CAPTCHA_VIEWER_SCENE` | Distinct public viewer scene ID |
| `ALIYUN_CAPTCHA_ACCESS_KEY_ID` | Dedicated RAM identity credential |
| `ALIYUN_CAPTCHA_ACCESS_KEY_SECRET` | Server-only secret |
| `ALIYUN_CAPTCHA_SECURITY_TOKEN` | Optional STS session token; refresh rotated credentials through deployment |
| `CAPTCHA_BUDGET_15_MIN=300` | Maximum verification reservations per 15-minute window starting at first reservation |
| `CAPTCHA_BUDGET_DAY=1000` | Maximum reservations per 24-hour window starting at first reservation |
| `CAPTCHA_CONCURRENCY=4` | Durable concurrent provider slots (1–8), no queue |

Use a dedicated RAM user or role-issued STS credentials, never a root-account
AccessKey. Aliyun's current integration guide specifies `AliyunYundunAFSFullAccess`;
review an appropriate reduced permission policy with your operator if supported.
No credentials enter browser configuration or the management status response.
This adapter uses explicit credentials; it does not automatically discover an ECS
role or refresh STS credentials. Rotate secrets/restart through normal deployment.

In **Management → Program & Refresh → CAPTCHA Verification**, Head applies
enable/disable changes; Admin submits them for Head review. Coordinators can read
status but cannot propose changes. Enabling validates local configuration; readiness is **not** an
external health check. Disabling never contacts Aliyun. Version comparisons reject
stale concurrent updates, including off/on/off changes. Audit entries include the
actor, time, prior and new values. Period refresh preserves this independent setting.

Each protected mutation reads current database state. Open forms poll every 15
seconds and refresh before submission. Changes preserve entered values; enabling
requires a fresh proof, while disabling removes active widgets when settings
refresh. Script loading is deduplicated and starts only on explicit submission
when enforcement is enabled. Widget cleanup calls the provider destroy method
when available. Already-loaded provider code/requests cannot be revoked or unbilled.

## Outages and cost controls

Rejections, script-load failures, provider unavailability and application errors
have separate translated messages. Users retry explicitly, with the signup cooldown
still active. During an outage, Head can turn the switch off in the portal;
signup rate limits/email budgets remain enforced. This intentionally **fails closed**
for unauthenticated mail-producing operations, unlike Aliyun's general suggestion
to allow requests on transport errors. Sign-in and existing emailed proof remain
available under their existing controls.

The budgets are durable and atomic across processes. Reservations include attempts
that fail before transport, so they conservatively bound application calls. Logs
aggregate fixed `captcha-accepted`, `captcha-rejected`, `captcha-unavailable` and
`captcha-budget` events without participant identifiers. Alert on these categories
using the deployment's log collector; configure thresholds with the budget variables.
Budget exhaustion is visible to users and logged at most once per minute.

Check the account's current [China-site](https://help.aliyun.com/zh/captcha/captcha2-0/billing)
or [international billing](https://www.alibabacloud.com/help/en/captcha/captcha2-0/billing)
terms before activation, including scene/policy fees and usage beyond a resource pack.
Application reservation limits are not a provider bill cap; estimate volume from
expected monthly use as well as peak demand.

Before enabling, configure account billing alerts and investigate current
provider-side restrictions. URL, IP/device policies may be paid custom features
and may block shared school networks; evaluate rather than enabling blindly.
The application switch does not deactivate those features, pay-as-you-go billing
or a public scene, and cannot meter calls made directly to Aliyun. Disabling/deleting
scenes and managing provider billing are separate operator actions.

## Browser, privacy and rollout

The dynamically loaded V2 script is
`https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js`. Do not mirror
or self-host it. Caddy enforces framing/object/base restrictions and supplies a
resource CSP in report-only mode; see [browser response policy](deployment.md#browser-response-policy-and-rollout).
The report-only policy lists the main script origin but does not block additional
resources. Before enforcing resource restrictions, inventory Aliyun's required
script/frame/connect/image origins in a bounded real session. The script processes device/network/interaction
signals in mainland China; the English/Chinese public privacy notice describes it.

Automated tests mock Aliyun and send no paid requests. They cover config errors,
denial/outage/malformed responses, test-mode refusal, server enforcement, single-use
action/email binding, concurrent replay, budgets, stale settings and open-form UI.
[Verification evidence](evidence/issues-181-182/README.md) shows management and signup
states at desktop/mobile widths. Mocks cannot
prove provider connectivity, challenge keyboard support or mainland accessibility.

After separately activating the service, perform a bounded operator smoke check:
one tutee and one viewer signup/resend using test mailboxes on the target school
network, desktop and mobile; confirm keyboard navigation/focus, support fallback,
provider region/scene mapping, email delivery, and billed call count. Stop and
disable the switch on failure. Do not run a production flood test. Review the
privacy notice and Aliyun account settings before enabling real participant use.

## Provider references

- [Server integration and replay outcomes](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/server-access)
- [Web/H5 V2 client integration](https://help.aliyun.com/zh/captcha/web-and-h5-client-v2-architecture-access)
- [China-site billing](https://help.aliyun.com/zh/captcha/captcha2-0/billing)
- [International billing](https://www.alibabacloud.com/help/en/captcha/captcha2-0/billing)
