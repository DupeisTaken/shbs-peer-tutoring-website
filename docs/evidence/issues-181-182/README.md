# Signup protection verification

Issue #181: 103 targeted unit, UI and PostgreSQL integration tests pass. TypeScript,
changed-file ESLint and documentation checks pass. The HTTP rejection envelope was
also checked with the application's streaming tRPC client.

Screenshots use the full local application with synthetic form data and a mocked
429 response (no real mail). English desktop is 1280 px; Chinese mobile is 390 px.
The rendered submit/resend controls are 40 px and 44 px respectively, with no
horizontal overflow. Entered values remain present after rejection.

- [Viewer desktop](signup-retry-en-1280.png)
- [Viewer mobile](signup-retry-zh-390.png)
- [Tutee resend desktop](tutee-retry-en-1280.png)
- [Tutee resend mobile](tutee-retry-zh-390.png)

## Optional CAPTCHA (#182)

The combined branch passes 141 targeted unit, UI and PostgreSQL integration tests,
including real SDK construction with mocked transport. TypeScript, changed-file
ESLint and documentation checks pass. No real email or paid CAPTCHA calls were made.

The full local application was checked serially in headless Edge at 1280 px
(English) and 390 px (Chinese). Management on/off changes use the real local API;
the switch target measures 46 px. Read-only users see no switch. Missing-readiness
screens use a response fixture; server configuration rejection is separately tested.
Public loading/script failures use a blocked SDK request, and rejected/unavailable
screens use a stub widget and API error. These demonstrate application UI, not the
provider's live challenge or mainland connectivity. Inputs remain intact, retry
controls are at least 44 px, and no horizontal overflow was found.

| State | Desktop / English | Mobile / Chinese |
| --- | --- | --- |
| Management off | [Screenshot](captcha-off-en-1280.png) | [Screenshot](captcha-off-zh-390.png) |
| Management on | [Screenshot](captcha-on-en-1280.png) | [Screenshot](captcha-on-zh-390.png) |
| Configuration missing | [Screenshot](captcha-notready-en-1280.png) | [Screenshot](captcha-notready-zh-390.png) |
| Read-only management | [Screenshot](captcha-readonly-en-1280.png) | [Screenshot](captcha-readonly-zh-390.png) |
| Loading | [Screenshot](captcha-script-loading-en-1280.png) | [Screenshot](captcha-script-loading-zh-390.png) |
| Script failure / retry | [Screenshot](captcha-script-error-en-1280.png) | [Screenshot](captcha-script-error-zh-390.png) |
| Provider rejection | [Screenshot](captcha-rejected-error-en-1280.png) | [Screenshot](captcha-rejected-error-zh-390.png) |
| Provider unavailable | [Screenshot](captcha-unavailable-error-en-1280.png) | [Screenshot](captcha-unavailable-error-zh-390.png) |
| Tutee resend failure | [Screenshot](captcha-tutee-error-en-1280.png) | [Screenshot](captcha-tutee-error-zh-390.png) |

See the [rollout guide](../../captcha.md) for the bounded real mainland/school-network
smoke check required after separate service activation.


