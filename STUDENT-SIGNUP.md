# Survey-first student signup and participation

## Student workflow

1. `/signup` opens at the configured time. Students submit their survey, login email, subject preferences, availability, contact details and policy signature without an account. The server saves the submission time and exact policy snapshot.
2. The receipt directs them to email and provides a prominent sign-in button, copyable URL and downloadable PNG QR code. The QR contains only the public sign-in URL, never an account token.
3. The single-use email link opens a read-only survey review. Students create their account there, or confirm with an existing account without changing its password or role. Visiting a link does not consume it, so email scanners cannot complete signup.
4. After confirmation and login, `/student` groups the current request, tutor assignments, availability and participation actions, followed by processed history. Only availability is editable; the original survey evidence remains unchanged. Assigned students coordinate their schedule with their tutors.
5. When policy text changes, the next login into an authenticated page requires a popup containing the current localized policy, a checkbox and a ten-second confirmation delay. Acceptance never changes priority. Student mutations also check the latest policy on the server.

## Priority and verification

- Original submission time determines priority for both verified and unverified requests. Account creation, email resends, availability edits, policy acceptance and rematching never reset it.
- One OPEN request is allowed per normalized email per quarter. Duplicate submissions preserve its original payload and timestamp. A closed request cannot be edited or reopened; a fresh submission receives a new timestamp and student profile while retaining the existing account.
- Admins can assign unverified students and resend their signup link. The first assignment starts a fixed seven-day verification deadline. Reassignment and resends never extend it.
- Account links expire after 24 hours. A successfully delivered resend replaces the link; failed delivery preserves the existing link. Assignment and its deadline remain saved if notification delivery fails, and the admin sees a retry message.
- At the seven-day boundary, an unverified request becomes permanently DISQUALIFIED and all its roster memberships are removed. The student must submit a new request; disqualification alone does not prohibit a fresh same-quarter application.
- The Node server sweeps deadlines on startup and every minute. Workflow entrypoints also enforce deadlines, so no request can be confirmed or assigned after its deadline while awaiting the next sweep. Stored timestamps survive restarts and downtime; multiple app instances serialize transitions through database locks.

## Recall, withdrawal and schedule conflicts

| Action | While pending | Result |
| --- | --- | --- |
| Unassigned student recalls | No review required after timed confirmation | Permanently RECALLED; appears in Processed with a Recalled badge; admins notified. A fresh application is permitted. |
| Assigned student applies to leave the quarter | Existing assignments continue during admin review | Approval permanently ABORTS the request, releases every assignment and blocks new applications for the same email in that quarter. Denial leaves the request and assignments active. Future quarters remain available. |
| Tutor reports schedule mismatch | Assignment continues during admin review | Approval removes only that pairing membership and returns the request for rematching, preserving priority and any verification deadline. Other assignments remain. Denial leaves the pairing intact. |

The withdrawal ban begins on approval, not when an application is submitted. Schedule rejection also supports existing manually managed students. A stale schedule application cannot remove a pairing that now belongs to another tutor. Terminal requests and pending reviews closed with them retain history.

New serious actions use a modal detailing consequences before confirmation: five seconds for recall, withdrawal applications, schedule applications, assignment and review decisions; ten seconds for policy consent. One-use server tickets bind the user, action and target, enforce the delay and expire after 30 minutes. Closing a popup and opening another starts a fresh delay. Cancel remains available; mandatory policy dialogs offer sign-out.

## Management and tutor pages

`/admin/requests` groups work into **Needs matching**, **Assigned**, **Needs review** and **Processed**. Both verification states retain original timestamp order. Cards show contact details, current availability, verification deadline, resend controls and subject assignment controls. Availability changes add an **[Edited]** badge. Processed requests retain their final status; resolved reviews remain available as history. Older manually managed request tools are grouped separately below the board.

Tutor pairing cards group current student availability, verification/edit badges and the schedule conflict application control. Admins and affected participants receive in-app notifications for edits, recalls, applications and decisions. Signup/assignment verification links are emailed; these in-app notifications are not extra outbound emails.

## Data and security

- Request ownership requires a confirmed account linked to that request's student profile; matching names or legacy email alone never grant ownership or tutor privileges.
- A public STUDENT account cannot automatically claim a legacy tutor by email. Existing account roles and explicit tutor links are preserved.
- Student lists are scoped to the authenticated email; admin request details and decisions require management access. Token hashes and policy snapshots are excluded from workflow lists.
- Database triggers protect original submission timestamps and terminal request states, and prevent legacy admin/undo paths from assigning closed or overdue student profiles. All admin assignment entrypoints stamp the first-assignment deadline.
- Email delivery occurs outside transactions. Per-email request locks serialize lifecycle changes across processes; intake/catalog validation uses row locks and policy publication shares a transaction lock with consent capture.
- Policy acceptance retains the exact revision and snapshot. Survey confirmation records the original submitted policy; a newer revision is acknowledged after login, independently of priority.
- Closed request history is retained. No automatic deletion/retention period has been invented. Quarter blocks use normalized login email; they do not attempt to identify one person using different email addresses.
- Suspended users cannot sign in, deleted users lose sessions, and shared-school-IP allowances remain separate from per-identifier sign-in limits.

## Deployment and operations

Apply migrations with `npm run db:migrate`, generate the Prisma client and rebuild. This branch starts from `cc6646d`, independently of the other task's uncommitted student/bootstrap work; reconcile overlapping changes before merging.

Configure an externally reachable HTTPS `AUTH_URL`, `EMAIL_FROM` and SMTP credentials. Production refuses new surveys without configured email delivery. Development without SMTP logs links locally. Publish the English and Chinese tutee policies, active subjects/time slots and active quarter before opening signup. EN/ZH new UI copy is supplied; other configured locales use English fallback for new messages.

The Docker runtime includes `prisma.config.ts` and the migration CLI's complete production dependency tree. Prisma is a production dependency because the entrypoint applies migrations. Local environment files and audit artifacts are excluded from the build context. Deploy as the existing persistent Node server so the deadline worker runs continuously; database catch-up still occurs after a restart. Monitor `[student-deadlines]` error logs and application health.

The partial unique OPEN-request index and history/roster triggers are SQL migrations and must be retained when changing the schema. Do not substitute `db push` for deployment migrations.

## Verification

The integration suite refuses to reset any database except a loopback database named `shbs_survey_first_test`. Use this isolated database with migrations applied for `npm test`; never use a shared database.

GitHub Actions provisions this same disposable database name for its PostgreSQL service, health check and connection URL. Keep these aligned with the suite's safety guard when updating CI.

Tests cover signup timing, duplicate handling, original priority, email recovery, read-only token inspection, concurrent confirmation/resends, account isolation, policy changes, assignment/deadline boundaries, irreversible disqualification and fresh resubmission, availability-only editing, recall notifications, quarter withdrawal restrictions, selective schedule rejection, legacy roster editors, role scoping, confirmation delays/replay, and actual QR PNG decoding. See [SIGNUP-AUDIT.md](SIGNUP-AUDIT.md) for verification results and remaining deployment checks.
