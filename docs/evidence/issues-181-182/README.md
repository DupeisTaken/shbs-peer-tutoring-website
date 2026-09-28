# Signup protection verification

Issue #181: 99 targeted unit, UI and PostgreSQL integration tests pass. TypeScript,
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
