# Tutor workspace

Generated from the website help catalogue. Edit the content records, then run `npm run help:export`.

[Catalogue & capture provenance](README.md)

Screenshot source: `1df44d6bb31cf04352adae9c65819139b7b747d8`. New captures use latest-main development baseline 1df44d6b, selected 2026-11-21, with the Help candidate. Earlier captures list their own revision and capture date.

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

   ![Check activation and policy notices · Tutor workspace · Current policy](assets/annotated/4656dded2a3a69461f22ae93afc7a169b81b47aff11d30bb14d43c627ca91510.webp)

   <details>
   <summary>Capture details</summary>

   Alice is already active. The tutor dashboard shows the accepted current-policy notice before participation tasks. A pending tutor would first see a separate participation choice.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/start-tutoring-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **Use the four task panels** Schedule holds dated tutoring, interviews and meetings. Pairings holds recurring assignments. Preferences holds availability, workload and subject choices. History & hours holds retained evidence. Switching these local panels retains visited editors during the visit.

   ![Use the four task panels · Pairings tab · Subject · Weekly time](assets/annotated/d21a4a72845e38e55d52f2a1a6679995224a78b3514f63ef64a9f5aa6685b17b.webp)

   <details>
   <summary>Capture details</summary>

   Choose Pairings in the Tutor workspace to see the recurring group. The Mathematics row shows the weekly time.

   /dashboard#tutor-pairings · EN · 2026-11-21

   [Original full screenshot](assets/start-tutoring-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **Follow Needs attention** Open the task for an unconfirmed schedule, missing attendance, interview vote or meeting. Needs Action requires your work; Vote recorded / Awaiting decision means your vote is saved while the interview is still open.

   ![Follow Needs attention · Open interviews · Vote saved · Awaiting decision](assets/annotated/e9b5f2a7efd7a43b65bfdf9703040177234282de2059a07f06e5e53bc140aa8c.webp)

   <details>
   <summary>Capture details</summary>

   Open interviews connects the Needs attention shortcut to the dated work. Fiona’s interview shows Vote recorded and Awaiting decision.

   /dashboard · EN · 2026-11-21

   [Original full screenshot](assets/start-tutoring-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

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

1. **Edit My Time Availability** Open Preferences → My Availability → Edit My Time Availability. Select the catalogue weekday/time slots you can teach and choose Save Availability. Cancel restores the last loaded time selection.

   Look for: Weekday time choices and Save Availability

   ![Edit My Time Availability · Toggle available slots · Save the grid](assets/annotated/0995c8481622926d2184189f1e84862a9d3e3e09aed592d4a8f5554bf67d40ce.webp)

   <details>
   <summary>Capture details</summary>

   Expanded availability grid with separate preferred-session controls and current workload context

   /dashboard#tutor-preferences · EN · 2026-11-16

   [Original full screenshot](assets/tutor-availability-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Save Preferred Sessions separately** Under the time choices choose one of 0–4, or clear the preference, then use its own Save. Zero means prefer no assignments; an unset preference is different. Saving availability does not save this separate draft.

   ![Save Preferred Sessions separately · Zero · Clear preference · Separate save](assets/annotated/e2f9b6cf82b430e50ba5fc183520044a4a86ea8ef6154b98c66a61bb7c0fe14a.webp)

   <details>
   <summary>Capture details</summary>

   Choose zero or Clear preference in the separate Preferred Sessions form. This zero was a draft and was cancelled.

   /dashboard#tutor-preferences · EN · 2026-11-21

   [Original full screenshot](assets/tutor-availability-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **Check the saved workload context** Compare assigned session-block count with the saved preference. Group changes refresh this count without replacing an unsaved preference. After an accepted save with failed synchronization use Retry refresh.

   ![Check the saved workload context · Assigned and preferred · Saved preference: 1](assets/annotated/7557019ca7b720a3b927010ea5af363342623f09680707753ffeb1d4627e75df.webp)

   <details>
   <summary>Capture details</summary>

   The saved comparison shows two assigned blocks and a preference of one. The saved value is selected after canceling the draft.

   /dashboard#tutor-preferences · EN · 2026-11-21

   [Original full screenshot](assets/tutor-availability-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

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

   ![Edit willingness for approved subjects · Willingness · Search subjects](assets/annotated/80ca5cbb9612c1fcbb966d29ad6af65a00351ab494f8041b9cbb26137609f823.webp)

   <details>
   <summary>Capture details</summary>

   Subject willingness editor showing the automatically saved Mathematics preference

   /dashboard#tutor-preferences · EN · 2026-11-16

   [Original full screenshot](assets/tutor-subject-qualifications-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Request a new subject or higher level** In Subject Qualifications choose the subject/level, explain your qualifications and submit. Under Your Requests use Pending, Approved, Rejected or Recalled filters and expand history to read decision notes and granted subjects.

   ![Request a new subject or higher level · Subject and level · Qualification evidence · Submit request](assets/annotated/5a945b63ddf5f4008e7720bd694eb0888335a0f0827ca1db74dd617b7ada4d96.webp)

   <details>
   <summary>Capture details</summary>

   Additional subject qualification draft with a chosen level and explanation

   /dashboard#tutor-preferences · EN · 2026-11-16

   [Original full screenshot](assets/tutor-subject-qualifications-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Recall an eligible pending request** Choose Recall request while Pending or Interview, review the named subject and confirm. A recalled request cannot be reopened or approved; submit a fresh request later when ready.

   ![Recall an eligible pending request · Recall request · Keep request](assets/annotated/a10eb6f43de9d9eaf06ddd24fe4128a050ce31d87b8401511cfd7726a0d07365.webp)

   <details>
   <summary>Capture details</summary>

   Named confirmation before recalling the still-pending Algebra II qualification request

   /dashboard#tutor-preferences · EN · 2026-11-16

   [Original full screenshot](assets/tutor-subject-qualifications-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

   ![Inspect My Pairings · Combined roster · Shared default time](assets/annotated/2a2ca6b93536d3312f8cebb3f9f3afb83d0ff737d39ea82e34a281410c501e8c.webp)

   <details>
   <summary>Capture details</summary>

   Expanded combined pairing with roster, room, weekly slot and individual details

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-pairing-time-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Compare the time groups** Use the default time selector. Both Available requires the same saved catalogue slot for you and every current tutee; Other Time Slots lacks that shared evidence. Unavailable choices are disabled when they overlap another teaching block.

   ![Compare the time groups · Choose a time slot](assets/annotated/9e6b1e1209ccf5367d220ec35a49c34a8e1a2ef74331a035f68deba6bedd8285.webp)

   <details>
   <summary>Capture details</summary>

   Default-time catalogue selector for the combined Mathematics pairing

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-pairing-time-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Review and save the time** Discuss the time, select the intended slot and confirm the named review. A combined group shares one time, so changing a member's default changes the whole group. Check the room result and dated calendar afterward.

   ![Review and save the time · Check shared time · Save change](assets/annotated/2200756c146030829467bd60b8409c49acaec4d2b33b118dae6247e88099d1ca.webp)

   <details>
   <summary>Capture details</summary>

   Named review before changing the shared recurring slot for every member of the combined group

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-pairing-time-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **Report an actual schedule conflict** In tutee Details use the schedule-conflict request, provide a reason and complete its two-second review. The assignment stays active until approval. Missing saved availability alone does not establish a conflict.

   ![Report an actual schedule conflict · Original request · Conflict reason](assets/annotated/75bb779bfdaca8e222c8f6ed5b840e9c08e61eb2dba784511bf14a4a8aac0ebd.webp)

   <details>
   <summary>Capture details</summary>

   Exact original-request schedule-conflict review with a reason, before submission

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-pairing-time-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

1. **Open Combine / split pairings** In My Pairings select Combine / split pairings. Choose the assignments and primary member. Every student in the group must already have every selected subject; combining never creates a missing assignment.

   Look for: Combine / split pairings and grouped assignment summary

   ![Open Combine / split pairings · Combine / split pairings](assets/annotated/d7037576aa622ab4e1d272cb53de17ae94a529847418d0e497839ac345112218.webp)

   <details>
   <summary>Capture details</summary>

   Open the explicit combine/split editor from My Pairings

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/combine-split-pairings-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Choose the shared schedule** Leave the group Awaiting schedule or choose one shared catalogue slot; use the explicit retained-time option only when preserving a confirmed interval. Review students, subjects, time and room consequences before saving.

   Look for: Selected assignments, primary member and shared schedule in the group editor

   ![Choose the shared schedule · Primary / room · Shared time](assets/annotated/7506a7db5228d7c92561e47b707d99b2b5eaa04b2a4a514c32e0ee72618e5f1e.webp)

   <details>
   <summary>Capture details</summary>

   Existing combined group: selected assignments, primary room source and one shared recurring slot

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/combine-split-pairings-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Repair or split deliberately** Reopen the editor to add or untick assignments, or choose Split this group. Each remaining group needs at least two members. Leaving assignments keep their students/subjects/room but return to Awaiting schedule until separately scheduled.

   ![Repair or split deliberately · Split this group · Keep at least two](assets/annotated/a709bca063e33b7b8fb93e40bd3d3595538ea29c2e9307195c3b1c61bfcc9541.webp)

   <details>
   <summary>Capture details</summary>

   Repair or split controls in the existing combined-group editor before review

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/combine-split-pairings-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

   ![Choose the ended lesson · Ended date · Learner list · Record attendance](assets/annotated/fbd9d274c28817e9ef6174785fcd3b8692ad4c8dd5d49b1dc775ccb423b6c237.webp)

   <details>
   <summary>Capture details</summary>

   Pick the ended Mathematics lesson with the correct date and learner list. Its Record attendance action opens the lesson form.

   /dashboard#sessions · EN · 2026-11-21

   [Original full screenshot](assets/record-attendance-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **Record actual time and location** Confirm actual start/end and room or Online; planned lessons use 45 minutes but attendance records the duration that actually occurred. Read any room-conflict warning; a truthful historical report does not reserve a future conflicting room.

   Look for: Actual times, location and attendance rows

   ![Record actual time and location · Start time · End time · Held Online](assets/annotated/886bd652af64fc594965cbc89ae10d54eda15518276d57b5c56367011b2401a6.webp)

   <details>
   <summary>Capture details</summary>

   Attendance form: actual time, room and online mode for the exact ended lesson

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/record-attendance-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Complete every attendance row** Record your attendance and every student's actual attendance. Supply required absence/excuse reasons, comments, session ratings and reasons for requested disciplinary cards. Combined lessons count distinct students once and retain captured subjects.

   ![Complete every attendance row · Comments · Optional card · Check then submit](assets/annotated/5afed011e4dc7233aa538baa1c843f0f3998d37ec61ae167d211604a34ac201a.webp)

   <details>
   <summary>Capture details</summary>

   Attendance form scrolled to evaluation, comments and optional disciplinary cards before submission

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/record-attendance-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **Submit and check the receipt** Submit once and read the saved receipt. The accepted entry is locked; Submit Another starts a new entry. If totals fail to refresh use Retry refresh. Ask management for corrections to a saved or unplanned historical lesson.

   ![Submit and check the receipt · Saved · Saved entry locked](assets/annotated/00eff358a7f7f0981c460290a5480372c99e70edffa8b65609deec22f77c14c9.webp)

   <details>
   <summary>Capture details</summary>

   Saved planned attendance: the accepted form is locked and shows Saved

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/record-attendance-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

   ![Open the session action · Upcoming date · Learner list · Open reschedule](assets/annotated/24b12c24a3f18f5c1d65e7588d6e610ef2de9c6a75ed2f96726a51f89e0c5eb3.webp)

   <details>
   <summary>Capture details</summary>

   Choose the upcoming Mathematics date and confirm the included learners, then open Reschedule Session for that dated lesson.

   /dashboard#sessions · EN · 2026-11-21

   [Original full screenshot](assets/plan-dated-session-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **Choose scope, time and mode** Keep Include all tutees in this session checked, or uncheck it and choose one person. Choose In person — room assigned automatically or Online. Editing start/end retains the planned 45-minute duration.

   Look for: Proposal editor with included tutees, date/time and In person or Online

   **View 1**

   ![View 1 · All tutees · Location · Review](assets/annotated/f831529ae35d6430e28e8aa84f44faeacb1dc1ff1cf06b786467785c404cbe4a.webp)

   <details>
   <summary>Capture details</summary>

   Keep Include all checked for the whole dated Mathematics group. Set the date and start time, check the linked 45-minute end, then choose the location.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/plan-dated-session-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 2**

   ![View 2 · Clear all · Choose learner · Online](assets/annotated/dbb9bfd628ed4e16a292059646ee39530010ada97853fe63e0784b635750e194.webp)

   <details>
   <summary>Capture details</summary>

   For a one-tutee proposal, clear Include all and choose the exact learner. Online is a separate location choice.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/plan-dated-session-step-2-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **Review availability and room** Choose Review and read the assigned room before sending. Review reserves nothing; if that room becomes unavailable, edit and review again. The system does not silently change the reviewed room or switch to Online.

   **View 1**

   ![View 1 · Original time · Proposed time · Assigned room · Send proposal](assets/annotated/7b36297736eee7888e2fd488f38b8c33aec289810b8f55dd277ffede3831518e.webp)

   <details>
   <summary>Capture details</summary>

   Review compares the original time with the proposed group time and shows the assigned room. The room is checked again when a proposal is sent.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/plan-dated-session-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 2**

   ![View 2 · Proposed time · Online · One tutee · Send proposal](assets/annotated/29ef1c100d1e181a35d68c584a5bffa3187686006ad6bc2f24ed6f746ba80910.webp)

   <details>
   <summary>Capture details</summary>

   Review this one-tutee extra separately. The checked proposal shows the proposed date, Online location, and Emma as the only learner.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/plan-dated-session-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **Send and follow agreement** Send the reviewed proposal and inspect essential-email delivery and each response. Use this suggestion can formalize an exact current tutee suggestion. For one tutee, accept their alternative or reject with one final proposal. If a group shows Separate rescheduling requested, choose Start individual requests and review/confirm the affected participants; then follow each individual request. The group timer stops while separate rescheduling is requested, and the weekly pairing group remains intact.

   ![Send and follow agreement · Pending · Learner response · Respond by](assets/annotated/15d2347555fb122b784b0e3dba8c2cf4930b81ce7bba931e27a1d2c5e7e5f42f.webp)

   <details>
   <summary>Capture details</summary>

   Open Scheduling requests after sending. The extra awaits Emma’s response, and the displayed deadline starts after essential email delivery.

   /dashboard · EN · 2026-11-20

   [Original full screenshot](assets/plan-dated-session-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

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

   ![Find the agreed extra · Extra session · Agreed time · Cancel extra](assets/annotated/c90b685e0865a55ac0b83880cebe0829bcd12843ee653704a98a882767929574.webp)

   <details>
   <summary>Capture details</summary>

   Find the already scheduled Extra Session for the exact date and learner. Open Cancel Extra Session from that card.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/cancel-extra-session-step-1.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

2. **Review the participants** Include all current tutees or choose one, then review the exact date, time and people. Close or Cancel before submission sends nothing. Send only the reviewed cancellation request.

   ![Review the participants · Session time · Included learner · Send request](assets/annotated/e9f9710372c6df6c7f65270bb30e9521488e78dd5b4b33fd832b2ca6eb8828f1.webp)

   <details>
   <summary>Capture details</summary>

   Check the exact extra date, time and learner on Review proposal. Send cancellation request creates an agreement request for that extra.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/cancel-extra-session-step-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

3. **Check agreement and the result** Each included tutee can Accept cancellation or Decline cancellation. The extra remains scheduled until agreement under essential-email response rules. Check the saved request separately from actual cancellation.

   **View 1**

   ![View 1 · Exact time · This learner · Confirm](assets/annotated/3ad2214bf402d0827e4709dc8e34d256be82f7795ec79a7da7c2aacb1da56e15.webp)

   <details>
   <summary>Capture details</summary>

   On the learner’s Accept cancellation review, confirm the exact dated extra and the single participant. After the response, check the agenda for the saved outcome.

   /student?view=schedule · EN · 2026-11-20

   [Original full screenshot](assets/cancel-extra-session-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 2**

   ![View 2 · Request saved · Upcoming](assets/annotated/9d228a3d6925724c7167d5924c583491dd31beff3c19a20ad13eeb326b171933.webp)

   <details>
   <summary>Capture details</summary>

   The tutor sees the cancellation-request receipt while the very same extra remains Upcoming. Agreement is still pending.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/cancel-extra-session-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 3**

   ![View 3 · All · Same extra · Cancelled](assets/annotated/9c7f3034fca971f55258802d80dac124272ea22be8aafc71f34a81e399702394.webp)

   <details>
   <summary>Capture details</summary>

   After the learner agrees, use All in the tutor schedule to find the same dated extra with its actual Cancelled badge.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/cancel-extra-session-step-3-view-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

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

   ![Open Interview work · View your interview and vote](assets/annotated/d1caa70063c3a923e7bde17ac1bbc731857d8ed4b135b2cb7f1d9af08c981686.webp)

   <details>
   <summary>Capture details</summary>

   Tutor dashboard on latest main: pinned and ordinary announcements, task panels and dated agenda

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/tutor-interviews-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Submit your own vote** Read the application evidence and record your vote through its existing control. Check Vote recorded / Awaiting decision. Every panelist must vote before the final decision; opening or scheduling earns no hours.

   ![Submit your own vote · Your comment · Your vote](assets/annotated/52884b4ce7433608d133695f0d5b55591a53cd412a29bee0be38127960da85e6.webp)

   <details>
   <summary>Capture details</summary>

   Panelist interview details with an optional vote comment and the recorded own vote

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/tutor-interviews-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Chair: schedule and decide** An authorized chair schedules the interview and records the outcome after all votes, following the majority and resolving a tie. On approval enter actual completion time, minutes and attending panelists, then review Approve & award hours.

   **View 1**

   ![View 1 · Completion time · Actual duration · Attending panelists · Review approval & hours](assets/annotated/df357e405bd7f5e96269003576740f74aa0be957722ccf098b4517877e76b138.webp)

   <details>
   <summary>Capture details</summary>

   The assigned chair enters the completion time, duration and actual attendees for this fictional approval draft. Review approval & hours opens the final consequence review.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/tutor-interviews-step-3.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 2**

   ![View 2 · Approval effects · Proposed hours · Approve & award hours](assets/annotated/7b94fa1e55f112d566f91bdb0f2ea6b30056543da52bba64b07a4cb2a874b369.webp)

   <details>
   <summary>Capture details</summary>

   The final initial approval review shows the proposed 1.5 hours and acceptance, registration and notification consequences. The confirmation remains unpressed.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/tutor-interviews-step-3-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

4. **Check completion follow-up** Read the saved decision and completion separately. Acceptance, interview credit and initial invitation setup can apply together; additional qualifications grant subjects without a new registration code. Ask management to correct completion/hours through Interview Records.

   **View 1**

   ![View 1 · Completed applicant · Actual completion · Recorded credit · Saved decision](assets/annotated/42e83389ad960d9791ffaeb60fb1adcf9b29a716469c5d393bb68e841128b4df.webp)

   <details>
   <summary>Capture details</summary>

   George’s completed card shows a saved accepted decision and the separate 35-minute completion and personal interview credit.

   /dashboard#sessions · EN · 2026-11-20

   [Original full screenshot](assets/tutor-interviews-step-4.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

   **View 2**

   ![View 2 · Saved decision · Attendance hours · Registration status](assets/annotated/df4ceffdfe1ea02212ee7f57d27a40923fc294eba840946e42a6b4c249c15e8a.webp)

   <details>
   <summary>Capture details</summary>

   Interview records shows George’s accepted decision, awarded attendance hours and the separate already-used registration status. No code is displayed.

   /admin/applications#interview-records · EN · 2026-11-20

   [Original full screenshot](assets/tutor-interviews-step-4-view-2.en.jpg) · `b5ece465681957c9fe579d26babdeb260c674fa0` · Latest-main development baseline b5ece465, selected 2026-11-20, with the Help candidate and synthetic demo records.

   </details>

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

   ![Open the meeting · View this meeting](assets/annotated/0d97d50402528b84570679a42114df7aeb3e9c8bff4f751d50eacb752413223e.webp)

   <details>
   <summary>Capture details</summary>

   Tutor dashboard on latest main: pinned and ordinary announcements, task panels and dated agenda

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/tutor-meetings-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Submit or cancel your excuse** Use the excuse action, supply the requested reason and confirm at least 60 minutes before the meeting starts. You may cancel your own eligible excuse before that same deadline. Staff-recorded statuses require staff correction.

   **View 1**

   ![View 1](assets/tutor-meetings-step-2.en.jpg)

   <details>
   <summary>Capture details</summary>

   Advance meeting excuse after the form layout fix: reason and both actions stay inside the dialog

   /dashboard#sessions · EN · 2026-11-16

   [Original full screenshot](assets/tutor-meetings-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **View 2**

   ![View 2](assets/tutor-meetings-step-2-view-2.en.jpg)

   <details>
   <summary>Capture details</summary>

   English mobile meeting excuse after the layout fix; reason and both actions remain visible

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/tutor-meetings-step-2-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Read Meeting history** Open Meeting history, then a school-year/quarter group for recorded attendance. Semester mode groups both constituent quarters. Period not recorded remains explicit; future meetings recorded under other periods appear separately.

   ![Read Meeting history · Meeting history · Reporting period](assets/annotated/85a85836bb59f85fe9d68373daddbb625e7b16284002beafc4233e253c5489d2.webp)

   <details>
   <summary>Capture details</summary>

   Meeting history expanded to a retained school-year/quarter group with recorded attendance

   /dashboard#sessions · EN · 2026-11-16

   [Original full screenshot](assets/tutor-meetings-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

   **View 1**

   ![View 1 · Request opt-out](assets/annotated/562ca2ab526587a99b10f6a1695cbe6a4838ca9983c0792b0b166abb278b1481.webp)

   <details>
   <summary>Capture details</summary>

   Opt-out review names the tutor, optional reason, seven-day review cooldown and continued participation until approval.

   /settings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **View 2**

   ![View 2 · Request saved](assets/annotated/15d6902b3d6df78cfd00994b47037e27473a3148ea76234267dd9288d9b5254c.webp)

   <details>
   <summary>Capture details</summary>

   Actual submitted opt-out receipt names the future approval date and recall window; it does not approve departure.

   /settings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-1-view-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

   **View 3**

   ![View 3 · Recall request](assets/annotated/55378d7729300b66f40d5df900a61df55bf752576cdd06bec9e2fcded662dcae.webp)

   <details>
   <summary>Capture details</summary>

   The pending opt-out shows its real approval date and a separate Recall Request action while participation remains active.

   /settings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-1-view-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Request reentry or confirm a new semester** An opted-out tutor can request reentry without a seven-day wait, but approval remains required. Only one pending membership request is allowed. After semester refresh, pending continuing tutors directly choose available or opting out in the activation prompt.

   **View 1**

   ![View 1 · Reentry](assets/annotated/8770b48ae9380299ac8cc18c660e6005952ec1543fc55cc3864f6fa00a86116f.webp)

   <details>
   <summary>Capture details</summary>

   This dedicated opted-out tutor sees Request Reentry in Membership. The page says an Admin will review the request; the button does not make the tutor active.

   /settings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **View 2**

   ![View 2 · Pending · Recall](assets/annotated/ffe51273757b630525a7da9ef0ab99296a997c1d80d691cf450d66133412a4c5.webp)

   <details>
   <summary>Capture details</summary>

   Request Reentry submitted immediately and the real page now says it awaits Admin approval. Recall Request is available; the tutor has not been activated and no policy acceptance was submitted.

   /settings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-2-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

3. **Relay only an eligible student's request** For a non-survey enrolled student use the relay action in pairing Details, add an optional reason and review. It processes after a seven-day recall window unless recalled or cancelled. Survey students request whole-period withdrawal in their own workspace; schedule conflicts use their own review.

   **View 1**

   ![View 1 · Review](assets/annotated/cc32ef6eeb0e800d3572c59768a9eca9eb3e64a61a6360b190cd84f931064b9b.webp)

   <details>
   <summary>Capture details</summary>

   Alice opens the non-survey Capture Legacy Learner pairing details and drafts an optional relay reason. Relay Opt-Out will open the confirmation review; nothing has been submitted yet.

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **View 2**

   ![View 2 · Read · Confirm](assets/annotated/85783b6986e551e8c25831fc567ccdad8a58cb6cda65060e0e9ee2b4123d4acd.webp)

   <details>
   <summary>Capture details</summary>

   The real Relay Opt-Out review names Capture Legacy Learner and Mathematics, states that participation remains active during the seven-day recall window, and offers Cancel or the final Relay Opt-Out action. Nothing has been submitted yet.

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-3-view-2.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **View 3**

   ![View 3 · Pending · Window · Recall](assets/annotated/155a981ff74ccf09042db8a82de8a8b72a44e3427baf8ca6077e1828a35c7230.webp)

   <details>
   <summary>Capture details</summary>

   The real relay was submitted once. The learner shows opt-out pending and an actual recall deadline of Nov 23, 2026, 3:51 PM; the receipt says participation remains active during this seven-day window. Recall is available.

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-3-view-3.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **View 4**

   ![View 4 · Recall](assets/annotated/8f29a60a236ba9cce7af7f9ea23ce33310e651f18f7c0a7e939a4daf715bc385.webp)

   <details>
   <summary>Capture details</summary>

   Recall opens this real confirmation. Check the named learner and subject, then choose Recall to withdraw the pending removal or Cancel to keep it pending. The dialog states the assignment will remain active.

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-3-view-4.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

   **View 5**

   ![View 5 · Saved](assets/annotated/13c2242d46a5968e9950df7870c02cab85f401e3105e03053553ce78acf12338.webp)

   <details>
   <summary>Capture details</summary>

   The final Recall action completed and the real Saved receipt is visible. The pending badge, deadline and Recall action have disappeared; Relay Opt-Out is available again and the learner remains in the assignment.

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-3-view-5.en.jpg) · `dd970ea426016e85cb514beeeab537c3ab2e5098` · Latest-main development baseline dd970ea4, selected 2026-11-16, with the Help candidate; synthetic demonstration data.

   </details>

4. **Inspect History & hours** Read the reporting period, earned tutoring hours, extras and deductions. Review sessions, interviews, meeting deductions and manual adjustments. Crew Hours is separate and is not included in the tutoring total.

   Look for: Selected period and earned/extras/deductions

   ![Inspect History & hours · Credits ≠ total · Recorded lesson](assets/annotated/b716522f44601d568b1ddaa6422b8952d20bb3df724e0fb3ad88cc55de1c22c9.webp)

   <details>
   <summary>Capture details</summary>

   Retained tutor history detail separates stored session credits from meeting records and manual amendments

   /dashboard#tutor-history · EN · 2026-11-16

   [Original full screenshot](assets/tutor-membership-hours-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

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

   ![Read addressed announcements · Pinned and ordinary posts · Dismiss this post](assets/annotated/57140c9e804734611990b70f29baf87540321b0d0f655350244451869c52f1fa.webp)

   <details>
   <summary>Capture details</summary>

   Tutor dashboard on latest main: pinned and ordinary announcements, task panels and dated agenda

   /dashboard · EN · 2026-11-16

   [Original full screenshot](assets/tutor-program-information-step-1.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

2. **Inspect the shared room schedule** Use the shared room-schedule view in the tutor workspace to read planned public room commitments. Read the exact time and room details, and close the reader when finished. It does not display private interview evidence or reserve a room for you.

   Look for: Shared room schedule beside pairing tools when offered

   ![Inspect the shared room schedule · Time slot · Room and interval](assets/annotated/642f151da1ed869c0e1af9c3171bd580b1b0806228dead835caff65dd5324aaf.webp)

   <details>
   <summary>Capture details</summary>

   Read-only room-schedule detail for the exact Monday time slot, including an unavailable room

   /dashboard#sessions · EN · 2026-11-16

   [Original full screenshot](assets/tutor-program-information-step-2.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

3. **Read your learners' standing** When discipline history is available, expand a tutee's timeline to inspect card color, date and pending/valid outcome. Tutors see standing and outcomes, never the private card reasons. Request new cards only through the relevant attendance form with an actual reason.

   ![Read your learners' standing · Card standing · Dated outcomes](assets/annotated/46b293104f83553b194a9951675615b7f48df8e7b505b6e5c82d780595978434.webp)

   <details>
   <summary>Capture details</summary>

   Expanded tutor-visible card timeline: colors, dates and valid or under-review outcomes

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-program-information-step-3.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

4. **Reopen the handbook** Choose Handbook or current policy to read the published tutor policy in the interface language, with English fallback. Reading does not sign a new revision; complete the separate participation-policy review if prompted.

   ![Reopen the handbook · Title & revision](assets/annotated/7a4ce1f6108eb09ae8402370fe49dc0ee16b0eedd7ecdd8801d09aeac0dcb9d9.webp)

   <details>
   <summary>Capture details</summary>

   Published tutor-policy reader reopened from the already-accepted policy notice

   /dashboard#tutor-pairings · EN · 2026-11-16

   [Original full screenshot](assets/tutor-program-information-step-4.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

5. **Read feedback shared with you** Open Tutee Support at /student-support. When management enables Share feedback with tutors, you can read feedback for your own recorded sessions and use Previous/Next for that list. When sharing is off or cannot be verified, follow the stated unavailable/privacy message rather than assuming access.

   ![Read feedback shared with you · Visibility notice · Pagination](assets/annotated/830fb505654cc068d4c51efa35f2eeb5c8abfb554743ae87847a31a92e73eec5.webp)

   <details>
   <summary>Capture details</summary>

   Tutor feedback reader when management sharing is disabled: the privacy message is explicit

   /student-support · EN · 2026-11-16

   [Original full screenshot](assets/tutor-program-information-step-5.en.jpg) · `589c055e4b1cf166b48b353bd619ac1982e5d9f6` · Latest-main development baseline 589c055e with the Help candidate; synthetic demonstration data.

   </details>

### What happens next

You understand the current announcement, planned room information and permitted learner standing.

### How it works

Optional discipline history hides after a successful empty read, not during a failed load. Shared room information does not grant management room-selection powers; the assigned session remains authoritative for your lesson.

### Troubleshooting

- **The section is missing or cannot refresh** Check whether the module is enabled and you have addressed announcements or relevant records. Use Retry for failed reads. Ask management privately about incorrect standing; do not infer hidden reasons from a summary.
