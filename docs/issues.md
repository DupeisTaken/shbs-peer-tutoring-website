# Creating issues

Use a guided form so maintainers can understand and reproduce the request. Check the [user troubleshooting table](user-guide.md#troubleshooting) and [existing issues](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues) first.

| Request | Form | Useful information |
| --- | --- | --- |
| Something behaves incorrectly | [Bug report](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=bug_report.yml) | Page, role, shortest reproduction, expected/actual result and environment |
| A new capability would help | [Feature suggestion](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=feature_request.yml) | User problem, affected roles, current workaround and an observable success condition |
| Instructions are wrong, missing or confusing | [Documentation update](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=documentation.yml) | Link and heading, intended reader, problem and suggested clarification |

## Protect participant information

GitHub issues can be public. Use invented names and synthetic records. Remove student names, email/phone details, passwords, session cookies, account links, codes, private messages, attendance/disciplinary details and database connection strings from text, screenshots and logs. A page path such as `/student` is usually enough; do not paste verification URLs.

For your own account, assignment or disciplinary case, use [private support](user-guide.md#account-settings-and-private-support). An issue is not an appeal and does not change a program decision. For a suspected security problem, report privately to the program’s verified operator or the repository maintainer before posting exploit details publicly.

## Make a report actionable

Describe what you tried and what happened. “Coordinator submits assignment, sees a pending request, administrator cannot open it” is more useful than “assignments broken.” Give the date/time and timezone when relevant, the page path, role, browser/device, and whether it happens consistently. If you do not know the commit or app version, say “unknown”; do not guess.

A feature request should state the outcome rather than require a particular implementation. Mention effects on approval, privacy, existing records or other roles when known. Documentation requests can suggest wording without deciding a new program rule.

## Triage and completion

Maintainers confirm scope, ask for missing reproduction details, and link duplicate issues. A fix should reference its issue and include a regression check when behavior changes. Policy/mechanics questions need an explicit product decision before implementation. Update the technical and user documentation together when the change affects both audiences.

[Choose an issue form](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new/choose) · [Documentation home](README.md)
