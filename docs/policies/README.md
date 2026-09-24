# Policy drafts and publication

[Documentation hub](../README.md) · [User guide](../user-guide.md) · [Technical report](../technical-report.md#policy-documents-and-translations)

The bundled English and Chinese documents are **policy review drafts**, not approved school policies. Revision 2026.09.24 preserves the legacy tutor I–VIII and tutee I–IV structure while incorporating current website workflows. The [revision review](revision-notes.md) identifies retained expectations, changed rules, legacy sources and printable PDF export instructions. Adapt the drafts to enabled modules and school requirements, supply contact details and an effective date, and approve both languages before publication. Their source revision is defined by `POLICY_VERSION` in [the catalog](../../prisma/policies.ts).

| Audience | English | 中文 |
| --- | --- | --- |
| Students | [Tutee policy draft](../../prisma/policies/tutee-policy.en.md) | [学习伙伴政策草案](../../prisma/policies/tutee-policy.zh.md) |
| Tutors | [Tutor policy draft](../../prisma/policies/tutor-policy.en.md) | [辅导伙伴政策草案](../../prisma/policies/tutor-policy.zh.md) |

The development seed loads these four sources. Missing policy languages fall back to English; UI language availability is configured separately. The current [user guide](../user-guide.md) and [program reference](../program-reference.md) describe the behavior policies must match.

## Publish a revision

1. School management adapts both policy drafts and confirms the effective date, contact routes, calendar, enabled modules, intake configuration and school-specific expectations. Check automatic disciplinary removal, the distinct withdrawal routes, hour calculations and messaging supervision against the implemented behavior. Resolve differences between languages before publication; use an approved school title and revision for the published text.
2. Retain the currently published policy records and compare the new wording. Preserve historical acceptance snapshots. Do not run the development seed against a production database.
3. In **Policies** (`/admin/policies`), start with the **Student policy** and **Tutor policy** editors. On a fresh installation these are blank; enter the reviewed title, revision and content and save English first. Add Chinese and every other language intended to remain published with the same reviewed revision. Archive old language content externally and remove its obsolete live translation through the editor so English fallback can apply. Removing a file from Git does not remove a database translation.
4. Complete ADMIN/HEAD review for coordinator proposals. A submitted proposal has not changed the published policy. Keep intake closed and schedule a maintenance window while updating multiple translations; each committed content change can trigger renewed consent.
5. Preview student and tutor policies in English, Chinese and one language using fallback. Check the visible text, not just the version label.
6. With test participant accounts, exercise renewed consent, the ten-second confirmation, retained acceptance evidence and continued access to history, feedback, appeals, messages and account settings. Reopen intake after policy and delivery setup are ready.

Before English publication (including an empty English body), signed-in participants see a setup notice rather than a retry error. Managers with participant memberships get a **Policy Documents** link; management-only accounts and viewers are not prompted. A missing policy never grants consent or participation. Published, unaccepted policies for other memberships still receive review. Database or network failures remain retryable errors.

Published changes trigger a dismissible popup on the participant's next visit or window focus. The interface follows the selected locale with English fallback. Accounts linked to both a student and a tutor review both applicable policies. Canceling preserves access to personal screens; the server still requires explicit current acceptance for new participation. Retry refreshes the policy and confirmation ticket after failures. An unchanged publication or a pending coordinator proposal does not change the accepted revision.

Staff review acceptance evidence in **Users & Roles → User details → Policy acceptance history**, including accounts with missing contact email. Current acceptance status is separate from the immutable historical text. Expand a record to read its original title/version, signature and acceptance time, then its recorded language copies. The history belongs to the selected account ID. Publication remains in Policy Documents.

Repository edits do **not** publish to an existing database or deploy the website. The development seed loads the four current EN/ZH sources; on an older development database it updates those rows without deleting other pre-existing translations. Rebuild a disposable development database or remove obsolete translations through the editor before testing fallback.

## Maintain a revision

Edit the four source files above, update `POLICY_VERSION` in [the catalog](../../prisma/policies.ts), then run `npm run docs:check` and the policy tests. English and Chinese must express the same rules. Update the relevant [user instructions](../user-guide.md) or [configuration guidance](../program-reference.md) when program mechanics change.

Use a [documentation request](../../.github/ISSUE_TEMPLATE/04-documentation.yml) for unclear wording. Changes to program mechanics need a program decision and matching implementation/tests; a wording edit alone cannot change application behavior.
