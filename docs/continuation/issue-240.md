# Issue 240: portable continuation checkpoint

Prepared 2026-10-02. This note describes the approved application candidate; a later
documentation-only checkpoint commit may sit above it. Read the draft PR's current
head SHA when resuming. Local reports and private runtime fixtures are not included
in a fresh cloud clone.

## Identity and status

- Repository: `DupeisTaken/shbs-peer-tutoring-website`.
- Issue: [#240](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/240).
- Branch: `codex/issue-240-patrol-credit`; intended PR base: `main`.
- Approved application HEAD: `2579c88901284089c6a68c9cdc2f4dac27e73da3`.
- Approved application tree: `b1b356b83737cc25047f7be8ee6f56f5375a0300`.
- Reviewed parent: `caec7b883cfde55a0b5a8b71e94fd7ccadd82dce`.
- Historical reviewed base/main: `d3a98dad232902ccf6a6ebe772c6467a095e5eba`,
  last independently rechecked 2026-10-02 06:13:30 UTC (14:13:30 China).
- Cumulative implementation: 32 files, 896 additions and 54 deletions at the
  approved candidate. Source, live evidence and final HTML independently approved.
- No unresolved #240 source finding. No deployment, merge or published policy
  change was performed. Future combined-branch verification is still required.

## Completed behavior and invariants

Each stable/combined crew identity can receive at most 0.5 new hours per rolling
20 server minutes. An eligible sweep must contain only observations from the last
20 minutes, with at most one minute of future device-clock skew, and all its UTC
20-minute evidence intervals must be unclaimed. Accepted older, repeated or
cooldown observations remain saved with zero new hours. A new UUID, room, count or
note cannot reset this allowance. A bucket boundary does not reset the cooldown.

The same author/key/normalized payload returns the original patrol ID and hours,
even after correction or the cooldown; changed same-key input conflicts. The
client retains an immutable submitted snapshot (including timestamps), reuses it
for an unchanged retry and creates a new key after an actual count/time/trimmed-note
change. Whitespace-only note changes retain intent. Pending count/note controls
are disabled, and synchronous guards prevent pre-render duplicate submits/edits
through awaited success refresh. Confirmed success clears the draft and snapshot.

Submission locks the attendance barrier, sorted account-profile ownership locks
shared with account combination, then the submission key. Ownership is re-read
after waiting; combined history is queried without rewriting original authors.
Retired logins cannot submit. Patrol, observations, award time, interval claims
and flag reconciliation commit atomically. The ledger is unique by author and
window. Corrections retain hours, award time and original claims, adding corrected
intervals without refunding prior evidence. A correction waiting behind combination
conflicts safely and can retry with the retained author.

Migration and archive import preserve original hours, observations, authorship and
creation/update timestamps. Historical overlaps remain; earliest creation time/ID
owns each backfilled reservation. Positive patrols without observations reserve
their creation interval; zero-hour rows gain no claim. Modern corrected archives
round-trip full objects; legacy imports backfill atomically; re-import is idempotent;
wrong-author claims reject and roll back. Historical duplicate hours are not repaired.

`crewProcedure` and inactive/opted-out behavior remain enforced. The
[#246](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/246)
Viewer projection registry is unchanged; regression fixtures ensure new private
credit fields stay excluded. Self-reported evidence does not prove a physical visit.

## Implementation map and integration order

Primary code: `src/server/crew/patrol-credit.ts`, routers `crew.ts` and
`corrections.ts`, `src/server/record-transfer.ts`, `prisma/schema.prisma`, migration
`20261002010000_patrol_credit_budget`, and `src/app/patrol/{page,layout}.tsx`.
The final retry follow-up changed only `page.tsx`, its tests and the technical guide.

Shared UI foundation and
[#222](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/222)
also touch the patrol page/ChoiceButton/header. Obtain their reviewed commits from
the coordinator before combining branches. Integrate the reviewed shared foundation
and consumer work, then preserve this branch's server rules and request lifecycle
while resolving the patrol page overlap. Preserve
`selected={chosen === b.value}` and `disabled={submit.isPending}` when using
ChoiceButton. Do not replace shared header work with this branch's older layout.
Re-run the affected combined-source tests and browser scenarios afterward. The
local source-validation queue was a resource schedule, not proof of merge order
or approval of every sibling branch.

## Exact historical validation

These are recorded local results, not new cloud results or one summed unique count.

| Scope | Result and provenance |
| --- | --- |
| Reviewed parent | 137 tests in 14 files passed; final affected UI/policy rerun passed 15 tests in 4 overlapping files. |
| Retry follow-up | 31 tests in 3 files (13 UI, 3 pure credit, 15 API/database) passed before equivalent optional-chain lint cleanup. Server/pure code stayed unchanged. |
| Exact final UI | All 13 page tests passed again after that cleanup. |
| Static/docs/build | `npm run check`: no errors, 18 existing warnings. `npm run docs:check`: 13 tests, 24 Markdown files. Final production build passed with DB available, one CPU and 2048 MiB heap. |
| Schema | Prisma generate/validate, all 56 migrations on a fresh isolated DB and zero schema difference passed. Migration regression runs the real SQL in a rollback-only schema. |
| Final live retry matrix | EN/ZH at 1440x1000 and 390x844; 20 actual HTTP 200 receipts, 16 durable rows, four unique keys/rows and one 0.5-hour award per account (2.0 hours total). Same-key recovery returned the original durable ID. |
| Earlier live/UI coverage | Credited/zero-credit feedback, inactive permissions, keyboard/theme focus and 320/1024 boundaries. Final retry run rechecked pending/lost response/recovery/direct edit, no overflow, 32px desktop and at least 44px mobile header controls. |

The prior 137-test command selected these files after
`npm test -- --maxWorkers=1`:

```text
src/server/crew/patrol-credit.test.ts
src/server/crew/patrol-credit-migration.test.ts
src/server/api/routers/patrol-credit.test.ts
src/server/api/routers/fresh-audit-workflows.test.ts
src/server/api/routers/record-transfer.test.ts
src/server/combine-accounts.test.ts
src/server/api/routers/management-read-models.test.ts
src/server/api/routers/management-read-models.integration.test.ts
src/lib/record-transfer.test.ts
src/lib/policy-documents.test.ts
src/i18n/messages.test.ts
src/app/patrol/page.test.tsx
src/app/_components/patrol-corrections.test.tsx
src/app/_components/record-transfer.test.tsx
```

The overlapping 15-test rerun selected the last page test, patrol-corrections test,
policy-documents test and messages test. The follow-up command is listed below.
Original execution was Windows, Node 24.16, npm 11.13, Next 16.3.6, Prisma 7.10,
Vitest 4.1.11 and PostgreSQL 18.4. Node 22/PostgreSQL 16 CI and the full repository
suite were not run for this local checkpoint. CI results must be checked on the
actual published commit; the repository workflow covers PRs, including drafts.

Recovered setup failures: a 1.5 GiB lint heap was insufficient; a cross-drive
dependency junction blocked Turbopack; an initial DB restart omitted its port
override; one optional-chain lint error was repaired; the first browser harness
matched the Next route announcer instead of the main alert. Successful reruns are
distinguished above. A prior parent build completed with DB fallback diagnostics;
the final follow-up build had DB available. Existing lint/query deprecation warnings
remain. Chinese transport errors still display English “Failed to fetch”; six other
locales use English fallback for new help pending translation review.

## Cloud checkout and focused verification

Use a dedicated checkout of this branch; do not assume local ignored evidence,
dependency junctions, browser storage state or fixture databases were uploaded.
Read `AGENTS.md`, `docs/contributing.md` and `docs/local-development.md`. Before
Next.js changes, read the relevant bundled guide in `node_modules/next/dist/docs/`.

```bash
git fetch origin
git switch --track origin/codex/issue-240-patrol-credit
git rev-parse HEAD
git merge-base HEAD origin/main
npm ci
cp .env.example .env
```

If already on the branch, inspect status and the PR's published SHA rather than
re-running `git switch --track`. Configure a new private local `.env` with a fresh
auth secret and an explicit PostgreSQL URL for a loopback database named
`shbs_shipping_test`. Use Node 22/PostgreSQL 16 to match CI where available. Never
copy local credentials or run destructive fixtures against a demo/production DB.
The API tests create and truncate their own synthetic fixtures; do not seed first.

```bash
export NODE_OPTIONS=--max-old-space-size=2048
export SHBS_BUILD_CPUS=1
export RAYON_NUM_THREADS=1
npm run db:migrate
npx prisma generate
npx prisma validate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm test -- --maxWorkers=1 src/app/patrol/page.test.tsx src/server/crew/patrol-credit.test.ts src/server/api/routers/patrol-credit.test.ts
npm run check
npm run docs:check
SHBS_DISABLE_BUILD_CACHE=1 npm run build
```

The 31-test selection is the smallest established follow-up check. After merging
related source, add the migration/corrections/archive/combine/read-model suites
listed above, then inspect CI for the exact new commit. Record new outcomes with
their SHA; do not relabel old passing totals as a new run.

For a browser rehearsal, stop destructive tests, create a separate loopback
`shbs_program_demo` database and follow the documented guarded demo-seed workflow
(`SHBS_DEMO_SEED=1`, migrate, seed twice, verify-demo). Use only synthetic active
crew accounts and room fixtures, with unique accounts per test case. Keep all
passwords, storage state and fixture scripts local/ignored. Start one server via
`npm run dev -- --hostname 127.0.0.1 --port 3000`, then one browser. Repeat:

1. EN/ZH at 1440 and 390px: select a room count and note; hold the submission.
   Attempt count/note changes and duplicate submit before and during pending state.
2. In an isolated Playwright route for `crew.submitPatrol`, call `route.fetch()`
   against the real server, retain its actual streamed JSONL result, then abort only
   delivery to the browser. Do not fabricate success responses or skip the commit.
3. Retry unchanged: verify identical input/key/timestamps, original result ID and
   no extra row/credit. Scope feedback assertions to `main`, not the route announcer.
4. Submit a fresh draft, then another uncertain commit followed by a direct edit.
   Verify new keys, retained prior input and no extra award during cooldown.
5. Independently query each synthetic account: four rows/unique keys, one non-null
   award timestamp, total 0.5 hours; retain notes/counts and compare retry IDs.
6. Capture pending, lost-response, retry-pending, recovered and edited-intent states.
   Keep original full-size raw captures; if hiding only the Next toolbar for canonical
   captures, label that transformation and retain raw pairs. Measure header controls
   and overflow; check keyboard and inactive/opted-out access. Stop only owned services.

The local browser harness and raw fixtures were intentionally not committed.
Recreate this small scenario using the checked-in API tests as the fixture contract
and an available browser tool; install any browser tooling locally to the checkout.

## Report approval and release boundaries

The frozen local HTML report was independently approved on 2026-10-02 at
15:54 China time, SHA-256
`9701f990711ae078967f5bb5572199d637e2b1d14e8b575f78225cce017a73a8`.
It contained 43 unchanged native PNGs (32 final, including 12 raw, plus 11 earlier
parent captures). Report verification covered five normal widths, 200% text at
320/390/768/1024, 54 links, native pixels, keyboard/focus and zero external requests;
17 final report screenshots were independently checked. Report-only wrapping,
Close-button and gallery-preview repairs were validated. The report's historical
“final review pending” text was deliberately frozen; a later separate approval
receipt supersedes that status. The report/raw receipts stay on the original local
machine and are not claimed to be available in a cloud clone. A newly generated
or changed report still needs its own visual and independent review.

Apply migration `20261002010000_patrol_credit_budget` before updated application
code. Do not run older application code afterward; it can make unbudgeted awards.
Preserve backups and historical duplicate totals. Policy sources at revision
2026.10.02 are school-review drafts, not live publication. The running site reads
database PolicyDocument rows; publish approved language revisions through the
policy editor, preserving acceptance evidence. No development seed on production.

Next actions: inspect the draft PR's exact CI result; coordinate shared-source
integration, resolve the patrol consumer without losing request guards, rerun the
combined checks/browser matrix, and obtain any new artifact review. Deployment and
school policy publication remain separate actions. All owned local services were
stopped and the exclusive lock released. Inactive caches were retained after an
earlier automatic approval review blocked recursive deletion; no bypass was used.
