# Pull requests

Keep a change focused on its linked [issue](issues.md). Lead the PR description
with the concrete problem and resulting behavior; list the checks, source revision
and any unverified scope. Close delivered issues through the PR, while leaving
broader trackers open until their full scope is complete.

## Pull request size labels

The [PR Size workflow](../../.github/workflows/pr-size.yml) automatically maintains one
`code:` size label when a PR is opened, reopened, updated, edited (including a new base),
or switched between draft and ready. It applies to all target branches and forks.
It becomes active after the workflow is merged into the default branch; existing
PRs receive labels on their next matching event.

Size counts added plus deleted lines from the PR's merge base, ignoring whitespace
and blank-line changes. Binary files contribute zero lines. Tests, documentation
and bundled translation files are always excluded, including when they are the
only changes: those PRs receive `code:XS`. There is no fallback to the total diff.
The thresholds and colors follow t3code's original sizing convention; the label
measures code/configuration churn, not total review effort or risk.

| Label      | Effective changed lines |
| ---------- | ----------------------- |
| `code:XS`  | 0–9                     |
| `code:S`   | 10–29                   |
| `code:M`   | 30–99                   |
| `code:L`   | 100–499                 |
| `code:XL`  | 500–999                 |
| `code:XXL` | 1,000+                  |

Test paths include `test/`, `tests/`, `__tests__/`, files containing `.test.`,
`.spec.`, `.browser.` or `.integration.`, and `scripts/test-*` / `scripts/smoke-*`.
Documentation exclusions cover `docs/**` and `README.md` / `AGENTS.md` at any depth.
Translation exclusions cover the bundled `messages/*.json` catalogs. Runtime
localization code, `prisma/policies/` Markdown inputs, other JSON/Markdown files and
lockfiles still count. Keep the workflow's exclusions aligned with new test
entrypoints and documentation/translation locations.

An independent `docs:` label measures documentation changes in `docs/**` or
`README.md` / `AGENTS.md` at any depth. It uses the same merge-base diff and
whitespace/blank-line adjustments as code size, counting additions plus deletions.
Documentation labels share the corresponding code-size label colors:

| Label      | Documentation changed lines |
| ---------- | --------------------------- |
| `docs:S`   | 1–29                        |
| `docs:M`   | 30–99                       |
| `docs:L`   | 100–499                     |
| `docs:XL`  | 500–999                     |
| `docs:XXL` | 1,000+                      |

Zero documentation lines receive no `docs:` label; there is no `docs:XS`.
Translation catalogs contribute to neither code size nor documentation size.
Runtime policy inputs in `prisma/policies/` still count as code/configuration,
except `README.md` / `AGENTS.md` guidance, which counts as documentation.
A documentation-only PR can therefore have both `code:XS` and `docs:XL`, for
example. A mixed PR keeps its code-size label alongside its documentation size.
The workflow replaces documentation labels as the count changes, maintaining
exactly one code size label and at most one documentation size label. It preserves
manual labels such as `documentation` and custom labels outside these families.
Workflow logs show total, excluded, effective and documentation line counts plus
the selected labels. Existing closed PR labels are not backfilled by a rule
change; open PRs are reconciled on their next matching event.

The former `size:XS` through `size:XXL` labels are now named `code:XS` through
`code:XXL`. Rename existing repository labels in place to preserve their associations
with open, merged and closed PRs. The workflow removes any remaining legacy size
labels from the PR after adding its code label; custom labels such as `size:custom`
are preserved. Thresholds, exclusions and the `docs:` labels are unchanged.

Missing label definitions are created automatically; colors and descriptions stay
synchronized while unrelated PR labels are preserved. The workflow uses the
built-in GitHub token. Its `pull_request_target` job reads PR commits only as Git
data: never add PR checkouts, dependency installation, builds or cache restores.
Run `npm run test:pr-size` to verify sizing and label updates locally; CI also runs
these tests in the build workflow's `checks` job, which gates required `verify`.
Automatic `code:` and `docs:` label updates run in the separate PR Size workflow
so ordinary PR build jobs do not need label-write permissions.
