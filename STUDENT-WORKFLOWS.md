# Student and participant workflows

The survey and participant workflows are integrated and merged through [PR #9](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/9).

| Task | Current guide |
| --- | --- |
| Apply, verify, edit availability or leave | [Student guide](docs/user-guide.md#students) |
| Attendance, feedback, appeals and private support | [Records and support](docs/user-guide.md#records-feedback-and-appeals) |
| Review participation and correct history | [Administrator guide](docs/user-guide.md#administrators) |
| Coordinator review | [Coordinator guide](docs/user-guide.md#coordinators) |
| Ownership and database transitions | [Technical report](docs/technical-report.md#student-lifecycle-and-ownership) |
| Survey-specific implementation and tests | [Student signup](STUDENT-SIGNUP.md) |
| Policies and publication | [Policy sources](docs/policies/README.md) |

Survey submission precedes verification. Accounts retain explicit historical student links across intakes and verified email changes. Enrollment and attendance require current policy acceptance; personal history and private support remain available during renewal. No separate onboarding PR is needed.

Before public intake, finish the operator setup in the [deployment runbook](README-DEPLOY.md). Real email delivery and final school content remain launch requirements.
