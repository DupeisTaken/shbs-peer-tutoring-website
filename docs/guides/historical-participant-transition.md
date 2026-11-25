# Historical participant transition

Preserve pre-site tutoring records without forcing historical participants to
register. [Combine records](user-guide.md#combine-records-admin-and-head) groups
login accounts and Tutor/Tutee sources under one directory `Person`; explicit
`StudentProfileOwnership` and `TutorProfileOwnership` links still govern private
history access. See [identity lifecycle](../reference/identity-lifecycle.md) for
server invariants, receipts and lock ordering.

## Quick reference

All supported operations are available in the website (no SQL console required):

| Task | Website path | Authority & boundary |
| --- | --- | --- |
| Import historical sessions, meetings & amendments | **Data & Recovery → Program Records** → Preview → Import | Admin/Head; additive only (changed existing IDs reject) |
| Find past or accountless tutees | **Tutees → Tutee Roster** → **History** or **All Records** | Staff; undated active/pending stay in Current |
| Read original academics & attendance | Tutee row → **View History** | Staff or linked owner; observers blocked |
| Correct historical academics (UI or CSV) | **Data & Recovery → Academic Corrections** | Admin/Head direct; Coordinator proposes whole batch |
| Combine archives or link one ready login | **Edit Profile** or **Users & Roles** → **Combine records** | Admin/Head (password when resolving logins/conflicts) |
| Correct mistaken retained ownership | Historical profile → **Correct history owner** | Admin/Head + password; moves exact source only |
| Separate mistakenly grouped records | **Users & Roles → User details → Combined records → Separate mistakenly grouped records** | Admin/Head + password; keeps complete ownership components |
| Correct retired-account history access | **Users & Roles → User details → Combined records → Correct history access** | Admin/Head + password; Retain, Assign or Quarantine per row |
| Merge active participation | **Users & Roles → User details → Combined records → Merge active participation** | Admin/Head + password; chooses retained login & active profiles |
| Invite an alumnus (legacy Tutee) | Historical Tutee row → **Edit Profile → Invite the Participant** | Admin/Head; requires security email |
| Invite a historical Tutor or reviewed group | Tutor **Edit Profile** or **Combined records → Set up historical access** | Admin/Head; freezes exact source set |
| Claim history as an alumnus | Email link → Sign In or **Create history-only account** → **Link My History** | Explicit claim; grants no current participation |
| Reveal hidden accounts in directory | **Users & Roles** → **Show historical records** / **Show unverified accounts** | Display filters only — change no access |

## Shared rules

- **No auto-matching:** Matching names or emails never establish ownership or merge
  records.
- **Immutable history:** Original imported rows, enrollment grades, signatures,
  attendance, credits and retired credentials are never overwritten.
- **No silent participation:** Linking or claiming history grants read access under
  **My Tutoring History** only — it never enrolls a participant in the current
  term, copies academics or invents policy consent. Do not use Tutor/Crew/management
  registration codes merely to grant history access.
- **Fresh previews & recovery:** Concurrent edits or ownership changes (including
  A → B → A) invalidate previews. On uncertain responses, check the saved receipt
  or **Refresh invitation status** / **Retry refresh** instead of repeating writes.

## Import and inspect archives

1. Open **Data & Recovery → Program Records**, preview the archive and inspect
   affected tables before importing. Historical sessions, meetings and amendments
   reference Tutor/Tutee/Pairing IDs and need no login — never invent emails or
   passwords.
2. Browse past tutees under **Tutees → Tutee Roster** (**History** or **All
   Records**). **View History** paginates sessions in pages of 50 and separates
   original enrollment academics from any linked account's current profile.
3. Exports preserve original historical evidence (`HistoricalAcademicRecord.csv`
   uses `legacy-tutee:<id>` / `legacy-tutor:<id>` baselines); archive CSVs never
   auto-merge accounts and are not a substitute for full database backups. See
   [CSV archive internals](../reference/technical-report.md#csv-archive-internals).

## Correct historical academics

Open **Data & Recovery → Academic Corrections**. Admin/Head apply directly;
Coordinators propose the whole batch for Admin review. Missing grades/years never
block an otherwise valid import.

1. Choose tutor or tutee records and locate participants by name or exact **Academic
   record ID** (up to 50 records per batch). Enter historical grade, reference
   school year, evidence and reason (leave unknown values blank; numeric grades
   never auto-advance).
2. Or download a correction CSV (`recordId,expectedFingerprint,rawGrade,schoolYear,evidence,reason`;
   use `\N` for unknown values; max 50 rows / 256 KiB) and upload it.
3. Preview every before/after row, acknowledge, and submit. Each batch is
   all-or-nothing: stale fingerprints or changed ownership reject the entire batch
   (refresh and re-preview instead of overwriting).
4. **View all corrections** lists immutable revision history. Historical/preserved
   tutor academics stay read-only in **Edit Profile** so normal profile saves
   cannot bypass Academic Corrections.

## Combine records and link history

**Users & Roles** shows login accounts and accountless Tutor/Tutee rows (use
**Show unverified accounts** and **Show historical records** to reveal hidden
entries). Explicitly combined records appear as one person, with original profiles
accessible under **User details → Combined records**.

- **Historical Tutee:** Open **Edit Profile → Combine records** on the historical
  row (or from **Users & Roles**), select target records/login, enter identity
  evidence and review the complete group. Two accountless archives can combine
  without a login; attaching unowned archives to one ready login grants retained
  ownership for **My Tutoring History**.
- **Multiple live logins or conflicts:** Admin/Head can save directory grouping as
  **Review required** while keeping each login's current access separate until
  participation conflicts are resolved. Use **Correct history owner** (Admin/Head
  + password) to fix a mistaken single-source owner without combining people.

### Link archived tutor history

1. Open **Tutors → Tutor Roster**, enable **Show past tutors**, and open the
   tutor's rightmost **Edit Profile → Combine records**.
2. Select the exact source records or target account, enter identity evidence, and
   acknowledge the reviewed group.
3. One account can retain multiple historical tutor profiles alongside its current
   tutor profile. Linking grants read access in **My Tutoring History** without
   changing active tutor pointers, stored hours, assignments or departure status.
4. For history-only Tutor invitations (no existing login), use **Set up historical
   access** in the same editor instead.

## Separate mistakenly grouped records

Open **Users & Roles → User details → Combined records → Separate mistakenly
grouped records** (Admin/Head + password). Select the exact records to move while
leaving at least one source on each side.

- Keep each login together with its current Tutor/Tutee links, retained history
  and retired-login family; the preview flags any ownership edge the split would
  cut (resolve ownership separately first).
- Both resulting groups enter **Review required** for fresh participation review.
  Check the saved receipt before retrying an uncertain response (same frozen
  operation ID + fresh password).

## Correct retired-account history

Open **Users & Roles → User details → Combined records → Correct history access**
(Admin/Head + password). Choose the retired login records and target verified
account (or quarantine if evidence/setup is not ready; the retired login stays
disabled).

- Review every listed profile, notification and withdrawal restriction: **Retain**
  keeps the prior reader, **Assign** sets the reviewed recipient, and **Quarantine**
  withholds private access (quarantined withdrawal blocks remain enforced).
- Affected live sessions must sign in again; original authors, signatures and
  completed credit stay unchanged.

## Merge active participation

Open **Users & Roles → User details → Combined records → Merge active
participation** (Admin/Head + password). Choose the retained login, source
profiles, and at most one active Tutor and/or Tutee.

- Review exact successor assignments, pending response deadlines, concrete
  qualifications, availability/willingness, intake priority and discipline before
  confirming.
- Original profiles and completed work remain inspectable; transfer never invents
  consent, clears restrictions or recalculates qualifications from the current
  catalogue. Retiring duplicate logins remains a separate password-confirmed step.

## Invite an alumnus without a login

Requires configured `AUTH_URL` and security email delivery.

- **Legacy historical Tutee:** Open **Edit Profile → Invite the Participant** on
  the exact accountless row, enter identity evidence and an accessible email, and
  send.
- **Historical Tutor or reviewed group:** Open Tutor **Edit Profile** or
  **Combined records → Set up historical access**. Preview lists every frozen
  source (active work, conflicting owners or unresolved groups block sending;
  later group edits never widen an issued invitation's scope).
- **Alumnus experience:** The recipient opens the emailed link, either signs in
  with a matching verified primary/secondary email or chooses **Create
  history-only account** (verifying the 4-digit blue email code, then using the
  5-character green invitation receipt at `/register-account` — see
  [code presentation](user-guide.md#account-invitations-and-sign-in)), and
  explicitly clicks **Link My History**.
- **Delivery & lifecycle rules:**
  - Tokens expire in 7 days (stored hashed only); email codes last 15 minutes (6
    attempts, 60-second resend cooldown). Opening the URL never claims records.
  - Sending stages an inactive attempt first so an existing invitation stays valid
    if replacement email fails. Use **Check delivery receipt** / **Refresh
    invitation status** for uncertain responses (never resends email); if no
    receipt is recorded yet because the request may have been lost before reaching
    the server, choose **Retry this invitation** to resend the exact reviewed
    invitation under the same operation reference without duplicating an
    already-admitted delivery.
  - **Cancel invitation** invalidates unused setup/claim steps without deleting an
    already-created account or completed claim.
  - **My Tutoring History** separates tutoring received from provided, paginating
    sessions, meetings and amendments independently with read-only Retry on error.

## Technical map

See [identity lifecycle](../reference/identity-lifecycle.md) for the complete
authority matrix and [identity migration](deployment.md#unified-person-identity-migration)
for deployment/reconciliation (`npm run identity:reconcile`). For graduation and
transfers, see [school departure and viewer access](program-configuration.md#school-departure-and-viewer-access).

| Concern | Implementation |
| --- | --- |
| Current/history predicate & cache | `src/lib/tutee-history.ts`, `src/lib/tutee-cache.ts` |
| Canonical person, combine, partition & operational review | `src/server/person-identity.ts`, `src/server/person-combine.ts`, `src/server/person-partition.ts`, `src/server/person-operational-review.ts`, `src/server/api/routers/person-combine.ts` |
| Retired-history correction & active participation merge | `src/server/person-history-correction.ts`, `src/server/person-participation.ts` |
| Historical Tutee/Tutor ownership & exact invitations | `src/server/tutee-history.ts`, `src/server/tutor-history.ts`, `src/server/history-account-setup.ts`, `src/server/exact-history-invitations.ts`, `src/server/personal-tutor-history.ts` |
| Historical academic records & CSV corrections | `src/server/historical-academics.ts`, `src/lib/historical-academics.ts`, `src/app/_components/historical-academic-corrections.tsx` |
| Staff & personal UI | `src/app/_components/combine-records.tsx`, `src/app/_components/tutee-history.tsx`, `src/app/_components/tutor-history-link.tsx`, `src/app/history/`, `src/lib/user-filters.ts` |

[Documentation index](../README.md) · [User guide](user-guide.md)
