# SHBS Peer Tutoring

Founded in 2024 at Shanghai Hongrun Boyuan School (SHBS), SHBS Peer Tutoring is a 100% student-run mutual-help organization operating independently of school faculty intervention. Across the school's Honors and Advanced Placement (AP) curriculum—with new subjects added as needs grow—fellow students meet as equals in 45-minute after-school classroom sessions (typically 1 tutor with 1–4 tutees) to support coursework and build lasting campus connections.

This website coordinates student intake, subject matching, rescheduling, attendance, service hours, panel interviews, Crew patrols, and private support. Management changes proposed by Coordinators require ADMIN or HEAD approval; Viewers may follow read-only summaries without a say in program operations. Public visitors can read the bilingual program overview at `/about`.

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
