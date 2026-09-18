# Program functions and controls

[Documentation home](README.md) · [Role guide](user-guide.md) · [Deployment](deployment.md)

This is the supported single-program website. Account role, tutor participation, crew membership and translation assignment are separate capabilities. Page visibility follows both permission and the effective program configuration; the server checks access independently.

## Functions by purpose

| Purpose | User entry | Management entry / outcome |
| --- | --- | --- |
| Request tutoring | Home → Request a Tutor; `/signup` | Signup Requests (`/admin/requests`): verify demand, match at original survey priority, review current and processed requests |
| Become a tutor | Home → Become a Tutor; `/tutor-signup` | Tutor Applications: select qualified panel and chair, interview, vote and decide; record actual completion in `/admin/interviews` |
| Create an accepted tutor account | Registration code at `/register`, then emailed verification/setup | Registration Codes and Users & Roles; an application or roster row alone is not a login |
| Participate as a tutee | `/student`, with Dashboard, Schedule, Requests, Attendance, Support, Messages and Account tabs | Tutee Roster, Pairings, withdrawals and discipline; explicit account ownership controls records |
| Teach and record attendance | Tutor Dashboard (`/dashboard`), Settings (`/settings`), Handbook (`/handbook`) | Attendance Submissions, Attendance Flags, Service Hours and Hour Adjustments |
| Schedule teaching | Tutors maintain availability and pairing defaults | Subjects & Levels, Time Slots, Rooms and Pairings; room blocks warn against conflicts |
| Manage interviews | Assigned panelists vote in Tutor Dashboard; the chair schedules and records the decision | Tutor Applications assigns the panel; Interviews & Panelists groups qualifications and records, links to panel controls, and records actual completion duration |
| Communicate | Workspace Messages and notifications | Announcements support immutable recipient snapshots, filters and individual overrides; private deliveries remain isolated per recipient; disclosed new messages allow audited HEAD/ADMIN supervision ([contact controls](#message-permissions-and-supervision)) |
| Get support | Tutee Support tab, session feedback, card appeals and private messages | Tutee Support (`/admin/student-support`) handles shared feedback, appeals and school calendar; Users & Roles → User details holds account-scoped policy acceptance history |
| Review sensitive changes | Coordinators prepare changes | Management Actions: ADMIN/HEAD recheck evidence before applying or declining; pending is not applied |
| Observe the program | `/viewer-signup`, verify email, then read-only management area | VIEWER sees permitted summaries with private contact data masked; observer access does not grant management writes |
| Patrol rooms | Apply at `/crew-signup`; active crew member → `/patrol` | Crew maintains applications, membership, room order, patrols and corrections; observations support attendance review |
| Maintain accounts | Shared Account settings; verified email changes and password recovery | Users & Roles manages identities, invitation/setup, capability assignment, suspension and leadership boundaries |
| Publish program information | Home, program information menu and custom pages | Landing Page edits content, media, menus and custom pages; Policy Documents publishes versioned runtime policies |
| Translate | Assigned translator → Translations (`/localization`) | Draft/review/publish translations and control language visibility; hidden languages need wording review before launch |
| Report and audit | Reports (`/admin/history`) and permitted read-only views | Period summaries, detailed records, CSV exports and browser printing; Audit Log identifies actual actor accounts and reviewed changes |

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
| Email 2FA (`EMAIL_2FA`) | Off | Makes email two-factor functionality available; configure and test SMTP first |

Switches control available pages and operations; they do not erase historical data. Turning off service-hour views does not stop attendance from recording calculated hours. See [feature implementation](../src/server/program/features.ts) and [refresh behavior](#refresh-the-program).

## Other configurable behavior

| Control | Scope / timing |
| --- | --- |
| Program timezone | ADMIN/HEAD saves a supported IANA region after reviewing consequences; dates and deadlines use it consistently. Existing instants remain fixed; weekly slots remain school wall-clock times |
| Signup opening and preview link | ADMIN/HEAD changes the current intake immediately; a scheduled opening requires an HTTP(S) preview link. Clearing the opening time opens intake immediately |
| Subjects, levels, slots and rooms | Management catalogues used by application, availability and pairing workflows |
| Policy versions | Published database revisions require new acceptance for participation; changing a bundled sample policy does not publish it |
| School calendar | Staff define holidays and make-up days used for school-day appeal deadlines |
| Feedback visibility | Management-only by default; configured sharing also affects earlier feedback |
| Announcements | Filters combine across groups; alternatives within a group match any choice; explicit exclusions win. Published recipients are fixed |
| Language visibility | English and Chinese are the launch-visible catalogues; six hidden catalogues contain English fallbacks |
| Personal theme and guidance | Six accent themes; dismissible management guidance can be reopened and remains scoped to the signed-in account |

## Optional email notifications

ADMIN or HEAD can enable **Email notifications** in **Program & Refresh**. This immediate setting defaults off and is separate from staged modules and email 2FA. Production requires configured email delivery. Individuals then choose categories and whether verified secondary addresses receive notices; see [personal preferences](user-guide.md#optional-email-notifications).

Disabling the setting cancels pending notices and preserves personal preferences. The settings panel reports terminal delivery failures; operators should inspect the safe failure summaries in `EmailDelivery` and follow the [delivery operations guide](deployment.md#optional-notification-delivery). Essential authentication mail remains independent.

## Schedule rooms and periods

Use **Time Slots**, **Rooms** and **Pairings** to plan recurring sessions. A room cannot host overlapping pairings in one program period or a pairing during a recurring blackout; back-to-back sessions are allowed. Availability helps participants agree on a slot and does not prevent staff from assigning a tutor before that agreement.

Changing a catalog slot affects linked schedules. Read the Time Slots guidance before saving; **How schedule changes work** reopens dismissed guidance. The tutor's default-slot control links a pairing to the catalog. Clearing that link retains its copied day and time; it does not erase the schedule. Record completed attendance truthfully even when it differs from the plan, then review any conflict warning.

The applied **Quarter System** setting controls labels: Q1/Q2 display in semester one and Q3/Q4 in semester two when quarters are disabled. Requests display their original intake, not whichever intake is currently active. Staged module changes take effect only at refresh; labels do not rewrite stored deadlines or attendance.

**Subjects & Levels** supports individual course edits and a simple `name,level` CSV import with an optional header. Maintain levels and subject qualifications before matching or choosing interview panels. Check dependent records and the displayed validation before deleting catalog entries.

## Refresh the program

ADMIN or HEAD runs refresh in **Program & Refresh** after checking the displayed current period and typing `REFRESH`. Coordinators can inspect it but cannot execute it. HEAD's pending module settings take effect in this operation; the applied quarter/semester mode determines the next period.

| Change | Result |
| --- | --- |
| Advance the period | Pending and active tutees become inactive and must sign up again; past pairings remain historical |
| Cross a semester boundary | Continuing active tutors become pending and must choose whether they are available or opting out |
| Graduate senior tutors | Active tutors in grade 12 or above graduate on entry to Q4 in quarter mode, or at the school-year boundary in semester mode |
| Cross a school-year boundary | Remaining active tutors with a recorded grade advance one grade |
| Preserve evidence | Attendance, service hours, policy acceptances and audit records remain; current-period totals and participation are evaluated separately |

Reload if another administrator has already changed the period. After refresh, check applied switches, tutor availability, intake settings and new assignments before resuming the program.

## Review attendance flags

**Attendance Flags** compares an in-person session's distinct present students with crew observations in the same room and school date, within the session window plus 15 minutes on either side. Online sessions are excluded. Shared subject blocks count distinct students once. A `4+` observation is a lower bound and cannot establish an undercount.

A lower exact headcount creates a pending flag. Management reviews the evidence and chooses **Dismiss**, **Warn**, **Penalize** or **Escalate**; coordinator decisions need approval. A penalty records a service-hour deduction for the session's period, defaulting to 0.5 hours unless another allowed amount is entered. Escalation requests further review and does not itself remove the tutor. Attendance or patrol corrections can reopen review and remove its linked deduction. Use corrections to fix the underlying record, and retain a clear decision note.

## Reports and exports

Open **Reports** (`/admin/history`) and choose a school year and quarter, semester or whole-year scope. **Summary** shows totals and tutors; **Detailed** adds sessions, cards, meetings, meeting attendance, adjustments, crew and attendance flags; **Full** also includes applications, signups, removals and tutor participation requests. Sections follow enabled modules.

Download a displayed table as CSV, or use **Print / Save as PDF** and the browser's print dialog. Review the private-data masking option before sharing; VIEWER responses are always masked by the server. Exports reflect the chosen scope and current records. They are not backups or substitutes for the separate audit and policy-acceptance histories.

## Program time zone

HEAD or ADMIN selects a supported IANA region in **Program & Refresh → Program time zone**; coordinators can read it. The default is Asia/Shanghai. Review the current/proposed time preview and confirm before saving. Reload a stale editor or other open pages after another staff member changes the setting.

- Weekly slots keep their wall-clock values: 15:30 stays 15:30.
- Saved appointments and deadlines keep their instants and display in the selected zone.
- Calendar-only attendance dates keep their recorded day.
- New date validation, appeal school-day calculations, crew observations and datetime inputs use the selected zone.
- Existing service-hour totals are not recalculated.

Inputs in skipped or repeated daylight-saving hours are rejected; choose an unambiguous time. Each change records the previous and new zones in the audit log. No host operating-system or environment change is needed.

## Publish an announcement

In **Announcements → Recipients**, choose all current tutors, filtered tutors or specific tutors. Filters combine grade, tutor status, subject qualifications/current-term assignments and active-tutee counts. Choices within a group match any selected value; different groups must all match. An empty group imposes no restriction.

**Include** adds a tutor regardless of filters; **Exclude** wins over both filters and inclusion. Search narrows only the override picker. Check the complete audience count and name preview before publishing; an empty audience is blocked. Assignment filters need an active term and count unique active tutees in that term.

The published audience is fixed. For coordinator proposals, approval freezes the recipients and rejects changed audience evidence. Editing, pinning, reactivating or restoring a post does not select a new audience; publish a new announcement to change recipients. Tutors can read and dismiss only active posts addressed to their linked identity, plus applicable broadcasts. In-app notifications can also produce generic program-update email notices when program and personal information-notification preferences are enabled; these notices do not contain the announcement body.

## Message permissions and supervision

HEAD/ADMIN configure **Message supervision → Contact permissions**. Management roles default to all available accounts; other roles default to management. Select a union of groups:

| Group | Who it includes |
| --- | --- |
| Management | HEAD, ADMIN and COORDINATOR |
| Current tutors | Tutors assigned to an explicitly owned student profile in an active-term pairing |
| Past tutors | Recorded assigned tutors for owned profiles, excluding current tutors |
| Same scheduled group | Accounts owning tutees in the exact same active-term pairing; a shared period or time slot alone is insufficient |
| All available accounts | Available accounts other than self; this broadens access beyond relationship groups |

A user override **replaces** the role groups. An empty override prevents new sends; removing it restores role inheritance. Suspended, restricted, deleted and self accounts cannot be new recipients. Messaging restrictions apply independently of group selection. Record a reason for changes; the effective source and groups are visible in settings and changes enter the audit log.

Messages deliver immediately, with no pre-delivery approval queue. HEAD/ADMIN can search disclosed messages by participant or text and filter visible/hidden content. **View conversation** shows a participant pair; **All conversations** clears that filter. Opening content requires a reason and records review evidence without marking it read for the recipient.

Hiding removes content from participants' responses while retaining it for authorized review; restoring makes it visible again. Both actions require a reason and keep actor/time evidence. There is no message-deletion control. Participant-only messages remain outside supervision, and coordinators cannot inspect other people's conversations. Publish wording that matches this disclosure using the [policy publication procedure](policies/README.md#publish-a-revision).

## Publish pages and translations

Use **Landing Page** for public content, menus, media and custom pages. Custom pages and page-mode sections share the same URL namespace. The editor adds a numeric suffix when a slug is occupied; unpublished content still reserves its URL. Check the resulting public link after saving.

Assigned translators submit text drafts for review. If the destination text or language changes before approval, reject the stale draft, reload the current destination and submit again. A coordinator publication decision requires ADMIN/HEAD approval. English and Chinese are visible by default; review wording in hidden catalogs before enabling additional languages. Policy publication uses its own [reviewed revision workflow](policies/README.md).

Translations cover interface strings and supported public text such as news, sections and page titles. Translators can add a language with English fallback; management controls visibility, ordering and deletion of added languages. Built-in language catalogs cannot be deleted. Enabling a UI language does not create a policy translation: publish reviewed policy text separately, or the policy falls back to English.
