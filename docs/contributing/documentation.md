# Documentation ownership and repository hygiene

## Choose the audience

Keep each rule or procedure in one maintained location and link to it elsewhere.
The root `README.md` introduces the project; `AGENTS.md` routes agents to these
contributor guides and retains the framework-managed block. Neither is a second
design manual.

| Content                                                                          | Maintained home                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Working principles, design conventions, implementation recipes, setup and checks | [Contributor guides](README.md)                                                            |
| Current component contracts, code responsibilities and data invariants           | [Technical reference](../reference/README.md)                                              |
| Role tasks, program configuration, deployment and operator procedures            | [User and operator guides](../guides/README.md)                                            |
| Unimplemented designs or policy decisions                                        | [Issues](issues.md), explicitly proposed until reviewed and delivered                      |
| Published school policy source and accepted versions                             | The existing database-backed policy workflow; [policy guide](../guides/policies/README.md) |

Describe current behavior in reference and user guides. Put contributor prescriptions
in this folder. When a change affects several audiences, update their owning guides
without copying the full procedure. Link new pages from the relevant index and use
specific section links for long references.

## Maintain and verify

Edit Markdown directly; it remains readable without compilation. Update the existing
section when behavior changes rather than appending a feature diary or a page per fix.
Run `npm run docs:check` for links, headings, guide discoverability, ownership
regressions, user roles and issue forms. It does not fetch external links or establish
application behavior. Follow [required checks](verification.md#required-checks) too.

## Historical evidence and continuation notes

Keep current instructions free of old test totals, rollout logs and completed handoffs.
Historical reports, screenshots and superseded continuation checkpoints remain
available in [the pre-overhaul archive](https://github.com/DupeisTaken/shbs-peer-tutoring-website/tree/6357007373d1efd177e36140d9e0ba7c80d2f237/docs).
Their revisions and scenario limits still apply; they are not current verification.

New local HTML reports, screenshots and temporary logs belong in ignored `outputs/`
or `.validation/`. Private operator notes belong in `local-operations/`, and dumps
in `backups/`. Reusable verification helpers belong in `scripts/` or `src/` with tests.
Track unfinished work in issues and maintain actionable operator procedures in their
guide. Finishing a chat or deleting a checkpoint does not resolve an operational gap.

## Retain source and owned resources

Keep policy inputs, scripts, tests and the complete migration chain versioned.
`prisma/policies/` is a development-seed input, not duplicate documentation. Do not
delete migrations or runtime inputs because they are old. Generated clients,
dependencies and Next output can be rebuilt, but may be shared or owned by a running
process. Inspect ownership before cleanup; follow
[worktree and resource safety](local-development.md#worktree-and-resource-safety).
Before removing a branch or worktree, fetch, inspect changes and confirm its commits
are merged. Preserve unique work, private input and active previews.

## Public privacy notice

The public `/privacy` notice is maintained in [privacy-policy.ts](../../src/lib/privacy-policy.ts), with English and Chinese text and an explicit English fallback. Update both versions and `PRIVACY_POLICY_UPDATED` when information handling changes. Its homepage links are permanent and independent of editable landing blocks. This notice is separate from database-backed participation agreements and acceptance snapshots. Before deployment, the operator should review the wording against actual hosting, email, storage and retention arrangements and configure `ORG_NAME` and `SUPPORT_EMAIL`. The page supplies a school-contact fallback when no support email is configured; it does not invent a provider, retention deadline or legal compliance guarantee.
