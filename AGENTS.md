# Working in this repository

Read [contributor guidance](docs/contributing/README.md) and follow its
[first-pass route](docs/contributing/README.md#first-pass-for-a-new-contributor-or-agent)
before editing. That folder is the maintained home for working principles,
design conventions, implementation recipes, verification and documentation rules.

- [Resource ownership and local setup](docs/contributing/local-development.md#worktree-and-resource-safety)
- [Design conventions](docs/contributing/design.md) and [interaction patterns](docs/contributing/interaction-patterns.md)
- [Add an action or feature](docs/contributing/implementation.md#add-an-action-or-feature)
- [Required checks and handoff](docs/contributing/verification.md#required-checks)

Use the [documentation hub](docs/README.md) to find current technical reference
and user/operator guides. Inspect the checkout, branch, revision and working-tree
changes; earlier chats and historical reports do not establish current behavior.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
