# Contributor guidance

Use this folder for the principles and procedures that govern changes to this
repository. [Technical reference](../reference/README.md) describes implemented
behavior; [user and operator guides](../guides/README.md) explain how to use and
operate it. Proposed designs stay in issues until reviewed and delivered.

## First pass for a new contributor or agent

1. Confirm the checkout, branch, source revision and working-tree changes. Preserve
   unrelated work. Read [resource safety](local-development.md#worktree-and-resource-safety)
   before setup, generation, testing or cleanup.
2. Read the [architecture map](../reference/technical-report.md#architecture) and
   the current source for the affected feature. Earlier chats, reports and PRs
   provide context, not proof of this revision's behavior.
3. For UI work, read [design conventions](design.md), [interaction patterns](interaction-patterns.md)
   and the [extension recipe](implementation.md#add-an-action-or-feature). Inspect
   the real caller and [gallery recipe](ui-recipes.md) before broadening a component.
4. Implement the focused change, document its core ideas, add behavior coverage
   after a feature, and run the [required checks](verification.md#required-checks).
   UI changes also need screenshots of the gallery and affected real pages.
5. Update the owning documentation and prepare a [PR](pull-requests.md) with its
   linked issue, source revision, checked cases, results and unverified scope.

## Working principles

- Clarify ambiguous outcomes and product decisions. Discuss the tradeoffs before
  substituting a different approach; routine implementation details can follow
  the existing patterns.
- Keep permissions, approval rules, historical evidence and draft/version ownership
  with their current feature. Presentation changes do not authorize domain changes.
- Fix root causes across relevant scenarios, keep changes focused and document
  important implementation decisions in code comments.
- Keep local work bounded: one server/browser or test run at a time. Prefer local
  configuration over global changes; stop only processes and resources you own.
- Test the affected behavior and record what was actually verified. A screenshot,
  mocked write and database transaction establish different things.

## Find the right guidance

| Task                                                               | Guide                                           |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| Set up locally, inspect resource ownership or run tests            | [Local development](local-development.md)       |
| Choose layout, typography, control sizes, tables or mobile headers | [Design conventions](design.md)                 |
| Choose state, dialog, form, navigation or recovery behavior        | [Interaction patterns](interaction-patterns.md) |
| Find a reusable example and its production caller                  | [Gallery recipes](ui-recipes.md)                |
| Extend a feature, classify its action or edit localized wording    | [Implementation guidance](implementation.md)    |
| Choose tests, capture UI evidence and report verification          | [Verification and handoff](verification.md)     |
| Propose a change or report a problem                               | [Issue conventions](issues.md)                  |
| Prepare a PR and understand size labels                            | [Pull requests](pull-requests.md)               |
| Place or maintain documentation and historical evidence            | [Documentation ownership](documentation.md)     |

[Documentation home](../README.md).
