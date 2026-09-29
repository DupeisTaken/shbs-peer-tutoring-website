# Historical participant transition

This workflow preserves pre-site tutoring records without requiring each historical participant to register. It reuses the existing Tutor, Tutee and StudentProfileOwnership tables and the existing Merge accounts feature.

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

An Admin or Head opens **Link Historical Records** from a historical tutee row, records identity evidence, selects an eligible verified account and reviews the named record and session count before confirming.

The write adds explicit retained ownership. It does not replace User.studentId, enroll someone in the current term, change membership, copy academics, fabricate consent, or rewrite sessions, meetings or hour amendments. The person can find linked records through **My Tutoring History** in the account menu, without accepting current participation policies solely to read history.

A Head must resolve an existing retained-owner conflict and confirm their password. If another login currently owns the enrollment, use the existing Head-only **Merge accounts** workflow. The new link workflow never merges two login accounts.

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

## Boundaries and deployment

Apply the additive `20260929150000_tutee_history_invitations` migration before deploying. It adds an invitation table; it does not migrate participant identities or remove accounts. Normal backups and migration procedures still apply.

This work does not infer transfer from ARCHIVED status or graduation from inactivity. The separate departure/access work in issue #194 defines those policies. Bulk on-screen and CSV academic correction tools remain supporting follow-up work in #195; the additive archive importer still rejects changed existing IDs instead of silently overwriting history.

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
| Users & Roles default filters | `src/lib/user-filters.ts` |

[Documentation index](README.md) · [User guide](user-guide.md)
