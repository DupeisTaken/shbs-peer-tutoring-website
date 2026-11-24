# Tutor workspace

Generated from the website help catalogue. Edit the content records, then run `npm run help:export`.

[Catalogue & capture provenance](README.md)

Screenshot source: `8540496ad9f7c9e64c436270e5e466724c58bb81`. Help screenshots are baked automatically in GitHub Actions runners from production builds using synthetic demo data.

This GitHub training copy includes role-specific instructions. Signing in and current program permissions are still required to use the corresponding website features. All examples are synthetic.

- [Activate tutoring and find your next task](#activate-tutoring-and-find-your-next-task)
- [Set time availability and preferred session count](#set-time-availability-and-preferred-session-count)
- [Set subject willingness and request qualifications](#set-subject-willingness-and-request-qualifications)
- [Read your pairing and choose a weekly time](#read-your-pairing-and-choose-a-weekly-time)
- [Combine, repair or split recurring pairings](#combine-repair-or-split-recurring-pairings)
- [Record attendance for an ended tutoring session](#record-attendance-for-an-ended-tutoring-session)
- [Reschedule a session or add an extra lesson](#reschedule-a-session-or-add-an-extra-lesson)
- [Request cancellation of an agreed extra lesson](#request-cancellation-of-an-agreed-extra-lesson)
- [Vote on an interview or complete chair duties](#vote-on-an-interview-or-complete-chair-duties)
- [Review meetings and request an excuse](#review-meetings-and-request-an-excuse)
- [Manage tutoring participation and understand hours](#manage-tutoring-participation-and-understand-hours)
- [Read announcements, room schedules and learner standing](#read-announcements-room-schedules-and-learner-standing)

## Activate tutoring and find your next task

Confirm current participation, read action states and use the unified tutor workspace.

Open: `/dashboard`

### Before you start

- Your account has a linked tutor profile with tutoring access.

### Walkthrough

1. **Check activation and policy notices** Open Enter Tutor Page. If Pending, confirm whether you will participate using the displayed choice and review. Read and accept any current tutor policy before participation actions.

   Look for: Participation notice, Needs attention and workspace panels

2. **Use the four task panels** Schedule holds dated tutoring, interviews and meetings. Pairings holds recurring assignments. Preferences holds availability, workload and subject choices. History & hours holds retained evidence. Switching these local panels retains visited editors during the visit.

3. **Follow Needs attention** Open the task for an unconfirmed schedule, missing attendance, interview vote or meeting. Needs Action requires your work; Vote recorded / Awaiting decision means your vote is saved while the interview is still open.

### What happens next

You know your active status and can open the exact task that needs your action.

### How it works

Inactive tutors retain read-only history but cannot edit pairings or submit attendance. An Admin badge alone is not a tutor identity. Both /dashboard and /schedule render the tutor workspace; legacy section links preserve their destination without discarding an open editor.

### Troubleshooting

- **Tutoring controls are unavailable** Check status, current policy, academic confirmation, suspension, school departure and revoked access with management. Approval of an application alone does not restore a separate access revocation.

## Set time availability and preferred session count

Save weekly catalogue choices and a separate advisory workload preference.

Open: `/dashboard#tutor-preferences`

### Before you start

- You are an active tutor with current participation requirements satisfied.

### Walkthrough

1. **Open Edit availability** Open Preferences → My Time Availability and choose Edit availability to open the editor dialog. Select the catalogue weekday/time slots you can teach and choose Save Availability. Cancel restores the last loaded time selection; closing and reopening the dialog retains unsaved drafts.

   Look for: Weekday time choices and Save Availability

2. **Save Preferred Sessions separately** In the same dialog under Preferred Sessions, choose 0–4 or clear the preference, then use its own Save. Zero means prefer no assignments; an unset preference is different. Saving availability does not save this separate draft.

3. **Check the saved workload context** Compare assigned session-block count with the saved preference. Group changes refresh this count without replacing an unsaved preference. After an accepted save with failed synchronization use Retry refresh.

### What happens next

Saved availability and preferred workload each show their own accepted values.

### How it works

The preference is advisory: staff may assign above it and lowering it does not cancel an assignment. Becoming inactive resets it to locked zero; reactivation keeps zero until changed. A valid combined group counts as one block, while matching times alone do not combine assignments.

### Troubleshooting

- **Saved values changed elsewhere** Use Reload saved preference to deliberately replace only that stale draft. Failed saves retain your selection; read-only Retry refresh recovers a successful save without submitting again.

## Set subject willingness and request qualifications

Separate approved qualification, willingness and a pending additional-subject request.

Open: `/dashboard#tutor-preferences`

### Before you start

- Active tutors can change willingness or make eligible qualification requests; inactive tutors retain read-only history.

### Walkthrough

1. **Edit willingness for approved subjects** Open My Subject Willingness → Edit willingness. Choose Willing to Tutor or Unwilling to Tutor for each offered approved subject. Each choice saves immediately; check the result before continuing. Not recorded means no choice was saved.

   Look for: Subject Willingness and Subject Qualifications

2. **Request a new subject or higher level** In Subject Qualifications choose Request qualification to open the dialog, pick the subject/level, explain your qualifications and submit (closing and reopening keeps your unsaved draft). Under Your Requests use Pending, Approved, Rejected or Recalled filters and expand history to read decision notes and granted subjects.

3. **Recall an eligible pending request** Choose Recall request while Pending or Interview, review the named subject and confirm. A recalled request cannot be reopened or approved; submit a fresh request later when ready.

### What happens next

Current willingness is saved independently and request history shows its actual decision stage.

### How it works

Pending, rejected or recalled requests do not change existing qualifications. Admin/Head may approve directly with a decision note or assign an interview; interview rejection requires the authorized chair and votes. Approval captures lower offered levels at that time; later catalogue reordering does not change saved grants.

### Troubleshooting

- **A subject does not appear or duplicate request is blocked** Only saved approved qualifications appear in willingness. Review existing pending requests for that subject/level before submitting again. Ask management about missing catalogue or qualification evidence.

## Read your pairing and choose a weekly time

Use shared availability advice and confirm a schedule without double-booking.

Open: `/dashboard#tutor-pairings`

### Before you start

- You are active and own a current populated assignment.

### Walkthrough

1. **Inspect My Pairings** Open Pairings. Read each group's subjects, weekly time, room status and distinct tutees. Choose Details beside a tutee to inspect saved availability, verification deadline and pending reviews.

   Look for: Pairing schedule selector before the tutee list and Details

2. **Compare the time groups** Use the default time selector. Both Available requires the same saved catalogue slot for you and every current tutee; Other Time Slots lacks that shared evidence. Unavailable choices are disabled when they overlap another teaching block.

3. **Review and save the time** Discuss the time, select the intended slot and confirm the named review. A combined group shares one time, so changing a member's default changes the whole group. Check the room result and dated calendar afterward.

4. **Report an actual schedule conflict** In tutee Details use the schedule-conflict request, provide a reason and complete its two-second review. The assignment stays active until approval. Missing saved availability alone does not establish a conflict.

### What happens next

The pairing shows its confirmed shared time or a pending reasoned conflict request.

### How it works

Clock overlap is not enough to establish a shared catalogue choice. Back-to-back sessions are allowed; separate overlapping assignments conflict. Awaiting schedule reserves no time. Tutors can trigger automatic room assignment but do not choose a staff-fixed room.

### Troubleshooting

- **No room or no shared slot is available** Review each person's saved catalogue availability and actual booking conflicts. Needs room means the schedule lacks a reservation; ask management to review capacity. Never assume automatic assignment silently changed to Online.

## Combine, repair or split recurring pairings

Create a reusable shared teaching block while retaining individual subject assignments and history.

Open: `/dashboard#tutor-pairings`

### Before you start

- You are active and own two to six eligible current populated assignments with complete student–subject coverage.

### Walkthrough

1. **Select groups to combine** Every pairing starts as its own group in My Pairings. Choose Combine groups, select two or more populated groups, and choose Combine selected. Incompatible cards dim and disable automatically; choosing a card along a shared student or subject axis automatically selects required companion cards (with a status notice) so every student in the combined group has every selected subject.

   Look for: Unified pairing group cards with inline combine selection and split controls

2. **Choose the primary member and shared schedule** In the Combine Pairing Groups dialog choose the primary member, then leave the group Awaiting schedule or choose one shared catalogue slot. Review students, subjects, time and room consequences before saving.

   Look for: Primary member and shared schedule in the group action dialog

3. **Repair or split deliberately** Choose Split this group or Repair or split directly on a combined group card. Two-assignment groups dissolve into separate single-assignment groups; larger groups can split completely or keep two to six valid assignments together (retaining an unpublished confirmed interval only when membership is unchanged). Leaving assignments keep their students/subjects/room but return to Awaiting schedule until separately scheduled.

### What happens next

My Pairings shows a valid shared block, repaired group or separately unscheduled assignments.

### How it works

A–Chemistry and B–Chemistry can combine; mixing Chemistry and Mathematics for both students needs all four student–subject relationships. A saved valid group counts as one workload block. Group changes affect future plans, preserving past attendance, ratings and credit; Needs repair groups must be repaired or split before combined scheduling/attendance.

### Troubleshooting

- **Save rejects coverage, time or room** Use Back to correct the selection. A fixed-room or overlapping independent-block conflict cannot be silently overridden. If saved groups changed, Reload saved groups explicitly replaces the draft after a successful read; a saved-result Retry only refreshes.

## Record attendance for an ended tutoring session

Open the exact dated lesson and record what actually happened once.

Open: `/dashboard#sessions`

### Before you start

- You are active, have current tutor-policy acceptance and the lesson has ended without a saved attendance entry.

### Walkthrough

1. **Choose the ended lesson** In Schedule → Needs attendance open Record attendance on the exact lesson. Check its captured subjects and tutees, including separately rescheduled participants. Do not use another lesson to record missing history.

   Look for: Ended lesson marked Needs attendance

2. **Record actual time and location** Confirm actual start/end and room or Online; planned lessons use 45 minutes but attendance records the duration that actually occurred. Read any room-conflict warning; a truthful historical report does not reserve a future conflicting room.

   Look for: Actual times, location and attendance rows

3. **Complete every attendance row** Record your attendance and every student's actual attendance. Supply required absence/excuse reasons, comments, session ratings and reasons for requested disciplinary cards. Combined lessons count distinct students once and retain captured subjects.

4. **Submit and check the receipt** Submit once and read the saved receipt. The accepted entry is locked; Submit Another starts a new entry. If totals fail to refresh use Retry refresh. Ask management for corrections to a saved or unplanned historical lesson.

### What happens next

One attendance record and its calculated consequences are saved for the exact lesson.

### How it works

An identical retry does not award another credit; changed answers after saving require correction. Moving the time cannot create duplicate attendance. Adjacent non-overlapping sessions remain valid. Extra/rescheduled labels come from the schedule rather than an attendance checkbox.

### Troubleshooting

- **A draft is open for a different lesson** Resume or explicitly discard it before switching. Closing the form retains its draft during this visit. For uncertain submission inspect the saved result before retrying.

## Reschedule a session or add an extra lesson

Review exact participants, time and room before sending an agreement proposal.

Open: `/dashboard#sessions`

### Before you start

- You own an eligible current pairing and the affected session can still be planned.

### Walkthrough

1. **Open the session action** In Schedule choose Reschedule Session or Add Extra Session. For a regular lesson paused by a no-tutoring notice, choose Arrange exception to propose an explicitly agreed dated exception for the affected learners. Use Message to coordinate first when useful; chat does not formally accept a schedule change.

   Look for: Session action menu and dated event

2. **Choose scope, time and mode** Keep Include all tutees in this session checked, or uncheck it and choose one person. Choose In person — room assigned automatically or Online. Editing start/end retains the planned 45-minute duration.

   Look for: Proposal editor with included tutees, date/time and In person or Online

3. **Review availability and room** Choose Review and read the assigned room before sending. Review reserves nothing; if that room becomes unavailable, edit and review again. The system does not silently change the reviewed room or switch to Online.

4. **Send and follow agreement** Send the reviewed proposal and inspect essential-email delivery and each response. Use this suggestion can formalize an exact current tutee suggestion. For one tutee, accept their alternative or reject with one final proposal. If a group shows Separate rescheduling requested, choose Start individual requests and review/confirm the affected participants; then follow each individual request. The group timer stops while separate rescheduling is requested, and the weekly pairing group remains intact.

### What happens next

The dated calendar shows the proposal and then its authoritative agreed, expired or cancelled result.

### How it works

Rescheduling changes a dated commitment; extras leave the regular lesson intact. The 24-hour automatic-acceptance window begins only after essential email transport accepts the notice. Short windows require explicit agreement before the earlier start; delayed reconciliation after a session starts requires review rather than a retroactive move.

Add Extra Session opens a source picker showing the actual weekly pairing slot; choose Choose session to continue. Eligible paused sources offer Arrange exception there. Fully paused or cancelled commitments leave Upcoming; use All or History to inspect their retained cancellation evidence. These controls do not change your private calendar subscription settings.

### Troubleshooting

- **Mail failed or no response window fits** Inspect delivery status and retry eligible delivery, then check the confirmed portal result. Do not treat silence as acceptance without a valid window. Expiry preserves the original unless another authoritative change cancels it.

## Request cancellation of an agreed extra lesson

Review exactly which dated commitments are affected and wait for agreement.

Open: `/dashboard#sessions`

### Before you start

- The extra is agreed, has not started and has no recorded attendance.

### Walkthrough

1. **Find the agreed extra** In Schedule open the extra's card and choose Cancel Extra Session. Use All to find extras beyond the two-week Upcoming window, including a moved extra.

   Look for: Agreed Extra card and Cancel Extra Session

2. **Review the participants** Include all current tutees or choose one, then review the exact date, time and people. Close or Cancel before submission sends nothing. Send only the reviewed cancellation request.

3. **Check agreement and the result** Each included tutee can Accept cancellation or Decline cancellation. The extra remains scheduled until agreement under essential-email response rules. Check the saved request separately from actual cancellation.

### What happens next

Only the selected dated extra commitments are cancelled after the required agreement.

### How it works

A decline or expiry preserves the lesson. This request has no alternative-time or separate-reschedule step. It preserves peers, weekly pairing groups and ordinary lessons.

### Troubleshooting

- **The action is missing or refresh failed** Check the extra is agreed/upcoming and has no attendance. After a saved request, use read-only refresh rather than sending another cancellation. For a lesson that already happened, ask management about attendance correction.

## Vote on an interview or complete chair duties

Review the application, submit your vote and distinguish a decision from recorded hours.

Open: `/dashboard#sessions`

### Before you start

- You are an assigned eligible panelist. Scheduling and final decisions require the selected Admin/Head tutor chair; applicants cannot review themselves.

### Walkthrough

1. **Open Interview work** In Schedule open your assigned interview and inspect the requested subjects and qualification explanation. Chairs can also open Interviews to Conduct; completed records are in its collapsed history section.

   Look for: Interview card, vote status and action

2. **Submit your own vote** Read the application evidence and record your vote through its existing control. Check Vote recorded / Awaiting decision. Every panelist must vote before the final decision; opening or scheduling earns no hours.

3. **Chair: schedule and decide** An authorized chair schedules the interview and records the outcome after all votes, following the majority and resolving a tie. On approval enter actual completion time, minutes and attending panelists, then review Approve & award hours.

4. **Check completion follow-up** Read the saved decision and completion separately. Acceptance, interview credit and initial invitation setup can apply together; additional qualifications grant subjects without a new registration code. Ask management to correct completion/hours through Interview Records.

### What happens next

Your vote is saved, or the authorized chair's final decision and actual attendance credit are recorded.

### How it works

Coordinators may vote as panelists but cannot chair. A missing or demoted chair blocks new scheduling/decision/first completion until management fixes the panel; existing historical completion corrections retain their recorded chair. A completed interview can still await votes or decision.

### Troubleshooting

- **The decision is blocked** Check every vote, eligible active panelists, subject qualifications and a selected current Admin/Head chair. Restricted applicant access may require a separate management restoration; retrying acceptance cannot bypass it.

## Review meetings and request an excuse

Read current/history attendance and submit or cancel an excuse before the deadline.

Open: `/dashboard#sessions`

### Before you start

- The meeting belongs to your tutor schedule and the excuse deadline has not passed.

### Walkthrough

1. **Open the meeting** In Schedule choose the meeting card. Read its date, program timezone and attendance or excuse state. A meeting awaiting staff attendance does not ask you to record your own attendance.

   Look for: Meeting card and excuse state

2. **Submit or cancel your excuse** Use the excuse action, supply the requested reason and confirm at least 45 minutes before the meeting starts. You may cancel your own eligible excuse before that same deadline; excuse controls hide automatically once the 45-minute cutoff passes. Staff-recorded statuses require staff correction.

3. **Read Meeting history** Open Meeting history, then a school-year/quarter group for recorded attendance. Semester mode groups both constituent quarters. Period not recorded remains explicit; future meetings recorded under other periods appear separately.

### What happens next

Your excuse shows its saved state or historical meeting attendance remains readable.

### How it works

The first three unexcused tutor-meeting absences per semester have no automatic deduction; each further one deducts 0.25 hours. Excused absences do not consume that allowance. Missing attendance is not an absence.

### Troubleshooting

- **Period grouping changed or a save failed** Keep your draft and use Retry after a failed save/read. Reload groups explicitly confirms discarding unsaved drafts after an applied quarter/semester mode change; it waits for pending saves/refreshes.

## Manage tutoring participation and understand hours

Request or recall membership changes, relay eligible departures and inspect separate credit sources.

Open: `/settings`

### Before you start

- You have a linked tutor profile; actions depend on current participation and existing pending requests.

### Walkthrough

1. **Request or recall your opt-out** In Account Settings open opt-out, enter an optional reason, review the named request and confirm after its three-second pause. Participation continues until staff approval, allowed only after seven days. Use the separate recall control to withdraw a pending request.

   Look for: Tutor participation request and pending state

2. **Request reentry or confirm a new semester** An opted-out tutor can request reentry without a seven-day wait, but approval remains required. Only one pending membership request is allowed. After semester refresh, pending continuing tutors directly choose available or opting out in the activation prompt.

3. **Relay only an eligible student's request** For a non-survey enrolled student use the relay action in pairing Details, add an optional reason and review. It processes after a seven-day recall window unless recalled or cancelled. Survey students request whole-period withdrawal in their own workspace; schedule conflicts use their own review.

4. **Inspect History & hours** Read the reporting period, earned tutoring hours, extras and deductions. Review sessions, interviews, meeting deductions and manual adjustments. Crew Hours is separate and is not included in the tutoring total.

   Look for: Selected period and earned/extras/deductions

### What happens next

Membership requests show pending/decided state and hours can be traced to their recorded source.

### How it works

A submission receipt never ends participation immediately. An outdated student relay cancels if the program refreshes or its original assignment is removed before processing. Historical attendance credit follows its recorded policy; manual adjustments and Crew credit remain separate evidence.

### Troubleshooting

- **Hours or membership differ from your expectation** Check period, actual saved attendance, adjustments and review decision. Ask management to inspect the exact source record. After a successful request with refresh failure use Retry refresh rather than requesting again.

## Read announcements, room schedules and learner standing

Find shared program information while respecting the limits on private evidence.

Open: `/dashboard`

### Before you start

- Use your tutor workspace; optional sections depend on enabled modules and relevant records.

### Walkthrough

1. **Read addressed announcements** Read the announcement cards above your workspace. Pinned posts stay visible even after an earlier acknowledgement; they have no Dismiss button. Use Dismiss on an ordinary post when offered. Addressed posts use the audience captured at publication; another tutor's notice is not yours to acknowledge.

   Look for: Announcements above the tutor workspace

2. **Inspect the shared room schedule** Use the shared room-schedule view in the tutor workspace to read planned public room commitments. Read the exact time and room details, and close the reader when finished. It does not display private interview evidence or reserve a room for you.

   Look for: Shared room schedule beside pairing tools when offered

3. **Read your learners' standing** When discipline history is available, expand a tutee's timeline to inspect card color, date and pending/valid outcome. Tutors see standing and outcomes, never the private card reasons. Request new cards only through the relevant attendance form with an actual reason.

4. **Reopen the handbook** Choose Handbook or current policy to read the published tutor policy in the interface language, with English fallback. Reading does not sign a new revision; complete the separate participation-policy review if prompted.

5. **Read feedback shared with you** Open Tutee Support at /student-support. When management enables Share feedback with tutors, you can read feedback for your own recorded sessions and use Previous/Next for that list. When sharing is off or cannot be verified, follow the stated unavailable/privacy message rather than assuming access.

### What happens next

You understand the current announcement, planned room information and permitted learner standing.

### How it works

Optional discipline history hides after a successful empty read, not during a failed load. Shared room information does not grant management room-selection powers; the assigned session remains authoritative for your lesson.

### Troubleshooting

- **The section is missing or cannot refresh** Check whether the module is enabled and you have addressed announcements or relevant records. Use Retry for failed reads. Ask management privately about incorrect standing; do not infer hidden reasons from a summary.
