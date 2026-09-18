# SHBS Peer Tutoring

A school peer-tutoring website for student intake, matching, attendance, service hours, interviews and private support. Management changes proposed by coordinators require ADMIN or HEAD approval.

## Documentation

Start with the **[documentation hub](docs/README.md)** to find the guide for your task.

| I want to… | Read… |
| --- | --- |
| Use the website as a student, tutor, crew member or staff member | [User guide](docs/user-guide.md) |
| Run locally and test | [Local development](docs/local-development.md) |
| Deploy and operate the server | [Deployment runbook](docs/deployment.md) |
| Contribute code | [Contributor guidance](docs/contributing.md) |
| Understand architecture and access rules | [Technical report](docs/technical-report.md) |
| Report a bug or request a change | [Issue guide](docs/issues.md) |

## Development

Next.js 16, React 19, tRPC 11, Prisma 7/PostgreSQL and Auth.js. Use Node 22 as in CI. Follow the [local setup guide](docs/local-development.md) to configure the environment and database before running:

```bash
npm ci
npm run dev
```

See [testing](docs/local-development.md#5-run-the-tests) for verification commands and isolated test database requirements, and [deployment](docs/deployment.md) for seed-free production bootstrap and launch configuration.
