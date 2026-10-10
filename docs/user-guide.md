# User guide

## Account invitations and sign-in

All website account creation finishes through the shared invitation review at `/register-account`.
Published `/register` links redirect there and retain their invitation parameters.
The invitation page, Viewer signup and tutee application remain separate starting points.
An invitation authorizes a specific task; verified email ownership proves who is accepting it.
A staff-visible key or a copied invitation code alone cannot sign in as its recipient.

| Starting point | What happens next | Result after review |
| --- | --- | --- |
| Tutor, Crew or management staff key | Enter the key and recipient email, then verify the separate emailed code. | Create missing credentials or add the authorized access to the existing account after review. |
| Tutee request | Submit the full request and policy agreement, then verify the emailed code. The existing email link remains usable. | The invitation popup continues to shared account review; confirmation preserves original submission priority and assignment remains separate. |
| Public Viewer request | Submit details and verify the initial email code, then open the invitation popup. | A new address creates a read-only Viewer after review; an existing account signs in and continues without adding Viewer or changing membership. |
| Public Crew application | Submit details and verify the mailbox to send the application for staff review. After approval, verify the mailbox again to retrieve its invitation popup. | Shared account review creates missing credentials or adds approved Crew participation to the existing account; email verification alone grants no access. |
| Historical tutee invitation | Verify the exact invited email, then continue from the invitation receipt popup to `/register-account`. | Create/use credentials, then separately review and choose **Link My History** for the exact record. No current participation is added. |
| Accountless tutor setup sent by Head | Receive a Tutor invitation. | The roster remains accountless until its recipient accepts; no placeholder login is created by sending mail. |

The invitation page opens with one centered code field and a full-width **Continue** button.
New invitation and staff registration codes use the legacy Steam-style format: five
characters containing both uppercase letters and digits from `023456789ABCDEFGHIJKMNPQRSTUVWXYZ`.
The spaced input shows `XXXXX`; lowercase entry is normalized to uppercase. `O`/`o` is
accepted as `0`, and `1` is accepted as `I` in five-character codes. Older outstanding
invitation codes remain usable for compatibility. Mailbox verification is a separate code;
the tutee verification code retains its six-character format and is not the invitation shown afterward.
After Viewer or tutee email verification, or verified retrieval of an approved Crew application, a popup shows the invitation code, **Copy code**,
an optional **Email code** action and a link that prefills the invitation page. Close and
reopen the popup without repeating verification. Failed optional delivery leaves the code
available. The verified browser can continue directly; a copied code in another browser
requires recipient email verification. Browser proof uses a short-lived HttpOnly cookie,
not a URL or JavaScript storage. Invitations last up to 15 minutes; earlier staff authorization
and application deadlines still apply. For an existing account, mailbox proof signs in
without replacing its password or established identity. Primary and verified secondary
emails resolve to the same account. Accepting proof for the primary address also confirms
that address; proof for a secondary address does not confirm a different primary address.
Adding participation still requires an explicit review.
An existing account using the public Viewer request has no added access to review; successful
code sign-in completes that request directly. When canonical academics still need confirmation,
the saved participation receipt shows the required next step and a link to **My Account**.
If the account enforces password plus email verification, complete that existing sign-in
flow and return to the invitation; an invitation does not disable two-factor protection.

New accounts review prefilled application details and create missing credentials. An unfinished
account is asked only for missing credentials. Existing forced password changes and recovery
remain explicit operations. Authorized Tutor, Crew and tutee access is added to an existing
account after review, preserving its other access. Accepting an authorized participation or
management invitation replaces an exclusive Viewer role; Viewer cannot coexist with participant
badges. A management invitation upgrades to its authorized rank and never demotes a higher
existing rank. It does not grant Head authority. Suspension remains enforced. Tutor, Crew and
tutee grants retain participation revocation and school departure checks; an invitation does
not bypass a required reviewed return. School departure does not by itself block an authorized
management rank upgrade, which grants no participant access.

A failed request keeps the form draft. If acceptance succeeds but sign-in or refreshing
fails, the page identifies the saved result and offers sign-in recovery without repeating
the write. Expired or replaced invitations return to their original request route; the
original application, policy evidence and historical records remain retained. Outstanding
older verification links and staff keys remain valid entry points to this shared flow.
An old browser still displaying the previous completion screen will ask you to open the
newly emailed invitation; it will not report account creation before that review succeeds.

Account readiness, email verification, suspension, membership, active participation and
historical ownership are distinct states. A ready login has a password, verified primary
email and no required password change; readiness never means an assigned or active participant.

Use this guide with the website address supplied by your program. Page names below match the interface. Features and navigation can vary when HEAD disables a program module. A hidden page does not grant permission to use its address directly.

## Contents

- [Before you start](#before-you-start)
- [Tutees](#tutees)
- [Tutors](#tutors)
- [Crew](#crew)
- [Coordinators](#coordinators)
- [Administrators](#administrators)
- [HEAD](#head)
- [Viewers](#viewers)
- [Graduation and school transfers](#graduation-and-school-transfers)
- [Translators](#translators)
- [Account settings and private support](#account-settings-and-private-support)
- [Renewed policy acceptance](#renewed-policy-acceptance)
- [Troubleshooting](#troubleshooting)
- [Report a problem](#report-a-problem)

## Before you start

Read **Privacy policy** from the homepage information menu or footer, or open `/privacy` directly. It is available without signing in and remains readable when participation agreements need renewal. The notice covers information collected, uses, access, browser storage, retention and privacy requests. English and Chinese are provided; other interface languages show the English document. Use the contact details at the end for privacy questions.

The website supports intake, matching, attendance, hours, interviews, support and reviewed management changes. The operator must configure real email delivery and publish the current school policies before opening public intake. The repository contains [policy drafts](policies/README.md) for adaptation; changing a draft does not publish a school policy.

| Your access                            | Start with                           | Important boundary                                                                                                |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Tutee participation (any account role) | Enter Tutee page                     | Your own records and participation                                                                                |
| Tutor                                  | Dashboard                            | Your linked tutor profile and assignments                                                                         |
| Crew                                   | Patrol                               | Active crew participation; the crew module must be enabled                                                        |
| Coordinator                            | Management area / Management Actions | Daily operations wait for ADMIN/HEAD review; eligible reversals wait for HEAD; significant settings and account edits are read only                                                                   |
| Administrator                          | Management area                      | Operational management; HEAD-only powers remain restricted                                                        |
| HEAD                                   | Program & Refresh / Users & Roles    | One program leader; controls leadership and elevated configuration                                                |
| Viewer                                 | Read-only management area            | Permitted summaries with personal contact details masked                                                          |
| Assigned translator                    | Translations                         | Edit interface or website text and follow draft review in one editor; assignment is separate from management rank |

A role and a tutor or crew membership are different things. A management account needs an active linked tutor profile to perform tutor duties. Active non-Viewer accounts can enter tutee onboarding, including tutors, crew and administrators; a confirmed school departure requires a [reviewed return](#graduation-and-school-transfers) before rejoining. First accept the published tutee policy; acceptance records its exact revision and grants tutee membership. Visiting alone does not grant access or create a tutoring request. Tutee participation and history coexist with other account roles. Suspension prevents ordinary participation; follow the suspension page’s appeal route.

### Choose the right registration form

Published website and email links use `/register`, `/tutee`, `/tutor`, `/viewer`
and `/crew`; the address bar then shows the corresponding descriptive signup page.
Old `/signup` and `/signup/account` bookmarks and email links remain valid, including
their confirmation parameters. Tutor and crew applications open at `/tutor-signup`
and `/crew-signup` and retain the existing review process. See the
[URL convention](technical-report.md#public-signup-url-convention) for the full mapping.

- **Register with an Invitation Code** (`/register` → `/register-account`) opens the shared code card. Enter an invitation code or a five-character staff key and choose **Continue**. A code without this browser's verified proof requires email verification before review.
- **Register as a Viewer** (`/viewer` → `/viewer-signup`) collects Viewer details and verifies the mailbox when viewer signup is enabled. Its popup offers the invitation code, optional email delivery and a prefilled invitation link. A new account receives read-only Viewer access; an existing account signs in without changing its access. No staff key is needed.
- **Request a Tutor** (`/tutee` → `/tutee-signup`) collects the full tutee application before email verification and invitation issuance. Enter the emailed verification code, or use the existing email link and explicitly confirm it. Continue from the invitation popup to review your request and any missing credentials.
- **Join the crew** (`/crew` → `/crew-signup`) collects application details and verifies the mailbox before sending the application for staff review. Use the same page to check an existing application with a fresh emailed code; an approved application can continue through the shared invitation popup and account review.

Sign In names the invitation and viewer routes separately. The invitation and viewer pages link to each other and to Request a Tutor, so you can switch if you opened the wrong form. Viewer links are hidden when public viewer signup is disabled. Existing accounts can use their normal sign-in, password recovery, or a recipient-delivered invitation; invitations never replace an established password.

After the initial code card, registration shows numbered steps and focuses the new step heading. Use **Back** or **Edit Identity** before verification to correct earlier details. Editing clears current verification evidence and requires verification again; other entries remain while you stay on the page. A different invitation starts a fresh account review. Staff keys bound to an email keep that email read only. Use the original request's resend action if verification mail is missing or evidence expires. Browser navigation works normally; leaving or refreshing can discard unsaved entries. Existing signed-in recipients can use **Add access** in the account menu or Account Settings to enter a code and review its authorized addition.

### Previewing applications outside recruitment

The tutor application and tutee request are separate forms with separate recruitment periods. When a period has not started, has ended, is paused, or is awaiting setup, you can still read the questions and any published policy. The response fields and submission button are disabled. Return when recruitment opens to complete your application. Any additional sheet link is supplied by the team for viewing; it is not a list of other participants' responses.

### Retrying public signup

If signup asks you to wait, keep your form open and retry after the displayed
interval. Tutee resends preserve your original submission time and place. A failed
email does not mean you need to submit a new survey. Contact the team if delivery
continues to fail. Existing emailed verification links remain independently usable.

### Switch workspaces

Management headers and account menus show **Enter Tutor Page**, then **Enter Tutee Page** together when eligible. The tutor shortcut requires a linked, non-archived profile with tutoring access. Tutee workspace access preserves personal records, while new participation follows the onboarding and departure rules above. Management accounts without tutor eligibility can still open the tutee workspace and return to management.

Tutor and tutee workspaces show **Back to Management** for HEAD, ADMIN, COORDINATOR and VIEWER. This shortcut does not grant write access to viewers. Archived pure tutors retain their existing read-only history access.

On mobile, the shared header places the brand and language selector first, global controls second, and available workspace switches below a divider. Management's hamburger button opens the navigation drawer; Escape, its close button or selecting a link closes it. Public pages keep the brand and language selector on the first row and navigation/theme on the second. Patrol, Translations, Messages and Account Settings share the workspace header. Desktop management keeps the sidebar and main content independently scrollable below the header. Workspace shortcuts wrap on narrow screens and preserve touch targets.

## Graduation and school transfers

All student accounts, including students who only receive tutoring, can report graduation
or transfer in **School Departure** in their account settings. Explain the change and
confirm the request. Head reviews it through Management Actions. Admin can also open
the account editor to propose the change; only Head confirms it. Coordinators cannot submit staff profile changes.

After confirmation, **Enter Viewers Portal** appears on the tutor dashboard or tutee
page. It opens the same masked, read-only summaries available to Viewers. Your account
role and personal history remain available. Current tutoring assignments and pending
learning requests close; a departing tutor's current learners return to the waiting list.
Archive, opt-out and self-reported academic graduation alone do not grant this access.

Head can revoke or restore observer access and approve a return to school. A return
does not restore assignments automatically; tutor activation and learning enrollment
follow their normal workflows. Suspension and an existing tutor-access revocation
still apply. Independently assigned management, crew and translator permissions remain.

## Tutees

### Apply and confirm

1. Open **Request a Tutor** on the home page or any section of the tutee page when intake is open. You can start with the form before creating an account.
2. Enter your name, email, preferred contact method, subject choices and available times. Read the displayed tutee policy and sign the agreement.
3. Choose **Submit Request**. Your original survey submission sets your priority. Repeating the same open request does not buy an earlier place.
4. Enter the verification code sent to your email, or open the existing account-confirmation link and explicitly confirm the email. The invitation popup shows a code, optional email delivery and a prefilled link to `/register`. Review the request there and create missing credentials if needed. Existing accounts retain credentials and other access; an exclusive Viewer leaves Viewer when accepting tutee participation.
5. Continue to **Enter Tutee Page**, then **Requests**, to check your confirmed request and available times. If verification or review is interrupted, use its resend/recovery action or reopen the invitation rather than submitting another application.

An account link lasts 24 hours. Request a new link if it expires; a successful resend replaces the previous link. Staff may assign a tutor before you confirm. That first assignment starts a fixed seven-day verification deadline. Reassignment and link resends do not extend it. An unverified request closes when its deadline passes and its assignments are released; you must submit a new request with a new priority timestamp.

The configured tutee signup opening and closing times apply to new requests even
when you are already signed in. Returning to the form checks the current intake
settings before enabling its fields. Outside that window, the form is a read-only
preview. If the check fails, use Retry; existing requests and their separate email
confirmation deadlines remain unchanged.

### Find your way around

The tutee page uses the same top bar, account menu, theme and card layout as the tutor page. Choose a section from its navigation:

| Section              | What you can do                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard            | See current scheduled sessions and verified open requests, then follow a link to the task you need                                 |
| My Tutors & Schedule | See current tutoring sessions, tutors, times and rooms across your explicitly linked profiles                                      |
| Requests             | Review confirmed requests, change availability and manage participation; completed requests remain in the current period’s history |
| Attendance           | Review recorded sessions across intakes and submit feedback                                                                        |
| Support              | Review your disciplinary cards and appeals or open a private conversation                                                          |
| Messages             | Read and send messages within the tutee workspace                                                                                  |
| Account              | Manage your shared account within the tutee workspace                                                                              |

**Request a Tutor** is available in every section and opens the existing request form. A program period is labeled **Quarter** when quarters are enabled and **Semester** when semester mode is applied; request and withdrawal wording follows that setting. A staged mode change does not change the current display.

Current schedules include only active-period assignments on explicitly owned, non-inactive profiles. A new tutor assignment displays **Awaiting schedule** until a tutor or manager chooses a time slot; the assigned tutor remains visible. The dashboard counts only subjects with confirmed schedules. Multiple profiles on the same assignment produce one schedule entry. A matching name or email does not grant access to another person’s records. Historical attendance remains available after a refresh.

### Manage a request

| What you need                | Action                                    | What happens                                                                                                             |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Change your available times  | **Edit availability**                     | Subjects, priority and current assignments stay the same; coordinate the actual meeting with your tutor                  |
| Cancel an unassigned request | Recall it and confirm the consequences    | That request closes permanently; applying again creates a new timestamp                                                  |
| Leave after assignment       | **Request withdrawal…** and give a reason | Assignment continues during review; approval ends participation and blocks another request in the current program period |
| See the result               | **Current Request** and **Processed**     | Review state and assignment are shown separately                                                                         |

Important actions display consequences and a countdown before confirmation. A pending request is not an approved change. If a tutor reports a schedule conflict, an approved rejection removes only that tutor’s assignment and returns your request for matching at its original priority.

### Withdrawal requests

Open **Requests → Participation → Request withdrawal…**. The button names the current quarter or semester and also works for staff-entered enrollments explicitly linked to your account. Give a reason and complete the timed confirmation; check the decision before assuming your participation has ended.

### Records, feedback and appeals

Use **My Tutors & Schedule** for current assignments, **Attendance** for recorded sessions and feedback, and **Support** for disciplinary cards and appeals. Records remain linked to your account across new intakes and verified email changes.

For imported or earlier enrollments, open **My Tutoring History** in the account menu, then **View History**. This includes retained tutor evidence already owned by your account, even when participation access is revoked. If records are missing, ask staff to review the exact record. Accountless alumni can use a staff-reviewed historical tutee invitation: **Create history-only account → verify email code → invitation popup → shared account review at `/register-account` → Link My History**. The popup supports copying the code, optional email delivery and a prefilled continuation link. No current tutoring request, grade or participation agreement is required to read owned history. Existing logins use sign-in/password recovery; unavailable old email requires staff identity review and a replacement invitation. Head handles ownership conflicts and genuine duplicate accounts. See [historical record access](historical-participant-transition.md#invite-an-alumnus-without-a-login).

- Submit feedback for one of your recorded sessions. The portal explains whether management has enabled sharing with that session’s tutor. Feedback is management-only by default; a later visibility change also affects earlier feedback.
- Appeal your own card once, by the end of the **fifth school day** after its recorded issue date in the program timezone. Holidays and make-up days follow the school calendar maintained by staff. A pending appeal does not invalidate the card or suspend its effects.
- Use **Messages** for a private management conversation. Policy renewal does not remove access to your history, feedback, appeals, messages or account settings. Further participation requires accepting the revised policy.

With discipline enabled, an unexcused student absence automatically creates a valid red card. Tutor-requested cards count only after validation. Every three valid yellow cards contribute one effective red; at two effective reds, an active tutee is automatically made inactive and removed from current-period assignments, without separate removal approval. An upheld appeal invalidates the card and recalculates standing. Eligible effects may be restored if no later independent status change intervened; accounts and past records remain.

See the [tutee policy draft](../prisma/policies/tutee-policy.en.md) or [中文学习伙伴政策草案](../prisma/policies/tutee-policy.zh.md). Participation uses the school's published version displayed on the website.

## Tutors

The dashboard starts with **Your Next Steps**. Its links move keyboard focus to
attendance, pairings, unresolved interviews, meetings and pending qualifications.
Today's regular schedule uses the program time zone and confirmed weekly times;
check announcements for holidays or one-off changes. Attendance comes before
optional editors. Pending participation, policy and request notices remain visible.
Completed interview details and optional editors can be expanded without losing an
in-progress draft when collapsed. Pending qualification requests remain visible
even when completed history is collapsed or filtered.

Pending tutors confirm whether to participate before tutoring actions appear.
Inactive tutors retain their records but cannot edit pairings or submit attendance.
Changing a pairing's linked time slot, requesting or recalling a removal, and
recording an interview decision names the affected record before submission.
Cancel leaves live records unchanged. A relayed opt-out stays pending during its
seven-day recall window, then processes automatically unless recalled or cancelled.
An inactive tutor can still recall their pending relay. A queued management proposal
requires staff approval; neither pending result is an applied change.

Meeting-excuse, qualification and interview drafts remain available after a failed
save. Correct the problem and retry. Attendance keeps its successful receipt and
locks that entry; choose **Submit Another** to start a fresh record. If a saved
entry's totals fail to refresh, retry the refresh without resubmitting attendance.

Existing tutors can use **Subject Qualifications** on their dashboard to request another subject or a higher offered level in a subject they already teach. Choose a subject, explain your qualifications and submit; the request history shows outcomes, the decision note, and the subjects granted on approval. Under **Your Requests**, filter by **Pending** (including interviews), **Approved**, **Rejected**, or **Recalled**; counts show how many requests are in each category. History starts with Pending. Use **Collapse** / **Expand** to hide or show the history without losing the selected filter. Active tutors can **Recall request** while a request is pending or under interview. Confirming recall stops review, records who recalled it and when, and retains the request and panel history. A recalled request cannot be approved or reopened; submit a new request for that subject and level when ready. Approved and rejected decisions cannot be recalled. Pending, rejected and recalled requests do not change current qualifications. Duplicate open requests for the same subject and level are blocked. Inactive tutors retain read-only history.

In **Tutor Applications**, additional-subject and higher-level requests have distinct badges. Only Admin or Head may approve directly or assign an interview panel. Rejection requires an interview and a decision note. Direct approval is available even when interviews are enabled. An interview uses the existing votes and majority rules with an Admin/Head tutor as chair; that chair records the outcome in Tutor Applications. Panelists see the requested course and the tutor's qualification explanation on their dashboard. Coordinators cannot make or queue these decisions. Applicants cannot review themselves. Review history and final decisions are retained. Approval records the requested level and lower offered levels in that course group under the ordering at approval time; reordering later does not change those grants. Subject willingness remains a separate choice in Subject Availability.

For a pending additional-subject or higher-level request without an assigned panel, select **Approve without Interview** to open its review. Check the applicant and subject, enter the required **Decision note**, then choose **Approve qualification**. This dialog has no reject action: **Reject request** is available only to the assigned Admin/Head chair after all interview panelists have voted, following the panel majority. Opening the dialog submits nothing. **Cancel** or Escape closes it and retains the note while the application card remains mounted. Failed submissions keep the note for retry; **Reload review** clears it only after the latest application loads successfully. A saved decision whose refresh fails offers **Try again** to refresh records without repeating the decision. Interview-stage requests keep the chair/voting workflow, and initial applications keep their existing screening process.

Use **My Subject Willingness → Edit willingness** on the Tutor Dashboard to change your own subject choices. Only subjects with saved approved qualifications, including inherited qualifications, appear. Choose **Willing to Tutor** or **Unwilling to Tutor**; an unanswered subject shows **Not recorded** with neither selected. Each change saves immediately; check the saved result or error before continuing. Inactive tutors have read-only access. If no subjects qualify, request qualification in **Subject Qualifications**. Willingness does not change qualifications or timetable availability.

Staff can narrow **Tutor Applications** by name or email, application status, request type and requested subject. Filters combine, and the matching count always refers to the complete application queue. **Reset filters** restores all applications. Interview records have their own search and remain visible below the queue; a record's panel link reveals the relevant application.

When selecting interviewers, **Group panelists by subject** puts tutors with recorded qualifications first, using the same grouped selector as tutee assignment. Choose any requested subject or focus on one; qualification labels list the requested subjects each tutor covers. Changing the focus preserves current selections. Other available tutors remain selectable for panel and chair roles. Tutors must have active, non-suspended accounts and cannot review their own additional qualification request. Unavailable existing panelists stay labelled until replaced. Select three to eight distinct panelists and a chair, then **Save Panel**; the server still checks qualification and chair requirements.

### Start tutoring

1. Choose **Become a Tutor** on the home page. Select up to three subjects, explain your qualifications, read the current policy and submit your contact details.
2. The team reviews the application and contacts you for a panel interview. The panel chair schedules the interview and records the decision after voting; this is distinct from the program's HEAD account role.
3. After acceptance, use the registration code or setup link supplied by the team. Verify your email and set your password. An application or roster entry alone is not a login.
4. Use **Dashboard** to check assignments and record sessions; use **Settings** to maintain availability. Accept the current tutor policy when prompted before further participation.

The application explains loading failures and offers a retry. Intake needs configured subjects and a published policy; contact management if it is unavailable. Repeating a tutor or crew application while that email's application is under review keeps the original submission and displays the same confirmation. It does not replace your answers or send the team another notification. Contact the program team to correct an application. If management also granted you tutor participation, use the account menu to switch between management and tutor areas. Active crew members and assigned translators retain their return links when using the tutee workspace.

Management records actual interview completion through **Tutor Applications** in the Tutors navigation group. **Tutee Support** remains in the management layout and is reachable from the Tutees group. See the [full function and control reference](program-reference.md).

### Record a session

1. Confirm the assigned tutees, actual date, start/end time, and room or online status. Future school dates cannot be submitted. An assignment marked **Awaiting schedule** has no default appointment time. Enter actual start and end times, including when such an assignment is added to a combined block; recording attendance does not set its recurring schedule.
2. Record your attendance and each tutee's actual attendance. Supply comments, reasons for your absence or excused student absences, the requested session ratings, and reasons for requested disciplinary cards.
3. Read any room-conflict warning. A truthful historical report is allowed and alerts management; it does not reserve a conflicting room for a future session.
4. Submit once and check the saved record. If the result is unclear after a network error, check the record before retrying.
5. Ask management for a historical correction with the date, affected record and reason. Attendance and patrol corrections wait for Head approval when submitted by Admin or an eligible Coordinator.

Current tutor-policy acceptance is required for attendance submission. Your service hours are calculated from the saved attendance; see [session-hour examples](../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual).

Use combined attendance when several assigned subjects share one block: shared time and each distinct student count once. An identical retry does not create another credit; changed answers for a saved block require a correction. Changing the selected subjects or shifting the time does not permit another submission that overlaps your saved attendance. Ask management to correct the existing block; corrections cannot overlap another saved block. Adjacent, non-overlapping sessions remain valid. Present, rescheduled and extra sessions use the same calculation. Online sessions have no physical room check.

### Manage your participation

In **My Availability**, select your time slots and choose **Save Availability**, or **Cancel** to restore the last loaded selection. Choices stay fixed during saving. If the save succeeds but refreshing the result fails, use **Retry** to load the accepted selection before editing again; it does not submit another save. A failed save keeps your draft available for correction.

An active tutor can request opt-out and recall a pending request. Participation continues until staff approval, which is allowed only after seven days. An opted-out tutor can request reentry without another waiting period, but approval is still required. Only one pending membership request is allowed. At a semester refresh, continuing active tutors become pending and choose whether they are available or opting out; check your status before teaching in the new period.

For a student enrolled outside the survey flow, the tutor can relay the student's request to leave their current active assignment. The seven-day recall window ends in automatic processing unless recalled or cancelled by staff. If the program refreshes or the originating assignment is removed before processing, the outdated relay is cancelled and does not remove a new enrollment. Survey students instead request whole-period withdrawal in their own workspace. Use schedule rejection for an assignment conflict.

### Conflicts, meetings and interviews

- If an assigned tutee’s availability cannot work, submit a reasoned schedule-rejection request. The assignment continues until approval.
- Submit or cancel your own meeting excuse at least **60 minutes** before the start. The first three unexcused tutor-meeting absences in a semester have no automatic deduction; each further one deducts **0.25 hours**. Excused absences do not consume this allowance. Staff-recorded statuses require staff correction.
- On an interview panel, review the application and submit your own vote. Every panelist must vote before a final decision. The majority decides; a tie is resolved by the selected highest-ranking management chair.
- For an initial tutor application, a chair who is not Head submits the outcome for Head approval. The reviewer preserves the chair’s decision and identity. Hours are earned from recorded interview completion and attendance, not scheduling alone.

Read addressed announcements and acknowledge them when prompted. Review session hours, interview credits, meeting deductions and manual adjustments in your period totals. See the [tutor policy draft](../prisma/policies/tutor-policy.en.md) or [中文辅导伙伴政策草案](../prisma/policies/tutor-policy.zh.md); follow the school's published version when participating.

## Crew

Apply at `/crew-signup` and verify the emailed code. Verification sends the application for staff review; it creates no login or crew membership. An application under review keeps its original answers when retried. Contact the team to correct them.

To check an application, enter its email on the same page and verify a fresh mailbox code. Pending and rejected applications show their status without an invitation. Staff approval remains required. An approved application with an available invitation opens the shared receipt popup: copy the code, optionally email it, or continue to `/register-account` with application details prefilled. A new account creates missing credentials; an existing account reviews the approved Crew addition while keeping its password, identity and other access. Close and reopen the receipt without repeating that mailbox check. If the approval's invitation was revoked, expired or already used, follow the displayed guidance or contact the team; checking status never grants membership. Resending or editing the email requires a new verification code.

Active crew members use **Patrol** to record each visited room once with the actual observation time and student headcount: 0, 1, 2, 3 or 4+. Submit at least one observation. Observation times cannot be in the future; a one-minute allowance accommodates differences between your device clock and the server. This also applies to management corrections. An eligible sweep earns **0.5 crew service hours**, separately from tutoring credit, at most once every **20 minutes per crew member**, measured by the server. All observations must be from the last 20 minutes (with the same one-minute clock allowance). Older observations and additional sweeps during the cooldown are still saved with **0 hours**, and the success message states that no hours were added. A long sweep or offline submission with any observation older than 20 minutes therefore retains its evidence but receives no automatic credit; do not change observation times to claim freshness. A sweep reserves every 20-minute observation interval it covers, across all rooms; changing notes, counts or a request key does not reopen those intervals. An identical retry returns the original record. Combined-account history shares the same allowance; corrections retain hours and prevent reuse of both original and corrected evidence. Report mistakes to management with enough context to identify the record. Historical patrol corrections require a reason and audit evidence; Admin and eligible Coordinator corrections wait for Head approval.

Crew access depends on membership and the program's crew module. A crew-only account does not automatically receive tutor assignments or management powers. Opt-out requires a seven-day wait and staff approval; reentry requires approval without that wait. A pending opt-out can be recalled. Check the decision before assuming membership has changed. Observations can flag an apparent attendance mismatch for [management review](program-reference.md#review-attendance-flags); a flag alone does not impose a penalty.

## Coordinators

Use the [management responsibility matrix](program-reference.md#management-responsibilities-and-review)
to distinguish daily operations from sensitive changes. Daily changes are reviewed by Admin/Head;
eligible reversal requests go to Head. Significant settings and staff account/profile/role edits
are read-only for Coordinators. Tutor/Crew registration requests retain Head review, while
management-role invitations may be requested only by Admin.

Coordinators prepare management changes and learn through review. Their own authorized tutor or crew duties continue normally.

### Submit a change

1. Open the relevant management page and inspect the current record.
2. Enter the proposed change and any required reason. For tutee assignment/review actions, read the consequence dialog and wait for confirmation.
3. Submit. **Submitted for Review** means no live management change has been applied. The request identifies its authorized reviewers.
4. Follow **View request** to **Management Actions**. Read the action title, **Affected record** and **What is requested**. For edits, compare **At submission** with **Requested**; unchanged submitted values are in a separate disclosure. You can withdraw your own pending request.
5. Read the reviewer’s note. Check the live record after approval; an email-delivery warning may still require a link resend.

Requests cover assignments, schedules, eligible participation decisions, content changes, corrections, discipline, hours, interview completion and other supported management operations. Head reviews reversals and access grants. Staff account/profile/badge edits, program settings and refresh require Admin submission and Head application. Leadership transfer retains its dedicated controls. Sending an existing verification/setup link is a supported direct action and does not extend a verification deadline.

If records change while a proposal is pending, the reviewer must reject it and request a fresh proposal. Do not reuse old values or assume a withdrawn/failed request changed the website. See [approval troubleshooting](#troubleshooting).

**At submission** and **Supporting records from submission** show saved historical evidence, including when reading an approved request. They do not claim to show today's live records. **Not recorded in this request** means the old evidence is unavailable; **Not set** means an available field was empty. Deletions identify the record to remove, and additions show the values to create.

Reviewers enter **Your decision note (required)** before either decision. **Approve and Apply** executes the action being requested. If that action is **Reject the underlying request**, approving the proposal applies that rejection. **Reject with Feedback** declines the management proposal without applying it. Head-only and own-request restrictions are explained beside the request; the existing consequence and qualification confirmations still apply.

## Administrators

Apply ordinary daily operations directly and review Coordinator requests. For significant program
settings, staff profile/academic/username edits, roles and reversals, use **Request Head review**.
No live change occurs until Head applies it. Requests notify every eligible reviewer. Registration
codes for Tutor/Crew may be issued directly by Admin; management codes require Head approval. A queued message is
distinct from **Changes saved**; follow its request link to see the decision and audit evidence.

### Review a coordinator change

1. Open **Management Actions**, select a pending request and inspect its values and recorded evidence.
2. Check the affected tutee/tutor, program period and consequences.
3. Enter an explanatory review note. Choose **Approve and Apply** or reject with feedback.
4. For tutee actions, complete your own fresh timed confirmation. The coordinator’s earlier confirmation cannot stand in for yours.
5. Check the applied state and audit link. If the target changed, reject and request a fresh proposal. If application fails, the request remains pending; do not report it as approved.

Use the request state and **Requested by** filters to find proposals; the coordinator’s **My Approval Requests** shows their own history. **All Requests** returns from a detail to the queue. Requester labels retain readable identities even when an account has been removed. Only the current active Head may review their own proposal. Other reviewers cannot, including after promotion to Admin. A coordinator interview chair remains the author of their proposed outcome. A failed email after a successful assignment does not undo that assignment; use the link resend control and investigate delivery.

### Reviewing your own management requests

Admin and Head can review eligible ordinary Management Actions. Only the current active Head can review significant settings, staff profiles/roles/badges, code grants and reversals, or their own pending requests. Other reviewers cannot decide their own requests, including after promotion to Admin. Current database permissions apply after promotion, demotion or suspension. Head self-review preserves required notes, consequence confirmations, stale-record checks and atomic application; requester and reviewer audit identities remain recorded even when they match. This exception applies to Management Actions, not participant interview voting or qualification decisions.

### Significant settings and pending requests

Program intake timing and preview links, staged modules and refresh, CAPTCHA, program email delivery, secondary-email binding, name/grade policy, signup requirements, school calendar, feedback sharing, policy publication, language visibility/order/deletion and messaging contact permissions require Head application. Admin can submit supported requests; Coordinators have read-only controls. Creating an untranslated language catalog retains the separate explicit Translator capability and does not publish it.

A settings request leaves the effective switch, schedule and policy version unchanged. The editor shows a pending review status rather than a saved confirmation. Failed writes and queued requests preserve the original draft; use an explicit successful Reload to replace stale evidence. Approved module switches still take effect at program refresh. Requests notify every currently eligible reviewer once.

### Configure signup forms

Open **Management → Signup Forms** and choose Tutor signup or Tutee signup. Head and Admin can open **Configure** beside an existing field and choose Required, Optional, or Hidden. Head applies directly; Admin uses **Request Head Approval**, preserving the draft and live settings until approval. Coordinators can review settings but cannot submit them. Applied changes affect new submissions, including a form opened before the change; reload that form if validation reports changed requirements. Existing submissions and their original answers remain unchanged.

Name, sign-in email, the first subject and policy acceptance are locked as visible and required. Additional subject choices can be configured independently, without reordering or adding fields. Required qualification questions ask for an explicit Yes or No, not a positive qualification. Grade, AP score and self-study details are required only when their visible parent answer is Yes; AP questions apply only to AP-scored subjects. Hidden questions and their dependent details cannot block submission.

Visible fields show translated **Required** or **Optional** text beside the label. On the tutee form, hover, focus or tap the email label to read its guidance; Escape or an outside interaction closes it.

Program secondary-email binding settings do not disable the required sign-in email. These forms contain no secondary-email field; additional addresses are managed after account setup, subject to the program switch. The configuration popup supports keyboard navigation, Escape to cancel, and returns focus to Configure when closed.

### Names and academic details

Profiles and signup forms have **First Name**, **Last Name**, **Preferred Name** and **Name in Another Language**. First, last and preferred names use Latin letters, including accents; spaces, apostrophes and hyphens are accepted. Name in Another Language accepts other writing systems. Required/Optional markers show each form's requirements. Existing unsplit names remain visible until the person or staff supplies explicit fields; the system never guesses a split.

In **Program → Names and Grades**, Head can apply **Use preferred names** and **Show names in another language** independently; Admin can draft each choice and request Head approval. The first setting uses Preferred Name instead of First Name, retaining Last Name; when blank, it falls back to First Name. The second appends the additional name when supplied. A live example previews the result. Turning either setting off retains the saved text. Coordinators can view these settings. Display changes apply to current profiles and rosters; historical submissions, signatures and audit snapshots retain their original names. Usernames do not change. If Head applies another change while a settings draft is open, explicitly reload and review before resubmitting. The same section controls offered grades (at least one of Grades 1–12).

**Use preferred names** is on by default, while **Show names in another language** defaults off. Upgrades enable preferred names when no administrator has saved the name-display settings, and preserve administrator choices recorded in the audit history. Head can apply the setting here; Admin can request Head approval. An empty preferred name uses the saved First Name and Last Name as the fallback.

### Find records and confirm saves

Tables show brief information for scanning. Use the text links in the rightmost **Actions** column to open full details or an editor. On a narrow screen, that column stays reachable while the other columns scroll sideways. Closing a detail dialog returns you to its link. Detailed report exports and printed history retain their full content.

Profile sections save independently. While any section inside an editor is saving, its fields and the editor's dismissal controls are temporarily unavailable. A failed save keeps your draft for correction or retry. After a successful profile or Head username save, that section automatically refreshes and becomes editable again. Other sections keep their unsaved drafts and errors; they are saved only when you choose their own Save. You can make another change without closing the editor or choosing a restart action. If refreshing fails after the save was accepted, the section stays read-only and shows a separate warning. Choose **Retry refresh** to reload the accepted values without submitting the change again. Choose **Close** when you are ready. Closing a nested review returns to the profile rather than closing both. In **Names and Grades**, retrying a failed background refresh keeps unsaved choices; **Reload** after a version conflict replaces them only when the new settings load successfully.

Roster course counts open their full lists from **Actions**. Contact, account details and historical records remain separate links with their existing access rules. Read-only history tables scroll horizontally and can be focused with the keyboard; they do not need an action column. Public history and invitation pages include a language selector and a return link.

On desktop, the navigation and content scroll independently. On mobile, open **Menu**, choose a page, or close it with Escape. Navigation follows your role and enabled modules.

**Changes saved** appears after a successful write. A persistent error needs attention even if a later edit succeeds; check the affected record before retrying. **Submitted for Review** means a request is pending. This includes Admin requests to Head and Coordinator requests to Admin/Head; live records remain unchanged until the authorized reviewer applies it.

**Users & Roles** separates **User | Login setup | Roles & participation | Actions**. **Setup complete** means a password is set, the primary email is verified and no password change is required; this is not a guarantee of current access. **Setup incomplete** means a login exists but that predicate is not satisfied. **Invitation pending** means a tutor record has a matching unused, unexpired invitation; **No direct login attached** describes the attachment only, not historical ownership. Suspension appears alongside setup rather than replacing it.

Management badges (Head/Admin/Coordinator) use indigo, participation (Tutor/Tutee/Crew) uses teal, Translator uses amber and exclusive read-only Viewer uses slate. Text labels remain authoritative. A Tutor badge does not mean ACTIVE lifecycle or assignment eligibility, and Crew membership can be inactive. The summary keeps its existing Tutor-over-Tutee display; **User details → Permissions and memberships** shows both accepted memberships independently, with policy evidence.

**User details** loads only when opened and separates Login, Permissions and memberships, Attached participant profiles and Historical records. Current account academics and each participant record's academics remain separate. Historical grades and class years use the original enrollment period, including preserved evidence for reactivated profiles. Several retained archives can sit beside a direct profile. A tutor record without a direct login can still display its retained historical owner. Authorized tutor details and tutee history remain available from each record's rightmost Actions column. Historical linking stays in **Edit profile**.

This is a mixed account/tutor list, not a complete person directory: accountless tutees remain in **Tutee List**. The count states how many source records match and how many are hidden by filters. **Which account pathway should I use?** explains tutee request/email confirmation/setup; Tutor/Crew application and invitation; management invitations; public Viewer signup when enabled; existing-account membership/policy acceptance; unfinished setup versus Forgot password; exact-record history claims and historical tutee account setup; and Head-reviewed Combine accounts. Existing-account invitations preserve credentials and existing access; only the authorized participation or management upgrade is added after explicit review.

In **Users & Roles**, combine Role and Account filters. **Tutor Status** appears only when Tutor is the sole included role and Tutor is not excluded. Selecting multiple roles, removing Tutor, or excluding Tutor clears the status selection; a hidden or previously saved status never narrows those results. A person with Admin and Tutor badges still matches a Tutor-only selection, unless another selected exclusion removes them. Historical tutor links with revoked access or archived tutors do not grant a Tutor badge. Alternatives within one filter match any included value; every applicable filter must match, and exclusions win. **No account role** identifies records without displayed role badges.

**Show historical records / Hide historical records** controls Archived/Graduated tutors and historical-only tutee accounts. Verified accounts with another current management, viewer, crew, translator, tutor or tutee capability remain visible. Unverified logins are hidden separately; use **Show unverified accounts** or an explicit account-setup filter to find them. An explicit Tutor Status include for Archived or Graduated reveals those historical records even without a current Tutor badge, but does not override the unverified filter. **Clear filters** restores both visibility defaults. Filters are remembered for the signed-in account in the current browser, with inapplicable status selections removed on restoration. Account data remains available only to Head, administrators and coordinators; filter selections do not grant access.

Use **Edit profile** to edit the independent Tutor, Tutee, Translator and Crew badges and exact management rank, or transfer leadership with **Make Head**. Only Head applies badge and management-rank changes; Admin can submit proposals and Coordinators cannot submit them. Participants with no management rank can request their own participation badges from Account settings; those requests cannot grant a management rank. Staff use Users & Roles for permitted changes. Viewer is exclusive of every other badge. Removing participation and assigning sole Viewer preserves historical identity links while revoking participant access. Tutor membership suppresses the redundant Tutee badge without discarding consent. Use **Edit profile** to update linked current names and **Show email** to inspect/copy the contact and its verification state. Opening the dialog sends no email. Verification/setup requires an explicit action; sending a link does not itself verify an account. **Account setup required** identifies contacts without a linked login. Verified account email changes use the account holder's verification flow.

Account setup links are sent privately to the account holder by email. Management cannot copy the password-setting link from the website. If mail delivery is unavailable, ask the deployment administrator to configure it before retrying.

### Combine duplicate accounts (Head only)

In **Users & Roles → Combine accounts**, select the **Login to keep** and the
**Duplicate login to retire**. Use this only after independently confirming they
belong to the same person. Matching names or addresses never combine accounts.
Choose **Preview combine** to review the retained email/username, membership,
linked profiles, counts of retained history, and blocking conflicts. Confirm the
review checkbox and enter your own Head password to perform the combine.

The retained account’s First Name, Last Name, Preferred Name and Name in Another Language
become the linked current tutor/tutee profile names. Original intake and signature snapshots stay unchanged. The retained
account keeps its password, primary address, verified secondary
addresses and security preferences. Duplicate identifiers remain reserved for
historical identity; they cannot sign in or recover the retained account. Its
sessions and recovery/verification links are revoked. Original messages, policy
signatures, academic confirmations, patrol authorship and audit evidence retain
their original account IDs; the retained login can access that history. Notifications
and tutee ownership pointers move to the retained account. The combine records the
Head and both identities in the audit log in the same transaction.

Conflicting management/Viewer ranks, tutor or current tutee links, academic details,
crew states, messaging permissions/restrictions, suspensions, and pending requests
must be resolved explicitly first. Participant memberships can be consolidated only
as shown in the preview. Leadership must be transferred before retiring a Head.
Changed account details require a fresh preview. Combined identity records cannot
be deleted or restored; combining an already combined account requires a reviewed
data migration. Accounts with school-departure history, including reviewed returns,
also require a reviewed data migration that preserves departure decisions and access
revocations. Original identifiers are never assigned to another person.

### Past tutor records and unlinked profiles

Current-work tutor lists hide Archived and Graduated records by default. Use **Show past tutors** in the Tutors roster, Attendance tutor filter, Hour Adjustments selector, the Tutees tutor view or an expanded Meeting attendance editor when you need them. Hiding past tutors keeps an already selected tutor visible. Existing pairings and recorded meeting attendance retain their tutor names; historical reports and summaries retain all records. Assignment selectors continue to enforce their existing Active-tutor eligibility rules; revealing a record does not make it eligible.

In **Users & Roles**, use **Show historical records** and choose **Edit profile** on an unlinked tutor row. Head can correct First Name, Last Name, Preferred Name, Name in Another Language, email and grade in the same editor used by the Tutors roster; Admin can submit those changes for Head approval. Coordinators can inspect roster details but cannot open profile editing controls. Head can also correct its username; the shared username rules and uniqueness checks apply. Profile edits and status changes submitted by Admin retain Head review. Saving leaves the record unlinked and preserves its selected status: it does not invite, create a login or reactivate the tutor. After saving a valid email, the same row enables **Send setup link**, which remains a separate action. Identifier conflicts and stale edits show an error. Linked account email changes continue through verified account settings.

### Link historical tutor records

For an accountless archived tutor, use **Tutors → Show past tutors → Edit Profile →
Link Historical Records**. Admin or Head reviews an existing verified account and
identity evidence before confirming. Several archived tutor records may belong to
one login without replacing its current tutor profile or reactivating the archives.
Head password confirmation is required to correct a retained owner. See the
[archived tutor procedure](historical-participant-transition.md#link-archived-tutor-history).

### Find and batch-edit offered courses

In **Subjects & Levels**, use the **Offered Course Catalogue** above the subject groups. Search names without regard to case, choose a configured level (or **No level**), and choose **All statuses**, **Active** or **Inactive**. Filters combine, and the count shows matches out of the full catalogue. **Clear filters** restores all rows. Filtering is available to read-only viewers and never changes signup offerings.

**Select all visible** selects only the matching rows. The selection summary shows the total and how many are hidden by filters; **Clear selection** removes both visible and hidden selections. Choose a batch level and/or status and use **Apply to … visible selected**. Only those visible selected courses are changed; hidden selections remain. Successful changes clear the submitted selection, while failures preserve it for retry. Group editing and JSON/CSV import remain below the table.

### Run the program

- In **Meetings**, open a meeting to edit attendance, choose statuses, then use the attendance save action. On a narrow screen, individual records show labels and keep their actions visible. The multi-meeting comparison remains a table; scroll its own region horizontally to compare columns. Deletion opens a confirmation that names the affected meeting; cancel returns to the same record.
- In **Landing Editor**, use the section tabs to move between layout, fixed content, sections, news, pages and images. With a keyboard, arrow keys move between tab labels; Enter or Space opens the focused tab. If your role lacks editing access, the page explains this and offers a return to management. A failed load shows an error and retry action instead of an indefinite loading state. Editor access follows the same permission rule as landing preview.

In **Tutors**, choose **Add Tutor** beside the page title to open the creation dialog. The roster stays visible underneath. First Name and Last Name are required; Email and Grade are optional. An omitted email keeps the new roster record accountless until a separate setup step. On wide screens the contact controls sit beside the name fields; on narrower screens they follow them. **Close** or Escape keeps the draft until you leave or reload the page. A successful save clears the draft, closes the dialog and returns focus to **Add Tutor**. The dialog stays open while saving, and failed saves keep your entries with the error shown inside the dialog.

In **Tutees**, use **Current**, **History** or **All Records**, then **View details** in the rightmost Actions column. One large reader shows the enrollment summary, first and second subject choices, email/account information and tutoring history. Staff can copy the email, inspect attendance and compare original enrollment academics with current account academics without opening separate dialogs. **Previous** and **Next** page through history; **Retry** reloads a failed history read while the other sections remain available. **Close** stays reachable while scrolling. Read-only observers see the enrollment summary and subjects; private contact and history remain restricted.

Accountless tutees remain in this roster, even though they have no Users & Roles entry. A missing email is shown explicitly. Linking historical ownership alone does not enable current-account verification controls. **Refresh** reloads roster and related records. Admin/Head can review history links and invitations inside **Edit Profile**; see the [historical participant workflow](historical-participant-transition.md). Search matches saved first, last, preferred and additional-language names, including full first/last and preferred/last combinations, regardless of name display settings. An empty roster view is distinguished from a search with no matches.

Older profiles may retain a full name without separate first and last names. Leave those Latin name fields unchanged to save notes, contact details or a name in another language without replacing the original identity. This also applies to tutor and account editors, including account settings. Changing First Name, Last Name or Preferred Name requires a valid Latin First Name; enter the person's actual name rather than guessing how an old full name should be split.

The roster and search appear first, with a loading message until records arrive. Choose **Add a Tutee** beside the title to open the entry form. Names, grade/subject choices and actions appear in separate groups. **Hide form** preserves names and choices while you stay on this page; reopening restores the draft. Latin name fields reject other writing systems before submission; **Name in Another Language** accepts them. While saving, the fields and hide actions are disabled. A failed save keeps the draft and error available for correction and retry. Coordinator proposals show an approval status and retain the editable draft. Successful creation clears and hides the form and returns focus to the add action; reopening clears that save's confirmation. Required/optional markers and validation still apply. Historical linking remains inside **Edit Profile**.

In **Subject Availability**, expand a tutor to reveal **Qualified**, **Pending Review** and **Willing to tutor** filters. One filter can be active per tutor; click it again to clear it. These combine with the page search/filter. Pending Review includes pending qualifications and open additional-subject/higher-level requests.

- In **Tutor Roster**, choose **View user details** beside **Edit profile** in the right-hand row actions. Rows show grade and expected graduation; the reference school year remains available in full details and profile editors. HEAD, administrators and coordinators can inspect grouped subjects and named level variants, saved approval/inherited qualifications, and independent tutoring willingness. **Not recorded** means no willingness choice has been saved; qualification alone does not mean willing. Catalogue reordering does not change saved qualification grants. Only subjects with recorded qualification or willingness appear; unrelated catalogue entries are omitted. Archived subjects with recorded evidence remain visible. Tutor status, account access, schedules and capacity still constrain assignments.
- The roster details also show linked-login status and the same account-scoped policy history described below, including tutee policy acceptance. Unlinked tutors have no account acceptance history. Revoked tutoring access keeps historical evidence but removes the Tutor badge; active Tutor membership suppresses a redundant Tutee badge. Opening details grants no role-edit permissions. Viewers cannot open these private details.
- Maintain subjects, slots, rooms, rosters and assignments; check current intake and availability before matching. Use the [program configuration guide](program-reference.md) for schedules, timezones, announcements and contact permissions.
- Use **Tutee Support** for feedback visibility, tutee appeals and school-calendar overrides. Staff see pending appeals first, can switch to resolved history, and each list has its own page navigation. Calendar overrides affect the five-school-day appeal window.
- In **Users & Roles**, open a person's **User details** to read their policy acceptance status and history. Expand an acceptance to read its original title, version, signature, time and exact text in each recorded language. This works for linked accounts with missing email; unlinked contacts have no account acceptance history. Only HEAD, administrators and coordinators can access these records.
- Assign interview panels with at least three active tutors, a management member, and staff-confirmed qualification in an applicant subject. The highest-ranking management member chairs the panel (HEAD, then ADMIN, then COORDINATOR); choose a chair among equal ranks. Use **Subject Availability**, immediately below Tutor Roster, to review subject groups and variants, direct approval status, recorded inherited qualifications and independent willingness to tutor. Missing willingness means not recorded; approving a subject never records willingness. Expand a tutor to approve a subject, remove an approval source or record willingness. Approving an advanced variant records the lower offered levels of its group at that time; later catalogue reordering does not change those grants. Removing one source does not remove qualifications granted by other sources. This screen remains available when interviews are disabled. Use **Tutor Applications** for panel assignment, votes, decisions, completion, duration and attendees. Applicant summaries show status, panel, chair, schedule and completion without expanding. Search applicants, panelists or subjects and switch between open, completed and all records. Expand an interview record and follow its panel link to the applicant editor on the same page. Interview history remains readable when interviews are disabled; completion and panel writes are disabled. Correcting an already completed interview replaces earlier automatic credits and requires Head application; eligible Admin/Coordinator corrections wait for Head review. Panel qualifications, voting and chair authority still apply.
- Correct historical attendance or patrols with a reason. Review hours, discipline and related effects after the correction; HEAD receives an in-system notification.
- Use **Policies** to publish revised documents following the [publication steps](policies/README.md#publish-a-revision). On a fresh site, start with the blank **Tutee Policy** and **Tutor Policy** editors and save the reviewed English text before adding translations. Updating repository files alone does not change an already running site.
- Use **Audit Log** to filter by actor, event, operation, record or UTC date. A proposal and its applied action are distinct events. Actor filters use stable account identities: matching names stay separate, and removed users appear as Former account.

In **Audit Log → Actions → Details**, Head, Admin and Coordinator can inspect the
recorded actor and account ID, event and target IDs, operation, exact timestamp
(including UTC), approval link and undo time. Recorded before/after values and other
evidence are shown as readable fields; the stored field names remain visible.
Open **View stored JSON** to distinguish exact value types and escaped text.
Missing detailed evidence is explicitly identified: older events and generic
operation summaries may never have recorded it. Details do not reconstruct past
values from current profiles. Observers retain the restricted summary. If a detail
read fails, use Retry; this only reloads the event and never repeats its action.

### Signup request tabs

Signup Requests includes self-service and **Staff-entered** requests in the same tabs and counts. The source badge describes how the signup was entered; it does not change approval status, priority or participation rules. **Earlier signup** means the original source cannot be confirmed. Staff can still enter tutees through the roster. Needs matching includes empty or partially assigned requests; Assigned contains requests whose requested subjects all have tutors. Sources keep their original submission order. Needs review contains pending review decisions; Processed retains closed requests and completed review history.

Course-aware tutor selectors in Signup Requests and Pairings list tutors with approved, recorded subject grants first, followed by a separate unqualified group. Inherited grants remain valid after level reordering. Choose the subject first in Pairings. Assigning an unqualified tutor opens a warning naming the tutor and subject; confirmation becomes available after three full seconds. Cancel or change the selection to discard that acknowledgement. Coordinators still submit proposals, and the reviewer must confirm any remaining qualification mismatch independently. This override does not waive active-tutor, request, permission, or scheduling checks.

### Review withdrawals and membership

Staff use **Withdrawal Requests & Removals** to review self-submitted requests and their decision history. Tutee requests show their source, scope, submission time and approval-dependent effective date. Tutor-relayed withdrawals remain in a separate section with their existing seven-day recall window and exact scheduled effective time. Tutor relays remain available; staff can cancel them before they take effect.

Tutor and crew opt-out/reentry requests remain pending until reviewed. Opt-out approval requires seven days to have elapsed; reentry has no seven-day wait. Recall controls depend on the request type; crew members can recall a pending opt-out. After approving a tutor opt-out, use the explicit student-requeue action to return affected students for matching. If the member's status has changed since submission, decline the stale request and review the current roster.

### Review records and reports

Corrections to tutoring attendance, patrol observations, recorded meeting attendance and completed interviews may reverse reviewed flags, deductions or earned credits. Head applies the whole correction and its dependent consequences; Admin and eligible Coordinator submissions wait for Head review. Restoring hidden messages, archived news or announcements, reinstating participation and overturning a reviewed discipline decision follow the same Head authority. Initial attendance entries and other eligible daily operations retain Admin/Head direct authority and Coordinator requests. Withdrawing an unapplied request is distinct from reversing an applied action.


**Service Hours** keeps each tutor's total and Details action in the compact
summary. Expand **Compare Hour Breakdowns** to compare earned hours, extras and
penalties across tutors. On a narrow screen, scroll inside that labelled table;
keyboard users can focus it and use the left/right arrow keys.

Use [Attendance Flags](program-reference.md#review-attendance-flags) to assess crew evidence before applying a decision. Use [Reports](program-reference.md#reports-and-exports) to choose a period, review totals, download table CSVs or print a report. Check the privacy setting before sharing. Audits and policy acceptance history remain separate evidence views.

CSV exports preserve numeric quantities and quote names or comments containing commas, quotes or newlines. Text beginning with spreadsheet formula markers or control characters receives a protective apostrophe so it is treated as text on initial import. That apostrophe may be visible in other CSV readers; preserve it when handling the export. Spreadsheet edits or re-saving the file can change how another import interprets it.

### Management registration codes

Registration Codes supports Tutor, Crew, Admin and Coordinator invitations. Every code grants only its displayed role. Head can issue directly. Admin can issue Tutor and Crew codes directly, and request Head approval for Admin/Coordinator codes. Coordinators can request Tutor and Crew codes for Head review but cannot request Admin/Coordinator grants. Direct issuance and reviewed issuance are recorded in the audit log. Only Head can list or share management codes; Admin may request Head review of their revocation. The selected role appears in the list, share card and every redemption step after code validation. There is no Head code; leadership transfer remains separate.

Use **Export Image** beneath a newly issued setup card, or expand an active code
and use the same action, to download `account-setup.png`. The image contains only
the setup card: programme title, role, code, registration address and expiry. It
keeps the current language and accent on a white background, at twice the displayed
resolution, with a small white margin outside the card border. Labels, emails
outside the card and action buttons are excluded.
Exporting does not change the code or its expiry; share the image only with its
intended recipient. If export fails, the card stays available so you can retry.

Admin/Coordinator redemption requires email verification. A new account receives management access without Tutor, Crew, Tutee or Translator participation. An existing primary or verified-secondary email owner reviews the authorized upgrade using the same account: credentials, identity and participation remain, and the resulting management rank is the higher of the existing rank and the invitation rank. A Viewer accepting this upgrade leaves the exclusive Viewer role. A Coordinator invitation cannot demote an Admin or Head, and no invitation grants Head authority. Expiry, rate limits, email binding and single use remain enforced, and issuer/recipient history is retained. The additive registration-kind migration preserves outstanding Tutor/Crew invitations. Apply migrations before starting the updated application.

## HEAD

Use **Program records** in the management navigation to import historical CSV records or export a ZIP of program CSVs. Both actions, including previews and templates, require HEAD. Start with the downloadable templates, include related files together, review the preview, and confirm the import. Existing records are never overwritten. See [formats, coverage and examples](program-reference.md#import-and-export-program-records). Report-table CSV download buttons also require HEAD.

HEAD has administrator abilities plus the program’s restricted leadership and configuration controls. Use **Users & Roles** for permitted appointments and leadership transfer, and **Program & Refresh** for module and program settings. Confirm consequential actions carefully; switching modules or periods affects what participants can do.

Before opening intake, confirm email delivery, the current policies, subjects, slots, rooms, qualifications, intake timing, school calendar and feedback visibility. Coordinate host, backup and recovery readiness with the technical operator using the [launch runbook](deployment.md).

Head applies the [program refresh](program-reference.md#refresh-the-program) and stages module switches; Admin may submit either for Head review. Refresh advances the period, applies pending switches and changes participation, so confirm the displayed consequences first. A new period preserves historical attendance, policy acceptance and audit evidence. Only Head can apply sensitive configuration, staff profile/rank edits, reversals, role/badge grants and management-role registration-code issuance. Admin can issue Tutor/Crew registration codes directly. Head also provisions new tutor accounts, transfers leadership and deletes eligible accounts; the current Head cannot be deleted. Leadership transfer appoints an eligible administrator or coordinator and makes the outgoing Head an administrator.

### Stable account usernames

Verified participant accounts share one permanent account handle with any linked tutor record.
Invitation redemption, account setup, joining tutoring, re-enrollment, name changes and academic
corrections preserve an established account handle. A new login for a roster tutor adopts that
roster handle. Old linked mismatches are reconciled to the account handle and recorded in the
audit log; if another identity owns that handle, Head must resolve the conflict explicitly.

New handles use lowercase ASCII letters/digits, up to 64 characters including collision suffixes.
Decomposable accents are normalized (`José García` → `jgarcia`); single-token names use the full
token. Names without usable Latin letters may supply an optional Latin spelling at signup or
invitation registration. Otherwise a neutral `member` base is used, without guessed
transliteration. A graduation suffix is only an initial naming hint supported by confirmed grade
and reference year; it is never an academic record and never changes after a correction. Collision
letters/counters disambiguate names while preserving the length limit. Existing handles are not
normalized or migrated by this policy.

Student handles are assigned only after successful survey/email verification. Unverified surveys
and roster-only tutees reserve no handle and gain no tutor access. Email sign-in remains available.
Head can use **Users & Roles → Assign Username** for a verified student missing a handle.
Existing verified STUDENT accounts are assigned only through deliberate Head backfill or verified
re-enrollment, never by opening profile/list pages. VIEWER accounts keep their separate email-only
automatic-allocation policy; an explicitly assigned existing handle remains valid.

### Management username editing

In **Users & Roles → Edit profile**, Head can save a username for any login account, including their own. Use 1–64 ASCII letters or digits; surrounding whitespace is trimmed and letters are lowercased. Taken usernames in either the login or tutor roster are rejected. The linked tutor is updated atomically, so the old handle no longer signs in. Email sign-in, passwords, IDs, badges and history remain unchanged. Ordinary roster name edits retain the username. Admin can submit a username request for Head approval; the current handle remains active until Head applies it. Coordinators cannot submit account username edits. Saves record the actor and old/new handles and refresh the account list and current header. An unchanged save is a no-op. A version conflict requires an explicit **Reload** before retrying; a failed read keeps the username draft and original version. After a successful save, the username section automatically refreshes its current value and version so you can make another change in the same editor. Other sections retain their unsaved drafts; only their own Save submits them.

## Viewers

When Viewer signup is enabled, provide your name, affiliation and email, then verify the emailed code. The invitation popup shows a separate invitation code, optional email delivery and a prefilled link to the shared invitation page. A new account reviews the prefilled details and sets missing credentials. An existing account signs in through the invitation's LOGIN path without adding Viewer or changing any membership; normal recovery and enforced email two-factor sign-in remain available. Initial mailbox verification requires email delivery.

Viewers and departure-based observers can browse permitted read-only management summaries, including names, schedules, statuses, attendance ratings and totals. Contact details, signatures, private comments, absence reasons, application evidence and decision notes are withheld. Audit entries show category summaries; audit search matches actor names, entities and operations rather than private action text. Published policies and announcements remain readable for management observation. These summaries are not anonymous.

Management mutations are unavailable. Observation does not grant private conversations or another person's participant history; your own account and explicitly owned history retain their usual access. Viewer cannot coexist with tutoring, tutee, translation or crew membership. Use **Add access** to accept an authorized participation or management invitation, which replaces the exclusive Viewer role after review. Membership requests in Account Settings retain their existing HEAD approval workflow.

If you need a different role or access to your own participation record, request the change in Account settings. Do not create another account to work around permissions.

## Translators

Translator access requires an explicit HEAD-approved assignment, even for management accounts. **Translations** opens the integrated editor: **Interface text**, **Website text**, and **Draft review**. Management without Translator assignment can review drafts. ADMIN/HEAD also have a **Languages** tab to show/hide languages in the public selector, move them up/down, and remove custom languages. These controls do not require Translator assignment; English remains enabled as the fallback. Assigned translators use the same tab to add languages, which start hidden until Head enables them. Head applies language visibility, ordering and deletion; Admin requests Head review. Choose the correct language and destination, preserve meaning, and submit for review. Interface text submits when focus leaves a changed field; website text has an explicit submission button.

Translator and Coordinator edits create private drafts, including all five text destinations. Only ADMIN/HEAD can approve and publish or reject a draft. Coordinators can **Request Admin/Head approval**, which leaves the draft pending. ADMIN/HEAD with an explicit Translator assignment may also publish their own direct edits; the editor identifies these as live changes. Filter draft review by pending, published, rejected or all drafts. Historical drafts remain available, and old review bookmarks open this editor. If the destination changes before approval, submit a fresh draft against the current text. Translator assignment does not permit structural page deletion, account administration or unilateral policy publication. Policy translations require the separate [policy review process](policies/README.md).

## Account settings and private support

Use **Account Settings** to edit your First Name, Last Name, Preferred Name and Name in Another Language, change your password or request a verified email change. Program settings determine how saved names appear; see [name fields and display settings](#names-and-academic-details). Current explicitly linked tutor/tutee profiles share those names; signed agreements and submitted survey records retain their original text. Editing a contact field is not email verification. Keep account links and codes private. If email delivery is unavailable, contact management; a success message from another action does not prove an email arrived.

**Add access** appears in the account menu and Account Settings. It opens `/register` to accept an invitation for the signed-in account. Review the exact authorized access before accepting; entering or inspecting a code does not grant it. Existing credentials, identity, participant history and other access are preserved, subject to the exclusive Viewer transition. Management upgrades never lower an existing rank. Switching accounts and verifying email remain distinct requirements; participation grants also retain policy and school departure checks. School departure alone does not block an authorized management rank upgrade.

An invitation can finish creating or linking a login while an old or conflicting academic report still needs confirmation. The completion screen directs you to **Account Settings → Academic Details**. After confirming, tutors complete the normal dashboard activation; crew members request reentry from the crew workspace. Crew access remains opted out until that request is approved. Previously inactive crew accounts remain inactive and need staff restoration. Optional unknown or nonstandard grades do not prevent participation. An explicit conflict with a previous **Not Applicable** report does require review.

**Academic Details** is shared across Account Settings, tutor Settings and staff **Edit Profile** dialogs. It is available to tutees, tutors, crew, management and accounts with multiple participation types. Choose **Review Academic Details** or **Edit Academic Details**, select one of the program’s offered grades, then confirm. The current program school year is filled automatically and cannot be edited. This is self-reported information: participants can correct their own records. Head corrects other accounts directly. Admin requests Head approval for staff corrections; Coordinators cannot submit account academic edits. Confirmation History records the reported values, date, source and optional correction context.

Expected graduation is the reference school year's ending year plus the remaining grades through Grade 12. For example, Grade 10 in `26-27` gives 2029. It is an estimate, not a separate editable graduation field. Grades do not advance automatically: after a gap, repeated year or new school year, confirm the grade that actually applies in the current program school year. Stale or imported values are marked for review. Choose **Unknown** when the grade is not known; an imported original grade can still be retained without a graduation estimate. Choose **Graduated** when the student has completed school, or **Not Applicable** for a non-student account. Graduated is an academic detail and does not change tutor participation status.

A form opened before a school-year rollover requires a reload before confirmation. When no current year is configured, staff must set the program period before a reported grade can be confirmed; unknown and not-applicable reports remain available.

Staff **Edit Profile** dialogs show grade, reference year and expected graduation together, independently of tutor participation; tutor and tutee rosters use the same canonical account information. A roster record without an account retains its original unconfirmed grade. Academic saves preserve usernames, participation, signed agreements and historical survey answers. An account without a username explicitly shows **Username not assigned**. If another edit changes the profile while a draft is open, review the conflict and deliberately reload before retrying; unsaved drafts are not silently replaced.

Current account roster cells summarize unknown or unconfirmed grades as **Unknown Grade Level**, followed by **Needs Review & Confirmation**. Historical/accountless tutee enrollment evidence can remain unknown without a current-participation action. Original reports and full academic details remain available in the profile/detail views. Tutee contact/email and academic history share **View details**. Account actions in Tutors, Tutees and Users & Roles use the same compact, right-aligned text stack, with destructive actions in red and larger touch targets on narrow screens.

For period-specific history, management uses **Academic Corrections** to edit selected records or upload a validated correction CSV. Both show the same before/after preview, retain original evidence and reject stale changes. Head applies whole batches; Admin requests Head approval. Coordinators cannot submit historical academic batches. Historical correction dates and reference years are separate from current academic confirmations. Follow the [historical correction procedure](historical-participant-transition.md#correct-historical-academics) for identifiers, CSV limits, provenance and recovery.

The profile section places **Save profile** and **Cancel** after the name fields. Save applies all name fields together; Cancel restores their last loaded values. Saving disables this section while it is pending, and a failed save keeps the draft visible for correction or retry. Password, email and membership controls have their own actions and are not submitted by Save profile.

Changing or resetting your password signs out every existing session, including the browser making the change. Account Settings and tutor Settings return you to Sign In; use your new password. Other browsers require sign-in on their next request. Your account, permissions and tutoring history remain. This update also requires one fresh sign-in for sessions created before session revocation was introduced. Existing email two-factor requirements remain in effect.

Signed-in password confirmations share a limit of ten checks per account within fifteen minutes, including successful checks. This covers password and two-factor settings, email-address changes and privileged confirmations. Switching pages or signing in again does not provide more attempts. If you see **Too many password confirmations**, wait fifteen minutes before retrying; blocked retries do not extend the wait. Other accounts have their own allowance. Sign-in and email verification codes retain their separate limits, and email changes may reach a stricter action limit first.

Password confirmations accept up to 1,024 characters. If an older password exceeds this limit, use **Forgot Password** to choose a replacement of 8–1,024 characters before changing account settings.

Legacy accounts that need email verification or a new password receive a setup link at their existing account email. Open that link to prove mailbox ownership and set the password. The setup page shows your current email address; it cannot be changed there. If you cannot access the address, contact the program team. Two-factor preferences stay unchanged and can be managed after sign-in.

Use password recovery when you cannot sign in. Personal email two-factor authentication requires both the program switch and your account preference, plus working email delivery. If suspended, sign in with your normal password and complete two-factor authentication if enabled; you will be directed to the suspension page to submit or review an account appeal. Suspension continues to block ordinary program access, and a pending appeal does not restore it. This is separate from appealing a student's disciplinary card.

The notification menu shows your own recent notices and unread count. Follow a notice to its related task, mark it read, or mark all as read. Private message bodies and recipient lists are excluded from notifications.

Use **Messages** to send separate private deliveries to allowed contacts. Search by name or username, select up to 20 people, and keep selections while searching or paging. New messages deliver immediately and may be reviewed or hidden by HEAD/ADMIN; reviews and moderation are recorded. Recipients cannot see other recipients or their replies. Historical messages sent under the old participant-only notice remain participant-only. Notifications omit message bodies. Replies follow current permissions; history remains readable after contact eligibility changes. If any selected recipient becomes ineligible before a send, nothing is delivered: review your selections and retry. Retrying the same send does not duplicate deliveries. A messaging restriction prevents new sending and incoming eligibility while retaining history; account suspension instead leads to the appeal page. For a suspended account, use the appeal option on the suspension page. See [contact permissions and supervision](program-reference.md#message-permissions-and-supervision) for management configuration.

**Reply** opens a composer with the sender’s name and username, then moves keyboard focus to its message field. Your general message and other reply drafts remain separate while the page stays open. **Cancel reply** restores the general draft and returns focus to the Reply button. Sending a reply also restores the general draft. Pending sending prevents recipient changes; permission errors offer Retry and keep your text. Drafts are not stored after leaving or refreshing the page.

On the Tutee page, **Messages** and **Account** open inside the same navigation and header. Account settings use your shared profile, verified email changes, password changes and two-factor settings. HEAD, ADMIN and COORDINATOR open Messages inside the management shell at `/admin/messages`. HEAD/ADMIN also have **Message Supervision** for audited review, reversible hiding, messaging restrictions and role/user contact permissions; coordinators cannot supervise other conversations.

### Associated email addresses

**Account Settings** and tutor **Settings** share the **Associated Emails** controls. Only the primary email is required for signup, account setup and normal site use; secondary addresses are optional. An account may have up to five secondary addresses, counting pending requests. Head can disable **Secondary-Email Binding** in **Program & Refresh**; Admin requests Head review. While disabled, adding, resending and confirming secondary addresses is blocked in settings and on the server; existing verified addresses remain usable and removable, and pending requests can be cancelled. Primary-email changes remain available and preserve the previous verified primary. Enter your current password to add an address, resend its code, promote a verified address or remove a secondary. Codes last ten minutes, allow five attempts and have a one-minute resend interval. Expired requests remain visible for resend or cancellation. Pending requests do not reserve an address or prevent its actual owner from registering; ownership is checked again when you verify.

Any verified address can sign in or recover the same account. Recovery requested with a secondary address goes to that address; recovery by username goes to the primary. Login 2FA and password-change codes still go to the primary, so aliases do not bypass 2FA. Changing primary retains the previous verified primary as a secondary and updates only explicitly linked current tutor/tutee contact rows. Account identity, roles, history and signed agreements remain unchanged. Removing an address revokes its outstanding grants; adding it again does not revive them. Select another verified primary before removing the current one.

### Optional email notifications

Email notices include a clear action button and a copyable link, with a plain-text version for mail readers that do not show HTML. Program notices open the relevant workflow; message notices open your role's inbox; account/security notices open account settings. If sign-in or a verification code is needed, you return to the linked page afterward. Older queued program notices may open the home page. Your current permissions still apply, so a removed record or changed role may limit what you can open.

When Head enables **Email Notifications** in **Program & Refresh** directly or approves an Admin request, **Account → Email Preferences** offers private-message notices and information/program updates (both default off). Each category may be enabled or disabled independently. Security alerts for password, two-factor and associated-email changes are essential and cannot be disabled. Private-message notices omit the message contents. By default notices go only to a verified primary; you can also include verified secondary addresses. A primary change additionally notifies the previous verified primary regardless of notification preferences, even if that address is subsequently removed.

On **Program & Refresh**, **Email delivery status** warns when security or program SMTP is not configured or its connection/authentication check fails. It also shows notification emails waiting to retry after a failure and those whose retries are exhausted. **Refresh status** updates this information without sending email or changing program settings; transport checks may reuse a result for up to one minute. Ask the deployment operator to investigate a warning. A successful SMTP check confirms the connection and login only, not that a message reached an inbox. Local development logging is explicitly identified and sends no external email.

After the email service is repaired, ADMIN/HEAD can select **Resend stuck emails** to queue up to 100 eligible failed or retrying notifications. The result confirms queuing; delivery happens through the normal worker and still follows current email preferences and recipient ownership. Emails already being processed or completed are excluded, and optional emails remain excluded while notifications are disabled. If more eligible messages remain, refresh status before queuing another batch. If queuing succeeds but the status read fails, use **Refresh status** to recover without submitting the same action again.


Optional notification emails also include **Unsubscribe** below the footer. The link opens a page without requiring sign-in; opening it alone changes nothing. Choose to stop that notification category or all optional notification emails, then confirm. This changes the account's preferences for both primary and included secondary addresses, not just the inbox that received the link. In-app notifications, account security alerts, verification, password recovery and signup confirmation remain available. You can turn optional categories back on in **Account → Email Preferences** when program notifications are enabled.

Unsubscribe links expire after 90 days. Use a newer notification or sign in to manage preferences if a link is expired or unavailable. Treat these links as private: anyone with a valid link can turn off the optional categories it offers. Emails already accepted for delivery cannot be recalled.

Disabling notifications at program level preserves preferences and cancels queued optional notices; re-enabling does not send the old backlog. While program notifications are disabled, account settings cannot enable or edit notification preferences; a valid unsubscribe link can still turn optional categories off. Verification, recovery, login/step-up mail and security alerts remain independent of both optional switches and personal notification preferences. Already accepted mail cannot be recalled.

## Renewed policy acceptance

On the tutor dashboard, select **current policy** in the accepted-policy message to reopen the latest published policy in a read-only popup. It refreshes on every opening and displays your selected translation, falling back to English. Close it with the close button, Escape, or the backdrop. Viewing does not record acceptance; a newly published revision still requires the usual consent flow.

For both tutor and tutee policies, scroll to the bottom inside the policy text box before checking the agreement. The checkbox is disabled and its label stays gray until you reach the end; it never checks itself. You can scroll using a mouse, touch, or the keyboard after focusing the policy box. A short policy that is fully visible unlocks immediately. Scrolling back up keeps agreement available during that review. Retry, reopening the popup, or switching to another policy revision or translation starts a fresh review.

When a published policy applicable to your linked student or tutor profile changes, a popup opens on your next visit or window focus. Accounts with both profiles review each applicable policy. Read the text in your selected language (or English when unavailable), check the agreement and complete the ten-second confirmation. Use **Retry** if loading or acceptance fails. You may cancel the popup to access messages, account details, personal history, feedback and appeals; new participation still requires current acceptance on the server. The reminder lets you reopen the popup. Already accepted revisions and unpublished proposals do not require renewed consent. Policy editing and publication remain under **Policy Documents**.

Email confirmation and password recovery pages remain available without a policy reminder; current acceptance is still required before participating.

## Troubleshooting

| What you see                                    | What to do                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake has not opened                           | Check the displayed opening time or preview; account creation does not change survey priority                                                  |
| Confirmation link expired                       | Request a new link; use the most recent successfully sent link                                                                                 |
| Verification deadline passed                    | Submit a new request if eligible; resending the old link cannot extend the deadline                                                            |
| A new policy is required                        | Read and accept the displayed revision; history and private support remain accessible                                                          |
| Change is pending                               | Open Management Actions; live records stay unchanged until approval                                                                            |
| Affected records changed                        | Reviewer rejects the stale proposal; the authorized requester prepares a new one using current records                                                      |
| Assignment applied but email failed             | Keep the assignment; resend its verification link and check delivery configuration                                                             |
| Interview decision blocked                      | Check every vote, active panel membership, highest-ranking chair and subject qualification                                                     |
| A permission/page is missing                    | Check role, linked membership, suspension and enabled module with management                                                                   |
| Hours look different from ordinary rounding     | Compare recorded attendance with the [implemented rounding examples](../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual) in the policy draft |
| A correction did not change the expected record | Check approval state, date/program period and the audit trail; ask management to investigate                                                   |

## Report a problem

For a private account, disciplinary or attendance matter, contact management through the website. For a reproducible software bug, use the [bug form](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=01-bug_report.yml). You can also [suggest a feature](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=03-feature_request.yml), [enhance an existing feature](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=02-enhancement.yml) or [request a documentation update](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=04-documentation.yml).

Use synthetic examples and remove tutee names, contact details, private messages, account links and codes from public reports. [Creating issues](issues.md) explains what information is useful.

[Documentation home](README.md) · [Technical report](technical-report.md) · [Policy drafts](policies/README.md)
