# Historical participant transition

This workflow preserves pre-site tutoring records without requiring each historical participant to register. It reuses the existing Tutor, Tutee and StudentProfileOwnership tables and the existing [Combine accounts feature](user-guide.md#combine-duplicate-accounts-head-only).

## Import and inspect

1. In **Program Records**, preview the archive and inspect the affected tables before importing.
2. Sessions and their recorded service credit reference Tutor/Pairing; tutee attendance references Tutee. Meetings and hour amendments reference Tutor. These records do not need a User login. Do not add invented email addresses or passwords.
3. In **Tutees**, choose **History** or **All Records**. History contains inactive enrollments and enrollments explicitly assigned to a non-current term. Undated active/pending records remain in Current because absence of a date is not proof of departure.
4. Search by participant name or linked account identity. Attendance totals are across all recorded periods. **View History** lists dated sessions in pages of 50 and separates original enrollment academics from the account's current academic profile.
5. **Refresh** reloads the affected roster, pairing, account and attendance queries. Withdrawal decisions and reinstatements invalidate those same views.

An unknown historical grade remains unknown. A record without a login is labelled as a participant record, not an unfinished signup. The original enrollment grade is not replaced by today's grade when an account is linked.

## Account lists

Users & Roles contains login accounts and the existing unlinked tutor entries; accountless tutees remain in the tutee roster. An absent tutee row in Users & Roles does not imply missing attendance.

- Unverified logins are hidden by default. **Show unverified accounts** or an explicit account-setup filter reveals them.
- **Show historical records** reveals archived/graduated tutors and historical-only tutee accounts.
- Current management, viewer, crew, translator, tutor or tutee participation keeps a verified account visible even when another identity is historical.
- These are display filters. No record is deleted, suspended, reactivated or granted new access by changing a filter.

## Link an accountless historical tutee

An Admin or Head opens **Edit Profile → Link Historical Records** from a historical tutee row, records identity evidence, selects an eligible verified account and reviews the named record and session count before confirming.

The write adds explicit retained ownership. It does not replace User.studentId, enroll someone in the current term, change membership, copy academics, fabricate consent, or rewrite sessions, meetings or hour amendments. The person can find linked records through **My Tutoring History** in the account menu, without accepting current participation policies solely to read history.

A Head must resolve an existing retained-owner conflict and confirm their password. If another login currently owns the enrollment, review the existing Head-only **Combine accounts** workflow and its blockers; accounts with school-departure history need a reviewed data migration. The link workflow never combines two login accounts.

Concurrent profile/record changes invalidate the preview. Refresh and review again. Each successful link records the actor, target, previous owner and staff evidence in the audit log.

## Invite an alumnus without a login

After checking identity, an Admin or Head sends an invitation from the specific accountless historical tutee row. Record the reviewed identity evidence and use an email address the person can still access. The invited person can either sign in to an eligible account with that primary or secondary email verified, or choose **Create history-only account** on the invitation page.

For a new login, enter the invited email, verify the separately emailed code and set a password of at least eight characters. The reviewed archive label supplies the account name without guessing legal-name parts. No current grade, participation policy or tutoring application is required. Sign in and explicitly choose **Link My History** after reviewing the named record. Creating credentials and claiming ownership are separate steps; neither grants current tutee/tutor membership, crew, management, translation or general observer access.

- Sending or opening the invitation creates no login or enrollment. Only successful email verification and password submission create credentials.
- Tokens expire in seven days, are stored only as hashes, and cannot be exported with Program Records.
- Opening/scanning the URL does not claim anything. Only the explicit confirmation writes ownership.
- A completed link consumes the invitation. Expiry, record edits, or suspension/demotion of its issuing manager invalidate every setup/claim step. Staff can inspect the recipient and expiry and choose **Cancel invitation** in the same editor. Cancellation does not delete an already created account or revoke completed ownership.
- The profile and historical-link sections share a pending guard: while either section is saving or reviewing a link, both sections pause edits and submissions through refresh. Close and repeated Escape requests remain blocked during that work. Failed requests leave the editor open with both drafts intact so staff can correct or retry the action.
- Email codes last 15 minutes and allow six incorrect attempts. Wait at least one minute before resending; a new code replaces the previous code and completion proof. Repeating successful account creation returns the existing completion receipt without resetting its password.
- A failed replacement email leaves the existing invitation intact. If delivery succeeds but the transaction fails, staff must send a new invitation.
- The sender's configured AUTH_URL and security email delivery must be available. No production email is used in local verification.

If the school email is unavailable, use the verified program support contact shown on the invitation page (or contact the school team when no email is configured). Staff must review identity evidence and the exact record, cancel the old invitation, and send a replacement to an accessible address. Email changes, matching names and knowledge of a record ID never establish ownership. Existing primary/secondary email owners use **Recover existing account**, not another registration; genuine duplicate logins and conflicting ownership remain Head-only decisions.

**My Tutoring History** also shows retained tutor sessions, stored hours, meeting attendance and hour amendments for tutor identities already linked to the account, including supported Head-reviewed account combinations. Revoked tutor capability or observer access does not hide this personal evidence. Missing tutor identity links require staff review through the existing ownership/account tools; this first account-creation route starts from an exact historical tutee invitation and does not introduce self-service tutor matching or change the Head-only account-combination blockers. Staff can keep all unclaimed tutor/tutee archives without creating any login.

## Website action coverage

All supported operational actions below have website controls; staff do not need a database console or command-line script.

| Action | Website path | Boundary |
| --- | --- | --- |
| Import historical sessions, attendance, meetings and hour amendments | Program Records → preview → import | Existing additive import; changed existing rows are not a bulk update. |
| Find past/accountless tutees | Tutees → History or All Records → search | Show unverified accounts when needed. |
| Read original academics and attendance | Tutee row → View History | Staff or the linked owner; general observers cannot read private details. |
| Correct an accountless participant profile | Tutee row → Edit profile | Individual correction; school-year confirmation history and bulk corrections remain #195. |
| Link an existing verified account | Historical row → Edit Profile → Link Historical Records → search → Review Link → Confirm Link | Admin/Head, identity evidence and acknowledgement required. |
| Correct retained ownership | Same link section → Head password → Confirm Link | Current login ownership conflicts require Head review through Combine accounts and its conflict checks. |
| Invite an alumnus | Historical row → Edit Profile → Link Historical Records → invited email → Send Invitation | Exact accountless record and reviewed identity evidence; security email must be available. |
| Create history-only credentials | Email link → Create history-only account → verify email code → set password | No membership, current academics or participation consent is created. |
| Cancel or replace an invitation | Same staff link section → Cancel invitation / Send Invitation | Cancellation/expiry invalidates outstanding setup and claim; completed ownership remains. |
| Accept an invitation | Email link → Sign In → review → Link My History | Sign-in returns to the exact claim. Existing primary or verified secondary email must match. |
| Recover access | Invitation page → Recover existing account, or verified program support | Staff reviews a lost-email replacement; Head handles conflicts and genuine duplicate logins. |
| Read personal historical attendance | My Tutoring History → View History | Includes explicitly owned tutor evidence; does not reactivate participation or restore revoked observer access. |
| Refresh roster after edits | Automatic invalidation or Tutees → Refresh | Other sessions can explicitly refresh; no polling is added. |
| Reveal hidden Users & Roles entries | Show historical records / Show unverified accounts | Filters retain records and do not change access. |

Current participation remains a separate, explicit application and consent workflow. Do not use tutor/crew/management registration codes merely to grant historical access.

## Boundaries and deployment

Apply the complete migration chain, including `20261002080000_history_account_setup`, before deploying. The new nullable setup challenge and receipt columns preserve outstanding invitations, participant identities and every archive row. Normal backups and migration procedures still apply.

Transfer is not inferred from ARCHIVED status, nor graduation from inactivity. Follow the implemented [school departure and viewer-access workflow](program-reference.md#school-departure-and-viewer-access) for those decisions. Bulk on-screen and CSV academic correction tools remain supporting follow-up work in #195; the additive archive importer still rejects changed existing IDs instead of silently overwriting history.

The original imported ZIP was unavailable for this task. Validation uses synthetic records covering the owner-confirmed families: sessions, stored service credit, tutee attendance, meetings, meeting attendance and hour amendments. It does not claim a new reconciliation of the deployed archive.

New interface copy is provided in English and Chinese; the other bundled languages currently use English fallback text for this feature, available for translation through the existing localization workflow.

## Technical map

| Concern | Implementation |
| --- | --- |
| Current/history predicate | `src/lib/tutee-history.ts` |
| Retained ownership and invitations | `src/server/tutee-history.ts` |
| Email-verified history credentials and cancellation | `src/server/history-account-setup.ts` |
| Owned tutor evidence without participation | `src/server/personal-tutor-history.ts` |
| Staff and owner-scoped endpoints | `src/server/api/routers/tutee-history.ts` |
| Roster and linking dialogs | `src/app/_components/tutee-history.tsx` |
| Personal history and explicit claim | `src/app/history/` |
| Shared cache invalidation | `src/lib/tutee-cache.ts` |
| Users & Roles default filters | `src/lib/user-filters.ts` |

[Website audit and screenshots](evidence/historical-participant-transition/README.md)

[Documentation index](README.md) · [User guide](user-guide.md)

### Compact tutee roster

The Tutee List follows the Users & Roles table styling and action sizing, with attendance counts and discipline standing. Its row actions are View History, Edit Profile and Delete. Admin/Head linking and invitations live inside Edit Profile. Names are displayed unchanged, without synthetic scenario labels. Grade & Class shows the enrollment grade and its reference period for historical/accountless records, or current confirmed account academics. Expected graduating class requires a numeric grade and a known school year; missing years are never replaced with the current year. Full historical and current academic details remain in View History.
