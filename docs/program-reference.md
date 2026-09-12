# Program functions and controls

[Documentation home](README.md) · [Role guide](user-guide.md) · [Deployment](../README-DEPLOY.md)

This is the supported single-program website. Account role, tutor participation, crew membership and translation assignment are separate capabilities. Page visibility follows both permission and the effective program configuration; the server checks access independently.

## Functions by purpose

| Purpose | User entry | Management entry / outcome |
| --- | --- | --- |
| Request tutoring | Home → Request a Tutor; `/signup` | Signup Requests (`/admin/requests`): verify demand, match at original survey priority, review current and processed requests |
| Become a tutor | Home → Become a Tutor; `/tutor-signup` | Tutor Applications: select qualified panel and chair, interview, vote and decide; record actual completion in `/admin/interviews` |
| Create an accepted tutor account | Registration code at `/register`, then emailed verification/setup | Registration Codes and Users & Roles; an application or roster row alone is not a login |
| Participate as a tutee | `/student`, with Dashboard, Schedule, Requests, Attendance, Support, Messages and Account tabs | Tutee Roster, Pairings, withdrawals and discipline; explicit account ownership controls records |
| Teach and record attendance | Tutor Dashboard (`/dashboard`), Settings (`/settings`), Handbook (`/handbook`) | Attendance Submissions, Attendance Flags, Service Hours and Hour Adjustments |
| Schedule teaching | Tutors maintain availability and pairing defaults | Subjects & Levels, Time Slots, Rooms and Pairings; room blocks warn against conflicts |
| Manage interviews | Assigned panelists vote in Tutor Dashboard; the chair schedules and records the decision | Tutor Applications assigns the panel; Record Interview Completion records duration and subject qualifications |
| Communicate | Workspace Messages and notifications | Announcements support immutable recipient snapshots, filters and individual overrides; private messages remain scoped to their participants |
| Get support | Tutee Support tab, session feedback, card appeals and private messages | Tutee Support (`/admin/student-support`) handles shared feedback, appeals, school calendar and policy acceptance |
| Review sensitive changes | Coordinators prepare changes | Changes Awaiting Approval: ADMIN/HEAD recheck evidence before applying or declining; pending is not applied |
| Observe the program | Read-only management area | VIEWER sees permitted summaries with private contact data masked; observer access does not grant management writes |
| Patrol rooms | Active crew member → `/patrol` | Crew maintains membership, room order, sweeps and corrections |
| Maintain accounts | Shared Account settings; verified email changes and password recovery | Users & Roles manages identities, invitation/setup, capability assignment, suspension and leadership boundaries |
| Publish program information | Home, program information menu and custom pages | Landing Page edits content, media, menus and custom pages; Policy Documents publishes versioned runtime policies |
| Translate | Assigned translator → Translations (`/localization`) | Draft/review/publish translations and control language visibility; hidden languages need wording review before launch |
| Report and audit | Permitted read-only views | Reports preserves historical records; Audit Log identifies actual actor accounts and reviewed changes |

Old `/student-support` links still work: staff enter the management support page; other accounts retain shared feedback access. Old `/interview-management` links redirect to `/admin/interviews`. Messages and Account in the tutee workspace stay under `/student?view=…`.

## Optional modules

HEAD stages these switches in **Program & Refresh**. They take effect at the **next program refresh**, not when the switch is clicked. Existing records remain history. Do not refresh just to preview a switch: refresh changes participation and the current period.

| Switch | Default | Effect when applied |
| --- | --- | --- |
| Crew patrols (`CREW`) | On | Enables crew navigation, patrol workflows and procedures |
| Discipline cards (`DISCIPLINE`) | On | Enables disciplinary workflows and their controls |
| Tutor meetings (`MEETINGS`) | On | Enables meeting scheduling, attendance and advance excuses |
| Interviews & voting (`INTERVIEWS`) | On | Enables panel interviews, voting and completion workflows |
| Service hours (`SERVICE_HOURS`) | On | Enables service-hour views and related program controls |
| Quarter system (`QUARTER_SYSTEM`) | On | On uses Q1–Q4; Off uses S1/S2. Applied mode controls intake and withdrawal wording |
| Viewer signup (`VIEWER_SIGNUP`) | On | Allows public observer account registration; does not expand viewer permissions |
| Email 2FA (`EMAIL_2FA`) | Off | Makes email two-factor functionality available; configure and test SMTP first |

See [feature implementation](../src/server/program/features.ts) and [refresh behavior](user-guide.md#head).

## Other configurable behavior

| Control | Scope / timing |
| --- | --- |
| Program timezone | ADMIN/HEAD saves a supported IANA region after reviewing consequences; dates and deadlines use it consistently. Existing instants remain fixed; weekly slots remain school wall-clock times |
| Signup opening and preview link | Management sets the current intake opening; a scheduled opening requires a preview link |
| Subjects, levels, slots and rooms | Management catalogues used by application, availability and pairing workflows |
| Policy versions | Published database revisions require new acceptance for participation; changing a bundled draft does not publish it |
| School calendar | Staff define holidays and make-up days used for school-day appeal deadlines |
| Feedback visibility | Management-only by default; configured sharing also affects earlier feedback |
| Announcements | Filters combine across groups; alternatives within a group match any choice; explicit exclusions win. Published recipients are fixed |
| Language visibility | English and Chinese are the launch-visible catalogues; six hidden catalogues contain English fallbacks |
| Personal theme and guidance | Six accent themes; dismissible management guidance can be reopened and remains scoped to the signed-in account |

## Maintainer essentials

Use PostgreSQL with UTF-8, apply every migration, and keep database/uploads persistent. Run the [required verification](technical-report.md#validation-and-development) against an isolated database before merging. Test one bounded local server/browser at a time. Deployment also needs a canonical HTTPS origin, functioning SMTP, approved policies, real school catalogues and a restored backup. An image published to GHCR is ready for host deployment; it does not prove that a public host has been updated.

Interaction reports, screenshots, test logs and intermediate scripts belong in ignored `outputs/` or `.validation/`. Maintain reusable guides here and regenerate their HTML editions. Follow [repository retention rules](repository-maintenance.md) before removing worktrees or caches: embedded databases can live inside `node_modules/.cache/`.

