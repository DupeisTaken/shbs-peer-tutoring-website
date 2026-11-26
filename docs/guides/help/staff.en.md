# Manage the Program

Generated from the website help catalogue. Edit the content records, then run `npm run help:export`.

[Catalogue & capture provenance](README.md)

Screenshot source: `8540496ad9f7c9e64c436270e5e466724c58bb81`. Help screenshots are baked automatically in GitHub Actions runners from production builds using synthetic demo data.

This GitHub training copy includes role-specific instructions. Signing in and current program permissions are still required to use the corresponding website features. All examples are synthetic.

- [Find daily management work](#find-daily-management-work)
- [Match a tutoring request](#match-a-tutoring-request)
- [Flag, clear or appeal an invalid signup](#flag-clear-or-appeal-an-invalid-signup)
- [Review tutor applications and correct names](#review-tutor-applications-and-correct-names)
- [Assign and complete an interview panel](#assign-and-complete-an-interview-panel)
- [Compare qualifications and tutoring willingness](#compare-qualifications-and-tutoring-willingness)
- [Grant or remove a manual subject qualification](#grant-or-remove-a-manual-subject-qualification)
- [Inspect and edit the tutor roster](#inspect-and-edit-the-tutor-roster)
- [Inspect and edit the tutee roster](#inspect-and-edit-the-tutee-roster)
- [Create or edit a teaching assignment](#create-or-edit-a-teaching-assignment)
- [Allocate rooms and resolve shortages](#allocate-rooms-and-resolve-shortages)
- [Maintain recurring time slots](#maintain-recurring-time-slots)
- [Maintain rooms and unavailable periods](#maintain-rooms-and-unavailable-periods)
- [Maintain subjects, groups and levels](#maintain-subjects-groups-and-levels)
- [Review tutor opt-out and reentry](#review-tutor-opt-out-and-reentry)
- [Review tutee withdrawals and removals](#review-tutee-withdrawals-and-removals)
- [Manage Crew applications and patrol settings](#manage-crew-applications-and-patrol-settings)
- [Create meetings and record attendance](#create-meetings-and-record-attendance)
- [Inspect and correct lesson attendance](#inspect-and-correct-lesson-attendance)
- [Review patrol evidence and attendance flags](#review-patrol-evidence-and-attendance-flags)
- [Review disciplinary cards and appeals](#review-disciplinary-cards-and-appeals)
- [Review feedback and tutee support](#review-feedback-and-tutee-support)
- [Read service-hour totals and breakdowns](#read-service-hour-totals-and-breakdowns)
- [Record or remove an hour adjustment](#record-or-remove-an-hour-adjustment)
- [Configure school-report recipients and delivery](#configure-school-report-recipients-and-delivery)
- [Read, print and export period reports](#read-print-and-export-period-reports)
- [Publish and maintain an announcement](#publish-and-maintain-an-announcement)
- [Edit website pages, news and images](#edit-website-pages-news-and-images)
- [Publish a policy revision and translations](#publish-a-policy-revision-and-translations)
- [Issue and share an account invitation](#issue-and-share-an-account-invitation)
- [Find accounts, participation and original records](#find-accounts-participation-and-original-records)
- [Edit names and academic profiles](#edit-names-and-academic-profiles)
- [Correct historical academic evidence](#correct-historical-academic-evidence)
- [Submit and follow a management proposal](#submit-and-follow-a-management-proposal)
- [Find an audit event and read exact evidence](#find-an-audit-event-and-read-exact-evidence)
- [Preview and apply supported admission recovery](#preview-and-apply-supported-admission-recovery)
- [Configure recruitment and next-period openings](#configure-recruitment-and-next-period-openings)
- [Set school days and no-tutoring notices](#set-school-days-and-no-tutoring-notices)
- [Configure signup fields, names and academics](#configure-signup-fields-names-and-academics)
- [Configure email, notification and access controls](#configure-email-notification-and-access-controls)
- [Prepare optional-feature changes](#prepare-optional-feature-changes)
- [Download and maintain help handbooks](#download-and-maintain-help-handbooks)
- [Review and change the program timezone](#review-and-change-the-program-timezone)

## Find daily management work

Use the management overview, activity queues and mobile navigation to find the next task.

Open: `/admin`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Open management** Choose Back to Management from the header or account menu, or Enter management when that label is offered. On a phone, open the menu below the brand to reveal the same groups.

   Look for: Start with the overview and the grouped navigation at the left.

2. **Open Activity** Read the named queues and open the relevant request. Check its period, current status and person before acting; a notification is a shortcut to the record, not a decision.

3. **Find the right record** Use the page search, filters and rightmost Actions column. A sortable heading cycles ascending, descending and original order. Clear filters when looking for missing records.

4. **Read the result** Saved means the live write completed. Submitted for Review means a Management Actions request exists and live records have not changed. Open that receipt to follow its decision.

### What happens next

You can identify a task, open its current record and distinguish an applied change from a pending proposal.

### How it works

Navigation follows both current permissions and effective feature switches. Read-only observers have a different, masked view and cannot submit management writes.

### Troubleshooting

- **A section or record is missing** Clear search and status/period filters. Check whether the module is enabled and your access still applies. Use Retry for a failed read; do not interpret an unavailable queue as empty.

## Match a tutoring request

Review verified demand, compare tutor qualifications and workload, then assign a subject choice.

Open: `/admin/requests`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the request tab** Open Signup Requests → Needs matching. Find the student in the list and expand the request. Check its source and verification labels, subject choices, available times and current answer revisions.

   Look for: Use Needs matching, then Select tutor on the relevant subject choice.

2. **Compare tutors** Choose Select tutor for one choice. Review qualification, willingness, availability, assigned teaching blocks and the tutor's preferred maximum. Preferred capacity is advisory; it is not an automatic prohibition.

3. **Review the assignment** Choose the intended tutor and inspect any qualification warning before continuing. Confirm the exact student, subject and period. Use normal matching before considering manual roster or pairing creation.

4. **Check the saved placement** Complete the review and read the save or approval receipt. Find applied assignments under Assigned and in Pairings. Recurring scheduling and room allocation remain separate steps.

### What happens next

The intended subject choice is assigned, or a clearly identified proposal waits for approval.

### How it works

Self-service, Staff-entered and Earlier signup describe provenance. Earlier signup means the entry source is unknown, not that it has older priority. The verified survey retains its original submission priority.

### Troubleshooting

- **A tutor cannot be selected or the request is blocked** Inspect the stated qualification, membership, verification, invalidity or period restriction. Fix that source through its owning workflow; changing filters or creating a duplicate request does not resolve it.

## Flag, clear or appeal an invalid signup

Record a reason, inspect status mail and resolve request-invalidity appeals without erasing evidence.

Open: `/admin/requests`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the exact request** Open Signup Requests or Tutor Applications. Use Request validity to find flagged or unflagged entries, then open the request before making a change.

   Look for: Find Request validity, Flag invalid and Review invalid flag on the request.

2. **Explain the flag or correction** Choose Flag invalid or Review invalid flag → Clear invalid flag. Enter a reason suitable for the submitter to read, review the named entry, then save or submit for review.

3. **Check email and appeals** Read the invalidity dialog's email state and latest appeal. Refresh status reads only. Admin/Head may retry an eligible failed status email and decide a tutee invalidity appeal after reading its full reason.

4. **Confirm the decision** An accepted tutee appeal clears the flag. Final rejection closes the active request and removes its priority. Check the retained history and resulting request state before continuing processing.

### What happens next

The current flag and any appeal decision are visible with their reasons and delivery status.

### How it works

A flag blocks processing but does not delete an entry or impose discipline. Clearing it preserves evidence and does not revive an expired request or restore membership. Verification deadlines continue while flagged; only request-specific mailbox proof permits disclosure of the reason.

### Troubleshooting

- **Status email is Blocked or the list did not refresh** Inspect the recorded address and the stated delivery restriction. Retry refresh reloads records after a completed save; it does not resend or repeat the decision. Pending Coordinator proposals send no invalidity notice until applied.

## Review tutor applications and correct names

Find current or completed applications, inspect setup status and correct initial application identity.

Open: `/admin/applications`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the application** At the top, search Name or email and use the application-status, requested-subject, interview-completion and sort filters. Application cards display explicit panel progress alongside accept and reject vote counts. The separate Interview records section searches applicants, panelists or subjects; choose Needs completion, Completed or All there, then Search. Panelist search belongs to that lower section.

   Look for: Use the application filters and expand the intended application.

2. **Read the evidence** Expand the record and inspect requested qualification, panel, chair, schedule, completion and account setup status. Open its existing panel link from interview history when relevant.

3. **Correct an initial name** For an eligible initial application, open the name-correction action, edit the four name fields and enter a reason. Review the before/after identity before saving or submitting a Coordinator proposal.

4. **Continue the proper workflow** Use panel assignment and interview review for qualification decisions. On an accepted initial application, Set up account opens a live status dialog showing the auto-issued invitation code, linked account and contextual links to Users & Roles and Registration Codes; a roster or accepted application is not itself a usable login.

### What happens next

The application and its interview/setup status are clear; any name correction has its own recorded reason.

### How it works

Name correction changes only the application name fields and reason. It does not accept the application, clear invalidity, change contacts or manufacture qualification/policy evidence.

### Troubleshooting

- **A completed interview or application cannot be found** Switch to completed or all records and clear status filters. History sorting happens before pagination; use the displayed page controls rather than assuming the first page is the complete list.

## Assign and complete an interview panel

Choose a qualified panel and valid chair, schedule the interview, then record its actual completion.

Open: `/admin/applications`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Select the panel** Open the applicant's panel editor. Choose 3–8 active account-linked tutors, including at least one with staff-confirmed qualification in an applicant subject. Select an Admin or Head panelist as chair, then review and save the panel.

   Look for: Expand the applicant to find panel assignment and interview management.

2. **Arrange the interview** The assigned chair opens Interviews to Conduct in Tutor Schedule and chooses Set Time. Enter the date and time in the program time zone. Each panelist submits their own vote.

3. **Record the decision** Open Votes & Decision in Tutor Applications to read the tally. After all panelists vote, an eligible chair follows the displayed majority or tie rules in Interviews to Conduct and confirms the decision from there.

4. **Complete actual attendance** Record actual completion time, duration and attending panelists. For a later correction, enter the reason and review replacement credits before applying or proposing the whole correction.

### What happens next

The saved panel, chair, schedule, votes, decision and completion remain attached to the application.

### How it works

A valid Admin/Head chair is required for new scheduling, decisions and first completion. Historical hour correction retains the recorded chair rather than rechecking today's rank. Qualification, tutoring willingness and account access remain separate.

### Troubleshooting

- **Panel or completion controls are blocked** Check active panel membership, recorded qualifications, the chair's current authority and the Interviews feature. History remains readable when interviews are off; writes wait until the module and eligibility permit them.

## Compare qualifications and tutoring willingness

Read direct and inherited qualification grants without confusing them with willingness or timetable availability.

Open: `/admin/subject-availability`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find and expand the tutor** Open Subject Availability below Tutor Roster. Search the tutor or subject and expand the tutor to see grouped subjects and named level variants.

   Look for: Expand a tutor and use Qualified, Pending Review or Willing to tutor.

2. **Apply one local filter** Choose Qualified, Pending Review or Willing to tutor for that tutor. Click the selected filter again to clear it; it combines with page-level search and filters.

3. **Inspect qualification sources** Read the direct approval and recorded inherited lower-level grants. Compare willingness separately: Not recorded means the tutor has not saved a choice.

4. **Use the correct follow-up** Open Edit details. Changing Willing to tutor saves immediately; Approve this subject and Remove approval source also submit immediately. Read the saved or Coordinator approval-request outcome before continuing. Admin/Head decide additional qualification applications separately. Check schedule and capacity independently when matching.

### What happens next

You can explain whether the tutor is qualified, willing, pending review and otherwise eligible for an assignment.

### How it works

Approving a higher variant records the lower offered levels at that time. Later catalogue reordering does not recalculate those grants. Archived subjects with recorded evidence remain visible. Qualification alone does not set willingness.

### Troubleshooting

- **The expected qualification is missing** Clear filters and inspect the recorded approval sources and active catalogue variant. Do not infer a grant from present-day level order; ask Admin/Head to review the actual evidence.

## Grant or remove a manual subject qualification

Review evidence and grant sources; keep qualifications independent of willingness and account badges.

Open: `/admin/subject-availability`

### Before you start

- Current management access. Admin/Head apply manual grants/source removals; Coordinators submit permitted changes for review. Additional qualification-application decisions use a separate Admin/Head workflow.

### Walkthrough

1. **Read the recorded grant** In Subject Availability, expand the tutor and locate the exact subject variant. Read its qualification evidence, existing approval sources and independent willingness before using the manual approval action.

   Look for: Expand the tutor and inspect the exact variant and its approval source.

2. **Check and grant the qualification** In Edit details, check the named tutor, subject and level. Inspect the group's lower levels, then choose Approve this subject to submit immediately. Admin and Head apply the grant directly. A Coordinator follows the pending proposal in Management Actions.

3. **Remove only the intended source** Open Edit details for the variant with direct approval. Read its direct and inherited sources before choosing Remove approval source, which submits immediately. Once the change is applied, reopen the record and check which qualifications still have another source.

4. **Verify willingness separately** Reload the tutor's qualifications and independently inspect the Willing to tutor value. Return to Tutor Applications for panel/interview evidence when needed.

### What happens next

The reviewed qualification decision is recorded with its source, without silently changing willingness.

### How it works

Manual grant/source removal and an additional qualification-application decision are separate operations. Neither restores suspended/revoked participation, creates a login or silently records tutoring willingness.

### Troubleshooting

- **Acceptance reports restricted participation** Review suspension, school departure and revoked tutoring access in Users & Roles. Restore access only through its authorized workflow, then retry the qualification decision from fresh evidence.

## Inspect and edit the tutor roster

Read profiles, status, qualifications and account evidence, or create a roster record after the manual-entry warning.

Open: `/admin/tutors`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose current or past records** Search the tutor's saved names and inspect the current/past filters. Read status and academic summary before opening View user details.

   Look for: Find Edit profile and View user details in the rightmost Actions column.

2. **Read or edit the profile** View details shows grouped subjects, qualification sources, willingness, login status and account policy history. Use Edit profile for permitted changes and review old enrollment academics separately from current account academics.

3. **Change roster status deliberately** Open Edit profile and use Status to choose a permitted roster state, then save that section. Review account access separately in Users & Roles. An archived roster, a revoked Tutor badge and an opted-out member represent different states.

4. **Create only when normal intake cannot** Choose Add Tutor, read the warning, check the acknowledgement and Continue. Complete the name fields marked required by the current form policy and optional Email/Grade, then choose Add Tutor. Read the saved or submitted-for-review result and inspect whether a separate account-setup step is needed.

### What happens next

The roster reflects only the reviewed profile or membership change; accountless records remain explicitly accountless.

### How it works

Opening details grants no role-edit permission. A linked login and historical ownership are distinct from current participation. Legacy unsplit full names can be preserved when unrelated profile fields are edited.

### Troubleshooting

- **Save rejects a name or the tutor has no login** If changing Latin name fields, provide the person's actual valid First Name; do not guess a split of an old full name. A missing email leaves manual creation accountless. Use the authorized setup workflow instead of creating another person.

## Inspect and edit the tutee roster

Use one details reader for enrollment, choices, contact and history; understand accountless records and manual creation.

Open: `/admin/tutees`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the enrollment** Choose Current, History or All Records and search saved first, last, preferred or additional-language names. Inspect the record's period rather than assuming one row represents all enrollments.

   Look for: Use Current, History or All Records, then View details at the right.

2. **Open full details** Choose View details in Actions. Read enrollment summary, first/second choices, email/account information and tutoring history. Use Previous/Next for history and Close to return to the same roster.

3. **Edit the right evidence** Use Edit Profile for permitted contact/profile changes. Admin/Head manage historical links and invitations there. Compare original enrollment academics with current account academics before correcting either.

4. **Use manual creation sparingly** For Add a Tutee, acknowledge the warning first, then enter names, academics and subject choices. Hide form preserves the draft during this visit; save or submit for review and verify the resulting roster entry.

### What happens next

The intended enrollment and history are visible; any edit or creation has a clear save/approval outcome.

### How it works

Accountless tutees remain in the roster. Historical ownership alone does not enable current-account verification. Observers see enrollment/subjects, while private contacts and history retain staff authorization.

### Troubleshooting

- **History failed or no email is available** Use Retry inside history; the rest of the details remain available. A missing address is not a failed account read. Check the source profile and authorized ownership link before offering verification or setup.

## Create or edit a teaching assignment

Review tutor, subjects, students and schedule; preserve saved groups and avoid duplicate manual creation.

Open: `/admin/pairings`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the existing assignment** Search/filter Pairings and open View details. Read the tutor, subject, students, schedule, room intent and explicit group membership before editing.

   Look for: Use View details or Edit in the Pairings table's Actions column.

2. **Edit the intended fields** Open Edit and choose the correct tutor, subject, students and recurring time. Search does not remove already selected students; inspect the complete selected list before saving.

3. **Review save or removal** Review named consequences, including affected group members and room changes. Confirm the intended change or the separate removal action, then read whether it applied or waits for approval.

4. **Create only when required** New Pairing first requires the manual-creation warning acknowledgement. Keep its draft open if a response is lost; retry the unchanged attempt to recover the saved pairing. Start a new attempt explicitly for another assignment.

### What happens next

The reviewed assignment is saved once, or its pending proposal is identifiable.

### How it works

Sharing a time or attendance submission does not combine independent bookings. Only explicit combined groups share the primary assignment's recurring schedule and planned room.

### Troubleshooting

- **An attempt already succeeded or the data changed** Reload the saved record instead of changing and replaying an accepted creation draft. For stale edits, explicitly reload current evidence and review again. Retry refresh only reads after a completed save.

## Allocate rooms and resolve shortages

Choose automatic, fixed or no-room intent and review batch allocation across all pairings.

Open: `/admin/pairings`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Read the room state** Open View details to distinguish Awaiting schedule, Needs room, No physical room and legacy unallocated records. Use Needs room to show actual shortages rather than every x badge.

   Look for: Inspect Room badges, Needs room and Auto assign all unassigned sessions.

2. **Choose room intent** Edit the pairing and select Automatic room allocation, a fixed staff-selected room, or No physical room. Review group subjects affected. A fixed room must be deliberately released to Automatic if desired.

3. **Retry or batch allocate** After capacity becomes available, retry the shortage or choose Auto assign all unassigned sessions. Review the full unfiltered reservation list; a combined group appears once. Confirm or submit for review.

4. **Check the result counts** Read assigned and still-unassigned counts and return to remaining shortages. Existing rooms, fixed choices, awaiting schedules and intentional no-room choices are preserved by the batch.

### What happens next

Each reviewed reservation has its current room state; remaining shortages stay visible for follow-up.

### How it works

A pending automatic-room proposal reserves nothing: allocation occurs on approval. Planned-room changes do not rewrite actual attendance locations. Automatic assignment must be effectively enabled and the batch is bounded to 500 pairing records.

### Troubleshooting

- **Saving leaves Needs room** The schedule may have saved successfully without capacity. Check room blocks and conflicting fixed reservations, then deliberately retry when capacity changes. Repeated unchanged retries do not create capacity or move fixed bookings.

## Maintain recurring time slots

Create, edit, deactivate/reactivate or delete timetable slots and inspect changes before they propagate.

Open: `/admin/time-slots`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Read existing slots** Open Time Slots and locate the relevant day/time in the list. Read its Active state and inspect the program timezone before entering clock times.

   Look for: Use the time-slot list and its named row actions.

2. **Create or edit** Use the add or edit action, enter the labelled day and start/end values, and read validation. Review which existing assignments may use the slot before saving.

3. **Deactivate or delete deliberately** In Edit, change the Active checkbox to deactivate/reactivate the slot and review the named change. Delete is a separate consequence-reviewed action. Save or submit the permitted Coordinator proposal as shown.

4. **Check dependent scheduling** After an applied change, inspect Pairings and relevant timetable displays. Read Retry recovery if a refresh failed instead of repeating the edit.

### What happens next

The reviewed slot and active state are visible with any required approval receipt.

### How it works

A shared slot is timetable configuration, not a dated attendance record. Review dependent schedules when changing it; historical actual lesson evidence retains its own recorded values.

### Troubleshooting

- **The form or list cannot reload** Keep the draft open and use Retry for the required read. If the source changed, use explicit Reload and reread the values. Do not create a near-duplicate slot to bypass the error.

## Maintain rooms and unavailable periods

Keep the room catalogue accurate and block unavailable periods before allocating lessons.

Open: `/admin/rooms`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the room** Open Rooms, locate the saved room name and choose Edit details to inspect its recurring unavailable periods. Check existing bookings in Pairings before changing room availability.

   Look for: Open room actions and the room-unavailability grid.

2. **Edit catalogue details** Use Add Room for a new name or the existing room's edit action to rename it. Review deletion separately and inspect affected-booking consequences. Use the room-order editor when changing allocation priority/order.

3. **Mark unavailability** Choose Edit details, then Add blocked period. Enter Day, Start time, End time and optional Reason, check the named room and range, then choose Save blocked period or the Coordinator's Submit request. Use Edit period for an existing block and review removal separately.

4. **Recheck pairings** Inspect affected Pairings and any remaining Needs room records. A room catalogue edit is not an instruction to silently move a staff-fixed booking.

### What happens next

The catalogue and blocked periods match the reviewed room availability.

### How it works

Planned allocation uses room capacity and booking constraints. Actual lesson location is recorded separately in attendance. Inspect the full room reader when a compact grid cell cannot show every detail.

### Troubleshooting

- **A reservation still conflicts** Open the pairing's room intent and identify fixed, automatic or intentional no-room state. Resolve the specific room/time conflict before retrying allocation; do not overwrite attendance to fix a planned booking.

## Maintain subjects, groups and levels

Search and batch-edit offered courses or import a reviewed catalogue without changing saved qualification history.

Open: `/admin/subjects`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the course group** Open Subjects & Levels and search the saved course/group/variant names. Inspect inactive entries as well as the currently offered catalogue.

   Look for: Use course search, group/level editors and visible-row batch selection.

2. **Edit an individual course or level** In the group editor choose the offered levels, then Save group; unselected levels become inactive. Select an offering again and save to restore it. Level-name and prefix fields save when you leave them; AP-score toggles and ordering arrows submit immediately. Read the saved or Coordinator review-request result after each change.

3. **Review batch selection** Select the intended visible courses. Choose Set level and/or Set status, check the selected count and hidden-selection notice, then choose Apply to N visible selected. This submits immediately; only visible selected courses change. Read the actual save or approval-request result.

4. **Import a catalogue deliberately** Read the import help and download the example before selecting a JSON or CSV file. Selecting a valid file immediately submits its parsed catalogue changes. A permitted Coordinator import queues a review request. Read the actual import result or error, then reload the course list after an applied change.

### What happens next

The intended catalogue changes are saved or queued, with existing qualification evidence retained.

### How it works

Saved qualification grants are snapshots of approved sources. Reordering levels does not retroactively grant or remove historical qualifications. Restoring an archived group/level remains subject to current management authority.

### Troubleshooting

- **Import validation fails or a batch contains the wrong courses** For an import error, correct the file using the displayed format before selecting it again. For a batch that has not been applied, use Clear selection or correct the visible selections. Inspect IDs/names again; a hidden selection may not match the current filter.

## Review tutor opt-out and reentry

Check pending membership requests, respect waiting periods and requeue affected students explicitly.

Open: `/admin/tutor-requests`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the pending request** In Tutor Status Requests, check the tutor, request type and reason. An opt-out may show the approval date and number of affected students. Check current membership in Tutor Roster and earlier decisions in the Audit Log if you have access.

   Look for: Find the pending tutor, request type, reason and available decision controls.

2. **Check eligibility and timing** Opt-out approval requires seven elapsed days; reentry has no seven-day wait. Confirm the request is still pending and membership has not changed since submission.

3. **Submit the decision** Check the tutor, reason and any affected students before choosing Approve or Deny. Both buttons submit immediately. Verify the updated roster after a direct decision or follow the Coordinator proposal in Management Actions.

4. **Requeue affected students** After an opt-out is applied, the prompt identifies any affected students. Choose Re-Queue Tutees to return them to matching, or Not Now to leave them for later review. Verify the signup queue and remaining pairings.

### What happens next

Membership changes only through the reviewed decision; student matching consequences are handled explicitly.

### How it works

A participant's request does not immediately end ACTIVE membership. Recall, withdrawal of an unapplied proposal and reversal of an applied decision are different actions with different authority.

### Troubleshooting

- **Decision is unavailable or stale** Check the elapsed waiting period and current membership. If another change superseded the request, decline the stale request and review the current roster rather than force-applying old evidence.

## Review tutee withdrawals and removals

Distinguish self-submitted withdrawal, tutor relay and disciplinary removal before deciding.

Open: `/admin/tutee-requests`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the correct request section** Open Withdrawal Requests & Removals. Separate self-submitted withdrawals from tutor-relayed requests and read the student, source, scope and submitted time.

   Look for: Read source, scope and effective date in Withdrawal Requests & Removals.

2. **Review effective timing** Read the approval-dependent effective date for a self-request. Tutor relays retain their own seven-day recall window and exact scheduled effective time; staff can cancel a relay before it takes effect.

3. **Decide the exact scope** Open the full reason and related participation evidence, review the affected choices or membership and confirm the appropriate approval, decline or cancellation action.

4. **Check the retained history** After an applied result, inspect current request status and affected assignments. Use resolved history to verify the source and timing rather than deleting old request evidence.

### What happens next

The correct withdrawal/removal scope and timing are recorded without confusing separate request types.

### How it works

Signup-invalidity appeals and disciplinary-card appeals are separate from withdrawal review. A reversal of applied participation consequences requires the current review authority and fresh evidence.

### Troubleshooting

- **The student's status changed while reviewing** Keep your note, reload the authoritative request and reread the affected scope. Do not treat a transient queue error as no pending work or submit an old decision after a confirmed conflict.

## Manage Crew applications and patrol settings

Review public applications, membership requests, the roster and patrol configuration in separate panels.

Open: `/admin/crew`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Review the application** Open Crew review work and inspect the verified application and current membership. Approve or decline the intended application after reading its reason and identity.

   Look for: Use the Crew review, roster and patrol-settings panels.

2. **Follow invitation setup** An approved public applicant still completes fresh mailbox verification and the shared invitation/account review before Crew access is added. Check the displayed setup status instead of assuming approval created a login.

3. **Review opt-out or reentry** Read membership requests separately. Opt-out approval waits seven days; reentry has no seven-day wait. Check recalls and the current member status before confirming.

4. **Edit patrol settings** Open the settings panel, review the labelled patrol requirements and save through the shown authority path. Read patrol history or use its correction workflow for an existing observation.

### What happens next

Application, account setup, membership and patrol configuration remain clearly separated.

### How it works

Crew membership can coexist with Tutor access. Turning off the optional Crew module affects entry and actions; saved patrol and membership evidence remains historical evidence.

### Troubleshooting

- **An approved applicant cannot enter Patrol** Check invitation redemption, current ACTIVE Crew status, account suspension/departure and the effective Crew feature. Reissue/setup controls follow their own eligibility and do not bypass account review.

## Create meetings and record attendance

Maintain meeting details, excuses, per-meeting drafts and historical comparison by period.

Open: `/admin/meetings`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the period and meeting** Meetings starts in the current program period, including meetings already held. Open Meeting History and a labelled period for earlier records; Show past tutors changes people, not meeting periods.

   Look for: Open a meeting for attendance; use Meeting History for previous periods.

2. **Create a meeting or review deletion** In the current period, enter Meeting title, Date and Time, check the date and program timezone, then choose Create. Use a meeting's Delete action for its separate named confirmation; Cancel returns without deleting it.

3. **Save attendance explicitly** Expand a meeting, choose each tutor's attendance status and inspect excuse evidence, then use that meeting's attendance save action. Collapsing the meeting does not save or discard its current-visit draft.

4. **Compare and correct** Use the period's totals/comparison to inspect outcomes. For a correction, review credits and related consequences as one change. If period grouping changes, review Reload groups before discarding drafts.

### What happens next

Meeting details and attendance have explicit saved results, with historical period evidence retained.

### How it works

Recorded attendance takes precedence over a tutor's present-day membership in historical views. Drafts are retained per opened meeting during this visit; a browser reload is not draft storage.

### Troubleshooting

- **Save succeeded but totals did not refresh** Use the read-only Retry refresh; do not save the attendance a second time. Scroll the comparison table's own horizontal region on small screens to reach remaining columns.

## Inspect and correct lesson attendance

Read actual session evidence and submit a reasoned correction with its hours and discipline consequences.

Open: `/admin/attendance`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the submitted session** Open Attendance Submissions and use the available person/date/period filters. Read the actual time, room, tutor/student attendance, comments and any cards rather than relying on the recurring plan.

   Look for: Locate the lesson and open its full attendance details before correcting.

2. **Open the correction** Choose the authorized correction action and enter corrected actual values with a clear reason. Review the original and proposed evidence together.

3. **Review all consequences** Read any recalculated credits, flags, deductions or participation effects. Submit the complete correction through direct Admin/Head application or the eligible Coordinator review path.

4. **Verify related records** Check corrected attendance, Service Hours and affected discipline/flag history. A successful result followed by a failed read calls for Retry refresh, not another correction.

### What happens next

The actual attendance and dependent effects reflect the one reviewed correction, with its reason retained.

### How it works

Planned schedules and actual records are different evidence. A correction can reverse already reviewed effects, so the entire consequence set follows current review authority rather than applying safe-looking fields early.

### Troubleshooting

- **The historical record is locked or changed** Read the stated period, source or review restriction. Reload fresh evidence for a version conflict and use the supported correction route; never edit a planned pairing to imitate a historical correction.

## Review patrol evidence and attendance flags

Compare lesson and patrol evidence, decide a flag and correct an observation through its own workflow.

Open: `/admin/session-flags`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Read all evidence** Open Attendance Flags and inspect the lesson, claimed time/location and related Crew observations. Check observation times and headcounts; a mismatch needs human review.

   Look for: Open a flagged lesson to compare attendance and patrol observations.

2. **Record a reasoned decision** Open the flag review, read prior status and enter the required reason. Confirm only the displayed decision and any associated deductions or other consequences.

3. **Correct the source when necessary** If patrol evidence is wrong, open Crew patrol history and use its correction action with a reason. If attendance is wrong, use the lesson correction. Do not overwrite one source to conceal a mismatch in another.

4. **Verify recalculation** After the applied correction/decision, inspect the flag state and relevant hours. Later changes to reviewed deductions must follow current reversal authority.

### What happens next

The reviewed flag has a recorded outcome and each evidence source retains its own correction trail.

### How it works

A patrol observation is supporting evidence, not an automatic verdict. Correcting observations can reconsider related flags/deductions while preserving the saved patrol hours; it does not re-award Crew credit.

### Troubleshooting

- **The flag reappears or a correction awaits review** Read the latest underlying attendance/patrol versions and the correction receipt. A pending proposal changes no live evidence; resolve its review before assuming the flag was cleared.

## Review disciplinary cards and appeals

Inspect the complete lesson record, decide a card and handle school-day appeal deadlines.

Open: `/admin/discipline`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the card evidence** In Tutee Discipline, find the named card in Pending Review. Read its reason, issuer and recorded session context. Open View details in Tutee Standing to check the student's current effective cards.

   Look for: Open the card's review and full record before deciding.

2. **Review validation** Choose Edit on the named pending card. Check its reason and add relevant context in Review note (optional). Valid or Invalid submits the decision immediately. Changes to a prior decision follow current Admin/Head review rules.

3. **Open card appeals** In Tutee Support, open Tutee Appeals and select Pending. Read the card reason and appeal, choose Overturn Card or Reject Appeal, then enter a Decision Reason and submit. Use the School calendar in Program Settings link to check which days count as school days.

4. **Verify the resulting standing** In Tutee Standing, check the current status and choose View details to see the valid cards. Select Resolved in Tutee Appeals for any appeal decision. If standing shows removal pending, track the participation change separately in Withdrawal Requests & Removals.

### What happens next

The card and appeal have a reasoned current outcome, with historical evidence retained.

### How it works

Effective cards, not every submitted allegation, determine standing. School-calendar overrides affect the five-school-day disciplinary appeal window. Signup-invalidity appeals use the signup request's separate review.

### Troubleshooting

- **The deadline seems different from calendar days** Follow the school-calendar link to Program Settings → Recruitment and Refresh and inspect overrides. Do not extend an appeal by changing unrelated request dates; use the displayed authoritative deadline.

## Review feedback and tutee support

Keep feedback, private conversations and appeals in their own authorized views.

Open: `/admin/student-support`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the support panel** Open Tutee Support. Use Feedback for staff-authorized feedback, or Appeals for pending/resolved disciplinary appeals. Staff access to feedback is independent of the share-with-tutors setting.

   Look for: Choose Feedback or Appeals; each list keeps its own page controls.

2. **Read the full context** Read the name, subject, rating, full feedback and last update on the feedback card. For an appeal, read the card reason and appeal text on its entry. Use each list's own pagination when more records are available. Switching panels keeps current filters and drafts.

3. **Follow the appropriate response route** For an appeal, choose Overturn Card or Reject Appeal and enter a Decision Reason. For private follow-up, open Messages from the Feedback panel and select an allowed contact.

4. **Review tutor sharing separately** Check Allow assigned tutors to read tutee feedback. Changing the checkbox submits immediately for Admin/Head or requests review for a Coordinator. It applies to past and future feedback. Authorized staff can read feedback regardless of this setting.

### What happens next

You read staff-authorized feedback and route each support item to its own workflow.

### How it works

A feedback note and a disciplinary appeal are different evidence. Support visibility does not grant general access to private messages or unrelated students' records.

### Troubleshooting

- **A feedback item is absent** Check panel, period, pagination and current staff authorization, then Retry a failed read. For a tutor's missing feedback, inspect the separate share-with-tutors setting and current assignment ownership.

## Read service-hour totals and breakdowns

Compare full-period totals with the filtered tutor roster and inspect each credit or deduction.

Open: `/admin/service-hours`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Select the reporting period** Open Service Hours and choose the intended period. Read the complete program totals before narrowing the roster.

   Look for: Compare the period totals above the roster with its Active/Inactive/All filters.

2. **Filter the roster independently** Choose Active, Inactive or All, then filter records/no records in the period and search by name. A recorded zero or offsetting deduction still counts as a record.

3. **Switch Summary and Breakdown** Use Summary for totals and Details, or Breakdown for earned hours, extras and deductions. Open the person's details to inspect the source contributions rather than adding display subtotals together.

4. **Reveal hidden contributors** If Active hides people who contributed in the selected period, use the offered reveal action or All. On mobile, scroll inside the labelled table to reach the remaining columns.

### What happens next

You can explain both the complete period total and the shown roster subtotal using original records.

### How it works

Active/Inactive describes current membership, not historical-month status. The filtered subtotal covers shown rows; program totals cover the complete selected period. These views do not themselves issue school credit.

### Troubleshooting

- **Totals differ after filtering** Compare period, current-status and activity filters, then inspect All. Do not assume inactive contributors disappeared from program totals or school reports because a roster filter hides them.

## Record or remove an hour adjustment

Add a reasoned extra or punishment adjustment for the correct tutor and month.

Open: `/admin/hour-adjustments`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Check existing adjustments** Open Hour Adjustments and locate the tutor/month. Show past tutors is inside New hour adjustment; use it when the intended historical tutor is not offered in that dialog. Showing a person does not reactivate them.

   Look for: Use the creation action, then inspect Tutor, Month, Type, Amount and Reason.

2. **Enter the adjustment** Open New hour adjustment. Select Tutor, Month and Type, enter a positive amount in the form's half-hour increments, such as 0.5, and give a specific reason. Check whether the type adds or deducts hours, then choose Add. This submits immediately.

3. **Review a removal separately** Open an existing row's details to read its full reason. Use its delete/removal action only after reviewing the named adjustment and effect on totals; this is a reversal of saved evidence.

4. **Verify totals** Read the saved or approval result and inspect Service Hours for the same month. A successful write with a failed refresh uses read-only recovery.

### What happens next

One explained adjustment or reviewed reversal is reflected in the correct period totals.

### How it works

Adjustments are distinct source records. The creation draft survives closing/reopening during this visit, while navigating away or reloading does not store it.

### Troubleshooting

- **The amount looks wrong** Check the selected month, amount and Extra/Punishment type, then inspect source details. Correct the saved adjustment through its reviewed workflow; do not add compensating duplicates without understanding the original error.

## Configure school-report recipients and delivery

Save the recipient list and timezone, inspect delivery receipts and manage report-only links.

Open: `/admin/service-hours`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Edit the recipient draft** Under School reports, choose Add recipient and enter each school email plus optional internal label. Use Edit or Remove for existing entries. Finish or cancel the recipient editor before saving the schedule.

   Look for: Find recipient editing, the schedule and saved report delivery history.

2. **Review schedule and timezone** Review the timezone and default noon on the last day of the month, or set month-specific dates. Save through the displayed approval path. List edits remain drafts until this save; saving settings sends no report.

3. **Inspect an edition's delivery** Admin/Head can open School Delivery Status and check the state, attempts and any delivery notice. Retry delivery reuses the same saved edition and link when eligible. Report link opened records access separately from transport acceptance. Automated link checks can trigger it too.

4. **Manage report links** Admin/Head can revoke or replace a report-only link when appropriate. Recipients need no login, so treat the live URL as access to the report and share only with the intended school recipients.

### What happens next

The reviewed recipient/schedule settings and each edition's delivery state are visible.

### How it works

Automation starts off. Transport acceptance and a link visit do not confirm inbox reading or school entry; security scans/forwarding can create visits. Personal recipient reminders are independent of automatic monthly issuance.

### Troubleshooting

- **Automatic sending did not run** Check that the saved schedule is enabled, program mail and Service Hours are effective, recipients are valid and required accounting reviews are resolved. Read the saved edition's delivery state before retrying anything.

## Read, print and export period reports

Choose the right historical scope and privacy setting before printing or downloading report tables.

Open: `/admin/history`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose scope** Open Reports and select the intended period/report. Wait for the required records and inspect the report title and date scope before interpreting totals.

   Look for: Choose a period and report, then inspect masking and output controls.

2. **Inspect detail and privacy** Open relevant breakdowns and review the privacy/masking selection. Observer reports remain restricted; revealing a roster row elsewhere does not authorize private report data.

3. **Print or download** Use Print for the selected report and inspect print preview. Report-table CSV downloads require Admin/Head. Choose the intended table and retain its period/header context when sharing the file.

4. **Keep school posting separate** Use School reports in Service Hours for exact school posting instructions. General historical totals and program-record archives are not another instruction to credit the same hours.

### What happens next

The printed/exported report reflects the selected period and permitted data scope.

### How it works

CSV preserves numeric quantities and quotes commas, quotes and newlines. Formula-like text receives a protective apostrophe; preserve it when opening or moving the export between spreadsheet tools.

### Troubleshooting

- **A report prerequisite failed** Use the offered Retry to recover the selected report and its unavailable prerequisite. Keep the scope and masking choice; do not treat a partly loaded report as complete or export guessed totals.

## Publish and maintain an announcement

Preview the exact recipient snapshot, then publish, pin, edit or archive the announcement.

Open: `/admin/announcements`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Start a draft** Open Announcements and its creation action. Enter the title/body and relevant options. Closing and reopening preserves the draft during this visit; navigating away does not.

   Look for: Use the creation action and the audience's Include/Exclude controls.

2. **Review the audience** Choose the audience filters and individual Include/Exclude overrides. Open the recipient preview and read the fixed count and actual intended recipients before publishing.

3. **Publish and verify** Review the named announcement and publish or submit for review. Check the applied state and recipient snapshot; a pending proposal is not yet a published announcement.

4. **Maintain the saved record** Use Save for edits, Pin or Unpin for placement, and Deactivate or Reactivate for visibility. Read the Dismissed count and recipient information separately. Delete opens its own review.

### What happens next

A published announcement has the reviewed content and a recorded recipient snapshot.

### How it works

Audience preview captures recipients for the publication, so later role or roster changes are not a reason to assume the original audience changed. Acknowledgement, notification delivery and email transport are distinct signals.

### Troubleshooting

- **The expected recipient is absent** Review both group filters and individual exclusions, then refresh the intended recipient preview before publishing. If already published, inspect that edition's snapshot instead of assuming today's filter results describe it.

## Edit website pages, news and images

Use Landing Editor's independent tabs and language drafts, preview changes and publish deliberately.

Open: `/admin/landing`

### Before you start

- Current Coordinator/Admin/Head access and an explicit Translator assignment. Management rank alone does not grant Landing Editor access.

### Walkthrough

1. **Choose a content area** Open Landing Page and choose Layout, Main Page Content, Sections, Program News, Pages or Images. Use the arrow keys to move focus between tabs, then Enter or Space to open the focused tab.

   Look for: Use Layout, Main Page Content, Sections, Program News, Pages and Images tabs.

2. **Edit the current draft** Choose Language and edit the intended field. Fields with their own Save keep independent drafts across tabs and languages during this visit. In Pages, leaving a title or page-address field submits its change. Show in top nav submits immediately.

3. **Preview before publication** Open Preview to inspect the saved layout, titles, links and images. Editors can also see saved drafts and hidden sections in this preview. For an unsaved Markdown edit, use the inline Preview. Check links and image framing on small screens.

4. **Save, publish or restore** Use each area's Save or Publish control and verify the public page after the change applies. Use Archive or Restore for Program News and Show or Hide for custom pages. Applied content appears without a redeploy.

### What happens next

The public website reflects applied content while unrelated drafts remain independent.

### How it works

A custom page is public content, not a protected participant record or a replacement for the policy versioning workflow. Help Center is a maintained catalogue; the legacy FAQ URL redirects there.

### Troubleshooting

- **The preview is denied or a save is not public** Check both management access and explicit Translator assignment, then inspect the returned save/review state. Retry failed reads to recover drafts and verify the selected language. Repository policy edits do not publish site policies.

## Publish a policy revision and translations

Save reviewed English source, add translations and inspect exact archived versions and renewed acceptance.

Open: `/admin/policies`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the document** Open Policies and choose Tutor Policy or Tutee Policy. On a fresh site the editors begin blank; obtain the school's reviewed wording before publication.

   Look for: Choose Tutor Policy or Tutee Policy and the editing language.

2. **Save the reviewed English source** Choose English and review the document title, version and policy text. Admin/Head use Save to publish. Coordinators use Request Admin approval. Check the resulting version before adding translations.

3. **Save each translation** Choose another editing language, enter the reviewed translation and save it explicitly. Opened language drafts survive switching during the visit but are not stored by browser reload or navigation.

4. **Inspect exact history** Use Version History → View for the archived title/text in its recorded language. Check the published revision and participants' renewed-acceptance requirements without altering their previous signatures.

### What happens next

The intended version and language are published through the authorized workflow, and archived text remains readable.

### How it works

Policy acceptance records the exact accepted version, text, signature and time. A later revision does not overwrite the earlier acceptance; renewed acceptance is a separate participant action.

### Troubleshooting

- **Save succeeded but history or document cannot refresh** Use the separate read-only refresh action before editing again. Do not republish the same change merely because its history read failed. For a missing translation, verify the document and editing language.

## Issue and share an account invitation

Choose the authorized role, review binding/expiry, share an active card or export its image.

Open: `/admin/registration-codes`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the permitted invitation kind** Open Registration Codes. Admin/Head may issue Tutor, Crew, Admin or Coordinator invitations. Coordinators may request Tutor/Crew invitations for review, not management-rank grants. No code grants Head.

   Look for: Inspect the role on the invitation card and active/used/expired states.

2. **Check binding and issue** Select Kind, enter Label and optional Email, then check the role and recipient binding. For Admin/Head, Issue submits directly and emails any bound recipient best-effort when security mail is configured. Read the resulting expiry and Active status on the card or list. A Coordinator's issuance request remains pending until approved.

3. **Share the active card** Expand an active code and use its copy/share controls. Export Image downloads account-setup.png with only the setup card in the current language/accent; share it only with the intended recipient.

4. **Inspect status, source or revoke** The list also shows auto-issued codes with source badges (Interview, Accepted application, Crew application), Issued by, bound email, a View application link and Unavailable reason annotations (failed attempts, invalid or inactive application). Used/expired cards stay readable without sharing actions; Admin/Head can revoke an eligible code through the named review.

### What happens next

The intended active invitation or review receipt is visible, with the exact authorized role.

### How it works

The displayed invitation code authorizes inspection; separate mailbox verification proves the recipient. Existing accounts retain credentials and other access, adding only the authorized reviewed upgrade. Exporting changes neither code nor expiry.

### Troubleshooting

- **Image export fails or the recipient cannot redeem** Retry image export from the same active card; do not issue a new code just for a download failure. For redemption, inspect expiry, recipient binding and used/revoked status; mailbox proof remains a separate recipient step.

## Find accounts, participation and original records

Use Users & Roles filters and on-demand details to distinguish login readiness, badges and retained history.

Open: `/admin/users`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Combine search and filters** Open Users & Roles and search the person. Combine Role and Account filters, exclusions, historical-record visibility and unverified-account visibility. Tutor Status appears only for a Tutor-only included-role selection.

   Look for: Read User, Login setup, Roles & participation and Actions independently.

2. **Read login readiness separately** Distinguish Setup complete, Setup incomplete, Invitation pending and No direct login attached. A complete setup does not guarantee current access; suspension and participation status remain independent.

3. **Open User details** Read Login, Permissions and memberships, Attached participant profiles, Historical records and Combined records. Inspect exact account policy acceptance history and original enrollment academics without assuming names prove ownership.

4. **Choose the right account pathway** Use Which account pathway should I use? when deciding between setup invitation, Forgot password, existing-account membership, history-only access and Combine records. Do not create a second login to solve a setup-state problem.

### What happens next

You can identify the exact person, login state, independent capabilities and original evidence before editing.

### How it works

The directory has one row per explicitly combined person, including accountless profiles. Filters require one member to match the complete expression; they do not union different accounts' privileges. Tutor and Tutee memberships can coexist even when the compact row suppresses a redundant badge.

### Troubleshooting

- **A known person is hidden** Clear exclusions and check Show historical records, Show unverified accounts and Account setup filters. Clearing search alone does not clear other filters. Inspect original source records rather than assuming the person was deleted.

## Edit names and academic profiles

Save independent profile sections without replacing original enrollment evidence or other drafts.

Open: `/admin/users`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the exact source** Find the account or unlinked participant and open Edit profile. Compare current account academics with the participant's original enrollment evidence before deciding which profile needs correction.

   Look for: Open Edit profile and review each section's own Save action.

2. **Edit one section** Update the named fields in that section. For academic records, confirm grade and reference school year or explicit graduation/departure state; do not use the username's suffix as academic evidence.

3. **Save and wait for refresh** Use that section's Save and review the result. During any save the editor cannot close. After an accepted write, the section refreshes itself before becoming editable again; other section drafts remain independent.

4. **Review proposals explicitly** Follow a Coordinator proposal in Management Actions. A pending profile request does not change live identity, academics or participation. Close only after confirming all intended sections are saved.

### What happens next

Only the saved sections change, while original enrollment and unrelated drafts retain their own evidence.

### How it works

Legacy profiles can retain an unsplit full name when other fields change. Changing First Name, Last Name or Preferred Name requires a valid Latin First Name; Name in Another Language supports another writing system.

### Troubleshooting

- **A section stays read-only after saving** Use Retry refresh to read the accepted values without resubmitting. A version conflict's explicit Reload replaces only after the fresh read succeeds; inspect the new values before saving again.

## Correct historical academic evidence

Review original enrollment values and apply a validated single or CSV batch correction.

Open: `/admin/academic-corrections`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Find the historical source** Under Data & Recovery, open Academic Corrections, choose Tutor or Tutee and search the exact participant. Read original enrollment year, grade/reference year and any existing evidence gaps.

   Look for: Choose Tutor/Tutee records and inspect before/after evidence in the correction preview.

2. **Prepare the correction** Edit the intended historical fields and reason. For a batch, use the offered CSV format/export and keep its source fingerprints; the website and CSV share the validated preview.

3. **Review every before/after value** Inspect the full correction review, original sources and changed academic values. Admin/Head apply directly; a Coordinator submits the complete batch for review.

4. **Verify the accepted evidence** After the result, reread the historical record and its audit record. Check current-account academics separately; a historical correction is not permission to invent present-day enrollment data.

### What happens next

The reviewed historical values change atomically with source evidence and reason retained.

### How it works

Drafts retain exported fingerprints and are not silently rebased by background refresh. A batch is reviewed as one validated change; original enrollment values remain distinct from current account profiles.

### Troubleshooting

- **The CSV or preview is stale** Read the reported row/field errors. Reload fresh source evidence and regenerate/review the batch; do not strip fingerprints or retry old academic assumptions after a version conflict.

## Submit and follow a management proposal

Capture a permitted change, read its request receipt and withdraw an unapplied proposal when needed.

Open: `/admin/approvals`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Prepare the change in its own page** Edit the intended operation where its records live, inspect the proposed values and any offered consequence review, then choose the shown request/review action. Coordinator authority is explicit; an unavailable action is not a generic permission to propose it elsewhere.

   Look for: Use status/requester filters and open the exact request's evidence.

2. **Open the request receipt** When Submitted for Review appears, open its Management Actions link and verify requester, target, operation, submitted time and captured before/after evidence.

3. **Follow pending and resolved states** Use Status to follow your requests. Admin/Head can also filter Requester; Coordinators see their own requests. Read the decision and resulting record rather than assuming the requested change was immediately saved.

4. **Withdraw an unapplied request** If your pending proposal is no longer needed, check its exact target and choose Withdraw Request. This button submits withdrawal immediately. Reversing a live applied change requires the owning feature's reviewed reversal.

### What happens next

A clearly identified proposal has the intended evidence and an honest pending/resolved state.

### How it works

Pending proposals change no live records. Original submitted evidence stays immutable; current roles, policy and target versions are rechecked when a reviewer applies the request.

### Troubleshooting

- **The request is stale or rejected** Read the decision and changed evidence, return to the owning page, reload current values and submit a newly reviewed intent if still needed. Do not replay an old confirmation or submit duplicate proposals while waiting.

## Find an audit event and read exact evidence

Filter by stable actor, operation, record and displayed program dates; inspect stored values without reconstructing history.

Open: `/admin/audit`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Set the filters** Under Data & Recovery, open Audit Log and choose actor, event, operation, record or date filters. Date controls use the displayed program timezone. Actors with the same name remain separate stable accounts; removed users appear as Former account.

   Look for: Use the actor/event/operation/record/date filters, then Actions → Details.

2. **Open event details** Choose Actions → Details to inspect recorded actor/account IDs, target, operation, exact timestamp including UTC, approval link and undo time. A proposal and its applied action are separate events.

3. **Read captured values** Inspect the readable before/after fields and evidence. Use View stored JSON when exact types, field names or escaped text matter. Missing detailed evidence means it was not recorded, not that the current profile supplies it.

4. **Follow recovery separately** If a captured admission needs recovery, open the supported Recovery workflow or ask the technical operator using an exact record reference. Audit details and old Undo summaries do not establish a complete reversible chain.

### What happens next

You can cite the recorded event and distinguish known evidence from information never captured.

### How it works

Stored evidence is historical. Current names or roles do not rewrite the event's recorded actor; event summaries and detailed values have different limits. Observer summaries remain masked.

### Troubleshooting

- **Details failed or no evidence appears** Retry the event read without repeating its action. If the event explicitly lacks detail, document that limit and use other recorded sources; do not infer that nothing happened or invent before/after values.

## Preview and apply supported admission recovery

Inspect captured initial actions and their dependent consequences before any recovery is admitted.

Open: `/admin/recovery`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Identify the target** Under Data & Recovery, open Recovery and select the captured initial admission from recorded evidence. Use exact actor/record references from Audit Log or Database Records rather than a similar name.

   Look for: Choose the exact captured admission and inspect the complete recovery plan.

2. **Preview the complete plan** Read the original effect, later dependent actions and resulting before/after records. The website supports a complete plan with at most one later dependent action; longer chains require the operator CLI.

3. **Confirm through the authorized path** Enter the required recovery evidence/reason and review all consequences. Admin/Head apply an eligible plan; Coordinator submissions require review. Cancel if the preview does not establish the intended recovery boundary.

4. **Verify receipt and downstream state** After the accepted result, inspect the recovery receipt and affected records. Use read-only recovery after a refresh failure; unsupported chains should be handed to the technical operator with exact references.

### What happens next

Only a complete supported recovery plan is admitted, with its evidence and outcome recorded.

### How it works

Old one-click audit Undo is unavailable because legacy payloads do not prove the whole consequence chain. A read-only preview or database inspector does not itself change records or authorize an unsupported recovery.

### Troubleshooting

- **The plan is unsupported or changed** Read the named dependency/blocker and load a fresh plan. Do not selectively undo easy fields. Use the maintained recovery runbook/operator CLI for longer or unsupported chains.

## Configure recruitment and next-period openings

Review current intake, prepare destination-specific openings and publish the correct signup links/QR codes.

Open: `/admin/program`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the current period** Open Program Settings → Recruitment and Refresh and read the current period and displayed timezone. Inspect Tutor and Tutee intake separately, including acceptance, opening, closing and setup prerequisites.

   Look for: Open Recruitment and Refresh and distinguish current from next-period editors.

2. **Edit current recruitment** Use the current-period editor for the intended recruitment window. Review the saved dates/timezone and any independent acceptance switches before saving or submitting the permitted proposal.

3. **Prepare future openings** Use the separate next-period Tutor/Tutee editors. Confirm the named destination, choose an opening or an explicit clear, then save. An unset preparation preserves the destination's existing opening/default; clear removes only the opening restriction.

4. **Share the correct public entry** Use the signup preview links and public QR controls for the intended Tutor/Tutee/Crew or Home destination. Check the displayed destination and current recruitment notice before sharing. Official refresh activates prepared next-period openings together.

### What happens next

Current recruitment and future preparations are distinct saved settings with clear destinations and times.

### How it works

Preparing an opening does not refresh the program or bypass closing/acceptance/setup rules. Admin/Head apply preparation and timezone changes; Coordinators may submit permitted requests. Refresh itself remains Head authority.

### Troubleshooting

- **The target or preparation changed** Use explicit Reload, check the named destination and reread the saved values before reviewing again. After refresh use current-period editors; do not keep editing an obsolete preparation.

## Set school days and no-tutoring notices

Set date overrides and holiday ranges for the appeal calendar. Choose when a tutoring notice also pauses regular sessions.

Open: `/admin/program`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the calendar** Open Program Settings → Recruitment and Refresh. Holidays & Tutoring Pauses combines school-holiday ranges and tutoring pauses/notices in one sortable table alongside individual date overrides in the program timezone.

   Look for: In Recruitment and Refresh, find School calendar and no-tutoring notices.

2. **Save or remove an override** Choose the intended date and school-day value, then review and save through the shown authority path. Use the explicit remove/reset action to restore normal calendar behavior for a date.

3. **Add a holiday range** Choose Add holiday. Enter Start date, End date and a shared Staff note. The range includes both dates and weekends, up to 366 days. Check the No school count and the listed overrides and notes that saving will replace. Choose Save holiday to apply the range or Request Admin Approval to submit one Coordinator proposal.

4. **Create a notice or pause** Choose Add tutoring pause or notice and enter the starting date, inclusive ending date and participant-visible reason. A new range defaults to Pause regular tutoring, suppressing future ordinary sessions and clearing pending 24-hour automatic-acceptance deadlines; tutors use Arrange exception for explicit-agreement exceptions. Choose Notice only to inform without changing the schedule.

5. **Review existing commitments** Use Review impact to inspect affected published commitments before applying or removing a pause. Already confirmed extra lessons and agreed reschedules remain; inspect the impact review rather than assuming every lesson is cancelled. Edit an existing notice to change its ending date/reason; to change its identifying start date, remove it and create a new notice. View details shows the full reason.

### What happens next

Reviewed calendar overrides and notice/pause effects are saved with their exact date ranges.

### How it works

School-day overrides affect disciplinary appeal deadlines. A tutoring pause does not rewrite historical attendance or the appeal calendar. Overlapping notices remain independent, so removing one pause does not lift another.

### Troubleshooting

- **An existing date changed while you edited a holiday** Use Reload current range. Your dates and note stay in the form. Review the updated replacements before saving again. After a range is saved, Edit and Reset to normal still apply to individual dates.

- **Sessions remain paused after removing a notice** Inspect every overlapping pause and the exact inclusive range. Check whether the item was only a pending proposal. Do not change past attendance to make the plan match a new pause.

## Configure signup fields, names and academics

Set Required/Optional/Hidden fields, name presentation and academic confirmation without rewriting accepted evidence.

Open: `/admin/signup-forms`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Choose the form and field** Open Signup Forms and choose the intended form, such as Tutor signup. Read the current field requirements and choose Configure on the named row. Select Required, Optional or Hidden for that field.

   Look for: Choose the signup form and inspect each Required/Optional/Hidden choice.

2. **Review name and grade policy** Open Program Settings → Account Settings → Names and Grades. Check the name options in Display preview and review Offered grades for future confirmations. Expand Name Field Requirements to check Latin-letter and other name rules for each account type.

3. **Save the intended scope** Review the intended requirement in the field's Configure dialog. Admin/Head use Save to apply the setting. Coordinators use Submit for approval. Check the field row after a successful save.

4. **Preview actual signup** Open the affected public form after the setting applies. Check the field label, required marker and validation. For a shared account policy change, check the relevant account-profile editor too.

### What happens next

Only the reviewed form/profile requirements apply and participant-facing guidance matches them.

### How it works

Name display preferences do not alter original names, usernames or historical signatures. If every name field is hidden, the self-profile explains that state rather than presenting an empty Save form. Failed requirement reads must not substitute guessed defaults.

### Troubleshooting

- **A field still appears or saving is blocked** Confirm form kind, applied versus pending state and current policy read. Retry failed settings reads while keeping your draft; use explicit Reload for version conflicts before making another save.

## Configure email, notification and access controls

Review deployment status, required preferences, secondary-email binding, CAPTCHA and contact rules in their owning panels.

Open: `/admin/program`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect delivery before changing policy** Open Program Settings → Deployment Configurations → Email Notifications. Read Email Delivery Status for security and program mail; when Aliyun Direct Mail quota keys are configured, Admin/Head also see the Email Quota card (daily 200-email free usage and remaining balance) here and on the Overview dashboard. Open School Report Email Preview and check Email HTML or Plain Text. A preview sends nothing. Operators configure SMTP on the host.

   Look for: Use Account Settings and Deployment Configurations; each control saves independently.

2. **Review email and notification requirements** Read the consequences beside Enable email notifications. Changing that switch submits the delivery setting through your current authority. In Required notifications, review the locks you want to change and choose Save requirements or Cancel. Locks govern separate user preferences.

3. **Review account/access controls** Inspect secondary-email binding and CAPTCHA settings in their labelled controls, then save only the intended setting through its offered authority path. Role/user contact permissions require Admin/Head directly; Coordinators cannot propose contact-permission changes.

4. **Retry existing delivery carefully** Admin/Head can use Resend stuck emails for eligible failed or retrying deliveries. Read the result, then use Refresh status to confirm transport. Check access changes on the relevant sign-in, signup or messaging page.

### What happens next

Each intended communication/security setting has its own applied or proposal outcome.

### How it works

Essential account/request mail and optional program copies follow different rules. Transport acceptance is not proof of inbox delivery. Contact-permission configuration does not grant private-message supervision to Coordinators.

### Troubleshooting

- **Mail is still missing or CAPTCHA is unavailable** Read the exact saved status, recipient address and provider/host configuration error, then use the corresponding retry or operator setup. Repeated resends do not fix provider readiness or extend fixed verification deadlines.

## Prepare optional-feature changes

Compare effective and pending module switches and understand when official refresh activates them.

Open: `/admin/program`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Read the effective modules** Open Program Settings → Optional Features. Read the effective and pending states for the intended module, such as Crew, Interviews, Meetings, Service Hours or automatic room assignment.

   Look for: Open Optional Features and compare effective versus pending values.

2. **Prepare the intended switch** Set the switch to the intended next state. For Admin/Head this stages the change immediately. Coordinator changes go to Admin review. The current state stays effective until the official refresh activates the staged choice.

3. **Cancel a pending change deliberately** Switch the feature back to its effective state and check the returned state. Once the cancellation applies, the pending badge clears. If the save succeeded and the read failed, use Retry refresh.

4. **Review activation at refresh** The authorized official refresh review lists staged settings and participation consequences. After Head applies refresh, inspect the effective modules and relevant workspaces.

### What happens next

The next intended module state is explicitly staged without misrepresenting it as already active.

### How it works

Turning a module off preserves its historical evidence under existing read rules. Staging and official refresh are different operations; an Admin may prepare settings but cannot execute refresh without Head.

### Troubleshooting

- **A switch seems saved but the feature is unchanged** Compare effective and pending values and the current period. Wait for the authorized refresh rather than repeatedly saving. If the pending target changed, reload the preparation and review again.

## Download and maintain help handbooks

Get role-specific English/Chinese PDF handbooks and inspect the screenshot source and refresh procedure.

Open: `/admin/help`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Open handbook downloads** Open Help Center from the top bar and select PDF Handbooks (or open /admin/help directly). Visitors and participants can download handbooks for their own authorized collections; staff can distribute participant training handbooks, while Admin and Head editions follow current authority.

   Look for: Choose a permitted handbook audience and its English or Chinese PDF download.

2. **Choose language and audience** Choose the role handbook you need and select English or 中文 PDF. Each file is stamped with the download date and time in both its cover metadata and filename. Inspect its title, article list and screenshot captions before sharing.

3. **Check screenshot provenance** Read the guide's screenshot source details for capture revision, date and route. Screenshots are baked in GitHub Actions from production builds using synthetic demo data and packaged via the help-assets-latest release; captures.json in Git records the lightweight baseline.

4. **Keep the GitHub copy synchronized** Use the repository's generated help catalogue for GitHub reading and the maintained refresh instructions for screenshot/PDF updates. Change the shared content source and regenerate outputs together rather than editing an exported handbook independently.

### What happens next

The downloaded edition matches the chosen language/audience and its capture evidence is inspectable.

### How it works

The website, GitHub manual and PDFs derive from the same maintained article records. CI-baked production-build screenshots use synthetic demo data to illustrate controls; they do not grant permission to enter a restricted workflow.

### Troubleshooting

- **A handbook is unavailable or download is denied** Return to PDF Handbooks and check the editions allowed by your current authority. Retry a temporary download failure. If it continues, ask the operator to check the documented asset and font workflow; do not rename another role's file to imply it is the missing edition.

## Review and change the program timezone

Compare IANA region labels at a chosen preview date, then review the calendar and scheduling consequences before saving.

Open: `/admin/program`

### Before you start

- Sign in with current management access. Optional modules must be enabled. Coordinators submit permitted changes for review; Admin and Head apply non-refresh changes directly.

### Walkthrough

1. **Inspect the effective region** Open Program Settings → Recruitment and Refresh → Program Time Zone. Read the current IANA region and choose the proposed region. The UTC offset can vary with the preview date.

   Look for: Use Program timezone's Preview date and proposed-region selector.

2. **Compare seasonal examples** Change Preview date to inspect seasonal offsets and the current/proposed local-time examples. It compares the same 12:00 UTC reference instant in both regions; changing this preview date does not save a program setting.

3. **Acknowledge and save** Read the impact and acknowledge the effect on schedules and deadlines. Admin/Head use Save time zone. Coordinators use Request Admin Approval. To discard the draft, return to the effective region or choose Reload Current Settings.

4. **Recheck dated inputs** Verify the saved region in Program Time Zone. For an out-of-date Next-Period Recruitment draft, use Reload preparation before editing again. Check the region beside dated schedules or calendar inputs where shown.

### What happens next

The applied region and conversion examples match the reviewed timezone change or a clearly pending proposal.

### How it works

Weekly wall-clock slots retain their clock values and saved instants remain the same instants. The region controls their displayed calendar interpretation and date-input conversion. Ambiguous or skipped daylight-saving local inputs are rejected rather than guessed.

### Troubleshooting

- **A save is stale or a local date/time is rejected** Use explicit Reload to adopt the current region before reviewing again. For daylight-saving gaps/overlaps choose an unambiguous local time and inspect the named timezone; changing Preview date alone does not change the setting.
