# Tutee workspace

Every signed-in, unsuspended account can use **Enter Tutee page**, including tutors,
crew, viewers and management. Tutee participation is independent of the account's
permission role. The existing `/student` URL remains stable for saved links and
verification flows; the visible interface calls participants **tutees**.

The workspace follows the tutor page's top bar, theme, account menu and card layout.
Its navigation separates Dashboard, My Tutors & Schedule, Requests, Attendance and
Support. Messages and Account open the existing private messaging and shared account
pages. URL view parameters can be bookmarked; an unknown view opens Dashboard.

**Request a Tutor** opens the existing form at `/signup` from every workspace view.
The form-first process, email confirmation, submission order, fixed deadlines and
policy consent remain unchanged. The overview distinguishes verified open requests
from scheduled sessions; it does not create or enable participation just by visiting.
For an unconfirmed request, keep using its email confirmation link.

Schedules include current-period pairings for all explicitly owned, non-inactive
profiles, deduplicated by pairing. The current account-profile pointer is not the only
ownership source. Historical attendance stays accessible. Matching a name or email
never grants access to another person's records.

Requests reuse the existing availability, recall, withdrawal and history controls.
The staff-reviewed whole-period withdrawal and tutor-relayed recall-window workflows
retain their existing policy. Attendance retains feedback controls. Support separates
personal disciplinary cards and appeals from private messages. Pagination in Attendance
and Support only follows the records visible in that section.

The role enum `STUDENT`, API names and URLs are internal compatibility identifiers.
English catalog copy now says Tutee; stored policy snapshots and historical approvals
are not rewritten by this interface change.

When semester mode is applied, the workspace period badge and request/withdrawal
copy use semester terminology. A scoped locale provider applies the configured
`workflow.semesterCopy` strings without changing shared messages, stored policy
records, deadlines or withdrawal behavior. Pending feature changes do not change
the current wording until applied.

## Verification

- Workspace component tests cover form/account links, unknown views, loading errors,
  section isolation and independent pagination.
- Layout tests cover every account role, unauthenticated access and suspension.
- The shipping integration suite covers multiple owned profiles, duplicate joins,
  historical and inactive exclusions, foreign records with the same name, and overlapping
  tutor/admin participation.
- Browser review should exercise an empty account and a linked tutee at desktop and
  mobile widths, including the form link, Requests and Support actions.

Messages and Account are now focused views inside the same tutee navigation and header. They reuse the existing inbox and shared self-service account controls, including verified email/password changes. Legacy /messages and /my-account links remain valid for other workspaces. No messaging recipient permissions or account security rules change.
