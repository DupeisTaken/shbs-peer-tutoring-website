# Legacy monthly service-hours reports (retired)

> **Retired workflow:** Active monthly overview generation, scheduling, previews
> and email delivery have been replaced by
> [individual school service-hours reporting](school-hours.md). This page
> documents only the retained read-only contract for historical `MonthlyHoursReport`
> snapshots.

## Retained read-only endpoints

Implemented in [monthly-hours.ts](../../src/server/api/routers/monthly-hours.ts)
and [server/monthly-hours.ts](../../src/server/monthly-hours.ts):

- **Available (staff read-only):** `monthlyHours.list` and
  `monthlyHours.downloadCsv` remain available to authorized staff so historical
  saved snapshots and their CSV exports stay inspectable. Participant and Viewer
  roles cannot read saved snapshots or CSVs.
- **Retired (always reject with `PRECONDITION_FAILED`):** `save`, `preview`,
  `generate` and `retry`. Pending historical configuration approvals cannot
  replay generation, and the delivery worker retires unsent legacy overview
  receipts rather than sending them.

## Frozen snapshot and CSV semantics

- Each `MonthlyHoursReport` freezes rows, totals, reporting month (`YYYY-MM`
  UTC bucket), revision, generation time, due time, timezone, configuration
  version and intended audience.
- Aggregation ([service-hours-summary.ts](../../src/server/service-hours-summary.ts))
  counted stored tutoring session credits and adjustments per UTC month (Crew
  hours remained separate). Every tutor with a session or adjustment in that
  bucket was retained, including zero-credit or offset-zero rows, without student
  identifiers, contact details or adjustment reasons.
- Snapshots are immutable historical evidence: do not sum multiple revisions of
  the same month, and use [school-hours.md](school-hours.md) for all current
  reporting, previews and delivery.

See [deployment](../guides/deployment.md#monthly-service-hours-delivery),
[staff usage](../guides/user-guide.md) and the
[technical reference](technical-report.md).
