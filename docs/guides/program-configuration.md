# Program functions and controls

[Documentation home](../README.md) · [Role guide](user-guide.md) · [Deployment](deployment.md)

This is the single-program reference for management authority, settings, modules,
schedules, calendars, refresh and records. Account role, tutor participation, crew
membership and translation assignment are separate capabilities; the server
enforces every permission independently of page visibility.

> **Shared editor behavior:** Settings panels save independently and keep unsaved
> drafts during background refreshes and failed saves. On a version conflict,
> explicitly **Reload** before saving again; if a write succeeds but follow-up
> reads fail, use **Retry refresh** (reads only, never replaying the write).
> Within one browser session, returning recalls the active tab, filters and sort
> order without storing drafts or passwords.

## Management responsibilities and review

**Head** is the root management role and inherits every **Admin** capability.
Admin and Head apply non-refresh management changes directly; **Coordinators**
submit permitted changes to **Administration → Management Actions** (a queued
proposal never modifies live records). Review notices go to eligible Admins, with
Head as fallback when none can review; Head retains review authority regardless.
See [approval-policy.ts](../../src/lib/approval-policy.ts).

| Category and entry points | Direct authority | Allowed proposals | Reviewers |
| --- | --- | --- | --- |
| Recruitment windows, timezone, staged modules and next-period openings | Admin or Head | Coordinator | Admin or Head |
| Official program refresh and activation of staged settings | Head | Admin | Head |
| Program/security settings, calendars, policies, languages and signup fields | Admin or Head | Coordinator where permitted | Admin or Head |
| Account/roster names, usernames, academic corrections, participant badges and initial application name corrections ([workflow](user-guide.md#correct-an-initial-tutor-applications-name)) | Admin or Head | Coordinator | Admin or Head |
| Non-Head management rank grants/revocations and Admin/Coordinator invitations | Admin or Head | None | Admin or Head (compatible legacy requests) |
| Leadership transfer | Current Head (fresh password + singleton checks) | Dedicated transfer only | — |
| Identity combination, account deletion and Program Records import/export | Admin or Head (dedicated confirmation/ownership checks) | Dedicated workflows only | — |
| Private-message supervision and contact permissions | Admin or Head | None | Admin or Head |
| Daily operations, corrections, reversals, reinstatements and historical hours | Admin or Head | Eligible Coordinator | Admin or Head |
| Participant membership/appeal requests | Underlying participant workflow | Eligible owner | Admin or Head |

- **Reversals & restorations:** Restoring archived subjects/levels/slots,
  removing an approved qualification source, or editing an already-applied
  decision/penalty is classified as a reversal (Admin/Head direct; Coordinator
  proposes). Unknown Coordinator writes fail closed.
- **Self-review & freshness:** Only Head can review their own eligible request.
  Pending proposals recheck current roles, suspension and target fingerprints
  before applying; stale or incompatible requests must be rejected and resubmitted.
- **Reviewer notification reconciliation:** In **Management Actions**, Admin/Head
  can run **Refresh reviewer notifications** (idempotent) to append missing
  notices for current reviewers across Management Actions, Tutor/Crew membership
  requests and Crew applications.
- **Audit Log:** Records direct changes, proposals, decisions, reversals and
  automatic transitions with actor, role, outcome and safe before/after diffs
  (excluding secrets and private-message bodies).

## Functions by purpose

| Purpose | User entry | Management entry / outcome |
| --- | --- | --- |
| Help & guides | **Help & How-to** (`/help`) | **Overview → PDF handbooks** (`/admin/help`) for bilingual Geist PDF role handbooks |
| Request tutoring | `/tutee-signup` (`/tutee`, `/signup` redirect) → 4-digit mailbox code → receipt popup → `/register-account` | **Tutees → Signup Requests** (`/admin/requests`): verify demand, match by original priority |
| Become a tutor | `/tutor-signup` (`/tutor` redirects) | **Tutors → Tutor Applications**: assign qualified panel/chair, interview, vote and record completion |
| Accept an invitation | `/register-account` (`/register` redirects) or signed-in **Add access** | **Administration → Registration Codes** and **Users & Roles**; codes alone never grant access without verification and review |
| Participate as a tutee | `/student` (Dashboard, Schedule, Requests, Attendance, Support, Messages, Account) | **Tutees → Tutee Roster**, **Pairings**, **Withdrawals & Removals**, **Tutee Discipline** |
| Teach & record attendance | Unified Tutor Workspace (`/dashboard` / `/schedule`), Settings (`/settings`), Handbook (`/handbook`) | **Scheduling & Records → Attendance Submissions**, **Attendance Flags**; **Tutors → Service Hours**, **Hour Adjustments** |
| Schedule teaching | Tutor **Preferences** & **Pairings** tabs | **Scheduling & Records → Subjects & Levels**, **Time Slots**, **Rooms**, **Pairings** |
| Review subject availability | **Tutors → Subject Availability** (`/admin/subject-availability`) | Admin/Head/Coordinator inspect qualifications and willingness separately (including inherited grants); availability requires active subject/level, active tutor, approved grant and explicit willingness |
| Communicate | Workspace Messages & notifications | **Overview → Announcements** (fixed recipient snapshot), **Messages**, **Message Supervision** (Admin/Head; see [contact controls](#message-permissions-and-supervision)) |
| Get support | Tutee Support tab, feedback, card appeals, private messages | **Tutees → Tutee Support** (`/admin/student-support`); **Users & Roles → User details** holds policy acceptance history |
| Observe the program | `/viewer-signup` (`/viewer` redirects) → mailbox code → receipt popup → `/register-account` | Exclusive **Viewer** sees permitted summaries with private fields masked; existing accounts keep credentials/access on login |
| Patrol rooms | `/crew-signup` (`/crew` redirects); active Crew → `/patrol` | **Scheduling & Records → Crew** (applications, membership, patrol room order, patrols, corrections) |
| Publish content & policies | Homepage, Info menu, custom pages | **Administration → Landing Page**, **Policy Documents**, **Translations** (`/localization`) |
| Report, audit & recover | **Overview → Reports** (`/admin/history`) | Period summaries, CSV/print, **Data & Recovery → Program Records**, **Academic Corrections**, **Audit Log**, **Admission Recovery**, **Database records** |

### Invitation and verification codes

- **Invitation / registration codes:** 5 opaque characters (mixed letters and
  numbers) in a green box (`XXXXX` placeholder); outstanding legacy 5-digit,
  alphanumeric and 12-character codes remain accepted until expiry/use.
  Email-bound 5-character codes (manual, accepted tutor, accepted crew) are
  emailed best-effort after commit when security mail is configured.
  Registration Codes also displays auto-issued source badges (**Interview**,
  **Accepted application**, **Crew application**), **Issued By**, **View
  application**, and **Unavailable** reason annotations (too many failed
  attempts, source application flagged invalid or no longer accepted).
- **Email verification codes:** 4 digits (leading zeros significant) in a blue
  box (`XXXX` placeholder).
- Verified public signups hand off to `/register-account` via a short-lived
  HttpOnly cookie (no proofs or passwords in URLs or JS storage). Matching emails
  never auto-merge accounts; authorized participation/management invitations
  replace exclusive Viewer, keep the higher management rank (never demoting or
  granting Head), and enforce MFA and suspension.

## Optional modules

**Administration → Program Settings** organizes controls into **Recruitment and
Refresh**, **Account Settings**, **Deployment Configurations**, and **Optional
Features**.

Admin and Head stage switches in **Optional Features** directly; Coordinators
submit proposals. Staged switches take effect only at the **next program refresh**
(switch back to cancel a pending change). Turning a module off hides its pages
and mutations without erasing historical records. See
[features.ts](../../src/server/program/features.ts).

| Switch | Default | Effect when applied |
| --- | --- | --- |
| Crew patrols (`CREW`) | On | Enables Crew navigation, patrol workflows and procedures |
| Discipline cards (`DISCIPLINE`) | On | Enables disciplinary cards, automatic unexcused-absence red cards and appeals |
| Tutor meetings (`MEETINGS`) | On | Enables meeting scheduling, attendance and 45-minute advance excuses |
| Interviews & voting (`INTERVIEWS`) | On | Enables panel interviews, voting and completion/hour awards |
| Service hours (`SERVICE_HOURS`) | On | Enables service-hour views, adjustments and school reports |
| Quarter system (`QUARTER_SYSTEM`) | On | On uses Q1–Q4; Off uses S1/S2 |
| Viewer signup (`VIEWER_SIGNUP`) | On | Allows public Viewer self-registration (without expanding Viewer permissions) |
| Email 2FA (`EMAIL_2FA`) | On | Enables opt-in sign-in 2FA and requires emailed verification codes for all password changes |
| Auto-assign rooms (`AUTO_ASSIGN_ROOMS`) | On | Automatically allocates rooms on schedule confirmation/change without reallocating existing bookings |

## Other configurable behavior

| Control | Scope & authority |
| --- | --- |
| Program timezone | Admin/Head apply supported IANA zone; Coordinator proposes ([details](#program-time-zone)) |
| Recruitment windows | Independent active-period Tutor and Tutee windows ([details](#tutor-and-tutee-recruitment-windows)) |
| Names and grades | Offered grades, **Use preferred names**, **Show names in another language**, and per-account-type Required/Optional/Hidden name rules ([name fields](user-guide.md#names-and-academic-details), [reference](../reference/name-fields.md)) |
| Catalogues | **Subjects & Levels**, **Time Slots**, **Rooms** |
| Policy versions | Published database revisions in **Policy Documents**; repo drafts never auto-publish |
| Holidays, pauses & weekday overrides | Unified **Holidays & Tutoring Pauses** and **Weekday Overrides** ([details](#school-calendar-and-timetable-dates)) |
| Feedback visibility | Management-only by default; enabling sharing to the session's tutor also exposes earlier feedback |
| Language visibility | English and Chinese visible by default; six hidden catalogs carry English fallbacks |

## Optional email notifications

In **Administration → Program Settings → Deployment Configurations → Email
Notifications**:

- **Enable email notifications:** Defaults off; takes effect immediately when
  Admin/Head apply it (Coordinators propose). Disabling cancels pending optional
  notices while keeping personal preferences. Essential security alerts,
  `SessionNotice` scheduling mail, and public-request invalidity/clear notices
  remain independent of this switch.
- **Required notifications:** Admin/Head only (no Coordinator proposals). Lock
  **Unread badge** and/or **Email** on per category (upcoming reminders are
  email-only). Locked controls show checked/disabled in user settings while
  preserving the user's underlying choice for when unlocked.
- **Email language:** Outgoing mail is sent in a single language selected from
  the recipient's saved **Email language** preference in Account Settings
  (English default or 中文; public signups use the selected browser language
  until an account preference exists). See
  [personal preferences](user-guide.md#optional-email-notifications) and
  [notification events](../reference/notification-events.md).
- **Secondary-Email Binding:** Independent toggle (defaults on; Admin/Head apply,
  Coordinators propose). Disabling blocks adding/confirming new secondary
  addresses without affecting existing verified addresses or sign-in.
- **Email Delivery Status & Email Quota:** Tests `SECURITY` and `PROGRAM` SMTP
  (1-minute cache; **Refresh status** is read-only) and shows retrying, exhausted
  and uncertain counts. When Aliyun Direct Mail quota keys are configured,
  Admin/Head also see the **Email Quota** card here and on `/admin` (daily
  200-email free cap, remaining balance, `Asia/Shanghai` reset time, 60 s cache;
  see [quota setup](deployment.md#show-the-direct-mail-quota-on-the-dashboard)).
- **Resend stuck emails:** Admin/Head only (no Coordinator proposals). Queues up
  to 100 eligible failed/retrying outbox rows for the worker, excluding uncertain
  rows, active leases, untouched pending rows, unconfigured categories and
  disabled optional mail (`security` and `request_service` stay eligible). See
  [delivery operations](deployment.md#optional-notification-delivery).
- **Public-request invalidity & appeals:** Admin/Head apply flags/clears
  directly; Coordinators propose. Only applied flags/clears queue essential
  `request_service` mail (unverified submitters see masked details; verified
  submitters see the staff reason). Current-period tutee signups use the
  version-bound signup appeal (accepted clears flag preserving priority; final
  rejection closes request). Tutor and legacy tutee requests receive a 90-day
  `/request-appeal` link (one appeal per flag; declining leaves the flag in
  place). Staff inspect receipt status and retry eligible receipts in the
  invalidity dialog.

## Schedule rooms and periods

### Room schedule, ordering and allocations

- **Room schedule:** Combined and per-room views with legend (occupied, `×`
  unavailable, available) and filters. Confirmed schedules remain authoritative
  even if a catalog slot changes; unconfirmed assignments occupy no cells.
- **Room display order:** In **Rooms**, use row up/down arrows and **Save order**
  / **Request room order change** (Admin/Head direct; Coordinator proposes).
  Independent of Crew patrol order and never moves bookings.
- **Blocked periods:** Under **Rooms → Manage blocked periods**, enter 24-hour
  program-timezone blocks (`24:00` = midnight; split overnight blocks). Admin/Head
  apply directly; Coordinators propose. Overlaps with active-period bookings are
  rejected.
- **Pairing status & room modes:**
  - **Active** = confirmed schedule + assigned room or intentional **No physical
    room**. **Pending** = awaiting schedule or room. **Needs room** = shortage.
  - **Automatic** allocates a room favoring (1) most familiar current-term
    participants, (2) tutor familiarity, (3) fewer occupied minutes, (4) stable
    room ID. **Fixed** pins a staff-chosen room (conflicting time edits reject
    instead of moving it). **No physical room** stays roomless until staff
    changes it.
  - Each independent pairing reserves at most one room; an explicitly combined
    group shares one reservation via its primary member. Shortages emit an in-app
    Admin/Head notice and clear via explicit retry after resolving capacity.
- **Tutor workload preference:** Selectors show `(assigned/preferred)` (0–4;
  defaults to 1 for new tutors; valid combined groups count as 1 block;
  inactivity locks to 0 until changed after reactivation). Assigning above
  preference shows an advisory Continue/Cancel confirmation. Tutors edit this in
  **Preferences → My Time Availability → Edit availability** ([tutor guide](user-guide.md#tutors)).
- **Time slots:** Clearing a pairing's catalog slot link keeps its agreed copied
  day/time. Editing a catalog slot's clock times also updates linked recorded
  sessions (recalculating combined-block hours once, re-evaluating attendance
  flags, notifying Head; Admin/Head direct, Coordinator proposes).

### Subjects, qualifications and interviews

- **Subjects & Levels:** Configure course groups with base names per level
  (ordered Beginner → Advanced; Standard unprefixed, AP accepts AP score).
  Course pickers sort by level rank then alphabetically. Bulk **Import Subjects**
  accepts JSON (up to 500 offerings / 1 MB; [example](../../public/examples/course-groups.json))
  or `name,level` CSV. Removing a subject archives it without erasing history;
  levels with variants cannot be deleted.
- **Qualifications:** Managed in **Tutors → Subject Availability** and **Tutor
  Applications**. Approving a variant grants it plus all lower offered levels in
  that group at approval time (later reordering never changes past grants).
  Removing an approval source is a reversal (Admin/Head direct; Coordinator
  proposes) and removes only that source's grants.
- **Interview completion & hours:** In **Tutor Applications → Interview Records**,
  **Record completion & award hours** captures actual datetime, 1–480 minutes
  (`minutes ÷ 60` per attendee) and reason (**Correct completion & hours**
  replaces automatic credits while keeping unrelated adjustments; requires both
  `INTERVIEWS` and `SERVICE_HOURS`). Only applied initial acceptance authorizes
  registration codes (additional qualifications issue no code).

## Refresh the program

**Administration → Program Settings → Recruitment and Refresh** provides one
unified **Program Refresh** card combining scheduled-refresh status, run
conditions, compact embedded **Next-Period Recruitment** openings, pending staged
optional features, and the single **Authorize Refresh** entrance.

- **Head** runs or schedules refresh directly after reviewing destination,
  timezone, prepared openings and staged features and typing `REFRESH`.
- **Admin** submits a refresh request for Head approval.
- **Coordinators** inspect refresh status/conditions and submit next-period
  opening proposals for Admin/Head review, but cannot submit or execute a refresh.

| Change | Result |
| --- | --- |
| Advance the period | Pending and active tutees become inactive and must sign up again; past pairings become history |
| Cross a semester boundary | Continuing active tutors become pending and must confirm availability or opt out |
| Graduate senior tutors | Active tutors with confirmed G12 for the graduating year graduate entering Q4 (quarter mode) or at school-year boundary (semester mode) |
| Cross a school-year boundary | Reported grades stay unchanged; academic profiles require reconfirmation |
| Preserve evidence | Attendance, service hours, policy acceptances and audit records remain intact |
| Activate prepared openings | Applied next-period Tutor/Tutee openings become active atomically with the new period |

A failed refresh rolls back completely; stale preparations or changed staged
features require renewed review. For Q1 → Q2 and Q3 → Q4 in quarter mode, refresh
records source provenance for the optional [continuation opening window](#continuation-opening-window)
(graduated Q3 → Q4 tutors cannot receive automatic continuation assignments).

### Schedule a refresh

Inside **Program Refresh → Authorize Refresh**, **Schedule for later** is the
default mode (switch to **Refresh now** in the same entrance only to advance
immediately). Choose a future date/time in the program timezone, type `REFRESH`,
and confirm the final consequence review. A future prepared tutee opening cannot
precede the scheduled refresh (bound shown inline).

- Full transition effects stay collapsed under **Effects & full refresh details**
  and appear in full inside the review modal.
- Approved schedules survive restarts and are checked on boot and every 30 s
  (catching up after downtime; 5 execution failures pause retries).
- Editing prepared openings or any reviewed setting promptly rechecks an active
  schedule and marks it **Needs renewed review** (notifying Admin/Head).
  Changes to the approving Head's role, suspension or merge also invalidate it;
  Head must approve a replacement.

### Public signup between quarters

When Q1 or Q3 recruitment ends or pauses, `/tutee-signup` and `/tutor-signup`
automatically show their respective prepared Q2 or Q4 opening (polling every 30 s,
pending activation every 5 s). If a refresh is blocked/cancelled or next-quarter
intake is disabled, a saved opening for the next target displays as a **configured
opening** (subject to review/activation, with no countdown). Entered answers
survive rollover, but submitters must review the new period and renew policy
consent before submitting.

## School departure and viewer access

Graduated and transferred participants retain personal dashboards, history, and
an **Enter viewer portal** link (same masked summaries as Viewer without
converting to the exclusive Viewer role).

- **How it happens:** Participants request graduation/transfer/return under
  Account Settings → **School Departure** (Admin/Head review in Management
  Actions), or staff record it via **Users & Roles → Edit Profile → School
  Departure** (Admin/Head direct; Coordinator proposes). Program refresh also
  graduates eligible seniors automatically.
- **Effects:** Ends active tutoring/tutee participation, removes current
  assignments and requeues affected learners while keeping history. Crew,
  translator and management roles remain for independent review.
- **Revocation & return:** Admin/Head can revoke or restore departure-based
  observer access. A reviewed return removes observer access, returns eligible
  tutors to pending activation, and requires fresh tutee enrollment without
  rebuilding old assignments.

## Review attendance flags

**Scheduling & Records → Attendance Flags** compares in-person session present
counts against Crew observations in the same room/date within ±15 minutes
(online sessions excluded; combined blocks count distinct students once; `4+` is
a lower bound).

- Lower exact headcounts open a pending flag. Staff choose **Dismiss**, **Warn**,
  **Penalize** (default 0.5 h deduction for that period) or **Escalate**
  (Admin/Head direct; Coordinator proposes).
- Attendance or patrol corrections reopen review and remove linked deductions.
  Failed reads never render as an empty queue; denied access conceals flags until
  a fresh successful read.

## Tutor hour adjustments

**Tutors → Hour Adjustments** (`/admin/hour-adjustments`) adds extra hours or
deductions for a tutor and `YYYY-MM` month (requires `SERVICE_HOURS` enabled).
Fractional hours display without rounding (e.g., `0.75`). Admin/Head apply
additions and deletions directly; Coordinators propose both; Viewers receive
read-only records with private reasons masked.

## Reports and exports

**Overview → Reports** (`/admin/history`) supports **Summary**, **Detailed**, and
**Full** views scoped by school year and quarter, semester or whole year.
Admin/Head can export displayed tables as CSV or use **Print / Save as PDF**
(with optional private-data masking; Viewers are always masked server-side).
Signup grades reflect the latest reviewed historical academic correction or
preserved enrollment grade.

## Import and export program records

**Data & Recovery → Program Records** (`/admin/records`, Admin/Head only — no
Coordinator proposals) exports all periods as a ZIP of CSVs (`Export CSV archive`
/ `Download CSV templates`) and imports historical archives atomically.

- **Scope:** Covers people/reference data, scheduling, attendance/hours,
  applications/membership, student/academic history and announcements. Excludes
  passwords, roles, tokens, private messages, live settings, landing content,
  uploads, retained tutor ownership links and academic correction revisions —
  not a substitute for a full database backup.
- **Historical transition:** Imported participants can remain accountless; see
  [historical participant transition](historical-participant-transition.md).
  Imported hours stay excluded from automatic school-hours credit (see
  [school reporting](user-guide.md#review-records-and-reports)), and imported
  meetings/attendance/patrols do not trigger retroactive deductions, slot
  recalculations or discrepancy flags.
- **CSV rules:** UTF-8, exact case-sensitive filenames (`Tutor.csv`, `Term.csv`,
  `Pairing.csv`, etc.), `\N` for null, formula-safe leading apostrophe escaping,
  max **5 MiB / 5,000 records** per transfer. New terms must be `active=false`;
  new tutors must have an inactive status (`GRADUATED`, `OPTED_OUT`, `ARCHIVED`,
  `TRANSFERRED`); new tutees must be `INACTIVE`; all applications/meetings/patrols
  must be historical/completed.
- **Preview & commit:** Preview validates without writing; confirmation applies
  the exact previewed files within 15 minutes (all-or-nothing; exact existing
  rows skip, conflicting IDs reject the batch).

## Program Time Zone

In **Administration → Program Settings → Recruitment and Refresh → Program Time
Zone**, Admin/Head apply any supported IANA zone (default `Asia/Shanghai`;
Coordinators propose). Use **Preview date** to inspect seasonal offsets without
saving.

- Weekly slots retain wall-clock times (`15:30` stays `15:30`); saved instants
  display in the new zone; calendar-only attendance dates stay unchanged.
- Appeal school-day deadlines and re-run patrol reconciliations use the active
  zone; existing service-hour totals never recalculate; skipped/repeated DST
  inputs are rejected. Database connections always use UTC.

## Publish an announcement

In **Overview → Announcements → Recipients**, target all current tutors,
filtered tutors (grade, status, qualifications, assignments, active-tutee count)
or explicit **Include** / **Exclude** overrides (**Exclude** always wins; empty
audience blocked).

- The audience freezes at publication (editing/pinning/reactivating never
  re-targets or resends). Pinned posts show 📌 before 📣 with no Dismiss action;
  ordinary posts can be dismissed. Publishers do not receive their own notice.
- Optional announcement emails send the bounded title and link (full body stays
  on-site) per [delivery rules](deployment.md#optional-notification-delivery).
  Landing **Program News** is separate and sends no announcement email.

## Message permissions and supervision

In **Administration → Program Settings → Account Settings → Contact permissions**
(Admin/Head only — no Coordinator proposals), configure role defaults (Management
defaults to all accounts; others default to Management) as a union of groups:

| Group | Included accounts |
| --- | --- |
| Management | Head, Admin, Coordinator |
| Current tutors | Tutors assigned to an owned student profile in an active-term pairing |
| Past tutors | Recorded assigned tutors for owned profiles (excluding current tutors) |
| Same scheduled group | Accounts owning tutees in the exact same active-term pairing |
| All available accounts | All active, non-restricted accounts other than self |

A per-user override replaces role groups (empty blocks new sends; removing
restores inheritance). Messages deliver immediately. In **Overview → Message
Supervision**, Admin/Head can search disclosed messages, view conversations
(requiring a reason, logged without marking read), hide/restore messages with a
reason, or restrict messaging. Participant-only legacy messages stay outside
supervision; Coordinators have no supervision access.

## Publish pages and translations

- **Administration → Landing Page:** Manages homepage blocks, Program News,
  media, menus and custom pages (custom pages and page-mode sections share the
  URL namespace; unpublished items still reserve slugs and are previewable by
  editors via **View page**). Missing translations fall back to English, then
  first stored language.
- **Administration → Translations (`/localization`):** Assigned translators
  submit string/content drafts; Admin/Head approve (Coordinator publication
  requires Admin/Head approval). Translators can add languages with English
  fallback; management controls visibility/order (built-in catalogs cannot be
  deleted). Enabling a UI language never creates a policy translation — publish
  policies separately per [policy publication](policies/README.md#publish-a-revision).

## Tutor and tutee recruitment windows

### Download public QR images

Under **Program Settings → Recruitment and Refresh → Share Signup Links**, any
reader of the panel can download four labeled transparent PNGs (`/tutor`,
`/tutee`, `/crew`, `/`) encoding the deployment's configured `AUTH_URL` (Chinese
labels for Chinese UI, English otherwise). Regenerate after any domain change
per [deployment guidance](deployment.md#public-qr-domain-and-regeneration).

### School calendar and timetable dates

Under **Administration → Program Settings → Recruitment and Refresh**:

- **Holidays & Tutoring Pauses** combines school closures and tutoring pauses/notices
  in one sortable table (`Reason / Note` column; Admin/Head direct, Coordinator
  proposes):
  - **Add holiday:** Inclusive closure range (up to 366 days, including weekends)
    with an internal **Staff note** (never sent to participants). Consecutive
    closed dates sharing a note group into one editable/resettable range. Affects
    five-school-day appeal deadlines and suppresses ordinary recurring plans.
  - **Add tutoring pause or notice:** Inclusive range on open school days with a
    participant-visible **Reason** (one notice per start date; change start by
    removing and recreating). Defaults to **Pause regular tutoring** (suppresses
    future ordinary lessons and clears pending 24-hour automatic-acceptance
    deadlines, while keeping already-confirmed extras/reschedules and allowing
    explicitly agreed exceptions via **Arrange exception**); **Notice only** is
    informational. Always inspect **Review impact** (participant commitment count)
    before saving, editing or removing a pause. Overlapping pauses are independent.
- **Weekday Overrides** (below Holidays & Tutoring Pauses): **Add weekday
  override** configures a weekend make-up school day or an alternate weekday
  timetable (e.g., Wednesday following Friday's timetable). Saving on a holiday
  replaces that day's closure after warning. School-day open/closed status
  affects appeal deadlines; timetable mapping alone does not.
- **Notifications:** Eligible tutors and tutees with confirmed pairings or agreed
  dated sessions on affected dates receive in-app change/reset notices and
  18:00–12:00 advance reminders (plus optional **Information / Program** email;
  staff notes are never sent). Note-only edits emit no notice. See
  [session planning](../reference/session-planning.md).

### Configure recruitment windows

In **Program Settings → Recruitment and Refresh**, Admin/Head apply active-period
**Tutor recruitment** and **Tutee recruitment** settings independently
(Coordinators propose): **Accept applications** switch, optional inclusive start
and exclusive end in the program timezone, and optional viewer-only external
preview link.

### Prepare next-period openings

Embedded inside the unified **Program Refresh** card, Admin/Head save, edit or
clear next-period Tutor and Tutee opening times independently; Coordinators submit
proposals for Admin/Head review; Viewers are read-only. Saving never triggers a
refresh or alters current intake. For a Coordinator proposal, **Check approval
status** keeps the draft and request link visible until a terminal decision is
read. Applied preparations install atomically at refresh.

### Continuation opening window

Available only after an official Q1 → Q2 or Q3 → Q4 refresh in quarter mode:

- Runs for exactly **1 hour** from the destination's **first effective opening**
  (inclusive start, exclusive end; pausing, reopening or editing the start never
  grants a second hour; closing signup ends the shortcut).
- The continuation panel auto-hides in the browser as soon as the 1-hour window
  elapses (preserving an already-filed receipt or held uncertain submission).
- Confirming a regular new signup hides continuation. Existing/imported periods
  with unknown first-opening provenance do not receive an invented window.
  See [Continue selected pairings](user-guide.md#continue-selected-pairings-into-the-next-quarter).

### Current-period access and submissions

- Viewers have read-only access to public current-period and recruitment values;
  Admin/Head edit directly and Coordinators submit proposals.
- `/tutor-signup` and `/tutee-signup` remain viewable when closed, paused or
  missing setup (English policies in **Policy Documents**, active **Subjects &
  Levels**, and **Time Slots** when required), with inputs disabled. Open tabs
  enforce boundaries and poll every 30 s.
- Closing public signup does not stop signed-in editing of an owned **OPEN**
  tutee request (saving sets and displays the **Edited** badge only when signup
  answers actually change). Admin/Head review edits affecting already-assigned
  subjects.

| Tutee request event | Identity & consent | Priority, deadline & records |
| --- | --- | --- |
| Fresh public request | No auto-account via email; setup requires mailbox proof + invitation review | Priority reserved at first accepted submission |
| Same-email replacement | Fresh challenge + consent + existing login/MFA review | Keeps original timestamp, fixed deadline, assignments and original source |
| Exact retry | Recovers bound receipt only | No duplicate revision, CAPTCHA, email or notice |
| Signed-in owner edit | Explicit ownership + version; `Edited` badge set only if answers changed | Keeps priority and assigned choices; allowed after public closing |
| Policy updated after staging | Keeps stage-time signed revision | Separate current-policy gate still applies for participation |
| Assigned before verification | Existing source or exact-intent proof completes verification | Fixed 7-day deadline (never extended by resends, edits or appeals) |
| Invalid request under appeal | Reasoned appeal before period rollover; Admin/Head decide | Stays invalid/blocked during review; acceptance preserves priority |
| Final invalidity rejection | Retains original & decision evidence | Closes active request and ends priority; new signup starts fresh |

## CAPTCHA verification

**Administration → Program Settings → Deployment Configurations** provides an
immediate **CAPTCHA Verification** switch (defaults off; Admin/Head apply,
Coordinators propose) covering public tutee/viewer signup/resend and Crew
application/status email. Enabling validates local provider configuration and
uses Aliyun checks; disabling leaves signup quotas active without contacting the
provider. See [CAPTCHA reference](../reference/captcha.md).
