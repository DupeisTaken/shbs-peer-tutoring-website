# Coordinator training and administrator review

Coordinators are new team members. They can inspect management records, prepare changes, send tutor setup links, and perform their own tutor or crew duties. Admins are experienced members who can apply management changes directly. HEAD retains leadership, admin appointments, account deletion, and module configuration.

## Submitting and reviewing changes

Saving a sensitive change as a coordinator creates an immutable proposal. The editor retains its values and displays “Submitted for admin approval”; the shared notification links to the request. This is not a successful live save. Identical pending submissions against unchanged targets reuse the same request.

Requests cover assignments, schedules, room and subject records, roster and membership changes, meetings, service-hour adjustments, application and disciplinary decisions, policies, announcements, website content, translations, and audit undo. A coordinator chair's final interview decision also requires review. The exact list is `src/lib/approval-policy.ts`. Normal participant attendance and interview votes retain their existing ownership rules.

At `/admin/approvals`, ADMIN and HEAD can filter requests, inspect proposed values and the recorded state of affected records, and approve or reject with a required explanatory note. Coordinators can see and withdraw their own pending requests. Users cannot review their own requests even after promotion. Review results notify the requester and remain in their history.

Approval reruns the original validation and business rules under the reviewing administrator's current privileges. Changed target records, a changed program period, or an inactive requester prevent approval; reject these requests and ask for a fresh proposal. A failed application leaves the request pending. Competing reviewers cannot apply the same request twice. Database mutations, helper writes, notifications and the decision commit in one transaction.

Account role changes, translator assignment, registration-code controls, program timing/refresh, module configuration and account deletion remain restricted to the existing admin/head tiers. Unknown coordinator management writes fail closed until explicitly classified. A coordinator may request a change to their own tutoring participation; changing another person's account access remains restricted.

## Audit history

`/admin/audit` filters by stable user ID, event type (action, proposal, decision, withdrawal), operation, record type, description, and inclusive UTC date range. Filters apply before cursor pagination. Duplicate display names stay separate, and users with historical records remain selectable after account deletion. Request links connect proposals, applied changes, and the reviewer's decision and feedback.

All successful authenticated tRPC mutations add actor and operation metadata, including participant actions. Existing detailed/undo events are retained, so some operations have both a summary and an undo record. Raw request payloads, passwords and tokens are not copied to these summary events. Review metadata and undo payloads are withheld from VIEWER responses. The log describes completed application operations; it is not a browsing/access log and cannot reconstruct actions that were never recorded before this release.

## Development and verification

Apply the new migration using `npm run db:migrate`, regenerate Prisma using `npx prisma generate`, and restart the app. The migration preserves existing logs and defaults historical entries to `ACTION`.

Run `npm run check`, `npm test -- --maxWorkers=1`, and `npm run build`. The approval integration suite refuses to reset any database other than the explicitly named local `shbs_coordinator_approvals_test`. Never point it at a development or production database. UI tests exercise filters and queued-request announcements; database tests cover permissions, scoping, validation, deduplication, concurrent decisions, stale targets, rollback, and actor attribution.

The implementation started at commit `cc6646d` in the isolated `codex/coordinator-approvals` worktree. Uncommitted student/correction workflows in the original checkout are outside this baseline. New management procedures added by a future merge must be classified in the approval policy before coordinators can use them.

## Integrated participant workflows

The allowlist also covers attendance/patrol corrections, subject qualification, interview completion, school calendar, feedback visibility, student appeals, survey assignments, student-review decisions and translation draft decisions. Coordinator direct verification-link resends do not change assignments or deadlines.

Student action tickets are consumed at proposal submission. ADMIN/HEAD uses a new timed confirmation tied to their own account, action and target. SMTP runs after the approval commits; a failed email does not undo an applied decision and is explicitly retryable. Interview votes, qualifications, linked student memberships and translation destinations form part of stale-evidence checks. A coordinator chair remains the final outcome’s author when an administrator approves it.
