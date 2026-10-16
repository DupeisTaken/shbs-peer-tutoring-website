# Notification event inventory

[Documentation home](README.md) · [User guide](user-guide.md#optional-email-notifications) · [Delivery implementation](technical-report.md#account-emails-and-delivery)

This inventory covers every identity supported by [notification-events.ts](../src/lib/notification-events.ts).
Recipients and triggers below follow the actual server emitters, including direct
notification inserts, helper fan-out, raw account-email queue calls and database
triggers. English and Chinese copy is transcribed from the maintained
[catalogues](../messages/en.json) ([Chinese](../messages/zh.json)); these are templates,
so allowed counts are substituted when available. A local generated inventory is a
review aid, not the source of authority.

## Delivery and access boundaries

New typed in-app notifications localize through the shared formatter. Email includes
both English and Chinese because no recipient email-language preference is saved.
Old in-app records retain their original title/body; an unknown email event uses the
safe generic program-update copy, never arbitrary stored titles or bodies.

The first five account-change events are **email-only**: they do not create in-app
notifications. Security events ignore optional email preferences. Information and
ordinary domain event email copies require the effective program switch and the
recipient's corresponding optional category. Optional copies use the verified primary
and enabled verified secondary addresses. The previous verified primary receives the
primary-change security exception. A listed in-app audience does not imply that every
account in it has opted into email.

Context is allowlisted on write and read, and again by the notification-email database
trigger. Only card-request/history-block counts and scheduled-interview ISO instant +
timezone are used. No private message, announcement, appeal/review text, original
answers, names, contacts or account secrets become event email context. Unknown counts
use the catalogue's count-free description.

Destinations identify the existing authorized workflow, not an access grant. Email
uses the canonical public origin and a validated sign-in callback; current route
permissions still apply. If an email destination begins with /admin and the account
is no longer Head/Admin/Coordinator (including Viewer), it falls back to /. Unknown
email events and account-change events use /my-account. In-app links retain the original
recorded destination. See [URL handling](../src/server/email/urls.ts).

**Survey request audience** means active, unmerged Admin/Head, the explicit retained
tutee owner (otherwise the linked student account), and accounts linked to that tutee's
assigned tutors. [notifyRequest](../src/server/student-request-state.ts) directs
Admin/Head to /admin/requests, the owner/request-email branch to /student, and remaining
tutors to /dashboard. A matching email alone does not add a recipient.
**Legacy review audience** means active, unmerged Admin/Head, the review requester and
the account linked to the legacy tutee; [notifyLegacySchedule](../src/server/student-workflow.ts)
directs managers to /admin/requests, linked tutors to /dashboard, and others to /student.
Membership request notifications currently go to Head only, including tutor requests.

There is **no dated tutoring-session notification emitter**. The scheduled-interview
event records an actual date/time/timezone. Tutoring assignment events describe recurring
weekly arrangements and confirmation state; they do not invent a next-session date.
Account authentication, signup confirmation and request-invalidity service mail use
separate direct/essential flows and are not silently reclassified as optional events.

### Record arrivals and scroll ownership

Validated request/application record links in the bell disable Next's default page
scroll for that navigation. The authorized destination first selects its required
panel and filters, then reveals and focuses the committed record in its native
scroll container. A delayed read or mount must not consume the arrival before the
record exists. Incoming fragments take precedence over remembered page position;
ordinary notification destinations retain normal navigation. Once revealed, later
scrolling belongs to the user. A new location, access denial or intervening user
gesture cancels an unfinished reveal; it must not pull the user back later.

Appeal-pending copy points to the linked request without naming a particular
dialog: legacy invalidity review and current signup review retain their own
authorized decision interfaces and policy rules.

## Supported events

### primary_changed

- Recipient: Affected account; previous verified primary also receives a security copy.
- Trigger: User.email actually changes (account-update database trigger). [Emitter](../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Primary Email Changed | Your primary account email changed. Review your account and contact private support if you do not recognize this activity. | Review your account |
| 中文 | 主邮箱已更改 | 您的账户主邮箱已更改。如非本人操作，请查看账户并联系私密支持。 | 查看账户 |

### secondary_added

- Recipient: Affected account.
- Trigger: Successful verification/claim of a secondary address; email-only raw queue call. [Emitter](../src/server/auth/account-emails.ts).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Secondary Email Verified | A secondary email was verified on your account. Review your email addresses. | Review your account |
| 中文 | 辅助邮箱已验证 | 您的账户已验证一个辅助邮箱。请查看账户邮箱。 | 查看账户 |

### secondary_removed

- Recipient: Affected account.
- Trigger: Removal of its verified secondary address; email-only raw queue call. [Emitter](../src/server/auth/account-emails.ts).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Secondary Email Removed | A secondary email was removed from your account. Review your email addresses. | Review your account |
| 中文 | 辅助邮箱已移除 | 您的账户已移除一个辅助邮箱。请查看账户邮箱。 | 查看账户 |

### security_changed

- Recipient: Affected account.
- Trigger: Password hash or two-factor enabled state changes (account-update database trigger). [Emitter](../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Security Changed | Your password or two-step verification settings changed. Contact private support if you do not recognize this activity. | Review your account |
| 中文 | 账户安全设置已更改 | 您的密码或两步验证设置已更改。如非本人操作，请联系私密支持。 | 查看账户 |

### information_changed

- Recipient: Affected account.
- Trigger: Name, alternative names, role or suspended state changes (account-update database trigger). [Emitter](../prisma/migrations/20260916010000_account_emails/migration.sql).
- Authorized destination: /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Information Updated | Your account information or access changed. Sign in to review your current account. | Review your account |
| 中文 | 账户信息已更新 | 您的账户信息或访问权限已更改。请登录查看当前账户。 | 查看账户 |

### message_received

- Recipient: Each explicitly selected message recipient.
- Trigger: A private-message send commits separate recipient deliveries. [Emitter](../src/server/api/routers/messaging.ts).
- Authorized destination: /messages.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Private Message | You have a new private message. Open your inbox to read it and reply. | Open your inbox |
| 中文 | 新的私信 | 您收到一条新私信。请打开收件箱阅读并回复。 | 打开收件箱 |

### program_update

- Recipient: The original notification recipient.
- Trigger: Fallback for an in-app insert without event, or unknown event email copy; no dedicated domain action. [Emitter](../prisma/migrations/20261014010000_notification_events/migration.sql).
- Authorized destination: Original validated destination; unknown event email uses /my-account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Program Update | You have a program update. Sign in to review the notice and any next steps. | View program update |
| 中文 | 项目通知 | 您收到一条项目通知。请登录查看通知和后续步骤。 | 查看项目通知 |

### tutor_application_pending

- Recipient: Active Admin/Head.
- Trigger: First accepted distinct public tutor application commits. [Emitter](../src/server/api/routers/application.ts).
- Authorized destination: /admin/applications.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Pending Tutor Request | You have a new pending tutor application. Review the application before arranging an interview or making a decision. | Review tutor applications |
| 中文 | 新的辅导伙伴申请待审核 | 您收到一份新的辅导伙伴申请。请先审核申请，再安排面试或作出决定。 | 查看辅导伙伴申请 |

### qualification_requested

- Recipient: Active Admin/Head.
- Trigger: Tutor submits an additional-subject or higher-level qualification application. [Emitter](../src/server/api/routers/qualification-application.ts).
- Authorized destination: /admin/applications#application-{requestId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Additional Qualification Request | A tutor requested an additional subject or qualification level. Review the request through the qualification workflow. | Review qualification request |
| 中文 | 新增资格申请 | 一位辅导伙伴申请新增科目或提高资格等级。请按资格审核流程查看申请。 | 查看资格申请 |

### qualification_approved

- Recipient: Account linked to the requesting tutor.
- Trigger: An additional qualification decision approves the request. [Emitter](../src/server/qualification-applications.ts).
- Authorized destination: /dashboard#qualification-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Qualification Request Approved | Your additional qualification request was approved. Review the updated qualifications on your dashboard. | View qualifications |
| 中文 | 资格申请已批准 | 您的新增资格申请已批准。请在工作台查看更新后的资格。 | 查看资格 |

### qualification_rejected

- Recipient: Account linked to the requesting tutor.
- Trigger: An additional qualification decision rejects the request. [Emitter](../src/server/qualification-applications.ts).
- Authorized destination: /dashboard#qualification-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Qualification Request Declined | Your additional qualification request was declined. Review the decision in your request history. | Review qualification decision |
| 中文 | 资格申请未通过 | 您的新增资格申请未通过。请在申请记录中查看决定。 | 查看资格决定 |

### crew_application_pending

- Recipient: Active Head only.
- Trigger: Mailbox verification commits the first pending Crew application. [Emitter](../src/server/crew/signup.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Crew Application Awaiting Head Review | A new crew application is awaiting the program Head's review. Open the crew workflow to review it. | Review crew applications |
| 中文 | 新的工作组申请待负责人审核 | 一份新的工作组申请正等待项目负责人审核。请打开工作组流程查看申请。 | 查看工作组申请 |

### viewer_registered

- Recipient: Active Admin/Head.
- Trigger: Viewer invitation redemption registers the new read-only Viewer. [Emitter](../src/server/auth/account-invitations.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Viewer Account | A new viewer account was registered. Review its read-only access in Users & Roles. | Review users and roles |
| 中文 | 新的观察员账户 | 一个新的观察员账户已注册。请在用户与角色中查看其只读权限。 | 查看用户与角色 |

### tutor_setup_needed

- Recipient: Active Admin/Head.
- Trigger: Management adds an unlinked tutor with no login. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Account Setup Needed | A tutor was added without a login account. Review the account setup workflow and send the authorized setup invitation. | Review account setup |
| 中文 | 辅导伙伴需要设置账户 | 一位辅导伙伴已添加，但尚无登录账户。请查看账户设置流程并发送经授权的设置邀请。 | 查看账户设置 |

### interview_panel_assigned

- Recipient: Accounts linked to assigned panel tutors.
- Trigger: Management commits interview-panel assignment. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Interview Panel Assignment | You were assigned to an interview panel. Review the application and panel duties on your dashboard; a panel assignment alone does not schedule an interview. | View interview panel |
| 中文 | 已分配面试小组 | 您已被分配至面试小组。请在工作台查看申请和职责；小组分配本身不代表已安排面试时间。 | 查看面试小组 |

### interview_scheduled

- Recipient: Accounts linked to panel tutors other than the scheduling chair.
- Trigger: Chair sets a non-null interview time; repeated setting/rescheduling uses the same event. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Interview Scheduled | You have a new interview scheduled. Review the recorded time and interview details on your dashboard. If no time is shown here, check the dashboard. | View scheduled interview |
| 中文 | 已安排新的面试 | 您有一场新安排的面试。请在工作台核对记录的时间和面试详情。如本通知未显示时间，请查看工作台。 | 查看已安排的面试 |

### management_review_pending

- Recipient: All active eligible Admin/Head reviewers for the proposal.
- Trigger: Ordinary management proposal is queued; live change remains unapplied. [Emitter](../src/server/approvals.ts).
- Authorized destination: /admin/approvals?request={proposalId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Awaiting Review | A management change proposal is awaiting approval. Review its recorded evidence before applying or declining it; the proposed change has not been applied. | Review management change |
| 中文 | 管理变更待审核 | 一项管理变更提案正等待批准。请先查看记录的依据，再决定应用或拒绝；提议的变更尚未应用。 | 查看管理变更 |

### management_head_review_pending

- Recipient: Active Head only.
- Trigger: A Head-only management proposal is queued; live change remains unapplied. [Emitter](../src/server/approvals.ts).
- Authorized destination: /admin/approvals?request={proposalId}.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Awaiting Head Review | A management change proposal requires the program Head's approval. Review its recorded evidence; the proposed change has not been applied. | Review management change |
| 中文 | 管理变更待负责人审核 | 一项管理变更提案需要项目负责人批准。请查看记录的依据；提议的变更尚未应用。 | 查看管理变更 |

### management_approved

- Recipient: Proposal requester, if that account still exists.
- Trigger: Approval applies the underlying management action in the decision transaction. [Emitter](../src/server/api/routers/approval.ts).
- Authorized destination: /admin/approvals?request={proposalId}; departure proposals use /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Approved | Your management change proposal was approved and applied. Review the recorded decision and resulting state. | Review decision |
| 中文 | 管理变更已批准 | 您的管理变更提案已批准并应用。请查看记录的决定和变更后的状态。 | 查看决定 |

### management_rejected

- Recipient: Proposal requester, if that account still exists.
- Trigger: Reviewer rejects the proposal without applying its underlying action. [Emitter](../src/server/api/routers/approval.ts).
- Authorized destination: /admin/approvals?request={proposalId}; departure proposals use /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Change Declined | Your management change proposal was declined. The proposed change was not applied; review the recorded decision. | Review decision |
| 中文 | 管理变更未通过 | 您的管理变更提案未通过。提议的变更未应用；请查看记录的决定。 | 查看决定 |

### translation_review_pending

- Recipient: Active Admin/Head.
- Trigger: Translation draft submission commits for review. [Emitter](../src/server/translation-drafts.ts).
- Authorized destination: /localization?view=review.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Translation Awaiting Review | A translation draft is awaiting review. Open localization review to inspect the draft and decide whether to publish it. | Review translation |
| 中文 | 翻译待审核 | 一份翻译草稿正等待审核。请打开本地化审核，查看草稿并决定是否发布。 | 查看翻译 |

### announcement_published

- Recipient: Selected linked tutor accounts plus management/Viewer oversight accounts; publisher excluded.
- Trigger: Announcement publication freezes the tutor audience; edits/restoration do not emit anew. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: Selected tutors: /dashboard; oversight: /admin/announcements (email role fallback applies).

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Program Announcement | A program announcement was published for you. Open the announcement to read it and acknowledge it where required. | Read announcement |
| 中文 | 新的项目公告 | 一则面向您的项目公告已发布。请打开公告阅读，并在需要时确认已阅。 | 阅读公告 |

### tutor_optout_requested

- Recipient: Active Head only.
- Trigger: Tutor membership opt-out request is created, awaiting cooldown/review. [Emitter](../src/server/membership.ts).
- Authorized destination: /admin/tutor-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Opt-Out Request Awaiting Review | A tutor requested to opt out. Review the request after the required cooldown; the request alone does not change participation. | Review tutor requests |
| 中文 | 辅导伙伴退出申请待审核 | 一位辅导伙伴申请退出。请在规定冷静期后审核；提交申请本身不会改变参与状态。 | 查看辅导伙伴申请 |

### tutor_reentry_requested

- Recipient: Active Head only.
- Trigger: Tutor membership reentry request is created. [Emitter](../src/server/membership.ts).
- Authorized destination: /admin/tutor-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Reentry Request Awaiting Review | A tutor requested to rejoin. Review the request before restoring active participation. | Review tutor requests |
| 中文 | 辅导伙伴重新加入申请待审核 | 一位辅导伙伴申请重新加入。请先审核申请，再恢复参与状态。 | 查看辅导伙伴申请 |

### crew_optout_requested

- Recipient: Active Head only.
- Trigger: Crew membership opt-out request is created, awaiting cooldown/review. [Emitter](../src/server/membership.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Crew Opt-Out Request Awaiting Head Review | A crew member requested to opt out. The program Head can review the request after the required cooldown. | Review crew request |
| 中文 | 工作组退出申请待负责人审核 | 一位工作组成员申请退出。项目负责人可在规定冷静期后审核申请。 | 查看工作组申请 |

### crew_reentry_requested

- Recipient: Active Head only.
- Trigger: Crew membership reentry request is created. [Emitter](../src/server/membership.ts).
- Authorized destination: /admin/crew.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Crew Reentry Request Awaiting Head Review | A crew member requested to rejoin. The program Head must review the request before participation is restored. | Review crew request |
| 中文 | 工作组重新加入申请待负责人审核 | 一位工作组成员申请重新加入。项目负责人须先审核申请，再恢复参与状态。 | 查看工作组申请 |

### membership_optout_approved

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision approves an opt-out after the required cooldown. [Emitter](../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Opt-Out Approved | Your opt-out request was approved. Review your current participation status and retained records. | View participation |
| 中文 | 退出申请已批准 | 您的退出申请已批准。请查看当前参与状态和保留的记录。 | 查看参与状态 |

### membership_reentry_approved

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision approves reentry and restores active membership. [Emitter](../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Reentry Approved | Your reentry request was approved and your participation is active again. Review your workspace for current responsibilities. | Open your workspace |
| 中文 | 重新加入申请已批准 | 您的重新加入申请已批准，参与状态已恢复。请在工作区查看当前职责。 | 打开工作区 |

### membership_declined

- Recipient: Requesting Crew account or account linked to requesting tutor.
- Trigger: Membership decision declines opt-out or reentry. [Emitter](../src/server/membership.ts).
- Authorized destination: Tutor: /dashboard; Crew: /patrol.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Participation Request Declined | Your participation change request was declined. Review the decision in your workspace. | Review participation decision |
| 中文 | 参与变更申请未通过 | 您的参与变更申请未通过。请在工作区查看决定。 | 查看参与决定 |

### tutee_optout_requested

- Recipient: Active Admin/Head.
- Trigger: Tutor relays a tutee opt-out with its existing automatic-approval cooldown. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutee-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Opt-Out Awaiting Review | A tutor relayed a tutee opt-out request. Review it during the recorded cooldown; the workflow may apply it automatically when that period ends. | Review tutee requests |
| 中文 | 学习伙伴退出申请待审核 | 一位辅导伙伴转达了学习伙伴的退出申请。请在记录的冷静期内审核；冷静期结束后，流程可能自动批准。 | 查看学习伙伴申请 |

### tutee_optout_cancelled

- Recipient: Account linked to the tutor on the relay's pairing.
- Trigger: Management cancels a still-pending tutor-relayed tutee opt-out. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Opt-Out Cancelled | Management cancelled a tutee opt-out request. Review the current assignment and request state on your dashboard. | Review assignment |
| 中文 | 学习伙伴退出申请已取消 | 管理团队取消了一项学习伙伴退出申请。请在工作台查看当前安排和申请状态。 | 查看辅导安排 |

### tutee_removed

- Recipient: Linked accounts of affected paired tutors and active Admin/Head.
- Trigger: Removal is finalized, preserving history and removing current roster/assignment state. [Emitter](../src/server/discipline/removal.ts).
- Authorized destination: Tutors: /dashboard; managers: /admin/tutee-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Removed from Current Roster | A tutee was removed from the current roster. Review the current assignment and retained history in your workspace. | Review roster update |
| 中文 | 学习伙伴已移出当前名单 | 一位学习伙伴已移出当前名单。请在工作区查看当前安排和保留的历史记录。 | 查看名单更新 |

### attendance_cards_pending

- Recipient: Active Admin/Head.
- Trigger: Attendance survey commits one or more disciplinary-card requests; count records submitted requests. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/discipline.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Discipline Cards Awaiting Review | An attendance survey submitted {count} discipline card request(s). Review each request before issuing a card. | Review discipline cards |
| 中文 | 纪律卡申请待审核 | 一份出勤问卷提交了 {count} 项纪律卡申请。发卡前请逐项审核。 | 查看纪律卡申请 |

Without a recorded count: An attendance survey submitted discipline card requests. Review each request before issuing a card. / 一份出勤问卷提交了纪律卡申请。发卡前请逐项审核。

### attendance_room_reported

- Recipient: Active Admin/Head.
- Trigger: Attendance submission reports use of a room reserved by another pairing in that term or blocked by recurring room unavailability. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/attendance.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Allocated-Room Attendance Reported | Attendance was reported in an allocated room. Open attendance review to inspect the recorded submission. | Review attendance |
| 中文 | 已提交分配教室的出勤记录 | 有人提交了分配教室的出勤记录。请打开出勤审核查看记录。 | 查看出勤 |

### attendance_review_warning

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with WARN. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Warning Recorded | An attendance review recorded a warning. Review the recorded decision on your dashboard. | Review attendance decision |
| 中文 | 出勤警告已记录 | 一次出勤审核记录了警告。请在工作台查看记录的决定。 | 查看出勤决定 |

### attendance_review_penalty

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with PENALIZE and applies service-hour deduction. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Penalty Applied | An attendance review applied a service-hour penalty. Review the recorded decision and updated service hours. | Review attendance decision |
| 中文 | 出勤审核已应用时数扣减 | 一次出勤审核应用了服务时数扣减。请查看记录的决定和更新后的服务时数。 | 查看出勤决定 |

### attendance_review_escalated

- Recipient: Account linked to flagged attendance's tutor.
- Trigger: Management reviews a flag with ESCALATE. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /dashboard.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Attendance Flag Escalated for Review | An attendance flag was escalated for further review. Review the recorded state; this notice does not itself confirm a penalty. | Review attendance decision |
| 中文 | 出勤标记已提交进一步审核 | 一项出勤标记已提交进一步审核。请查看记录的状态；本通知本身不代表已应用扣减。 | 查看出勤决定 |

### attendance_history_updated

- Recipient: Active Head only.
- Trigger: Catalogue clock propagation changes recorded teaching blocks and reconsiders flags/deductions; count is changed blocks. [Emitter](../src/server/attendance-schedule.ts).
- Authorized destination: /admin/audit.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Historical Attendance Updated | A catalogue change updated {count} teaching block(s). Related attendance flags and deductions were reconsidered; review the audit evidence. | Review audit evidence |
| 中文 | 历史出勤已更新 | 一项目录变更更新了 {count} 个辅导时段。相关出勤标记和扣减已重新审查；请查看审计依据。 | 查看审计依据 |

Without a recorded count: A catalogue change updated historical teaching blocks. Related attendance flags and deductions were reconsidered; review the audit evidence. / 一项目录变更更新了历史辅导时段。相关出勤标记和扣减已重新审查；请查看审计依据。

### account_suspended

- Recipient: Affected account.
- Trigger: Management applies account suspension. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /suspended.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Suspended | Your account access was suspended pending review. Open the suspension page to review the available appeal steps. | Review suspension |
| 中文 | 账户已暂停 | 您的账户访问已暂停，等待审核。请打开暂停页面查看可用的申诉步骤。 | 查看暂停状态 |

### account_reinstated

- Recipient: Affected account.
- Trigger: Management applies account reinstatement. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Reinstated | Your account access was restored. Sign in to review your current permissions and workspace. | Open your workspace |
| 中文 | 账户已恢复 | 您的账户访问已恢复。请登录查看当前权限和工作区。 | 打开工作区 |

### account_appeal_requested

- Recipient: Active Admin/Head.
- Trigger: A suspended account submits an account reinstatement appeal. [Emitter](../src/server/api/routers/account.ts).
- Authorized destination: /admin/users.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Awaiting Review | A suspended account submitted an appeal. Authorized management can review the appeal in Users & Roles. | Review account appeal |
| 中文 | 账户申诉待审核 | 一个暂停的账户提交了申诉。经授权的管理人员可在用户与角色中审核申诉。 | 查看账户申诉 |

### account_appeal_approved

- Recipient: Appealing account.
- Trigger: Management approves account appeal and reinstates access. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Approved | Your account appeal was approved and account access was restored. Sign in to review your current access. | Open your workspace |
| 中文 | 账户申诉已批准 | 您的账户申诉已批准，账户访问已恢复。请登录查看当前权限。 | 打开工作区 |

### account_appeal_declined

- Recipient: Appealing account.
- Trigger: Management denies account appeal. [Emitter](../src/server/api/routers/admin.ts).
- Authorized destination: /.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Account Appeal Declined | Your account appeal was declined and the account remains suspended. Review the available support steps. | Review appeal decision |
| 中文 | 账户申诉未通过 | 您的账户申诉未通过，账户仍处于暂停状态。请查看可用的支持步骤。 | 查看申诉决定 |

### record_corrected

- Recipient: Active Head only.
- Trigger: Management attendance or patrol correction commits. [Emitter](../src/server/api/routers/corrections.ts).
- Authorized destination: /admin/audit.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Management Record Correction Applied | Management applied a record correction. Review the original and corrected evidence in the audit log. | Review audit evidence |
| 中文 | 管理记录修正已应用 | 管理团队应用了一项记录修正。请在审计日志中查看原始和修正后的依据。 | 查看审计依据 |

### tutee_feedback_received

- Recipient: Active Admin/Head.
- Trigger: Tutee submits or updates feedback on owned session attendance. [Emitter](../src/server/api/routers/student.ts).
- Authorized destination: /student-support.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | New Tutee Feedback | A tutee submitted session feedback. Authorized management can review the feedback in Student Support. | Review feedback |
| 中文 | 新的学习伙伴反馈 | 一位学习伙伴提交了辅导反馈。经授权的管理人员可在学习伙伴支持中查看反馈。 | 查看反馈 |

### tutee_card_appeal

- Recipient: Active Admin/Head.
- Trigger: Tutee submits an appeal for an owned disciplinary card. [Emitter](../src/server/api/routers/student.ts).
- Authorized destination: /student-support.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Card Appeal Awaiting Review | A tutee appealed a discipline card. Review the appeal and recorded card evidence in Student Support. | Review card appeal |
| 中文 | 学习伙伴纪律卡申诉待审核 | 一位学习伙伴对纪律卡提出了申诉。请在学习伙伴支持中查看申诉和记录的纪律卡依据。 | 查看纪律卡申诉 |

### tutee_appeal_reviewed

- Recipient: Explicit retained history owner, otherwise the account linked to the tutee.
- Trigger: Management reviews a tutee disciplinary-card appeal. [Emitter](../src/server/api/routers/student.ts).
- Authorized destination: /student.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Appeal Reviewed | Your discipline card appeal was reviewed. Open your student workspace to see the decision and current standing. | Review appeal decision |
| 中文 | 学习伙伴申诉已审核 | 您的纪律卡申诉已审核。请打开学习伙伴工作区查看决定和当前状态。 | 查看申诉决定 |

### student_assignment_updated

- Recipient: Survey request audience; legacy direct assignment also notifies the linked tutee account.
- Trigger: Management applies tutor assignment to a request or legacy roster tutee. [Emitter](../src/server/student-workflow.ts).
- Legacy direct-assignment emitter: [admin router](../src/server/api/routers/admin.ts).
- Authorized destination: Request audience destinations; legacy direct account: /student.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutoring Assignment Updated | A tutoring assignment was updated. Review the recurring weekly schedule and its confirmation state in your workspace; this notice does not create a dated session. | Review tutoring assignment |
| 中文 | 辅导安排已更新 | 一项辅导安排已更新。请在工作区查看每周安排及其确认状态；本通知不会创建某个日期的辅导记录。 | 查看辅导安排 |

### student_availability_updated

- Recipient: Survey request audience.
- Trigger: Owned student request availability actually changes. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutee Availability Updated | A tutee updated their available time slots. Review the current availability before adjusting an assignment. | Review availability |
| 中文 | 学习伙伴可用时间已更新 | 一位学习伙伴更新了可用时段。调整辅导安排前，请查看当前可用时间。 | 查看可用时间 |

### student_request_recalled

- Recipient: Survey request audience.
- Trigger: Student recalls an unassigned request, closing it. [Emitter](../src/server/student-request-state.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Signup Request Recalled | A signup request was recalled and closed. Review its retained history; a new submission is required to request participation again. | Review request history |
| 中文 | 报名申请已撤回 | 一份报名申请已撤回并关闭。请查看保留的历史记录；再次申请参与需要重新提交。 | 查看申请记录 |

### student_request_expired

- Recipient: Survey request audience.
- Trigger: Unverified request closes after its verification deadline. [Emitter](../src/server/student-request-state.ts).
- Authorized destination: Request audience destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Signup Verification Overdue | A signup request closed because verification was not completed by its deadline. A new request is required; review the retained request history. | Review request history |
| 中文 | 报名验证逾期 | 一份报名申请因未在截止时间前完成验证而关闭。需要重新申请；请查看保留的申请记录。 | 查看申请记录 |

### student_withdrawal_pending

- Recipient: Survey request audience; legacy account-owned withdrawal notifies active Admin/Head.
- Trigger: Assigned student applies for current-period withdrawal, or the legacy withdrawal request commits. [Emitter](../src/server/student-workflow.ts).
- Legacy account-owned withdrawal emitter: [legacy withdrawal](../src/server/legacy-student-withdrawal.ts).
- Authorized destination: Request audience destinations; legacy pending: /admin/tutee-requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Quarter Withdrawal Awaiting Review | A request to withdraw for the current quarter is awaiting review. Participation continues until the withdrawal is approved. | Review withdrawal request |
| 中文 | 本季度退出申请待审核 | 一份本季度退出申请正等待审核。退出获批前，参与状态继续有效。 | 查看退出申请 |

### student_withdrawal_approved

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review approves current-period withdrawal, closes participation and blocks that period's new intake. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Quarter Withdrawal Approved | A quarter withdrawal was approved and the request closed. Review the retained history; the current quarter cannot be reactivated through this request. | Review withdrawal decision |
| 中文 | 本季度退出申请已批准 | 一份本季度退出申请已批准，申请已关闭。请查看保留的历史；无法通过此申请恢复本季度参与。 | 查看退出决定 |

### student_withdrawal_declined

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review denies current-period withdrawal. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Quarter Withdrawal Declined | A quarter withdrawal request was declined. Current participation continues; review the recorded decision. | Review withdrawal decision |
| 中文 | 本季度退出申请未通过 | 一份本季度退出申请未通过。当前参与状态继续有效；请查看记录的决定。 | 查看退出决定 |

### student_schedule_review_pending

- Recipient: Survey request audience or legacy review audience.
- Trigger: Assigned tutor reports a schedule conflict and requests review. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Schedule Conflict Awaiting Review | A tutor reported a schedule conflict for an assignment. Review the request before changing the current assignment. | Review schedule conflict |
| 中文 | 辅导伙伴时间冲突待审核 | 一位辅导伙伴报告了辅导安排的时间冲突。更改当前安排前，请先审核申请。 | 查看时间冲突 |

### student_schedule_review_approved

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review approves the tutor's conflict and detaches the affected assignment for rematching. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Schedule Conflict Approved; Rematching Needed | A schedule conflict request was approved and the affected assignment was removed. Review the request to arrange a new match. | Review rematching request |
| 中文 | 时间冲突申请已批准，待重新匹配 | 一份时间冲突申请已批准，相关安排已移除。请查看申请并重新匹配。 | 查看重新匹配申请 |

### student_schedule_review_declined

- Recipient: Survey request audience or legacy review audience.
- Trigger: Authorized review denies the tutor's conflict; assignment is unchanged. [Emitter](../src/server/student-workflow.ts).
- Authorized destination: Request audience destinations or legacy review destinations.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Schedule Conflict Declined | A schedule conflict request was declined. The current assignment continues; review the recorded decision. | Review schedule decision |
| 中文 | 时间冲突申请未通过 | 一份时间冲突申请未通过。当前安排继续有效；请查看记录的决定。 | 查看时间安排决定 |

### tutor_reactivated

- Recipient: Active Admin/Head.
- Trigger: Pending tutor chooses available during start-of-term activation. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutors.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Participation Reactivated | A tutor became available for the current term. Review the current participation and assignment state in the tutor roster. | Review tutor roster |
| 中文 | 辅导伙伴参与状态已恢复 | 一位辅导伙伴已恢复本学期可用状态。请在辅导伙伴名单中查看当前参与状态和安排。 | 查看辅导伙伴名单 |

### tutor_opted_out

- Recipient: Active Admin/Head.
- Trigger: Pending tutor chooses unavailable during start-of-term activation. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/tutors.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Opted Out for This Term | A tutor opted out for the current term. Review the current participation and assignment state in the tutor roster. | Review tutor roster |
| 中文 | 辅导伙伴已退出本学期 | 一位辅导伙伴已退出本学期。请在辅导伙伴名单中查看当前参与状态和安排。 | 查看辅导伙伴名单 |

### meeting_absence_excused

- Recipient: Active Admin/Head.
- Trigger: Active tutor records an excused meeting absence before the cutoff. [Emitter](../src/server/api/routers/tutor.ts).
- Authorized destination: /admin/meetings.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Tutor Meeting Absence Excused | A tutor recorded an excuse for an upcoming meeting absence. Review the meeting's attendance state; the excuse text is available only in the authorized workflow. | Review meeting attendance |
| 中文 | 辅导伙伴会议请假已记录 | 一位辅导伙伴为即将举行的会议记录了请假。请查看会议出席状态；请假原文仅在授权流程中可见。 | 查看会议出席 |

### school_departure_updated

- Recipient: Affected account.
- Trigger: Authorized school departure/return decision commits. [Emitter](../src/server/school-departure.ts).
- Authorized destination: Eligible linked tutor: /settings; otherwise /student?view=account.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | School Participation Status Updated | Your school departure or return status was updated. Review the recorded state and any participation steps in your account workspace. | Review school participation |
| 中文 | 在校参与状态已更新 | 您的离校或返校状态已更新。请在账户工作区查看记录的状态和后续参与步骤。 | 查看在校参与 |

### request_invalidity_appeal_pending

- Recipient: Active Admin/Head.
- Trigger: First immutable appeal to a current applied request-invalidity flag commits. [Emitter](../src/server/email/request-appeal.ts).
- Authorized destination: Tutor application: /admin/applications; survey/legacy signup: /admin/requests.

| Language | Title | Description | Action |
| --- | --- | --- | --- |
| English | Invalid Request Appeal Awaiting Review | A submitter appealed an applied invalid-request flag. Open the linked request to review the appeal; submitting an appeal does not clear the flag. | Review invalid request appeal |
| 中文 | 无效申请申诉待审核 | 一位申请提交者对已应用的无效标记提出申诉。请打开链接中的申请审核申诉；提交申诉不会解除标记。 | 查看无效申请申诉 |

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
See [the source copy](../src/server/email/request-notice-copy.ts),
[staff procedure](user-guide.md#signup-request-tabs) and
[durable admission/appeal boundaries](technical-report.md#public-request-invalidity-notices-and-appeals).
