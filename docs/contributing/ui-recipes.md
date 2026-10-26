# Gallery recipes

These examples compose real shared controls with synthetic state. Use them beside
a production caller with the same lifetime and consequence. See
[interaction patterns](interaction-patterns.md) and
[verification](verification.md#ui-pattern-gallery).

## Gallery compositions

The [gallery compositions](../../src/app/ui-gallery/recipes.tsx) have these
production references and boundaries. Each example supports English and Chinese;
verify it at real desktop and mobile viewports. The global form-state selector
controls the participant example; other recipes expose their own state transitions.

| Recipe and intent                                                | First production references                                                                                                                                                                                              | States to verify                                                                                                                                                                                                                                           | Boundary / non-goal                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Navigation and registration: distinguish routes from local steps | [Public header](../../src/app/_components/public-header.tsx), [tutee navigation](../../src/app/student/navigation.tsx), [invitation flow](../../src/app/register/register-flow.tsx)                                      | One utility instance, wrapping labels, native Back/Forward, numbered progress and focused headings ([#221](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/221))                                                                          | The demo does not verify identities; features own proof invalidation, draft lifetime and server permissions |
| Long dialog: keep a large editor or reader usable                | [Profile editor](../../src/app/_components/profile-dialog.tsx), [policy reader](../../src/app/_components/current-policy-dialog.tsx)                                                                                     | Nested Escape/Tab, exact focus return, long scroll, pending dismissal, rejection ([#231](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/231))                                                                                            | Does not decide consent, review consequences or write authorization                                         |
| Participant form: group one identity save                        | [Account](../../src/app/_components/account-profile-editor.tsx), [tutor](../../src/app/_components/tutor-profile-editor.tsx), [tutee](../../src/app/_components/tutee-editor.tsx) editors                                | Editable, pending, failed and read-only; four-part/legacy names and retained drafts ([#232](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/232))                                                                                         | Academic, membership and historical-link writes retain separate drafts and versions                         |
| Filter toolbar: select which records to show                     | [Management actions](../../src/app/_components/management-actions.tsx), [account roster](<../../src/app/(admin)/admin/users/page.tsx>)                                                                                   | Selected filters, native search/select, reset/count, pending refresh and pagination reset ([#237](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/237))                                                                                   | Filters are not content tabs or commit actions                                                              |
| Disclosure: choose when content mounts                           | [Tutee creation](<../../src/app/(admin)/admin/tutees/page.tsx>), [tutor details](../../src/app/_components/tutor-details.tsx), [TranslationStrings](../../src/app/_components/translation-strings.tsx) | Closed/open, lazy read queries, retained drafts, collapse/reopen; translation namespace buttons expose expanded state and controlled regions while preserving row drafts | Does not infer a draft lifetime or grant detail access |
| Setting row: explain when a choice saves                         | [CAPTCHA](../../src/app/_components/program-captcha-settings.tsx), [Names and Grades](../../src/app/_components/program-profile-settings.tsx), [subject willingness](../../src/app/_components/subject-availability.tsx) | Immediate switch, staged save, unknown/yes/no, unavailable provider, read-only and failed refresh ([#234](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/234))                                                                           | Does not turn unknown into No or merge independent mutation/version rules                                   |
| Change review: show the proposed consequence                     | [Approval evidence](../../src/app/_components/approval-review-details.tsx), [departure review](../../src/app/_components/school-departure.tsx)                                                                           | Before/after, acknowledgement, changed input invalidating preview, pending commit                                                                                                                                                                          | Does not generate confirmation tickets or replace immutable evidence                                        |
| Inline notice: recover alongside usable content                  | [Profile settings](../../src/app/_components/program-profile-settings.tsx), [availability](<../../src/app/(tutor)/_components/availability-editor.tsx>)                                                                  | Initial versus background failure, retained draft, successful Retry, explicit conflict Reload ([#233](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/233), [#223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223)) | Does not silently replace a version snapshot or repeat an accepted write                                    |

Specialized gallery recipes also cover [named action review](../../src/app/ui-gallery/action-review-recipe.tsx), [management summary alignment](../../src/app/ui-gallery/admin-summary-recipe.tsx), [manual-creation risk acknowledgement](../../src/app/ui-gallery/creation-risk-recipe.tsx) and [workload preference/review](../../src/app/ui-gallery/workload-preference-recipe.tsx). Each has a colocated behavior test. These are synthetic compositions: use the owning feature and the [technical code map](../reference/technical-report.md#architecture) for permissions, persistence, receipt keys and accepted-write recovery.

The named-action recipe also demonstrates a request receipt through the
`ReviewedAction.successMessage` option of `useActionReview`, following the active tutor opt-out in
[Settings](<../../src/app/(tutor)/settings/page.tsx>). Verify Cancel without a write,
the captured optional reason, pending protection and accepted-write read recovery.
The receipt acknowledges submission; membership remains active until the separate
staff decision. Follow the [consequential action inventory](implementation.md#consequential-action-inventory)
for the activation/request distinction and stronger domain safeguards.

The participant form's **Name requirement example → Application correction: retain
legacy names** case demonstrates the scoped `preserveLegacyRequiredFields` option.
An unchanged unsplit identity permits an alternate-language-only correction even
when current policy requires Last or Preferred Name. Editing a Latin name field
restores the complete configured requirements. Other profile forms retain their
existing requirements. The real [application correction editor](../../src/app/_components/application-identity-correction.tsx)
owns permission checks, captured versions, approval and read-only recovery;
the gallery performs no write and does not establish promotion readiness. Verify
the gallery case and the actual Applications page in English and Chinese at
desktop and mobile widths.

For a recipe migration, link its feature issue and the corresponding running-page
and gallery screenshots in the local verification report. Record language, viewport,
role and state for each capture; keep the images and report in ignored `outputs/`.
