# User guide

For searchable English and Chinese task walkthroughs with real development-server
screenshots, explanations, troubleshooting and offline PDF handbooks, open
**Help Center** from the top bar on any page (or visit `/help`). Sign in to
reveal guides and PDF handbooks for your current account and participation. The
[repository catalogue](help/README.md) mirrors the same maintained instructions;
staff can also distribute training PDF handbooks from
**Management → Administration → PDF handbooks**.

Use this guide with the website address supplied by your program. Page names match the interface. Available features and navigation vary when **Head** activates staged program modules at refresh; a hidden page never grants permission to open its URL directly.

## Contents

- [Before you start](#before-you-start)
- [Account invitations and sign-in](#account-invitations-and-sign-in)
- [Sorting information tables](#sorting-information-tables)
- [Graduation and school transfers](#graduation-and-school-transfers)
- [Tutees](#tutees)
- [Tutors](#tutors)
- [Crew](#crew)
- [Coordinators](#coordinators)
- [Administrators](#administrators)
- [Head](#head)
- [Viewers](#viewers)
- [Translators](#translators)
- [Account settings and private support](#account-settings-and-private-support)
- [Renewed policy acceptance](#renewed-policy-acceptance)
- [Troubleshooting](#troubleshooting)
- [Report a problem](#report-a-problem)

## Before you start

Read the **Privacy policy** from the homepage information menu, footer, or `/privacy` without signing in (it stays readable during policy renewal). English and Chinese are provided; other locales show English.

Operators must configure email delivery and publish the school's current policies before opening intake. Repository [policy drafts](policies/README.md) are templates for adaptation; editing a draft does not publish a live policy.

| Your access | Start with | Boundary |
| --- | --- | --- |
| Tutee (any non-Viewer role) | Enter Tutee Page | Your own records and participation |
| Tutor | Tutor workspace (`/dashboard` or `/schedule`) | Your linked tutor profile and assignments |
| Crew | Patrol | Active crew participation (requires Crew module) |
| Coordinator | Management area / Management Actions | Permitted daily operations, settings, profile edits, and reversals queue for Admin/Head review; no management-rank grants or message supervision |
| Admin | Management area | All non-refresh management; official refresh and leadership transfer remain Head-only |
| Head | Program Settings / Users & Roles | Root authority: all Admin powers plus official refresh, leadership transfer, and self-review |
| Viewer | Read-only management area | Permitted summaries with personal contact details masked |
| Assigned Translator | Translations | Edit interface or website text and track draft review; assignment is separate from management rank |

Role and participation are distinct. Management accounts need an active linked tutor profile to tutor. Active non-Viewer accounts can enter tutee onboarding (after a confirmed school departure, a [reviewed return](#graduation-and-school-transfers) is required first). Accepting the published tutee policy grants tutee membership; visiting alone grants nothing. Suspension blocks ordinary participation; sign in to submit or check an appeal on the suspension page.

### How drafts, confirmations, and retries work

These rules apply across the website unless a workflow notes otherwise:

- **Opening or cancelling writes nothing:** dialogs, review steps, and previews never mutate records until you confirm.
- **Drafts stay local to the open page:** failed saves, background refreshes, and switching panels/tabs keep unsaved drafts while the page stays mounted; reloading or navigating away discards local drafts.
- **Pending writes block dismissal:** while a save is in flight, its fields and close/cancel actions stay disabled to prevent duplicate submissions.
- **Retry refresh is read-only:** if a write succeeds but the follow-up refresh fails, **Retry** / **Retry refresh** reloads data without submitting the mutation again. If a read fails, the page shows an error instead of claiming a list is empty.
- **Version conflicts require explicit reload:** when another user updates a record while your draft is open, use **Reload** when ready to replace your draft with the latest saved values.

### Choose the right registration form

Published links use short paths (`/register`, `/tutee`, `/tutor`, `/viewer`, `/crew`), which redirect to their descriptive pages while preserving query parameters. Old `/signup` and `/signup/account` bookmarks remain valid. See the [URL convention](../reference/technical-report.md#public-signup-url-convention).

- **Register with an Invitation Code** (`/register` → `/register-account`): enter a 5-character invitation or staff registration code and click **Continue**. Codes without verified-browser proof require email verification before review.
- **Register as a Viewer** (`/viewer` → `/viewer-signup`): available when public Viewer signup is enabled. Verify your email to open the invitation popup (no staff key needed). New accounts become read-only Viewers; existing accounts sign in without changing membership.
- **Request a Tutor** (`/tutee` → `/tutee-signup`): submit the full tutee application and policy agreement, verify the 4-digit email code (or confirmation link), then finish account review from the invitation popup.
- **Join the Crew** (`/crew` → `/crew-signup`): submit application details and verify your email to queue the application for staff review. Use the same page with a fresh email code to check status or claim an approved application's invitation.

Existing signed-in accounts can use **Add access** in the account menu or **Account Settings** to accept an invitation without changing passwords or losing other access. Editing identity before verification clears verification proof; staff keys bound to an email keep that email read-only.

### Previewing applications outside recruitment

Tutor and tutee forms have separate recruitment windows. Outside an active window (not started, ended, paused, or awaiting setup), you can read the questions and published policy, while response fields and submission stay disabled. Any additional sheet link shown is view-only.

### Retrying public signup

If signup options fail to load, use **Retry** to reload subjects, availability, and policy without submitting. If rate-limited, wait the displayed interval and retry. Retrying an identical accepted tutee submission recovers its acknowledgement without resending email or requiring another CAPTCHA; changing answers is a deliberate new submission requiring fresh verification and consent. Failed verification delivery preserves your original submission and priority—use the resend control instead of submitting a duplicate survey.

### Switch workspaces

Management headers and account menus show **Enter Tutor Page** (requires an active, linked, non-archived tutor profile) and **Enter Tutee Page** (available to eligible accounts even without tutor access). Tutor and tutee workspaces show **Back to Management** for **Head**, **Admin**, **Coordinator**, and **Viewer**. Active Crew members and assigned Translators retain their return links when visiting the tutee workspace.

On desktop, the management sidebar and main content scroll independently. On mobile, use the hamburger menu (closed by Escape, its close button, or selecting a link); workspace shortcuts wrap cleanly below the divider.

## Account invitations and sign-in

All new account creation finishes at `/register-account` (reached via `/register`). An invitation authorizes a specific task; verified email ownership proves who is accepting it. A staff-visible key or copied code alone cannot sign in as its recipient.

| Starting point | Next step | Result after review |
| --- | --- | --- |
| Tutor, Crew, or management staff key | Enter the key and recipient email, then verify the emailed code | Creates missing credentials or adds authorized access to the existing account |
| Tutee request | Submit request + policy agreement, verify email code/link, open invitation popup | Confirms request with original queue priority; assignment remains separate |
| Public Viewer request | Submit details, verify email code, open invitation popup | New address creates a read-only Viewer; existing account signs in with no role change |
| Public Crew application | Verify email to submit for review; after approval, verify email again to open popup | Creates missing credentials or adds Crew participation to the existing account |
| Historical participant invitation | Verify invited email, continue from receipt popup to `/register-account` | Creates/uses credentials, then separately review and click **Link My History** (no current participation) |
| Accountless tutor setup (Admin/Head) | Receive Tutor invitation at current contact email | Roster stays accountless until accepted; no placeholder login is created |

**Code formats and visual cues:**

- **Invitation & staff codes** (green box, `XXXXX` placeholder): **5 letters and numbers**.
- **Email verification codes** (blue box, `XXXX` placeholder): **4 digits**, used for signup, historical access, associated-email changes, sign-in 2FA, and security confirmation.
- Type or paste the full code, keeping leading zeros. Older still-valid 5-digit or 12-character codes remain accepted until expiry or revocation.

After Viewer, tutee, Crew-approval, or historical email verification, a popup displays the invitation code, **Copy code**, optional **Email code**, and a prefilled `/register` link. The verified browser can continue directly via a short-lived HttpOnly cookie; pasting the code into another browser requires recipient email verification. Invitations last up to **15 minutes** (capped by source/application deadlines).

**Existing-account rules:**

- Primary and verified secondary emails resolve to the same account. Accepting proof for the primary address confirms it; secondary proof does not confirm a different primary.
- Existing passwords and two-factor sign-in remain enforced.
- Accepting an authorized participation or management invitation replaces an exclusive **Viewer** role (Viewer cannot coexist with participant badges).
- Management invitations upgrade to the higher of your existing and invited rank and preserve participant attachments. No invitation grants **Head** authority.
- Suspension, participation revocation, and school departure checks remain enforced for Tutor, Crew, and tutee grants (school departure alone does not block a management rank upgrade).
- Accountless tutor archives with retained historical ownership recover through the owner's existing account rather than a new accountless setup link.

Account readiness (password set + verified primary email + no forced password change), suspension, membership, active participation, and historical ownership are distinct states.

## Sorting information tables

Click a data-column heading in Pairings, rosters, Users & Roles, and other information tables to sort ascending, click again for descending, and a third time to restore default order (keyboard: focus heading and press Enter or Space). Sorting preserves active filters and never mutates data. Action and checkbox columns do not sort; logs, submissions, and paginated history keep their own order.

## Graduation and school transfers

Any student account can report graduation or transfer via **Account Settings → Academic Details → I have transferred away** (opening **School Departure**). After a confirmed departure, the same link is labeled **School Departure** and starts with **Return to school**. Self-service requests and Coordinator staff edits go through **Management Actions** for Admin/Head review; Admin/Head can also apply staff corrections directly in the account editor.

After confirmation:

- **Enter Viewers Portal** appears on the tutor/tutee workspace, granting the same masked, read-only management summaries as **Viewer**.
- Current tutoring assignments and pending learning requests close; a departing tutor's current tutees return to the waiting list.
- Your role, personal history, and independent management/Crew/Translator permissions remain. (Archiving, opting out, or self-reporting academic **Graduated** alone does not grant observer access.)
- Admin/Head can revoke/restore observer access or approve a return to school. Returning does not restore old assignments automatically; normal tutor activation and tutee signup still apply.

## Tutees

### Apply and confirm

1. Open **Request a Tutor** on the home page or tutee workspace header when intake is open.
2. Fill in your name, email, contact preference, subjects, and availability; scroll through and sign the current tutee policy.
3. Click **Save and verify email**. Your first eligible submission sets your queue priority.
4. Follow **Submit request → Verify email → Finish account review**: enter the 4-digit email code (or confirm the email link), then click **Finish account review** from the invitation popup to complete `/register-account` and set any missing credentials.
5. Open **Enter Tutee Page → Requests** to verify your confirmed request.

**Key rules:**

- **One account per email:** use your existing account email or verified secondary address (including tutor accounts). Re-submitting with your verified email stages a replacement for your current **OPEN** request: after email verification, sign-in/2FA, and explicit review, the accepted answers replace your open request while keeping original priority, assignments, attendance, and original signed agreement (while recording the new consent).
- **Fixed 7-day verification deadline:** staff may assign a tutor before you finish confirming. That first assignment starts a fixed **7-day** verification deadline; resends, reassignments, and replacements never extend it. Missing the deadline closes the request and releases its assignments.
- **Staged challenges & links** last up to **24 hours**. A successful resend replaces only that proof; a failed delivery keeps the previous usable proof.
- **Status labels on Signup Requests:** **Signup incomplete** means email verification or final account review is still pending; **Request confirmed** means final review completed.
- **Window & withdrawal guards:** opening/closing times and approved whole-period withdrawals apply even when signed in.

### Continue selected pairings into the next quarter

After an official **Q1 → Q2** or **Q3 → Q4** refresh (quarter mode only), eligible signed-in tutees can continue prior-quarter pairings from **Dashboard** or **Requests** during the **1-hour window** after tutee signup first opens for the destination quarter (in the program timezone; pausing/reopening signup does not restart the hour).

1. Select the prior pairings you want (at most **2 distinct subjects** total for the quarter, including any already requested) and click **Review selected pairings**.
2. Review each tutor, subject, and inherited weekly time, agree to and sign the current policy, then click **Join selected pairings**.
3. Check the result: **Assigned** confirms immediate assignment at the prior weekly time (45-minute dated sessions); **Request filed; awaiting assignment** confirms your request entered the queue with priority preserved. Later additions during the hour append to the same open request.

**Key rules:**

- Confirming a regular signup request hides the continuation cards; unconfirmed submissions do not.
- If a tutor's availability later invalidates a continued assignment, that assignment is released, the signup request stays open for staff matching, and affected parties are notified (already-approved withdrawals remain withdrawn).
- If submission is interrupted, use **Check request result** before retrying.
- Once the 1-hour window ends, the continuation UI hides automatically (keeping only an active receipt or read-only result check). See [continuation opening rules](program-configuration.md#continuation-opening-window).

### Find your way around

| Section | What you can do |
| --- | --- |
| Dashboard | Preview up to 3 scheduled sessions and open verified requests |
| My Tutors & Schedule | View current sessions, tutors, times, rooms, and program no-tutoring notices |
| Requests | Edit owned open requests, manage participation/withdrawals, appeal invalid requests, and view closed history |
| Attendance | Review recorded sessions across intakes and submit feedback |
| Support | View disciplinary cards, submit appeals, or start a private conversation |
| Messages | Read and send messages within the tutee workspace |
| Account | Manage your shared profile, emails, password, and 2FA |

**Request a Tutor** stays in the workspace header while you are eligible (hidden after an approved whole-period withdrawal for that period; pending/declined withdrawals do not hide it). Newly assigned tutors show **Awaiting schedule** until a time slot is chosen. Period wording automatically matches **Quarter** or **Semester** mode.

**Holidays & Tutoring Pauses** appear as schedule notices with inclusive start/end dates: **Notice only** is informational, while **Pause regular tutoring** cancels future automatic regular lessons (keeping confirmed extras and explicitly agreed reschedules). Upcoming hides cancelled lessons; All/History retain cancellation records.

### Manage a request

| Need | Action | Result |
| --- | --- | --- |
| Correct details or unassigned subjects | Open the current request's signup editor | Updates answers on that open request (available even after signup closes); marks the request **Edited** only when answers actually change; keeps original priority, original verified request email, login identity, and signed evidence |
| Change an assigned subject | Ask Admin/Head to review | Owners cannot drop assigned subjects; Admin/Head review release and edits together while retaining recorded sessions |
| Cancel an unmatched request | Recall and confirm | Permanently closes the request; reapplying gets a new priority timestamp |
| Leave after assignment | **Request withdrawal…** with a reason | Participation continues until approval; approval ends all tutoring for the current period |
| Appeal an invalid request | Submit a reasoned appeal before period rollover | Request stays invalid during review; Admin/Head acceptance clears the flag with original priority; final rejection closes the request permanently |

If you own multiple open requests after a transfer, each request has its own controls and assigned choices.

**Timed confirmation waits** (enabling the button only—never auto-submitting):

| Action | Wait |
| --- | --- |
| Recall unmatched request, propose tutor schedule conflict, decline withdrawal/conflict, assign tutor, confirm unqualified assignment | 2 seconds |
| Request quarter/semester withdrawal, approve withdrawal or schedule conflict | 3 seconds |
| Accept participation policy, edit signup answers, release assignment, decide signup appeal | 5 seconds |

### Withdrawal requests

Open **Requests → Participation → Request withdrawal…** (works for self-service requests and linked staff-entered enrollments). Provide a reason and finish the 3-second confirmation. Participation continues while pending; approval ends all active tutoring and pending matching under your account for the current period while preserving history. A **declined** withdrawal leaves participation in place and lets you submit a fresh withdrawal request.

If submission is interrupted on an assigned request, use **Check submission** on the retained notice to inspect that exact attempt without duplicating it. If no receipt exists, **Start fresh review** retires the unused confirmation, rechecks eligibility, and opens a fresh review with your saved reason.

### Records, feedback and appeals

- **Session feedback:** submit feedback per recorded session under **Attendance**. Management-only by default; the page states whether sharing with the tutor is enabled.
- **Disciplinary cards:** with discipline enabled, an unexcused tutee absence creates a valid red card; tutor-requested cards count after staff validation. Three valid yellow cards equal one effective red; two effective reds automatically deactivate the tutee and remove current-period assignments. Appeal your own card once by the end of the **fifth school day** after its issue date (following the staff-maintained school calendar). An upheld appeal invalidates the card and recalculates status.
- **My Tutoring History** (account menu → **View History**): separates tutoring received from tutoring provided across intakes and retained historical profiles, even if participation access was later revoked. Alumni without logins can claim exact history-only access via a staff-reviewed historical invitation without enrolling; see [historical record access](historical-participant-transition.md#invite-an-alumnus-without-a-login).

See the [tutee policy draft](../../prisma/policies/tutee-policy.en.md) or [中文学习伙伴政策草案](../../prisma/policies/tutee-policy.zh.md); follow the school's published version when participating.

## Tutors

`/dashboard` and `/schedule` open the same tabbed **Tutor Workspace**, starting on **Schedule** with four local tabs (plus **Interview chair** when chairing):

| Tab | What it holds |
| --- | --- |
| **Schedule** | **My agenda** (dated tutoring, assigned interviews, personal meetings), **Needs attention** summary, and collapsed **Room Schedule** disclosure |
| **Interview chair** *(when chairing)* | Chair **Interviews to Conduct** (scheduling times, reviewing panel votes, manual **Refresh**, final decisions, links back to **Schedule** to cast your own vote, and collapsed **Completed interviews**) |
| **Pairings** | **My Pairings** recurring assignment cards, schedule setup, tutee **Details**, and **Combine groups** / **Split this group** |
| **Preferences** | Entrance cards (**Edit availability ↗**, **Edit willingness ↗**, **Request qualification ↗**) opening modal editors that retain drafts across close/reopen |
| **History & hours** | **Service Hours** period totals and breakdowns, **Crew Hours** (separate if applicable), **Meeting history**, and past records |

Pending tutors must confirm whether to participate before tutoring actions appear. Inactive tutors retain read-only records and can still recall a pending student-removal relay.

**Availability, willingness, and qualifications (Preferences tab):**

- **Edit availability ↗**: choose weekday time slots and **Preferred Sessions** (**0–4** or unset; new tutors default to **1**; `0` means prefer no assignments). Availability and Preferred Sessions save independently without overwriting each other's draft. Preferred Sessions is advisory and never cancels existing assignments; becoming inactive resets it to a locked `0` until you change it after reactivation.
- **Edit willingness ↗**: toggle **Willing to Tutor** or **Unwilling to Tutor** per approved subject (unanswered shows **Not recorded**). Each toggle saves immediately; willingness never alters qualifications or timetable availability.
- **Request qualification ↗**: request an additional subject or higher offered level with an explanation. Filter **Your Requests** by **Pending**, **Approved**, **Rejected**, or **Recalled**; active tutors can **Recall request** while pending or in interview. Approving a higher level grants that level and lower offered levels in its course group at approval time.
  - Only **Admin** or **Head** can approve directly (**Approve without Interview**, with required decision note—automatically removing the request from open Interview Records with no interview hours) or assign a panel. Rejection always requires an interview and decision note.

**Scheduling a pairing & viewing tutee details (Pairings tab):**

- Each assigned tutee has a **Details** entry showing recorded availability, verification deadline, pending review status, schedule-conflict request, and eligible relay/recall controls. Missing availability does not establish a conflict.
- The pairing's default time slot selector ranks published catalog slots across your saved availability and every assigned tutee's selections:
  - **Both Available**: exact same catalog slot ID selected by everyone, with no booking conflict.
  - **Other Time Slots**: non-conflicting slots not selected by everyone.
  - **Unavailable**: disabled slots overlapping another independent teaching block (overrides shared availability; back-to-back slots are allowed).

**Interviews (Schedule tab, Interview chair tab & Tutor Applications):**

- Every assigned panelist—including the chair—casts and updates their own vote from the interview event in **Schedule** (or via **Interviews & history** for unscheduled or past interviews).
- Chairs manage scheduling, panel-vote review (with a manual **Refresh** button), and final decisions in the separate **Interview chair** tab (expanded by default, earliest/overdue first, with a collapsed **Completed interviews** section and links back to **Schedule** to vote; drafts survive tab switches and refreshes).
- Panels require **3–8** active distinct tutors (at least one qualified in a requested subject) and an **Admin** or **Head** chair (Coordinators may vote but cannot chair). Collapsed and expanded application cards display `{accepts} accept · {rejects} reject` once votes exist.
- Every panelist must vote before a final decision; majority decides, with the chair breaking ties.
- **Approving an initial application** does not restore tutoring access previously revoked by management—Admin/Head must restore access in **Users & Roles** first. Ordinary archived tutors without a restriction can return normally.

### Correct an initial tutor application's name

In **Tutor Applications**, open an initial request (pending or interview stage, before final decision, completion, promotion, or code issuance) and choose **Edit signup request**. Admin/Head apply directly; Coordinators queue a proposal in **Management Actions**.

- Confirm spelling with the applicant first; never guess transliterations or split an unsplit legacy name.
- First, last, and preferred names follow current requiredness and Latin-script rules; **Name in Another Language** accepts Unicode. Email, contact details, subjects, qualifications, and signed policy evidence stay read-only.
- **Saved** does not mean accepted or ready for promotion—continue normal screening and identity review separately. Every applied correction logs actor, time, reason, and before/after values.

### Start tutoring

1. Click **Become a Tutor** (`/tutor` → `/tutor-signup`), choose up to three subjects, explain your qualifications, sign the current policy, and submit. (Retrying while an application is under review keeps the original submission without duplicating notifications.)
2. After panel voting, the assigned Admin/Head chair clicks **Approve**, records completion time, duration, and attending panelists, and confirms **Approve & award hours**. One transaction accepts the applicant, credits `minutes / 60` hours per attendee, prepares the registration code (or links a verified account), and notifies Admin/Head. Initial acceptance does not wait for a second Head approval.
   - For rejected interviews, legacy records, or separate completion entry, staff use **Tutor Applications → Interview Records → Record completion & award hours** (or **Correct completion & hours** using original evidenced physical-panel candidates with version checks to replace source-owned automatic credits while keeping historical chair and period).
   - For completed additional-subject/higher-level approvals—including after an audited open-panel repair that replaced ineligible panelists while preserving recorded completion and earned service—the chair confirms **Review qualification approval → Approve qualification**, reusing that recorded service unchanged.
3. Redeem your emailed registration code or setup link at `/register-account`, verify your email, set a password, and accept the current tutor policy on your workspace.

### Record a session

1. In **Schedule**, open an ended lesson under **Needs attendance** (yellow **Needs Action**) and click **Record attendance** (requires current tutor-policy acceptance).
2. Confirm actual start/end time (planned lessons are 45 minutes), room or online status, your attendance, each tutee's attendance, comments, absence reasons, ratings, and any requested disciplinary cards.
3. Read any room-conflict warning (truthful historical reports are allowed and alert management without reserving future rooms).
4. Submit once and verify the saved receipt. An identical retry will not duplicate credit; ask management for historical corrections with the date, record, and reason.

Combined pairings count shared time and each distinct student once. Extra and rescheduled labels come from the schedule and cannot be hand-picked in attendance. See [session-hour examples](../../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual).

### Plan and reschedule a dated session

**Schedule → My agenda** covers the current and next Monday–Sunday week in the program timezone, keeping ended sessions missing attendance and past open interviews visible until resolved. Left-edge colors indicate status: **yellow** (needs your action), **green** (completed or **Excused for Absence**), **gray** (upcoming, waiting, or **Vote recorded / Awaiting decision**).

- Start with **Message to coordinate** to agree informally (messages never modify schedules).
- Tutees can suggest times; tutors click **Reschedule Session** or **Add Extra Session** (include all tutees or one tutee), choose **In person — room assigned automatically** or **Online**, and review the assigned room before sending. Planned duration stays 45 minutes.
- **Ordinary negotiation & 24-hour window:** for one tutee, rejecting the first offer requires an alternative; the tutor can accept or make one final offer (rejecting that cancels only that dated session). For group sessions, everyone must accept; each person gets one counter-offer, after which use **Separate reschedule** if needed (recurring groups stay intact). The 24-hour auto-accept window starts only once the essential email is accepted by the mail server; if fewer than 24 hours remain before start, explicit agreement is required.
- **Tutoring pauses & exceptions:** paused-date extras (**Arrange exception**, labeled with the specific paused date) and reschedules require affirmative agreement from the tutor and every affected tutee with **no** 24-hour silence auto-accept. Applying a pause clears pending deadlines for affected offers; lifting a pause does not revive old deadlines. See [paused-date agreement rules](../reference/session-planning.md#tutoring-pauses-and-affirmative-exceptions).
- **Cancel Extra Session:** available on agreed upcoming extras (use **All** for extras past two weeks) until start or attendance; requires agreement from included participants and never cancels regular lessons.
- **Old-quarter lessons** must finish before an official scheduled quarter refresh. Optional private calendar subscription links are managed in **Schedule** (keep private; rotate/revoke anytime).

### Combine and split recurring pairings

Every pairing renders as a bordered card in **Pairings**. Active tutors can combine **2 to 6** owned populated assignments into a reusable group when **every student in the group is already assigned to every selected subject** (e.g., A–Chem + B–Chem, or A–Chem + A–Math, or all four of A/B × Chem/Math; never A–Chem + A–Math + B–Math). Combining never creates missing subject assignments.

**Dynamic combine selection:**

1. Click **Combine groups** on **My Pairings**. Checkboxes appear only on eligible populated, non-repair groups.
2. When you check a group, incompatible cards dim and disable automatically so you can only build valid combinations (up to 6 assignments).
3. If adding a card requires companion groups along a shared student/subject axis to keep coverage complete, those minimal companions are auto-selected with a notice; unticking removes dependent companions automatically. If no other groups are compatible, an inline notice explains why.
4. Click **Combine selected**, choose the primary member and either **Awaiting schedule** or one shared catalog slot, review the distinct roster and scheduling consequences, and confirm.

**Rules & splitting:**

- A valid combined group counts as **1 planned block** (even while **Awaiting schedule**) and shares one room reservation and one default time slot. Combining/splitting updates your assigned-session count in **Preferences → Edit availability ↗** without discarding an unsaved preference draft.
- If a later withdrawal, departure, or removal breaks coverage, the card shows **Needs repair**—click **Repair or split** before scheduling or recording combined attendance.
- Click **Split this group** to dissolve a 2-assignment group or split/subset a 3–6 assignment group. Released members return to **Awaiting schedule** while keeping their subject, students, and room choice; prior attendance and credited hours never change.

### Manage your participation

- **Opt-out & reentry:** active tutors request opt-out from **Account Settings** (red button with 3-second pause). Participation continues during the mandatory **7-day wait** before staff can approve; you can recall a pending opt-out anytime. Opted-out tutors request reentry with no 7-day wait (staff approval still required). Only one pending membership request is allowed at a time. At semester refresh, continuing active tutors become pending and choose directly whether to stay active or opt out.
- **Tutor-relayed student withdrawal:** for staff-entered (non-survey) students, tutors can relay a student's request to leave that assignment. It processes automatically after its **7-day recall window** unless recalled or cancelled (or invalidated by refresh/removal). Survey tutees submit whole-period withdrawals in their own workspace.

### Conflicts, meetings and interviews

- **Schedule conflict:** submit a reasoned rejection from the tutee's **Details** card; the assignment continues until staff approve.
- **Tutor meetings:** submit or cancel your own meeting excuse at least **45 minutes** before start; excuse/cancel controls hide automatically after the 45-minute cutoff. The first **3** unexcused absences per semester have no automatic deduction; each additional unexcused absence deducts **0.25 hours** (excused absences do not consume the allowance). Past periods appear under **History & hours → Meeting history**; missing attendance means unrecorded, not absent.
- **Announcements:** addressed announcements appear at the top of your workspace. Pinned notices (`📌`) cannot be dismissed; ordinary notices offer **Dismiss**.

See the [tutor policy draft](../../prisma/policies/tutor-policy.en.md) or [中文辅导伙伴政策草案](../../prisma/policies/tutor-policy.zh.md); follow the school's published version when participating.

## Crew

Apply at `/crew` (`/crew-signup`) and verify the emailed 4-digit code to send your application for staff review (creates no login or membership). Use the same page with a fresh email code to check status; once approved, open the shared invitation receipt popup to copy/email your 5-character code or continue to `/register-account` (creating missing credentials or adding Crew access to an existing account).

Active Crew members use **Patrol** (when the Crew module is enabled) to log visited rooms once per sweep with observation time and headcount (`0`, `1`, `2`, `3`, `4+`):

- **Credit rules:** an eligible sweep earns **0.5 crew service hours** (separate from tutoring hours) at most once every **20 minutes** per member, measured by the server. Every observation must be within the last 20 minutes (with a 1-minute clock-skew allowance; future times beyond 1 minute are rejected). Older or cooldown sweeps save with **0 hours**.
- **Anti-abuse & corrections:** a sweep reserves every 20-minute interval it spans across all rooms; identical retries return the original record. Report mistakes to management for audited corrections (Admin/Head apply; Coordinators propose).
- **Opt-out & flags:** opt-out requires a 7-day wait and staff approval (recallable while pending); reentry requires approval with no wait. Patrol mismatches create [Attendance Flags](program-configuration.md#review-attendance-flags) for staff review without imposing automatic penalties.

## Coordinators

Coordinators handle permitted daily operations, settings proposals, profile edits, and reversals by submitting them for Admin/Head review. Coordinators can propose participant badges and Tutor/Crew invitations, vote on interview panels (not chair), and keep their own tutor/crew duties. Coordinators cannot propose management-rank grants, supervise private messages, or authorize official refresh. See the [management responsibility matrix](program-configuration.md#management-responsibilities-and-review).

### Submit a change

1. Open the management page, inspect the live record, and enter your proposed change and reason (completing any timed consequence dialog).
2. Submit. **Submitted for Review** means live records remain unchanged until approved.
3. Follow **View request** to **Management Actions** to inspect **Affected record**, **What is requested**, **At submission**, and **Requested** (with unchanged values in a separate disclosure). You can withdraw your own pending request.
4. Sending an existing verification or setup link is a direct action and never extends a verification deadline.

**Reading proposals & audit entries:**

- **At submission** and **Supporting records from submission** preserve frozen submission-time evidence (they never claim to show today's live record). Record IDs appear below names to distinguish people with identical names.
- Reviewers enter a required decision note before choosing **Approve and Apply** (executing the requested action, including an underlying rejection) or **Reject with Feedback** (declining the proposal without applying). If live records changed while pending, reviewers reject and ask for a fresh proposal.
- Use **Review details and decision** to collapse/expand a request without losing an unfinished decision note.
- Audit entries show recorded before/after field diffs with localized labels and **View stored JSON** for raw types; attempt records show denied/failed outcomes separately from applied changes. If the audit list or filter options fail to load or refresh, use their independent read-only Retry controls without losing active filters or drafts.

## Administrators

**Admin** applies all non-refresh management directly—settings, rosters, pairings, staff profiles, academic/username corrections, non-Head roles, invitations, and reversals—and reviews Coordinator and participant requests. **Admin** may stage modules and prepare future openings, and requests **Head** approval for official refresh.

### Management navigation map

| Sidebar group | Pages |
| --- | --- |
| **Overview** | **Dashboard** (`/admin`), **Activity & Requests** (`/admin/activity`), **Help & How-to** (`/help`), **PDF handbooks** (`/admin/help`), **Messages** (`/admin/messages`), **Message Supervision** (`/admin/messages/supervision`), **Reports** (`/admin/history`), **Announcements** (`/admin/announcements`) |
| **Tutors** | **Tutor Roster** (`/admin/tutors`), **Subject Availability** (`/admin/subject-availability`), **Tutor Applications** (`/admin/applications`), **Tutor Status Requests** (`/admin/tutor-requests`), **Tutor Meetings** (`/admin/meetings`), **Service Hours** (`/admin/service-hours`), **Hour Adjustments** (`/admin/hour-adjustments`) |
| **Tutees** | **Tutee Roster** (`/admin/tutees`), **Signup Requests** (`/admin/requests`), **Tutee Support** (`/admin/student-support`), **Withdrawals & Removals** (`/admin/tutee-requests`), **Tutee Discipline** (`/admin/discipline`) |
| **Scheduling & Records** | **Pairings** (`/admin/pairings`), **Attendance Submissions** (`/admin/attendance`), **Attendance Flags** (`/admin/session-flags`), **Crew** (`/admin/crew`), **Time Slots** (`/admin/time-slots`), **Subjects & Levels** (`/admin/subjects`), **Rooms** (`/admin/rooms`) |
| **Administration** | **Program Settings** (`/admin/program`), **Signup Forms** (`/admin/signup-forms`), **Landing Page** (`/admin/landing`), **Policy Documents** (`/admin/policies`), **Translations** (`/localization`), **Registration Codes** (`/admin/registration-codes`), **Management Actions** (`/admin/approvals`), **Users & Roles** (`/admin/users`) |
| **Data & Recovery** | **Program Records** (`/admin/records`), **Academic Corrections** (`/admin/academic-corrections`), **Audit Log** (`/admin/audit`), **Admission Recovery** (`/admin/recovery`), **Database records** (`/admin/database`) |

### Review a coordinator change

1. Open **Administration → Management Actions**, filter by state or **Requested by** (Coordinators see **My Approval Requests**), and inspect the captured evidence and consequences.
2. Enter a required decision note and choose **Approve and Apply** or **Reject with Feedback**.
3. For tutee actions, complete your own fresh timed confirmation. If target records changed, reject and request a fresh proposal.
4. Check the applied state and audit link. A failed email after a successful assignment does not undo the assignment—use the link resend control and check mail delivery.

### Reviewing your own management requests

Only the current active **Head** may review official refresh or their own pending management requests. **Admin** cannot decide their own proposals (including after promotion from Coordinator). Head self-review still enforces required notes, consequence confirmations, stale-record checks, and audit logging. This exception applies only to **Management Actions**, never interview voting or qualification requests.

### Significant settings and pending requests

Admin/Head apply intake timing, preview links, staged modules, CAPTCHA, program email delivery, secondary-email binding, name/grade policy, signup requirements, school calendar, feedback sharing, policy publication, language visibility, and contact permissions directly; Coordinators submit proposals for Admin/Head review. Pending settings requests leave live settings unchanged until approved; staged module switches still activate only at official program refresh.

### Configure signup forms

Open **Administration → Signup Forms** and pick **Tutor signup** or **Tutee signup**. Click **Configure** beside a field to set it to **Required**, **Optional**, or **Hidden** (Admin/Head apply directly; Coordinators propose).

- Name, sign-in email, first subject, and policy acceptance are locked as visible and required; additional subject slots can be toggled independently.
- Required qualification questions require an explicit **Yes** or **No** (not necessarily positive); dependent details (grade, AP score, self-study) are required only when their visible parent answer is **Yes**. Hidden fields never block submission.
- Applied changes govern new submissions immediately without altering existing submissions. Secondary emails are never collected on public signup forms.

### Names and academic details

Profiles and signup forms support **First Name**, **Last Name**, **Preferred Name** (Latin letters, accents, spaces, apostrophes, hyphens), and **Name in Another Language** (Unicode). Legacy unsplit names are preserved until explicitly edited—never split by guessing.

- Admin/Head configure each field as **Required**, **Optional**, or **Hidden** per account type in **Program Settings → Account Settings → Names and Grades** (plus offered grades, at least one of Grades 1–12). Hidden fields stay hidden from participant forms and public display (falling back to username if no visible name remains) while remaining readable in staff editors.
- **Use preferred names** (default on: replaces First Name with Preferred Name when set, keeping Last Name) and **Show names in another language** (default off: appends the alternate-language name) apply to current profiles and rosters without rewriting historical submissions, signatures, or usernames.

### Find records and confirm saves

- **Summary tables & Actions:** tables stay compact for scanning; use the sticky rightmost **Actions** column for details and editors. Roster search combines with role/account/status filters; clearing search keeps filters.
- **Users & Roles columns:** **User | Login setup | Roles & participation | Actions**.
  - **Setup complete** = password set + primary email verified + no forced password change (not a guarantee of current participation). **Setup incomplete**, **Invitation pending**, and **No direct login attached** report setup/attachment state separately from suspension.
  - Badge colors: management (indigo), participation (teal), Translator (amber), exclusive Viewer (slate). Text labels are authoritative.
  - **Filters:** combine Role and Account filters; **Tutor Status** appears only when Tutor is the sole included role and not excluded. **Show historical records** toggles Archived/Graduated records; **Show unverified accounts** reveals unverified logins. Filters persist per signed-in browser session.
  - **User details** loads on demand with **Login**, **Permissions and memberships** (including accepted policy history), **Attached participant profiles**, and **Historical records**.
- **Accepted application → Set up account:** opens a read-only popup showing the active code or linked-account status without issuing a code or sending email. Its **Open Users & Roles** link highlights that exact tutor source record (bypassing saved filters until **Return to directory**).
- **Edit profile:** Admin/Head edit Tutor/Tutee/Translator/Crew badges, non-Head management rank, and linked names directly; Coordinators propose participant badges. Only **Head** can use **Make Head**. **Show email** inspects/copies email without sending mail. Account setup links are emailed privately and never shown to staff.
- **Review appeal (Users & Roles):** opens the original appeal beside the current restriction and reason (one pending appeal per account). **Approve** co-resolves all pending appeals for that account; **Deny** decides only the selected appeal on a suspended account without lifting suspension. On an already-active account, **Approve and close appeals** closes pending appeals without changing access (Deny is unavailable). If another reviewer or newer restriction changed the account, use **Reload restriction review** before deciding.
- **Delete account (Admin/Head):** available in the row's Actions column for eligible logins (not combined identities, retained Tutor/Tutee owners, unconfirmed tutee intakes, or the current Head). Confirmation counts removed vs. retained records and requires your password. Roster records, messages, policy signatures, audit actors, and approval history remain; sessions and login-local credentials/notices are removed.

### Combine records (Admin and Head)

**Combine records** in **Users & Roles** (and historical profile editors) groups login accounts, tutor/tutee rosters, and unowned historical records into one explicit Person identity without erasing source records or silently merging permissions.

1. Search independently inside **Combine records** and select exact records verified by evidence (names/emails are search aids, not proof).
2. Preview the complete group. With multiple logins, choose the login to retain; retiring duplicate logins is a separate explicit step allowed only once conflicts are cleared.
3. Record identity evidence and confirm (Admin/Head password required for multiple logins, ownership conflicts, active unowned participation, or restricted accounts).

If **Current participation or login review required** appears, grouping saved while operational conflicts remain—open **User details → Combined records → Review current participation** (or **Review pending history invitation**) to resolve blockers, then **Finalize reviewed group**.

For history-only alumni access without current enrollment, use **Edit profile → Set up historical access** (or **User details → Combined records → Set up historical access** for a reviewed historical group). See the [historical participant transition guide](historical-participant-transition.md).

### Past tutor records and unlinked profiles

Current-work tutor lists hide Archived and Graduated tutors by default; toggle **Show past tutors** in **Tutor Roster**, **Attendance**, **Hour Adjustments**, **Tutee Roster**, or **Tutor Meetings** when needed (revealing a past tutor never makes them eligible for active assignment).

In **Users & Roles → Show historical records → Edit profile**, Admin/Head can correct names, email, grade, and username on unlinked tutor rows (Coordinators propose) without creating a login or reactivating the tutor. After saving a valid email, **Send setup link** becomes available as a separate action.

### Link historical tutor records

To attach an accountless archived tutor to an existing verified login without reactivating it, open **Tutor Roster → Show past tutors → Edit profile → Combine records** (Admin/Head review; password required to correct an existing retained owner). See the [archived tutor procedure](historical-participant-transition.md#link-archived-tutor-history).

### Find and batch-edit offered courses

In **Scheduling & Records → Subjects & Levels**, use the **Offered Course Catalogue** search, level (**No level** supported), and status filters. **Select all visible** selects matching rows only (showing hidden selected count if filters change); **Apply to … visible selected** batch-updates level and/or status on visible selections only. Group editing and JSON/CSV import sit below the table.

### Run the program

- **Program Settings** (`Administration → Program Settings`) groups controls into **Recruitment and Refresh**, **Account Settings**, **Deployment Configurations**, and **Optional Features** (full reference in [program configuration](program-configuration.md)):
  - **Program Refresh** (under Recruitment and Refresh): one unified card to stage/schedule or run refresh (**Authorize Refresh** defaults to **Schedule for later**, with a **Refresh now** switch, **Effects & full refresh details** disclosure, and embedded **Next-Period Recruitment** opening editors). Admin can stage/prepare and request refresh; **Head** authorizes and applies it.
  - **Holidays & Tutoring Pauses**: unified calendar editor with inclusive start/end dates, reason, **Pause regular tutoring** (default) vs. **Notice only**, and **Review impact** before applying. Pauses cancel future automatic regular sessions and clear 24-hour auto-accept deadlines (requiring **Arrange exception**); confirmed extras and agreed reschedules stay in place, and school-day appeal deadlines stay separate.
- **Last-resort manual creation:** **New Pairing**, **Add a Tutee**, and **Add Tutor** each require acknowledging a risk warning on every opening (unchecked by default) before revealing fields, so staff prefer normal signup/matching flows when possible.
- **Tutee Roster** (`Tutees → Tutee Roster`): switch **Current**, **History**, or **All Records** and open **View details** for enrollment summary, subjects, email/account controls, and paginated tutoring history in one dialog.
- **Tutor Roster & Subject Availability** (`Tutors`): **Tutor Roster → View user details** shows grouped approved/inherited qualifications, three-state willingness, linked login state, and policy acceptance history (staff only). **Subject Availability** lets staff filter each tutor by **Qualified**, **Pending Review**, or **Willing to tutor**, approve/remove qualification sources, or record willingness.
- **Tutor Applications & Interview Records** (`Tutors → Tutor Applications`): filter by name/email, status, request type, subject, and **Interview completion**, and sort by completion date, application date, or name. Collapsed and expanded cards show panel count and `{accepts} accept · {rejects} reject` vote tallies. When assigning or repairing panels, **Group panelists by subject** lists qualified tutors first (3–8 active tutors + Admin/Head chair). Panel editor drafts stay bound to their captured application version and require explicit **Reload** when server state advances; open additional/higher panel repairs require a reason, clear operational votes while retaining previous panel/vote evidence, completion, and earned service (whereas initial-application panel replacement starts a fresh review and clears prior votes, completion, and source-owned credits). **Hour Adjustments → Correct interview hours** jumps directly to the exact `#interview-completion-<id>` review without overwriting active drafts or changing hours.
- **Tutor Meetings** (`Tutors → Tutor Meetings`): opens on the current period (with **Meeting history** for prior periods and a separate section for upcoming meetings in other periods). Recording attendance takes precedence over current membership status.
- **Crew & Tutee Support**: **Crew** separates review work, roster, and patrol settings; **Tutee Support** separates feedback visibility and disciplinary-card appeals (pending first, then resolved history).
- **Landing Page** (`Administration → Landing Page`): tabbed editor for layout, fixed content, sections, news, pages, and images (arrow keys move focus; Enter/Space selects). Each tab and language keeps an independent local draft while mounted.
- **Policy Documents** (`Administration → Policy Documents`): follow [policy publication steps](policies/README.md#publish-a-revision). Editing a repo draft never updates a live site. **Version History → View** opens archived documents read-only.
- **Audit Log & Recovery** (`Data & Recovery`): filter **Audit Log** by actor, event, operation, record, or program-local date (exact UTC timestamps and raw JSON available in **View details**). Use **Admission Recovery** to preview/apply eligible captured initial admissions (longer chains require the operator CLI), and **Database records** (Admin/Head) for read-only inspection. See the [recovery guide](recovery.md).

### Signup request tabs

**Tutees → Signup Requests** combines self-service and **Staff-entered** signups (**Earlier signup** when historical source is unknown) across queues in original submission order:

- **Needs matching:** valid open requests missing one or more tutor assignments.
- **Assigned:** valid open requests whose requested subjects all have tutors (cards start collapsed).
- **Needs review:** pending decisions, including invalidity appeals.
- **Closed:** closed/declined requests, invalid entries, and completed review history.

**Validity & invalidity notices:**

- Click **Flag invalid** with a submitter-safe reason (Admin/Head apply; Coordinators propose) to block processing without deleting records or imposing discipline. Filter with **Request validity** (`All`, `Not flagged invalid`, `Invalid`).
- Each applied flag, clear, or reflag queues an essential email to the request's address (independent of optional email switches). Unverified recipients see only request kind and submission time; request-specific mailbox verification permits the reason.
- **Review invalid flag** shows delivery state (`Blocked`, `Sending`, `Sent`, failed retry up to 5 attempts) and any submitted appeal. Admin/Head accept appeals (clearing the flag with original priority) or finally reject them (closing the active survey request). Tutor applications and legacy tutee requests include a 90-day private appeal link in the invalidity email.
- **Clear invalid flag** returns an open request to matching/assigned without altering assignments, priority, or verification deadlines.

**Declining older non-survey signups:** **Decline** (Admin/Head) or **Request Signup Decline** (Coordinator) records a permanent decision with **Intake at the decision** under **Closed** instead of deleting the source (blocked if invalid flags, pending participation reviews, attendance, or published sessions exist).

**Tutor matching, workload, and editing:**

- Course-aware tutor selectors in **Signup Requests** and **Pairings** list qualified tutors first, then unqualified tutors (assigning an unqualified tutor requires a 2-second mismatch confirmation by both proposer and reviewer).
- Selectors display each tutor's current-quarter approximate assigned-block workload and saved **Preferred Sessions** warning (advisory only; each valid combined group counts once; adding to an existing valid group adds no block).
- Self-service cards place **Edit signup answers** last in header actions and **Release assignment** beside each assigned subject/tutor; the **Edited** badge appears only when signup answers actually change.

### Planned rooms

The **Pairings** table displays **Tutor, Subject, When, Room, Tutees, Actions**:

- **Room badges:** `-` (Awaiting schedule or No physical room), `x` (scheduled without a room; amber text when **Needs room**), or the room name (gray for automatic, app accent for staff-fixed, gray outline for legacy). Open **View details** for full allocation state.
- **Room choices:** Automatic allocation, fixed staff room (never displaced by automation; release to Automatic explicitly when needed), or intentional No physical room. Combined pairing groups share one room reservation and one **Needs room** count.
- **Auto assign all unassigned sessions:** reviews up to 500 scheduled automatic/legacy roomless pairings across all filters (counting each combined group once) and preserves existing/fixed/no-room choices (Admin/Head apply; Coordinators propose).
- **Shortages:** **Needs room** notifies Admin/Head in-app (no duplicate notices on unchanged retries); use the **Needs room** filter to retry once capacity opens.
- **Auto-assign rooms** defaults to On in **Program Settings → Optional Features** (changes activate at next refresh). See [room and period rules](program-configuration.md#schedule-rooms-and-periods).

### Review withdrawals and membership

- **Tutees → Withdrawals & Removals:** review self-submitted whole-period withdrawals (approval ends all current-period enrollments for that account) and separate tutor-relayed withdrawals (7-day recall window; staff can cancel before effective time). Decline stale proposals if enrollment ownership or scope changed.
- **Tutors → Tutor Status Requests** & **Crew**: review opt-out requests (approvable only after 7 days) and reentry requests (no wait). After approving a tutor opt-out, use the explicit student-requeue action to return affected tutees for matching.

### Review records and reports

- **Historical corrections & reversals:** Admin/Head apply corrections to tutoring attendance, patrol observations, meeting attendance, and completed interviews—plus reversals of hidden messages, archived announcements/news, participation reinstatements, and discipline decisions; eligible Coordinator proposals wait in **Management Actions**.
- **Service Hours** (`Tutors → Service Hours`): starts on currently **Active** tutors (switch to **Inactive** or **All**, filter by period activity, toggle **Summary** vs. **Breakdown**). Program totals always cover the complete selected period while filtered subtotals cover visible rows; fractional hours retain exact precision.
- **School Month Reports** (**Service Hours → School reports**): reports individual unreported hours (combining tutoring + Crew) to school recipients in `0.1`-hour (6-minute) steps with cross-month carry-forward (`Carry In → Raw Change → Hours → Carry Out`, where **Hours** is the sole amount to enter and `—` means no entry).
  - Before the first issuance, Admin/Head must confirm each person's opening balance and school-account reference (missing balances are never treated as zero; newly imported archive evidence is excluded from new credits, and restored archives overlapping reviewed school evidence block issuance until reconciled via the operator [archive provenance workflow](recovery.md#reconcile-pretracking-archive-provenance)).
  - Configure recipients, optional internal labels, and monthly schedule (default: noon on the last day of the month; automation starts off) and preview both the report and Graphite notification email before issuing.
  - Recipients open **View Month Report** without sign-in (with an **English / 中文** toggle, expandable person **Details**, CSV download, and **Email me a reminder** to their own mailbox). **Delivery history** tracks mail status and first link visit separately (no tracking pixel).
  - Full accounting, correction-edition, and recovery rules live in the [school reporting contract](../reference/school-hours.md).
- **Attendance Flags, Reports, and CSV safety:** review patrol discrepancies in [Attendance Flags](program-configuration.md#review-attendance-flags) and export period tables from [Reports](program-configuration.md#reports-and-exports). CSV exports preserve numeric values and prefix formula-like text cells with a protective apostrophe (`'`).

### Management registration codes

Open **Administration → Registration Codes** to issue, inspect, export, or revoke **Tutor**, **Crew**, **Admin**, and **Coordinator** codes (no **Head** code exists; use leadership transfer). Admin/Head issue directly; Coordinators can propose Tutor/Crew codes only.

- **Automatic email delivery:** email-bound 5-character codes (manual Admin/Head issuance, accepted tutor applications, and accepted Crew applications) are emailed automatically best-effort after commit.
- **List columns & source provenance:** each row shows **Source** badges (**Interview**, **Accepted application**, **Crew application**, or manual), **Issued By**, **Bound to** email, status, and a **View application** link where applicable.
- **Unavailable status:** active-window codes that cannot be redeemed display **Unavailable** with the exact reason (10+ failed attempts, invalid source application, inactive/no-longer-accepted application, or code unavailable). Used/expired codes expand to a gray card with a crossed-out code and no share actions.
- **Export Image:** downloads `account-setup.png` (2× resolution card showing program title, role, code, URL, and expiry—excluding external emails/buttons) for private sharing with the intended recipient.
- **Redemption:** requires email verification. New accounts receive the code's exact role; existing accounts keep credentials/participation and upgrade to the higher management rank (leaving exclusive Viewer if applicable).

## Head

**Head** inherits every **Admin** capability and holds sole authority over:

- **Official program refresh:** authorize immediate or scheduled refresh in **Program Settings → Recruitment and Refresh → Program Refresh** (see [program refresh](program-configuration.md#refresh-the-program)). Refresh advances the period, applies staged module switches, and updates participation while preserving historical attendance, policy acceptances, and audit records.
- **Leadership transfer:** **Users & Roles → Edit profile → Make Head** (password-confirmed) transfers Head to an eligible Admin or Coordinator and makes the outgoing Head an Admin. The current Head cannot be deleted.
- **Management self-review:** only the current active Head may review their own pending proposals in **Management Actions**.
- **Program Records (Admin & Head):** **Data & Recovery → Program Records** imports historical CSV batches (using downloadable templates; previewed; never overwrites existing records) and exports ZIP archives. See [import/export guide](program-configuration.md#import-and-export-program-records).

Before opening public intake on a new deployment, confirm email delivery, published Tutee and Tutor policies, offered subjects/levels, time slots, and rooms.

### Stable account usernames

Verified participant accounts share one permanent lowercase ASCII handle (`1–64` characters) with any linked tutor record. Redemption, re-enrollment, name edits, and academic corrections preserve established handles. New handles normalize decomposable accents (`José García` → `jgarcia`), accept an optional Latin spelling for non-Latin names (falling back to `member`, never guessed transliteration), and use graduation suffixes only as initial hints when grade and reference year are confirmed. Student handles are assigned only after verified signup/re-enrollment or explicit Admin/Head **Users & Roles → Assign Username** backfill; Viewer accounts stay email-only unless explicitly assigned.

### Management username editing

In **Users & Roles → Edit profile**, Admin/Head can change any login account's username directly (1–64 ASCII letters/digits, trimmed/lowercased, checked across both logins and tutor rosters; Coordinators propose). The linked tutor updates atomically so the old handle stops signing in while email sign-in, passwords, roles, and history stay intact. After saving, the username section refreshes its version automatically so you can edit again without closing the dialog.

## Viewers

When public Viewer signup is enabled (`/viewer` → `/viewer-signup`), enter your name, affiliation, and email, verify the 4-digit code, and complete review from the invitation popup (existing accounts sign in without adding Viewer).

Viewers and departure-based observers read permitted management summaries (names, schedules, statuses, ratings, totals, published policies, announcements, and category-level audit summaries). Contact details, signatures, private comments, absence reasons, application evidence, and decision notes are withheld. Viewer is exclusive of Tutor, Tutee, Crew, and Translator memberships; use **Add access** with an authorized invitation (or request a membership change in Account Settings) to transition out of Viewer. Never create a second account to bypass permissions.

## Translators

Translator access requires an explicit Admin/Head assignment (even for management accounts). **Administration → Translations** provides:

- **Interface text:** submits when focus leaves a changed field.
- **Website text:** explicit submit button across all five content destinations.
- **Draft review:** filter by pending, published, rejected, or all drafts. Translators and Coordinators submit private drafts; Admin/Head approve/publish or reject (Coordinators can **Request Admin/Head approval**; Admin/Head who also hold Translator assignment can publish direct edits live). For page-title drafts, check **Current saved page** and **Current page address**; drafts targeting deleted pages cannot be published.
- **Languages:** Admin/Head show/hide languages in the public selector, reorder them, or delete custom languages (Coordinators propose; English stays enabled as fallback). Assigned Translators can add new hidden languages.

Policy translations follow the separate [policy review process](policies/README.md).

## Account settings and private support

Use **Account Settings** (or tutor **Account Settings**) to edit your visible name fields (**Save profile**), change your password, manage verified email addresses, configure 2FA, update **Academic Details**, or manage notifications.

- **Academic Details:** select your offered grade (the current school year fills automatically) and confirm—grades never auto-advance across school years. **Expected graduation** is computed from grade + reference school year (e.g., Grade 10 in `26-27` → `2029`). Use **Unknown**, **Graduated** (academic detail only—does not change tutor status), or **Not Applicable** as appropriate. For historical period-specific fixes, staff use **Data & Recovery → Academic Corrections** (see [historical corrections](historical-participant-transition.md#correct-historical-academics)).
- **Passwords & security:** new or replacement passwords use **8–1,024** characters (account setup and invitation forms keep **8–200**; passwords are never trimmed or shortened automatically, and oversized resets fail without consuming the reset link). Changing or resetting a password signs out every active session and returns you to Sign In. Signed-in password confirmations share a limit of **10 checks per 15 minutes per account** (up to 1,024 characters; use **Forgot Password** to replace longer legacy passwords). Legacy accounts receive a private setup link at their existing email.
- **Two-factor authentication:** distinguishes loading/failed reads from **Disabled**. You can still disable an already-enabled account with your current password when the program switch is off or email delivery is unavailable. Denied access conceals cached settings until a fresh read confirms access.
- **Private Messages:** send separate deliveries to up to **20** allowed recipients (recipients cannot see each other or each other's replies; notifications omit message bodies). New messages may be reviewed or reversibly hidden by Admin/Head under **Overview → Message Supervision**; older participant-only messages show **Earlier message · Participants only**. **Reply** opens an inline composer with independent draft retention. Management accounts open **Messages** in the management shell at `/admin/messages` (while the tutee workspace **Messages** tab stays in the tutee shell). Contact rules are configured in [Program Settings](program-configuration.md#message-permissions-and-supervision).
- **Notifications bell:** shows recent notices and unread counts with deep links to the affected record. Proposed assignments are labeled as proposed; applied assignments note whether their schedule awaits confirmation. See the [notification event inventory](../reference/notification-events.md).

### Associated email addresses

Accounts require one verified primary email and support up to **5** optional secondary addresses (counting pending requests), unless Admin/Head disable **Secondary-Email Binding** under **Program Settings → Deployment Configurations** (existing verified secondaries remain usable/removable while disabled). Enter your **Current password** to add, resend, promote, or remove a secondary address. Verification codes expire in **10 minutes** (5 attempts, 1-minute resend cooldown).

To replace the primary address with a new email, open **Change Account Email** inside **Associated Emails**, enter the new address and current password, and verify the emailed code (available even when secondary-email binding is off, including single-email accounts). After a verified primary change or promotion, the signed-in account menu updates immediately without requiring a fresh sign-in.

Any verified address can sign in or trigger password recovery (recovery by username goes to primary; login 2FA and password-change codes always go to primary). Promoting a secondary retains the old primary as a secondary and updates linked current tutor/tutee contact rows without changing identity or history.

### Optional email notifications

- **Email language:** choose **English** (default) or **中文** in **Account Settings → Notification preferences** to receive account and notification emails in one chosen language (independent of website interface language).
- **Categories & badges:** toggle unread badges and optional emails independently across **11** categories (messages, review requests, applications, tutoring assignments, attendance, membership, account updates, announcements, management, other program updates, and email-only upcoming reminders). New accounts start with badges on and optional emails off. Admin/Head can lock specific badge or email categories on (your personal choice is restored if unlocked later).
- **Program switch & reminders:** optional emails require Admin/Head to enable **Email Notifications** in **Program Settings → Deployment Configurations**. Reminders send **24 hours** and **1 hour** before interviews, meetings, and confirmed tutoring sessions. Ordinary tutoring reminders are suppressed on active **Holidays & Tutoring Pauses**, non-school days, and recorded absences; confirmed dated exceptions with affirmative agreement remain eligible during pauses/non-school days (an overlapping **Notice only** range still suppresses them).
- **Essential & security emails:** verification, recovery, 2FA/step-up, security alerts, invitations, and public-request status notices remain active regardless of optional toggles and have no unsubscribe link.
- **Unsubscribe links:** optional emails include a **90-day** private **Unsubscribe** link (no sign-in required; stops that category or all unlocked categories across primary and included secondary addresses without affecting badges or admin-required categories).
- **Delivery status, Email Quota, and retries (Admin/Head):**
  - **Program Settings → Deployment Configurations → Delivery settings** shows **Email delivery status** (SMTP connection/auth checks cached up to 1 minute, retrying and failed queues) and **Resend stuck emails** (queues up to 100 eligible failed/retrying notices).
  - When Aliyun quota monitoring is configured, **Email Quota** appears on both the **Overview → Dashboard** (`/admin`) and **Program Settings → Deployment Configurations → Delivery settings**, showing remaining daily free quota, reset time, and remaining one-time balance (cached 1 minute).

## Renewed policy acceptance

- On the tutor workspace, click **current policy** in the accepted-policy banner to read the latest published policy in a read-only popup. If policy status fails to load or refresh, use **Refresh** to retry reading without accepting or losing a typed signature.
- Whenever a published policy for your linked tutee or tutor profile changes, a renewal popup opens on your next visit or window focus. Scroll to the bottom of the policy box to unlock the checkbox (short fully visible policies unlock immediately), check agreement, and finish the 5-second confirmation.
- Dismissing the popup still lets you access messages, account settings, personal history, feedback, appeals, email confirmation, and password recovery; new participation requires accepting the current revision.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Intake has not opened | Check the displayed opening time or preview; creating an account does not change survey priority |
| Confirmation link expired | Request a new link and use the most recent successfully sent link |
| Verification deadline passed | Submit a new request if eligible; resending cannot extend the fixed 7-day deadline |
| New policy required | Scroll through and accept the displayed revision; history and private support remain accessible |
| Change is pending | Open **Management Actions**; live records stay unchanged until approval |
| Affected records changed | Reviewer rejects the stale proposal; requester submits a fresh proposal against current records |
| Assignment applied but email failed | Keep the assignment, resend its verification link, and check mail delivery status |
| Interview decision blocked | Verify every panelist voted, all panelists are active, an Admin/Head chair is assigned, and subject qualification is met |
| Missing permission or page | Check role, linked membership, suspension, and enabled modules with management |
| Hours differ from simple rounding | Compare recorded attendance with [service-hour rounding examples](../../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual) |
| Correction did not update expected record | Check approval status, program period, and **Audit Log** with management |

## Report a problem

For private account, disciplinary, or attendance matters, message management inside the website. For software bugs or documentation requests, use the [bug report](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=01-bug_report.yml), [feature request](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=03-feature_request.yml), [enhancement](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=02-enhancement.yml), or [documentation](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/new?template=04-documentation.yml) form.

Use synthetic examples and omit real names, contact details, private messages, account links, and codes from public issues. See [creating issues](../contributing/issues.md).

[Documentation home](../README.md) · [Technical report](../reference/technical-report.md) · [Policy drafts](policies/README.md)
