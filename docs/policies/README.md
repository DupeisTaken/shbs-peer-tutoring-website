# Policy sources and publication

[Documentation hub](../README.md) · [User guide](../user-guide.md) · [Technical report](../technical-report.md#policy-documents-and-translations)

Repository revision **2026.09.09** incorporates the confirmed program mechanics. These are maintained handbook drafts for school publication review. They do not invent a school contact, effective date, retention period or final school approval.

| Audience | English | 中文 |
| --- | --- | --- |
| Students | [Student policy](../../prisma/policies/tutee-policy.en.md) | [学生政策](../../prisma/policies/tutee-policy.zh.md) |
| Tutors | [Tutor policy](../../prisma/policies/tutor-policy.en.md) | [导师政策](../../prisma/policies/tutor-policy.zh.md) |

Confirmed mechanics include survey-first priority, fixed verification deadlines, administrator approval of coordinator management changes, preservation of the interview chair's decision, the meeting absence allowance and the existing session rounding. Interview completion credit uses actual recorded duration.

The [2025 archive](../archive/policies-2025/README.md) preserves former English and translated publications. Its translations have not been reconciled with the new rules. They are excluded from the bundled catalog; missing policy languages use the application's English fallback. UI language support is independent of policy translation availability.

## Publish a revision

1. School management reviews both handbooks and confirms the effective date, contact routes, calendar, intake configuration and any additional school-specific expectations. Resolve differences between languages before publication.
2. Retain the currently published policy records and compare the new wording. Preserve historical acceptance snapshots. Do not run the development seed against a production database.
3. In **Policies** (`/admin/policies`), start with the **Student policy** and **Tutor policy** editors. On a fresh installation these are blank; enter the reviewed title, revision and content and save English first. Add Chinese and every other language intended to remain published with the same reviewed revision. Archive old language content externally and remove its obsolete live translation through the editor so English fallback can apply. Removing a file from Git does not remove a database translation.
4. Complete ADMIN/HEAD review for coordinator proposals. A submitted proposal has not changed the published policy. Keep intake closed and schedule a maintenance window while updating multiple translations; each committed content change can trigger renewed consent.
5. Preview student and tutor policies in English, Chinese and one language using fallback. Check the visible text, not just the version label.
6. With test participant accounts, exercise renewed consent, the ten-second confirmation, retained acceptance evidence and continued access to history, feedback, appeals, messages and account settings. Reopen intake after policy and delivery setup are ready.

Repository edits do **not** publish to an existing database or deploy the website. The development seed loads the four current EN/ZH sources; on an older development database it updates those rows without deleting other pre-existing translations. Rebuild a disposable development database or remove obsolete translations through the editor before testing fallback.

## Maintain a revision

Edit the four source files above, update `POLICY_VERSION` in [the catalog](../../prisma/policies.ts), then run `npm run docs:build`, `npm run docs:check` and the policy tests. English and Chinese must express the same rules. Record confirmed mechanics in [REVIEW-QUESTIONS.md](../../REVIEW-QUESTIONS.md).

Use a [documentation request](../../.github/ISSUE_TEMPLATE/documentation.yml) for unclear wording. Changes to program mechanics need a program decision and matching implementation/tests; a wording edit alone cannot change application behavior.
