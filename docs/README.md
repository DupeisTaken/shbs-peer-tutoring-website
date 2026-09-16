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
| See every supported function and configurable module | [Program reference](program-reference.md) |
| Read or publish a policy revision | [Policy documents](policies/README.md) |
| Install or operate the server | [Local setup](local-development.md) · [Deployment runbook](deployment.md) |
| Contribute or verify product decisions | [Contributor guidance](contributing.md) · [Product rules](product-rules.md) |
| Understand signup or management review in detail | [Student signup](student-signup.md) · [Coordinator approvals](coordinator-approvals.md) |
| Report a bug, suggest a feature or enhancement, or improve these docs | [Creating issues](issues.md) |
| Understand which files to keep or safely clean | [Repository maintenance](repository-maintenance.md) |

## Printable reports

Run `npm run docs:build` to export the user guide and technical report to `docs/reports/`, then open the HTML files in a browser. HTML reports are ignored local artifacts; Markdown is the maintained source. `npm run docs:check` validates sources and rendering without requiring exports. See [maintaining the documentation](technical-report.md#maintaining-the-documentation).

## Status and history

The [release verification record](release-verification.md) preserves dated test evidence and launch checks. The [signup audit](archive/signup-audit.md) and [2025 policy archive](archive/policies-2025/README.md) are historical references, not current release status or policies to publish. Earlier HTML audit reports remain in Git history; new reports and screenshots stay local.

[Return to the project README](../README.md).
