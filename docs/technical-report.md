# Technical report

Use this guide to find the code responsible for current behavior and understand the invariants a change must preserve. Start with the [architecture map](#architecture). For setup commands, see [local development](local-development.md); for operating the server, see [deployment](deployment.md).

## Universal account invitation contract

The account-flow decisions for [#268](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/268)
retain User/Tutor/Tutee identities and the original authorization sources. `AccountInvitation`
is an additive recipient-only envelope, not a new person model. Its mailbox code is HMAC-hashed;
the source reference, recipient email, credential generation and completion receipt are stored
separately. Staff-visible `RegistrationCode` keys never authenticate an existing account.

| Source | Authorization and email proof | Redemption writes | Preserved boundary |
| --- | --- | --- | --- |
| Tutor/Crew/management key | Existing staff authorization plus separate recipient-delivered mailbox code | Original registration transaction adds authorized access with canonical-account preservation | Management rank becomes the higher of the existing rank and invitation rank; no Head grant or demotion. |
| Tutee request | Full submitted application and policy evidence precede exact-submission mailbox verification; staged replacements leave the live survey proof usable | Recipient review confirms new demand or applies the independently staged answers to its owned current OPEN request | One email owner/account, original priority, fixed deadline, source consent and recorded assignments/sessions remain separate. |
| Viewer request | Initial mailbox verification issues a distinct invitation and verified-browser proof | Receipt popup hands off to new Viewer credentials, or sign-in-only for an existing account | Viewer exclusivity and the public signup feature gate remain authoritative. |
| Public Crew application | Mailbox verification creates a pending application; staff approval and fresh mailbox verification authorize invitation retrieval | The approved staff source issues the shared receipt for explicit new-account or additive Crew review | No Crew access before staff approval and account review; revocation and the Crew feature gate remain authoritative. |
| Historical tutee invitation | Exact staff-reviewed record, source revision and mailbox proof | Receipt popup hands off to neutral history-only credentials and an envelope receipt | The signed-in owner must separately claim the original historical record. |
| Head tutor setup | Head authorizes a Tutor invitation to the roster contact | No login before recipient redemption | Existing login recovery is delivered to its canonical address; staff never receive recovery secrets. |

An invitation's displayed entry code authorizes inspection but never authenticates its recipient.
Verified-browser proof or a separately delivered mailbox code establishes the existing
primary/verified-secondary email owner without changing their password. Enabled and enforced email two-factor accounts
retain their password-plus-email sign-in; the return destination resumes the same invitation.
Source proof and membership consent are distinct: a session alone does not redeem an invitation,
and accepting an invitation does not fabricate policies, academics, assignment or historical ownership.
Tutor, Crew and tutee redemption add their authorized participation while preserving unrelated
access and credentials. A valid participation or management invitation can replace an exclusive
Viewer role; it never combines Viewer with participant badges. Management redemption uses the
higher of the existing and invited ranks and preserves participant attachments. Live suspension,
issuer authority and source eligibility remain checked before writes. Participation writes retain
revocation and school departure checks; departure alone does not block a management rank grant.
Accepted proof for the exact primary address confirms it independently of password setup;
verified-secondary proof does not confirm the primary. Cached legacy completion endpoints
commit invitation delivery, then return an explicit continuation precondition error outside
that transaction, so old clients cannot misreport a credential write that never happened.
The sign-in action automatically completes only an established account's Viewer-source
LOGIN receipt after the session exchange succeeds (or the exact recipient's existing session
is verified). The domain independently rejects this automatic path for participation sources.
Academic confirmation outcomes persist in the completion receipt and remain visible on recovery.
An expired completed receipt is readable only by its exact authenticated recipient after the
existing account ownership/generation checks. Expired mailbox proofs, login exchanges and
unfinished invitations remain invalid.
Tutee submission and final redemption both resolve verified aliases and recheck quarter withdrawal
and current-request ownership; late alias linking cannot bypass either participation restriction.
An existing tutor can request help through the same tutee form without another account or
credential change. Email normalization or a matching address never authorizes record access,
account combination or replacement. Tutee replacement is independent of tutor recruitment.

First successful Viewer/history verification starts a fixed 15-minute review window; retries retain its original timestamp. Envelope expiry is capped by source and authorization deadlines, and email states the exact expiry. Sending replacements never extends staff authorization or Tutee verification deadlines.

Each envelope captures its account ID and `sessionVersion` at issue. Verification, preview,
login exchange and redemption recheck source validity and email ownership; account reads are
repeated after the credential lock. Password rotation, alias transfer/removal and account
combination invalidate stale evidence. The login exchange is single-use independently of the
membership write. The source write and completion receipt commit in one transaction, permitting
lost-response retries without duplicating accounts, resetting passwords or replaying participation.
An explicit receipt is distinguishable from failed session synchronization in the public form.

`accountInvitation.inspect` is an ID-only read query. Verified-browser proof is
accepted by the POST `accountInvitation.review` mutation, not by query input;
proofs therefore do not enter query URLs, referrers or browser history. Recipient
authority and source checks are shared by both readers. A pending tutee-intent
review returns its exact staged answers, named subjects/time slots, stage-time
policy/signature evidence and retained original priority separately from canonical
account identity. That summary describes the proposed request being accepted,
not an account-profile edit or an inferred policy acceptance.

The three public entrypoints stay separate: `/register` has one centered invitation code field
and full-width Continue action; `/viewer-signup` collects Viewer details; `/signup` collects the
complete tutee application before verification and issuance. Viewer/tutee mailbox verification
opens `InvitationReceipt`, using the shared native `Modal` for the displayed invitation code,
copy action, optional email delivery and prefilled `/register` link. Historical tutee account
setup uses the same popup after verifying the exact invited mailbox. Closing retains the receipt;
failed optional delivery does not repeat verification or the application write. A new account's
shared review adopts source prefill once, while established account identity remains authoritative.
`UserAvatar` and shared `AccountSettings` expose Add access to the same code entry for signed-in users.

### Crew application verification and status

`CrewSignupVerification` keeps the email-unique draft and mailbox challenge separate from the durable, staff-reviewed `CrewApplication`. `crew.submitApplication` stages details and sends a challenge; it creates no application or notification before mailbox verification. `crew.verifyApplication` commits the first verified pending application and its notification together. Retries retain the original answers and decision workflow rather than replacing a record under review.

`crew.requestStatus` accepts only email and returns the same public response for known and unknown addresses. Mailbox verification returns a short-lived status proof; `crew.applicationStatus` requires that proof before returning `PENDING`, `REJECTED`, `ACCEPTED` or `NOT_FOUND`. Challenges and status proofs expire after 15 minutes, and resending invalidates prior proof. Private status and invitation data are never authorized by a matching email alone.

Only an accepted application's live, unused staff-issued Crew code permits receipt retrieval. Fresh mailbox proof opens the existing `InvitationReceipt` with the approved application name/grade prefill; no new invitation kind or applicant-selected membership payload is introduced. Retrieval itself writes no credentials or membership. Shared redemption rechecks staff authorization, recipient ownership, current account restrictions and Crew availability before explicitly adding Crew participation. Revoked, expired or used authorization cannot issue a fresh redeemable receipt, and status refresh does not reopen an already completed membership write.

Crew submit/status mail uses the existing durable signup mail admission and optional CAPTCHA, reusing the configured tutee scene with distinct `crew.submit` and `crew.status` purpose-bound grants. Verification and status reads retain independent admission. The additive `20261009210000_crew_signup_verification` migration adds the challenge table and indexes only; it neither creates accounts nor approves existing applications.

### Opaque invitation codes

New displayed invitations and staff keys use the shared five-character
Steam-style alphabet `023456789ABCDEFGHIJKMNPQRSTUVWXYZ`, with both letters and digits.
Entry canonicalizes `O`/`o` to `0` and, for five-character codes only, `1` to `I`.
The shared browser-safe normalizer keeps input, lookup and quota identity consistent;
longer legacy hexadecimal receipts and OTPs retain digit `1`. Existing displayed receipts
are re-derived with the current or original alphabet only when the persisted hash matches,
so retries and optional mail preserve their code; an unmatched hash fails closed.
Keep the legacy centered, uppercase, widely spaced `XXXXX` code card. Outstanding
twelve-character invitations remain accepted for compatibility; code length must not
determine a new invitation's source or authorization. Server resolution distinguishes
staff keys from displayed invitations, retains proof and exact recipient checks, and
avoids ambiguous code issuance through the shared database namespace lock.
Mailbox verification remains a separate secret: tutee verification uses six hexadecimal
characters, while the resulting invitation uses five Steam-style characters.

The code is opaque: no character or position encodes a role, account identity or
invitation type. The server resolves its value against authorization records and checks
the recipient and purpose there. Expiring invitation, verification and application records
live in the existing database; there is no separate temporary database. Completion applies
the authorized account/access change atomically, preserving original intake and policy evidence.
The additive `20261009190000_short_invitation_codes` migration stores the collision-retry
nonce used to reproduce a displayed code; a null nonce preserves older receipts.

`rememberInvitation` validates the proof on the server and sets a 15-minute HttpOnly, SameSite=Lax
cookie scoped to `/register-account`, Secure in production. The short `/register` link redirects
to this canonical page without carrying proof in the URL. A cookie scoped to `/register` would
not match `/register-account`. The link carries only the invitation identifier
and displayed entry code; mailbox/completion proof and credentials never enter URLs, history or
JavaScript storage. Without the verified-browser handoff, copied codes require mailbox verification.
The additive `20261009170000_invitation_code_handoff` migration adds the displayed-code lookup,
invitation mailbox challenge fields and tutee verification attempt counter without replacing
source intake or policy evidence.

All website credential creation passes through `/register`. Existing staff keys and old survey,
Viewer and historical setup proofs remain compatible entry points: public legacy completion
endpoints exchange their proof for an invitation instead of creating credentials themselves.
Internal domain completion helpers remain responsible for their specific policy and evidence.
Password recovery and the deployment-only first-Head bootstrap are separate deliberate operations.

Apply `20261009090000_universal_account_invitations` before deploying the application. It only
adds an envelope table and indexes; it changes no existing accounts, archived records or grants.
Outstanding source links remain usable. Rollback to the previous application requires retaining
the additive table and acknowledging that emailed envelope links need this version to redeem;
do not drop stored receipts or erase original source evidence during rollback.

## Public signup URL convention

Website and email hrefs publish short links. Descriptive routes render the existing
forms; the exact short paths permanently redirect with HTTP 308 and preserve all
query values, including repeated parameters, invitation prefill and callbacks.

| Published href | Canonical page | Purpose |
| --- | --- | --- |
| `/register` | `/register-account` | Review a shared account or access invitation |
| `/tutee` | `/tutee-signup` | Request tutoring |
| `/tutor` | `/tutor-signup` | Apply to tutor |
| `/viewer` | `/viewer-signup` | Register read-only Viewer access when enabled |
| `/crew` | `/crew-signup` | Apply to the crew when enabled |
| `/tutee/account` | `/tutee-signup/account` | Confirm a tutoring request and set up an account if needed |

`/signup` and `/signup/account` remain permanent compatibility redirects to the
corresponding tutee pages. [Next configuration](../next.config.js) owns redirects;
[authentication](../src/server/auth/config.ts) lists exact public entries without
prefix exemptions. Adjacent paths still require sign-in. Feature gates, API
authorization, invitation formats, approval rules and account workflows stay in
their existing features. The canonical pages reuse the original feature modules.
Verified-browser invitation handoffs use the canonical `/register-account` cookie
scope described above; the published short link redirects without exposing proof.

[CMS href presentation](../src/lib/public-signup-links.ts) maps exact root-relative
signup destinations to short links in buttons and Markdown while keeping stored
content, query strings, fragments, external URLs and private destinations intact.
Seed buttons and editor defaults use the same published convention. Absolute URLs
in stored content retain their explicit origin and destination.

## Architecture

Tutor Roster details use the read-only `tutorDetails.get` procedure, guarded by the same management permission as account policy history. Its explicit field selection excludes authentication secrets; the UI mounts the query only after a staff member opens a tutor. Subject grouping reads concrete grants from approved qualification sources, never recalculating inheritance from current level ranks. Willingness remains a separate three-state value (true, false, or no record). Policy history uses the linked account ID through `student.acceptanceRecords`; neither matching contact data nor viewing a record grants account or role-edit access.

The application runs as a persistent Next.js 16 / React 19 Node server with tRPC 11, Prisma 7/PostgreSQL, Auth.js JWT sessions, next-intl and Tailwind CSS 4. It is not a static export: background verification deadlines, authentication and database mutations require the server.

| Change you need                          | Start here                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add or change a page                     | [App routes](../src/app), [shared components](../src/app/_components) and [message catalogs](../messages)                                                                                        |
| Add an API operation or access rule      | [Router composition](../src/server/api/root.ts) and [procedure middleware](../src/server/api/trpc.ts)                                                                                            |
| Change schema or transactions            | [Prisma schema](../prisma/schema.prisma), [migrations](../prisma/migrations), [database client](../src/server/db.ts) and [transaction helpers](../src/server/transactions.ts)                    |
| Change management review                 | [Operation classification](../src/lib/approval-policy.ts), [proposals](../src/server/approvals.ts) and [approval router](../src/server/api/routers/approval.ts)                                  |
| Change intake or participation           | [Surveys](../src/server/student-survey.ts), [student workflow](../src/server/student-workflow.ts), [ownership](../src/server/student-ownership.ts) and [membership](../src/server/membership.ts) |
| Change profile synchronization           | [Account profiles](../src/server/account-profile.ts)                                                                                                                                             |
| Change messaging or recipient access     | [Messaging permissions](../src/server/messaging-permissions.ts) and [messaging router](../src/server/api/routers/messaging.ts)                                                                   |
| Change hours or historical corrections   | [Hour calculator](../src/lib/service-hours.ts), [meeting hours](../src/server/meeting-hours.ts) and [corrections](../src/server/api/routers/corrections.ts)                                      |
| Change published content or translations | [Slug allocation](../src/server/home/slugs.ts), [translation destination checks](../src/server/translation-destination.ts) and [policy acceptance](../src/server/policy-acceptance.ts)           |
| Change dates or intake labels            | [Program time](../src/lib/program-time.ts) and [period display](../src/lib/period.ts)                                                                                                            |
| Change delivery or deadline processing   | [Email sender](../src/server/email/sender.ts), [instrumentation](../src/instrumentation.ts) and [deadline worker](../src/server/student-deadline-worker.ts)                                      |

### Tutee details

The Tutees roster opens [TuteeDetailsDialog](../src/app/_components/tutee-details.tsx) from one rightmost **View details** action. Its wide `ProfileDialog` combines the existing enrollment summary, ordered subject choices, email controls and tutoring history. Summary academics still use `TuteeAcademicCell`; historical grades and class years remain tied to enrollment evidence. Profile editing, historical linking, discipline and deletion retain their existing workflows.

The management read-only context includes both Viewers and departure observers. They receive only the summary and subject sections; contact mutation observers and history queries never mount. Staff contact keeps the existing owner/user/roster email precedence. A retained historical owner permits contact display but does not enable current-account verification: that control still requires the roster's current `user` relation. `EmailContent` registers its own pending write with the parent dialog, preserving dismissal protection and existing delivery feedback.

`TuteeHistoryContent` shares the existing paginated history view with `TuteeHistoryDialog`. Staff reads retain `tuteeHistory.details` authorization, and personal reads retain the separately owned `myDetails` endpoint. Each opening refreshes history even within the shared cache freshness window. Failed reads keep cached history beside a read-only **Retry** action, without blocking the subject or contact sections. Closing and reopening starts at the first page. Focused coverage is in `tutee-details.test.tsx`, `tutee-history.test.tsx`, `people-summary-tables.test.tsx` and the Tutees page tests.

### Users and Roles details

`admin.accountDetails` is an on-demand, `adminProcedure`-protected read. Its feature-owned projection in `account-directory.ts` separates direct participant attachments from retained Tutor/Student ownership (including the recorded account-combination family). It never matches ownership by names/email, creates accounts, changes membership or returns credential hashes/invitation tokens. Original academic snapshots preserve their enrollment year and nulls, independent of an owner's current profile. Preserved tutor originals are also used by the existing Tutor Details dialog after archive reactivation. Viewing details does not materialize historical evidence.

The Users & Roles page composes existing table actions, `ProfileDialog`, `TableDetails`, academic and policy displays. Detail queries and mutation observers mount only on opening. Each opening refreshes the authoritative detail read, even within the shared query cache freshness window, so independent membership, suspension and profile editors cannot leave reopened details stale. Failed background reads retain cached details with read-only Retry. Badge colors are local presentation, independent of the six accent palettes: management indigo, participation teal, Translator amber and Viewer slate. Summary badge suppression and all filtering logic remain in their existing domain helpers; the detail display adds the underlying accepted Tutee membership. The read-only context hides the private entry, and server authorization independently refuses observers and participants, including stale elevated sessions.

Focused regressions live in `src/app/(admin)/admin/users`, `src/lib/user-filters.test.ts`, `src/lib/account-membership.test.ts` and `src/server/account-directory.test.ts`. Include `src/server/tutor-details.test.ts` for the preserved-academics boundary. Browser verification must use the actual Users & Roles page and native nested dialogs in both languages, then measure badge contrast and control bounds; screenshots and HTML evidence belong in ignored `outputs/`.

### Management review summaries

Management summaries keep participant identity, wrapped metadata and source/status
badges on one content edge. Announcement badges and assignment companions align
with the actual input/select row; labels and described guidance occupy separate
grid rows. Subject-group actions align with the complete summary, including its
offered-subject badges. Leading subject-selection checkboxes preserve the existing
visible-only batch submission and hidden-selection count; detail entries remain
in the trailing Actions column. Offered subjects retain `courseChoices` ordering,
shared with signup forms, rather than introducing a second display comparator.

Action typography follows the record's context: application and signup header
actions share the compact Button treatment (including invalidity and decline),
while brief meeting detail/delete entries share TableAction typography and target
height. The destructive variant changes color and border without changing size.

Tutor Applications and Signup Requests default to **Active entries**, meaning
only that the record is not flagged invalid. Workflow status, intake priority and
processing permissions remain independent. Observers may use the same validity
filter on their authorized signup summary without acquiring private flag actions
or reasons. Uncertain current academics use one **Review Needed** indicator;
historical enrollment originals, correction overlays and reference years retain
their existing precedence and detail evidence.

Both signup sources show verification once in a compact **Email: Verified** or
**Email: Unverified** contact line. The contextual short labels do not replace
full-sentence verification messages elsewhere, and contact access stays with the
existing email reader.

Subject Availability shows each subject with its level and qualification summary.
Qualified subjects also show willingness, including an explicit **Not recorded**
state. Display order is qualified/willing, qualified/unwilling,
qualified/not-recorded, then unqualified, retaining catalog order within each
group. The editor retains separate immediate qualification and willingness writes,
stored inheritance provenance and inactive-source restrictions. Its owner stays
above filtered rows, and accepted-write synchronization failures expose read-only
refresh recovery. Qualification edits still use the existing management operation;
missing willingness never becomes a negative answer.

Subject Offerings retains the server's level-first signup catalogue order. The
parent page does not alphabetize the incoming rows; local filters preserve that
order and selected IDs remain independent of the visible subset.

Tutor Meetings uses P/EA/UA headings with a visible full legend, and opens complete
self-excuse reasons through details. Participant rows reserve the same desktop and
touch control area for choices and badge-only attendance. Attendance submission
details read the recorded start/end/duration, tutor and tutee absence reasons, five
self-evaluation values, full comments and service-hour factor/count. Null evaluations
remain unrecorded; merged sibling zero hours remain zero. These readers do not
infer past evidence from a pairing's current configuration.

Attendance flags filter the existing `viewerProcedure` read by recorded decision
state, defaulting to Pending. Resolved records remain readable and cannot be
decided again; the existing locked, pending-only mutation and approval rules stay
authoritative. Decision notes and reviewer names are masked for management
observers. Feature-owned note/penalty drafts survive dialog close and filters.
Admission guards block same-turn duplicates, pending writes prevent dismissal,
and accepted/queued decisions cannot replay through failed synchronization.

Audit difference markers compare only stored JSON values and presence. They
support both root before/after snapshots and canonical `changes[n].before/after`
pairs while keeping entity/write/count context and complete raw evidence.
Type changes, additions and removals receive text as well as color; arrays compare
recorded positions without guessed identity. Empty, null, missing, false and zero
remain distinct. The reader never reconstructs evidence from current records and
continues to exclude executable `undoData` recursively. Denial eviction and
read-only refresh remain owned by the audit feature.

Consequential boxed buttons keep their outlined boundary with red labels at rest.
Destructive text actions and table entries are red and unboxed at rest and on
hover. Shared table actions use a thick, offset keyboard-focus underline instead
of a surrounding ring; standalone text actions retain their existing focus treatment.
Ordinary links precede boxed decisions
in a record action group, and Delete remains last in DOM and keyboard order.
Native button/link semantics, confirmation/ticket rules and responsive targets
remain intact; styling is assigned explicitly rather than inferred from labels.
The synthetic management summary recipe in `/ui-gallery` demonstrates control-row
alignment, leading selection and consequential review/focus return. Focused
regressions cover the corresponding feature components and real-page compositions;
browser measurements and role/language evidence still require the running pages.

### Shared UI patterns

The [session view API](../src/app/_components/session-view-state.tsx) stores explicit
tabs, filters and pages in `sessionStorage`, partitioned by the existing session
identity (account/role/tutor link), pathname, feature/schema ID and feature-supplied
period/query scope. The provider consumes the existing identity verification and
privacy curtain; it adds no identity requests. Every returned choice passes its
current feature allowlist. Denied/removed features clear their remembered choices.
Dynamic catalogs use the separate `restoreReady` gate so empty loading options
cannot erase saved room/period IDs before the authorized choices arrive.
Named `viewFields` parsers normalize the stored representation as well as the
rendered value. `useSessionAccessDenied` holds an authoritative query denial through
later transport failures until fresh successful reads, while the feature hides its
cached denied content. Both are presentation helpers; procedure permissions remain
authoritative.
The bounded [storage helpers](../src/lib/session-view-state.ts) reject nested record
payloads and long bodies, retain at most 100 presentation entries, and degrade
gracefully when storage is blocked. These structural limits supplement explicit
feature allowlists; they do not authorize storing private draft fields.
Live search parsers preserve the feature's original input limits independently of
those storage limits. A valid longer search remains in memory across ordinary
rerenders and filter changes; a rejected/failed storage write removes only its
previous saved entry so remount cannot revive older criteria. ID/URL parsers retain
their own bounds and dynamic catalog checks. The 4 KiB UTF-8 budget includes the
encoded route/scope key plus value; oversized contexts disable only persistence,
with a cheap character check before encoding. No generic parser bypass is used for
denial, scope changes or removed choices.

`useSessionPageScroll` restores only the page owner: fixed desktop management
`#admin-content`, otherwise the document, switching at the 1024 px breakpoint.
It waits for the feature's usable reads, observes delayed content growth for at
most five seconds, and cancels recovery for user gestures or hash destinations.
The window remains active after first fit to repair late Next programmatic resets;
only a measured mismatch schedules correction, so its own scroll events do not loop.
Route exit writes the last valid position and cancels frames, timer and observers.
The last measured scroll position is retained on route exit even before the next
animation frame. It does not alter Next history state, global scroll restoration,
table/dialog/sidebar position, form drafts or server permissions. Explicit tutee
URL views remain authoritative; a verified bare workspace return may recall the
previous view. Gallery filters and participant/inbox adapters reuse the same API.
Management adapters cover application/interview read criteria, request panels and
invalidity, discrepancy state, subject-availability filters, course-catalogue filters,
applied audit criteria, approval URL criteria, signup-form panels, landing/policy
languages, supervision visibility/page and applied academic-correction criteria.
Creation fields, bulk selections, review notes, private message searches, tokens and
opened editor sets are excluded. Lazy landing panels report selected-query readiness;
policy locale restoration includes existing translations only. The dashboard and
record-transfer shell register position after their authorized server reads; Activity
uses its feature-dependent required queries, and account position waits for its
mounted identity, email, departure and policy sections. This coverage describes these
owners, not a generic layout restoration rule. Actual Next navigation evidence
is required to verify framework scrolling.

The remaining management adapters persist attendance month/tutor/visibility,
report year/scope/depth/masking, service-hour month, directory filters/search/sort,
meeting summary/visibility and Crew panel selection. The
[management view parsers](../src/lib/management-view-state.ts) explicitly allowlist
these flat fields. Directory filters now use session storage instead of the former
localStorage preference, with no migration; hidden tutor-status selections retain
the existing normalization rule. Removed tutor/year IDs normalize to All/current
year after their real catalogs load. Disabled quarter choices normalize to Year,
and observer report masking remains mandatory on the server and in the controls.
Crew keeps independent section recovery: a denied remembered panel falls back,
while an explicit visit can still reach its read-only Retry state without saving
that denied selection. Meeting creation fields, attendance editor choices, appeal
reviews, patrol order drafts and issued codes are excluded.

Hour Adjustments, Announcements, Registration Codes, Discipline and tutor/tutee
status requests remember page position only. Each actual page owner registers one
scroll hook after its authorized reads. Tutee Requests receives only readiness and
denial booleans from staff-only withdrawal feeds; the child adds no scroll hook,
and the observer-safe parent never borrows access to those private reads. Crew's
patrol history reports the same read gates plus its numeric page index, so the page
waits for the selected patrol feed without persisting its opaque cursor chain. Access
denial clears remembered choices and conceals cached content until read recovery;
attendance evicts every cached month because clearing filters can change its query
key. No adapter stores result rows, immutable evidence or write payloads.
Current modern and manual request cards render an empty canonical name using an
authorized linked username or the localized unnamed-participant label. The modern
read DTO adds only current username metadata; intake `name`, payload, review
assignment names and immutable history remain unchanged. Search still uses raw
domain values rather than presentation fallback labels.
Behavioral coverage is in `session-view-state.test.tsx`, the pure storage tests and
the existing identity-cache/privacy tests; actual page screenshots remain separate
from these mocked layout checks.

Viewport recovery belongs to the mounted feature and its original pathname.
During a Next navigation, the outgoing listener must ignore destination scroll
events, queued persistence and recovery callbacks once the browser URL leaves
that pathname. Cleanup flushes only its last valid source-page measurement.
A retained outgoing feature cannot adopt a newly verified destination pathname;
a different feature ID or a new mount establishes the next owner. Genuine
same-route scrolling to zero, explicit hashes and user gestures retain precedence.
Unit coverage must model URL change before React teardown, and actual Next
out/back verification remains the acceptance gate for this ordering.

Long editors and readers use `ProfileDialog` with a sticky header and a body
stacking context below that header. This contains nested summary-table sticky
action cells: their local layering cannot obscure Close when a long evidence
table scrolls under the header. Native dialog focus, pending-write registration,
feature drafts and version ownership retain their existing boundaries. The gallery
includes a long reader with real sticky table actions; structural/lifecycle tests
and actual desktop/mobile English/Chinese deep-scroll captures verify the correction.

Recruitment settings position each audience's fieldset to contain its absolutely
positioned screen-reader legend and date labels. Without a local containing block,
those clipped one-pixel boxes can extend the document beyond the desktop management
pane and let focus or `scrollIntoView` move the header. The correction retains all
accessible labels, audience drafts, version evidence and edit/proposal authority;
it does not alter the shared document overflow or scroll-restoration owner.

Local panel composition leaves authority in existing owners. Program keeps its
already-mounted settings forms and their independent versions; Crew and Support
retain draft, review and pagination state when panels change. Review controllers
and accepted-write recovery remain outside hidden panels. Creation dialogs own
visibility while the feature keeps its draft; Pairings stores creation and editing
drafts separately and submits the existing assignment-confirmation payload.

Roster search runs over the already-authorized response before sorting, using
the existing person-name matcher. The pairing candidate filter never rewrites
selected IDs. Neither composition adds an endpoint, searches hidden records or
changes record eligibility. `WorkflowShell` retains its 1024 px outer frame while
using the shared header/identity and return-link conventions. Tutor dashboard
attention counts use existing records and exclude paused interviews. The attention
card retains task-specific links and today's schedule; its duplicated permanent
section-link strip is removed. The actual workspace navigation remains available.

Management editors distinguish `canEdit` (permission to prepare a proposal) from `canApply`
(direct authority). Admin-sensitive editors retain drafts and show the approval link after
submission; Coordinator-sensitive controls are read-only. The same operation classification
governs submission, reviewer eligibility and replay. See the
[responsibility matrix](program-reference.md#management-responsibilities-and-review).

The [named action review](../src/app/_components/ui/action-review.tsx) composes
`Modal`, `Button` and `InlineNotice` for destructive management records. Each
feature supplies its unchanged mutation payload, a read-only refresh callback and
its proposal-error adapter. An immediate admission guard excludes duplicate
submissions; the review owns pending writes and refreshes, retains rejection
feedback, distinguishes queued proposals from applied changes and never replays
an accepted mutation after a failed read. A failed refresh remains recoverable
after Close. The [contributor inventory](contributing.md#consequential-action-inventory)
identifies these consumers and the stronger domain reviews that remain separate.

[UI components](../src/app/_components/ui) provide behavior and composition without owning domain mutations. `Button` exposes action emphasis separately from context size; `ChoiceButton` uses pressed state for a selection; `Switch` exposes checked state. `SectionTabs` uses manual keyboard activation so arrow-key exploration does not switch an editor and discard its draft. `FormSection` groups one save scope and disables its fields/actions while busy. `StatePanel` keeps loading, empty, error and denied states distinct.

[QueryFeedback](../src/app/_components/ui/query-feedback.tsx) uses `StatePanel` when
an initial read is pending or failed, and `InlineNotice` when a failed refresh has
cached data. Its `hasData` flag describes response presence, not collection length;
an empty array is a successful read, while an enabled query with undefined data is
still unknown. Error feedback remains visible during Retry. The component receives
translated titles, optional detail and a read callback; it does not fetch, mount
feature children, infer empty results, grant access or own mutation/draft state.
Callers keep cached content beside transient recovery and disable only dependent
writes. Authoritative access denial must hide private content and invalidate the
affected private cache; a later transport failure cannot restore that access.
Feature tests must cover these ownership rules in addition to the shared display
tests and gallery example.

`NativeDialog` supplies native modality, portal event ownership, radio-aware keyboard focus and exact trigger restoration. `Modal`, the wide/sticky `ProfileDialog`, and `CurrentPolicyDialog` share this behavior while retaining their own layout and scrolling. A nested review owns its Escape event. Independent forms call `useDialogPending(ownPending)` to prevent dismissal during any registered write; its return value disables sibling controls. Register only the form's own pending state, never the returned aggregate, so the guard releases when writes settle. Callers retain validation, versions, permissions, approval policy and action tickets.

Management pairing, tutee and tutor creation first presents a shared risk dialog
with a fresh unchecked acknowledgement, Cancel and Continue. Continue only admits
the feature's existing creation fields; it performs no mutation or proposal and
does not replace server permissions, action tickets or approvals. Each feature
owns its opening transition and retained creation draft, so closing and reopening
requires acknowledgement again without clearing unfinished fields. The warning
describes these manual workflows as a last resort outside normal intake/matching.

Users & Roles account deletion uses a feature-owned password form inside `Modal`.
The list-owned [AccountDeletion](../src/app/_components/account-deletion.tsx)
captures an authoritative `admin.previewDeleteUser` snapshot and its fingerprint,
retains a rejected password draft, and guards same-turn admission. The shared dialog
owns native modality, pending dismissal and trigger focus; a delayed initial read
focuses the password only before the user begins exploring. Explicit Reload replaces
a stale snapshot only after a successful read. Denied evidence remains concealed
through later transport failure. Accepted deletion and failed list synchronization
have separate states; retained read recovery cannot replay the mutation or offer a
known-deleted row again.

[Deletion](../src/server/delete-account.ts) receives `userId`, the reviewed
`fingerprint` and `confirmPassword`. Namespace, leadership, sorted account advisory
locks, dependency-table fences and User row locks serialize the live password,
authority and consequence check with signup/profile/ownership changes. Audit commits
with deletion in the existing request scope or the helper-owned transaction. The
preview separates current academic/departure singletons from their evidence counts,
and deduplicates direct/retained profile IDs. Existing cascade and nullable-reference
semantics remain explicit, while combined families, retained Tutor/Tutee owners and
unconfirmed email-bound intake receive specific blockers. Scalar Student ownership
has no foreign key, so its blocker prevents a dangling inaccessible archive. Login
deletion removes expiring action grants too; sessions and invitation proofs fail
their live account/generation checks. No countdown or new confirmation ticket is added.

`TimedActionDialog` retains its separate ticket/countdown and mandatory-policy
contract. Like `NativeDialog`, it disables native close requests and suppresses
Escape's default action while busy; mandatory consent keeps those protections
while idle, with its explicit Sign out action still available. A cancel handler
alone cannot reliably block repeated native Escape requests. Component tests
cover the key and close-watcher contracts; actual browser verification must cover
repeated Escape during a held write and dismissal after failure.

Account, tutor and tutee profile forms run inside that dialog context: direct submission checks sibling work as well as the form's own same-tick guard. Profile and Head username saves leave the editor open for deliberate Close, including when all sections succeed. Pending becoming false does not prove that independently admitted sibling writes succeeded. Failed academic, membership, departure, username or profile drafts remain mounted with their errors and original versions for retry. A committed section shows its saved status and remains read-only while its Save handler automatically loads a fresh server snapshot, then re-enables it for another explicit Save. Failed reads retain the completed lock and expose **Retry refresh** without resubmitting the write. Automatic completion never moves focus into the refreshed section; explicit recovery may restore focus if the user has not moved it. Adopting the new section fields, structured-name baseline and expected version never replaces a sibling draft. Synchronization failure is shown separately from write failure. Saved/failed outcomes never register as pending writes, and idle Close/Escape remain available. `ProfileEditSection.readOnly` separates the refresh lock from saved feedback; editing again clears the old success notice.

Those four profile/username save handlers use `settleRefreshes` to keep their mutation pending until every invalidation settles, then force an authorized matching-row fetch with `staleTime: 0` before adopting the new section snapshot. It starts all callbacks even if one throws synchronously, preserves successful results and forwards a failure only after the whole group finishes. The nested `invalidateTuteeViews` group uses the same boundary, so an early roster error cannot hide a still-running attendance, pairing, account or history refresh. That helper retains its existing five view targets and rejection semantics for its other callers; their surrounding workflows are unchanged. The committed section remains read-only throughout; a successful matching fetch unlocks only its own draft. On failure, the refresh warning and idle Close become available only after settlement. Retry repeats the refresh group and matching read, never the mutation.

Each of those handlers uses `invalidateAndReport` to report actual read failures while retaining QueryClient's ordinary `throwOnError: false` waiting for every matching read. A typed predicate snapshots each matching query's `errorUpdateCount` once; after invalidation settles, an increased count reports a new failure. An old inactive cached error alone does not produce a warning, and a later successful refresh can recover. The helper keeps the target's existing scope and issues no extra GET. `invalidateTuteeViews` opts into this reporting only for the committed profile handler; other callers retain their existing error handling. Enabling `throwOnError` directly would reintroduce early rejection across matching query keys, so real QueryObserver regressions cover both complete read ownership and error reporting.

Discipline review and attendance correction also register their own writes inside table details. Their notes and correction fields freeze with dismissal while saving, and queued approvals retain the draft with an explicit pending-approval message. Background refreshes preserve each draft's expected version; explicit successful Reload replaces it. Attendance correction collapses only after an applied write has synchronized and settled.

Account name and management username Reloads exclude their own Save immediately through refs as well as disabled form fields. A failed read preserves the draft, version and mutation error; a successful explicit read adopts only the matching account. These reads never register as dialog writes, so Close/Escape remains available. Username writes keep their existing live Head authority, audit and server-version checks.

Explicit Reload in discipline review and the account name/username editors bypasses the normal 30-second query freshness window. A still-fresh cached list cannot clear a conflict or replace the draft; the requested server read must succeed first.

Academic Reload requires both the academic record and current profile policy to report successful reads with data before discarding the conflicting snapshot. Cached data in a failed result is insufficient. Both reads start even when one throws synchronously, and the panel waits for both to settle before releasing its own reload guard. Failure retains the mounted grade/reason draft, captured version/year and conflict alongside localized retry feedback. `AcademicPanel` registers only its own mutation/reload work; `AcademicForm` consumes the dialog aggregate for sibling exclusion without registering it again.

Historical or corrected tutee contact saves and historical or preserved tutor profile saves omit grade and graduation fields; those edits belong to Academic Corrections. Historical tutor reactivation preserves the unchanged original before returning to current membership, so status changes cannot reopen generic academic editing. Membership badge saves, requests and leadership transfers register only actual writes and share an immediate submission guard. Departure confirmation keeps its captured revision and draft through failure and waits for registered sibling writes before completing. Historical identity previews remain dismissible reads; link, invitation and cancellation writes register their own pending state. A failed link requires a new preview and acknowledgment. Alumni invitation status and cancellation retain their revision checks independently of historical academic correction evidence.

`SummaryTable` provides a named keyboard-scrollable region around a semantic table. Keep names, counts and statuses brief. When a row has detail/editor actions, place them in the trailing `TableActions` cell; only explicit action cells stick at the right edge. Read-only history tables need no invented action column. `TableAction` preserves button semantics with compact accent text links (24 px desktop minimum, 44 px below `lg`, no extra vertical gap). Wrapped or enlarged labels can grow beyond the minimum. `TableDetails` mounts a native modal only when opened. Roster course details keep their original read access; contact, account and history disclosures retain separate authorization and lazy queries. History exports and printed reports preserve full detail.

`FilterToolbar`, `SettingRow`, `ChangeReview` and `InlineNotice` are presentation compositions with caller-owned state. A filter uses pressed choices; only actual content views use tabs. Immediate switches, explicit unknown/yes/no willingness and staged checkbox settings preserve their distinct save behavior. Change review accepts domain-owned immutable evidence such as `ApprovalReviewDetails`; it never generates authorization or confirmation tickets. Announce new failures or completions explicitly and avoid wrapping existing alerts in another alert.

`TableDetails` can opt into `longReader`, composing `ProfileDialog` for a persistent
header Close and an internally scrolling body. The room grid, original Crew
application/request readers and gallery exercise this option. Children still mount
only after opening; nested focus, Escape and pending child writes use the existing
native-dialog contract. This adds no detail query or authorization behavior.

The participant `Pager` wraps compact previous/next controls in a named navigation
region and reports the current page. Its optional translated `label` distinguishes
multiple lists on one page, including message recipients and inbox results. Each
feature retains its own `page`, setter, `more` calculation and filter reset rules;
the component does not fetch data or infer a total number of pages. Controls wrap
for long labels and keep the existing desktop/touch size hierarchy.

Discipline review, the Service Hours month filter and Session Flags use compact
actions beside native fields with explicit desktop padding/min-height overrides.
Measure their rendered rows; class names alone do not establish equal height.
Session Flags distinguishes unknown/loading, failed, denied and successfully
empty reads. Cached failures retain review drafts with editing disabled until
recovery. Pending writes freeze notes and penalty hours, and an approval ID is
announced as queued rather than applied.

Content-sized controls in wrapping forms can use `.field-auto-bounded` with a preferred minimum such as `[--field-min-width:12rem]`. The shared utility caps that minimum at the available width, so enlarged text cannot make a rem-based minimum override `max-width: 100%`; existing `.field-auto` callers keep their own minimum-width behavior. Constrain intervening flex field wrappers with `min-w-0 max-w-full` too; otherwise a long draft can size the wrapper beyond the form. Registration Codes and Meetings use this contract. Verify long EN/ZH drafts at 390 px with 200% root font size in the running application; compiled CSS checks do not establish browser layout acceptance.

Stacked card grids should declare their narrow layout explicitly, such as `grid-cols-1` before `lg:grid-cols-5`. The Activity summary uses this zero-minimum track so enlarged chart labels cannot expand an implicit grid column beyond the padded card. Verify the populated chart at 200% text size as well as its normal and desktop layouts; preserve queue destinations and avoid concealing overflow on the card.

`DisclosureSection` requires an explicit lifetime: `lazy` unmounts closed read details, `retained` mounts once and keeps drafts through collapse, and `mounted` preserves existing creation forms from the start. Participant forms compose `PersonNameFields`, `FieldRequirement`, offered-grade and academic controls without recreating name/version rules. `PublicFormPage`, `PublicFormCard` and `PublicPageNavigation` share public framing and language/back navigation; wide personal history retains its separate layout.

`PublicHeader` composes the shared `PublicHeaderFrame` with real preference controls; the gallery supplies local controls without changing preferences. It shares one responsive brand/language/navigation/theme arrangement across public pages; `WorkspaceHeader` also serves patrol, localization and standalone workflows. `SectionLinks` keeps route destinations as native links with `aria-current`; tutee browser history stays native. Translation and supervision panels use manually activated `SectionTabs`, mounting on first access and retaining drafts in React `Activity` while hidden. Capability checks sit outside retained panels so revocation unmounts them. Cached identity refresh errors retain drafts but disable editing until Retry succeeds.

`RegistrationProgress` owns only numbered progress and deliberate step-heading focus after invitation code entry. Registration features own data, pending guards and proof lifetime: every identity edit clears the local completion proof and code, a different invitation resets prefill/credentials, and the server revalidates browser proof. Credentials and proofs never enter URLs, browser history or JavaScript storage; the verified public-form handoff uses the short-lived HttpOnly cookie described above. Reply uses separate in-memory general/per-recipient drafts with each payload’s idempotency key. Cancel restores the prior draft and opener focus; pending sends and unresolved permission queries block retargeting. `focusVisibleContext` measures the actual sticky header before revealing a focused target.

Feature integrations include the three participant/account editors, roster actions, account identity settings, meeting attendance, interview panels, profile/CAPTCHA settings, combine-account candidates and public history. Cached query failures retain usable content and drafts. Background refetches preserve the profile policy snapshot; successful saves and explicit successful Reloads update it. The shared-pattern migration is recorded in [issue #219](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/219); verify each changed feature against its current domain contract.

Tutor availability keeps a local draft once editing begins, so background query updates cannot discard it. A successful mutation is followed by an explicit throwing refetch before releasing the draft: the server filters inactive slot IDs and returns only a count, so the submitted list is not authoritative. If synchronization fails, the submitted choices remain visible and locked with a read-only retry; only the refreshed result unlocks editing. See [issue #223](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/223).

Tutor attendance also admits a submission synchronously, before React can render
disabled controls. A failed write releases admission without replacing the draft;
acceptance keeps it locked through totals refresh and read-only recovery until
Submit another entry. The server's attendance deduplication remains authoritative
across clients and retries. The form's real-mutation lifecycle tests cover
same-turn submissions, rejection/retry, accepted writes with failed refresh and
local validation correction; they do not establish database persistence.

The [development gallery](../src/app/ui-gallery/gallery.tsx) imports the same components and styles. It owns only local synthetic state, including locale and temporary theme previews; its [server route](../src/app/ui-gallery/page.tsx) refuses production rendering. See [local verification](local-development.md#ui-pattern-gallery) and [contribution rules](contributing.md#reuse-interaction-patterns).

The [composition examples](../src/app/ui-gallery/recipes.tsx) cover reusable workflows including navigation/registration steps, long dialogs, participant forms, filter toolbars, disclosure lifetimes, setting rows, change review and inline recovery. Existing feature implementations remain the reference for domain behavior: [profile policy settings](../src/app/_components/program-profile-settings.tsx) demonstrate cached draft/version recovery, [management actions](../src/app/_components/management-actions.tsx) demonstrate compact mixed controls, and [profile dialog tests](../src/app/_components/profile-dialog.test.tsx) cover child-write registration and focus ownership. Use the [agent component map](../AGENTS.md#start-with-the-shared-patterns) to choose the composition and the [verification matrix](local-development.md#ui-verification-matrix) to check its integration.

Gallery recipe descriptions allow long component names to wrap, including inside
the nested public-form card. Verify both English and Chinese at 390 px with 200%
root font size: text can paint beyond a correctly sized paragraph, so inspect
text rectangles and page scroll width as well as element bounds. Capture enlarged
failures before restoring the font size; CSS-contract tests alone do not establish
browser layout acceptance.

### UI extension boundaries

Page composition is caller-owned within the existing shell. The
[role-based composition guide](contributing.md#compose-a-page-by-its-purpose)
defines frame, padding, typography and copy choices; it does not introduce a new
`PageHeader`, layout registry or token API. The management frame includes its
sidebar and remains 1280 px maximum, while participant workspaces remain 1152 px.
Reader and compact public frames serve different tasks and may stay narrower.
Embedded account/form sections inherit the host heading and alignment rather than
creating another page shell. Keep shared control and header behavior governed by
[AGENTS.md](../AGENTS.md#control-height-hierarchy).

Choose hierarchy around existing data and actions. A task summary may link to an
existing schedule, request or attendance destination; it must not infer new
eligibility, deadlines or “next session” calculations in a presentation component.
Label optional future helpers and layout variants as proposals until real callers,
their contracts and tests exist. A composition migration preserves feature/query
ownership even when fields move between a page, retained panel and dialog.

The default extension path is a small feature adapter composed from existing
components, described in [Add an action or feature](contributing.md#add-an-action-or-feature).
There is no general action registry, schema-driven form engine or shared component
that derives permission from a visual state. `ReviewedAction` in
[action-review.tsx](../src/app/_components/ui/action-review.tsx) is the existing
contract for one named consequential review; it is not the domain operation model.

| Owner | Responsibilities | Existing entry points |
| --- | --- | --- |
| Server feature | Validate input and live authority; enforce ownership, versions/tickets, transactions, approval replay and immutable evidence | [Procedure middleware](../src/server/api/trpc.ts), [approval classification](../src/lib/approval-policy.ts), the owning router and domain helpers |
| Feature controller | Own drafts, selected record, expected version, localized consequence, mutation, proposal/error adapters, affected refreshes and the lifetime of review/recovery | [Announcements](../src/app/(admin)/admin/announcements/page.tsx), [crew](../src/app/(admin)/admin/crew/page.tsx), [profile editor](../src/app/_components/account-profile-editor.tsx) |
| Shared interaction | Render controls and native dialogs, focus/pending behavior, review admission and accepted-result recovery without inventing domain permissions | [Action review](../src/app/_components/ui/action-review.tsx), [NativeDialog](../src/app/_components/ui/modal.tsx), [form/state compositions](../src/app/_components/ui/patterns.tsx) |
| Presentation | Express hierarchy, labels, density and record summaries consistently without changing writes or query access | [Button](../src/app/_components/ui/button.tsx), [SummaryTable](../src/app/_components/ui/summary-table.tsx), [gallery recipes](../src/app/ui-gallery/recipes.tsx) |

An action has two independent classifications. Its interaction may navigate, select,
save a draft, apply an immediate setting or review a consequence. Its server effect
determines whether the current actor can apply, propose or only read. Changing an
interaction style does not change `classifyApproval`, reviewer eligibility or ticket
requirements. A new reviewed server operation also needs authored immutable review
vocabulary and tests; follow [Approval transactions](#approval-transactions).

For `useActionReview`, `commit` contains only the feature mutation. `approvalId`
recognizes the existing queued-proposal outcome; `renderError` maps only known
feature errors. A rejected write permits a deliberate retry. An accepted write or
queued proposal blocks replay of that review key. An applied write then runs its
separate `refresh`: failure is synchronization recovery, not mutation failure.
`invalidateAndReport` detects new read failures after all matching variants settle;
`settleRefreshes` does the same waiting across refresh families. Recovery never calls
`commit` again. `repeatAfterRefresh` allows a fresh deliberate review only for a
domain action that becomes meaningful again. Keep the controller mounted above the
row or tab that an accepted action can remove.

If an authoritative query denial revokes access to the evidence in an open review,
the feature hides that review immediately and calls `revoke()` to release its stored
action. This does not cancel an admitted server write. Pending generations remain
blocked until they settle; accepted and queued keys remain protected against replay.
Callbacks from a revoked generation cannot restore evidence, close a newer review
or release an accepted key. A transport failure alone must not revoke a review.

Draft forms have a different lifetime. Retain one draft and version per independently
saved section, freeze that section during admitted work, and distinguish background
Retry from an explicit successful Reload that adopts a new snapshot. Use the current
profile completion contract for repeat edits instead of using action-review replay
as a save mechanism. `FormSection` provides layout and disabling; it does not perform
validation, fetch versions or decide when a draft is safe to replace.

Prefer a feature adapter over copying an entire dialog: shared focus, admission and
recovery fixes then reach every consumer. Keep stronger domain reviews separate when
they need tickets, countdowns, password proof, assignment previews or multiple version
snapshots; forcing these into the smaller contract hides important differences.
Extract another shared helper only after real callers share the same lifetime and
failure semantics, with explicit inputs and tests for each caller. A future starter
generator or lint rule would be new tooling, not an existing API; first demonstrate
which repeated omission it prevents without inferring authorization or deleting a
feature's deliberate exception.

### Review-batch extension contracts

The following contracts were agreed before the next UI implementation batch. They
describe its boundaries; individual feature sections remain authoritative for
what is currently implemented until their migrations and verification are complete.

- **Informational tutoring dates:** no-tutoring dates carry a program-local date
  and reason independently of the school-day calendar used by appeals. Displaying
  a date must not prohibit attendance, change an appeal deadline, cancel a pairing
  or infer a next session. Preserve the existing settings approval and audit model.
- **Name requirements:** per-account-type Required, Optional and Hidden states
  apply to signup and later profile editing. All fields may be optional or hidden;
  an account without a displayable name uses its username. Signup uses the intake
  type being registered; a shared profile follows the account's current role,
  rather than combining every membership's requirements. Hidden fields do not
  contribute to active display names or participant forms, but their saved values
  remain visible in authorized admin management fields. Hiding a field never
  erases an existing name or rewrites historical evidence. Resolve fallback
  username allocation and legacy unsplit-name compatibility in the server validator
  as well as the UI. A presentation-only
  `required` change is insufficient. Policy reads and saves retain explicit
  versions, approval boundaries and conflict recovery.
- **Room order and schedules:** display order is a program-owned setting separate
  from patrol order. Room selectors default to all rooms for management and paired
  rooms for a tutor. Combined and individual-room grids are two views of the same
  authorized recurring data. Individual grids use time rows and weekday columns;
  occupied gray cells and unavailable crosses need accessible status text and a
  legend. Detail filtering by day, slot and room does not create assignments.
  Participant availability headings, accessible group names and schedule-review
  summaries use the active locale through `formatWeekday`. Its fixed UTC/ISO
  reference localizes presentation without changing weekday indices, slot IDs,
  minute values, availability saves or confirmation-ticket request targets.
  Active availability weekday labels must use readable slate text on the white
  editor surface; they are grouping labels, not disabled metadata. The tutor
  qualification Request and Cancel controls share the standard action size
  (40 px desktop minimum, 44 px touch minimum), while their colors express
  emphasis. Browser verification measures the painted weekday leaf and both
  action rectangles; locale, slot IDs, drafts and mutation ownership are unchanged.
- **Flag history:** state filters must query the authorized server dataset; a
  client-only filter cannot reconstruct resolved entries from a pending-only read.
  Preserve pending-only decision guards, immutable resolution evidence and the
  existing review/penalty operations when adding read history.
- **Evidence differences:** highlight changes between recorded Before and After
  values without replacing the original values. Preserve missing versus null,
  array order and full raw evidence access. Never compare an audit event against
  today's mutable record or fetch additional private data solely to decorate it.
- **Navigation restoration:** session storage may hold validated view preferences
  and scroll offsets, not domain drafts, record evidence or authority. Clear or
  ignore state across identity/access changes. Restoration waits for the relevant
  content layout and respects explicit navigation and the user's own scrolling.
  Static Requests panel/filter enums remain interactive while content loads;
  dynamic catalog parsers retain their readiness gate. An accepted early live
  choice has transient provenance for its exact identity/path/scope key and wins
  an older saved/default view after verification. Key changes, denial or catalog
  invalidation discard that provenance; storage writes still require verification.

These are feature contracts, not a general form engine or permission registry.
Add shared layout helpers only where real callers have the same alignment and
lifetime requirements, with gallery examples and meaningful behavior coverage.

### Confirmation timing contract

[`confirmationDelayMs`](../src/lib/confirmation-timing.ts) is the source for server
confirmation delays. These shorter action-specific waits replace the previous
uniform five-second action delay, ten-second policy delay and three-second
qualification override delay:

| Ticket action         | Previous | Current | Reason                                                                                                |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `RECALL`              | 5 s      | 2 s     | Brief single-request consequence; permanent closure and new queue priority stay explicit              |
| `ABORT`               | 5 s      | 3 s     | Quarter withdrawal warrants a longer consequence review                                               |
| `SCHEDULE`            | 5 s      | 2 s     | Proposal with an explicit reason; approval still owns assignment removal                              |
| `APPROVE`             | 5 s      | 3 s     | Participation-ending or assignment-releasing decision                                                 |
| `DENY`                | 5 s      | 2 s     | Close the application while preserving the current request/assignment                                 |
| `ASSIGN`              | 5 s      | 2 s     | Review the learner, subject and tutor before the assignment or proposal                               |
| `ASSIGNMENT_OVERRIDE` | 3 s      | 2 s     | Named qualification mismatch, independently acknowledged by proposer and reviewer                     |
| `POLICY`              | 10 s     | 5 s     | Retain more reading time alongside unchanged document-bottom, agreement and immutable evidence checks |

`prepareStudentAction` and `prepareAssignmentOverride` return `readyAt`,
`expiresAt` and a `serverNow` snapshot taken after ticket creation. Both dialogs
anchor that snapshot to `performance.now()` at response receipt. Readiness ignores
client wall-clock skew; expiry conservatively subtracts the observed request
round trip, an upper bound on response transit. Boundary callbacks and
focus/visibility recovery update the label/status, while a live click-time check
uses the same calculation before admission. No callback submits an action at zero.

Changing the action/target or assignment identity remounts its preparation
generation. Late responses cannot expose old proof, and cancellation removes only
the actor's unused ticket. Submitted proof survives a dialog handoff to the
qualification step. A ref blocks same-turn duplicate admission until its returned
mutation promise rejects (even if the pending render is batched away), or a legacy
callback exposes a rejection; an already-visible error cannot release that guard.
Failed qualified writes offer explicit rechecking instead of an automatic retry loop.
Expired reviews offer renewal; policy Refresh remains in its existing footer and
resets read/agreement evidence through the policy feature's own recovery.

The server remains authoritative: `readyAt <= now`, `expiresAt > now`, matching
actor/action/target and unused proof are required atomically with the operation.
Permissions, password step-up, proposal approval and policy revision ownership
remain feature-owned. Ticket lifetimes stay at 30 minutes for student actions and
5 minutes for qualification overrides. Verification expiry, resend cooldowns,
rate limits, signup opening clocks and session timeouts are outside this contract.

## Identity and authorization

Confirmed school departures are stored separately in `SchoolDeparture`, with versioned
`SchoolDepartureEvent` records. [Portal access](../src/lib/portal-access.ts) derives
read-only observer access without rewriting roles. Protected procedures and workspace
layouts reload this state; Viewer masking applies equally to departure-based observers.
[Departure transitions](../src/server/school-departure.ts) serialize with period refresh
and account changes, close current participation, and preserve historical records.
Self-service and non-Head decisions use the Head approval queue; stale revisions fail.
See [migration instructions](deployment.md#school-departure-migration) for the explicit
legacy graduation backfill and [program behavior](program-reference.md) for access rules.

[Authenticated password confirmations](../src/server/auth/password-confirmation.ts) share ten attempts per account in a sliding fifteen-minute window across account/tutor settings, email ownership actions, privileged reauthentication and account combination. The server rejects empty or over-1024-character confirmation inputs before hashing. Both correct and incorrect checks consume a slot; a successful password, later MFA failure or rolled-back action does not reset the budget. Blocked calls do not extend it; waiting for attempts to expire restores access. Keys use the caller's stable account ID, so another account on the school network is unaffected. Existing stricter action limits, sign-in limits, MFA codes and live authorization checks remain separate. Like the existing sign-in limiter this store is per process and resets on restart; horizontal scaling requires a shared limiter. Passwords and attempted values are never added to audit payloads.

Account role, linked tutor profile, crew membership and translator assignment are separate capabilities. Protected requests reload current role, linkage and suspension state. Navigation and client controls do not replace server authorization. Student records require explicit account/profile ownership; a matching name or email never grants access.

| Procedure family                          | Intended callers                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `publicProcedure`                         | Public operations with their own input validation and feature gates          |
| `protectedProcedure`                      | Authenticated accounts with current authorization                            |
| `tutorProcedure` / `activeTutorProcedure` | Linked tutor access / active tutor duties                                    |
| `crewProcedure`                           | Permitted active crew or management access with the crew module enabled      |
| `adminProcedure`                          | Management; classified writes apply, enter review or are denied by live authority                     |
| `adminOnlyProcedure` / `headProcedure`    | ADMIN or HEAD / HEAD only                                                    |
| `viewerProcedure`                         | Management queries; explicit safe projections for Viewers and observers      |
| `translatorProcedure`                     | Explicit assigned translators; management rank does not grant editing access |
| `translationReviewerProcedure`            | Management reviewers or assigned translators reading their own drafts        |

Classified management mutations pass the central authority check before these resolver
gates. An eligible requester may therefore queue a proposal for a `headProcedure`
operation without gaining permission to execute its resolver directly.

Management observation uses the per-procedure [read models](../src/server/management-read-models.ts)
at the tRPC response boundary. Only listed scalar fields and recursively projected relations
reach Viewers and departure-based observers; unknown fields and unregistered reads fail closed.
Names, schedules, statuses, attendance ratings, school-grade summaries and totals remain visible.
Contact details, signatures, private narratives, application scores/evidence, raw academic text,
account/policy snapshots, invitation labels/codes and attendance submission fingerprints are
withheld. Published policies and announcements remain readable, consistent with the publication
workflow's explicit Viewer oversight (including announcements with selected tutor recipients).

Audit observations contain actor/time/category metadata and a fixed category label, never the
stored action text, details or undo payload. Observer audit search matches actor names, entity
and operation metadata before pagination; it never searches hidden narratives. This also covers
historical actions containing appeal/correction explanations. Staff responses and staff audit
search retain their existing behavior. Own-account and explicitly owned participant history
remain under their separate ownership guards. When adding management queries or relations,
update the read-model inventory and its RPC regression tests rather than adding blacklist keys.

Summary-table detail dialogs consume the same projected observer response as their
rows. Moving information into a lazy dialog must not fetch a richer staff record or
introduce an edit action. The management privacy component tests open attendance
and audit details in English and Chinese using the actual server projections,
including masked fields, and verify focus restoration after closing.

[Composable membership](../src/lib/account-membership.ts) keeps the exact management rank in `User.role`, tutor identity in `tutorId` with independent `tutorAccessRevoked`, crew lifecycle in `crewStatus`, explicit translation permission in `canTranslate`, and tutee membership in `tuteeMember`. `PolicyAcceptance` remains separate immutable evidence. Viewer exclusivity is validated by the complete membership schema and a database constraint. Legacy mixed Viewer accounts lose read-only management access and retain their explicit participant capabilities; migration never inserts policy acceptance. Outstanding pre-migration registration codes expire because they have no durable Head grant evidence; Head must issue fresh codes.

`admin.setMemberships` applies a complete badge set atomically with identity confirmation. `account.requestMemberships` only queues the caller's own proposal. `HEAD_APPROVAL_OPERATIONS` classifies alternate roster/crew/interview/registration grant paths, and approval replay checks the live Head role. Only Head may provision a new tutor login; sending an existing setup link is still available to management. Existing linked identities/history are preserved when participation is disabled. A tutor entering `/student` must personally accept the current tutee policy, which grants membership in the acceptance transaction; unrelated tutor features do not require tutee consent.

Management draft publication uses a server-only `translationPublicationScope` limited to the validated draft operation and live reviewer identity. It never sets `canTranslate` and cannot authorize subsequent direct edits. Coordinator translator authorization precedes proposal queuing.

The [user filter helpers](../src/lib/user-filters.ts) match composable membership badges. Tutor status applies only to an explicit Tutor-only role inclusion without a Tutor exclusion. Edits and saved-filter restoration normalize away inapplicable status; the matcher independently ignores it as a defensive boundary. Preferences are scoped to the signed-in account. The underlying `admin.accounts` query remains protected by `adminProcedure`; client filters do not provide authorization.

Account names synchronize only to explicitly linked current profiles. Shared profile writers lock the account before roster rows and reject stale versions. Signed agreements, submitted survey names and historical snapshots remain evidence of what was submitted.

Head-only [account combination](../src/server/combine-accounts.ts) requires a preview, identity acknowledgement and the Head's password. `User.mergedIntoId` retains the duplicate as historical identity while live authorization and database guards retire its credentials and reserve its identifiers. Ownership-aware reads include retained history without rewriting original actors. Departure history and incompatible account state block this generic workflow; see [identity retention and migration limits](deployment.md#combined-account-identity-retention) and the [operator procedure](user-guide.md#combine-duplicate-accounts-head-only).

The combine component intersects its server candidates with actual login IDs in
the displayed Users & Roles table. Existing filters and search remain authoritative
for this presentation, including default unverified/history visibility. It adds no
signup classification. Hidden selections invalidate the local review generation,
so a late preview response cannot restore private evidence or an old pair. Once
submitted, the captured pair keeps its pending/result owner; page filters are
disabled until settlement. Both zero-signup and signup-bearing logins retain the
same server conflict, survivor-readiness and retirement safeguards.

[Historical tutor linking](../src/server/tutor-history.ts) records a separate
`TutorProfileOwnership` read grant rather than replacing `User.tutorId`. Admin/Head
review an exact historical profile and verified account; correcting a retained owner
requires Head password confirmation. The fingerprint includes the ownership revision,
record version/counts and target profile snapshot. Namespace, account and Tutor row
locks serialize with signup, profile edits and account combination. Database guards
prevent current-login assignment to a competing retained owner; restrictive foreign
keys preserve owned identities. Audit evidence commits with ownership. Personal tutor
history reads the union of current and retained identities without granting tutor
membership or altering recorded credits. Combine transfers retained ownership and
includes it in its preview fingerprint. Academic corrections recognize retained owners.

The client cache is replaced when the server-supplied account or role identity changes. Route changes and tab focus/visibility share one live session check. Private content stays mounted but hidden while verification is pending, preserving form edits. A failed check or changed identity clears the cache and reloads the server layout. Once the same identity is verified, content is restored immediately; stale active queries refresh in the background without cancelling an existing request. Fresh queries are retained. Deterministic authentication, authorization and precondition errors are not retried; transient failures retain bounded retries.

The global participation-policy query uses this shared navigation/focus refresh. It fetches on initial enable and separately on query-only student tab changes; it does not install competing focus listeners. A verified return to the tab resets dismissal, while ordinary navigation preserves dismissal of the same published revision. Participation mutations always validate current policy acceptance on the server.

Client caches belong to the account, role and tutor link. Navigation and focus changes check the live identity before reusing data. The HTTP proxy removes rejected session cookies before page rendering; API authorization remains in force. Background responses must not restore a prior login after sign-out. Keep `AUTH_SECRET` stable and shared across production instances; diagnose failed sign-ins using [local troubleshooting](local-development.md#troubleshooting).

Browser tRPC links share [batch limits](../src/lib/trpc-batch.ts) so busy pages split simultaneous queries within the server's 20-operation limit. Keep new clients aligned with [signup ingress limits](signup-protection.md#defaults-and-tuning); repeated oversized batches cannot be repaired by retries.

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
Existing verified STUDENT accounts are assigned only through deliberate Head backfill or verified
re-enrollment, never by opening profile/list pages. VIEWER accounts keep their separate email-only
automatic-allocation policy; an explicitly assigned existing handle remains valid.

### Head username editing

In **Users & Roles → Edit profile**, Head can save a username for any login account, including their own. Use 1–64 ASCII letters or digits; surrounding whitespace is trimmed and letters are lowercased. Taken usernames in either the login or tutor roster are rejected. The linked tutor is updated atomically, so the old handle no longer signs in. Email sign-in, passwords, IDs, badges and history remain unchanged. Ordinary roster name edits retain the username. Admins may submit username changes for Head review; Coordinators cannot submit them. Saves record the actor and old/new handles and refresh the account list and current header. An unchanged save is a no-op; stale profile versions require explicit **Reload**. After a successful save, the section automatically reads its current username and profile version, then allows another explicit Save in the same dialog. Other sections retain their drafts and version snapshots.

Notification record navigation composes the existing bell and authorized request/
application cards. Validated record links opt out of Next's default scroll so it
cannot overwrite an intentional incoming fragment. Destination filters commit
before a mounted target is revealed and focused; delayed mounting waits on DOM
changes rather than a timer. The page's session scroll owner already skips incoming
fragments. After a successful reveal, or a user gesture, location change or access
loss, the record adapter relinquishes scroll ownership. This changes presentation
only: no query permissions, review state, editor drafts or mutation authority move
into the navigation helper.

Desktop record reveal writes only the existing scrollable `#admin-content` pane's
position from live target/pane rectangles; native clamping keeps the target in that
pane. An all-ancestor `scrollIntoView` would also center the outer document and can
move the header offscreen when descendant overflow gives it an incidental range.
The mobile branch retains document-native reveal. No global overflow clamp or
layout/position reset is part of this navigation correction.

## Approval transactions

Additional tutor qualifications use `qualificationApplication` and explicit `ADDITIONAL_SUBJECT` / `HIGHER_LEVEL` application types linked to an existing tutor and stable subject ID. Submission is self-only for active, non-revoked tutors; an open-request unique index plus transaction locks prevents duplicate pending/interview requests. Only Admin/Head may choose a panel or decide, and an interviewed request retains the existing votes/majority/chair checks. Initial-signup reconciliation is bypassed: no roles, membership, registration codes, willingness or existing grants change. Approval uses `approveQualification` in the decision transaction and copies its concrete grants into immutable request evidence; later catalogue reordering never recalculates this evidence. SQL guards preserve request identity and final decisions. Legacy status, delete and interview-decision entry points reject additional applications before proposal middleware.

Successful additional-qualification decisions invalidate the affected tutor's `tutorDetails.get` cache alongside the application, availability and roster queries. The detail cache is independent of `admin.tutors`; scoped invalidation ensures reopening the same tutor within the query freshness window shows the new approval without invalidating unrelated tutor details.

`QualificationReview` composes the shared `Button`, `Modal` and `InlineNotice` for pending additional-subject and higher-level direct review. The **Approve without Interview** entry only opens a named review dialog; the existing `qualificationApplication.decide` route still requires the final action and a nonblank note. Direct review offers approval only. The server rejects attempts to reject a request without an interview, regardless of interview feature availability; interview rejection still requires the assigned Admin/Head chair, every panel vote and the panel majority. Requests with a panel never expose this entry. The feature owns a note/version draft across cancel/reopen and background refresh, guards same-tick duplicate submissions, and blocks dismissal/fields during a write. Explicit Reload replaces the draft only after a successful fresh read. Successful decisions enter a locked state before cache refreshes. Every nested refresh group uses `settleRefreshes`, and `invalidateAndReport` waits for all matching query variants before reporting a new read failure. Failed synchronization can retry reads without resubmitting. The shared native dialog owns focus, Escape and pending propagation. Read-only management access, live role/link checks and all server decision invariants remain authoritative.

The tutor's qualification history derives status filters and counts from the self-only `qualificationApplication.mine` result. Pending includes interviews; approved, rejected and recalled requests have separate filters. Filter selection and collapse state stay local to the component and survive query refreshes. Collapsing history hides its controls and records while keeping submission, current approvals and recall feedback available.

Classify every management write in the [approval policy](../src/lib/approval-policy.ts). Unknown coordinator operations fail closed. An eligible request creates an immutable proposal; it has not applied the change. Coordinators submit daily operations to Admin/Head, while significant settings and staff account/profile/rank edits accept only Admin requests for Head review.

1. Capture validated input, affected records, active period and a fingerprint of review evidence.
2. Consume the requester's confirmation ticket when queuing a ticketed action.
3. Recheck requester/reviewer status, permit self-review only for the active Head and compare current evidence before approval.
4. Replay the original parser and resolver under reviewer privileges. Ticketed actions require the reviewer's own fresh confirmation.
5. Commit the domain change, proposal decision, related notifications and decision audit together. Competing reviewers cannot apply a proposal twice.
6. Send external email after commit. Delivery failure must remain retryable without undoing an applied assignment.

The [approval review presentation model](../src/lib/approval-review.ts) reads only the immutable input and submission evidence. Explicit operation titles and field/value vocabulary live under `approvals.review`; the [shared details component](../src/app/_components/approval-review-details.tsx) renders the same request in the card and consequence dialog. Direct-field comparisons require an exact target-table/ID or compound-key match. Attendance, patrol and pairing collections use their matching child snapshots. Missing evidence is distinct from an empty value; unchanged submitted values and supporting records remain inspectable. Known decisions are displayed as decisions rather than booleans, while user-authored text is preserved verbatim. New review vocabulary is authored in English and Chinese; the other six bundles currently use English for these new keys and retain their existing surrounding translations. Locale parity and ICU checks cover every bundle.

Adding an approval operation requires an authored review title and an explicit choice about whether its input represents direct field updates or action parameters. Do not infer resulting database state from a decision input, fill historical gaps with live queries, or change proposal fingerprints for presentation. Regression coverage is in [model tests](../src/lib/approval-review.test.ts), [details tests](../src/app/_components/approval-review-details.test.tsx), and [queue tests](../src/app/_components/management-actions.test.tsx), alongside the existing server approval and confirmation tests.

Use [database scope](../src/server/db-scope.ts) so helpers participate in the enclosing transaction. An independent client escapes rollback. Interview review revalidates panel membership, qualifications and votes while preserving the coordinator chair's result and authorship. Scheduling checks the current chair under the same lock as panel replacement. Interview history and completion live in Tutor Applications; legacy interview routes redirect there. Subject Availability has a separate staff route and management procedures, plus self-scoped tutor procedures, independent of interview enablement. `TutorSubjectWillingness` records explicit per-variant intent with no inferred migration backfill: an absent row means not recorded. Admin/Head apply staff willingness changes directly; Coordinators submit them for review. Active tutors can update only their own willingness. `availableSubjectIds` intersects explicit willingness with stored approved qualification grants and active subjects, excluding inactive or access-revoked tutors. Callers must still enforce timetable and capacity constraints. Changing willingness never edits approvals, grants or interview records.

Subject willingness UI: `subjectAvailability.mySubjects` loads on dialog open and scopes qualifications, saved grants and intent to the authenticated tutor. Only subjects backed by approved saved grants (direct or inherited) are returned; unqualified or pending-only subjects are hidden without deleting their historical intent. Staff retains the complete catalogue. The tutor editor uses two mutually exclusive pressed-state buttons; absent intent selects neither, and clicking a confirmed choice does not clear it. Aligned subject rows use paired controls with a checkmark as well as theme colour for selection. The dialog opts into a wider layout; existing profile dialogs keep their default width. On narrow screens, choices stack below each subject and retain equal touch-target heights. Save feedback occupies a stable footer slot. `setMine` retains fresh authorization and cannot accept another tutor ID. Confirmed values are refreshed after immediate saves, including staff/detail caches; failed saves do not present optimistic success. The editor registers only its own mutation with `useDialogPending` before query-state returns, keeping dismissal and controls locked until the write and successful refresh work settle. A same-tick submission guard prevents duplicate writes; failure retains the search and confirmed per-subject choices for retry, and inherited dialog work does not latch the editor's busy state. Management card filters use one nullable selection per tutor and mount only inside expanded cards. Pending Review includes open qualification applications without converting them to grants.

Audit events identify actors by stable account ID and current role. The default signed-in mutation boundary commits domain writes and safe before/after evidence atomically; workflows that own their transactions retain their isolation/retry contracts and write evidence inside those boundaries. Failure/denial receipts are independent of rolled-back changes. The audit records actions rather than page access. Review metadata and undo payloads are not exposed to VIEWER accounts.

`admin.auditLogDetail` is an on-demand, live-staff-authorized projection of one
stored event. It selects recorded metadata, evidence and undo status/time, excluding
executable `undoData`; it never joins current actors or targets to reconstruct
history. The audit page mounts `AuditEventDetails` inside `TableDetails longReader`
only for staff, refreshing on each opening. Full evidence can extend beyond the
viewport; the shared reader keeps its Close header reachable while scrolling the
recorded comparison or expanded stored JSON. Close and Escape restore the selected
row's opener without altering evidence or invoking Undo. Observers keep the compact,
existing projected summary
and cannot call the detail endpoint. The feature renders stored before/after and
nested evidence with exact field names, an explicit no-evidence state, precise
local/UTC times and read-only retry. It changes neither writer coverage nor old
records, approval/undo rules, filtering or pagination. Endpoint, component and
page regressions cover this boundary; browser evidence belongs in ignored `outputs/`.
Authorization denial removes that event's private query cache and stays latched
through failed retries until a fresh successful read. Reopening cannot revive
revoked evidence. The lazy JSON disclosure preserves primitive types and escaping;
real QueryClient regressions cover the denial/retry/reopen sequence.

## Student lifecycle and ownership

Public intake invalidity is separate from lifecycle state. Staff may flag initial
tutor applications and student signup requests with a bounded reason, recorded
actor and timestamp. Clearing requires a reason too; audit evidence retains the
change even though current invalidity metadata is cleared. A dedicated revision
fences concurrent flag/clear writes and stale approval replay. Ordinary daily-work
approval rules apply: Admin/Head apply and Coordinators propose. The flag does not
rewrite submission priority, consent, verification, grants or participation.
Processing guards must run on the server, including assignment and interview
aliases. Review reasons and actor details are omitted from participant request APIs
and masked management views. Essential request-email notices may include the
participant-facing reason only after request-specific mailbox proof; see
[notice and appeal boundaries](#public-request-invalidity-notices-and-appeals).
See [issue #294](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/294).

`TutorApplication` and `StudentSurvey` store their review fields directly. Older
public tutees without a survey use `TuteeRequestInvalidity`, keyed by `tuteeId`,
so ordinary roster serialization cannot reveal the internal explanation. This
legacy path accepts only explicit `SELF_SERVICE` provenance. Staff-entered and
unknown-source records are not reclassified as public requests. Shared processing
locks serialize flagging with assignments and invitation redemption; existing
memberships and completed invitation receipts remain intact. Participant reads
receive no internal explanation, and authorized observer summaries receive only
the invalid badge. Current flags also leave actionable activity counts. Tutee owners
receive a notification and a separate reasoned appeal entry point until active-period
rollover. The request remains invalid and processing-blocked during appeal review.
Admin/Head acceptance clears the flag without changing priority; final rejection
closes the active request and ends its priority while retaining source and decision
evidence. A later eligible submission gets fresh priority. No deadline is inferred
from public signup closing, and an appeal cannot extend an existing verification deadline.

`student-signup-appeals.ts` records `StudentSignupAppeal` against the exact invalidity
version and uses `StudentSignupNotice` as the committed delivery outbox. Notices
resolve retained ownership and a current verified recipient rather than treating
the immutable submitted email as today's owner. The mailbox appeal capability is
bound to that recipient/account generation and invalidity version; its link does
not reveal internal screening reasons. `studentWorkflow.inspectSignupAppeal` and
`appealSignup` serve that exact emailed capability, while `appealOwnedSignup`
requires signed-in ownership. `resolveSignupAppeal` rechecks Admin/Head authority,
the current flag version and a purpose-bound consequence ticket. Acceptance and
final `INVALID_REJECTED` closure commit with decision/audit evidence and notification
enqueueing; SMTP delivery happens after commit. Failed notice delivery is separate
from an accepted flag/decision, so resending a notice does not repeat the write.

Invalidity reviews belong to a stable host above the request cards. Filtering,
polling and movement between assignment groups cannot unmount an open draft or
its captured revision. Closed drafts remain attached to their request identity.
After a committed write, partial refresh failure leaves a named recovery section
outside the list; its retry only reads and never repeats the write. Read-only
access removes private reviews and their evidence from the rendered page.

The original survey submission determines queue priority. Mailbox-code verification or explicit legacy-link confirmation issues the receipt shown in the popup; final shared invitation review creates or links the account and confirms the original request. Existing credentials and unrelated access remain, while an exclusive Viewer transitions to tutee participation. Account links expire after 24 hours. First assignment of an unverified request starts a fixed seven-day deadline; neither resends nor reassignment extends it.

| Action                          | Invariant                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Submit fresh eligible demand | Reserve priority at acceptance, before account setup; preserve the original payload and signed policy evidence |
| Stage same-email tutee replacement | Store an independent intent/challenge; leave the live request, priority and original proof untouched |
| Complete a deliberately new intent | Require exact mailbox proof and existing account authentication/MFA; replace current answers and append that intent's consent revision, even for identical answers |
| Recover an exact network retry | Return only its bound acknowledgement or saved result; no duplicate version, CAPTCHA consumption, email or notification |
| Verify mailbox code or confirm the email link | Issue an invitation after explicit proof; opening a link alone does not confirm participation |
| Resend a link                   | Failed delivery preserves the usable link; successful delivery replaces it                  |
| Edit an owned OPEN signup       | Recheck active period, ownership, field/catalog rules and version; allow edits after intake closes; preserve assigned subjects, original evidence and canonical identity |
| Head edits assigned choices     | Review and release affected assignments with the answer change; preserve sessions and attendance |
| Read terminal or historical signup | Keep original answers and accepted revisions read only |
| Recall an unassigned request    | Close it permanently; a later application receives a new request and priority               |
| Approve withdrawal              | Release all assignments and block another signup for that account/email in the period       |
| Approve a schedule rejection    | Remove only the affected pairing and return the request for matching                        |
| Expire an unverified assignment | Permanently disqualify it and release assignments; a fresh eligible application is separate |

`StudentProfileOwnership` retains explicit links across intakes and verified email changes. Attendance, feedback and appeals use all owned profiles. Staff-entered enrollment withdrawal also requires explicit ownership and current-term evidence; it never relies on a matching email. Signup-source labels describe recorded provenance and do not change permissions or priority.

`student-signup-intents.ts` stages `StudentSignupIntent` records separately from
`StudentSurvey`. The client retry key is hashed and bound to the exact parsed
submission and, for signed-in submissions, its submitting account. Public
`tutee.submitSurvey`/`requestSignup` and `signupReceipt` recover accepted exact
intents through completion admission before fresh CAPTCHA/mail admission. The
public submission APIs require an explicit client key for independent intent/retry
behavior; missing keys fail input validation rather than entering an older
duplicate-submission path. Existing survey-token completion remains supported.
A receipt grants no
mailbox proof or private record access. Resend rotates only the staged challenge
after successful delivery and retains its capped expiry.

A per-key pre-stage admission lease covers the gap before the intent exists. Receipt
recovery reports a retryable wait while that lease is live, rather than a definitive
missing result that could prompt another deliberate submission. After acceptance,
its exact acknowledgement is recoverable before fresh CAPTCHA and mail admission.

`accountInvitation.verifySurvey` with an intent ID verifies the exact source mailbox
challenge before issuing the shared `tutee-intent` envelope. Source version, owner,
verified-alias status, credential generation, active period and eligibility are
rechecked under the existing program, username, catalogue, account and request
locks at redemption. Concurrent independent intents share the request's expected
version: only the first valid completion can apply; another stale review must
reload/resubmit rather than overwrite it. Suspension, school departure and
quarter blocks remain authoritative. A source token's ordinary expiry can be
superseded only by its fresh verified intent proof, never beyond the request's
fixed `verificationDueAt`.

`student-signup-editor.ts` exposes complete normalized local-answer snapshots for
owned current OPEN requests. `studentWorkflow.signup`/`editSignup` omit email,
login identity and original consent from the editable schema. It keeps inactive
assigned catalogue choices in the accepted projection and fails closed when a
legacy assignment cannot be resolved for a subject change. Hidden field settings
cannot erase an assigned subject. Changes to names, grade, phone, contact,
availability and unassigned choices remain request-local; they do not rewrite
canonical User identity or academics. A stable expected version and exact retry
key distinguish conflicts from already accepted writes. Drafts survive rejection
and background failure; successful-write synchronization recovery performs reads.

Management reads use `studentWorkflow.managedSignup`. `headEditSignup` and
`headUnassign` independently require current Head authority and a purpose-bound
consequence ticket; the broad management procedure wrapper does not grant Admin or
Coordinator the Head write. Dropped assigned choices and their affected current
`PairingTutee` links change in one transaction. Historical `Session` and
`SessionTutee` rows survive; releasing an assignment is separate from deleting
recorded attendance.

`StudentSurvey.payload`, its original policy snapshot/revision, signature and
`submittedAt` remain source evidence. `currentPayload`/`currentVersion` supply the
current answer projection, while append-only `StudentSignupRevision` records each
accepted answer snapshot and its actor/version. Ordinary signed-in edits do not
invent fresh consent. A deliberately new public intent records its stage-time
signature, policy snapshot/revision and acceptance timestamp. Publication after
staging does not fabricate a newer acceptance: existing current-policy participation
gates require that revision separately. SQL migration
`20261014010000_student_signup_revisions` protects immutable source/revision fields
and binds operational retry receipts to these transactions.

[Historical linking and invitations](historical-participant-transition.md) add retained ownership after staff review or an explicit claim by the invited verified account. They preserve original enrollment academics, current membership and recorded attendance. Accountless tutees remain roster records; personal `/history` reads require ownership, while general observer access never grants private history. See the guide's [technical map](historical-participant-transition.md#technical-map) for endpoints and shared cache invalidation.

History-only account setup reuses the exact-record invitation and shared email-claim registry. A separate HMAC email code and purpose-bound completion proof open the shared receipt popup, whose optional email and prefilled link hand off to credential review at `/register`; invitation expiry/cancellation, record freshness and issuer authority are checked inside the identity transaction at every step. A neutral STUDENT rank with no participation links/memberships does not grant observer or current tutoring access. The receipt supports a lost-response retry without overwriting credentials. The explicit signed-in claim still establishes ownership separately. Personal tutor history reads current and retained tutor ownership across the account-combination family, without invoking participation, profile synchronization or hour recalculation.

Deadline timestamps live in PostgreSQL. The Node worker checks at startup and every minute; workflow entry points also enforce expiry. Database locks serialize transitions across instances, and downtime never extends a deadline. Keep the SQL constraints and triggers in the migration chain; `db push` alone does not reproduce them.

### Membership changes

Tutor and crew requests lock the member, recheck current membership and change only a pending request. Membership, notification and audit changes commit together, including through coordinator review. A stale request cannot override a later manual status change. Opt-out approval requires a seven-day wait; reentry requires approval without that wait. Opting out does not automatically perform the staff student-requeue action.

These requests differ from non-survey tutee opt-outs relayed by a tutor: [removal processing](../src/server/discipline/removal.ts) finalizes those after their seven-day recall window when a workflow enforces due requests. Survey/account-linked whole-period withdrawals instead require staff review and impose the period signup block. Do not merge these lifecycle rules.

Application locks protect supported API writes. Do not import directly into request tables assuming a unique pending-request index exists. Validate membership and pending-request invariants when designing import tooling, and preserve decision history.

### Assigned-block workload and advisory preference

[The workload reader](../src/server/tutor-workload.ts) uses one Repeatable Read
snapshot for the active quarter, tutor eligibility, preference and assignment
identities. Only pairings with at least one non-INACTIVE tutee count; PENDING
tutees already assigned reserve effort. Empty/inactive-only rosters, inactive or
revoked tutors and ended quarters contribute no blocks. Confirmed rows share the
`termId/dayOfWeek/startMin/endMin` identity, independent of subjects, roster size,
room and catalog-slot IDs; unconfirmed rows use their pairing ID so placeholder
times never merge. Attendance history is not queried. Inactive slots retain the
copied confirmed schedule's workload. The count estimates effort if assignments
work out; it is neither an attendance total nor a weekly/program cap.

`admin.assignmentWorkloads` is staff-only assignment context. Native options use
`(count/preference)` or `(count)` when unset, and `(?)` when unavailable or refreshing.
Workload confirmation shares `AssignmentConfirmation` with qualification review;
qualified assignments wait for a fresh advisory read before automatically proceeding
or showing Continue/Cancel above the preference. Failed advisory reads keep existing
assignment permissions. The independent preference editor lives in My Availability.
A prepared assignment admits one automatic or manual write attempt. If that write
fails, a later advisory refetch (including a cleared workload warning) cannot
silently submit it again. Explicit Review again prepares a fresh attempt; the
parent draft remains mounted, and the returned write promise owns nested-dialog
pending protection until it settles.
A separate default-only migration sets new tutors to 1 without backfilling unset
values; the existing inactive trigger still wins with zero. All native tutor
selectors and Pairings summaries consume the same count. Proposed edits remove
only the original pairing's membership, retain shared siblings and add the new
distinct identity only for a current roster. Projections use the same current-quarter
and authoritative tutor eligibility
decision as saved counts, including retained inactive or revoked assignments.
Cached reads remain visibly stale during refresh/failure; unavailable reads never
become zero. Mutations invalidate
this context alongside current pairings and rosters. Advisory read recovery creates
no new assignment permission or approval requirement.

Pairing-group saves include workload invalidation in their awaited read refresh,
including the accepted-save Retry path. This updates a mounted My Availability
count after combine/split while its independent preference draft/version remains
owned by the tutor. Group IDs do not replace the confirmed-time workload identity.
Assignment confirmation composes the shared Modal/NativeDialog pending, Escape and
focus behavior while retaining its qualification ticket and countdown lifecycle.
When a child write removes or disables its opener, focus returns to the still-open
parent dialog.

The tutor-only `workloadPreference`/`setWorkloadPreference` procedures scope to the
live account link. The strict server input accepts null or an integer 0–4 and a
required independent version. Save rechecks ownership/participation after the
account lock, then locks Tutor and conditionally updates the preference/version.
It deliberately preserves Tutor.updatedAt and User.profileVersion; explicit safe
audit evidence commits in the same transaction. Proposal Tutor snapshots exclude
these two advisory columns unconditionally, retaining pre-migration evidence
shape and allowing queued assignments to survive a preference change. Existing
qualification tickets, consent, review and assignment invariants remain authoritative.

The [migration](../prisma/migrations/20261014010000_tutor_workload_preference/migration.sql)
adds range/version checks and resets existing inactive tutors to zero. Its trigger
covers every lifecycle and import path, resetting to zero and advancing the
independent version on inactive transitions. Reactivation retains zero. This
invalidates old active drafts without restoring a former preference. The independent
editor retains failed/dirty drafts, adopts new versions only through its successful
save/read or explicit Reload, and distinguishes accepted-write synchronization
failure from rejected-save recovery. Lowering a preference never changes pairings.

### Assignment qualification confirmations

`src/server/assignment-qualification.ts` checks stored grants from approved qualification sources under the catalogue lock. Assignment entry points and coordinator proposal creation share this guard. An unqualified assignment requires a one-use `StudentActionConfirmation` with action `ASSIGNMENT_OVERRIDE`, a two-second server deadline, and a hash of the operation and complete parsed assignment payload. The actor, course, tutor, request version, roster and schedule are bound; confirmation tokens themselves are excluded. New warning preparation invalidates older unused override tickets, cancellation deletes the current unused ticket, and approval replay requires the reviewer's fresh evidence. Existing student consequence confirmation remains a separate requirement. Active unlinked roster tutors remain eligible for assignment; a linked account with explicitly revoked tutoring membership is excluded and assignment never restores account access. No additional schema is needed beyond the course grant migration.

## Scheduling, hours and discipline

### Automatic room allocation contract

The requester approved these mechanisms for [issue #389](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/389) on 16 October 2026 (Asia/Shanghai), before implementation. The integration decision confirmed on 16 October 2026 amends the earlier per-entry wording: an explicitly combined `PairingGroup` shares one room reservation, using its primary assignment’s room and schedule; independent Pairing entries remain separate reservations. Matching times, shared students and one-off attendance merging never imply a group. Group allocation deduplicates stable participants and counts one occupied interval, while preserving fixed/no-physical-room intent and the existing group snapshot/version authority. Room status, utilization and shortage feedback describe that shared reservation rather than treating its members as competing bookings. A confirmed schedule may save without an available automatic room, but must visibly report **Needs room**. Awaiting schedule, intentional no physical room, shortage, and failed reads remain distinct states.

Staff-selected rooms are fixed and automation cannot displace them. A conflicting schedule change is rejected with an actionable error. Authorized staff may explicitly release a fixed room to automatic allocation; an intentional no-physical-room choice remains sticky. Existing assigned records migrate conservatively to fixed allocations. Deployment, unchanged feature settings, new rooms and removed blackouts do not backfill or rebalance bookings; staff explicitly retry shortages.

Allocation runs inside the scheduling transaction under the shared planned-room lock. It uses the authoritative program period and confirmed copied interval, including schedules whose catalog link was cleared. An eligible existing automatic room is retained. Otherwise, eligible rooms rank by the number of familiar participants, then tutor familiarity, then fewer planned weekly occupied minutes, then stable room ID. Familiarity comes from confirmed planned bookings in the current program period. Canonical verified identity links join retained profiles to their stable participant identities; names and email matches are never identity evidence. The tutor counts once and each distinct tutee counts once per candidate, regardless of repeated bookings or duplicate roster evidence. Continuity outranks usage balancing.

Only the changed independent pairing, its explicit shared group, or the cohort affected by one catalog edit may be reassigned. Catalog propagation validates the complete prospective schedule and commits atomically, preserving unrelated bookings and actual attendance evidence. Fixed reservations, recurring blackouts, period boundaries, strict interval overlap and adjacency remain hard constraints. Clearing only a catalog link retains a confirmed reservation; actual unscheduling and record removal have their own lifecycle behavior.

Room deletion takes the planned-room lock and locks the target Room row before checking planned and actual references. PostgreSQL's foreign-key key-share locks serialize concurrent attendance submissions and corrections with that check, so a newly committed actual room cannot be silently cleared by deletion. Existing foreign keys remain unchanged.

Coordinator review approves automatic-allocation intent; the room is chosen from current eligible data atomically when approval applies. A queued proposal is not a reservation. Entering a shortage, or a material shortage change, creates in-app notifications for Head and Admin after committed state; unchanged saves and retries do not repeat notices. Accepted writes followed by read failure expose read-only refresh recovery without replaying allocation.

The browser's creation draft carries a UUID through edits and failed requests until an explicit new draft/reset. A committed creation stores a requester-scoped receipt: the same semantic payload returns its existing pairing without repeating allocation or shortage notices. A changed committed payload or a retry after deletion conflicts rather than creating another record. Approval replay retains the original requester's identity when matching this receipt. Receipt rows retain deletion tombstones independently of Pairing foreign keys. Older clients and proposals without a key remain compatible but do not gain response-loss replay protection. Existing pairing edits use room-version snapshots; roster changes also invalidate them.

**Auto-assign rooms** defaults ON immediately when no setting exists. OFF and later re-enablement are staged until program refresh, and a pending change can be cancelled. Disabling automation retains existing reservations, manual scheduling, conflict validation and schedule readers. Feature changes never implicitly reassign existing pairings. Implementation and verification status are recorded separately from this approved contract.

The tutor dashboard's task summary reuses the same tRPC query keys as its feature
sections, including explicit unknown/error states. It uses the program-zone date
and only confirmed weekly pairing times; this is a regular timetable, not a
holiday or attendance-completion inference. Active membership controls attendance
and pairing writes; pending/inactive membership keeps read-only records and
unresolved requirements. Hash shortcuts focus their section for keyboard users.
Attendance freezes its submitted fields and distinguishes a saved entry from a
failed totals refresh. Pending qualification records stay outside history filters;
completed interview evidence and optional editor disclosures retain mounted drafts.
The [contributor action inventory](contributing.md#consequential-action-inventory)
documents draft, reversible and confirmed action boundaries.

`Pairing.scheduleConfirmed` separates assigned tutors from agreed schedules. New request assignments default false; catalog-slot creation or selection sets true. Clearing a slot link retains the flag and copied times. Lists expose the awaiting state, dashboard counts exclude it, and attendance requires explicit actual start/end values whenever any selected pairing is unconfirmed. Recording actual attendance never confirms the recurring schedule. The [scheduling migration](../prisma/migrations/20260922200100_pairing_scheduling/migration.sql) conservatively marks preexisting rows true because copied-time provenance is unknown; new rows default false. No historical schedule or session time is inferred or rewritten.

Confirmed planned room bookings cannot overlap within a program period or conflict with a recurring blackout. Unconfirmed numeric placeholders do not reserve rooms, and changing only the confirmation flag still invokes the database room guard. Adjacent bookings are allowed. Shared transaction locks keep application validation coherent; database triggers enforce the final constraint. Actual historical attendance can differ from a plan and is recorded with conflict warnings and management notification.

Room block create/edit/remove operations use `adminProcedure` and the approval allowlist: Admin/Head apply writes, while Coordinators submit proposals. The shared [room block schemas](../src/lib/room-blocks.ts) validate day, minute bounds, reason length and increasing times before a request enters review. [Room validation](../src/server/room-bookings.ts) serializes block edits and removals with planned booking writes, excludes the edited block from overlap checks, and rejects conflicts with other blocks or active-term pairings. [Proposal preflight](../src/server/room-block-proposals.ts) validates current feasibility without reserving a time; approval checks target evidence and reruns the mutation inside the review transaction. Rejected or failed approvals do not change availability. The room-block migration extends the existing database trigger to enforce valid ranges and disjoint blocks on inserts/updates without rewriting historical rows.

Room-block review summaries use immutable payload/target evidence, not current room lookups. New proposals capture `roomBlockContext` for readable room identity. Review recomputes this context only when it was originally recorded, preserving the fingerprint shape of legacy requests. Missing legacy details are explicitly unavailable; raw proposal values remain in the evidence disclosure.

Attendance and crew patrol treat room IDs as opaque nonempty strings, including legacy/imported keys; a CUID generation default is not a restriction on stored IDs. The shared [room-reference check](../src/server/room-references.ts) verifies effective physical rooms inside the write transaction and holds key-share row locks through commit. Unknown/deleted rooms return a room-specific error before attendance, observations or credits are written. Online attendance needs no room, while omitted/null physical-room overrides retain the pairing default. Accepted submission retries return their existing receipt before this check, preserving replay after catalogue changes. No ID migration or frontend change is required.

The [hour calculator](../src/lib/service-hours.ts) owns session rounding; use the [policy examples](../prisma/policies/tutor-policy.en.md#iii-service-hours-accrual) rather than ordinary nearest-half-hour rounding. Completed interviews credit actual duration. Meeting deductions use the semester allowance in [meeting-hours.ts](../src/server/meeting-hours.ts); corrections recompute system credits while preserving manual adjustments.

[Disciplinary standing](../src/lib/discipline.ts) counts valid cards: three yellows contribute one effective red. With discipline enabled, an unexcused tutee absence produces a valid red; tutor-requested cards await review. At two effective reds, [removal synchronization](../src/server/discipline/removal.ts) immediately inactivates an active tutee and detaches current-term pairings without another approval. Pending appeals do not invalidate cards. Appeals close at the end of the fifth subsequent school day using the program timezone and calendar overrides. Invalidating a card recalculates standing; restoration requires the removal's status snapshot to remain current and eligible pairings to remain valid.

[Catalog-slot attendance propagation](../src/server/attendance-schedule.ts) holds an exclusive transaction advisory barrier before discovering affected history. Attendance and patrol submissions/corrections acquire shared access before their other locks, so normal independent writes can still proceed concurrently. Clock changes move each complete merged block atomically, retain its slot identities and single-credit factors, reject final tutor/date overlaps, reconcile flags and linked deductions, and preserve prior evidence in the audit log. Slot, pairing, session, hours, flags, audit and HEAD notification updates share one transaction. Weekday-only edits preserve actual history. Submissions that read stale catalog defaults must reload; this application coordination does not claim to prevent arbitrary direct SQL attendance writes.

Reusable tutor pairing groups are implemented by [pairing-groups](../src/server/pairing-groups.ts) and the self-scoped [router](../src/server/api/routers/pairing-groups.ts). `PairingGroup` owns a tutor, period and preferred primary assignment; nullable `Pairing.groupId` retains each original subject and roster. The additive migration backfills no group and never changes Session evidence. A complete group draft carries a SHA-256 fingerprint of current assignments, memberships, active-student roster identity, room labels, schedules and active catalog slots. Saving holds the program-period, tutor and planned-room locks, row-locks the tutor's current assignments, revalidates the snapshot and all memberships, then atomically replaces the requested groups and copied schedules. Only active tutors with participation access can write their own current populated assignments; each assignment belongs to at most one group, with two to six members. No subject-name/shared-student rule is inferred.

Every group uses its primary member's room and one active catalog slot. Affected bookings are temporarily unconfirmed inside the transaction before complete room validation and final member writes; any failure rolls everything back. Members leaving a group become unscheduled without deleting assignments or changing actual attendance. A database owner guard clears membership on reassignment and independent schedule/room edits, while retaining catalog propagation through the same slot. The room trigger allows same-tutor/same-period group members to share a booking and continues rejecting unrelated bookings and blackouts. Existing self-service slot changes expand to all members, and catalog preflight recognizes one grouped room booking. Read projections only combine members with a coherent schedule/room tuple, falling back to independent assignments if an old primary disappears or a group becomes a singleton. Group tables are included before Pairing in historical export/import dependency order.

The [group editor](../src/app/(tutor)/_components/pairing-group-editor.tsx) composes ProfileDialog, FormSection, ChangeReview and QueryFeedback. Its draft/version survives failed writes and background reads; explicit Reload replaces it only after a successful read. Same-tick admission and owned dialog pending state block duplicate writes and dismissal. The retained editor must also honor current participation eligibility after opening: loss of active status blocks new Review/Save admission without discarding the draft. This write guard must not block read-only synchronization Retry for a save already accepted. Accepted saves retain their receipt through read-only synchronization recovery. Attendance group selection copies a distinct-student snapshot into its separate draft; changing saved groups does not rewrite a pending/saved attendance form. One-off combined attendance and individual-subject attendance remain available. English/Chinese copy is authored; the other six catalogs use English for these new group strings pending translation.

[Patrol credit](../src/server/crew/patrol-credit.ts) uses a rolling server-time cooldown of 20 minutes per crew member, across explicitly combined identities. `Patrol.creditAwardedAt` is set only when the server awards 0.5 hours; clients cannot choose it. All observations must be within the preceding 20 minutes (plus the existing one-minute future clock allowance) for automatic credit. Historical and cooldown submissions remain evidence with zero hours. UTC epoch-aligned 20-minute evidence windows (`:00`, `:20`, `:40`) are immutable `PatrolCreditWindow` claims, independent of notes, headcounts, room order or request UUID. A sweep can earn only 0.5 hours and must find all its evidence windows unclaimed; it then reserves all of them. The rolling cooldown prevents adjacent fixed-window boundaries from granting rapid extra awards, including omitted client timestamps. This limits credit; self-reported observations alone cannot prove a physical visit.

Submissions and corrections hold the attendance barrier, then sorted account-profile advisory locks shared with account combination. Ownership is re-read after locking; combined history is queried before an award. Credit time, interval claims, patrol, observations and flag reconciliation commit together. The unique `(crewUserId, windowStart)` key rejects concurrent duplicate claims. Corrections never recalculate hours or release original claims, and credited patrols also reserve newly corrected windows (existing historical overlaps retain their owner). Preserved legacy overlaps are not a promise that past data met today's ceiling. See [migration handling](deployment.md#patrol-credit-migration). Service-hour summaries sum stored hours; patrol counts include evidence-only records. English and Chinese patrol help explain the allowance; other bundled languages use English for the revised help until reviewed translations are available.

The patrol page announces credited and evidence-only outcomes as status messages and submission errors as alerts. Headcounts and notes are disabled during submission, with synchronous handler guards preventing edits or duplicate submits before React rerenders and through the success refresh. A failed request retains an immutable submitted payload and key: an unchanged retry sends the same observations and timestamps, while changing an observation or the trimmed note produces a new key on the next submission. This also handles a saved request whose response was lost; changed intents remain subject to the server credit budget. The patrol shell reuses `WorkspaceHeader` and the [shared header conventions](../AGENTS.md#mobile-header-hierarchy); room headcount buttons also retain at least 44 px touch targets below `lg`.

Attendance and patrol corrections preserve reasons and snapshots, reconcile dependent hours and discipline, and notify HEAD. [Crew flag reconciliation](../src/server/crew/flags.ts) compares exact observations with distinct attendance in shared blocks; `4+` cannot prove an undercount. Flags require a management decision before a penalty. Corrected evidence may reopen review and remove a linked penalty; manual adjustments remain separate.

Program timezone conversion distinguishes instants, calendar dates and weekly wall-clock slots. Use the shared helpers rather than browser-local conversions. [Configuration effects](program-reference.md#program-time-zone) explain what changes when the school timezone changes.

Database instant fields currently use PostgreSQL `TIMESTAMP(3)` without time zone, with Prisma reading and writing UTC values. The shared [connection policy](../src/server/database-url.ts) forces `timezone=UTC` through connection startup options for the application pool, Prisma CLI, seed, demo verification and administrator bootstrap. This keeps database defaults, trigger writes and expiry comparisons consistent even when the database or role defaults to another zone. Existing connection options are preserved, with UTC taking precedence. No rows or column types are migrated; calendar-only dates and weekly clock values retain their existing representation.

Docker builds omit database credentials and set `SKIP_ENV_VALIDATION=1`. Importing the database module during Next page-data collection must therefore allow an absent URL without parsing it or opening a connection. Production runtime validation still requires a valid URL; every configured application connection receives the UTC policy. `db-build.test.ts` covers this build/runtime boundary.

Changing the program timezone writes only the singleton setting and audit entry, then refreshes the editor's page. It does not scan or rewrite historical timestamps or recalculate service hours. Derived appeal deadlines for existing cards and crew-observation matching when reconciliation reruns use the current program zone. UTC connection enforcement does not freeze those school-calendar rules. A future `timestamptz` migration needs a separate field/data audit: true instants can be converted explicitly from UTC, while calendar dates and weekly slots must retain their distinct meaning.

[Timezone labels](../src/lib/program-time-zone-label.ts) are display-only and require an explicit instant. Intl resolves localized names, seasonal abbreviations and GMT offsets using that instant; retain the IANA region as the persisted value. Local-input labels reuse strict program-time conversion and omit the offset when an input has no unique instant. Selector previews use one shared noon-UTC reference date and memoize option labels. No timestamp, recurring slot, permission or schema changes accompany display formatting.

## Communication

[Messaging permissions](../src/server/messaging-permissions.ts) use explicit ownership and recorded assignment evidence. Role contact groups form a union; a user override replaces that union. The same checks govern search, sends and replies. Permission or assignment writes cannot race send validation and commit.

A send validates the entire recipient batch and atomically writes separate deliveries, a retry receipt and notifications. A sender lock serializes retries and quotas; reusing a client key with different recipients, text or disclosure fails. Notifications omit private message bodies and recipient lists. No external I/O belongs inside the transaction.

Supervision requires the message's recorded disclosure. Head/Admin may inspect and hide disclosed messages with audit evidence. Restoring visibility or lifting a contact restriction requires Head application, directly or through an Admin proposal. Participant-only messages remain excluded from all supervision queries. Hiding retains the original content for authorized review. Contact restrictions block new sending and incoming eligibility without erasing readable history. See [contact configuration](program-reference.md#message-permissions-and-supervision).

Announcements freeze tutor IDs at publication, or at approval for a coordinator proposal. Editing or restoring a post does not recompute its recipients. Empty restricted audiences never become broadcasts. Preview, publication, reads and acknowledgements must share recipient-selection rules; notifications and publication commit together.

### Account emails and delivery

[Account email services](../src/server/auth/account-emails.ts) use the account-profile lock to serialize a person's changes. `AccountEmail` is the globally unique namespace for primary and verified secondary addresses; triggers reserve primary addresses for every account creation/update path. Inputs are trimmed and lowercased. Pending secondary requests live only in `EmailVerificationCode`, so failed, expired or abandoned requests cannot block another person. The settings list combines owned addresses with account-local pending challenges and applies the five-secondary limit to that union. Cancellation remains available for expired requests; resend is available when secondary binding is enabled; failed SMTP delivery retires only that request's challenge.

Secondary-email requests and confirmations first acquire the `secondary-email-binding-setting` transaction lock, shared with the Head-applied availability mutation (Admin submits changes for Head review), and reject when `ProgramSettings.secondaryEmailBindingEnabled` is false. This independent flag defaults true for compatibility. Existing addresses, pending state, primary-email changes and authentication remain intact. Verification rechecks availability and claims the address atomically. An address lock serializes competing confirmations; the unique registry key also arbitrates races with primary-account writers. Verified aliases resolve the same account. Recovery grants bind to their exact destination and recheck ownership on redemption; address removal and password rotation revoke grants. Never infer participant ownership from an alias or change the account's ID/history when promoting it.

Database triggers enqueue `EmailDelivery` in the event transaction for account changes and in-app notifications. The [delivery worker](../src/server/email/notification-delivery.ts) rechecks program enablement and category preference for optional messages/information, and current recipient ownership for account mail. Security enqueue and dispatch bypass optional gates, including legacy `emailSecurity=false` values. That stored field is preserved but is no longer an editable preference. Disabling program notifications skips only optional pending rows; security and essential request-service notices remain eligible. Previous-primary security notices have the documented ownership exception. Account notices contain fixed event descriptions, not profile values, secrets or message bodies. See [operations and retry limits](deployment.md#optional-notification-delivery).

`Notification.event` and its allowlisted `context` identify the committed action;
the trigger copies only that safe context into account email receipts, never arbitrary
titles or bodies. [The shared formatter](../src/lib/notification-events.ts) drives
localized in-app copy and bilingual English/Chinese email because recipient language
is not persisted. Old in-app rows retain their original readable title/body; unknown
email events use the generic program-update description. Count context is limited to
discipline-card requests and changed historical teaching blocks. Scheduled interviews
carry a validated ISO instant and IANA timezone. Recurring assignment updates carry
no invented date; there is no dated tutoring-session notification emitter. The
[event inventory](notification-events.md) maps every supported event to its actual
emitter, audience, maintained copy and destination, including email-only account events.

Every [email sender](../src/server/email/sender.ts) call declares SECURITY or PROGRAM purpose; configuration selects a complete sender account per purpose. Student signup confirmation uses PROGRAM, while viewer verification and history invitations use SECURITY. The notification outbox retains the event's internal destination; shared link validation and sign-in callbacks preserve it through password/2FA and session recovery, with current permissions checked at the destination. Shared HTML/plain-text rendering uses runtime branding and program-zone notification timestamps. See [sender setup](deployment.md#email--aliyun-direct-mail-邮件推送) for fallback and delivery checks.

The management-only `program.emailDeliveryStatus` query composes [delivery diagnostics](../src/server/email/delivery-status.ts) with fresh aggregate outbox counts. Each category has a shared in-flight check and a 60-second process-local result cache; checks use separate non-pooled SMTP connections with a 15-second deadline and explicit socket cleanup. Diagnostics never send email or modify the queue. `PENDING` rows with attempts greater than zero surface the first failed attempt, while `FAILED` rows remain a separate exhausted-retry warning. The Program Settings → Deployment Configurations email card uses shared notices and a separate read query; failed background reads retain the previous timestamped result with an unknown-current-status warning. Refreshing diagnostics cannot replay a setting mutation or program rollover. Direct authentication/signup delivery history is not persisted by these diagnostics; the additive event/request outbox migrations remain required before running this version.

The ADMIN/HEAD-only `program.resendStuckEmails` mutation [requeues stuck notifications](../src/server/email/resend-stuck.ts) in a transaction with the email-notification setting lock, a bounded `FOR UPDATE SKIP LOCKED` selection and an aggregate audit entry. Only failed or previously attempted pending rows without an active lease qualify, and disabled optional or unavailable production categories are excluded. Resetting the selected rows' attempt budget makes another overlapping request a no-op for those rows. IDs and recipient/payload fields are retained; only the normal worker sends and rechecks current delivery eligibility. The client guards same-tick submissions and keeps accepted-queue state distinct from a failed status refresh, whose recovery only reads. Existing SMTP at-least-once limitations still apply across lease expiry and crashes.

Optional notification delivery adds a signed, 90-day unsubscribe link to HTML and plain text. The public `/unsubscribe` page only reads on GET; an explicit confirmation disables either the originating category or all optional email categories, account-wide across primary and included secondary destinations. The capability cannot enable preferences or suppress essential security/authentication mail. The shared template accepts an optional `unsubscribeUrl`, rejects non-HTTP(S) and credential-bearing URLs, escapes the link, and places an underlined 44 px target after the existing logo, brand and privacy copy. Sender purpose does not imply eligibility: direct student signup confirmation uses PROGRAM but remains essential and has no unsubscribe link.

### Public-request invalidity notices and appeals

[Request-invalidity writes](../src/server/request-invalidity.ts) enqueue an essential
`request_service` receipt in the same transaction as each applied flag, clear or later
reflag and its audit. A pending or rejected management proposal never sends an
invalidity notice to the submitter. Required reasons, actors, times and revision history
are retained without rewriting original intake, priority, answers or lifecycle state.
The unique `(requestKind, requestId, requestVersion)` receipt has nullable `userId`;
ordinary account mail still requires an account. Source kinds distinguish initial tutor
applications, student surveys and explicit legacy self-service tutees. Staff-entered
records are not reclassified as public requests.

[Request notices](../src/server/email/request-notice.ts) use PROGRAM transport while
bypassing optional program/personal preferences and secondary-recipient expansion.
Delivery uses the exact submitted address recorded on the source, with no account
address fallback, and rechecks its exact source/revision.
The [bilingual copy](../src/server/email/request-notice-copy.ts) masks unverified
recipients to request kind and original submission date/time/timezone, plus the
limited appeal action; no names, original answers or reason appear. Missing historical
timestamps remain unavailable rather than borrowing row creation time. A reason is
included only with source-specific mailbox proof: verified registration-code evidence
bound to that initial application and address, or the survey's own confirmation.
A matching account/alias or staff `contactVerified` value is insufficient. Legacy
self-service tutees without source-specific proof remain masked. Reasons must be
suitable for the participant to read after verification.

Receipt reads never send. Missing/invalid addresses are `BLOCKED`; queued work is
`PENDING`, an admitted transport attempt is `SENDING`, accepted SMTP is `SENT`, and
exhausted work is `FAILED`. Clear/reflag marks obsolete queued/failed/blocked receipts
`SUPERSEDED`. Optional account cancellation/skipping uses `CANCELLED`/`SKIPPED`.
An ADMIN/HEAD retry resets only an eligible failed/retrying receipt's budget, preserving
its ID, immutable payload and appeal expiry; it does not replay the flag operation.

Batch leasing is candidate selection, not transport admission. Admission acquires
source locks, then the request-notice advisory lock, then the outbox row lock. It checks
the captured acquisition lease, prior attempt fence and current source before committing
`SENDING` with a unique attempt ID and consuming one of five attempts. Only after that
transaction commits does SMTP run. Completion is fenced by the admitted ID: acceptance
remains recorded after a concurrent clear, and obsolete failure cannot requeue. Expired
attempts are recovered under the same source checks and bounded budget. Clear/reflag
cancels attempts that have not been admitted; already admitted transport can finish.
SMTP acceptance followed by a crash or completion failure remains uncertain and can
produce a duplicate retry despite a stable Message-ID. This is not exactly-once delivery
and `SENT` does not prove inbox arrival.

The [purpose-bound HMAC appeal token](../src/server/email/request-appeal-token.ts)
names one notice and expires 90 days after receipt creation. `/request-appeal` requires
no account and grants only a narrow status/appeal capability, never credentials,
participation or original request access. GET reads only safe request kind/time and
review state; it cannot consume or submit the capability. POST requires canonical
origin and JSON, bounds streamed body bytes, token length and appeal text, and admits
valid-token bursts through process-local limits. One immutable appeal per notice is
the durable cross-replica submission limit. Token possession is the limited capability,
not general source ownership proof, so forwarding permits another holder to appeal.

[Appeal submission/review](../src/server/email/request-appeal.ts) shares source/notice
locks with clear/reflag. Submission retains the original text and notifies active
Admin/Head with a safe event and the existing request-review destination; it never
clears the flag. Admin/Head may decline with required reason and version checks.
Clearing uses the existing authorized invalidity operation, including Coordinator
proposals, and resolves pending appeals while retaining submitted and reviewed
evidence. Clear/reflag makes old capabilities ineligible. Public reads never reveal
reason, answers, contact information, participant/staff identities or appeal body.

### Management registration codes

Registration Codes supports Tutor, Crew, Admin and Coordinator invitations. Every code grants only its displayed role. Head can issue directly; Admin can issue Tutor/Crew codes directly (including the legacy omitted-kind Tutor default), but requests Head review for Admin/Coordinator codes. Coordinators can request Tutor/Crew invitations for Head review but cannot request management-role invitations. The input-dependent authority policy preserves Head review of Coordinator proposals while recording direct Admin issuance in the same transactional audit trail. Only Head can list or share Admin/Coordinator codes and apply their revocation; Admin may request Head review of revocation. The selected role appears in the list, share card and every redemption step after code validation. There is no Head code; leadership transfer remains separate.

Admin/Coordinator redemption requires mailbox proof and explicit review. New accounts receive management access without Tutor, Crew, Tutee or Translator participation. Existing primary or verified-secondary email owners retain credentials, identity and participant attachments; the resulting rank is the higher of the existing and invited management ranks. An exclusive Viewer transitions out of Viewer when accepting this authorized upgrade. No code grants Head or demotes a higher rank. Expiry, rate limits, email binding, issuer authority and single use remain enforced, and issuer/recipient history is retained. The additive registration-kind migration preserves outstanding Tutor/Crew invitations. Apply migrations before starting the updated application.

## Policy documents and translations

The dashboard's `PolicyConsent` accepted message opens `CurrentPolicyDialog`, a read-only native modal. Opening refetches `student.policy` and suppresses cached text during loading or errors. The reader stays open if the refreshed revision is unaccepted; closing restores the normal consent UI. It uses published locale content with English fallback and never invokes acceptance mutations.

[Bundled policy drafts](policies/README.md) are English/Chinese development sources requiring school adaptation and approval. The running site reads `PolicyDocument` rows. Staff publish reviewed revisions through the policy editor; changing Markdown does not update live policy records.

Acceptance keeps the exact revision, text, signature and timestamp. Participation requires current consent; history, feedback, appeals, account settings and messages stay available during renewal. Student and tutor applicability are checked independently. Client scrolling and confirmation controls assist review but do not replace server revision and action-ticket validation.

Translation drafts capture a fingerprint of their destination. Publication rechecks it under a shared transaction lock covering direct edits and deletion; changed or missing destinations require a fresh draft. UI strings, fixed landing text, news, sections and page titles follow this rule. Publication, draft state and audit evidence roll back together on failure. Unknown/deleted UI language codes are rejected rather than silently writing English.

The `/localization` editor contains interface text, website text and draft review. The retired `/translation-review` route only redirects to its review view; no draft data is migrated or deleted. The route checks live account privileges. Assigned translators mount editing queries; management reviewers without that assignment mount review only. Draft listing filters state while retaining author scoping for non-management accounts. Coordinator text mutations pass explicit Translator authorization and create destination-bound drafts; structural mutations retain general approval queuing. Coordinator review requests still queue `translationReview.decide`, with Admin/Head publication replay limited to the validated draft operation. Draft state, publication and audit retain the existing atomic transaction.

Custom pages and page-mode landing sections share `/p/<slug>`. Their writers must use the shared namespace lock and [slug allocator](../src/server/home/slugs.ts) through commit. Collision suffixes fit the 60-character limit, unpublished content reserves its slug, and text-only translations do not allocate URLs. Direct database imports need their own cross-table validation.

## Data and deployment

Use the [deployment runbook](deployment.md) for bootstrap, SMTP, migrations, backups and launch verification. The image includes Prisma's migration CLI and starts the standalone server after applying migrations. PostgreSQL data and uploaded media must persist across container replacements. Development seeding is never a production bootstrap.

## Validation and development

[Local development](local-development.md#5-run-the-tests) contains the commands and isolated database setup. [Contributor guidance](contributing.md#required-checks) defines required checks. Use the [CI workflow](../.github/workflows/docker-build.yml) for the current verification pipeline rather than relying on historical test totals.

For focused regressions, start with the tests alongside the changed domain: `student-survey.test.ts`, `account-profile.test.ts`, `translation-destination.test.ts`, router `workflows.test.ts`, `home-slugs.test.ts`, `program-timezone.test.ts`, and messaging/announcement tests. Integration tests reset fixtures and must use an allowed isolated local database. Add cases for stale state, concurrent decisions, authorization and transaction rollback when changing these boundaries.

## Subject groups and qualification snapshots

`CourseGroup` holds offered-group order. `Subject` remains the stable variant referenced by surveys, choices and application intents; `baseName` and `SubjectLevel.prefix` generate its display name. Grouped JSON imports validate the shared `courseImportInput` schema and run through `importCourseGroups` under the catalogue lock and enclosing transaction. Exact repeats are no-ops; conflicts never merge or reactivate variants implicitly. Coordinator proposals snapshot the catalogue, groups and levels for stale-state review. The legacy CSV mutation remains available. All catalogue writers use [course-catalogue.ts](../src/server/course-catalogue.ts) and preserve archived variants. Pairing labels are synchronized transactionally when a variant name changes. Selection queries share `courseChoices` and `sortCourseChoices` (configured level rank/ID, base name, subject ID). Unlevelled offerings share the configured unprefixed tier; the complete level scale is read even for restricted pickers. Group-oriented displays and historical snapshots retain `subjectOrderBy`.

`TutorQualification` records an approval source and its status; `QualificationGrant` stores each concrete granted subject with its source and time. [Qualification helpers](../src/server/qualifications.ts) snapshot lower offered levels only on approval. Eligibility reads filter the source to `APPROVED`, never derive eligibility from application intent or the current level scale. Catalogue edits, approvals and assignment checks share a transaction lock. Repeated approval is idempotent; deleting one source cascades only its own grants. Historical assignments remain intact, while new assignments require an approved grant.

The migration assigns one group per legacy subject and exactly one original-subject grant per legacy approval, including retained historical scalar references. It does not guess relationships or grant new eligibility. Nullable group links support legacy fixture/import compatibility; catalogue APIs always create explicit groups. New code must use `approveQualification` rather than creating approval rows without grants. `admin.subjectEligibility` exposes distinct approved tutor/subject pairs. Subject willingness remains independent from qualification and should be intersected with these grants for availability.

## Signup field configuration

`src/lib/signup-fields.ts` defines the fixed field order, immutable essentials, defaults and shared normalization. `ProgramSettings.signupFields` stores per-form states; hidden/required cannot coexist. `program.setSignupField` applies changes as Head, accepts Admin proposals for Head review, and uses a transaction lock, an expected-state conflict guard and an audit record. Unknown/custom fields and essential changes are rejected. The public forms consume the same settings; each new submission reads current settings on the server and strips hidden answers. Existing survey payloads are decoded without applying current configuration, preserving historical answers and confirmation flows.

The tutee request form always refetches signup options on mount and waits for that
visit's check before enabling responses. The shared query cache's 30-second
freshness cannot authorize a returning participant to use earlier intake dates.
Failed reads disable responses while retaining mounted drafts for Retry. The
server still checks the current active term's intake window under its transaction
lock for both `submitSurvey` and the legacy `requestSignup` alias, independently of
login state. Opening is inclusive; closing is exclusive. Confirmation of a request
submitted while intake was open retains its separate verification rules.

An enabled signup CAPTCHA stages a submission intent before obtaining a one-use server grant. Keep identity/draft fields and feature actions frozen during that intent, but render the CAPTCHA panel outside every disabled fieldset so its Verify, Cancel and Retry controls remain operable. The viewer's identity and resend steps share one panel. Form integration tests use the real hook with a local SDK fixture and native button clicks, including failure recovery and duplicate-callback guards.

Tutor application submission requires explicit agreement and the current published policy revision. New applications store exact policy documents, revision and acceptance time together; historical applications retain null evidence. This application-level evidence never fabricates a user-level `PolicyAcceptance`. Qualification answers and subject intents remain application data, never qualification grants. Secondary-email availability belongs to the program email configuration; the existing signup forms collect only primary sign-in email.

## Reviewing your own management requests

Admin and Head can review eligible daily Management Actions. Only the current active Head can review significant settings, management profile/rank changes, reversals or their own pending requests. Other reviewers cannot decide their own requests, including after promotion to Admin. Current database permissions apply after promotion, demotion or suspension. Head self-review preserves required notes, consequence confirmations, stale-record checks and atomic application; requester and reviewer audit identities remain recorded even when they match. This exception applies to Management Actions, not participant interview voting or qualification decisions.

`classifyApproval` is the common direct/request/reviewer policy. `proposalAuthority` supplies
live context for payload-dependent restorations, initial versus already-reviewed cards,
qualification removal and corrections to completed interview/meeting attendance. Central
authorization runs before proposal creation and resolver gates, then is repeated for the
requester and reviewer during application. Significant settings and staff profile/rank
proposals require an Admin or Head requester;
other access and reversal operations retain their classified requester roles. An obsolete
Coordinator proposal cannot retain permission after the policy changes.
Participant badge requests carry a server-created self-service marker and cannot request
management rank. Notification fanout uses the same reviewer classification and active accounts.

Modern proposal evidence includes an authority-context version and relevant global settings,
active term and dependent records. Its canonical fingerprint tolerates JSONB object-key order;
legacy immutable requests retain their original evidence algorithm. Changed evidence fails
closed. Legacy role-change input strips the original password before persistence and requires
the Head reviewer's fresh password during replay.

The audit boundary composes database writes and safe before/after evidence in one transaction,
including helpers that import the shared database. Database-owned workflows retain their
existing isolation and retry boundaries. Bulk writes retain every captured affected record
and safe submitted relationship rather than sampling the first fifty rows, so storage and
transaction work grow with the batch. Safe snapshots use an explicit field allowlist;
established account/roster contact edits are retained for authorized staff, while observer
projections mask the details. Management review notes and correction/discipline reasons
are retained only for explicitly allowed domain models; attendance self-excuses and
participant appeal bodies remain private. Passwords, invitation/proof codes, credential
hashes, verification recipients and private message bodies cannot enter fallback evidence.
Failure/denial receipts are recorded separately from rolled-back changes. Expiry and removal
helpers write system-attributed evidence within their own transactions. Registration issue,
redemption and revocation have explicit lifecycle events, including issuance linkage where
available. External delivery follows commit and cannot turn a committed program change into
a reported failed write. Credential verification retains its own attempt/consumption boundaries.

## Username allocation and bounded student backfill

Management summaries and current selection/review labels reuse `ParticipantName`
and `participantNameLabel`: preserve a nonblank canonical name, otherwise use an
already authorized projected username, otherwise show translated **Name not
provided**. This is presentation only. Raw search/sort values, selected IDs,
mutation names, profile drafts, exports and original evidence are unchanged.
Completed interviews/flag decisions, historical profile names and recorded actors
retain their original text. Current Crew summaries expose `canonicalName` and
`username` alongside the unchanged legacy label/sort field; Subject Availability
projects the current tutor handle only through its existing staff-only read.
The Crew DTO's `canonicalName` references the materialized current `User.name`,
which may be a reserved username fallback. Original identity fields remain
`firstName`, `lastName`, `preferredName`, `alternativeNames` and `legacyName`;
reads preserve those fields and the already materialized label without writes.

`src/lib/username.ts` owns the editor/generation character and length rules. All runtime handle
writers use the transaction-scoped PostgreSQL advisory lock `identity:username-namespace` before
profile/identity writes and retain it from the cross-table availability check through persistence.
`ensureUniqueUsername` requires the active transaction client; callers must not pass the root
client or persist its result after the transaction ends. Conflicting automatic creations serialize
and select the next suffix. Explicit Head renames and canonical account/tutor mirroring use the
same lock. An established-handle collision is a reviewable conflict, never an automatic rename.

Head can use **Users & Roles → Assign Username** for an eligible verified student without a handle.
The confirmation names that one account and refreshes account/list data after assignment.
For explicit batches, Head can invoke `admin.backfillStudentUsernames` with `{ userIds: [...] }`, an explicit batch of
1–100 distinct verified STUDENT account IDs. The operation validates the whole batch in a
transaction, leaves established handles unchanged, records each assignment and rejects other
roles/unverified accounts. It does not scan or migrate all users automatically. Review the intended
IDs in Users & Roles before invoking the staff API; repeat with the next explicit batch as needed.
Only Head application through the authorized, audited username editor or approved Admin proposal deliberately changes an established handle.

`src/server/auth/username.test.ts` exercises real PostgreSQL same-table/cross-table races,
rename versus allocation, simultaneous backfill, rollback, setup, promotion and canonical mirror
reconciliation. Naming and optional-spelling rendering have separate pure/UI regression tests.

## Canonical academic profiles

`AcademicProfile` is one row per `User`, independent of tutor, tutee and crew membership.
It holds an explicit `REPORTED`, `UNKNOWN` or `NOT_APPLICABLE` state, supported G1–G12
number, optional raw school-system text, reference school year (`YY-YY`), confirmation
instant and reconfirmation flag. `AcademicConfirmation` preserves successive confirmed
values, actor, source and optional correction reason. Expected graduation is derived as
the reference school-year end plus `12 - grade`; no override or username parsing is used.

Interactive confirmations and invitation registration take the reference school year
from the active program term on the server. Clients cannot supply an alternative year.
The editor sends its observed year so a concurrent program-year change rejects the stale
confirmation. Internal historical confirmations retain their original reference year.
Users & Roles keeps academics in User details. Its four-column summary separates login setup from suspension and permissions/participation; setup readiness requires password presence, a verified primary email and no required password change. The shared predicate returns only the status; credential hashes never leave the server.

Current identity records (User, Tutor, Tutee) store explicit `firstName`, `lastName`,
`preferredName`, and `alternativeNames` (the UI's Name in Another Language).
First, last and preferred names have fixed server-side Latin-script validation, with accents,
spaces, apostrophes and hyphens allowed. Alternate names accept Unicode. Blank optional
names are allowed. The legacy policy booleans remain for wire/storage compatibility; the
current API always reports true/false and ignores attempts to change the fixed rules.

`ProgramSettings.usePreferredNames` defaults on; `showAlternateNames` defaults off. Head
applies changes; Admin submits them for Head review. Both paths retain stale-draft
checking and an audit record. The preferred name replaces
only the first name; the alternate name is appended with a middle-dot separator. PostgreSQL
triggers materialize this label in `User.name` and roster `englishName`, so existing
readers, exports and refreshed authentication sessions agree. The settings writer takes the
username namespace lock then identity table locks before refreshing labels in one transaction.
Saving invalid names rolls back the profile operation. Shared account writes copy explicit
fields to linked rosters; they never split a display label. Username generation uses the
explicit fields rather than the display label.

Migration `20261007010000_preferred_names_default` aligns the database default,
API/schema defaults and PostgreSQL formatter's missing-settings fallback. It enables
preferred names for untouched defaults, including the singleton created by earlier
migrations on a fresh install. An audit with operation `program.setProfilePolicy`
and `details.after.usePreferredNames` preserves the current saved choice, including
`false`; older Latin/grade-only audits do not count as a display choice. Direct database
edits without that audit are treated as untouched defaults. The alternate-name setting
is retained. Current labels refresh when the effective policy changes, including when
settings are absent or first created with an explicit opt-out. Blank preferred names
fall back to First Name, retaining Last Name when supplied.

Migration `20260930010000_four_name_fields` preserves original labels in `legacyName`
and copies only already-explicit matching tutor fields. Unconfirmed old tutor splits retain
the original label until edited. Intake snapshots gain nullable explicit fields without
rewriting old submissions. No trigger touches signatures or audit snapshots. Apply migrations
before deploying the matching application; regenerate Prisma after changing the schema.
The new migration follows the historical `program_profile_policy` and `legal_name_policy`
migrations. New grade reports must still use an offered grade.

See [name-field wording and behavior](design/name-fields.md) for labels and display examples.

Self-service writes own the current authenticated account. Head applies staff corrections to other
accounts; Admin submits corrections for Head review. Coordinators cannot submit staff profile or
academic corrections. Academic and name changes share the account advisory/row lock and
`User.profileVersion`; two concurrent edits cannot silently replace one another. Linked
Tutor grade fields are compatibility mirrors. Historical `Tutee.gradeLevel`, surveys,
policy/signature snapshots and unrelated names/emails are never rewritten. Roster APIs
return a separate `academic` summary for the current explicit account link. Tutor records
without accounts retain provisional fields and an unknown/unconfirmed summary.

Migration deliberately does not invent reference years or confirmation dates for legacy
grades. Recognized `G10`, `Grade 10` and numeric `10` forms normalize to G1–G12; nonstandard
school systems remain raw text with no inferred graduation. Conflicting User/Tutor/Tutee
sources retain their original values together and require an explicit correction.

Verified student intake records the server-observed account ID/profile version in its
immutable payload. After email proof establishes explicit ownership, a matching version
can confirm a repeated grade, a changed grade or a new reference year. Later profile edits
win over old verification links. Existing conflicting registration/legacy data stays
unchanged and prompts confirmation; hidden/omitted optional grade input is a no-op.
Intake verification is bound to its original active intake term, so a later link cannot
stamp a new school year onto an old answer. Crew application grade/name prefill transfers
to registration for deliberate confirmation without mutating the application snapshot.

Rollover never advances grades. A known report becomes stale at the year boundary and its
expected graduation stays anchored to its original reference. Only an ACTIVE tutor with
confirmed current-year G12 may graduate at the configured graduation boundary (Q4 entry,
or year crossing in semester mode). Known stale reports require confirmation before
reactivation/reentry; unknown/optional and not-applicable data cannot create a new signup
barrier. A tutoring participation break never implies an academic gap. Repeated years,
acceleration and school gaps are new self-reported confirmations with the correct year.

Tests in `src/lib/academics.test.ts` and `src/server/academics.test.ts` cover normalization,
role-independent API ownership, version races, historical preservation, rollout states,
G12 exceptions, reference-year estimates, verified intake and migration fixtures. The
migration regression runs inside a rollback-only PostgreSQL schema in the allowlisted
local test database.
## Serializable username allocation

Program-record transfer uses the same username namespace fence before importing Tutor rows. See [CSV archive internals](#csv-archive-internals) for its transaction and permission boundaries.

The namespace lock also updates the singleton `UsernameNamespaceGuard` row. Advisory locking
alone cannot refresh a snapshot already established by a Serializable approval transaction:
a later User allocation could otherwise be invisible when that snapshot creates a Tutor (and
vice versa). The persisted write fence causes PostgreSQL to reject stale snapshots before handle
selection. Its upsert recreates the singleton after isolated fixture resets; failed transactions
roll back both the fence revision and their account writes.

Identity-capable approval replays acquire this fence before dispatch or profile/leadership locks.
Only a serialization failure tagged by that fence is retried, at most three times at the outer
approval transaction boundary, with a fresh snapshot and rechecked authority/proposal evidence.
Generic commit failures and callbacks that fail after external work are not automatically repeated.
SMTP delivery remains after the committed approval result. Tests reproduce the former ambiguity
in both cross-table directions and exercise a real blocked approval replay, bounded retries and
non-retryable failures.

## CSV archive internals

Historical academic evidence lives in `HistoricalAcademicRecord`, linked to exactly one Tutor or Tutee (database check and restrictive foreign keys), independently of User. `HistoricalAcademicCorrection` is an append-only overlay with a unique record/revision, before values, new raw grade/year, evidence, reason, method, actor, approval ID and correction timestamp. Original confirmation evidence is nullable and never inferred from import/correction time. Additional years have distinct stable IDs; legacy roster/enrollment IDs are deterministic and materialize on first correction, an exact-baseline archive restore, or historical tutor reactivation. Reads alone never materialize them. Linking an account does not copy these records into its current AcademicProfile.

`historical-academics.ts` shares website/CSV validation and signs exact previews. Apply takes the username namespace fence, sorted account locks, participant row locks and record locks; it rechecks every fingerprint and live role before appending within one transaction. Fingerprints cover original/latest evidence, source rows, ownership and owner academic versions. Admin proposals require Head review, store named before/after evidence and recheck it in the enclosing approval transaction. Late failures roll back all revisions and audit. Preview uses a read-only POST to keep uploaded evidence out of query URLs. Managers alone can browse correction/audit endpoints; observer roster projections permit only normalized grade/year summaries.

The correction screen owns the write and its complete refresh group, with immediate guards for preview and apply. Accepted or queued reviews cannot replay through the same mounted handler. `settleRefreshes` and `invalidateAndReport` retain all matching reads and surface actual cache errors; failed synchronization offers read-only recovery without rebasing independent drafts. Roster responses expose an `enrollmentOriginal` summary separately from the latest correction. Historical display and grade sorting prefer those reports over mutable roster mirrors, preserving nulls. History's original-academics panel uses the same saved baseline; the observer allowlist strips unsupported raw text from both original and corrected summaries.

The archive allowlist includes original HistoricalAcademicRecord evidence, with explicit participant/year/source validation. A new reserved-ID baseline for an existing participant must match its locked virtual original, including grade, year, graduation choice, source and confirmation date; importing the participant for the first time may restore its separately preserved original. Correction overlays are deliberately outside archive input/export and require operator database backups. Retry comparisons still use original rows; a correction never silently turns additive imports into updates. See [staff correction instructions](historical-participant-transition.md#correct-historical-academics).

`src/server/api/routers/record-transfer.ts` exposes HEAD-only export, preview and import procedures. Each rechecks and locks the active account within its transaction; a stale HEAD session cannot authorize a transfer. These procedures are deliberately absent from coordinator approval operations. Export uses a Repeatable Read snapshot and writes export audit evidence. Preview and import use Serializable transactions plus the shared import advisory lock. Tutor and HistoricalAcademicRecord files acquire the username namespace fence before the account lock.

`src/server/record-transfer.ts` declares the domain-table allowlist in dependency order. PostgreSQL metadata supplies column types, nullability, defaults, enums and primary keys. Only allowlisted tables and validated column names enter SQL identifiers; cell values use bound JSON parameters through `jsonb_populate_record`. New columns require security review: User remains restricted to ID/name/email, and survey token hashes remain excluded. `User.csv` validates existing accounts without writing them. Scalar ownership and other live references receive explicit checks in addition to database foreign keys; historical actor snapshots can survive account deletion.

Signup archives preserve the original `StudentSurvey` evidence, its current answer
projection, immutable `StudentSignupRevision` answer/consent evidence and
`StudentSignupAppeal` review evidence. Private client/decision retry capabilities,
notice delivery capabilities and executable `StudentSignupIntent` challenges are
not exported. Import mints fresh operational receipt keys and randomized
survey proofs; archival restoration cannot reactivate an old retry or mailbox
capability. Original answers are compared separately from the current projection.

Preview runs the same validation/insertion code and deliberately rolls back the transaction. This exercises actual unique and referential constraints without retained writes, notifications or emails. A 15-minute HMAC ticket binds the exact uploaded files to the actor. Import verifies the ticket and revalidates against the current database. Exact primary-key matches are skipped only when all supplied values match; conflicting rows abort the transaction. The import audit entry commits with the data. These three operations bypass the generic post-mutation audit hook because export/import already write transactional evidence and preview must remain a dry run. Imported survey tokens are random hashes with no issued plaintext link.

`src/lib/record-transfer.ts` defines strict CSV parsing and reversible, formula-safe encoding; `record-transfer-archive.ts` checks ZIP names and expanded sizes before extraction. `src/app/_components/record-transfer.tsx` loads ZIP support only on demand and clears preview/confirmation state when files change. The server page and navigation both restrict the feature to HEAD; existing Reports CSV controls use the refreshed account role. Limits are 5 MiB and 5,000 rows across a transfer. This feature is additive history ingestion, not a replacement for database backup/restore or account provisioning.

Regression coverage is in the three `record-transfer.test` files under `src/lib`, `src/server/api/routers` and `src/app/_components`: role denial, stale privileges, rollback, related-record ordering, retries/conflicts, ticket integrity, CSV/ZIP encoding and bounds, upload/confirmation states and error display. Integration fixtures require the isolated `shbs_shipping_test` database.

## Maintaining the documentation

Edit the existing guide for the reader's task. Keep each procedure in one place and link to it from related guides. [Documentation ownership](contributing.md#documentation-and-repository-hygiene) explains where content belongs.

Run `npm run docs:check` to validate Markdown links, heading anchors, guide discoverability, role sections and issue forms. Read the guides directly in GitHub or a Markdown viewer; no compilation step is required.


### Integrated survey appeal authority and delivery

The owner selected #385’s newer survey lifecycle when integrating #384: appeals end with the active signup period, and final rejection closes the request and ends its active priority. Modern survey flags create one `EmailDelivery` request-service receipt; `StudentSignupNotice` retains only the matching invalidity-version/account-bound appeal capability for that flag. Its flag kind is routed through the shared worker, not independently mailed. At transport admission the modern link must match the immutable receipt request version and the capability’s current ownership; transport retry never grants a later-version capability. Generic survey tokens are explicitly retired instead of retroactively acquiring modern authority. Existing generic survey appeals remain immutable, staff-readable and non-decidable; old signup-specific tokens retain their original version/account checks and current-period eligibility. Tutor/legacy generic appeal behavior remains separate.

The first admitted modern appeal also preserves #384's typed staff-review event:
`request_invalidity_appeal_pending` goes to the existing active Head/Admin audience,
with the shared record-specific survey destination. Appeal, notifications and audit
commit in one transaction. An exact immutable receipt replay returns before fan-out;
failed or rolled-back submissions create no staff event. The event contains no appeal
reason, mailbox capability or retry key. This restores the notification contract
without changing current-period eligibility, terminal rejection or delivery authority.

Signup decision controls return failed mutation promises to the shared timed admission guard. Accepted or queued writes stay accepted and recover through reads only; identical failed writes can be deliberately retried with the retained draft/ticket. Combined regressions cover one flag receipt/send, stale-version links, period rollover, rejection priority, historical appeal read-only projection and retry authority.

Reviewed same-owner credential recovery rotates its appeal capability only in the
same transaction that successfully queues the matching delivery receipt. A
`SENDING` attempt or active lease leaves the captured capability unchanged. After
that attempt settles, another explicit retry may queue and rotate atomically;
neither a refused retry nor a background read can invalidate an in-flight link.
For pre-existing sent generic survey receipts without a modern capability, an
explicit staff recovery can requeue that same receipt and create its matching
modern capability atomically. Refused admission creates no capability; a prior
generic SMTP attempt cannot mark a newly unsent modern link as delivered.

The shared receipt's original verified alias is checked again by authoritative
token inspection and appeal submission, under the same username namespace used
by address removal. Removing or transferring that alias revokes a captured link
even if the primary address and session version are unchanged. Primary-exact and
older native notices retain their existing binding. A modern capability-backed
flag receipt is superseded before transport when its signup has become terminal;
the separate appeal outcome notice remains the correct final-state message.

The three signup-specific actions (`SIGNUP_EDIT`, `SIGNUP_UNASSIGN`,
`SIGNUP_APPEAL`) retain their existing five-second review delay when joining the
action-specific confirmation map. Their ticket expiry and version/target binding
are unchanged; no missing map entry may produce an invalid confirmation instant.
