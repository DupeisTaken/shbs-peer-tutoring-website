# Pull requests

Keep a change focused on its linked [issue](issues.md). Lead the PR description
with the concrete problem and resulting behavior; list the checks, source revision
and any unverified scope. Close delivered issues through the PR, while leaving
broader trackers open until their full scope is complete.

For delegated work, the lead integrates the changes, verifies them locally and
batches them into one push. Check queued and active runs before opening a PR,
pushing or requesting a rerun. Four core-only PR runs fill the planning budget;
include matching scheduling-profile, recovery and network workflows when applying
the [shared capacity budget](verification.md#ci-capacity-and-queue-discipline).

## Pull request size labels

The [PR Size workflow](../../.github/workflows/pr-size.yml) maintains one `code:`
label and at most one `docs:` label whenever a PR is opened, reopened, updated,
edited (including base changes), or switched between draft and ready, across all
target branches and forks.

Size counts added plus deleted lines from the PR's merge base, ignoring whitespace
and blank lines. Binary files count as zero. Tests, documentation and bundled
translation catalogs (`messages/*.json`) are excluded from `code:` size, so a
docs-only or test-only PR receives `code:XS` (never falling back to total diff).
Thresholds measure code/config churn, not review effort or risk.

| Label      | Effective changed lines |
| ---------- | ----------------------- |
| `code:XS`  | 0–9                     |
| `code:S`   | 10–29                   |
| `code:M`   | 30–99                   |
| `code:L`   | 100–499                 |
| `code:XL`  | 500–999                 |
| `code:XXL` | 1,000+                  |

- **Test exclusions:** `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*.browser.*`, `*.integration.*`, `scripts/test-*`, `scripts/smoke-*`.
- **Documentation exclusions:** `docs/**`, plus `README.md` and `AGENTS.md` at any depth.
- **Translation exclusions:** `messages/*.json` (contribute to neither `code:` nor `docs:`).
- **Counted as code/config:** runtime localization code, `prisma/policies/` Markdown inputs, other JSON/Markdown files and lockfiles. Keep exclusions aligned when adding new test or doc paths.

An independent `docs:` label counts additions plus deletions in `docs/**` and
`README.md` / `AGENTS.md` at any depth (0 lines = no `docs:` label; there is no
`docs:XS`):

| Label      | Documentation changed lines |
| ---------- | --------------------------- |
| `docs:S`   | 1–29                        |
| `docs:M`   | 30–99                       |
| `docs:L`   | 100–499                     |
| `docs:XL`  | 500–999                     |
| `docs:XXL` | 1,000+                      |

A docs-only PR can therefore carry `code:XS` + `docs:XL`, while a mixed PR carries
both sizes. The workflow creates missing label definitions, keeps colors and
descriptions in sync, removes any remaining legacy `size:XS`–`size:XXL` labels,
and preserves manual labels (such as `documentation` or custom `size:*` labels).

The `pull_request_target` job uses the built-in GitHub token and reads PR commits
strictly as Git data (never checkouts, installs, builds or cache restores). If
fetching `refs/pull/<number>/head` fails, it falls back once to the API-reported
immutable head SHA from `origin` and verifies the exact SHA before sizing; a
missing commit, SHA mismatch or stale moving ref aborts without writing labels.
Run `npm run test:pr-size` locally to verify sizing logic (also run in CI `checks`).
