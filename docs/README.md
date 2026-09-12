# SHBS Peer Tutoring documentation

Choose the guide for the work you need to do. User instructions follow the website’s controls; technical documentation explains the implementation and how to operate it.

| I want to… | Read… |
| --- | --- |
| Apply for tutoring, check assignments, give feedback or appeal | [Tutee guide](user-guide.md#tutees) |
| Record attendance, check hours or take part in interviews | [Tutor guide](user-guide.md#tutors) |
| Record room patrols | [Crew guide](user-guide.md#crew) |
| Prepare management changes for review | [Coordinator guide](user-guide.md#coordinators) |
| Review changes and run the program | [Administrator guide](user-guide.md#administrators) |
| Manage leadership and launch settings | [HEAD guide](user-guide.md#head) |
| Browse as an observer or translate content | [Viewer guide](user-guide.md#viewers) · [Translator guide](user-guide.md#translators) |
| Understand architecture, permissions, data or tests | [Technical report](technical-report.md) |
| Read or publish a policy revision | [Policy documents](policies/README.md) |
| Install or operate the server | [Local setup](../README-LOCAL.md) · [Deployment runbook](../README-DEPLOY.md) |
| Report a bug, suggest a feature or improve these docs | [Creating issues](issues.md) |
| Understand which files to keep or safely clean | [Repository maintenance](repository-maintenance.md) |

## Two reports

- **[User report and role guide](user-guide.md):** tasks, outcomes, approval states and nearby troubleshooting.
- **[Technical report](technical-report.md):** architecture, authorization, transactions, data lifecycle, validation and launch boundaries.

Both also have printable HTML editions generated with `npm run docs:build` in `docs/reports/`. Markdown is the editable source. See [maintaining the documentation](technical-report.md#maintaining-the-documentation).

## Status and history

The [release rehearsal report](reports/release-audit.html) records the September 2026 navigation audit, bounded load tests, demo database, focused fixes and remaining launch setup. It is an authored HTML report; edit it directly rather than regenerating it from the guides.

[PR #9](https://github.com/DupeisTaken/shbs-peer-tutoring-website/pull/9) merged the four reviewed branches into main. The [release verification record](../SHIPPING-READINESS.md) distinguishes tested code from the real email, school-content and hosting setup still needed before launch.

The [2025 policy archive](archive/policies-2025/README.md) is historical material, not a policy to publish. Old entry-point documents remain as links to current guides so existing bookmarks continue to work.

Documentation organization is informed by [beatblock-online](https://github.com/DupeisTaken/beatblock-online/tree/main/docs): a short entry page, separate user and technical guides, and links to the exact task or explanation.

[Return to the project README](../README.md).
