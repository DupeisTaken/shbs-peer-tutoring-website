# Historical participant transition

This workflow preserves pre-site tutoring records without requiring each historical participant to register. It reuses the existing Tutor, Tutee and StudentProfileOwnership tables and the existing [Combine accounts feature](user-guide.md#combine-duplicate-accounts-head-only).

## Import and inspect

1. In **Program Records**, preview the archive and inspect the affected tables before importing.
2. Sessions and their recorded service credit reference Tutor/Pairing; tutee attendance references Tutee. Meetings and hour amendments reference Tutor. These records do not need a User login. Do not add invented email addresses or passwords.
3. In **Tutees**, choose **History** or **All Records**. History contains inactive enrollments and enrollments explicitly assigned to a non-current term. Undated active/pending records remain in Current because absence of a date is not proof of departure.
4. Search by participant name or linked account identity. Attendance totals are across all recorded periods. **View History** lists dated sessions in pages of 50 and separates original enrollment academics from the account's current academic profile.
5. **Refresh** reloads the affected roster, pairing, account and attendance queries. Withdrawal decisions and reinstatements invalidate those same views.

An unknown historical grade remains unknown. A record without a login is labelled as a participant record, not an unfinished signup. The original enrollment grade is not replaced by today's grade when an account is linked.

## Correct historical academics

Open **Academic Corrections** in the management navigation. Admin/Head can apply corrections; coordinators submit the entire batch for Admin/Head approval. Other roles cannot browse this tool or its private evidence. Correction is optional: missing grades or school years never prevent an otherwise valid history import.

1. Choose tutor or tutee records, then find the participant by name or exact ID. Search helps locate a record; saving always targets its stable **Academic record ID**. Duplicate names never establish identity.
2. Select up to 50 records and enter the historical grade, reference school year, evidence and reason. Leave grade/year blank when genuinely unknown. Other-school-system text is retained verbatim; numeric grades are not advanced automatically. A participant may have distinct reports for multiple years.
3. Alternatively, download selected records (or the current page) as a correction CSV. Keep `recordId` and `expectedFingerprint` unchanged. Columns are `recordId,expectedFingerprint,rawGrade,schoolYear,evidence,reason`. Use `\N` for unknown grade/year; empty text remains empty text. The CSV uses the archive's reversible formula-safe escaping. Maximum: 50 rows and 256 KiB.
4. Preview every named record, its before/after grade and year, and original source. Acknowledge the preview, then apply the entire batch or submit it for approval. Closing review retains your draft; clearing drafts requires confirmation. Saving a website batch preserves any separate CSV draft, and saving a CSV preserves website drafts. Their original fingerprints still require a fresh preview if affected records changed.
5. **View all corrections** shows successive revisions, dates, actors, evidence and reasons. The tutee history view separates original evidence, corrected historical reports and the linked account's current academics. Its compact historical roster cell uses corrections to the original enrollment report; additional period reports stay in View History.

Each batch is all-or-nothing. Invalid rows, changed profiles, changed ownership, stale fingerprints or database failures prevent every write. Coordinators' proposals recheck the same evidence during approval. A stale proposal must be rejected and prepared again. Refresh does not silently replace a draft's fingerprint: download fresh records or clear and reselect, then deliberately reapply and review your edits. A successful save followed by a refresh failure is reported separately; refresh instead of resubmitting.

Original imported rows are preserved. A correction adds an immutable revision and records today's **correction** date; it never invents an original confirmation date, stamps today's program year on past evidence, creates a User, changes ownership, or confirms current academics. Linking an account retains the historical report alongside any newer account report. Conflicting ownership must be resolved through the existing reviewed link/account workflows before correcting evidence.

For additional original reports, use `HistoricalAcademicRecord.csv` in Program Records. Supply a stable `id`, exactly one existing `tuteeId` or `tutorId`, `rawGrade`, `schoolYear`, `source`, and optional `originalConfirmedAt` only when supported by original evidence. Use distinct IDs for separate reports/years. Legacy enrollment/roster reports use reserved `legacy-tutee:<participantId>` / `legacy-tutor:<participantId>` IDs. Previewing these virtual baselines writes nothing; the first correction preserves their source snapshot. Academic records and their corrections retain the participant through a restrictive foreign key, so deleting the participant cannot erase the audit trail.

Archive retries remain additive: identical original rows are skipped and changed IDs reject the archive. The correction CSV is a separate reviewed format, not an archive overwrite mode. Program Records exports original historical academic evidence; correction revisions and management audit require a full database backup and are not executable archive inputs. Do not use a CSV export as a backup of corrected records.

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

## Invite someone who will join later

After checking identity, an Admin or Head can send an invitation from the specific accountless historical row. The participant must sign in to an eligible account with that primary or secondary email verified, review the record and explicitly confirm ownership. New participants complete the existing signup/verification flow and reopen the invitation email.

- The invitation creates no login or enrollment.
- Tokens expire in seven days, are stored only as hashes, and cannot be exported with Program Records.
- Opening/scanning the URL does not claim anything. Only the explicit confirmation writes ownership.
- A completed link consumes the invitation. Expiry, record edits, or suspension/demotion of its issuing manager invalidate it.
- A failed replacement email leaves the existing invitation intact. If delivery succeeds but the transaction fails, staff must send a new invitation.
- The sender's configured AUTH_URL and security email delivery must be available. No production email is used in local verification.

Invitations are for people joining or already holding a verified account. This does not create a separate alumni registration flow.

## Website action coverage

All supported operational actions below have website controls; staff do not need a database console or command-line script.

| Action | Website path | Boundary |
| --- | --- | --- |
| Import historical sessions, attendance, meetings and hour amendments | Program Records → preview → import | Existing additive import; changed existing rows are not a bulk update. |
| Find past/accountless tutees | Tutees → History or All Records → search | Show unverified accounts when needed. |
| Read original academics and attendance | Tutee row → View History | Staff or the linked owner; general observers cannot read private details. |
| Correct an accountless participant profile | Tutee row → Edit profile | Individual contact/profile editing; use Academic Corrections for audited period-specific academic changes. |
| Correct historical academics on screen or by CSV | Academic Corrections → select/upload → preview → apply/propose | Stable record IDs, original evidence retained, atomic batch and stale/ownership checks. |
| Link an existing verified account | Historical row → Edit Profile → Link Historical Records → search → Review Link → Confirm Link | Admin/Head, identity evidence and acknowledgement required. |
| Correct retained ownership | Same link section → Head password → Confirm Link | Current login ownership conflicts require Head review through Combine accounts and its conflict checks. |
| Invite a later participant | Historical row → Edit Profile → Link Historical Records → invited email → Send Invitation | Record must be accountless; email configuration is required in production. |
| Accept an invitation | Email link → Sign In → review → Link My History | Sign-in returns to the same claim. Signup requires reopening the email after verification. |
| Read personal historical attendance | Account menu → My Tutoring History → View History | Does not reactivate participation or restore revoked observer access. |
| Refresh roster after edits | Automatic invalidation or Tutees → Refresh | Other sessions can explicitly refresh; no polling is added. |
| Reveal hidden Users & Roles entries | Show historical records / Show unverified accounts | Filters retain records and do not change access. |

**Unimplemented boundary:** a history invitation is not an account-creation invitation. The existing public tutee signup requests current tutoring. A departed person without a login who only wants past records cannot self-create a history-only account in this change; contact the program team. Their archive remains available to staff without creating a dummy login. Do not use tutor/crew/management registration codes merely to grant historical access.

## Boundaries and deployment

Apply the additive `20260929150000_tutee_history_invitations` migration before deploying. It adds an invitation table; it does not migrate participant identities or remove accounts. Normal backups and migration procedures still apply.

Transfer is not inferred from ARCHIVED status, nor graduation from inactivity. Follow the implemented [school departure and viewer-access workflow](program-reference.md#school-departure-and-viewer-access) for those decisions. Apply `20261002010000_historical_academic_corrections` and regenerate Prisma before using Academic Corrections. This additive migration creates no accounts or backfilled confirmation dates. The archive importer still rejects changed existing IDs instead of silently overwriting history.

The original imported ZIP was unavailable for this task. Validation uses synthetic records covering the owner-confirmed families: sessions, stored service credit, tutee attendance, meetings, meeting attendance and hour amendments. It does not claim a new reconciliation of the deployed archive.

New interface copy is provided in English and Chinese; the other bundled languages currently use English fallback text for this feature, available for translation through the existing localization workflow.

## Technical map

| Concern | Implementation |
| --- | --- |
| Current/history predicate | `src/lib/tutee-history.ts` |
| Retained ownership and invitations | `src/server/tutee-history.ts` |
| Staff and owner-scoped endpoints | `src/server/api/routers/tutee-history.ts` |
| Roster and linking dialogs | `src/app/_components/tutee-history.tsx` |
| Personal history and explicit claim | `src/app/history/` |
| Shared cache invalidation | `src/lib/tutee-cache.ts` |
| Historical academic records, preview and atomic correction | `src/server/historical-academics.ts` |
| Historical correction CSV validation | `src/lib/historical-academics.ts` |
| Website correction and shared approval review | `src/app/_components/historical-academic-corrections.tsx` and `historical-correction-review.tsx` |
| Users & Roles default filters | `src/lib/user-filters.ts` |

[Website audit and screenshots](evidence/historical-participant-transition/README.md)

[Documentation index](README.md) · [User guide](user-guide.md)

### Compact tutee roster

The Tutee List follows the Users & Roles table styling and action sizing, with attendance counts and discipline standing. Its row actions are View History, Edit Profile and Delete. Admin/Head linking and invitations live inside Edit Profile. Names are displayed unchanged, without synthetic scenario labels. Grade & Class shows the enrollment grade and its reference period for historical/accountless records, or current confirmed account academics. Expected graduating class requires a numeric grade and a known school year; missing years are never replaced with the current year. Full historical and current academic details remain in View History.
