# SHBS Peer Tutoring documentation

These guides describe the current application. Choose the task you need to complete; run repository commands from the project root.

| Task | Guide |
| --- | --- |
| Install locally, create demo accounts, run tests or troubleshoot | [Local development](local-development.md) |
| Deploy, create the first administrator, configure email or restore a backup | [Deployment runbook](deployment.md) |
| Check Aliyun security groups, public addresses and forwarding paths | [Aliyun network verification](aliyun-network-verification.md) |
| Reset an existing deployment and start fresh | [Reset and redeploy](deployment.md#start-fresh-from-an-existing-deployment) |
| Contribute changes and maintain repository files | [Contributor guidance](contributing.md) |
| Choose shared UI patterns and preserve interaction rules | [Agent component map](../AGENTS.md#start-with-the-shared-patterns) and [component boundaries](technical-report.md#shared-ui-patterns) |
| Verify UI changes in the gallery and running application | [UI verification matrix](local-development.md#ui-verification-matrix) |
| Find implementation files and understand authorization or transaction rules | [Technical guide](technical-report.md) |
| Use the website as a tutee, tutor, crew member, coordinator, administrator, HEAD, viewer or translator | [User guide](user-guide.md) |
| Understand the four name fields and display settings | [Name fields](design/name-fields.md) |
| Configure modules, periods, schedules, timezones, recipients or public content | [Program reference](program-reference.md) |
| Adapt the English/Chinese policy drafts and publish school-approved revisions | [Policy drafts and publication](policies/README.md) |
| Import pre-site history and link accountless tutees | [Historical participant transition](historical-participant-transition.md) |
| Report a bug, enhancement, feature or documentation request | [Issue guide](issues.md) |
| Understand public signup limits and recovery | [Signup protection](signup-protection.md) |
| Configure optional Aliyun CAPTCHA and plan rollout | [CAPTCHA guide](captcha.md) |
| Review dated production host and external network evidence | [Issue #242 evidence and remaining work](continuation/issue-242.md) |

## Historical verification

These records describe the revisions and scenarios tested at the time, not verification of the current application:

- [Identity, academic profile and policy verification](evidence/issues-145-154/README.md)
- [Email rendering and destination-link verification](evidence/issue-192/README.md)

Completed continuation checkpoints are retained in Git and their linked issue/PR history. Use the maintained guides above for current setup and behavior.

## Maintaining the guides

Read and edit the Markdown files directly. Run `npm run docs:check` to validate links, headings and documentation structure.

For contribution checks and where to add information, see [documentation ownership](contributing.md#documentation-and-repository-hygiene). Historical reports and superseded documents remain available in Git history.

[Project README](../README.md).
