# SHBS Peer Tutoring

A school peer-tutoring website for student intake, matching, attendance, service hours, interviews and private support. Management changes proposed by coordinators require ADMIN or HEAD approval.

## Documentation

Start with the **[documentation hub](docs/README.md)** to find the guide for your task.

| I want to…                                                       | Read…                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Use the website as a student, tutor, crew member or staff member | [User guide](docs/guides/user-guide.md)                                                                                 |
| Run locally and test                                             | [Local development](docs/contributing/local-development.md)                                                             |
| Deploy and operate the server                                    | [Deployment runbook](docs/guides/deployment.md)                                                                         |
| Reset an existing deployment and start fresh                     | [Reset and redeploy](docs/guides/deployment.md#start-fresh-from-an-existing-deployment)                                 |
| Contribute code                                                  | [Contributor guidance](docs/contributing/README.md)                                                                     |
| Start a fresh contributor or agent session                       | [First-pass reading route](docs/contributing/README.md#first-pass-for-a-new-contributor-or-agent)                       |
| Follow UI layout and interaction conventions                     | [Design conventions](docs/contributing/design.md) and [interaction patterns](docs/contributing/interaction-patterns.md) |
| Understand architecture and access rules                         | [Technical report](docs/reference/technical-report.md)                                                                  |
| Report a bug or request a change                                 | [Issue guide](docs/contributing/issues.md)                                                                              |

## Development

Next.js 16, React 19, tRPC 11, Prisma 7/PostgreSQL and Auth.js. Use Node 22 as in CI. Follow the [local setup guide](docs/contributing/local-development.md), including [worktree safety](docs/contributing/local-development.md#worktree-and-resource-safety), to configure the environment and database before running these commands in a standalone checkout:

```bash
npm ci
npm run dev
```

See [testing](docs/contributing/local-development.md#5-run-the-tests) for verification commands and isolated test database requirements, and [deployment](docs/guides/deployment.md) for seed-free production bootstrap and launch configuration.
