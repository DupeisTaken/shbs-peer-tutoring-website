# Program time zone

Head and Administrator accounts can change the IANA time zone in **Program & Refresh → Program time zone**. Coordinators can read the setting. The default is `Asia/Shanghai`; no environment or host operating-system changes are needed.

The preview shows the same moment in the current and proposed zones. Review the effect and tick the confirmation before saving. A stale editor cannot overwrite a more recent change; reload it first.

- Weekly slots retain their local clock values: a 15:30 slot remains 15:30.
- Existing appointment, event and saved deadline timestamps are not rewritten. Their displayed times follow the chosen zone.
- Calendar-only attendance dates retain their day; they are not treated as midnight appointments that move to another day.
- New attendance date validation, school-calendar appeal deadline calculations, crew observation matching and datetime inputs use the configured school zone.
- Existing service-hour totals are not recalculated by changing the zone.
- A date/time input during a skipped or repeated daylight-saving hour is rejected with an explanation. Pick an unambiguous time instead of relying on an implicit browser choice.

The program setting is shared with server and client internationalization. Reload already-open pages to receive a change made by another staff member. The saving page refreshes its own context automatically. Each actual change records the previous and new zones in the audit log.

## Verification

Pure conversion tests run without a database:

```sh
npm test -- --maxWorkers=1 src/lib/program-time.test.ts
```

Authorization, stale-update, timestamp-preservation and school-day deadline regression tests are in `src/server/api/routers/program-timezone.test.ts`. They require an isolated local `shbs_shipping_test` database with current migrations and clear its test fixtures. Never run them against development-site data.
