# Program functions and controls

[Documentation home](README.md) · [Role guide](user-guide.md) · [Deployment](deployment.md)

This is the supported single-program website. Account role, tutor participation, crew membership and translation assignment are separate capabilities. Page visibility follows both permission and the effective program configuration; the server checks access independently.

## Management responsibilities and review

Authority follows the effect of a change. Head can apply sensitive changes directly;
Admin can apply ordinary daily operations directly. A requester without direct authority
submits to **all eligible reviewers** through Management Actions. Pending requests do not
change live records. Coordinator cannot submit significant settings or management profile/rank
edits, including through a direct API call. Participant self-service contact/profile edits
retain their existing ownership rules; subject qualification levels are distinct from role levels.

| Category and entry points | Direct authority | Allowed requests | Reviewers |
| --- | --- | --- | --- |
| Recruitment switch/start/end/preview; CAPTCHA; name/grade configuration; signup fields; optional email/binding switches; timezone; staged modules; period refresh | Head | Admin | Head |
| Global calendar, feedback sharing, policy publication/removal, language visibility/order/removal and message-permission configuration | Head | Admin | Head |
| Staff account name/username/academic edits, roster profile edits, role/badge and tutoring/crew access changes; historical academic corrections | Head | Admin | Head |
| Tutor/Crew registration invitations | Admin or Head | Eligible Coordinator requesters | Head |
| Existing participation decisions that grant access | Head | Eligible Admin/Coordinator requesters | Head |
| Admin/Coordinator registration invitations | Head | Admin | Head |
| Audit undo, reinstatement, deletion of hour adjustments, invitation revocation, attendance/patrol correction and changes to an applied card decision | Head | Eligible Admin/Coordinator requesters; messaging remains Admin-only | Head |
| Time-slot clock changes that propagate into recorded attendance, credits or reviewed flags | Head | Admin/Coordinator | Head |
| Message restoration, removal of messaging restrictions, and an appeal that overturns an applied decision | Head | Eligible requesters in the underlying workflow | Head |
| Assignments, rooms/blocks/slots, catalogues, meetings/attendance, ordinary hours, announcements, initial discipline decisions and other reviewed daily work | Admin or Head | Coordinator | All eligible Admin/Head |

The executable inventory is [approval-policy.ts](../src/lib/approval-policy.ts).
Restoring archived subjects, subject levels or time slots requires Head application, including batch subject edits and offerings implicitly restored when saving a course group; ordinary catalogue edits retain daily-operation authority.

Its input-dependent classification covers restorations even when the button does not say
Undo. Corrections that can remove penalties or restore participation use Head review for
the entire correction; dependent effects cannot apply early. Initial pending decisions are
daily work, while changing an already applied decision is a reversal.

Withdrawing an unapplied request, cancelling an unused confirmation ticket, editing an
unsaved draft and read-only previews are not reversals of live program decisions. Existing
setup/verification resends remain direct operational conveniences: they do not grant rank,
assign participants or extend an intake deadline. Leadership transfer, account combination,
account deletion and program-record import/export keep their dedicated Head safeguards.
Unknown Coordinator writes are refused rather than silently acquiring direct authority.

Head retains the ability to review their own eligible request. Other reviewers cannot decide
their own pending proposal. Current roles and suspension status are rechecked before application;
changed target evidence requires a fresh request. A legacy role-change proposal requires the
reviewing Head's fresh password, which is never saved in the proposal or audit log.

Audit Log records direct changes, requests, decisions, reversals and automatic program changes,
with actor/role, operation, outcome and available safe before/after evidence. Undo links to its
original event. Missing legacy evidence is not reconstructed from today's records. Secrets and
private-message bodies are excluded; failed attempts are distinct from applied changes.

## Functions by purpose

| Purpose | User entry | Management entry / outcome |
| --- | --- | --- |
| Request tutoring | Home → Request a Tutor; full application at `/tutee-signup` → mailbox code or legacy email-link confirmation → invitation popup → `/register-account` review | Signup Requests (`/admin/requests`): verify demand, match at original survey priority, review current and processed requests |
| Become a tutor | Home → Become a Tutor; `/tutor-signup` | Tutor Applications: select qualified panel and chair, interview, vote and decide; record actual completion in `/admin/applications#interview-records` |
| Create an accepted tutor account or add invited access | Single code card at `/register-account` (published `/register` links redirect there), then required mailbox verification and shared account/access review | Registration Codes and Users & Roles; an application, roster row or displayed invitation alone is not a login or access grant |
| Participate as a tutee | `/student`, with Dashboard, Schedule, Requests, Attendance, Support, Messages and Account tabs | Tutee Roster, Pairings, withdrawals and discipline; explicit account ownership controls records |
| Teach and record attendance | Tutor Dashboard (`/dashboard`), Settings (`/settings`), Handbook (`/handbook`) | Attendance Submissions, Attendance Flags, Service Hours and Hour Adjustments |
| Schedule teaching | Tutors maintain availability and pairing defaults | Subjects & Levels, Time Slots, Rooms and Pairings; room blocks warn against conflicts |
| Manage interviews | Assigned panelists vote in Tutor Dashboard; the chair schedules and records the decision | Tutor Applications assigns panels and retains interview history/completion; Subject Availability independently shows approvals, recorded inheritance and willingness |
| Review subject availability | Staff → Tutors → Subject Availability; `/admin/subject-availability` | HEAD, ADMIN and COORDINATOR can inspect qualifications and willingness separately, including inherited grants. Coordinator changes require approval. Availability requires an active subject and level (or no level), an active tutor with tutoring access, a recorded approved grant and explicit willingness; timetable/capacity checks remain separate. |
| Communicate | Workspace Messages and notifications | Announcements support immutable recipient snapshots, filters and individual overrides; private deliveries remain isolated per recipient; disclosed new messages allow audited HEAD/ADMIN supervision ([contact controls](#message-permissions-and-supervision)) |
| Get support | Tutee Support tab, session feedback, card appeals and private messages | Tutee Support (`/admin/student-support`) handles shared feedback, appeals and school calendar; Users & Roles → User details holds account-scoped policy acceptance history |
| Review management changes | Eligible staff prepare changes according to the responsibility matrix | Management Actions: Head reviews sensitive changes and reversals; Admin/Head review daily operations; pending is not applied |
| Observe the program | `/viewer-signup` → verify email → invitation popup with copy, optional email and prefilled `/register` link → account review | New VIEWER sees permitted summaries with private contact data masked; an existing account's LOGIN invitation preserves access and credentials |
| Patrol rooms | Apply at `/crew-signup`; active crew member → `/patrol` | Crew maintains applications, membership, room order, patrols and corrections; observations support attendance review |
| Maintain accounts | Shared Account settings; Add access in settings/account menu; verified email changes and password recovery | Users & Roles manages identities, invitation/setup, capability assignment, suspension and leadership boundaries |
| Publish program information | Home, program information menu and custom pages | Landing Page edits content, media, menus and custom pages; Policy Documents publishes versioned runtime policies |
| Translate | Assigned translator → Translations (`/localization`) | Draft/review/publish translations and control language visibility; hidden languages need wording review before launch |
| Report and audit | Reports (`/admin/history`) and permitted read-only views | Period summaries, detailed records, CSV exports and browser printing; Audit Log identifies actual actor accounts and reviewed changes |

The invitation, Viewer signup and tutee application routes remain separate. Verified public
applications hand off to `/register` using a short-lived HttpOnly cookie; their links contain no
mailbox proof or password. New accounts review prefilled details and create missing credentials.
Existing accounts explicitly accept authorized Tutor, Crew or tutee access without losing other
access. An authorized participation or management invitation replaces the exclusive Viewer role;
a public Viewer-source LOGIN invitation adds no access. Management invitations retain the higher
of the existing and authorized ranks, never demote and never grant Head. MFA and suspension
remain enforced. Participation grants retain school departure checks, intake priority, policy
evidence and historical ownership; departure alone does not block a management rank grant.

New invitation and staff registration codes retain the five-character uppercase
Steam-style format, containing both letters and digits, including `0` and `I`. Input accepts
`O`/`o` as `0` and, in five-character codes, `1` as `I`. Codes are opaque; their characters
do not encode access or invitation type. Outstanding older invitations remain usable.
Mailbox verification codes remain separate and keep their existing formats.

## Optional modules

HEAD stages these switches in **Program & Refresh**. They take effect at the **next program refresh**, not when the switch is clicked. Existing records remain history. Do not refresh just to preview a switch: refresh changes participation and the current period.

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

Switches control available pages and operations; they do not erase historical data. Turning off service-hour views does not stop attendance from recording calculated hours. See [feature implementation](../src/server/program/features.ts) and [refresh behavior](#refresh-the-program).

When Email 2FA is on, password changes also require an emailed verification code, even if the user has not opted into sign-in 2FA. Configure working email delivery before relying on this flow in production.

## Other configurable behavior

| Control | Scope / timing |
| --- | --- |
| Program timezone | Head applies a supported IANA region; Admin requests Head review. Existing instants remain fixed; weekly slots remain school wall-clock times |
| Tutor and tutee recruitment | Head applies each active-period window; Admin requests Head review for acceptance, optional start/end times and preview link. Clearing a start time still respects the switch, end time and setup requirements; see [recruitment windows](#tutor-and-tutee-recruitment-windows) |
| Names and grades | Head applies offered grades and independently controls **Use preferred names** and **Show names in another language**; Admin requests Head review; see [name fields and display settings](user-guide.md#names-and-academic-details) |
| Subjects, levels, slots and rooms | Management catalogues used by application, availability and pairing workflows |
| Policy versions | Published database revisions require new acceptance for participation; changing a bundled policy draft does not publish it |
| School calendar | Staff define holidays and make-up days used for school-day appeal deadlines |
| Feedback visibility | Management-only by default; configured sharing also affects earlier feedback |
| Announcements | Filters combine across groups; alternatives within a group match any choice; explicit exclusions win. Published recipients are fixed |
| Language visibility | English and Chinese are the launch-visible catalogues; six hidden catalogues contain English fallbacks |
| Personal theme and guidance | Six accent themes; dismissible management guidance can be reopened and remains scoped to the signed-in account |

## Optional email notifications

Head can enable **Email Notifications** in **Program & Refresh**; Admin submits the change for Head review. The setting takes effect when applied, defaults off and is separate from staged modules and email 2FA. Production requires configured email delivery. Individuals then choose private-message and information/program categories, and whether verified secondary addresses receive copies; see [personal preferences](user-guide.md#optional-email-notifications).

Disabling the setting cancels pending optional notices and preserves personal preferences. Users cannot enable notifications themselves while this program switch is off. Security alerts remain mandatory.

The independent **Secondary-Email Binding** switch takes effect when Head applies it; Admin can request Head review, and Coordinators cannot submit either email switch. Binding availability defaults on to preserve the existing workflow. Turning it off blocks add/resend/confirm operations, including a code issued before the switch changed. It preserves existing account addresses, sign-in/recovery, primary-email changes and removal/cancellation. A secondary email is never required for signup, setup or use. This switch does not require notification emails to be enabled.

The settings panel checks both security and program SMTP connection/authentication, warns about unavailable or missing transport, and reports retrying and terminal notification failures separately. **Refresh status** reads diagnostics without sending mail or changing the program; checks may be cached for one minute. Passing the check does not guarantee inbox delivery. Operators should inspect the safe failure summaries in `EmailDelivery` and follow the [delivery operations guide](deployment.md#optional-notification-delivery). Essential authentication mail remains independent.

ADMIN/HEAD can use **Resend stuck emails** to queue up to 100 eligible failed or retrying notifications after transport recovery. It excludes active leases, completed/skipped mail, unconfigured production categories and disabled optional notifications. The normal worker applies current preferences and recipient ownership before delivery. This immediate, audited action cannot be proposed by coordinators; a successful result confirms queuing rather than inbox delivery.

## Schedule rooms and periods

Use **Time Slots**, **Rooms** and **Pairings** to plan recurring sessions. A room cannot host overlapping pairings in one program period or a pairing during a recurring blackout; back-to-back sessions are allowed. Availability helps participants agree on a slot and does not prevent staff from assigning a tutor before that agreement. New assignments display **Awaiting schedule** until a tutor or manager selects a catalog slot. These assignments do not reserve rooms or count as scheduled subjects; the assigned tutor remains visible to the tutee.

In **Rooms**, each room shows its blocked-period count. Open **Manage blocked periods** to add a weekly block or edit its day, start/end times and optional reason. Use the program time zone and 24-hour times; an end of `24:00` means midnight. Split overnight blocks across two days. **Remove Period** opens a confirmation before releasing the time. No blocked periods means no recurring restrictions, not that the room has no bookings.

Admin and Head changes take effect after a successful save. Coordinators use **Request new block**, **Request edit** or **Request removal**; availability stays unchanged until Admin/Head approves in **Management Actions**. **View request** opens the submitted proposal with its recorded room name, weekday, clock times and reason; edits compare the original and proposed periods. Older requests explicitly identify missing recorded details. Rejection leaves the schedule unchanged. Viewers can inspect periods but cannot submit changes. Conflicting blocks, reversed/empty intervals and overlaps with active-period bookings are rejected, including during approval if the schedule changed after submission. Adjacent periods are allowed. A failed edit retains the form values for correction.

Changing a catalog slot affects linked schedules. Read the Time Slots guidance before saving; **How schedule changes work** reopens dismissed guidance. The tutor's default-slot control confirms a pairing's schedule and links it to the catalog. Clearing that link retains an agreed copied day and time; it does not erase the schedule. Clearing an assignment that is still awaiting scheduling does not assign a day or time. Record completed attendance truthfully even when it differs from the plan, then review any conflict warning.

Changing a catalog slot's clock times also updates previously recorded sessions linked to it. These changes require Head authority because they alter applied attendance; Admin and Coordinator submit them for Head review. A combined block moves as a whole, even if one of its subjects has a different saved slot link. The change is rejected if it would overlap another saved block for the same tutor and date. Hours are recalculated once per block; affected attendance-flag decisions and their linked deductions are reconsidered, with prior evidence kept in the audit log and HEAD notified. Changing only the weekday does not change actual historical session dates or times. A concurrent attendance submission or correction may require a reload before retrying; a rejected slot edit leaves the slot, schedules, attendance and deductions unchanged.

The applied **Quarter System** setting controls labels: Q1/Q2 display in semester one and Q3/Q4 in semester two when quarters are disabled. Requests display their original intake, not whichever intake is currently active. Staged module changes take effect only at refresh; labels do not rewrite stored deadlines or attendance.

**Subjects & Levels** configures each subject group once. Select its offered levels and enter a separate base name for each: Standard “Intro to Computer Science” displays without a prefix, while AP “Computer Science A” displays as “AP Computer Science A”. Level prefixes are editable; leave the Standard prefix empty. Reorder groups to control the management group display and reorder levels along the **Beginner → Advanced** scale. Course pickers (including both tutee choices and tutor applications) follow that level scale first, then alphabetize by the underlying course name within each level. Courses with no level appear alongside the unprefixed/regular tier without changing their saved level. Group order does not affect picker order. Each group displays beginner levels first. Use **Import Subjects** with a JSON file to create complete groups with multiple offerings. [Download an example](../public/examples/course-groups.json). Each group has a `name` and an `offerings` array; each offering has a `baseName` without a prefix and a `level` matching an existing active level name (case-insensitive), or `null` for no level. The format is `{ "groups": [{ "name": "Computer Science", "offerings": [{ "baseName": "Intro to Computer Science", "level": "Standard" }, { "baseName": "Computer Science A", "level": "AP" }] }] }`. Create the levels first. Import at most 500 offerings in a file of at most 1 MB. New groups are appended in file order; offerings follow the configured level order. Exact repeats are skipped. Existing groups with different offerings, archived variants, duplicate names/levels and unknown levels cause the whole JSON import to fail without partial changes. Edit existing groups explicitly to resolve conflicts. Coordinator imports require approval. The `name,level` CSV import remains available and starts a separate group for each new row. To consolidate existing subjects, edit a group and select its existing variants explicitly. No grouping is guessed from similar names.

The default demo seed uses **Standard → Honors → AP**, with ranks 0, 1 and 2 respectively. Standard has no display prefix; only AP accepts an AP score. Reseeding the disposable demo restores this order using the same level IDs. This default does not overwrite an existing school's custom ordering during migration or normal startup.

Staff manage recorded qualifications in **Subject Availability**; application decisions and interviews are in **Tutor Applications**. Approval records the selected variant and every lower offered level in the same group. Application selections alone confer no eligibility. Later level reordering or newly offered variants never expand or revoke those recorded grants; future approvals use the new order. Expanding an approval shows its recorded subjects. Removing an approval removes only its own grants; overlapping approvals remain valid. Tutor assignment and interview checks use these recorded grants.

Unselecting or removing a subject archives it while retaining choices, assignments and qualifications. Levels with existing variants cannot be deleted, and a variant with recorded grants cannot be changed to a different level. Rename its base name or prefix without replacing its identity. Existing subject and qualification migration preserves all IDs, labels and exact approved eligibility. Ordinary management catalogue and qualification writes require Admin/Head authority; Coordinators submit proposals for review, and viewers cannot write. Removing an existing qualification reverses an applied grant and requires Head authority.

## Refresh the program

Head runs refresh in **Program & Refresh** after checking the displayed current period and typing `REFRESH`; Admin may request Head review. Coordinators can inspect it but cannot submit or execute it. Head-approved pending module settings take effect in this operation; the applied quarter/semester mode determines the next period.

| Change | Result |
| --- | --- |
| Advance the period | Pending and active tutees become inactive and must sign up again; past pairings remain historical |
| Cross a semester boundary | Continuing active tutors become pending and must choose whether they are available or opting out |
| Graduate senior tutors | Active tutors with confirmed G12 for the graduating reference year graduate on entry to Q4 in quarter mode, or at the school-year boundary in semester mode |
| Cross a school-year boundary | Reported grades remain unchanged; academic profiles need reconfirmation for the new year |
| Preserve evidence | Attendance, service hours, policy acceptances and audit records remain; current-period totals and participation are evaluated separately |

Reload if another administrator has already changed the period. After refresh, check applied switches, tutor availability, intake settings and new assignments before resuming the program.

## School departure and viewer access

Graduated and transferred students keep their personal dashboards and historical records.
Confirmed departure adds **Enter viewer portal** to the tutor or student workspace. The
portal shows the same permitted summaries and masked private fields as a standalone Viewer.
It does not convert the account to the exclusive Viewer membership.

Use **School Departure** in personal account settings to request graduation, transfer or
return. Head reviews requests through **Management Actions**; pending requests grant no
access. Staff can also open **Users & Roles → Edit Profile → School Departure**. Head can
apply the reviewed change directly; other management accounts submit a proposal.
Academic self-reports and imported roster records do not grant observer access.

Confirmation ends tutoring and tutee participation, removes current assignments and requeues
affected learners. Historical attendance, pairings and service hours remain. School transfer
does not change academic graduation or grade reports. Separately assigned crew, translator
and management permissions remain in place for independent review.

Head can revoke or restore departure-based observer access without erasing departure
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

HEAD and ADMIN can apply additions; Coordinator additions require Admin/Head review. Deleting an existing adjustment reverses recorded hours, so only Head applies it; Admin and Coordinator submit Head-review proposals. Pending proposals leave live hours unchanged. VIEWER has no mutation controls, cannot write through the API, and receives records with private reasons withheld by the server. Tutor accounts cannot access this management listing.

## Reports and exports

Open **Reports** (`/admin/history`) and choose a school year and quarter, semester or whole-year scope. **Summary** shows totals and tutors; **Detailed** adds sessions, cards, meetings, meeting attendance, adjustments, crew and attendance flags; **Full** also includes applications, signups, removals and tutor participation requests. Sections follow enabled modules.

HEAD can download a displayed table as CSV. Use **Print / Save as PDF** and the browser's print dialog for a printable report. Review the private-data masking option before sharing; VIEWER responses are always masked by the server. Report exports reflect the chosen scope and current records. They are not database backups and do not use the import format below.

## Import and export program records

Only **HEAD** can open **Program records** (`/admin/records`), download CSV archives/templates, preview an import or commit it. ADMIN and COORDINATOR cannot submit imports for approval. Access is checked against the current database role, including after a demotion or suspension.

**Export CSV archive** downloads one ZIP containing a CSV for every supported record type plus `README.txt`. **Download CSV templates** supplies the same headers without data. Use these templates for past records from spreadsheets: rename/map the source columns to the template columns, keep the filenames, and provide stable IDs for each record and its references. An export includes all available program periods, independent of the Reports page filters.

Historical participants can remain accountless. After import, use [historical record views and reviewed account linking](historical-participant-transition.md) to inspect original enrollment information or give an eligible verified account access to its own history. Importing records or linking history does not grant current participation or departure-based observer access.

| Included records | CSV families |
| --- | --- |
| People and reference data | Tutor, Tutee, User account references, Term, SubjectLevel, CourseGroup, Subject, Room, TimeSlot, SchoolCalendarDay |
| Scheduling | RoomUnavailability, TutorAvailability, TuteeAvailability, TutorSubjectWillingness, Pairing, PairingTutee |
| Attendance and hours | Session, SessionTutee, TutorMeeting, MeetingAttendance, ServiceHourAdjustment, Patrol, PatrolObservation, PatrolCreditWindow, SessionFlag |
| Applications and membership history | TutorApplication, ApplicationSubjectIntent, InterviewAssignment, InterviewVote, TutorStatusRequest, TuteeRemovalRequest, CrewApplication, CrewStatusRequest |
| Student and academic history | StudentSurvey, StudentRequestReview, StudentQuarterBlock, StudentProfileOwnership, HistoricalAcademicRecord, PolicyAcceptance, DisciplinaryCard, StudentFeedback, StudentAppeal, TutorQualification, QualificationGrant, AcademicProfile, AcademicConfirmation |
| Announcements | Announcement, AnnouncementAck |

This is a program-record archive, not a full deployment backup. It excludes retained tutor ownership links and historical academic correction revisions; account passwords, roles and access settings; verification/registration/reset tokens; private messages; executable approval and audit payloads; live program configuration; website content; and uploaded files. `User.csv` contains reference IDs, names and emails only. Its accounts must already exist with matching values; importing never creates logins or changes account privileges. New tutor handles cannot collide with account handles, and account-owned email addresses must be reconciled through account management first. Existing users retain their own account-to-tutor links; the archive does not create those links by matching names or email addresses. Student ownership rows use explicit IDs and cannot claim a profile linked to another account. Imported survey verification hashes are newly randomized, so an old verification link cannot become usable again.

### Prepare CSV files

- Use UTF-8, unchanged case-sensitive filenames such as `Tutor.csv`, and exact column names from the templates. Quoted commas, quotes and multiline text are supported.
- Provide each primary key, including all columns of a composite key. Keep IDs unchanged on retries. Omit columns with defaults to use those defaults; otherwise supply every required column. Do not leave a required timestamp or number empty.
- Use `true`/`false`, numeric quantities, enum values from the application's schema, and ISO timestamps with `Z` or a timezone offset. Use JSON inside a quoted cell for arrays and objects.
- `\N` means a database null. An empty cell means empty text. Double a literal leading backslash or apostrophe. Exports prefix formula-like text with an apostrophe for spreadsheet safety; the importer reverses that prefix.
- New terms must have `active=false`. New pairings and sessions must belong to inactive terms. Importing history never changes the active program period. Stored historical service hours are retained, rather than recalculated with a later policy.
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

Head or Admin selects a supported IANA region in **Program & Refresh → Program Time Zone**; Head applies it and Admin requests Head review. Coordinators can read it. The default is Asia/Shanghai. Review the current/proposed time preview before submitting. Reload a stale editor or other open pages after another staff member changes the setting.

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

The published audience is fixed. For coordinator proposals, approval freezes the recipients and rejects changed audience evidence. Editing, pinning, reactivating or restoring a post does not select a new audience; publish a new announcement to change recipients. Tutors can read and dismiss only active posts addressed to their linked identity, plus applicable broadcasts. In-app notifications can also produce generic program-update email notices when program and personal information-notification preferences are enabled; these notices do not contain the announcement body.

## Message permissions and supervision

In **Message Supervision → Contact permissions**, Head applies configuration changes; Admin submits them for Head review. Management roles default to all available accounts; other roles default to management. Select a union of groups:

| Group | Who it includes |
| --- | --- |
| Management | HEAD, ADMIN and COORDINATOR |
| Current tutors | Tutors assigned to an explicitly owned student profile in an active-term pairing |
| Past tutors | Recorded assigned tutors for owned profiles, excluding current tutors |
| Same scheduled group | Accounts owning tutees in the exact same active-term pairing; a shared period or time slot alone is insufficient |
| All available accounts | Available accounts other than self; this broadens access beyond relationship groups |

A user override **replaces** the role groups. An empty override prevents new sends; removing it restores role inheritance. Suspended, restricted, deleted and self accounts cannot be new recipients. Messaging restrictions apply independently of group selection. Record a reason for changes; the effective source and groups are visible in settings and changes enter the audit log.

Messages deliver immediately, with no pre-delivery approval queue. HEAD/ADMIN can search disclosed messages by participant or text and filter visible/hidden content. **View conversation** shows a participant pair; **All conversations** clears that filter. Opening content requires a reason and records review evidence without marking it read for the recipient.

Hiding removes content from participants' responses while retaining it for authorized review; restoring makes it visible again. Both actions require a reason and keep actor/time evidence. Admin/Head can hide messages or impose messaging restrictions directly; restoring messages or removing restrictions requires Head application, with Admin requests held for review. There is no message-deletion control. Participant-only messages remain outside supervision, and coordinators cannot inspect other people's conversations. Publish wording that matches this disclosure using the [policy publication procedure](policies/README.md#publish-a-revision).

## Publish pages and translations

Use **Landing Page** for public content, menus, media and custom pages. Custom pages and page-mode sections share the same URL namespace. The editor adds a numeric suffix when a slug is occupied; unpublished content still reserves its URL. Check the resulting public link after saving.

Assigned translators submit text drafts for review. If the destination text or language changes before approval, reject the stale draft, reload the current destination and submit again. A coordinator publication decision requires ADMIN/HEAD approval. English and Chinese are visible by default; review wording in hidden catalogs before enabling additional languages. Policy publication uses its own [reviewed revision workflow](policies/README.md).

Translations cover interface strings and supported public text such as news, sections and page titles. Translators can add a language with English fallback; management controls visibility, ordering and deletion of added languages. Built-in language catalogs cannot be deleted. Enabling a UI language does not create a policy translation: publish reviewed policy text separately, or the policy falls back to English.

## Tutor and tutee recruitment windows

In **Program & Refresh**, Head applies **Tutor recruitment** and **Tutee recruitment** settings separately for the active period; Admin submits each change for Head review. Each panel has an **Accept applications** switch, independently optional starting and ending times, and an optional external preview link. Save each panel separately. Times use the configured program timezone; the start is inclusive and the end is exclusive. An enabled form with neither bound accepts applications immediately, provided its prerequisites are configured. Turning off the switch pauses applications regardless of dates. Period refresh creates a new period with the default open switches and no time bounds; configure its intake before announcing it.

Participants can always read `/tutor-signup` and `/tutee-signup`; old `/signup` links redirect to the tutee form. Before the start, after the end, while paused, or while setup is incomplete, the questions remain visible with disabled response fields. Published policies remain readable. Preview mode never exposes participant responses. An external sheet is optional; its owner must grant viewer-only permissions because the website cannot control a third-party sheet's editing rights.

Publish the English source of both policies through **Policy Documents**, configure active **Subjects & Levels**, and add **Time Slots** when tutee availability is required. Missing or empty policy publication is shown as incomplete setup, rather than a retryable loading error. Real database/network failures still show Retry. Tutee submission also requires working transactional email.

The server rechecks the current recruitment window on every submission. Open browser tabs update timed boundaries and poll schedule changes every 30 seconds. A form submitted after closing is rejected even before its next poll. Schedule saves reject an ending time at or before the start and reject a stale active-period ID. Existing opening times and external preview links survive the recruitment migration.

## CAPTCHA verification

Management → Program & Refresh includes an immediate CAPTCHA Verification switch
for public tutee/viewer signup or resend and Crew application/status email. Head applies changes; Admin requests Head
review, and Coordinators can inspect status. A pending request leaves the effective setting unchanged. Enabling requires local provider configuration and uses paid
Aliyun checks. Disabling leaves signup quotas active and never needs a provider
call. See [setup, costs and outage procedure](captcha.md).
