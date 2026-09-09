# Demonstration database

[User workflows](user-guide.md) · [Technical report](technical-report.md) · [Local setup](../README-LOCAL.md)

The seed contains synthetic data and shared demonstration passwords. It is a disposable rehearsal environment, never a production bootstrap. Use `admin:create` for a real initial administrator. The seed now rejects production mode, remote database hosts, unacknowledged execution and database names outside `shbs_*_demo` / `shbs_*_test`.

## Create and verify

Create a **fresh** local PostgreSQL database named `shbs_program_demo`, set `DATABASE_URL` to it, and set `SHBS_DEMO_SEED=1` in the command's environment. Run:

```sh
npm run db:migrate
npm run db:seed
npm run db:seed
npx tsx prisma/verify-demo.ts
```

The second run checks repeatability. Reseeding refreshes catalogues and some account credentials, while immutable surveys and many reviewed decisions are preserved. It is not a full reset: create a fresh database for a repeatable starting point. Do not reseed an environment whose rehearsal changes you want to retain. Old seeded databases used friendly string IDs that some real forms reject. Start a new disposable database; this change intentionally does not rewrite IDs or URLs in existing databases.

Stable CUID-shaped IDs keep fixtures compatible with the same validation as user-created rows. Natural keys such as language codes and `StudentSettings.program` retain their intended meaning. Neither a schema migration nor relaxed production validation is needed.

## Accounts and demonstrations

All example accounts use `Password123!`. The identifiers below work at `/signin`.

| Account | Role / example | Start |
| --- | --- | --- |
| `admin` | HEAD; collective oversight, decisions and configuration | `/admin/activity` |
| `manager@example.test` | ADMIN; management review without a tutor identity | `/admin` |
| `carol@example.edu` | COORDINATOR and tutor; interview chair and approval proposals | `/dashboard`, `/admin` |
| `alice@example.edu` | Active tutor; attendance, assignments, hours, panel voting | `/dashboard` |
| `crew@example.edu` | Crew-only member; room patrol and membership | `/patrol` |
| `iris@example.edu` | Tutor with crew membership | `/patrol` |
| `emma@example.test` | Assigned student; sessions, feedback and messages | `/student` |
| `frank@example.test` | Assigned student; pending card appeal and withdrawal review | `/student` |
| `grace@example.test` | Assigned student; tutor schedule-conflict review | `/student` |
| `kate@example.test` | Verified student still waiting for assignment | `/student` |
| `recalled@example.test` | Recalled request retained as history | `/student` |
| `withdrawn@example.test` | Approved quarter withdrawal and resubmission block | `/student` |
| `translator@example.test` | VIEWER with translation capability; pending draft | `/localization` |
| `parent@example.edu` | Ordinary viewer | `/` |
| `viewer2@example.edu` | Suspended viewer with account appeal | `/` |

The database also includes unverified survey demand before account creation, disqualification history, exact policy acceptance snapshots, school-calendar overrides, active/inactive membership, pending and resolved removals, future meetings, valid qualified interview panels, notifications, private messages, registration codes, custom pages and historical service-hour reports. The Fiona panel has a coordinator chair and a completed interview; Hana demonstrates a tied vote resolved by that chair. Shared policy text remains an explicitly unapproved school draft.

Seeded survey tokens are deliberately unusable: request a new email link through the form. Local email capture is required to rehearse verification and recovery without delivering real email. Never enable a public mail-capture endpoint on a deployed site. Create coordinator proposals through the interface so their immutable target snapshots reflect the database at submission time.

## Database decisions

Keep participation, login identity, crew membership and translation capability separate. A student can retain historical profiles while making a new request; matching an email/name alone is not ownership. Keep survey timestamps and policy snapshots immutable so a resend or document edit cannot change evidence.

Membership transitions need one transaction and a shared member lock, including audit/notification writes. A unique pending-request constraint would provide additional import protection, but existing duplicate rows must be inventoried and resolved before introducing it. Do not silently discard older requests.

Scalar actor IDs in historical records intentionally preserve evidence after account deletion; blindly adding cascading foreign keys would erase that history. Before adding account deletion/import tooling, document each table's retention policy, add orphan/invariant checks, and verify backup restoration. Retain the tested session-rounding rule; a future accounting change needs an explicit calculation version and migration strategy.

Future work should follow measured need: paginated large lists and query-plan-driven indexes, a durable email outbox with retries, scheduled expired-token cleanup, and object storage for large media. These are separate from currently supported program mechanics. Multi-school hosting would additionally require a school identity and tenant-scoped authorization/unique keys throughout; it should not be simulated with role labels.
