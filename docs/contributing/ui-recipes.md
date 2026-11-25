# Gallery recipes

These examples compose real shared controls with synthetic state at `/ui-gallery`.
Use them beside a production caller with the same lifetime and consequence. See
[interaction patterns](interaction-patterns.md) and
[verification](verification.md#ui-pattern-gallery).

## Gallery compositions

The core compositions in [recipes.tsx](../../src/app/ui-gallery/recipes.tsx) (plus
[SortingExample](../../src/app/ui-gallery/sorting-example.tsx) in
[gallery.tsx](../../src/app/ui-gallery/gallery.tsx)) support English and Chinese;
verify at real desktop and mobile viewports. The global form-state selector drives
the participant form example; other recipes expose their own state transitions.

| Recipe and intent | Production references | States to verify | Boundary / non-goal |
| --- | --- | --- | --- |
| Navigation and registration: routes vs. local steps | [PublicHeader](../../src/app/_components/public-header.tsx), [WorkspaceHeader](../../src/app/_components/workspace-header.tsx), [BrandMark](../../src/app/_components/brand-mark.tsx), [student navigation](../../src/app/student/navigation.tsx), [RegisterFlow](../../src/app/register/register-flow.tsx) | Single utility set, official PT logo `BrandMark`, `.skip-link`, wrapping labels, Back/Forward, numbered progress and focused headings | No identity verification; features own proof invalidation, drafts and permissions |
| Long dialog: large editors and readers | [ProfileDialog](../../src/app/_components/profile-dialog.tsx), [CurrentPolicyDialog](../../src/app/_components/current-policy-dialog.tsx), [TimeAvailability](<../../src/app/(tutor)/_components/time-availability.tsx>), [QualificationRequests](<../../src/app/(tutor)/_components/qualification-requests.tsx>) | Nested Escape/Tab, exact focus return, long scroll, pending dismissal, rejection, entrance-card retained drafts | Does not decide consent, consequences or write authorization |
| Participant form: grouped identity save | [Account](../../src/app/_components/account-profile-editor.tsx), [tutor](../../src/app/_components/tutor-profile-editor.tsx), [tutee](../../src/app/_components/tutee-editor.tsx) editors; [application correction](../../src/app/_components/application-identity-correction.tsx) | Editable, pending, failed, read-only; four-part/legacy names, retained drafts, and `preserveLegacyRequiredFields` for application corrections | Academic, membership and historical-link writes keep separate drafts and versions |
| Filter toolbar & sortable tables | [ManagementActions](../../src/app/_components/management-actions.tsx), [Users & Roles](<../../src/app/(admin)/admin/users/page.tsx>), [Help catalogue](../../src/app/help/catalogue.tsx), [SortingExample](../../src/app/ui-gallery/sorting-example.tsx) | Selected filters, native search/select, reset/count, pending refresh, pagination reset, 3-state column sorting (`asc` → `desc` → incoming) | Filters are not content tabs or commit actions |
| Disclosure: explicit mount lifetime | [Tutee creation](<../../src/app/(admin)/admin/tutees/page.tsx>), [TutorDetails](../../src/app/_components/tutor-details.tsx), [TranslationStrings](../../src/app/_components/translation-strings.tsx) | Closed/open, lazy reads, retained drafts across collapse/reopen, accessible `aria-expanded` and controlled regions | Does not infer draft lifetime or grant detail access |
| Setting row: explicit save boundary | [CAPTCHA](../../src/app/_components/program-captcha-settings.tsx), [Names & Grades](../../src/app/_components/program-profile-settings.tsx), [SubjectWillingness](../../src/app/_components/subject-availability.tsx) | Immediate switch, staged save, unknown/yes/no, unavailable provider, read-only and failed refresh | Never turns unknown into No or merges independent version rules |
| Change review: proposed consequence | [ApprovalReviewDetails](../../src/app/_components/approval-review-details.tsx), [SchoolDeparture](../../src/app/_components/school-departure.tsx) | Before/after diff, acknowledgement, changed input invalidating preview, pending commit | Does not issue confirmation tickets or replace immutable evidence |
| Inline notice: recover beside usable content | [Profile settings](../../src/app/_components/program-profile-settings.tsx), [Availability](<../../src/app/(tutor)/_components/availability-editor.tsx>), [AnnouncementsBanner](<../../src/app/(tutor)/_components/announcements-banner.tsx>), [StudentWorkspace](../../src/app/student/student-workspace.tsx) | Initial vs. background failure, retained draft, Retry, conflict Reload; all 5 tones (`info`, `warning`, `success`, `error`, `accent`), optional `title`, wrapping action groups ([notice-layout-examples.tsx](../../src/app/ui-gallery/notice-layout-examples.tsx)) | Never silently replaces a version snapshot or replays an accepted write |

## Specialized recipes

Each specialized recipe has a colocated behavior test and uses synthetic state
only. Always verify real permissions, receipts, versions and persistence on the
owning production pages alongside the [architecture map](../reference/technical-report.md#architecture).

| Recipe | Production reference | What to verify |
| --- | --- | --- |
| [Named action review](../../src/app/ui-gallery/action-review-recipe.tsx) | Tutor/Crew opt-out ([Settings](<../../src/app/(tutor)/settings/page.tsx>)), named deletions | Red destructive action, opt-in 3-second review pause, `successMessage` receipt vs. applied change, `returnFocusFallback` on access revocation, rejected write and read-only refresh recovery |
| [Management summary alignment](../../src/app/ui-gallery/admin-summary-recipe.tsx) | `RoomAllocationStatus` in tutor/tutee/management views | Fixed/automatic room names with inline status badge wrapping, shortage vs. roomless vs. awaiting-schedule (never implying reservation) |
| [Manual-creation risk gate](../../src/app/ui-gallery/creation-risk-recipe.tsx) | New Pairing, Add a Tutee, Add Tutor | Fresh unchecked acknowledgement on every open, disabled Continue, Cancel/Escape without writes, retained editor drafts |
| [Invitation and email codes](../../src/app/ui-gallery/code-recipe.tsx) | [Registration codes](<../../src/app/(admin)/admin/registration-codes/page.tsx>), [RegisterFlow](../../src/app/register/register-flow.tsx) | Green invitation vs. blue email tints, legacy-format entry, source badges (`Interview`, `Accepted application`, `Crew application`), bound email wrapping, amber unavailable reasons |
| [Route error and recovery](../../src/app/ui-gallery/error-recovery-recipe.tsx) | `formatClientError` ([client-error-message.ts](../../src/lib/client-error-message.ts)), [RouteError](../../src/app/error.tsx), [GlobalError](../../src/app/global-error.tsx) | Plain-language tRPC/network fallback copy without raw internals, `StatePanel` + `FormActions` Retry/Home, `.eyebrow` kickers |
| [Unified pairing cards & combine](../../src/app/ui-gallery/pairing-card-recipe.tsx) | [TutorPairings](<../../src/app/(tutor)/_components/tutor-pairings.tsx>) | 50/50 split card, header text links ahead of boxed actions, `field-auto-bounded` optgroup selects, per-row `TableDetails`, dynamic combine dimming incompatible cards and auto-selecting companions |
| [Navigation & header branding](../../src/app/ui-gallery/navigation-recipes.tsx) | Public/workspace headers and step bars | Theme-inheriting `BrandMark`, 32 px desktop / 44 px narrow controls, wrapping labels |
| [Workload & entrance cards](../../src/app/ui-gallery/workload-preference-recipe.tsx) | [TimeAvailability](<../../src/app/(tutor)/_components/time-availability.tsx>), [QualificationRequests](<../../src/app/(tutor)/_components/qualification-requests.tsx>) | Entrance card with trailing `↗` opening wide `ProfileDialog`, retained unsaved drafts across close/reopen, opener focus return, advisory over-preference confirmation |
| [Notification preferences](../../src/app/ui-gallery/notification-preferences-recipe.tsx) | Account notification settings | Equal badge/email columns (including email-only reminders), 18rem/8rem responsive tracks, staged Save/Cancel, retained badge edits when program email is off |
| [Management review evidence](../../src/app/ui-gallery/management-review-recipe.tsx) | `ApprovalReviewDetails`, `ReviewDisclosure`, `AuditChangeSummary` | Attendance/feature/assignment diffs, 75-item audit batch, separate request/section collapse retaining decision-note drafts, pending confirmation blocking collapse |
| [Agenda events](../../src/app/ui-gallery/agenda-event-recipe.tsx) | Tutor/tutee dated agenda cards | Regular/extra sessions, interviews and meetings, semantic badges, wrapping across all 6 accents and EN/ZH |
| [Selectors & dropdown menus](../../src/app/ui-gallery/selector-recipe.tsx) | `LanguageSwitcher`, filter toolbars, forms, `CheckboxListbox`, `HeaderMenu`, `ThemeSwitcher`, `UserAvatar`, `MultiFilter` | Standard full-width `.select` with long translated options, compact `.select.control-compact` + `field-auto` (`32 px` desktop / `44 px` mobile), disabled & `aria-invalid` states, short & long grouped `CheckboxListbox` (bounded scroll, search, `Selected only`, removable summary pills), sculpted `.popover-surface` menu with `DetailsAutoClose` |

For UI migrations, store local before/after screenshots (desktop/mobile, EN/ZH) in
ignored `outputs/` and follow [verification](verification.md#verify-and-document-a-ui-change).
