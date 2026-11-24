# Notification event inventory

[Documentation home](../README.md) · [User guide](../guides/user-guide.md#optional-email-notifications) · [Delivery implementation](technical-report.md#account-emails-and-delivery)

This inventory covers every identity supported by [notification-events.ts](../../src/lib/notification-events.ts).
Recipients and triggers below follow the actual server emitters, including direct
notification inserts, helper fan-out, raw account-email queue calls and database
triggers. English and Chinese copy is transcribed from the maintained
[catalogues](../../messages/en.json) ([Chinese](../../messages/zh.json)); these are templates,
so allowed counts are substituted when available. A local generated inventory is a
review aid, not the source of authority.

## Delivery and access boundaries

The [recovery draft event](#recovery_workflow_draft) is in-app-only and remains
bound to its exact source owner and reviewed recovery transaction. It never
replays earlier email or reopens the original request.

Typed in-app notifications retain localized event headings and show their captured
change details. [In-app detail formatting](../../src/lib/notification-details.ts)
selects a bounded English/Chinese snapshot (English for other interface languages),
then the original nonempty stored body, then the event's generic description.
Historical notices are never reconstructed from current mutable records. Email selects English or Chinese from the established recipient account’s saved
email-language preference. This setting is independent of the website language and
optional delivery categories. Existing accounts and accountless legacy/external
recipients default to English. Public signups retain their supported page language
through resends and new-account creation; an established account’s preference wins.
Old in-app records retain their original title/body; an unknown email event uses the
safe generic program-update copy, never arbitrary stored titles or bodies.

The first five account-change events are **email-only**: they do not create in-app
notifications. Security events ignore optional email preferences. Information and
ordinary domain event email copies require the effective program switch and the
recipient's corresponding optional category. Optional copies use the verified primary
and enabled verified secondary addresses. The previous verified primary receives the
primary-change security exception. A listed in-app audience does not imply that every
account in it has opted into email.

Email context is allowlisted on write and read, and again by the notification-email database
trigger. Counts, scheduled-event ISO instants/timezones and explicitly selected bilingual
factual descriptions (`emailDetail`) are used. These descriptions may identify affected
participants and concrete changes. School-calendar context also carries actual date,
school-day flag, effective timetable weekday, semantic revision and timezone; staff
calendar notes are excluded. No arbitrary stored body, private message, appeal/review
reason, original answers, contacts or account secrets become email context. Unknown counts
use the catalogue's count-free description.

In-app `context.inAppDetail` holds only an explicit `{ en, zh }` description, with
both nonempty strings limited to 1,000 characters and revalidated by the list API.
Emitters compose these snapshots from selected names and action facts, never whole
payloads, contact details, secrets or review reasons. Management notices summarize
the immutable proposal: pending assignments say **Proposed assignment**, while
decisions say **Approved** or **Declined**. New committed assignment notices name
the tutee, tutor and subject and explicitly say when the schedule awaits confirmation;
placeholder weekdays/times are not published as confirmed appointments.
Admission-recovery notices use the immutable plan's captured applicant name and
distinguish a proposed withdrawal from an applied or declined one; recovery reasons
and graph evidence are excluded.
The database trigger promotes the validated detail only for explicitly allowlisted
domain events, as `emailDetail`. Message email uses only its selected sender name;
announcement email uses its title and publication/update action, never either full
body. These two events construct email copy from separate typed fields rather than
promoting an arbitrary description. Account-change email uses allowlisted field
identities: password versus two-factor enabled/disabled, and the particular profile
or access change. It never includes passwords, codes, addresses or entire account rows.
The tables below document fallback copy; captured descriptions can be more specific.

### Category preferences and upcoming reminders

The shared **Notification preferences** card is available to staff, tutors and tutees
through their account settings. Each category has separate unread-badge and optional
email controls. The exhaustive [category mapping](../../src/lib/notification-categories.ts)
is shared by settings, badge queries and delivery; the migration's SQL classification
is checked against it by integration tests.

Admin/Head may lock either channel on for individual categories; reminders have no
badge channel. A lock overrides a saved personal off choice without replacing it.
It applies to badge counts and to optional-email enqueue and dispatch. Email locks
retain the program availability, verified-address and recipient-eligibility gates,
including active Admin/Head review access. They neither select secondary recipients
nor turn an intentionally in-app-only event into email.

| Category | Examples | Bell badge | Optional email |
| --- | --- | --- | --- |
| Private messages | A message from a named sender | Configurable | Configurable |
| Review requests | Pending decisions for eligible staff reviewers | Configurable | Active Admin/Head only |
| Applications and interviews | Applications, qualifications, panel assignments and interview outcomes | Configurable | Configurable |
| Tutoring | Assignments, availability, request lifecycle, schedule changes and withdrawals | Configurable | Configurable |
| Attendance and feedback | Lesson attendance, cards, appeals, feedback and corrections | Configurable | Configurable |
| Membership | Tutor/Crew participation changes and school departure | Configurable | Configurable |
| Account updates | Optional profile, access and account-appeal updates | Configurable for bell notices | Configurable; essential security mail is separate |
| Announcements | Published or updated announcement titles | Configurable | Configurable |
| Management updates | Management outcomes and translation updates | Configurable | Configurable |
| General program updates | Unclassified legacy and general program notices | Configurable | Configurable |
| Upcoming reminders | Interviews, meetings and confirmed tutoring | Email only | Configurable |

Disabling a badge category **does not hide notifications or mark them read**. The list
still shows all recent notices, including their original unread styling. Mark all read
continues to work when only muted unread notices remain. Re-enabling a badge category
counts its still-unread notices again. Saving badge preferences is allowed while
optional program email is disabled. The global switch still gates optional email;
it does not alter personal badge choices or required mail.

New notices record their category at insertion so later role changes cannot reclassify
their history. Migration classifies older bell records from their existing event/link
and available recipient role; old email rows retain their recorded reviewer/participant
transport distinction. A sparse `NotificationPreference` override inherits the old
email setting until explicitly changed: messages, review requests and reminders keep
their respective switches; the other categories inherit information updates. New
accounts start with badge categories enabled and optional email off. Legacy broad
settings only propagate switches whose values actually change, preserving unrelated
category overrides when an old client submits an unchanged value.

Only active Admin/Head accounts can enable reviewer email, and Head-only events keep
their narrower authority. Participant copies of a pending workflow event keep their
domain category. Dispatch rechecks recipient eligibility, category preferences and
verified address ownership. Unsubscribe disables the delivery's exact unlocked
category or all unlocked optional categories, without changing badge settings or
locked personal choices. A locked linked category is explained on the confirmation
page; stopping all still permits other categories to be disabled. An intentionally in-app-only
event, such as a room-allocation shortage, still does not produce email merely because
its category's email preference is enabled.

The migration retains old delivery evidence and skips pending reviewer mail rather
than replaying a backlog under the new opt-in. Existing notices without captured facts
retain readable fallback copy; no migration invents details from current records.

Reminders cover scheduled interviews, meetings and confirmed tutoring at 24 hours
and 1 hour before the actual occurrence. Published tutoring uses the current dated
cohort, its captured timezone and its participating roster, including agreed extras
and reschedules. A published original date never falls back to its superseded weekly
time after a move or cancellation. Unpublished recurring assignments use the school
date's effective timetable weekday, including mapped school days.
Each threshold has a ten-minute lateness allowance; prolonged downtime does not send
both notices together or reminders after the event starts. A unique durable delivery
key prevents ordinary repeated/concurrent sweeps from creating duplicate mail.
Publishing a regular session at the same instant retains its weekly reminder receipt:
unsent snapshots may be refreshed, while an accepted message is not sent again.
Dispatch revalidates the source and audience, so deleted/rescheduled events or newly
ineligible participants do not receive stale reminders. SMTP acceptance still cannot
provide an exactly-once guarantee after a process crash.
Each worker tick drains serial batches for up to 20 seconds or 1,000 rows, keeping
the existing queue order. An in-flight SMTP attempt can finish beyond that budget;
slow transport or a prolonged outage can still exhaust a reminder's lateness window.

Tutoring reminders require an active term, confirmed schedule and active participants.
Ordinary recurring occurrences respect optional term bounds and are suppressed by
active inclusive **No tutoring** date ranges and explicit non-school days. Confirmed
dated exceptions admitted through [affirmative agreement](session-planning.md#tutoring-pauses-and-affirmative-exceptions)
from the tutor and every participating tutee may receive reminders during
**Pause regular tutoring** or on non-school days (already-confirmed extras retained
across a tutoring pause also remain eligible on school days); an overlapping legacy
**Notice only** (`NOTICE`) range still suppresses them. Recorded tutor or assigned-tutee absence
suppresses the whole tutoring occurrence, including queued reminders. Missing
attendance is not absence; future absence cannot be inferred from an unrecorded plan.
These rules affect reminders only, never attendance or appeal-school-day calculations.
They also leave essential proposal, outcome and publication notices independent of
optional reminder preferences; suppressing a reminder does not cancel an agreed session.
Ambiguous/nonexistent local times during daylight-saving transitions are skipped.
Interview applicants without an eligible account are not enrolled in optional mail.

### Required email and captured detail

Required security, verification, recovery, requested invitation and request-service
mail is not optional; its sender identity (`SECURITY` or `PROGRAM`) does not determine
whether it is optional. Verification and invitation emails identify their operation
or audience and expiry. Historical invitations describe the reviewed profile types
and counts while keeping private attendance records in the portal. Existing request
status email retains its mailbox-proof rule for disclosing private reasons.

Domain details identify the affected people and recorded facts: attendance dates,
subjects and status/room changes; added/removed availability; approved qualifications
and levels; withdrawal periods; and safe before/after fields in management proposals.
Proposed changes remain labelled as proposed. Details are captured at the write and
are not reconstructed from today's mutable records when an old notification is read.

Destinations identify the existing authorized workflow, not an access grant. Email
uses the canonical public origin and a validated sign-in callback; current route
permissions still apply. Detailed staff mail and reviewer requests are skipped after
the recipient loses the required authority. Generic legacy mail whose /admin
destination is no longer accessible falls back to /. Unknown
email events and account-change events use /my-account. In-app links retain the original
recorded destination. See [URL handling](../../src/server/email/urls.ts).

**Survey request audience** includes eligible managers, the explicit retained
tutee owner (otherwise the linked student account), and accounts linked to that tutee's
assigned tutors. [notifyRequest](../../src/server/student-request-state.ts) directs
Admin/Head to /admin/requests, the owner/request-email branch to /student, and remaining
tutors to /dashboard. A matching email alone does not add a recipient.
**Legacy review audience** includes eligible managers, the review requester and
the account linked to the legacy tutee; [notifyLegacySchedule](../../src/server/student-workflow.ts)
directs managers to /admin/requests, linked tutors to /dashboard, and others to /student.
For these two audiences, pending review events select active, unmerged Admins with Head fallback; outcomes include all active, unmerged Admin/Head. Pending management and membership review notices go to eligible active, unmerged Admins, with Head fallback when none can review. Requester exclusions are applied before choosing the fallback; only current Head can review their own management proposal. Head retains review permission regardless of notification delivery. Official refresh review remains Head-only. Outcomes and operational alerts keep their documented audiences.

The scheduled-interview event records an actual date/time/timezone. Tutoring
assignment events describe recurring weekly arrangements and confirmation state;
they do not invent a next-session date. School-calendar events separately name the
actual school date and resolved timetable; they do not promise an individual dated
tutoring session or write to an external calendar provider.
Optional reminder emails derive dated occurrences only from confirmed schedules.
Account authentication, signup confirmation and request-invalidity service mail use
separate direct/essential flows and are not silently reclassified as optional events.

New panel-assignment and interview-time notices open the tutor's personal interview
work in `/schedule#tutor-interviews`. A chair can follow its appointment back to
the retained dashboard chair workspace. Essential dated-tutoring notices use
`/schedule#sessions` for tutors; the tutee destination remains
`/student?view=schedule#sessions`. Existing in-app records retain their recorded
destinations, including older dashboard links; those legacy schedule fragments
offer an explicit Schedule continuation without unmounting a live dashboard editor.

**School-calendar audience** means eligible active tutors and tutees with confirmed,
populated active-period pairings on the union of the actual date's civil weekday,
prior mapped weekday and new mapped weekday. Retained tutee ownership is included;
suspended, merged, departed and inactive participants are excluded. Still-eligible
prior recipients receive corrections. The [dated-session adapter](../../src/server/school-calendar-session-audience.ts)
also includes current eligible participants from actual scheduled cohorts, including
agreed extras and reschedules on a closed date; cancelled or moved-away participants
are excluded from that date. Calendar events use optional information email and normal verified
address, program-switch and personal-preference gates.

[Calendar emitters](../../src/server/school-calendar-notifications.ts) use stable
date/semantic-revision/phase/recipient notification IDs. A lookup under the date's
source lock also recognizes an existing phase/date/revision receipt moved to a
surviving account, preserving its historical ID instead of repeating the notice.
Notes change the editor version without advancing the semantic revision or
repeating a notice. Applied
changes invalidate superseded pending/failed email; dispatch rechecks the source
revision, resolved state, recipient eligibility and reminder window. Sent and in-app
records remain historical evidence. These checks cannot recall SMTP already
accepted and do not guarantee exactly-once transport. There are no provider-calendar
writes.

### Reviewer notification reconciliation

After the policy rollout, Admin/Head use **Management Actions → Refresh reviewer notifications** to append missing current-reviewer notices. `notification.reconcileManagementReviews` returns pending requests inspected and notices added across Management Actions, Tutor/Crew membership requests and Crew applications. Repeated calls serialize and preserve existing deliveries; no request evidence or decision changes. Current requester and membership state are checked before delivery. Authoritative role/membership/succession changes also reconcile the queue. Reads remain read-only.

New membership and Crew application notices identify their source in a canonical
fragment. An older queue-wide notice has no reliable source identity and is retained;
one source-specific notice may accompany it, with later runs deduplicated. Crew
source links reveal the review panel even when another panel was remembered, then
focus the loaded authorized row. Background refresh does not repeatedly move focus.

### Record arrivals and scroll ownership

Validated request/application record links and school-calendar date links in the bell disable Next's default page
scroll for that navigation. The authorized destination first selects its required
panel and filters, then reveals and focuses the committed record in its native
scroll container. A delayed read or mount must not consume the arrival before the
record exists. Incoming fragments take precedence over remembered page position;
ordinary notification destinations retain normal navigation. Once revealed, later
scrolling belongs to the user. A new location, access denial or intervening user
gesture cancels an unfinished reveal; it must not pull the user back later.

School-calendar links use `/dashboard#school-calendar/YYYY-MM-DD` or
`/student#school-calendar/YYYY-MM-DD`. The participant adapter reads that exact
validated date, including dates outside the ordinary fourteen-day notice window.
It shows current authoritative facts or restored weekday/weekend defaults after a
reset, without staff notes. A deliberate repeated click reveals the date again;
paired Back/Forward events and background refreshes do not steal focus.

At desktop management widths, the actual scrollable `#admin-content` pane owns
record positioning. Revealing a child must not chain a second scroll into the
outer document and move the global header. Mobile retains document scrolling.
The adapter uses current pane/target geometry and native pane clamping, without
changing shell overflow rules or resetting a user's outer document position.
For a different managed fragment on the same page, the bell adds the normal
history entry with the existing history state and dispatches `hashchange` without
invoking a second native fragment scroll. This source-derived companion prevents
the same ancestor-chain competition; ordinary fragment behavior is unchanged.

Appeal-pending copy points to the linked request without naming a particular
dialog: legacy invalidity review and current signup review retain their own
authorized decision interfaces and policy rules.

## Supported events

### primary_changed

- Recipient: Affected account; previous verified primary also receives a security copy.
- Trigger: User.email actually changes (account-update database trigger). [Emitter](../../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Primary Email Changed | Your primary account email was updated. Review your account settings to confirm. | Review your account |
| 中文 | 主邮箱已更改 | 你的账号主邮箱已更新。请查看账号设置确认。 | 查看账号 |

### secondary_added

- Recipient: Affected account.
- Trigger: Successful verification/claim of a secondary address; email-only raw queue call. [Emitter](../../src/server/auth/account-emails.ts).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Secondary Email Verified | A secondary email was verified on your account. Check your email settings if needed. | Review your account |
| 中文 | 备用邮箱已验证 | 你的账号已验证一个备用邮箱。如需确认请查看邮箱设置。 | 查看账号 |

### secondary_removed

- Recipient: Affected account.
- Trigger: Removal of its verified secondary address; email-only raw queue call. [Emitter](../../src/server/auth/account-emails.ts).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Secondary Email Removed | A secondary email was removed from your account. Check your email settings if needed. | Review your account |
| 中文 | 备用邮箱已移除 | 你的账号已移除一个备用邮箱。如需确认请查看邮箱设置。 | 查看账号 |

### security_changed

- Recipient: Affected account.
- Trigger: Password hash or two-factor enabled state changes (account-update database trigger). [Emitter](../../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Security Changed | Your password or two-factor verification settings were updated. Review your account security settings. | Review your account |
| 中文 | 账号安全设置已更改 | 你的密码或双重验证设置已更新。请查看账号安全设置。 | 查看账号 |

### information_changed

- Recipient: Affected account.
- Trigger: Name, alternative names, role or suspended state changes (account-update database trigger). [Emitter](../../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Information Updated | Your account details or access were updated. Open Account Settings to review. | Review your account |
| 中文 | 账号信息已更新 | 你的账号信息或权限已更新。请前往账号设置查看。 | 查看账号 |

### message_received

- Recipient: Each explicitly selected message recipient.
- Trigger: A private-message send commits separate recipient deliveries. [Emitter](../../src/server/api/routers/messaging.ts).
- Authorized destination: /messages.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Private Message | You have a new private message. Open your inbox to read it and reply. | Open your inbox |
| 中文 | 新的私信 | 你收到一条新私信。请打开收件箱阅读并回复。 | 打开收件箱 |

### program_update

- Recipient: The original notification recipient.
- Trigger: Fallback for an in-app insert without event, or unknown event email copy; no dedicated domain action. [Emitter](../../prisma/migrations/20261014010000_notification_events/migration.sql).
- Authorized destination: Original validated destination; unknown event email uses /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Program Update | You have a new program update. Open the site to view details. | View program update |
| 中文 | 项目通知 | 你有一条新的项目通知。请打开网站查看详情。 | 查看项目通知 |

### tutor_application_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: First accepted distinct public tutor application commits. [Emitter](../../src/server/api/routers/application.ts).
- Authorized destination: /admin/applications.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Tutor Application | A new tutor application is ready for review. | Review tutor applications |
| 中文 | 新的辅导伙伴申请 | 有一份新的辅导伙伴申请等待审核。 | 查看辅导伙伴申请 |

### qualification_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Tutor submits an additional-subject or higher-level qualification application. [Emitter](../../src/server/api/routers/qualification-application.ts).
- Authorized destination: /admin/applications#application-{requestId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Additional Qualification Request | A tutor requested an additional subject or level. | Review qualification request |
| 中文 | 新增资格申请 | 一位辅导伙伴申请新增科目或等级资格。 | 查看资格申请 |

### qualification_approved

- Recipient: Account linked to the requesting tutor.
- Trigger: An additional qualification decision approves the request. [Emitter](../../src/server/qualification-applications.ts).
- Authorized destination: /dashboard#qualification-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Qualification Request Approved | Your additional qualification request was approved. Review the updated qualifications on your dashboard. | View qualifications |
| 中文 | 资格申请已批准 | 你的新增资格申请已批准。请在工作台查看更新后的资格。 | 查看资格 |

### qualification_rejected

- Recipient: Account linked to the requesting tutor.
- Trigger: An additional qualification decision rejects the request. [Emitter](../../src/server/qualification-applications.ts).
- Authorized destination: /dashboard#qualification-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Qualification Request Declined | Your additional qualification request was declined. Review the decision in your request history. | Review qualification decision |
| 中文 | 资格申请未通过 | 你的新增资格申请未通过。请在申请记录中查看决定。 | 查看资格决定 |

### crew_application_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Mailbox verification commits the first pending Crew application. [Emitter](../../src/server/crew/signup.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Crew Application | A new crew application is ready for review. | Review crew applications |
| 中文 | 新的巡查队申请 | 有一份新的巡查队申请等待审核。 | 查看巡查队申请 |

### viewer_registered

- Recipient: Active Admin/Head.
- Trigger: Viewer invitation redemption registers the new read-only Viewer. [Emitter](../../src/server/auth/account-invitations.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Viewer Account | A new viewer account was registered. Review its read-only access in Users & Roles. | Review users and roles |
| 中文 | 新的观察员账号 | 一个新的观察员账号已注册。请在用户与角色中查看其只读权限。 | 查看用户与角色 |

### tutor_setup_needed

- Recipient: All active, unmerged Admin and Head accounts, subject to the emitter’s actor exclusion.
- Trigger: Management adds an unlinked tutor with no login. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Account Setup Needed | A tutor was added without a login account. Open Users & Roles to send a setup link. | Review account setup |
| 中文 | 辅导伙伴需要设置账号 | 一位新辅导伙伴尚无登录账号，请前往用户与角色发送设置链接。 | 查看账号设置 |

### interview_panel_assigned

- Recipient: Accounts linked to assigned panel tutors.
- Trigger: Management commits interview-panel assignment. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /schedule#tutor-interviews.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Interview Panel Assignment | You were assigned to an interview panel. Check Schedule to review the application and coordinate the interview time. | View interview panel |
| 中文 | 已分配面试小组 | 你已被分配至面试小组。请前往日程查看申请并协调面试时间。 | 查看面试小组 |

### interview_scheduled

- Recipient: Accounts linked to panel tutors other than the scheduling chair.
- Trigger: Chair sets a non-null interview time; repeated setting/rescheduling uses the same event. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /schedule#tutor-interviews.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Interview Scheduled | An interview has been scheduled. Check Schedule for the time and details. | View interview |
| 中文 | 面试时间已确定 | 已安排一场面试。请在日程中查看时间和详情。 | 查看面试 |

### interview_approved

- Recipient: All active, unmerged Admin and Head accounts, including the chair when eligible.
- Trigger: A chair’s combined interview acceptance and service-hour recording commits successfully. Exact retries do not emit again. Initial and interviewed qualification applications use the same event.
- Delivery: In-app only; no optional email copy.
- Authorized destination: /admin/applications#application-{applicationId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Interview Approved | The interview chair approved the interview and recorded panel hours. Open the application to view the outcome. | View application |
| 中文 | 面试已通过 | 面试组长已批准此次面试并记录面试小组服务时数。请查看申请结果。 | 查看申请 |

### management_review_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Ordinary management proposal is queued; live change remains unapplied. [Emitter](../../src/server/approvals.ts).
- Authorized destination: /admin/approvals?request={proposalId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Awaiting Review | A proposed management change is waiting for your approval before it takes effect. | Review management change |
| 中文 | 管理变更待审核 | 有一项管理变更提案正等待审核，批准后才会生效。 | 查看管理变更 |

### scheduled_refresh_completed

- Recipient: Active, unmerged Admins and Head.
- Trigger: Scheduled refresh and its terminal outcome commit together. Repeated worker ticks do not duplicate this notice. [Emitter](../../src/server/program/scheduled-refresh.ts).
- Authorized destination: /admin/program?panel=period.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Scheduled Program Refresh Completed | The scheduled program refresh completed. Check the active period and signup settings. | Review program settings |
| 中文 | 定时项目刷新已完成 | 定时项目刷新已完成。请核对当前周期与报名设置。 | 查看项目设置 |

### scheduled_refresh_blocked

- Recipient: Active, unmerged Admins and Head.
- Trigger: A periodic worker check detects review or authority drift, including before the scheduled time, or a refresh reaches five failed execution attempts. The notice commits with the schedule outcome once per authorization. [Emitter](../../src/server/program/scheduled-refresh.ts).
- Authorized destination: /admin/program?panel=period.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Scheduled Program Refresh Needs Review | The scheduled program refresh could not run. Review the settings and schedule it again. | Review refresh schedule |
| 中文 | 定时项目刷新需要审核 | 定时项目刷新未能执行。请核对设置后重新安排。 | 查看刷新计划 |

### management_head_review_pending

- Recipient: Active Head only.
- Trigger: An official-refresh management proposal is queued; live change remains unapplied. [Emitter](../../src/server/approvals.ts).
- Authorized destination: /admin/approvals?request={proposalId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Awaiting Head Review | A proposed management change needs Head approval before it takes effect. | Review management change |
| 中文 | 管理变更待负责人审核 | 有一项管理变更提案需要负责人批准后才会生效。 | 查看管理变更 |

### management_approved

- Recipient: Proposal requester, if that account still exists.
- Trigger: Approval applies the underlying management action in the decision transaction. [Emitter](../../src/server/api/routers/approval.ts).
- Authorized destination: /admin/approvals?request={proposalId}; departure proposals use /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Approved | Your management change proposal was approved and applied. | Review decision |
| 中文 | 管理变更已批准 | 你的管理变更提案已通过并生效。 | 查看决定 |

### management_rejected

- Recipient: Proposal requester, if that account still exists.
- Trigger: Reviewer rejects the proposal without applying its underlying action. [Emitter](../../src/server/api/routers/approval.ts).
- Authorized destination: /admin/approvals?request={proposalId}; departure proposals use /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Declined | Your management change proposal was declined and no changes were made. | Review decision |
| 中文 | 管理变更未通过 | 你的管理变更提案未通过，未作任何更改。 | 查看决定 |

### translation_review_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Translation draft submission commits for review. [Emitter](../../src/server/translation-drafts.ts).
- Authorized destination: /localization?view=review.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Translation Awaiting Review | A translation draft is waiting for review. | Review translation |
| 中文 | 翻译待审核 | 有一份翻译草稿等待审核。 | 查看翻译 |

### announcement_published

- Recipient: Selected linked tutor accounts plus management/Viewer oversight accounts; publisher excluded.
- Trigger: Announcement publication freezes the tutor audience; edits/restoration do not emit anew. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: Selected tutors: /dashboard; oversight: /admin/announcements (email role fallback applies).

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Program Announcement | A new program announcement was published. Open it to read and acknowledge if needed. | Read announcement |
| 中文 | 新的项目公告 | 项目发布了新公告。请打开阅读，如有需要请确认已阅。 | 阅读公告 |

### tutor_optout_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Tutor membership opt-out request is created, awaiting cooldown/review. [Emitter](../../src/server/membership.ts).
- Authorized destination: /admin/tutor-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Opt-Out Request Awaiting Review | A tutor requested to opt out. Their participation stays active until approved after the cooldown. | Review tutor requests |
| 中文 | 辅导伙伴退出申请待审核 | 一位辅导伙伴申请退出。冷静期结束并获批前，其参与状态保持不变。 | 查看辅导伙伴申请 |

### tutor_reentry_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Tutor membership reentry request is created. [Emitter](../../src/server/membership.ts).
- Authorized destination: /admin/tutor-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Reentry Request Awaiting Review | A tutor requested to rejoin. | Review tutor requests |
| 中文 | 辅导伙伴重新加入申请待审核 | 一位辅导伙伴申请重新加入。 | 查看辅导伙伴申请 |

### crew_optout_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Crew membership opt-out request is created, awaiting cooldown/review. [Emitter](../../src/server/membership.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Crew Opt-Out Request | A crew member requested to opt out. It can be reviewed after the cooldown. | Review crew request |
| 中文 | 巡查成员退出申请待审核 | 一位巡查成员申请退出。冷静期结束后可审核。 | 查看巡查队申请 |

### crew_reentry_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Crew membership reentry request is created. [Emitter](../../src/server/membership.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Crew Reentry Request | A crew member requested to rejoin. | Review crew request |
| 中文 | 巡查成员重新加入申请待审核 | 一位巡查成员申请重新加入巡查队。 | 查看巡查队申请 |

### membership_optout_approved

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision approves an opt-out after the required cooldown. [Emitter](../../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Opt-Out Approved | Your opt-out request was approved. | View participation |
| 中文 | 退出申请已批准 | 你的退出申请已通过。 | 查看参与状态 |

### membership_reentry_approved

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision approves reentry and restores active membership. [Emitter](../../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Reentry Approved | Your reentry request was approved. You are active again. | Open your workspace |
| 中文 | 重新加入申请已批准 | 你的重新加入申请已通过，你已恢复参与。 | 打开工作区 |

### membership_declined

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision declines opt-out or reentry. [Emitter](../../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Participation Request Declined | Your participation request was declined. | Review participation decision |
| 中文 | 参与变更申请未通过 | 你的参与变更申请未通过。 | 查看参与决定 |

### tutee_optout_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Tutor relays a tutee opt-out with its existing automatic-approval cooldown. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutee-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Opt-Out Awaiting Review | A tutor relayed a tutee opt-out request. It will auto-approve after the cooldown unless cancelled. | Review tutee requests |
| 中文 | 学习伙伴退出申请待审核 | 一位辅导伙伴转达了学习伙伴的退出申请。如未取消，冷静期结束后将自动生效。 | 查看学习伙伴申请 |

### tutee_optout_cancelled

- Recipient: Account linked to the tutor on the relay's pairing.
- Trigger: Management cancels a still-pending tutor-relayed tutee opt-out. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Opt-Out Cancelled | Management cancelled a tutee opt-out request. | Review assignment |
| 中文 | 学习伙伴退出申请已取消 | 管理人员取消了一项学习伙伴退出申请。 | 查看辅导安排 |

### tutee_removed

- Recipient: Linked accounts of affected paired tutors and active Admin/Head.
- Trigger: Removal is finalized, preserving history and removing current roster/assignment state. [Emitter](../../src/server/discipline/removal.ts).
- Authorized destination: Tutors: /dashboard; managers: /admin/tutee-requests.
- Audience overlap is consolidated: an affected tutor who is also an eligible Admin/Head receives one notice with the management destination. Multiple affected pairings do not add copies.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Removed from Current Roster | A tutee was removed from the current roster. | Review roster update |
| 中文 | 学习伙伴已移出当前名单 | 一位学习伙伴已移出本期名单。 | 查看名单更新 |

### attendance_cards_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Attendance survey commits one or more disciplinary-card requests; count records submitted requests. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/discipline.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Discipline Cards Awaiting Review | {count, plural, one {# discipline card request} other {# discipline card requests}} awaiting review. | Review discipline cards |
| 中文 | 纪律卡申请待审核 | 有 {count} 项纪律卡申请等待审核。 | 查看纪律卡申请 |

Without a recorded count: An attendance survey submitted discipline card requests. Review each request before issuing a card. / 一份出勤问卷提交了纪律卡申请。发卡前请逐项审核。

### attendance_room_reported

- Recipient: Active Admin/Head.
- Trigger: Attendance submission reports use of a room reserved by another pairing in that term or blocked by recurring room unavailability. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/attendance.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Room Conflict in Attendance | Attendance was logged in a room that is booked elsewhere or blocked. | Review attendance |
| 中文 | 出勤记录存在教室冲突 | 有出勤记录使用了已被占用或禁用的教室。 | 查看出勤 |

### attendance_review_warning

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with WARN. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Warning Recorded | A warning was recorded for an attendance review. | Review attendance decision |
| 中文 | 出勤警告已记录 | 出勤审核已记录一次警告。 | 查看出勤决定 |

### attendance_review_penalty

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with PENALIZE and applies service-hour deduction. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Penalty Applied | A service-hour deduction was applied after an attendance review. | Review attendance decision |
| 中文 | 出勤审核已应用时数扣减 | 出勤审核已扣减服务时数。 | 查看出勤决定 |

### attendance_review_escalated

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with ESCALATE. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Flag Escalated for Review | An attendance flag was escalated for further review. No penalty has been applied yet. | Review attendance decision |
| 中文 | 出勤标记已提交进一步审核 | 一项出勤标记已提交进一步审核，暂未应用扣减。 | 查看出勤决定 |

### attendance_history_updated

- Recipient: All active, unmerged Admin and Head accounts, subject to the emitter’s actor exclusion.
- Trigger: Catalogue clock propagation changes recorded teaching blocks and reconsiders flags/deductions; count is changed blocks. [Emitter](../../src/server/attendance-schedule.ts).
- Authorized destination: /admin/audit.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Historical Attendance Updated | A time-slot update changed {count, plural, one {# past session} other {# past sessions}}. Related flags and deductions were updated. | Review audit evidence |
| 中文 | 历史出勤已更新 | 时段调整更新了 {count} 个历史辅导时段，相关出勤标记与扣减已更新。 | 查看审计依据 |

Without a recorded count: A catalogue change updated historical teaching blocks. Related attendance flags and deductions were reconsidered; review the audit evidence. / 一项目录变更更新了历史辅导时段。相关出勤标记和扣减已重新审查；请查看审计依据。

### account_suspended

- Recipient: Affected account.
- Trigger: Management applies account suspension. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /suspended.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Suspended | Your account is suspended. Open the suspension page to submit an appeal. | Review suspension |
| 中文 | 账号已暂停 | 你的账号已暂停，可前往暂停页面提交申诉。 | 查看暂停状态 |

### account_reinstated

- Recipient: Affected account.
- Trigger: Management applies account reinstatement. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Reinstated | Your account is active again. | Open your workspace |
| 中文 | 账号已恢复 | 你的账号已恢复使用。 | 打开工作区 |

### account_appeal_requested

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: A suspended account submits an account reinstatement appeal. [Emitter](../../src/server/api/routers/account.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Awaiting Review | A suspended account submitted an appeal. | Review account appeal |
| 中文 | 账号申诉待审核 | 一个已暂停账号提交了申诉。 | 查看账号申诉 |

### account_appeal_approved

- Recipient: Appealing account.
- Trigger: Management approves the currently reviewed account appeal and co-resolves that account's pending appeals. Suspended accounts regain access; already-active accounts close the appeals with access unchanged. Earlier terminal appeals remain unchanged. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Approved | Your appeal was approved and your account is active again. | Open your workspace |
| 中文 | 账号申诉已批准 | 你的申诉已通过，账号已恢复使用。 | 打开工作区 |

The already-active branch captures one truthful outcome instead: **All pending
account appeals were approved. Your account was already active; access was unchanged.**
Its Chinese description records the same closure without a repeated restoration.
In-app detail and any eligible detailed email use that captured outcome.

### account_appeal_declined

- Recipient: Appealing account.
- Trigger: Management denies account appeal. [Emitter](../../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Declined | Your appeal was declined and your account stays suspended. | Review appeal decision |
| 中文 | 账号申诉未通过 | 你的申诉未通过，账号仍处于暂停状态。 | 查看申诉决定 |

### record_corrected

- Recipient: All active, unmerged Admin and Head accounts, subject to the emitter’s actor exclusion.
- Trigger: Management attendance or patrol correction commits. [Emitter](../../src/server/api/routers/corrections.ts).
- Authorized destination: /admin/audit.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Record Correction Applied | Management corrected a record. View the details in the audit log. | Review audit evidence |
| 中文 | 管理记录修正已应用 | 管理人员更正了一条记录，可在审计日志中查看详情。 | 查看审计依据 |

### tutee_feedback_received

- Recipient: Active Admin/Head.
- Trigger: Tutee submits or updates feedback on owned session attendance. [Emitter](../../src/server/api/routers/student.ts).
- Authorized destination: /student-support.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Tutee Feedback | A tutee submitted session feedback. | Review feedback |
| 中文 | 新的学习伙伴反馈 | 一位学习伙伴提交了辅导反馈。 | 查看反馈 |

### tutee_card_appeal

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: Tutee submits an appeal for an owned disciplinary card. [Emitter](../../src/server/api/routers/student.ts).
- Authorized destination: /student-support.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Card Appeal Awaiting Review | A tutee appealed a discipline card. | Review card appeal |
| 中文 | 学习伙伴纪律卡申诉待审核 | 一位学习伙伴对纪律卡提出了申诉。 | 查看纪律卡申诉 |

### tutee_appeal_reviewed

- Recipient: Explicit retained history owner, otherwise the account linked to the tutee.
- Trigger: Management reviews a tutee disciplinary-card appeal. [Emitter](../../src/server/api/routers/student.ts).
- Authorized destination: /student.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Appeal Reviewed | Your discipline card appeal was reviewed. Open your workspace to see the decision. | Review appeal decision |
| 中文 | 学习伙伴申诉已审核 | 你的纪律卡申诉已完成审核，请前往工作区查看结果。 | 查看申诉决定 |

### student_assignment_updated

- Recipient: Survey request audience; legacy direct assignment also notifies the linked tutee account.
- Trigger: Management applies tutor assignment to a request or legacy roster tutee. [Emitter](../../src/server/student-workflow.ts).
- Legacy direct-assignment emitter: [admin router](../../src/server/api/routers/admin.ts).
- Authorized destination: Request audience destinations; legacy direct account: /student.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutoring Assignment Updated | Your weekly tutoring schedule was updated. Open your workspace to check the new details. | Review tutoring assignment |
| 中文 | 辅导安排已更新 | 你的每周辅导安排已更新，请前往主页查看最新详情。 | 查看辅导安排 |

### student_continuation_released

- Recipient: Active Admin/Head plus the linked tutor, student and retained request owner; overlapping management/participant accounts receive one notice.
- Trigger: A tracked continued assignment is released after tutor availability, the original time or its source assignment changes. Existing signup demand and attendance remain retained. [Emitter](../../src/server/student-continuation-assignment.ts).
- Authorized destination: Managers: the exact retained survey request in /admin/requests; tutor: /dashboard; student/request owner: /student.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Continued Tutoring Assignment Released | A continued tutoring assignment was released after availability changed. Your signup request stays open for reassignment. | Review retained signup request |
| 中文 | 延续辅导分配已解除 | 由于可用时间变化，延续的辅导分配已解除，报名申请仍保留等待重新安排。 | 查看保留的报名申请 |

### recovery_workflow_draft

- Recipient: The exact recorded owner of a compensating signup draft, subject to current source ownership and account access.
- Trigger: A reviewed recovery transaction prepares a fresh draft; the original request stays closed. [Emitter](../../src/server/recovery/workflow-draft.ts).
- Delivery: In-app only; no optional email or replay of earlier delivery.
- Authorized destination: The authenticated /signup?recoveryDraft=... draft. A new submission, current policy agreement and mailbox verification remain required. Answers, contacts, signatures, codes and review reasons stay out of notification context.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Review a Fresh Signup Draft | Staff prepared a draft signup for you to review. Check the details, accept the policy, and confirm your email to submit. | Review signup draft |
| 中文 | 请审核新的报名草稿 | 管理人员已为你准备好报名草稿，请核对信息、同意政策并验证邮箱后提交。 | 审核报名草稿 |

### student_availability_updated

- Recipient: Survey request audience.
- Trigger: Owned student request availability actually changes. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Availability Updated | A tutee updated their available times. | Review availability |
| 中文 | 学习伙伴可用时间已更新 | 一位学习伙伴更新了可用时段。 | 查看可用时间 |

### student_request_recalled

- Recipient: Survey request audience.
- Trigger: Student recalls an unassigned request, closing it. [Emitter](../../src/server/student-request-state.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Signup Request Recalled | A signup request was recalled. Submit a new request if you want to join again. | Review request history |
| 中文 | 报名申请已撤回 | 报名申请已撤回。如需再次参与，请重新提交申请。 | 查看申请记录 |

### student_request_expired

- Recipient: Survey request audience.
- Trigger: Unverified request closes after its verification deadline. [Emitter](../../src/server/student-request-state.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Signup Verification Overdue | A signup request closed because email verification timed out. Submit a new request to reapply. | Review request history |
| 中文 | 报名验证逾期 | 报名申请因逾期未验证已关闭。如需参与，请重新提交申请。 | 查看申请记录 |

### student_withdrawal_pending

- Recipient: Eligible active Admin reviewers, with Head fallback; any separate participant notices retain their ownership rules.
- Trigger: Assigned student applies for current-period withdrawal, or the legacy withdrawal request commits. [Emitter](../../src/server/student-workflow.ts).
- Legacy account-owned withdrawal emitter: [legacy withdrawal](../../src/server/legacy-student-withdrawal.ts).
- Authorized destination: Request audience destinations; legacy pending: /admin/tutee-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Withdrawal Request Awaiting Review | A withdrawal request is awaiting review. Tutoring continues until it is approved. | Review withdrawal request |
| 中文 | 退出申请待审核 | 有一份退出申请等待审核，获批前原辅导继续进行。 | 查看退出申请 |

### student_withdrawal_approved

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review approves current-period withdrawal, closes participation and blocks that period's new intake. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Withdrawal Approved | Your withdrawal was approved and the request is closed. | Review withdrawal decision |
| 中文 | 退出申请已批准 | 你的退出申请已批准，当前申请已关闭。 | 查看退出决定 |

### student_withdrawal_declined

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review denies current-period withdrawal. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Withdrawal Declined | Your withdrawal request was declined. Your tutoring continues. | Review withdrawal decision |
| 中文 | 退出申请未通过 | 你的退出申请未通过，原辅导继续进行。 | 查看退出决定 |

### student_schedule_review_pending

- Recipient: Eligible active Admin reviewers, with Head fallback; any separate participant notices retain their ownership rules.
- Trigger: Assigned tutor reports a schedule conflict and requests review. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Schedule Conflict Awaiting Review | A tutor reported a schedule conflict for an assignment. | Review schedule conflict |
| 中文 | 辅导伙伴时间冲突待审核 | 一位辅导伙伴报告了辅导安排的时间冲突。 | 查看时间冲突 |

### student_schedule_review_approved

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review approves the tutor's conflict and detaches the affected assignment for rematching. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Schedule Conflict Approved; Rematching Needed | A schedule conflict was approved and the assignment was removed. Open the request to arrange a new match. | Review rematching request |
| 中文 | 时间冲突申请已批准，待重新匹配 | 时间冲突申请已通过，相关安排已移除，请重新匹配。 | 查看重新匹配申请 |

### student_schedule_review_declined

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review denies the tutor's conflict; assignment is unchanged. [Emitter](../../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Schedule Conflict Declined | A schedule conflict request was declined. The current assignment stays in place. | Review schedule decision |
| 中文 | 时间冲突申请未通过 | 时间冲突申请未通过，原安排保持不变。 | 查看时间安排决定 |

### tutor_reactivated

- Recipient: Active Admin/Head.
- Trigger: Pending tutor chooses available during start-of-term activation. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutors.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Participation Reactivated | A tutor became available for this term. | Review tutor roster |
| 中文 | 辅导伙伴参与状态已恢复 | 一位辅导伙伴已恢复本周期参与。 | 查看辅导伙伴名单 |

### tutor_opted_out

- Recipient: Active Admin/Head.
- Trigger: Pending tutor chooses unavailable during start-of-term activation. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutors.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Opted Out for This Term | A tutor opted out for this term. | Review tutor roster |
| 中文 | 辅导伙伴已退出本学期 | 一位辅导伙伴已退出本周期。 | 查看辅导伙伴名单 |

### meeting_absence_excused

- Recipient: Active Admin/Head.
- Trigger: Active tutor records an excused meeting absence before the cutoff. [Emitter](../../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/meetings.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Meeting Absence Excused | A tutor excused themselves from an upcoming meeting. Open Meetings to view details. | Review meeting attendance |
| 中文 | 辅导伙伴会议请假已记录 | 一位辅导伙伴提交了即将举行会议的请假，请前往会议页面查看详情。 | 查看会议出席 |

### school_departure_updated

- Recipient: Affected account.
- Trigger: Authorized school departure/return decision commits. [Emitter](../../src/server/school-departure.ts).
- Authorized destination: Eligible linked tutor: /settings; otherwise /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | School Participation Status Updated | Your school participation status was updated. Check your account for details. | Review school participation |
| 中文 | 在校参与状态已更新 | 你的在校参与状态已更新，请前往账号查看详情。 | 查看在校参与 |

### request_invalidity_appeal_pending

- Recipient: Eligible active Admin reviewers, with Head fallback (subject to the workflow’s requester exclusions).
- Trigger: First immutable appeal to a current applied request-invalidity flag commits. [Emitter](../../src/server/email/request-appeal.ts).
- Authorized destination: Tutor application: /admin/applications; survey/legacy signup: /admin/requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Invalid Request Appeal Awaiting Review | A submitter appealed an invalid-request flag. Review the appeal on the linked request. | Review invalid request appeal |
| 中文 | 无效申请申诉待审核 | 提交者对无效申请标记提出了申诉，请前往对应申请查看。 | 查看无效申请申诉 |

### school_calendar_changed

- Recipient: School-calendar audience, including eligible prior recipients.
- Trigger: Applied create/reactivation or resolved school-day/timetable change on today or a future date. Pending proposals and note-only edits emit nothing. [Emitter](../../src/server/school-calendar-notifications.ts).
- Authorized destination: Tutor dashboard or tutee workspace school-calendar context.
- Timing: Immediate, including same-day changes after the advance-reminder cutoff. A same-revision change receipt within the advance window also serves as that recipient's advance reminder.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | School Schedule Changed | The school schedule for {date} changed: {schedule}. Review your potentially affected tutoring sessions. | Review school schedule |
| 中文 | 学校课表已调整 | {date}的学校安排已调整：{schedule}。请查看可能受影响的辅导安排。 | 查看学校课表 |

### school_calendar_reset

- Recipient: School-calendar audience, including eligible prior recipients.
- Trigger: Applied reset restores weekday/weekend defaults on today or a future date while retaining the override tombstone. [Emitter](../../src/server/school-calendar-notifications.ts).
- Authorized destination: Tutor dashboard or tutee workspace school-calendar context.
- Timing: Immediate. Historical resets retain audit evidence without a new operational notice.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | School Schedule Restored | The school schedule for {date} returned to its default: {schedule}. Review your tutoring sessions. | Review school schedule |
| 中文 | 学校课表已恢复 | {date}的学校安排已恢复默认：{schedule}。请查看辅导安排。 | 查看学校课表 |

### school_calendar_upcoming

- Recipient: School-calendar audience for the active override, including eligible recipients of that revision's earlier change notice.
- Trigger: Existing notification worker rereads an active override under its calendar lock and records one advance reminder per semantic revision and recipient. [Emitter](../../src/server/school-calendar-notifications.ts).
- Authorized destination: Tutor dashboard or tutee workspace school-calendar context.
- Timing: From the prior school-local date at 18:00, inclusive, until noon on the actual date, exclusive. A change notice already issued to that recipient in the same window and revision suppresses the duplicate advance phase; earlier announcements still receive it. School timezone wall clocks, rather than 24 elapsed hours, define the window.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Upcoming School Schedule Override | Reminder for {date}: {schedule}. Review your potentially affected tutoring sessions. | Review school schedule |
| 中文 | 即将生效的学校课表调整 | {date}的安排提醒：{schedule}。请查看可能受影响的辅导安排。 | 查看学校课表 |

`{date}` is the actual date label, never shifted through a recipient timezone.
`{schedule}` is “No school / 不上课” or “Follows {weekday} timetable / 采用{weekday}课表”,
with the effective weekday localized by the shared formatter.

## Essential request-service notices

The separate request_service outbox uses request_invalid and request_cleared; these
are not optional account-event identities. Each applied invalid flag, clear and later
reflag queues one source/revision receipt to the recorded request address, with no
account or secondary copies. Their bilingual titles are “Your request is flagged invalid
/ 您的申请已标记为无效” and “Your request's invalid flag was cleared / 您的申请无效标记已解除”.
Unverified copy includes request kind and original submission date/time/timezone only;
request-specific mailbox proof permits the participant-facing reason. Invalid notices
link to “Appeal this decision / 对此决定提出申诉” at /request-appeal with the limited
90-day capability; clear notices link to “Contact the program / 联系项目团队” at /privacy.
See [the source copy](../../src/server/email/request-notice-copy.ts),
[staff procedure](../guides/user-guide.md#signup-request-tabs) and
[durable admission/appeal boundaries](technical-report.md#public-request-invalidity-notices-and-appeals).

### student_signup_rejected

- Recipient: Survey request audience.
- Trigger: Final rejection of a modern current-period signup appeal closes the request and removes active queue priority. [Emitter](../../src/server/student-request-state.ts).
- Authorized destination: Existing request-audience destinations. No appeal reason enters event context.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Invalid Request Closed | Your appeal was declined and this request is closed. You can submit a new request to rejoin the queue. | Review request history |
| 中文 | 无效申请已关闭 | 你的申诉未通过，当前申请已关闭。如需继续申请，可以重新提交报名。 | 查看申请记录 |

### interview_upcoming

- Recipient: Opted-in active interview panel accounts (including the chair) and the linked qualification applicant account. No accountless applicant email is inferred.
- Trigger: A still-undecided scheduled interview reaches either reminder threshold; effective Interviews feature must be enabled. [Emitter and preflight](../../src/server/email/event-reminders.ts).
- Authorized destination: /dashboard. Email only; no bell backlog.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Upcoming Interview | Your interview is coming up. Check the time and details. | View interview |
| 中文 | 面试即将开始 | 你的面试即将开始，请核对时间和详情。 | 查看面试 |

### meeting_upcoming

- Recipient: Opted-in active tutor accounts, excluding excused attendees.
- Trigger: An existing dated meeting reaches either reminder threshold; effective Meetings feature must be enabled. [Emitter and preflight](../../src/server/email/event-reminders.ts).
- Authorized destination: /dashboard. Email only.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Upcoming Meeting | Your meeting is coming up. Check the time and details. | View meeting |
| 中文 | 会议即将开始 | 你的会议即将开始，请核对时间和详情。 | 查看会议 |

### tutoring_upcoming

- Recipient: Opted-in assigned tutor and explicit current/retained tutee owners who can participate. Shared tutoring groups deduplicate their tutor notice; tutee copy omits peers' names.
- Trigger: A confirmed weekly arrangement reaches either reminder threshold, subject to the calendar, term, participation and absence checks above. [Emitter and preflight](../../src/server/email/event-reminders.ts).
- Authorized destination: Assigned tutor /dashboard; tutee /student. Email only.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Upcoming Tutoring Session | Your tutoring session is coming up. Check the time and details. | View tutoring session |
| 中文 | 辅导课程即将开始 | 你的辅导即将开始，请核对时间和详情。 | 查看辅导课程 |

### room_assignment_needed

- Recipient: Existing eligible staff room-allocation audience.
- Trigger: A confirmed tutoring arrangement has no available room. Captures tutor, subjects and confirmed weekly time. [Emitter](../../src/server/room-allocation.ts).
- Category: Tutoring. Authorized destination: `/admin/pairings#<encoded assignment ID>`. Intentionally in-app only.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Room Assignment Needed | A confirmed tutoring arrangement still needs a room. | Review room assignment |
| 中文 | 需要分配教室 | 已确认的辅导安排仍需分配教室。 | 查看教室分配 |
