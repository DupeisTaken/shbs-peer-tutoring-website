# Program functions and controls

[Documentation home](../README.md) · [Role guide](user-guide.md) · [Deployment](deployment.md)

This is the supported single-program website. Account role, tutor participation, crew membership and translation assignment are separate capabilities. Page visibility follows both permission and the effective program configuration; the server checks access independently.

## Management responsibilities and review

Head is the root management role and inherits every Admin capability. Admin and
Head apply non-refresh management changes directly; Coordinators submit permitted
changes to Management Actions. A pending request never changes live records.
Ordinary review notices go to eligible Admins, with Head as fallback when none can
review. Head retains review access even when an Admin receives the notification.

| Category and entry points | Direct authority | Allowed requests | Reviewers |
| --- | --- | --- | --- |
| Recruitment windows, timezone, staged modules and next-period openings | Admin or Head | Coordinator | Admin or Head |
| Official program refresh and activation of staged settings | Head | Admin | Head |
| Program/security configuration, calendars, policies, language settings and signup fields | Admin or Head | Coordinator where the workflow permits | Admin or Head |
| Account/roster names, usernames, academic corrections and participant badges | Admin or Head | Coordinator | Admin or Head |
| Non-Head management rank grants/revocations and Admin/Coordinator invitations | Admin or Head | No Coordinator requests | Admin or Head for compatible historical requests |
| Leadership transfer | Current Head, with fresh password and singleton checks | Dedicated transfer only | — |
| Identity combination, account deletion and record import/export | Admin or Head, with dedicated confirmation/ownership checks | Dedicated workflows only | — |
| Private-message supervision and contact restrictions | Admin or Head | No Coordinator requests | Admin or Head |
| Daily operations, corrections, reversals, reinstatements and historical hours | Admin or Head | Eligible Coordinator | Admin or Head |
| Participant membership/appeal requests | Underlying participant workflow | Eligible owner | Admin or Head |

Participant ownership, consent, interview chair/applicant safeguards and explicit
translator assignment remain independent of management rank. Coordinators cannot
grant or demote management rank, supervise private messages or execute refresh.

Initial tutor application name corrections allow Admin/Head to apply and Coordinator
to propose. The four name fields and correction reason are the whole save scope.
Contact, qualification and policy evidence remain unchanged. A name correction
does not accept the request or clear an invalid flag. See
[the correction workflow](user-guide.md#correct-an-initial-tutor-applications-name).

The executable inventory is [approval-policy.ts](../../src/lib/approval-policy.ts).
Restoring archived subjects, subject levels or time slots allows Admin/Head application
and Coordinator proposals, including batch edits and implicit course-group restoration.

Its input-dependent classification covers restorations even when the button does not say
Undo. Corrections that can remove penalties or restore participation use Admin/Head review for
the entire correction; dependent effects cannot apply early. Initial pending decisions are
daily work, while changing an already applied decision is a reversal.

Withdrawing an unapplied request, cancelling an unused confirmation ticket, editing an
unsaved draft and read-only previews are not reversals of live program decisions. Existing
setup/verification resends remain direct operational conveniences: they do not grant rank,
assign participants or extend an intake deadline. Leadership transfer, account combination,
account deletion and program-record import/export keep their dedicated safeguards.
Only leadership transfer remains exclusive to Head among these dedicated flows.
Unknown Coordinator writes are refused rather than silently acquiring direct authority.

Head retains the ability to review their own eligible request. Other reviewers cannot decide
their own pending proposal. Current roles and suspension status are rechecked before application;
changed target evidence requires a fresh request. A legacy role-change proposal requires the
reviewer's fresh password, which is never saved in the proposal or audit log.

Pending proposals are re-evaluated under the current authority policy. Their original
submitted evidence, fingerprint and historical review authority remain immutable;
decision audits record both submitted and current policy versions. Incompatible or
stale requests must be rejected/returned and resubmitted from fresh evidence.

After rolling out this policy, an Admin or Head opens **Management Actions** and
uses **Refresh reviewer notifications** once. This appends missing notices for
current eligible reviewers; it does not approve requests, replace history or resend
notices already delivered. Role/membership changes and leadership transfer also
reconcile pending review ownership. The result reports pending requests inspected
and notices added; repeating the action is safe. It covers Management Actions,
Tutor/Crew membership requests and Crew applications. Stale membership state or
inactive owners are skipped. Older queue-wide notices cannot be attributed to a
particular source, so one new source-specific notice may accompany an old notice;
later runs do not repeat it. Crew links open the review panel and reveal the record.

Audit Log records direct changes, requests, decisions, reversals and automatic program changes,
with actor/role, operation, outcome and available safe before/after evidence. Undo links to its
original event. Missing legacy evidence is not reconstructed from today's records. Secrets and
private-message bodies are excluded; failed attempts are distinct from applied changes.

## Functions by purpose

| Purpose                                                | User entry                                                                                                                                                   | Management entry / outcome                                                                                                                                                                                                                                                                                                                                 |
| --- | --- | --- |
| Request tutoring                                       | Home → Request a Tutor; full application at `/tutee-signup` → mailbox code or legacy email-link confirmation → invitation popup → `/register-account` review | Signup Requests (`/admin/requests`): verify demand, match at original survey priority, review current and processed requests                                                                                                                                                                                                                               |
| Become a tutor                                         | Home → Become a Tutor; `/tutor-signup`                                                                                                                       | Tutor Applications: select qualified panel and chair, interview, vote and decide; record actual completion in `/admin/applications#interview-records`                                                                                                                                                                                                      |
| Create an accepted tutor account or add invited access | Single code card at `/register-account` (published `/register` links redirect there), then required mailbox verification and shared account/access review    | Registration Codes and Users & Roles; an application, roster row or displayed invitation alone is not a login or access grant                                                                                                                                                                                                                              |
| Participate as a tutee                                 | `/student`, with Dashboard, Schedule, Requests, Attendance, Support, Messages and Account tabs                                                               | Tutee Roster, Pairings, withdrawals and discipline; explicit account ownership controls records                                                                                                                                                                                                                                                            |
| Teach and record attendance                            | Tutor Dashboard (`/dashboard`), Settings (`/settings`), Handbook (`/handbook`)                                                                               | Attendance Submissions, Attendance Flags, Service Hours and Hour Adjustments                                                                                                                                                                                                                                                                               |
| Schedule teaching                                      | Tutors maintain availability and pairing defaults                                                                                                            | Subjects & Levels, Time Slots, Rooms and Pairings; room blocks warn against conflicts                                                                                                                                                                                                                                                                      |
| Manage interviews                                      | Assigned panelists vote in Tutor Dashboard; the chair schedules and records the decision                                                                     | Tutor Applications assigns panels and retains interview history/completion; Subject Availability independently shows approvals, recorded inheritance and willingness                                                                                                                                                                                       |
| Review subject availability                            | Staff → Tutors → Subject Availability; `/admin/subject-availability`                                                                                         | HEAD, ADMIN and COORDINATOR can inspect qualifications and willingness separately, including inherited grants. Coordinator changes require approval. Availability requires an active subject and level (or no level), an active tutor with tutoring access, a recorded approved grant and explicit willingness; timetable/capacity checks remain separate. |
| Communicate                                            | Workspace Messages and notifications                                                                                                                         | Announcements support immutable recipient snapshots, filters and individual overrides; private deliveries remain isolated per recipient; disclosed new messages allow audited HEAD/ADMIN supervision ([contact controls](#message-permissions-and-supervision))                                                                                            |
| Get support                                            | Tutee Support tab, session feedback, card appeals and private messages                                                                                       | Tutee Support (`/admin/student-support`) handles shared feedback and appeals; Program Settings holds calendars; Users & Roles → User details holds account-scoped policy acceptance history                                                                                                                                                                |
| Review management changes                              | Eligible staff prepare changes according to the responsibility matrix                                                                                        | Management Actions: Admin/Head review permitted non-refresh changes and reversals; Admin/Head review daily operations; pending is not applied                                                                                                                                                                                                                               |
| Observe the program                                    | `/viewer-signup` → verify email → invitation popup with copy, optional email and prefilled `/register` link → account review                                 | New VIEWER sees permitted summaries with private contact data masked; an existing account's LOGIN invitation preserves access and credentials                                                                                                                                                                                                              |
| Patrol rooms                                           | Apply at `/crew-signup`; active crew member → `/patrol`                                                                                                      | Crew maintains applications, membership, patrol room order, patrols and corrections; observations support attendance review                                                                                                                                                                                                                                |
| Maintain accounts                                      | Shared Account settings; Add access in settings/account menu; verified email changes and password recovery                                                   | Users & Roles manages identities, invitation/setup, capability assignment, suspension and leadership boundaries                                                                                                                                                                                                                                            |
| Publish program information                            | Home, program information menu and custom pages                                                                                                              | Landing Page edits content, media, menus and custom pages; Policy Documents publishes versioned runtime policies                                                                                                                                                                                                                                           |
| Translate                                              | Assigned translator → Translations (`/localization`)                                                                                                         | Draft/review/publish translations and control language visibility; hidden languages need wording review before launch                                                                                                                                                                                                                                      |
| Report and audit                                       | Reports (`/admin/history`) and permitted read-only views                                                                                                     | Period summaries, detailed records, CSV exports and browser printing; Audit Log identifies actual actor accounts and reviewed changes                                                                                                                                                                                                                      |

The invitation, Viewer signup and tutee application routes remain separate. Verified public
applications hand off to `/register` using a short-lived HttpOnly cookie; their links contain no
mailbox proof or password. New accounts review prefilled details and create missing credentials.
Existing accounts explicitly accept authorized Tutor, Crew or tutee access without losing other
access. An authorized participation or management invitation replaces the exclusive Viewer role;
a public Viewer-source LOGIN invitation adds no access. Management invitations retain the higher
of the existing and authorized ranks, never demote and never grant Head. MFA and suspension
remain enforced. Participation grants retain school departure checks, intake priority, policy
evidence and historical ownership; departure alone does not block a management rank grant.

Tutee public forms reuse the primary or verified-secondary address's existing
account, including a tutor requesting help. Same-email replacement requires proof
for that exact submitted request plus existing sign-in/MFA and explicit review;
email matching alone never grants access or combines accounts. Tutor recruitment
and its existing approval process remain separate.

New invitation and staff registration codes contain five characters, mixing letters
and numbers, and use a green box background. Separate email verification codes contain
four digits and use a blue box background. The website retains one wide input, with
gray `XXXXX` or `XXXX` placeholders; emails retain the existing single code panel.
Field labels and email instructions identify the purpose. Leading zeros are part
of the code. Codes are opaque: characters do not encode access or invitation type.
Outstanding five-digit, alphanumeric and twelve-character invitations remain usable
within their original validity, and entry fields accept the entire older code without
truncation.

## Optional modules

**Program Settings** groups controls into **Recruitment and Refresh**, **Account Settings**, **Deployment Configurations** and **Optional Features**. Recruitment and Refresh contains the separate tutoring notices and school-day calendar, timezone, recruitment windows and refresh. Account Settings contains name/grade policies, per-account-type name requirements and message-contact permissions. Deployment Configurations contains email/binding configuration and CAPTCHA. Optional Features contains staged feature switches. Message supervision remains in Messages; feedback and appeals remain in Tutee Support. Moving a control does not change its authority or effective timing.

Admin and Head stage changes to these switches in **Program Settings → Optional Features**. Changes take effect at the **next program refresh**, not when the switch is clicked. Auto-assign rooms alone is initially On at deployment, as described below. Existing records remain history. Do not refresh just to preview a switch: refresh changes participation and the current period.

| Switch | Default | Effect when applied |
| --- | --- | --- |
| Crew patrols (`CREW`) | On | Enables crew navigation, patrol workflows and procedures |
| Discipline cards (`DISCIPLINE`) | On | Enables disciplinary workflows and their controls |
| Tutor meetings (`MEETINGS`) | On | Enables meeting scheduling, attendance and advance excuses |
| Interviews & voting (`INTERVIEWS`) | On | Enables panel interviews, voting and completion workflows |
| Service hours (`SERVICE_HOURS`) | On | Enables service-hour views and related program controls |
| Quarter system (`QUARTER_SYSTEM`) | On | On uses Q1–Q4; Off uses S1/S2. Applied mode controls intake and withdrawal wording |
| Viewer signup (`VIEWER_SIGNUP`) | On | Allows public observer account registration; does not expand viewer permissions |
| Email 2FA (`EMAIL_2FA`) | On | Makes email two-factor functionality available; users opt into sign-in 2FA in Settings. Configure and test SMTP for production email flows |
| Auto-assign rooms (`AUTO_ASSIGN_ROOMS`) | On immediately at deployment | Allocates available rooms when schedules are confirmed or changed; disabling only stops automatic allocation |

Switches control available pages and operations; they do not erase historical data. Turning off service-hour views does not stop attendance from recording calculated hours. See [feature implementation](../../src/server/program/features.ts) and [refresh behavior](#refresh-the-program).

When Email 2FA is on, password changes also require an emailed verification code, even if the user has not opted into sign-in 2FA. Configure working email delivery before relying on this flow in production.

Auto-assign rooms is effective immediately when first deployed, even before a
feature setting has been saved. Turning it off or enabling it again is staged
until the next program refresh. The current On/Off badge remains authoritative;
the pending badge describes the next refresh. Switch back to the current value
to cancel a pending change. Admin and Head stage directly; Coordinator proposals require Admin/Head approval before staging.
Neither deployment nor changing the switch reallocates existing bookings.
When off, existing/manual reservations, conflict protection and room displays
continue to operate. If saving succeeds but reloading settings fails, use
**Retry refresh**; this only reads the saved states.

## Other configurable behavior

| Control                           | Scope / timing                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Program timezone                  | Admin/Head apply a supported IANA region; Coordinators request review. Existing instants remain fixed; weekly slots remain school wall-clock times                                                                                                                                                                                 |
| Tutor and tutee recruitment       | Admin/Head apply each active-period window; Coordinators request review for acceptance, optional start/end times and preview link. Clearing a start time still respects the switch, end time and setup requirements; see [recruitment windows](#tutor-and-tutee-recruitment-windows)                                               |
| Names and grades                  | Admin/Head apply offered grades and independently controls **Use preferred names** and **Show names in another language**; Coordinators request review; see [name fields and display settings](user-guide.md#names-and-academic-details)                                                                                           |
| Subjects, levels, slots and rooms | Management catalogues used by application, availability and pairing workflows                                                                                                                                                                                                                                                 |
| Policy versions                   | Published database revisions require new acceptance for participation; changing a bundled policy draft does not publish it                                                                                                                                                                                                    |
| School calendar                   | Admin/Head apply date-specific school closures, make-up school days and timetable weekdays; Coordinators request Admin/Head review. Defaults are Monday–Friday school days. School-day status affects appeal deadlines; a timetable mapping alone does not. See [school calendar](#school-calendar-and-timetable-dates) |
| No-tutoring dates                 | Admin/Head apply inclusive start/end date ranges with a reason; Coordinators request review. Protected tutor/tutee schedules display this informational context. It does not restrict attendance, cancel sessions, change recurrence, alter appeal deadlines or modify school-day rules |
| Name field requirements           | Admin/Head configure Required/Optional/Hidden for each field and account type; Coordinators request review. New signup uses its intake type; later shared-profile edits use the current account role. Hidden originals remain visible in authorized management editors; active labels exclude them and use username fallback when needed |
| Feedback visibility               | Management-only by default; configured sharing also affects earlier feedback                                                                                                                                                                                                                                                  |
| Announcements                     | Filters combine across groups; alternatives within a group match any choice; explicit exclusions win. Published recipients are fixed                                                                                                                                                                                          |
| Language visibility               | English and Chinese are the launch-visible catalogues; six hidden catalogues contain English fallbacks                                                                                                                                                                                                                        |
| Personal theme and guidance       | Six accent themes; dismissible management guidance can be reopened and remains scoped to the signed-in account                                                                                                                                                                                                                |

## Optional email notifications

Admin/Head can enable **Email Notifications** in **Program Settings → Deployment Configurations**; Coordinators submit the change for Admin/Head review. The setting takes effect when applied, defaults off and is separate from staged modules and email 2FA. Production requires configured email delivery. Individuals then choose private-message and information/program categories, and whether verified secondary addresses receive copies; see [personal preferences](user-guide.md#optional-email-notifications).

Disabling the setting cancels pending optional notices and preserves personal preferences. Users cannot enable notifications themselves while this program switch is off. Security alerts and essential public-request invalidity/clear notices remain mandatory. Request-status mail uses the PROGRAM sender but bypasses optional switches and personal preferences, goes only to the request's recorded address, and has no unsubscribe link.

New event notices explain the actual action and next step in the selected interface
language. Email includes English and Chinese together; the system does not save a
recipient email-language preference. The [notification event inventory](../reference/notification-events.md)
maps all supported events to their actual trigger, recipients, wording and destination.
Interview scheduling can carry a recorded date/time/timezone. Tutoring assignments
remain recurring weekly arrangements; an assignment notice does not create or promise
a specific session date. School-calendar notices separately name an actual date and
its school-day/timetable meaning, with optional information email copies. They do not
write to an external calendar provider or announce an individual dated session.

The independent **Secondary-Email Binding** switch takes effect when Admin/Head apply it; Coordinators can propose either email switch. Binding availability defaults on to preserve the existing workflow. Turning it off blocks add/resend/confirm operations, including a code issued before the switch changed. It preserves existing account addresses, sign-in/recovery, primary-email changes and removal/cancellation. A secondary email is never required for signup, setup or use. This switch does not require notification emails to be enabled.

The settings panel checks both security and program SMTP connection/authentication, warns about unavailable or missing transport, and reports retrying and terminal notification failures separately. **Refresh status** reads diagnostics without sending mail or changing the program; checks may be cached for one minute. Passing the check does not guarantee inbox delivery. Operators should inspect the safe failure summaries in `EmailDelivery` and follow the [delivery operations guide](deployment.md#optional-notification-delivery). Essential authentication mail remains independent.

ADMIN/HEAD can use **Resend stuck emails** to queue up to 100 eligible failed or retrying notifications after transport recovery. It excludes active leases, completed/skipped mail, unconfigured production categories and disabled optional notifications. The normal worker applies current preferences and recipient ownership for account notifications, and exact source/revision checks for essential request notices. This immediate, audited action cannot be proposed by coordinators; a successful result confirms queuing rather than inbox delivery.

Public-request invalidity remains an ordinary daily operation: Admin/Head apply it,
while Coordinators propose it for approval. Only an applied flag, clear or later
reflag creates a request-email receipt; pending/rejected proposals send no invalidity
mail to the submitter. A required reason, actor, time, revision and history are retained,
without rewriting the original intake, priority, answers or participation state.
Write reasons suitable for a verified submitter to read. Unverified recipients receive
only the request kind and original submission date/time/timezone plus the appeal action;
names, answers and reason are masked. Only request-specific mailbox proof permits the
reason, and missing historical times remain unavailable. Missing/invalid addresses
are blocked rather than treated as delivered.

The request's invalidity dialog includes receipt status and the latest appeal.
Admin/Head may retry an eligible receipt. Current survey signup appeals use the
active-period acceptance/final-rejection workflow; tutor and legacy-request appeals
use the separate decline/clear workflow below.
Status refresh is read-only, and retry preserves the receipt and original payload.
Request mail has five admitted attempts per retry budget. Admission commits **Sending**
before external SMTP starts; source locks and a unique attempt fence order admission
against clear/reflag and prevent an expired worker from completing a newer attempt.
Clearing supersedes queued obsolete notices; an already admitted attempt may finish.
SMTP acceptance followed by a crash can still produce an uncertain result and duplicate
retry, so receipt states do not promise exactly-once delivery or inbox arrival.

For a current survey signup, the flag email opens its version-bound signup appeal.
The owner can appeal only while the request remains eligible in its active period;
the original verification deadline still applies. Admin/Head acceptance clears the
flag and retains priority; final rejection closes the request and ends its priority.
Staff use the same flag-email receipt for retries; no parallel legacy survey notice
is created. Older generic survey links are retired and their appeal evidence is read-only. See the
[signup lifecycle](#tutor-and-tutee-recruitment-windows) for editing and closure rules.

For tutor applications and legacy self-service tutee requests, **Appeal this decision**
opens a public, request-specific capability valid for 90 days from receipt creation.
It grants no login or participation and opening it changes nothing. One immutable
appeal is accepted per flag. Admin/Head may decline it with a reason; clearing uses
the existing authorized action, including Coordinator proposals. Submission or
decline does not clear the flag or close the request. Old links cease to work after
clear/reflag while earlier evidence remains.

## Schedule rooms and periods

The room schedule offers combined and individual-room layouts, explicit room selection, a full availability legend and detail readers with room/day/time filters. Management starts with all rooms; tutors start with their paired rooms. Recorded confirmed pairing times remain authoritative when a catalog slot later differs. Unconfirmed assignments do not occupy a cell, and details retain unslotted records and every applicable block reason.

Within the same browser session, returning recalls the selected Program Settings panel, roster filters and sorting, schedule layout, selected rooms and detail filters. A direct Program Settings panel link takes precedence. Schedule selections wait for the current room/slot catalog, then drop removed choices; a deliberately empty room selection remains empty. Account editor drafts and refresh confirmation text are not stored. Each authorized page owns its scroll position; the room-grid component does not compete with the Pairings page for viewport scrolling.

The legend distinguishes gray occupied cells, × unavailable cells and available
published slots without an assignment. The participant subtitle identifies the
highlighted personal pairings and uses a room-status explanation consistent with
that legend.

In **Rooms**, management use the up/down arrows beside each room's existing actions to stage the display order in the current list. There is no separate ordering menu or duplicate room list. The single **Save order** or **Request room order change** row saves the complete order; **Reload order** explicitly replaces that draft and its expected order only after a successful read. Room-detail editors remain keyed by room ID, so moving a room does not save or discard their independent drafts. Pending order writes block additional order changes; failed writes retain the draft, and failed synchronization after an accepted write uses read-only refresh rather than resubmission. A changed room catalog requires Reload before further ordering. Stale or incomplete lists are rejected by the existing server authority. New rooms append to the saved order. Admin/Head apply the change; Coordinators propose it for review. Viewers cannot edit this program setting. This display order is independent from the Crew patrol order configured in Crew. A room-order request compares the complete captured display order with the proposed display order; neither sequence is a patrol-order change. Reordering does not move a pairing or change patrol sequencing.

Use **Time Slots**, **Rooms** and **Pairings** to plan recurring sessions. A room cannot host overlapping pairings in one program period or a pairing during a recurring blackout; back-to-back sessions are allowed. Availability helps participants agree on a slot and does not prevent staff from assigning a tutor before that agreement. New assignments display **Awaiting schedule** until a tutor or manager selects a catalog slot. These assignments do not reserve rooms or count as scheduled subjects; the assigned tutor remains visible to the tutee.

A tutor also cannot reserve overlapping times for separate assigned teaching
blocks, even with different rooms or no physical room. The default slot selector
marks these choices **Unavailable**; remaining choices retain **Both Available**
and **Other Time Slots** according to saved participant availability. Tutors can
first combine eligible assignments without a time, then choose one time for the
whole group. Every tutee must have the complete selected subject set. Management
Pairings keeps subject-level rows with a common group reference and group Details;
invalid retained groups are marked for repair before scheduling or combined
attendance. See [combining and splitting](user-guide.md#combine-and-split-recurring-pairings).

Each independent Pairings row reserves at most one room. An explicitly combined
pairing group instead shares one reservation using its primary assignment’s room
and schedule. Coincident times, shared students and one-off combined attendance
do not implicitly create a shared-room group. **Automatic** selects an eligible
room; **Fixed** preserves a room explicitly chosen by staff; **No physical room**
is an intentional choice that stays in effect until staff changes it. Existing
assigned rooms are fixed at rollout, and existing roomless records are not
silently backfilled. An authorized explicit release to Automatic permits the
next save to choose a room. A time change that conflicts with a fixed room is
rejected rather than moving that reservation.

An eligible room already assigned automatically stays in place. Otherwise the
allocator favors the greatest number of familiar participants, then familiarity
to the tutor, then fewer planned occupied minutes, then a stable room identifier.
Familiarity uses confirmed planned bookings in the current program period and
verified stable participant identities; the tutor and each distinct tutee count
once per candidate room. Repeated bookings do not create extra votes. Room names,
display order and patrol order do not imply capacity or suitability.

If no eligible room exists, the schedule is saved as **Needs room**, with no
physical reservation. Head/Admin receive an in-app notice when the shortage
starts or materially changes. Use the Pairings shortage filter and explicit
retry after resolving capacity; unchanged retries do not repeat the notice.
Its count uses reservations, so an explicit group is counted once; room-change
and retry reviews identify all affected group subjects before submission.
Room or blackout edits do not silently redistribute unrelated pairings.
Catalog-slot changes consider all affected pairings together and preserve
unaffected reservations. A Coordinator's proposal approves automatic-allocation
intent; the available room is chosen only when an authorized reviewer applies
the proposal. A queued proposal is not a live assignment.

The timetable uses actual confirmed weekday/time overlap, including a confirmed
schedule whose catalog link was cleared. Clearing that link does not unschedule
the pairing. Actual attendance location remains independent historical evidence.
After a successful save, failed reads are recovered through **Retry refresh**,
without replaying allocation or losing unrelated drafts.

Assignment selectors and Pairings show the current quarter's approximate assigned
session-block load and an optional tutor preference of 0–4 sessions. Selectors use
`(assigned/preferred)`, such as `(2/3)`, or `(2)` for an unset preference.
Submitting above the preference opens a Continue/Cancel dialog. New tutors default
to 1; existing unset values are preserved. Tutors edit this in **My Availability**.
Each valid saved group counts once, including while awaiting a schedule.
Independent assignments count separately even when their times match. Staff can assign over
the preference under the original approval rules. Inactivity resets it to locked
zero, and reactivation keeps zero until the tutor changes it. See the
[role guide](user-guide.md#tutors) for editing and the full counting rule.

In **Rooms**, each room shows its blocked-period count. Open **Manage blocked periods** to add a weekly block or edit its day, start/end times and optional reason. Use the program time zone and 24-hour times; an end of `24:00` means midnight. Split overnight blocks across two days. **Remove Period** opens a confirmation before releasing the time. No blocked periods means no recurring restrictions, not that the room has no bookings.

Admin and Head changes take effect after a successful save. Coordinators use **Request new block**, **Request edit** or **Request removal**; availability stays unchanged until Admin/Head approves in **Management Actions**. **View request** opens the submitted proposal with its recorded room name, weekday, clock times and reason; edits compare the original and proposed periods. Older requests explicitly identify missing recorded details. Rejection leaves the schedule unchanged. Viewers can inspect periods but cannot submit changes. Conflicting blocks, reversed/empty intervals and overlaps with active-period bookings are rejected, including during approval if the schedule changed after submission. Adjacent periods are allowed. A failed edit retains the form values for correction.

Changing a catalog slot affects linked schedules. Read the Time Slots guidance before saving; **How schedule changes work** reopens dismissed guidance. The tutor's default-slot control confirms a pairing's schedule and links it to the catalog. Clearing that link retains an agreed copied day and time; it does not erase the schedule. Clearing an assignment that is still awaiting scheduling does not assign a day or time. Record completed attendance truthfully even when it differs from the plan, then review any conflict warning.

Changing a catalog slot's clock times also updates previously recorded sessions linked to it. Admin/Head apply these changes; Coordinators submit them for review because they alter applied attendance. A combined block moves as a whole, even if one of its subjects has a different saved slot link. The change is rejected if it would overlap another saved block for the same tutor and date. Hours are recalculated once per block; affected attendance-flag decisions and their linked deductions are reconsidered, with prior evidence kept in the audit log and HEAD notified. Changing only the weekday does not change actual historical session dates or times. A concurrent attendance submission or correction may require a reload before retrying; a rejected slot edit leaves the slot, schedules, attendance and deductions unchanged.

The applied **Quarter System** setting controls labels: Q1/Q2 display in semester one and Q3/Q4 in semester two when quarters are disabled. Requests display their original intake, not whichever intake is currently active. Staged module changes take effect only at refresh; labels do not rewrite stored deadlines or attendance.

**Subjects & Levels** configures each subject group once. Select its offered levels and enter a separate base name for each: Standard “Intro to Computer Science” displays without a prefix, while AP “Computer Science A” displays as “AP Computer Science A”. Level prefixes are editable; leave the Standard prefix empty. Reorder groups to control the management group display and reorder levels along the **Beginner → Advanced** scale. Course pickers (including both tutee choices and tutor applications) follow that level scale first, then alphabetize by the underlying course name within each level. Courses with no level appear alongside the unprefixed/regular tier without changing their saved level. Group order does not affect picker order. Each group displays beginner levels first. Use **Import Subjects** with a JSON file to create complete groups with multiple offerings. [Download an example](../../public/examples/course-groups.json). Each group has a `name` and an `offerings` array; each offering has a `baseName` without a prefix and a `level` matching an existing active level name (case-insensitive), or `null` for no level. The format is `{ "groups": [{ "name": "Computer Science", "offerings": [{ "baseName": "Intro to Computer Science", "level": "Standard" }, { "baseName": "Computer Science A", "level": "AP" }] }] }`. Create the levels first. Import at most 500 offerings in a file of at most 1 MB. New groups are appended in file order; offerings follow the configured level order. Exact repeats are skipped. Existing groups with different offerings, archived variants, duplicate names/levels and unknown levels cause the whole JSON import to fail without partial changes. Edit existing groups explicitly to resolve conflicts. Coordinator imports require approval. The `name,level` CSV import remains available and starts a separate group for each new row. To consolidate existing subjects, edit a group and select its existing variants explicitly. No grouping is guessed from similar names.

The default demo seed uses **Standard → Honors → AP**, with ranks 0, 1 and 2 respectively. Standard has no display prefix; only AP accepts an AP score. Reseeding the disposable demo restores this order using the same level IDs. This default does not overwrite an existing school's custom ordering during migration or normal startup.

Staff manage recorded qualifications in **Subject Availability**; application decisions and interviews are in **Tutor Applications**. Approval records the selected variant and every lower offered level in the same group. Application selections alone confer no eligibility. Later level reordering or newly offered variants never expand or revoke those recorded grants; future approvals use the new order. Expanding an approval shows its recorded subjects. Removing an approval removes only its own grants; overlapping approvals remain valid. Tutor assignment and interview checks use these recorded grants.

Unselecting or removing a subject archives it while retaining choices, assignments and qualifications. Levels with existing variants cannot be deleted, and a variant with recorded grants cannot be changed to a different level. Rename its base name or prefix without replacing its identity. Existing subject and qualification migration preserves all IDs, labels and exact approved eligibility. Ordinary management catalogue and qualification writes require Admin/Head authority; Coordinators submit proposals for review, and viewers cannot write. Removing an existing qualification reverses an applied grant and requires Head authority.

Interview completion is a separate reviewed action in **Tutor Applications → Interview
Records**. **Record completion & award hours** collects actual datetime, 1–480 minutes,
explicit attendees and a reason. **Review credits** previews actual minutes ÷ 60 per
attendee and the total before final confirmation. Admin/Head apply initial records;
Coordinator submissions await Admin/Head review. **Correct completion & hours** replaces
source-owned automatic credits, preserves unrelated adjustments and original period
ownership, and allows Admin/Head application and Coordinator proposals.
Both INTERVIEWS and SERVICE_HOURS must be enabled for completion writes.

The read-only review combines decision, completion/approval and registration/setup
status. Only applied initial acceptance authorizes the existing registration workflow;
completion timing does not delay or grant registration. Existing valid invitations are
reused, used/expired codes remain distinguishable, and verified linked accounts retain
setup access. Additional qualifications do not receive codes. Codes and account actions
remain restricted to management. A saved award with a refresh failure offers read-only
recovery. Tutor interview lists distinguish unresolved work from an initially closed
Completed menu and retain drafts across collapse and deterministic reordering.

## Refresh the program

Head runs refresh in **Program Settings → Recruitment and Refresh** after reviewing the current period, exact destination, program timezone and prepared Tutor/Tutee openings, then typing `REFRESH`; Admin may request Head review. Coordinators can inspect it but cannot submit or execute it. Previously staged module settings take effect in this operation; the applied quarter/semester mode determines the next period.

| Change                       | Result                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Advance the period           | Pending and active tutees become inactive and must sign up again; past pairings remain historical                                                           |
| Cross a semester boundary    | Continuing active tutors become pending and must choose whether they are available or opting out                                                            |
| Graduate senior tutors       | Active tutors with confirmed G12 for the graduating reference year graduate on entry to Q4 in quarter mode, or at the school-year boundary in semester mode |
| Cross a school-year boundary | Reported grades remain unchanged; academic profiles need reconfirmation for the new year                                                                    |
| Preserve evidence            | Attendance, service hours, policy acceptances and audit records remain; current-period totals and participation are evaluated separately                    |
| Activate prepared openings   | Applied next-period Tutor and Tutee openings become current settings in the same transaction that activates the destination; pending proposals do not apply |

Reload and review again after the source period, prepared values, destination intake settings or any staged feature revision changes. Changing a feature away and back still requires renewed review. A preparation bound to an older target must be explicitly replaced or cleared for the new target before refresh; it is never silently moved or discarded. Previously queued refresh requests without preparation and complete staged-feature evidence require a fresh request.

A failed refresh rolls back activation, participant changes and opening settings together, retaining the preparations for review and retry. Replaying a completed refresh cannot advance another period. After refresh, check applied switches, tutor availability, intake settings and new assignments before resuming the program.

## School departure and viewer access

Graduated and transferred students keep their personal dashboards and historical records.
Confirmed departure adds **Enter viewer portal** to the tutor or student workspace. The
portal shows the same permitted summaries and masked private fields as a standalone Viewer.
It does not convert the account to the exclusive Viewer membership.

Use **School Departure** in personal account settings to request graduation, transfer or
return. Admin/Head review requests through **Management Actions**; pending requests grant no
access. Staff can also open **Users & Roles → Edit Profile → School Departure**. Admin/Head can
apply the reviewed change directly; Coordinators submit a proposal.
Academic self-reports and imported roster records do not grant observer access.

Confirmation ends tutoring and tutee participation, removes current assignments and requeues
affected learners. Historical attendance, pairings and service hours remain. School transfer
does not change academic graduation or grade reports. Separately assigned crew, translator
and management permissions remain in place for independent review.

Admin/Head can revoke or restore departure-based observer access without erasing departure
history. Account suspension takes precedence. Revoked tutor access also blocks an observer
grant derived from that tutor membership. A reviewed return removes the departure grant,
puts an eligible tutor back into pending activation, and requires fresh tutee enrollment;
it never reconstructs old assignments. Ordinary archived/opted-out accounts acquire no
observer access merely from those statuses.

Program refresh records eligible senior graduation automatically. Existing graduated tutor
accounts require the explicit migration described in the deployment guide.

## Review attendance flags

**Attendance Flags** compares an in-person session's distinct present students with crew observations in the same room and school date, within the session window plus 15 minutes on either side. Online sessions are excluded. Shared subject blocks count distinct students once. A `4+` observation is a lower bound and cannot establish an undercount.

A lower exact headcount creates a pending flag. Management reviews the evidence and chooses **Dismiss**, **Warn**, **Penalize** or **Escalate**; coordinator decisions need approval. A penalty records a service-hour deduction for the session's period, defaulting to 0.5 hours unless another allowed amount is entered. Escalation requests further review and does not itself remove the tutor. Attendance or patrol corrections can reopen review and remove its linked deduction. Use corrections to fix the underlying record, and retain a clear decision note.

Loading or failed reads do not mean there are no flags. Use **Try again** after a
read failure; existing review notes and penalty amounts stay visible, with editing
paused until recovery. Those fields also pause while a decision is being sent.
A failed decision keeps the draft for retry; a queued proposal is labelled as
awaiting approval and has not applied a penalty or another decision.

## Tutor hour adjustments

Open **Hour Adjustments** (`/admin/hour-adjustments`) to add extra hours or a punishment deduction for a tutor and month. Amounts remain positive; the type determines whether they add or deduct hours. The active program period is recorded with each adjustment. The service-hours module must be enabled for writes.

Months remain in `YYYY-MM` format. Desktop tables reserve space for months and wrap long names, reasons and translated labels; a constrained desktop table can scroll within its card. On mobile, each record stacks its labelled fields and delete action so the full reason stays readable. Form controls and row actions support touch and keyboard use.

HEAD and ADMIN can apply additions; Coordinator additions require Admin/Head review. Deleting an existing adjustment reverses recorded hours; Admin/Head apply it and Coordinators submit review proposals. Pending proposals leave live hours unchanged. VIEWER has no mutation controls, cannot write through the API, and receives records with private reasons withheld by the server. Tutor accounts cannot access this management listing.

## Reports and exports

Open **Reports** (`/admin/history`) and choose a school year and quarter, semester or whole-year scope. **Summary** shows totals and tutors; **Detailed** adds sessions, cards, meetings, meeting attendance, adjustments, crew and attendance flags; **Full** also includes applications, signups, removals and tutor participation requests. Sections follow enabled modules.

Admin/Head can download a displayed table as CSV. Use **Print / Save as PDF** and the browser's print dialog for a printable report. Review the private-data masking option before sharing; VIEWER responses are always masked by the server. Report exports reflect the chosen scope and current records. They are not database backups and do not use the import format below.

Signup grades in newly generated reports use the latest reviewed historical academic correction, or the preserved enrollment grade when no correction exists. An originally unknown grade stays unknown; linking an account does not substitute its current grade. Legacy signups without preserved evidence use their recorded enrollment grade. Generating a report does not change original archive evidence or previously downloaded reports.

## Import and export program records

**Admin and Head** can open **Program records** (`/admin/records`), download CSV archives/templates, preview an import or commit it. Coordinators cannot submit imports for approval. Access is checked against the current database role, including after a demotion or suspension.

**Export CSV archive** downloads one ZIP containing a CSV for every supported record type plus `README.txt`. **Download CSV templates** supplies the same headers without data. Use these templates for past records from spreadsheets: rename/map the source columns to the template columns, keep the filenames, and provide stable IDs for each record and its references. An export includes all available program periods, independent of the Reports page filters.

Historical participants can remain accountless. After import, use [historical record views and reviewed account linking](historical-participant-transition.md) to inspect original enrollment information or give an eligible verified account access to its own history. Importing records or linking history does not grant current participation or departure-based observer access.

| Included records                    | CSV families                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| People and reference data           | Tutor, Tutee, User account references, Term, SubjectLevel, CourseGroup, Subject, Room, TimeSlot, SchoolCalendarDay                                                                                                                                                                     |
| Scheduling                          | RoomUnavailability, TutorAvailability, TuteeAvailability, TutorSubjectWillingness, PairingGroup, Pairing, PairingTutee                                                                                                                                                                               |
| Attendance and hours                | Session, SessionTutee, TutorMeeting, MeetingAttendance, ServiceHourAdjustment, Patrol, PatrolObservation, PatrolCreditWindow, SessionFlag                                                                                                                                              |
| Applications and membership history | TutorApplication, ApplicationSubjectIntent, InterviewAssignment, InterviewVote, TutorStatusRequest, TuteeRemovalRequest, CrewApplication, CrewStatusRequest                                                                                                                            |
| Student and academic history        | StudentSurvey, StudentSignupRevision, StudentSignupAppeal, StudentRequestReview, TuteeRequestInvalidity, StudentQuarterBlock, StudentProfileOwnership, HistoricalAcademicRecord, PolicyAcceptance, DisciplinaryCard, StudentFeedback, StudentAppeal, TutorQualification, QualificationGrant, AcademicProfile, AcademicConfirmation |
| Announcements                       | Announcement, AnnouncementAck                                                                                                                                                                                                                                                          |

This is a program-record archive, not a full deployment backup. It excludes retained tutor ownership links and historical academic correction revisions; account passwords, roles and access settings; verification/registration/reset tokens; private messages; executable approval and audit payloads; live program configuration; website content; and uploaded files. `User.csv` contains reference IDs, names and emails only. Its accounts must already exist with matching values; importing never creates logins or changes account privileges. New tutor handles cannot collide with account handles, and account-owned email addresses must be reconciled through account management first. Existing users retain their own account-to-tutor links; the archive does not create those links by matching names or email addresses. Student ownership rows use explicit IDs and cannot claim a profile linked to another account. Imported survey verification hashes are newly randomized, so an old verification link cannot become usable again.

Signup exports retain the original submission, current answer projection,
immutable accepted answer/consent revisions and signup appeal decision evidence.
Staged intent challenges, notice delivery capabilities and private client/decision
retry capabilities are excluded. Restoring revisions creates fresh operational
receipt keys; importing history cannot authorize a live replacement or revive an
old mailbox proof.

### Prepare CSV files

- Use UTF-8, unchanged case-sensitive filenames such as `Tutor.csv`, and exact column names from the templates. Quoted commas, quotes and multiline text are supported.
- Provide each primary key, including all columns of a composite key. Keep IDs unchanged on retries. Omit columns with defaults to use those defaults; otherwise supply every required column. Do not leave a required timestamp or number empty.
- Use `true`/`false`, numeric quantities, enum values from the application's schema, and ISO timestamps with `Z` or a timezone offset. Use JSON inside a quoted cell for arrays and objects.
- `\N` means a database null. An empty cell means empty text. Double a literal leading backslash or apostrophe. Exports prefix formula-like text with an apostrophe for spreadsheet safety; the importer reverses that prefix.
- New terms must have `active=false`. New pairing groups, pairings and sessions must belong to inactive terms. Importing history never changes the active program period. Stored historical service hours are retained, rather than recalculated with a later policy.
- Select related CSV files together; the importer orders them by dependency. References must point to another selected record or an existing database record. A transfer supports up to **5 MiB of expanded CSV data and 5,000 records**. For larger complete exports, use an operator-managed database backup.

For example, import these three files together to add an archived tutor and pairing. IDs are synthetic; replace them with your own stable identifiers. The tutor record does not create a login.

`Tutor.csv`:

```csv
id,englishName,status
legacy-tutor-001,Example Tutor,GRADUATED
```

`Term.csv`:

```csv
id,schoolYear,quarter,name,active
legacy-term-001,24-25,Q1,24-25 Q1,false
```

`Pairing.csv`:

```csv
id,tutorId,termId,subject,dayOfWeek,startMin,endMin
legacy-pairing-001,legacy-tutor-001,legacy-term-001,Mathematics,2,600,630
```

### Preview and import

1. Select the CSV files together or select an exported ZIP, then choose **Preview import**.
2. Review the counts of new and already-present records. Preview saves no records. An invalid row reports its filename and CSV row number; correct it and select the files again.
3. Check the confirmation box and choose **Import records**. Confirmation authorizes exactly the previewed files for 15 minutes. Changing files clears the preview.
4. Check the success message and Audit Log. All new records and import evidence commit together. A failed import leaves no partial records. A network retry with the same IDs and values skips existing records; a conflicting ID or unique value rejects the whole batch. If records changed after preview, correct the conflict and preview again.

## Program Time Zone

Head or Admin selects a supported IANA region in **Program Settings → Recruitment and Refresh → Program Time Zone**; Admin/Head apply it and Coordinators request review. The default is Asia/Shanghai. Review the current/proposed time preview before submitting. Reload a stale editor or other open pages after another staff member changes the setting.

Options show the readable region, a localized zone name, an abbreviation where available, and a GMT offset. Use **Preview date** to compare seasonal offsets at 12:00 UTC on that date; this preview does not save a setting. New York shows EST (GMT-05:00) in winter and EDT (GMT-04:00) in summer. UTC and fractional offsets such as India's GMT+05:30 are supported. The selected label also appears below the dropdown so its full text remains readable on narrow screens.

Signup opening notices, opening-time inputs and patrol correction inputs resolve their labels at the event's date. Audit date-range labels show each endpoint's offset when they differ. An empty, skipped or repeated local time shows only the region until it resolves to one instant. The server permits Head to apply timezone changes and Admin to request review; Coordinators can inspect date previews.

- Weekly slots keep their wall-clock values: 15:30 stays 15:30.
- Saved appointments and deadlines keep their instants and display in the selected zone.
- Calendar-only attendance dates keep their recorded day.
- New date validation, appeal school-day calculations, crew observations and datetime inputs use the selected zone.
- Existing cards' appeal deadlines are derived again using the selected zone, so their appeal windows can change. Reconciliation of historical crew observations also uses the current zone when rerun.
- Existing service-hour totals are not recalculated.

Inputs in skipped or repeated daylight-saving hours are rejected; choose an unambiguous time. Each change records the previous and new zones in the audit log. No host operating-system or environment change is needed.

Database connections always use UTC independently of this school setting. Saving a program timezone does not rewrite stored timestamps or start a bulk recalculation; it writes the setting and audit entry and refreshes the current page.

## Publish an announcement

In **Announcements → Recipients**, choose all current tutors, filtered tutors or specific tutors. Filters combine grade, tutor status, subject qualifications/current-term assignments and active-tutee counts. Choices within a group match any selected value; different groups must all match. An empty group imposes no restriction.

**Include** adds a tutor regardless of filters; **Exclude** wins over both filters and inclusion. Search narrows only the override picker. Check the complete audience count and name preview before publishing; an empty audience is blocked. Assignment filters need an active term and count unique active tutees in that term.

The published audience is fixed. For coordinator proposals, approval freezes the recipients and rejects changed audience evidence. Editing, pinning, reactivating or restoring a post does not select a new audience; publish a new announcement to change recipients. Tutors can read and dismiss only active posts addressed to their linked identity, plus applicable broadcasts. In-app notifications can also produce announcement event emails when program and personal information-notification preferences are enabled; these notices explain how to open the announcement and do not contain its title or body.

## Message permissions and supervision

In **Program Settings → Account Settings → Contact permissions**, Admin/Head apply configuration changes; Coordinators cannot propose private-messaging controls. Management roles default to all available accounts; other roles default to management. Select a union of groups:

| Group                  | Who it includes                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Management             | HEAD, ADMIN and COORDINATOR                                                                                      |
| Current tutors         | Tutors assigned to an explicitly owned student profile in an active-term pairing                                 |
| Past tutors            | Recorded assigned tutors for owned profiles, excluding current tutors                                            |
| Same scheduled group   | Accounts owning tutees in the exact same active-term pairing; a shared period or time slot alone is insufficient |
| All available accounts | Available accounts other than self; this broadens access beyond relationship groups                              |

A user override **replaces** the role groups. An empty override prevents new sends; removing it restores role inheritance. Suspended, restricted, deleted and self accounts cannot be new recipients. Messaging restrictions apply independently of group selection. Record a reason for changes; the effective source and groups are visible in settings and changes enter the audit log.

Messages deliver immediately, with no pre-delivery approval queue. HEAD/ADMIN can search disclosed messages by participant or text and filter visible/hidden content. **View conversation** shows a participant pair; **All conversations** clears that filter. Opening content requires a reason and records review evidence without marking it read for the recipient.

Hiding removes content from participants' responses while retaining it for authorized review; restoring makes it visible again. Both actions require a reason and keep actor/time evidence. Admin/Head can hide messages or impose messaging restrictions directly; Admin/Head also restore messages or remove restrictions directly. There is no message-deletion control. Participant-only messages remain outside supervision, and coordinators cannot inspect other people's conversations. Publish wording that matches this disclosure using the [policy publication procedure](policies/README.md#publish-a-revision).

## Publish pages and translations

Use **Landing Page** for public content, menus, media and custom pages. Custom pages and page-mode sections share the same URL namespace. The editor adds a numeric suffix when a slug is occupied; unpublished content still reserves its URL. Check the resulting public link after saving.

Assigned translators submit text drafts for review. If the destination text or language changes before approval, reject the stale draft, reload the current destination and submit again. A coordinator publication decision requires ADMIN/HEAD approval. English and Chinese are visible by default; review wording in hidden catalogs before enabling additional languages. Policy publication uses its own [reviewed revision workflow](policies/README.md).

Translations cover interface strings and supported public text such as news, sections and page titles. Translators can add a language with English fallback; management controls visibility, ordering and deletion of added languages. Built-in language catalogs cannot be deleted. Enabling a UI language does not create a policy translation: publish reviewed policy text separately, or the policy falls back to English.

## Tutor and tutee recruitment windows

### Download public QR images

Open **Program Settings → Recruitment and Refresh → Share Signup Links** to
download separate labeled PNGs for **Tutor signup**, **Tutee signup**, **Crew
signup** and the **Website home**. Each image contains one QR code, its destination
name and the full published URL on a transparent background. The paths are
`/tutor`, `/tutee`, `/crew` and `/`.
Chinese interface users receive Chinese image labels; other interface languages
receive English image labels. Filenames identify the destination and image language.

Downloads are available to readers of the recruitment panel, including read-only
staff, and remain available when recruitment is closed or Crew is disabled.
Downloading does not save settings or discard unfinished recruitment edits.
Scanning still applies the destination's current recruitment, feature, verification
and access rules; a QR image grants no account or participation access.

The deployment's configured public address determines the encoded domain, even
when management is opened through an internal address. See the
[deployment guidance](deployment.md#public-qr-domain-and-regeneration) if a download
reports a configuration error or the public domain changes. Regenerate distributed
images after a domain change. Place the black QR and text over a plain, light
background, keeping the clear border around the QR free of other artwork.
Verify the finished print or shared image with a scanner.

### School calendar and timetable dates

Open **Program Settings → Recruitment and Refresh → School Calendar**. Admin/Head apply
changes and resets directly; Coordinators submit them for Admin/Head review.
Pending proposals do not change schedules or send
operational calendar notices.

Use **Add date override** for a holiday, make-up school day or different timetable. Select
the actual date, whether school is open, an optional timetable weekday, and a note.
Without an override, Monday–Friday are school days and weekends are closed. An open
date with no selected timetable weekday follows its own civil weekday. For example,
an open Sunday can follow Monday's timetable; its displayed and recorded date remains
Sunday. A closed date cannot also select a timetable weekday. Ordinary recurring
plans are suppressed on a closed date. The coordinated dated-session workflows
remain responsible for agreed extras/reschedules and their closure warnings; this
setting does not rewrite attendance or historical service hours.

Edit a saved date deliberately, or use **Reset to normal** to restore ordinary
weekday/weekend behavior. Reset retains internal version evidence so an older open
editor cannot recreate a removed override. Background reads preserve unfinished
drafts. If another editor changes the date, explicitly reload and review it before
saving. After an accepted write, a failed refresh offers a read-only retry rather
than repeating the change. A note-only edit does not send another operational
notice. School-day appeal deadlines use open/closed status; changing the timetable
weekday alone has no effect on those deadlines.

Eligible tutors and tutees with potentially affected confirmed active-period
pairings receive in-app change/reset notices. The audience includes the actual
date's civil weekday, the prior timetable weekday and the new timetable weekday,
plus eligible prior recipients for corrections. Advance reminders run from 18:00
on the prior date until noon on the actual date, using the program timezone. A
same-revision change notice issued inside that window serves as that recipient's
reminder; a later same-day change still notifies immediately. Changes to historical
dates do not generate a new operational notice. The separate dated-session rollout
owns adding participants from explicit extras and reschedules.

Email copies use the optional **Information / Program** category and require both
the program switch and the recipient's preference. Copy includes the actual date
and school-day/timetable facts, never the staff note. Delivery rechecks the current
calendar revision and participant eligibility; SMTP already accepted cannot be
recalled. No external calendar provider is modified. The separate **No-tutoring
dates** control remains informational: its inclusive ranges do not cancel sessions,
change recurrence, restrict attendance or alter school-day appeal counting.

### Configure recruitment windows

In **Program Settings**, Admin/Head apply **Tutor recruitment** and **Tutee recruitment** settings separately for the active period; Coordinators submit each change for Admin/Head review. Each current-period panel has an **Accept applications** switch, independently optional starting and ending times, and an optional external preview link. Save each panel separately. Times use the configured program timezone; the start is inclusive and the end is exclusive. An enabled form with neither bound accepts applications immediately, provided its prerequisites are configured. Turning off the switch pauses applications regardless of dates.

### Prepare next-period openings

The next-period editors name the source and destination school year and quarter or semester, alongside the program timezone. Admin/Head can save, edit or clear the Tutor and Tutee opening times independently; Coordinators submit each for Admin/Head review. A queued proposal is not a saved preparation. Coordinators and Viewers cannot change preparations. Saving does not refresh the program, accept next-period applications, archive participants or alter current intake.

An unset preparation preserves the destination's existing opening time; for a new period, the default is no opening restriction. An explicitly saved clear removes only that audience's opening restriction. Both cases preserve the destination's acceptance switch, closing time and preview link. New periods retain enabled switches and unbounded closing times. A prepared opening at or after an existing destination closing time is rejected. An elapsed opening is valid and allows intake immediately after activation only when the switch, closing bound and normal signup prerequisites permit it.

The review and save stay bound to their original target and version. Background reads do not replace an unfinished draft. After a conflict, use explicit **Reload**, inspect the new target and save a replacement or clear deliberately. Timezone changes preserve saved UTC instants; reload before editing so a local clock value cannot be reinterpreted silently. Skipped and repeated daylight-saving times remain invalid input. If a write succeeds but its follow-up read fails, **Retry latest read** only reloads data and does not repeat the accepted write. If a later change supersedes that save, its original destination remains shown until explicit **Reload** adopts the newer state.

For an Admin proposal, **Check approval status** preserves the draft and request link while the decision is pending. The editor unlocks only after reading the terminal decision and current settings; checking status never submits another proposal.

At official refresh, both applied preparations are checked again and installed atomically with the destination period. They then appear in the normal current-period editors. The original source preparations and audit evidence remain retained. See [refresh the program](#refresh-the-program) for cases requiring renewed review.

### Current-period access and submissions

Coordinator and Viewer recruitment controls are read-only. Missing editing eligibility never grants a write affordance. Informational no-tutoring summaries show an inclusive date range and a brief reason preview; authorized readers open **View details** for the complete reason. A single-day notice has equal starting and ending dates. There is one notice per starting date; overlapping notices with different starts remain independent. Editing changes the ending date and reason; moving the start requires removal and recreation. Editing and removing notices keep their own permissions and reviewed versions.

Observers can read the public current-period and recruitment values. Private settings tabs explain that access is unavailable without starting protected settings reads. While account identity is unknown they show loading; identity read failures offer recovery rather than assuming authorization or displaying an empty panel.

Participants can always read `/tutor-signup` and `/tutee-signup`; old `/signup` links redirect to the tutee form. Before the start, after the end, while paused, or while setup is incomplete, the questions remain visible with disabled response fields. Published policies remain readable. Preview mode never exposes participant responses. An external sheet is optional; its owner must grant viewer-only permissions because the website cannot control a third-party sheet's editing rights.

Publish the English source of both policies through **Policy Documents**, configure active **Subjects & Levels**, and add **Time Slots** when tutee availability is required. Missing or empty policy publication is shown as incomplete setup, rather than a retryable loading error. Real database/network failures still show Retry. Tutee submission also requires working transactional email.

The server rechecks the current recruitment window on every submission. Open browser tabs update timed boundaries and poll schedule changes every 30 seconds. A form submitted after closing is rejected even before its next poll. Schedule saves reject an ending time at or before the start and reject a stale active-period ID. Existing opening times and external preview links survive the recruitment migration.

Public closing stops new submissions. It does not end signed-in editing of an
owned current **OPEN** request or create an extra verification deadline. Owners
can correct request names, grade, phone, preferred contact, availability and
unassigned subject choices until active-period rollover or a terminal transition.
Historical requests are read only. Admin/Head review assigned-choice edits and any
affected assignment release; stored sessions and attendance remain intact. Current
field and catalogue rules are checked again when a change is accepted.

| Tutee request event | Identity and consent | Priority, deadline and records |
| --- | --- | --- |
| Fresh eligible public request | No duplicate account is created by email matching; account setup follows exact mailbox proof and invitation review | Reserve priority at the first accepted submission |
| Deliberate same-email submission | Independent challenge and signed consent; existing account sign-in/MFA is required for its reviewed replacement | Keep the current OPEN request's original timestamp, fixed deadline, assignments and original signed source |
| Exact retry of accepted submission | Recover only its bound receipt; changing answers requires a new deliberate submission | No duplicate revision, CAPTCHA check, email or notification |
| Signed-in owner edit | Explicit ownership and version required; shared login identity and original signature are separate | Keep priority and assigned choices; allow request-local edits after public closing |
| Policy published after staging | Keep the signed stage-time revision; do not automatically accept the later policy | Existing current-policy participation gates require separate acceptance |
| First assignment before verification | Existing source or fresh bounded exact-intent proof can complete verification | Fixed seven-day deadline; resends, replacement, reassignment and appeals never extend it |
| Invalid request under appeal | Owner supplies a reason before active-period rollover; Admin/Head decide | Stay invalid and processing-blocked during review; acceptance keeps priority |
| Final invalidity rejection | Keep original and decision evidence | Close active request and end its priority; later eligible resubmission starts fresh |

Flagging invalid requires a reason. Admin/Head apply the flag, and Coordinator
proposals use the existing approval flow. The owner receives a notice and email
notification with an appeal route; internal review details remain staff-only.
Acceptance clears the flag, while final rejection retains a closed auditable
request. Drafts survive failed saves. If a write succeeds but refreshing fails,
its recovery action reloads reads without applying the change again.

## CAPTCHA verification

Management → Program Settings → Deployment Configurations includes an immediate CAPTCHA Verification switch
for public tutee/viewer signup or resend and Crew application/status email. Admin/Head apply changes; Coordinators request
review, and Coordinators can inspect status. A pending request leaves the effective setting unchanged. Enabling requires local provider configuration and uses paid
Aliyun checks. Disabling leaves signup quotas active and never needs a provider
call. See [setup, costs and outage procedure](../reference/captcha.md).
