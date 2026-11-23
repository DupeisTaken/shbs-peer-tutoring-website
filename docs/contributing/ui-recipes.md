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
| Navigation and registration: distinguish routes from local steps | [Public header](../../src/app/_components/public-header.tsx), [workspace header](../../src/app/_components/workspace-header.tsx), [brand mark](../../src/app/_components/brand-mark.tsx), [tutee navigation](../../src/app/student/navigation.tsx), [invitation flow](../../src/app/register/register-flow.tsx) | One utility instance, theme-inheriting `BrandMark`, keyboard `.skip-link`, wrapping labels, native Back/Forward, numbered progress and focused headings ([#221](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/221)) | The demo does not verify identities; features own proof invalidation, draft lifetime and server permissions |
| Long dialog: keep a large editor or reader usable                | [Profile editor](../../src/app/_components/profile-dialog.tsx), [policy reader](../../src/app/_components/current-policy-dialog.tsx), [time availability](<../../src/app/(tutor)/_components/time-availability.tsx>), [qualification requests](<../../src/app/(tutor)/_components/qualification-requests.tsx>) | Nested Escape/Tab, exact focus return, long scroll, pending dismissal, rejection, entrance-card retained drafts ([#231](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/231))                                                   | Does not decide consent, review consequences or write authorization                                         |
| Participant form: group one identity save                        | [Account](../../src/app/_components/account-profile-editor.tsx), [tutor](../../src/app/_components/tutor-profile-editor.tsx), [tutee](../../src/app/_components/tutee-editor.tsx) editors                                | Editable, pending, failed and read-only; four-part/legacy names and retained drafts ([#232](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/232))                                                                                         | Academic, membership and historical-link writes retain separate drafts and versions                         |
| Filter toolbar: select which records to show                     | [Management actions](../../src/app/_components/management-actions.tsx), [account roster](<../../src/app/(admin)/admin/users/page.tsx>), [Help catalogue](../../src/app/help/catalogue.tsx)                                 | Selected filters, native search/select, reset/count, pending refresh and pagination reset ([#237](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/237))                                                                                   | Filters are not content tabs or commit actions                                                              |
| Disclosure: choose when content mounts                           | [Tutee creation](<../../src/app/(admin)/admin/tutees/page.tsx>), [tutor details](../../src/app/_components/tutor-details.tsx), [TranslationStrings](../../src/app/_components/translation-strings.tsx) | Closed/open, lazy read queries, retained drafts, collapse/reopen; translation namespace buttons expose expanded state and controlled regions while preserving row drafts | Does not infer a draft lifetime or grant detail access |
| Setting row: explain when a choice saves                         | [CAPTCHA](../../src/app/_components/program-captcha-settings.tsx), [Names and Grades](../../src/app/_components/program-profile-settings.tsx), [subject willingness](../../src/app/_components/subject-availability.tsx) | Immediate switch, staged save, unknown/yes/no, unavailable provider, read-only and failed refresh ([#234](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/234))                                                                           | Does not turn unknown into No or merge independent mutation/version rules                                   |
| Change review: show the proposed consequence                     | [Approval evidence](../../src/app/_components/approval-review-details.tsx), [departure review](../../src/app/_components/school-departure.tsx)                                                                           | Before/after, acknowledgement, changed input invalidating preview, pending commit                                                                                                                                                                          | Does not generate confirmation tickets or replace immutable evidence                                        |
| Inline notice: recover alongside usable content                  | [Profile settings](../../src/app/_components/program-profile-settings.tsx), [availability](<../../src/app/(tutor)/_components/availability-editor.tsx>), [announcements](<../../src/app/(tutor)/_components/announcements-banner.tsx>), [student workspace](../../src/app/student/student-workspace.tsx) | Initial versus background failure, retained draft, successful Retry, explicit conflict Reload, optional `title`, `accent` tone and green semantic `success` ([#233](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/233), [#223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223)) | Does not silently replace a version snapshot or repeat an accepted write                                    |

Specialized gallery recipes also cover [named action review](../../src/app/ui-gallery/action-review-recipe.tsx), [management summary alignment](../../src/app/ui-gallery/admin-summary-recipe.tsx), [manual-creation risk acknowledgement](../../src/app/ui-gallery/creation-risk-recipe.tsx), [invitation and email codes](../../src/app/ui-gallery/code-recipe.tsx), [route error and localized recovery](../../src/app/ui-gallery/error-recovery-recipe.tsx), [unified summary cards and dynamic combine selection](../../src/app/ui-gallery/pairing-card-recipe.tsx), [navigation and header branding](../../src/app/ui-gallery/navigation-recipes.tsx) and [workload preference/entrance-card editing](../../src/app/ui-gallery/workload-preference-recipe.tsx). Each has a colocated behavior test. These are synthetic compositions: use the owning feature and the [technical code map](../reference/technical-report.md#architecture) for permissions, persistence, receipt keys and accepted-write recovery.

The named-action opt-out example matches the real Tutor/Crew red actions and
opt-in three-second review pause. Check immediate Cancel, a fresh pause after
reopening, and explicit confirmation after zero. The pause is presentation only;
features keep their server tickets, membership approval and seven-day cooldown.

The inline-feedback recipe includes [narrow notice examples](../../src/app/ui-gallery/notice-layout-examples.tsx)
with long shared/native buttons, a navigation link, a wrapping action group and
no action. Check every tone (`info`, `warning`, green semantic `success`, `error`,
and theme-following `accent`), optional `title`, explicit alert/status or no
announcement, and pending controls in English and Chinese across all six accent
palettes. Its bounded card checks a narrow container at desktop breakpoints;
resize the real viewport separately for mobile targets and enlarged text.
Recovery changes only a local counter. Verify the actual Patrol History,
Corrections and [AnnouncementsBanner](<../../src/app/(tutor)/_components/announcements-banner.tsx>)
surfaces as well; the example establishes no feature read, draft, version or
write behavior.

The [route error and localized recovery recipe](../../src/app/ui-gallery/error-recovery-recipe.tsx)
exercises `formatClientError` from [client-error-message.ts](../../src/lib/client-error-message.ts)
across tRPC error codes, network errors and fallback copy alongside a synthetic
preview of [RouteError](../../src/app/error.tsx) (`StatePanel` + `FormActions`
with primary Retry and secondary Home link) and `.eyebrow` metadata kickers.
Check that raw server internals never leak into displayed recovery messages in
English or Chinese. [GlobalError](../../src/app/global-error.tsx) remains the
standalone provider-free root-layout safety net.

The [invitation and email codes recipe](../../src/app/ui-gallery/code-recipe.tsx)
composes `CodeInput`, `CodeDisplay` and synthetic lifecycle metadata matching
[Registration codes](<../../src/app/(admin)/admin/registration-codes/page.tsx>)
and [Register flow](../../src/app/register/register-flow.tsx). Verify green
invitation vs blue email purpose tints, legacy-format entry, accessible errors,
source badges (`Interview`, `Accepted application`, `Crew application`), bound
email wrapping and amber unavailable reasons; the gallery issues no codes or
credentials.

The [workload preference and entrance-card recipe](../../src/app/ui-gallery/workload-preference-recipe.tsx)
matches the tutor Preferences entrance-card composition in
[TimeAvailability](<../../src/app/(tutor)/_components/time-availability.tsx>)
and [QualificationRequests](<../../src/app/(tutor)/_components/qualification-requests.tsx>):
a summary card with a trailing `↗` action opens a wide `ProfileDialog` that
retains independent unsaved drafts across close/reopen and restores opener
focus, paired with the advisory workload-over-preference confirmation dialog.

The [unified summary card and dynamic combine recipe](../../src/app/ui-gallery/pairing-card-recipe.tsx)
demonstrates the unified 50/50 split card layout alongside
[TutorPairings](<../../src/app/(tutor)/_components/tutor-pairings.tsx>): header
text links placed ahead of boxed compact buttons, compact content-sized
`field-auto-bounded` selects with optgroups on the left, `RoomAllocationStatus`,
distinct per-row student entries with direct `TableDetails` triggers on the
right, and combine-mode selection that hides checkboxes at rest, dynamically
greys out incompatible cards and auto-selects required companion cards with an
explanatory `InlineNotice`. All state is local and synthetic; production
features own pairing eligibility, scheduling conflicts, room allocation and
versioned writes.

The management summary recipe also uses the production `RoomAllocationStatus`
reader. Check fixed and automatic room names followed by their status, long
translated names wrapping at narrow widths, and distinct shortage, intentional
roomless and awaiting-schedule states. An unscheduled fixed-room choice must not
appear as a reservation. Verify the tutor/tutee arrangements and management pairing
details as well as the gallery; these synthetic examples do not allocate rooms.

The [notification preference recipe](../../src/app/ui-gallery/notification-preferences-recipe.tsx)
uses the production account fields with consistent description and channel tracks.
Descriptions and controls stack when two 18rem tracks cannot fit; each channel
reserves at least 8rem before stacking. Track minimums follow enlarged text as well
as available width. The fields reserve equal badge/email columns across every category,
including email-only reminders; channels stack when narrow space or enlarged text
cannot fit both columns. Required-choice explanations are screen-reader-only;
checked, disabled checkboxes convey the visible state. Verify independent badge/email
choices, staged Save/Cancel, retained badge editing with program email off, and the
email-only reminder row in English and Chinese at desktop and mobile widths. The
gallery stores synthetic local state only; production settings own persistence,
reviewer eligibility, queued-mail cancellation and accepted-save read recovery.

The [management review evidence recipe](../../src/app/ui-gallery/management-review-recipe.tsx)
uses the production `ApprovalReviewDetails`, `ReviewDisclosure` and
`AuditChangeSummary` readers with local captured fixtures. Its selector covers one
attendance status/reason change with eleven unchanged students, staging a feature
default override, clearing a pending override, exact multiline publication text
and a batch of 75 audit comparisons. Assignment examples additionally cover a
changed tutor/room/schedule, added and removed learners with the same display name,
missing historical labels, and an unchanged request. Verify request and section collapse separately:
the affected-record/outcome summary stays visible, nested expanded state and the
decision-note draft survive reopening, and simulated pending confirmation blocks
request collapse. The selector and pending checkbox change only local examples;
the recipe mounts no query, generates no approval ticket and grants no authority.
Check the real Management Actions and Audit pages as well as the gallery in EN/ZH
at desktop and mobile widths; fixtures do not establish server replay or privacy.

The named-action recipe also demonstrates a request receipt through the
`ReviewedAction.successMessage` option of `useActionReview`, following the active tutor opt-out in
[Settings](<../../src/app/(tutor)/settings/page.tsx>). Verify Cancel without a write,
the captured optional reason, pending protection and accepted-write read recovery.
The receipt acknowledges submission; membership remains active until the separate
staff decision. Follow the [consequential action inventory](implementation.md#consequential-action-inventory)
for the activation/request distinction and stronger domain safeguards.

Its access-revocation example also supplies the existing Restore control as a
feature-owned `returnFocusFallback`. When revocation disables the original opener
and removes the review, focus reaches Restore. A usable opener or remaining parent
dialog still takes priority. Check that fallback recovery alongside the real
Signup Requests account-read failure; the gallery grants no management authority.

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

The [agenda event recipe](../../src/app/ui-gallery/agenda-event-recipe.tsx) uses
the production card and semantic badges for regular/extra sessions, interviews and
meetings. Its attendance button changes local example state only. Check wrapping,
all six accents and English/Chinese at desktop/mobile sizes; real tutor/tutee pages
retain their own action eligibility, filtering and attendance/vote controllers.

For a recipe migration, link its feature issue and the corresponding running-page
and gallery screenshots in the local verification report. Record language, viewport,
role and state for each capture; keep the images and report in ignored `outputs/`.
