# Technical report

This report describes the integrated website, its implementation boundaries and the evidence needed to operate it. For instructions based on visible controls, use the [role-based user guide](user-guide.md).

## Contents

- [Release baseline and scope](#release-baseline-and-scope)
- [Architecture](#architecture)
- [Identity and authorization](#identity-and-authorization)
- [Approval transactions](#approval-transactions)
- [Student lifecycle and ownership](#student-lifecycle-and-ownership)
- [Attendance, hours and discipline](#attendance-hours-and-discipline)
- [Policy documents and translations](#policy-documents-and-translations)
- [Data and deployment](#data-and-deployment)
- [Validation and development](#validation-and-development)
- [Maintaining the documentation](#maintaining-the-documentation)
- [Launch boundaries](#launch-boundaries)

## Release baseline and scope

[PR #9](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/9) integrated PRs #6–#8 and merged into main as [6056f6e](https://github.com/DupeisTaken/shbs-peer-tutoring-website/commit/6056f6e94b7ebe7c1afa7c85fe9ad945eb625e64). Its reviewed head was `40427dab3127`. [Exact-head CI](https://github.com/DupeisTaken/shbs-peer-tutoring-website/actions/runs/34360324221) passed 283 tests in 33 files, static checks, the full dependency audit, a production build and image boot/restart checks. This is a dated baseline, not a claim that every later commit has the same test count.

| Area | Implemented behavior | Operational boundary |
| --- | --- | --- |
| Student intake | Survey-first priority, email confirmation, matching, withdrawal, deadline enforcement | Real email and current intake configuration are required |
| Participant records | Unified student portal, feedback, appeals, private messages, historical ownership | Access follows account identity and current authorization |
| Management | Reviewed coordinator changes, direct authorized administrator changes, auditable corrections | Unknown coordinator management writes are blocked |
| Hours and interviews | Attendance-derived hours, semester meeting allowance, qualified panels, actual interview completion credit | Published policy must match the confirmed rules |
| Deployment | Standalone image, migration entrypoint, seed-free bootstrap, restart worker | Target-host TLS, persistence and restored backups need operational verification |
| Documentation | Technical/user reports, policy sources, issue forms, reproducible HTML reports | Repository revisions do not publish database policy records |

## Architecture

The website is a long-running **Next.js 16 / React 19** application using **tRPC 11**, **Prisma 7** with the PostgreSQL adapter, **Auth.js** JWT sessions, **next-intl** and **Tailwind CSS 4**. The supported release path is a Node server in the [Docker image](../Dockerfile), not a static export.

| Component | Responsibility |
| --- | --- |
| [App routes](../src/app) | Public, student, tutor, crew and management interfaces |
| [API root](../src/server/api/root.ts) and [procedure middleware](../src/server/api/trpc.ts) | Typed router composition, current authorization, management review interception and action audit |
| [Database client](../src/server/db.ts) and [transaction helpers](../src/server/transactions.ts) | PostgreSQL access and shared domain transaction boundaries |
| [Approval policy](../src/lib/approval-policy.ts), [proposal handling](../src/server/approvals.ts), [approval router](../src/server/api/routers/approval.ts) | Allowlisted operations, evidence snapshots and atomic replay |
| [Student survey](../src/server/student-survey.ts), [workflow](../src/server/student-workflow.ts), [ownership](../src/server/student-ownership.ts) | Priority, verification, participation and retained account links |
| [Policy acceptance](../src/server/policy-acceptance.ts) | Content-derived revisions and immutable acceptance evidence |
| [Corrections](../src/server/api/routers/corrections.ts) | Historical attendance/patrol corrections with related effects and evidence |
| [Email sender](../src/server/email/sender.ts) | Transactional SMTP delivery and development-only message capture |
| [Instrumentation](../src/instrumentation.ts) and [deadline worker](../src/server/student-deadline-worker.ts) | Node-only startup and periodic deadline sweeps |
| [Prisma schema](../prisma/schema.prisma) and [migrations](../prisma/migrations) | Persistent application schema and upgrade history |

Server-side validation is authoritative. Client-side controls, disabled buttons and role-specific navigation improve usability but do not replace API authorization.

## Identity and authorization

Accounts have one primary role: `STUDENT`, `TUTOR`, `CREW`, `COORDINATOR`, `ADMIN`, `HEAD` or `VIEWER`. Tutor linkage, crew membership and translator assignment are additional capabilities. Do not flatten these into a single rank comparison: an administrator without an active tutor profile cannot automatically act as an interview panelist.

Protected requests reload the account’s current role, linkage and suspension state. A stale JWT cannot retain a revoked role. Student ownership is based on stable account/profile links, not a matching name or email. Public student/viewer signup cannot claim a legacy tutor profile merely by matching its email; see [tutor linking](../src/server/auth/tutor-link.ts).

| Procedure family | Intended callers |
| --- | --- |
| `publicProcedure` | Public operations; each operation still validates its inputs and relevant gates |
| `protectedProcedure` | Authenticated, currently authorized account operations |
| `tutorProcedure` / `activeTutorProcedure` | Linked tutor access / active tutor duties |
| `crewProcedure` | Permitted active crew or management access with the crew module enabled |
| `adminProcedure` | Management; sensitive coordinator mutations are intercepted for review |
| `adminOnlyProcedure` | ADMIN or HEAD |
| `headProcedure` | HEAD-only configuration and leadership powers |
| `viewerProcedure` | Permitted management reads, including masked VIEWER responses |
| `translatorProcedure` | Assigned translators or management; publication rules still apply |

The user-facing implications are in [role access](user-guide.md#before-you-start). Private messages remain scoped to their two participants, including against other management accounts. Feedback defaults to staff-only and can be shared with the session’s tutor through a management setting.

## Approval transactions

The [explicit operation map](../src/lib/approval-policy.ts) classifies management writes. A coordinator’s sensitive mutation creates an immutable proposal and an approval notice instead of applying the resolver. Unknown management operations fail closed. Normal owned attendance, crew duties and interview votes retain their participant permissions; supported link resends do not extend verification deadlines.

1. Parse the original input, capture affected records and the active period, and calculate a fingerprint.
2. For ticketed student actions, consume the coordinator’s own confirmation when queuing the proposal.
3. At review, recheck reviewer and requester status, prevent self-review, and compare current evidence with the proposal fingerprint.
4. Reuse the original parser and resolver under the reviewer’s current privileges. Ticketed student actions require a fresh reviewer ticket.
5. Commit the domain change, approval state, related notifications and decision audit together. Competing decisions cannot apply the same proposal twice.
6. Send assignment email after the durable decision commits. A delivery failure is returned as retryable; it does not roll back a successful assignment.

[Async-local database scope](../src/server/db-scope.ts) keeps legacy helpers that import the shared database inside the decision transaction. New helpers must compose with that transaction; constructing an independent client would escape rollback. Do not perform irreversible external side effects during replay.

Interview review preserves the original coordinator chair’s proposed result and identity. Current panel membership, qualifications and all votes are validated again. The actual reviewer is attributed separately in the approval audit.

Successful authenticated mutations add actor and operation audit metadata. Detailed events and undo records remain available where implemented. This is an application action log, not an access log; it does not reconstruct events predating the release. Generic direct-mutation audit summaries are not a promise that every direct operation and audit insert share one universal transaction. The explicit approval/correction transaction contracts are covered by regressions.

## Student lifecycle and ownership

The first open survey’s `submittedAt` sets priority. Confirmation creates or links one account while retaining an existing role and password. First assignment sets a fixed seven-day verification deadline; resends and reassignment do not extend it. Token expiry and verification deadline are separate: an account link lasts 24 hours, while an assigned request has its fixed deadline.

| Transition | Persistent effect |
| --- | --- |
| Submit survey | Store choices, signature, policy snapshot and original priority |
| Confirm email link | Consume the challenge, materialize/link the student profile and retain ownership |
| Edit availability | Preserve subjects, priority and current assignment |
| Recall unassigned request | Close that request permanently; a later request gets a new identity and priority |
| Approve withdrawal | Close the request, release all assignments and block the account/email for that intake |
| Approve schedule rejection | Remove only the affected assignment and return the request to matching |
| Expire unverified assignment | Disqualify permanently and release assignments without changing original evidence |

[StudentProfileOwnership](../src/server/student-ownership.ts) retains old profiles when the current-intake pointer changes. The migration backfills explicit existing links only; it does not guess ownership from names or email. Feedback, appeals and historical attendance use all owned profiles. Quarter blocks follow stable account identity after verified email changes.

Deadlines are stored in PostgreSQL. A lightweight Node worker checks at startup and once a minute, and workflow access also checks expiry. Downtime never grants an extension. Database locks make multiple worker instances safe; the timer is not the source of truth.

## Attendance, hours and discipline

Attendance calculates server-side duration, multiplier and hours through [service-hour functions](../src/lib/service-hours.ts). **The existing custom session rounding is deliberately retained**, as confirmed on 9 September 2026: 35 minutes becomes 1 hour, 70 becomes 1 hour, and 71 becomes 1.5 hours before multiplication. It is not ordinary nearest-half-hour rounding. [Policy examples](../prisma/policies/tutor-policy.en.md#service-hours) explain the exact rule and zero-credit cases.

Completed interviews use `durationMin / 60` for recorded attendees in [Interview Management](../src/server/api/routers/interview-management.ts). Scheduling earns no credit. The legacy rounded interview helper remains covered for compatibility; it is not the live management completion rule.

Meeting deductions are separate from session earnings: Q1+Q2 and Q3+Q4 define semesters within each school year. The first three unexcused meeting absences incur no automatic deduction; later ones deduct 0.25 hours each. Excused meetings do not count. [Meeting reconciliation](../src/server/meeting-hours.ts) and the upgrade migration preserve manual adjustments.

[Disciplinary standing](../src/lib/discipline.ts) counts valid cards only: every three yellow cards add one effective red; two effective reds reach the removal threshold. Tutor-requested cards wait for review; attendance can create automatic valid cards. Appeals use five school days with [school-calendar overrides](../src/server/api/routers/student.ts). Do not describe pending appeals as automatically invalidating a card.

Historical corrections run related changes together, preserve reasons and snapshots, and notify HEAD. Room-allocation triggers reject overlapping planned bookings, including concurrent writes. Time ranges are half-open, so back-to-back bookings are allowed. Historical attendance can record an actual conflict with warnings and management notification.

## Policy documents and translations

[Current repository policies](policies/README.md) are versioned English/Chinese sources used by the development seed. [Older translations](archive/policies-2025/README.md) are archived so seeding cannot silently pair revised rules with obsolete text. Missing current translations fall back to English.

The running site reads `PolicyDocument` rows, not Markdown files on each request. Administrators publish reviewed content through Policies; coordinator publication requires approval. **No migration in this documentation update overwrites a live school policy.** Follow [publication steps](policies/README.md#publish-a-revision) to archive changes, update every published language and exercise renewed consent.

The policy editor supports a seed-free installation: staff see blank student/tutor editors when either policy is missing and can save through the existing authorized mutation. It waits for fetched content before mounting editors so an initial blank state cannot conceal saved text. Read-only viewers receive no creation controls. This fixes the former empty page that incorrectly directed operators to run the demo seed.

Policy revisions derive from the published language set and content. Acceptance retains the exact revision, text snapshot, signature and time. A changed policy gates tutor attendance and student participation, while personal history, feedback, appeals, account settings and private messages remain accessible.

UI/website translation drafts have their own approval process and stale-destination checks. Translator assignment does not grant structural editing or policy publication privileges.

## Data and deployment

Follow the [local setup guide](../README-LOCAL.md) or [production runbook](../README-DEPLOY.md). Apply the committed migrations with `npm run db:migrate`; do not substitute `db push` for a production upgrade. The integrated baseline contains 21 migrations, including shared student prerequisites, meeting deduction repair, coordinator approvals and historical student ownership.

Production starts with an empty database and the seed-free admin bootstrap. Repeating bootstrap preserves the singleton HEAD and active period. **The development seed contains synthetic people and is not a production installation procedure.**

The image ships the complete production dependency graph, including Prisma’s migration CLI and bootstrap runtime. Its entrypoint migrates before starting the standalone server. Deployment uses PostgreSQL persistence, persistent uploads and a reverse proxy/TLS configuration. The exact host/domain and SMTP credentials are operator configuration, not repository constants.

SMTP uses a bounded reusable Nodemailer transport. Development can intentionally capture messages in logs; security-sensitive production flows require configured delivery. Do not use an application health response as evidence that signup email reached a real inbox.

## Validation and development

Use Node 22 for consistency with CI. Current application source is also checked locally on Windows with Node 24. Tests that truncate PostgreSQL data accept only explicitly named isolated local test databases; the combined suite uses `shbs_shipping_test`. Use a disposable database and never copy a production URL into these commands.

```bash
npm ci
npm run db:migrate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm run check
npm run docs:check
npm test -- --maxWorkers=1
npm audit
npm run build
```

Set `DATABASE_URL` to the isolated test database and supply a local `AUTH_SECRET` first. Detailed environment setup and Windows commands are in [README-LOCAL.md](../README-LOCAL.md).

The [CI workflow](../.github/workflows/docker-build.yml) checks clean dependency installation, migrations/schema agreement, lint/types, documentation contracts, full dependency audit, tests, production build and runnable-image acceptance. [The image smoke test](../scripts/smoke-image.sh) boots an empty database, runs bootstrap twice, checks sign-in, restarts with an overdue assignment, and verifies deadline cleanup without a browser mutation. PR validation does not publish an image; main-branch validation can publish to GHCR. Publishing an image does not deploy a host.

For local investigation, run one dev server and one browser at a time. A bounded example is `next dev --webpack --hostname 127.0.0.1 --port 3109` with a 2 GB Node heap. Stop that owned process before starting a production build. Avoid killing unrelated Node processes or starting Docker Desktop just to duplicate CI’s image check.

## Maintaining the documentation

Edit [this technical source](technical-report.md), the [user guide](user-guide.md) and the [policy sources](policies/README.md). Keep the root README short and use hyperlinks to specialist explanations rather than copying paragraphs into several documents.

```bash
npm run docs:build
npm run docs:check
```

The builder generates printable HTML editions from Markdown with shared styling and a contents sidebar. It uses local assets only. The check validates relative files and heading anchors, required role coverage, generated-report freshness, current policy sources and GitHub issue-form structure. Generated HTML lives in `docs/reports/`; commit it with its source so readers can download it without running the application.

Verify report layout at desktop and mobile widths and check the contents links, tables and print control. For changes to policy loading or application behavior, run the relevant tests and required CI gates too. Reporting instructions and the three guided forms are in [Creating issues](issues.md).

## Launch boundaries

The integrated application and its image acceptance tests are complete. No deployment was authorized or performed during this documentation task. Before opening real intake, the operator still needs:

1. A canonical HTTPS domain and host with persistent database/uploads.
2. Real SMTP delivery tested for signup, password recovery and verified email changes.
3. Published school-approved policy versions and reviewed translations; final school-specific landing content.
4. Actual intake timing, subjects, slots, rooms, qualifications, calendar overrides and feedback settings.
5. A backup restored into a separate database and target-host restart/TLS verification.

These are concrete operational prerequisites, not evidence obtainable from a local screenshot or a clean dependency audit. See [the deployment runbook](../README-DEPLOY.md) and [release verification record](../SHIPPING-READINESS.md).

[Documentation home](README.md) · [User guide](user-guide.md) · [Creating issues](issues.md)
