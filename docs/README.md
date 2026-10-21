# SHBS Peer Tutoring documentation

Choose the audience and task below. Maintained guidance describes the current
application; proposals and historical verification have separate homes.

| Audience                                  | Start here                                     | Contents                                                                                                  |
| ----------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Contributors and coding agents            | [Contributor guidance](contributing/README.md) | Working principles, design conventions, interaction patterns, implementation, local setup, checks and PRs |
| Developers investigating current behavior | [Technical reference](reference/README.md)     | Architecture, component contracts, permissions, data invariants and integration references                |
| Participants, staff and operators         | [User and operator guides](guides/README.md)   | Role tasks, program configuration, deployment, records and policy publication                             |

## Common tasks

| Task                                 | Guide                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Start a contributor or agent session | [First-pass route](contributing/README.md#first-pass-for-a-new-contributor-or-agent) |
| Find visual rules for new UI work    | [Design conventions](contributing/design.md)                                         |
| Add an action or feature             | [Implementation recipe](contributing/implementation.md#add-an-action-or-feature)     |
| Run locally or test                  | [Local development](contributing/local-development.md)                               |
| Verify UI work                       | [Verification matrix](contributing/verification.md#ui-verification-matrix)           |
| Use the website                      | [User guide](guides/user-guide.md)                                                   |
| Deploy or recover                    | [Deployment](guides/deployment.md)                                                   |
| Find current code responsibilities   | [Architecture map](reference/technical-report.md#architecture)                       |
| Propose a design or report a problem | [Issue conventions](contributing/issues.md)                                          |

## Documentation ownership

Keep contributor prescriptions in `contributing/`, implemented contracts in
`reference/`, and user/operator instructions in `guides/`. Unimplemented design
changes stay in linked issues until reviewed and delivered. See
[documentation ownership](contributing/documentation.md) for placement and maintenance.

Superseded evidence and continuation notes remain in
[Git history](contributing/documentation.md#historical-evidence-and-continuation-notes).
Unfinished operator checks belong in their maintained guide, including
[Aliyun verification](guides/aliyun-network-verification.md).

Read Markdown directly. Run `npm run docs:check` to check repository links,
headings, discoverability and documentation regressions without a server or database.

[Project README](../README.md).
