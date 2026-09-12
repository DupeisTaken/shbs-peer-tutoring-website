# Shared account profiles and roster details

The account is the source of the current display name and optional names in other
languages. Editing the account, tutor or tutee profile updates the explicitly linked
current profiles together. Staff role and tutor/tutee participation remain separate.
Profile synchronization never creates a new link from a matching name or contact address.

Tutor and tutee rosters use compact identity cells and an **Edit profile** dialog.
Tutee subjects appear on separate lines. Email addresses are behind **Show email**
in rosters, Users & Roles and other admin lists. The email dialog supports copying,
shows verification state when an account is known, and provides an explicit
verification/setup action for an explicitly linked account when applicable. Unlinked tutor
contacts link to the existing invitation controls in Users & Roles. Historical application or request
addresses are labelled as contact records, without claiming an account state.

Verified account email changes still require the account holder's existing verified
email-change flow. Sending a verification/setup link accepts an account ID, resolves
the address on the server, and enforces a one-minute resend interval. Opening a
dialog never sends email. The recipient completes the existing email-proof/password
setup flow; sending alone does not verify an account or change participation.

Form-first tutoring requests remain supported. Legacy unlinked rosters remain usable
and show **Account setup required**. Existing tutor invitations retain their setup
flow; pending tutee request verification stays in the signup request workflow.

`updateAccountProfile` centralizes synchronization inside the existing transaction.
Writers lock the account before roster records. Account profile versions and roster
timestamps reject stale edits; coordinators propose profile changes for administrator
approval, including stale-snapshot checks. Profile updates deliberately preserve
signed agreements, submitted survey names, historical ownership and audit snapshots.

Apply `20260913010000_account_profiles` and regenerate Prisma before running this
revision. The migration initializes names only through existing explicit links and
does not create accounts, link records, change roles, or rewrite historical evidence.

Regression coverage is in `src/server/account-profile.test.ts` and
`src/app/_components/email-details.test.tsx`. Use the isolated local test database,
serial workers, and capture desktop/mobile screenshots of the rosters and dialogs.

Users & Roles groups Show email and Edit profile above Delete in the Actions column. The column remains visible for staff without deletion permission; the existing head-only deletion checks remain unchanged.
