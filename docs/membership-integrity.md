# Membership request integrity

[Documentation](README.md) · [Role guide](user-guide.md#tutors) · [Implementation](../src/server/membership.ts)

Tutor and crew opt-out/reentry requests now share a transaction boundary for submission, recall and staff review. Previously, two submissions could both pass the pending-request check, and a recall or second reviewer could overwrite an already-decided request. Crew decisions also updated membership separately from the request.

The shared helper locks the member, reads their current status, and changes only a pending request. A decision commits its membership change, notification and audit record together. Failure rolls everything back. The same helper composes with coordinator approval transactions. A stale request cannot override a subsequent manual archive or membership change; staff can decline it and review the current roster.

The seven-day cooldown and existing explicit student requeue action are preserved. An opted-out tutor's assigned students still need staff to use the requeue action on the tutor-request page.

## Existing data and constraints

No migration silently resolves old duplicate requests or blocks installation. Supported API submissions are serialized, so they cannot create new duplicates. Older duplicate requests remain visible for staff review. After one is approved, another cannot repeat that membership transition; staff can decline obsolete copies.

An operator can inspect existing duplicates with these read-only queries:

```sql
SELECT "tutorId", count(*)
FROM "TutorStatusRequest" WHERE state = 'PENDING'
GROUP BY "tutorId" HAVING count(*) > 1;

SELECT "userId", count(*)
FROM "CrewStatusRequest" WHERE state = 'PENDING'
GROUP BY "userId" HAVING count(*) > 1;
```

A partial unique index for pending requests is a useful future database safeguard after those rows are reviewed. It must be introduced with an explicit cleanup decision and a tested migration, because database-only imports bypass application locks. Do not delete request history to make an index succeed.

## Verification

[Integration regressions](../src/server/api/routers/workflows.test.ts) exercise simultaneous submissions, recall-versus-approval, competing reviewers, audit-failure rollback and requests that outlive a manual status change for both membership types. Run against an isolated local test database, serially, as described in [local setup](../README-LOCAL.md).
