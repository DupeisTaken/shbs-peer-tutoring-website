# Get tutoring

Generated from the website help catalogue. Edit the content records, then run `npm run help:export`.

[Catalogue & capture provenance](README.md)

Screenshot source: `8540496ad9f7c9e64c436270e5e466724c58bb81`. Help screenshots are baked automatically in GitHub Actions runners from production builds using synthetic demo data.

This GitHub training copy includes role-specific instructions. Signing in and current program permissions are still required to use the corresponding website features. All examples are synthetic.

- [Use your tutee dashboard and schedule](#use-your-tutee-dashboard-and-schedule)
- [Edit or recall your tutoring request](#edit-or-recall-your-tutoring-request)
- [Request withdrawal from tutoring](#request-withdrawal-from-tutoring)
- [Appeal an invalid tutoring request](#appeal-an-invalid-tutoring-request)
- [Review attendance, give feedback and appeal a card](#review-attendance-give-feedback-and-appeal-a-card)
- [Continue eligible pairings into the next quarter](#continue-eligible-pairings-into-the-next-quarter)
- [Suggest or respond to a dated session change](#suggest-or-respond-to-a-dated-session-change)

## Use your tutee dashboard and schedule

Find assigned tutors, confirmed times, rooms and the next task.

Open: `/student?view=dashboard`

### Before you start

- Use your own tutee access. First-time participation requires current tutee policy acceptance; merely visiting grants nothing.

### Walkthrough

1. **Start with Dashboard** Read current session and request summaries. Use Request a Tutor in the header for a new eligible request. Choose My Tutors & Schedule for the complete current assignment list.

   Look for: Workspace navigation and current task summaries

2. **Read schedule status carefully** Check tutor, subject, weekly time and room. Awaiting schedule means a tutor is assigned but no time has been confirmed. Use dated session cards for agreed moves/extras, and confirm individual dates with your tutor.

   Look for: Assigned subject, tutor, time and room

3. **Move to the task you need** Requests manages enrollment; Attendance contains records/feedback; Support contains cards/appeals; Messages and Account stay inside this workspace. Previous/Next controls belong to their individual lists.

### What happens next

You can distinguish an assigned tutor from a confirmed weekly schedule and open the right follow-up.

### How it works

Only current active-period assignments on explicitly owned non-inactive profiles appear in the current schedule; historical attendance remains available. No-tutoring notices distinguish information-only dates from paused regular commitments; agreed exceptions use dated scheduling.

### Troubleshooting

- **The count is unknown or a tutor seems missing** Use Retry for unavailable reads. Check Requests and the active period; ask staff to review explicit ownership or inactive status rather than matching another person's name/email.

## Edit or recall your tutoring request

Correct current answers while preserving history, or permanently close an unmatched request.

Open: `/student?view=requests`

### Before you start

- You explicitly own an open request in the active program period.

### Walkthrough

1. **Open Current Request** In Requests review request status, original priority, current choices, assigned tutors and any review notice. Closed contains retained terminal/history entries.

   Look for: Current Request and its edit/recall actions

2. **Edit eligible current answers** Choose Edit Signup Answers and correct eligible names/contact/grade, availability or unassigned subject choices. Check the draft, then choose Save signup answers; this saves directly without another confirmation dialog. Read the saved result before editing again. Assigned choices cannot be dropped here; ask Admin/Head to review release and answer changes together.

3. **Recall only when you mean to close it** For an eligible unassigned request choose Recall, read permanent-closure consequences, wait for the two-second confirmation and confirm. Cancel leaves it open. Check the saved result rather than submitting again after a refresh warning.

### What happens next

The current request shows accepted answers, or the recalled request appears closed with its history retained.

### How it works

An eligible current open request can be edited after public intake closes. Editing preserves original priority, assignments, sessions and signed evidence and does not change canonical login identity. Recall permanently closes that request; applying later establishes a new priority.

### Troubleshooting

- **The request changed while editing** Keep the draft, explicitly reload the current version and review before resubmitting. A normal read Retry does not replace the captured review version.

## Request withdrawal from tutoring

Ask for reviewed withdrawal after assignment and follow the actual decision.

Open: `/student?view=requests`

### Before you start

- You have eligible current participation, including a staff-entered enrollment explicitly linked to your account.

### Walkthrough

1. **Open Participation** In Requests → Participation choose Request withdrawal…. Check that the button names the correct current quarter or semester.

   Look for: Participation and Request withdrawal

2. **Give the reason and review** Enter your reason, review which participation ends, wait for the three-second confirmation and submit. Cancel or Escape before submission leaves participation unchanged.

3. **Follow the decision** Check the pending request and later approval or decline. Assignment remains active while review is pending. If accepted submission cannot refresh, use the read-only retry.

### What happens next

A reasoned withdrawal request is recorded; participation ends only after approval.

### How it works

Approved withdrawal ends participation and blocks another request in the current program period. A tutor schedule-conflict review is narrower: approved rejection releases only that tutor's assignment and retains matching priority.

### Troubleshooting

- **You only want to change one subject or date** Use the request editor, staff assignment review or dated rescheduling instead. Review the displayed scope before choosing whole-period withdrawal.

## Appeal an invalid tutoring request

Read the reason, submit one explanation and distinguish its receipt from a decision.

Open: `/student?view=requests`

### Before you start

- You own the flagged request and its appeal is still eligible in the active period.

### Walkthrough

1. **Read the invalidity notice** Open Review a Flagged Request in Requests and check its appeal status. You can also use the private link in the notice for this request. Complete sign-in or verification if prompted.

   Look for: Invalid request reason and appeal action

2. **Submit a reasoned appeal** Choose the appeal action, explain why the flag should be reviewed and submit once. Keep the page open while sending; a saved receipt is not an accepted appeal decision.

3. **Check the separate decision** Read Pending, Declined or Cleared. Acceptance clears the flag and preserves original priority. Final rejection closes the active request and ends that priority, while retaining evidence.

### What happens next

Your appeal has a recorded submission and a separately visible management decision.

### How it works

The request remains invalid and blocked during appeal. Appeals and resends do not extend fixed verification deadlines. Current signup appeals end at period rollover. Older request-specific appeal links have their own displayed validity and allow only their limited appeal action.

### Troubleshooting

- **Appeal submitted but the flag remains** Read the decision separately; submission alone does not clear it. If refresh failed after sending, retry the read instead of submitting the appeal again.

## Review attendance, give feedback and appeal a card

Use session records and your own support history, with visibility and deadlines explained.

Open: `/student?view=attendance`

### Before you start

- The session or disciplinary card belongs to an explicitly owned profile.

### Walkthrough

1. **Open Attendance** Read recorded sessions across intakes and select the relevant lesson for feedback. Check the visibility explanation before submitting: feedback is management-only by default, with optional sharing to that session's tutor.

   Look for: Recorded session and feedback visibility

2. **Submit your feedback** Enter the requested feedback and save once. If visibility is being checked or unavailable, use its retry to verify the current setting rather than assuming an older setting applies.

   Look for: Expanded Session Feedback rating, comment and save controls

3. **Review and appeal your card** In Support, find your card and read its reason, displayed appeal deadline and status. Submit one reasoned appeal by the end of the fifth school day after its recorded issue date in the program time zone. Return to Support to check the decision.

   Look for: Your cards, appeal reason and status

### What happens next

Feedback or appeal displays its saved state, with the relevant sharing rule or decision visible.

### How it works

Later feedback sharing changes also affect earlier feedback. Pending appeals do not invalidate cards. With discipline enabled, an unexcused absence creates a valid red card; three valid yellows contribute one effective red, and two effective reds can remove active participation automatically.

School holidays and make-up days follow staff's school calendar. An upheld appeal invalidates the card and recalculates standing under the existing restoration rules.

### Troubleshooting

- **Sending succeeded but records did not reload** Use Try again to read the saved record. Your draft remains while the page stays open; do not resubmit an accepted appeal. For wrong attendance ask management to correct the exact record.

## Continue eligible pairings into the next quarter

Review prior choices during the limited continuation window and read each assignment outcome.

Open: `/student?view=requests`

### Before you start

- An official Q1→Q2 or Q3→Q4 refresh has occurred, quarter mode is active, and you are within one hour of destination tutee signup first opening.

### Walkthrough

1. **Select owned previous pairings** On Dashboard or Requests read the continuation deadline in program timezone. Select the prior tutor/subject pairings you want and choose Review selected pairings.

   Look for: Eligible continuation choices and named deadline when offered

2. **Review and sign** Read tutors, subjects and inherited weekly times, then review the current policy, agree and sign. Your request may contain at most two distinct subjects, including subjects already requested this quarter. Choose Join selected pairings.

3. **Read each saved result** Assigned and Request filed; awaiting assignment are different outcomes and may be mixed. Check the dated calendar for actual meetings and rooms. If the result is uncertain choose Check request result before submitting again.

### What happens next

The accepted choices are added to one current request with an explicit outcome for each pairing.

### How it works

Pausing/reopening intake does not restart the hour. Continuation is unavailable across semesters/years or in semester mode. Confirming a regular signup removes continuation choices. Ineligible assignments may remain filed for matching; original historical evidence is retained.

### Troubleshooting

- **No continuation choices appear** Check the transition, deadline, explicit ownership and whether you confirmed a normal request. Use the regular form when recruitment is open; unknown first-opening history does not create an invented window.

- **The panel asks to review required details** Choose Review required details. Check the required name, academic and contact information, and complete email verification if prompted. Contact the program team if information is missing from your prior record.

## Suggest or respond to a dated session change

Agree on reschedules, extras and cancellations without changing weekly pairing groups.

Open: `/student?view=schedule`

### Before you start

- You are an affected tutee on a current dated session or proposal.

### Walkthrough

1. **Open the exact session** In My Tutors & Schedule choose the dated lesson and use its suggestion or response action. Message to coordinate helps discuss a time, but a message alone does not formally accept a change.

   Look for: Dated session and pending proposal actions

2. **Review scope, time and location** Read which tutees are affected, the original/proposed times and assigned room or Online. Accept a workable proposal. Rejecting a tutor's first single-tutee proposal requires an alternative; review the final-proposal consequence before responding.

3. **Handle a group or cancellation** For an all-tutee proposal everyone must accept the same time. Each may reject once with an alternative; later conflicts use Separate reschedule. For an agreed extra's cancellation choose Accept cancellation or Decline cancellation; no alternative time is required.

4. **Check the authoritative outcome** After responding, check the session's agreed state and essential notice. A cancellation submission receipt does not cancel the lesson. Refresh failed views using the read-only retry.

### What happens next

The portal records your response and shows whether the dated commitment actually changed.

### How it works

A valid 24-hour response window begins only after essential email is accepted by the mail server; failure blocks automatic acceptance. When a full window cannot fit before the earlier session start, explicit agreement is required or the proposal expires. Rejecting a final single-tutee reschedule cancels only that dated commitment; rejected extras leave the regular lesson intact.

Declined or expired extra-cancellation requests preserve the lesson. Scheduling changes do not create attendance or absence records.

### Troubleshooting

- **Email failed or the request expired** Check delivery/status and coordinate with the tutor. Do not assume silence moved a lesson; use the portal's confirmed schedule. The original remains unless a separate authoritative change cancels it.
