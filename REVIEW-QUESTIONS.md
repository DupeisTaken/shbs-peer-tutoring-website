# Confirmed Product Rules

These decisions supersede the earlier questions. Workflow details and separately scoped onboarding work are in [STUDENT-WORKFLOWS.md](STUDENT-WORKFLOWS.md).

1. **Corrections:** HEAD, ADMIN and COORDINATOR can correct past records directly. A reason and audit snapshots remain required; HEAD receives an in-system notification. Tutors and students do not gain management editing permissions.
2. **Automatic hours:** completed interviews credit actual duration to recorded attendees. Meeting penalties follow the semester allowance below and recalculate after corrections.
3. **Interviews:** at least three distinct active tutor panelists; at least one management member and one staff-confirmed tutor qualified in an applicant subject. A highest-ranking management member chairs the panel and breaks ties. Every panelist votes; otherwise the decision remains pending. HEAD outranks ADMIN, which outranks COORDINATOR. Among equally ranked management members, the selected chair breaks the tie.
4. **Meeting excuses:** the cutoff is 60 minutes before the meeting.
5. **Student accounts:** onboarding order and enrollment are owned by the separate signup PR. The account and student-record link is a prerequisite for the portal features. Students see their own records, submit feedback, and appeal disciplinary cards. Feedback visibility is management-controlled (staff-only by default). Existing users keep one identity when adding student participation.
6. **Messages:** private in-system management-to-participant conversations and replies. Participants can contact management; other students' accounts are not exposed as a student address book. Only the two participants can read a message, including when another management member requests it. Notifications omit message bodies.
7. **Rooms:** overlapping planned bookings are blocked, including direct API and concurrent writes. Adjacent bookings and separate program periods are allowed. A truthful historical attendance report in an allocated room remains possible after a warning; management receives a notification and audit entry.
8. **Translators:** assigned translators prepare proposals; management approves publication or rejects them. Translator status does not allow structural publication or deletion. UI-string drafts use the existing localization editor; website text drafts use the translation review workspace.
9. **Policy updates:** renewed acceptance is required after a published policy change. Accepted text, revision, signature and timestamp are retained. Personal history, feedback, messages and appeals remain accessible. Tutor attendance submission requires current consent; enrollment is scoped to the separate signup PR.
10. **Semesters and meeting penalties:** Q1+Q2 form semester one; Q3+Q4 form semester two, grouped by school year and the program refresh periods. The first three unexcused tutor-meeting absences in each semester incur no automatic meeting deduction. Each subsequent unexcused meeting absence deducts 0.25 hours. Excused absences do not count. This replaces the old 0.125-hour-per-meeting rule; it is not stacked with it.

## Operational choices made explicit

- Feedback visibility changes apply to existing and future feedback. Staff-only feedback can be discussed separately with a tutor through a private message.
- School-calendar overrides handle holidays and make-up days for the five-school-day appeal window. Without overrides, Monday–Friday are school days. Staff can edit overrides in Student Support.
- Appeals do not automatically void cards while pending. Management can correct the record; a successful appeal invalidates its card and reconciles disciplinary standing.
- Interview scheduling does not earn hours. Management records actual completion, duration and attendees with a reason. Correcting completion replaces the system-generated credits.
- The published handbooks need editorial revision to match these newly confirmed rules before launch. A major policy update and renewed consent were explicitly requested.
- Production begins with an empty database. Real SMTP/email 2FA provider setup and final placeholder content remain deferred as requested.
