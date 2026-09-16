# Confirmed Product Rules

These decisions supersede the earlier questions. Integrated workflow details are in [user-guide.md](user-guide.md).

1. **Corrections:** HEAD and ADMIN correct past records directly; COORDINATOR submits corrections for ADMIN/HEAD approval before any live change. Reasons, audit snapshots and HEAD notifications remain required. This supersedes the earlier direct-coordinator rule, confirmed on 9 September 2026. Tutors and students do not gain management editing permissions.
2. **Automatic hours:** completed interviews credit actual duration to recorded attendees. Meeting penalties follow the semester allowance below and recalculate after corrections.
3. **Interviews:** at least three distinct active tutor panelists; at least one management member and one staff-confirmed tutor qualified in an applicant subject. A highest-ranking management member chairs the panel and breaks ties. Every panelist votes; otherwise the decision remains pending. HEAD outranks ADMIN, which outranks COORDINATOR. Among equally ranked management members, the selected chair breaks the tie.
4. **Meeting excuses:** the cutoff is 60 minutes before the meeting.
5. **Student accounts:** survey first, with signed policy consent; email confirmation creates or links the account. Original survey submission sets priority, and first unverified assignment starts a fixed seven-day deadline. Students retain records across intakes, submit feedback and appeal their cards. Feedback is management-controlled and staff-only by default. Existing users retain one account identity.
6. **Messages:** contact permissions use role-based groups and explicit overrides. New sends disclose HEAD/ADMIN supervision and support auditable moderation; historical messages remain participant-only. Notifications omit message bodies. See [messaging behavior](messaging.md) and the dated decision below.
7. **Rooms:** overlapping planned bookings are blocked, including direct API and concurrent writes. Adjacent bookings and separate program periods are allowed. A truthful historical attendance report in an allocated room remains possible after a warning; management receives a notification and audit entry.
8. **Translators:** assigned translators prepare proposals; management approves publication or rejects them. Translator status does not allow structural publication or deletion. UI-string drafts use the existing localization editor; website text drafts use the translation review workspace.
9. **Policy updates:** renewed acceptance is required after a published policy change. Accepted text, revision, signature and timestamp are retained. Personal history, feedback, messages and appeals remain accessible. Tutor attendance and student participation require current consent.
10. **Semesters and meeting penalties:** Q1+Q2 form semester one; Q3+Q4 form semester two, grouped by school year and the program refresh periods. The first three unexcused tutor-meeting absences in each semester incur no automatic meeting deduction. Each subsequent unexcused meeting absence deducts 0.25 hours. Excused absences do not count. This replaces the old 0.125-hour-per-meeting rule; it is not stacked with it.

## Operational choices made explicit

- Feedback visibility changes apply to existing and future feedback. Staff-only feedback can be discussed separately with a tutor through a private message.
- School-calendar overrides handle holidays and make-up days for the five-school-day appeal window. Without overrides, Monday–Friday are school days. Staff can edit overrides in Student Support.
- Appeals do not automatically void cards while pending. Management can correct the record; a successful appeal invalidates its card and reconciles disciplinary standing.
- Interview scheduling does not earn hours. Management records actual completion, duration and attendees with a reason. Correcting completion replaces the system-generated credits.
- Publish school-reviewed handbook revisions and require renewed consent before launch. Production begins with an empty database; configure real email delivery and school-specific content using the [deployment runbook](deployment.md).

## Release decisions confirmed on 9 September 2026

- A coordinator interview chair proposes the final result, including a tie decision. ADMIN/HEAD approves that result without replacing the chair identity; votes and qualifications are revalidated.
- Coordinator translation decisions also require ADMIN/HEAD review; the translator draft and publication apply together through one approval step.
- Student workflow proposals consume the coordinator confirmation ticket at submission. Reviewers open a fresh timed consequence dialog; another user’s ticket is never replayed.
- [English and Chinese policy sources](policies/README.md) reflect confirmed rules and await school editorial review/publication.

- Session rounding is preserved as explicitly confirmed: 35 minutes → 1 hour, 70 → 1 hour, 71 → 1.5 hours before the attendance multiplier. Interview completion uses actual recorded duration. See [examples](../prisma/policies/tutor-policy.en.md#service-hours).

## Messaging decisions confirmed 13 September 2026

Issues [#47](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/47) and
[#48](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/48) confirm immediate,
independent private deliveries; per-role contact-group unions with replacing per-user
overrides; assigned current/past tutors and exact scheduled-group membership; and HEAD/ADMIN
supervision with auditable moderation. Coordinators keep their own management-shell inbox.

The rollout preserves historical participant-only messages and explicitly discloses supervision
for new sends. Existing accepted policy snapshots are retained. See [messaging behavior and
rollout](messaging.md) for privacy handling, assignment-evidence limits and policy publication.
