# Student and Management Workflows

## Student journey

Student onboarding is a separate PR. This branch retains the existing public `/signup` form and does not add student account registration or enrollment linking. The workflows below operate on an existing verified account linked to its student record. The student identity schema is retained as a prerequisite for the separate onboarding implementation.

4. Management reviews `/admin/requests` and assigns tutors. The student receives a notification and sees current assignments at `/student`. Historical attendance remains visible after a refresh.
5. Expand a session to enter or update feedback. The page states whether only management or also the assigned tutor can read it.
6. Appeal a disciplinary card from its record. Management reviews the reason and original card in `/student-support`. The student receives the outcome in their portal. Invalidating a card recalculates disciplinary standing and any resulting removal effects.
7. Use `/messages` for private conversations with management and `/my-account` for account settings. Existing tutors or management members may also participate as students using the same login.

## Management workspaces

- **Student Support:** `/student-support` contains feedback visibility, feedback and appeal review, school-calendar overrides and policy-acceptance evidence. Staff can switch feedback sharing on/off immediately. The setting applies to already-submitted feedback too.
- **Messages:** `/messages` is an inbox and composer. Management can message participants and colleagues; participants can message management. Inbox and recipient reads are scoped on the server. Messages have a single-use client key so a network retry cannot send duplicates. The open inbox refreshes every 30 seconds and does not poll in the background.
- **Interview Management:** `/interview-management` records subject qualifications and actual interview completion. Qualifications are separate from current pairings. Record duration and attendees to credit hours; resubmitting or correcting completion replaces earlier system credits.
- **Tutor Applications:** `/admin/applications` supports panels of 3–8 people. Select a highest-ranking management member as chair. All panelists need active tutor accounts; management members without tutor participation must have that enabled first. Qualification validation happens on assignment and again on decision.
- **Translation Review:** `/translation-review` displays proposals. Translators can compose website text translations there and UI translations at `/localization`. Management approves or rejects proposals; only approved changes reach live content.
- **Corrections:** existing attendance and patrol correction forms keep their management permissions and audited reasons; they now notify HEAD.

## Semester accounting

The stored program period, not an inferred calendar month, groups meeting absences. Q1/Q2 and Q3/Q4 form the two semesters of each school year. The first three unexcused meeting absences are allowed; each further one deducts 0.25 hours. Excused meetings do not consume the allowance. Correcting or deleting an early meeting recalculates later deductions in the same semester. Meeting self-excuses close 60 minutes before the start.

## Room conflicts

Database triggers enforce half-open time ranges for room allocations: 15:00–16:00 may be followed by 16:00–17:00, but may not overlap. The guard covers pairing creation, edits, time-slot changes and room blackout edits, including concurrent requests. Program periods remain separate.

Attendance reports describe what actually happened. Choosing a room occupied by another allocation shows a warning; reporting a historical conflict notifies management and creates an audit entry. This does not authorize a new conflicting booking.

## Consent and access

Policies are revisioned from published content across their languages. Changes invalidate current consent without deleting old acceptance evidence. Tutor attendance submission requires current acceptance. Enrollment consent enforcement belongs to the separate onboarding PR. Account settings, messages, history, feedback and appeals remain available, including to participants awaiting renewed acceptance.

Students cannot browse the administrative data through the viewer role. An account may link to one student record. The existing public signup creates a new pending record and does not link or claim an account. Verified account email changes synchronize the linked student profile; management cannot bypass verification by changing that linked email in the tutee editor.

## Fresh Ubuntu deployment

Follow [README-DEPLOY.md](README-DEPLOY.md). Run migrations and the seed-free bootstrap; do not import the old local test database. Before opening intake:

- Complete the separate student onboarding PR and configure its email delivery before offering self-service student accounts. Email delivery is also required for account email changes and is separate from optional login email 2FA.
- Publish the revised tutor and tutee policies matching [the confirmed rules](REVIEW-QUESTIONS.md).
- Set the intake opening time; configure subjects, time slots, rooms and blackouts.
- Confirm tutor subject qualifications and management panel membership.
- Enter school holidays and make-up days for accurate appeal deadlines.
- Confirm feedback visibility (default: staff-only).

Remaining Ubuntu image, reverse-proxy/TLS, restart and backup/restore checks are in the implementation report. Local test and bootstrap success are not evidence of a completed VM deployment.
