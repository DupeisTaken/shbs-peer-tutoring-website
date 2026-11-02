# Interaction patterns

Choose an interaction after identifying its save boundary, read lifetime and
authorized audience. Use [design conventions](design.md) for visual
rules and [implementation](implementation.md#add-an-action-or-feature)
for the feature extension recipe.

## Reuse interaction patterns

Review the development-only [UI gallery](verification.md#ui-pattern-gallery) before building a new interaction. Its examples use the same [shared components](../../src/app/_components/ui) as the application. Keep the existing slate surfaces, white cards and accent themes. The [design conventions](design.md) own control heights, table actions and responsive headers; the component map below connects interactions to reusable controls.

- Use links for navigation, `SectionTabs` for in-page panels and `ChoiceButton` for persistent selections. A selected value is not a submitted action.
- Use the shared `Pager` from `student-portal.tsx` for participant and message lists. Give separate lists distinct translated labels, preserve their own page/filter state and use their existing `more` signal. Show the known current page; do not invent a total from a full batch or another list's count.
- Put related fields in `FormSection` and place its Save/Cancel actions after all fields they affect. In a feature-owned fieldset, group buttons in `FormActions` to retain horizontal and wrapped-row spacing, as in the recruitment settings editors. Keep mutation state, validation and permission checks in the feature that owns the operation.
- Use `Modal` for review and confirmation, with a specific action label and consequence. Existing action tickets, countdowns and approval rules still apply; the component does not authorize a write.
- For a `useActionReview` containing private evidence, the feature must conceal it when authoritative access is revoked and call `revoke()` to release the stored review. Preserve accepted keys and pending writes; ordinary read failures should retain the review and its recovery.
- Use `StatePanel` to distinguish loading, empty results, errors and denied access. For a query with cached content, [QueryFeedback](../../src/app/_components/ui/query-feedback.tsx) composes the initial panel and background `InlineNotice`; supply task-specific translated text and a read-only Retry. `hasData` means a completed response exists, including an empty array. The feature retains its content and drafts, controls dependent writes, and owns denial/cache handling. Failed queries need recovery, and denied access must not appear as an indefinite loader.
- For information tables, opt into `<SummaryTable sortable>`; each data header cycles ascending → descending → original incoming order. Use `data-sort-value` on cells for domain values (numeric hours, chronological schedules, component-rendered names), and `data-sortable={false}` for selection headers. Keep stable record keys and show identity on every independently sortable row. Existing roster adapters use `SortHeader` and the same three-state cycle with session-backed choices. Logs, submissions, historical reports and server-paginated tables remain unsortable.
- Use `SummaryTable` for tables: only brief names, dates, counts and statuses in columns. Put existing details and editors behind compact text links in the rightmost `TableActions` cell. Read-only history tables can omit actions; only explicit action cells become sticky. `TableDetails` opens an on-demand dialog. Related contact, account, course and history sections may share a feature-owned reader, as in Tutee details, while retaining their separate authorization. Never mount private query or mutation children for observers.
- Compose new screens from the gallery's long-dialog, participant-form, filter, disclosure, settings, change-review and inline-notice examples. Reuse existing domain components. Set disclosure lifetime deliberately so collapsing a form never discards its draft.
- Register each dialog form's own pending write with `useDialogPending`; do not feed its aggregate return value back into registration. Keep independent forms and their version snapshots separate. Preserve cached drafts on refresh failure. Clear or replace them through the feature's confirmed save/synchronization path, an explicit successful reload or cancellation; a background refetch alone must not discard edits.

For potentially long table details, opt into `TableDetails longReader` as the room
grid and Crew original-text readers do. This composes the existing `ProfileDialog`
with a reachable header Close while preserving on-demand mounting. Keep brief
reviews compact; the feature still owns any pending writes and access checks.

`ProfileDialog` keeps its body in a stacking context below the sticky Close header.
Nested summary-table action cells retain their own horizontal stickiness, but must
not paint over the title or Close during vertical scrolling. Verify the long-reader
gallery with a sticky-action table and the actual staff Audit evidence reader at deep scroll
in English and Chinese on desktop and mobile. Component tests check the stacking
boundary and keyboard lifecycle; saved browser images establish actual paint order.

Keep absolutely positioned screen-reader labels inside a positioned form boundary
when the form sits in a bounded scroll pane. Recruitment fieldsets provide that
containing block for their hidden legends and date labels. A clipped one-pixel
label can otherwise enlarge the document scroll range even when visible content
is correctly clipped. Preserve its accessible name; verify desktop pane scrolling
and mobile document scrolling instead of applying a global overflow clamp.

Start by identifying the save boundary, query lifetime and authorized audience, then select a composition. Use an existing feature integration as well as a gallery example: long editors, immediate settings and staged forms intentionally have different save behavior. Keep new domain logic in the owning feature; a generic component must not infer permissions or expected versions from its visual state.

## Start with the shared patterns

Preserve the existing slate surfaces, white cards and accent themes. Before adding
or changing a UI workflow, read the [contributor guidance](#reuse-interaction-patterns)
and [component boundaries](../reference/technical-report.md#shared-ui-patterns), then inspect
the real components in the development-only `/ui-gallery`. Gallery examples live in
`src/app/ui-gallery/gallery.tsx` and `src/app/ui-gallery/recipes.tsx`.

| Interaction                                              | Reuse                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Navigation / alternate content panels / selected filters | Links / `SectionTabs` / `ChoiceButton` inside `FilterToolbar`                                                       |
| One set of fields saved together                         | `FormSection`, `FormActions`, context-sized `Button`                                                                |
| Participant identity and academics                       | `ConfiguredPersonNameFields` (built on `PersonNameFields`), `FieldRequirement` and existing academic/grade controls |
| Short review / long editor / policy reader               | `Modal` / `ProfileDialog` / `CurrentPolicyDialog`, all using `NativeDialog`                                         |
| Brief records with detail entries                        | `SummaryTable`, `TableActions`, `TableAction`, `TableDetails`                                                       |
| Collapsible content                                      | `DisclosureSection` with an explicit lifetime                                                                       |
| Settings and reviewed changes                            | `SettingRow` and `ChangeReview` with feature-owned state                                                            |
| Initial query state / background recovery                | `StatePanel` / `InlineNotice` alongside retained content                                                            |
| Public forms and history navigation                      | `PublicFormPage`, `PublicFormCard`, `PublicPageNavigation`                                                          |

Extend a shared component only when its contract fits every caller; otherwise compose
existing components. Add a gallery example and behavior tests for a new reusable
pattern. Presentation must not change server permissions, confirmation tickets,
approval rules, immutable evidence, query access or profile/policy version ownership.

## Drafts, pending writes and nested dialogs

- Each independent form owns its draft and version snapshot. Use
  `useDialogPending(ownPending)` to register that form's write. Its aggregate return
  value may disable siblings; never register that aggregate again or the busy state
  can remain latched. Guard same-tick duplicate submission in the feature as needed.
- Preserve drafts on failed saves and background refreshes. Keep cached content
  mounted beside recovery. A conflict Retry must not silently adopt a new expected
  version; explicit Reload replaces a draft only after a successful fetch.
- A successful write followed by failed synchronization is distinct from a failed
  write. Use the feature's read-only refresh recovery instead of resubmitting it;
  tutor availability is the existing example.
- Nested review owns Escape and keyboard focus. Restore the exact opener when it
  remains usable; otherwise focus the remaining parent dialog. Pending writes block
  parent dismissal until they settle. Keep long editors' Close header reachable.
- Choose disclosure lifetime deliberately: `lazy` for disposable read details,
  `retained` for drafts mounted on first open, `mounted` for forms that must exist
  from the start. Preserve four-part and legacy names through `PersonNameFields`;
  keep its native validation and translated requirement markers intact.

## Reuse configured identity fields

Production intake and profile forms use [ConfiguredPersonNameFields](../../src/app/_components/person-name-fields.tsx), which composes `PersonNameFields` with the live policy read. Pass `accountType` for the intake being registered; for an existing profile, pass its `profileTarget` and let `program.nameFieldsForProfile` resolve the account's current role. Do not union Tutor, Crew and Tutee memberships into a name policy. Use `management` only inside an already-authorized staff editor: it reveals retained Hidden originals, but grants no read or write permission.

Keep the form's submission guard tied to `onPolicyAvailabilityChange`; absent or failed policy reads cannot authorize a save using default requirements. `useNameFieldPresentation` supports surrounding headings/help without making hidden fields visible. Cached configured fields and the draft stay mounted but disabled during read recovery. Hidden fields contribute neither requirement markers nor active display labels; participant edits preserve their stored originals. An all-hidden policy is valid, and an unsplit legacy label must not expose a hidden component. Server validation and username fallback remain in [the name-field helpers](../../src/server/program/name-fields.ts), not the component.

Use [configured-field tests](../../src/app/_components/configured-person-name-fields.test.tsx) for policy readiness, recovery and retained management fields, [name-field policy tests](../../src/lib/name-field-policy.test.ts) for hidden-label rules, and [program configuration tests](../../src/server/program/program-configuration.test.ts) for current-role validation and fallback allocation. Keep labels separate from translated `FieldRequirement` text; [name-field behavior](../reference/name-fields.md) owns the complete wording and display examples.

## Keep settings and navigation predictable

The Program Settings information architecture groups independent controls into
Recruitment and Refresh; Account Settings; Deployment Configurations; and Optional
Features. Calendar dates belong with the program period, messaging permissions with
account policy, and mail delivery/CAPTCHA with deployment. Moving controls does not
combine their save operations or broaden their authorized audience.

An invalid-record filter defaults to Active entries, followed by Invalid entries
and All entries. Here Active means not marked invalid, not a particular approval
or membership status. Preserve the underlying statuses and permission checks.

For repeated blur-save fields, put one clear save-boundary explanation at the top
of the group and associate it with the relevant controls. Use compact file-picker
actions with the selected filename beside them. Keep required descriptions and
native file selection accessible without redundant headers.

Temporary navigation may restore the current tab, filters, pagination and scroll
within the same browser session. Restore the correct scroll owner: management may
scroll an inner content region while participant pages scroll the document. Scope
state to the signed-in identity and route, validate restored values, and let an
explicit destination/hash or access change take precedence. Store no form drafts,
passwords, private record text or authorization results in navigation storage.

Use `useSessionViewState({ id, initialState, parse, scope, enabled })` from
`src/app/_components/session-view-state.tsx` for explicit presentation choices.
It returns the usual state/setter pair. Give each feature/schema a stable `id`,
include its period and validated query context in `scope`, and supply a parser
that allowlists the currently available choices. `viewEnum`, `viewPage` and
`viewSearch` are small helpers; record parsers must select only named filter
fields. `viewFields` composes those named field parsers and drops unknown fields.
Restored values are checked against the current parser on every render, and a
normalized result replaces the stored representation so removed IDs cannot return
when a catalog changes again.
Parsers validate live feature values as well as restored values; they must not add
input limits that the feature did not have. `viewSearch` checks text shape, while
`viewIdentifier` retains a 160-character bound for IDs and URL choices before their
catalog arrives. The separate storage writer keeps its 160-character scalar and
4 KiB UTF-8 entry limits, including the encoded key and JSON value. Oversized query
contexts cannot enter storage through a scroll key. A valid longer search stays
usable in memory, including later
filter updates, but removes its older saved entry instead of restoring stale
criteria on return. Storage rejection or quota failure affects only that entry;
shortening the search makes it eligible for recall again.
Set `enabled: false` for authoritative denial or module removal, not ordinary
loading. Explicit URL choices override the remembered state. The tutee navigation
only recalls a previous view on a bare workspace return after identity verification.
For dynamic catalogs, use `restoreReady: query.data !== undefined` until choices
arrive, then allowlist current IDs. This exposes the initial presentation while
loading and leaves the saved choice intact; `enabled: false` still clears denial.
`useSessionAccessDenied(...ownedQueries)` provides a presentation-only denial latch:
an authoritative access error remains denied through later transport failures until
the owned reads succeed again. Hide cached denied content in the same owner; this
helper never grants permission or replaces server checks.

Apply-only filters save their committed read criteria, not the unfinished input.
Audit reconstructs timezone-aware query dates from date-control strings; its form
receives the applied values so controls match the restored query. Approval list URLs
remain authoritative, with local feedback while `router.replace` commits. Full-message
searches and conversation selections in supervision stay private and transient;
pagination within those private searches also stays transient. Landing's selected
lazy editor reports its own query readiness; image-library success alone is insufficient.

Register `useSessionPageScroll({ id, scope, ready, enabled })` once in an authorized
page, including its selected panel/filters in `scope`. Set `ready` when its owned
reads have usable content; `SessionPagePosition` is the equivalent adapter for a
server-rendered shell. At 1024 px and above management restores `#admin-content`;
other layouts and narrow management pages restore the document. Breakpoint changes
switch owners. Dialog, table and sidebar scroll are excluded. Hash destinations and
user gestures take precedence; delayed content recovery stops after five seconds.
That bounded window remains active after the first successful position, correcting
late framework resets only when the measured position differs. A user gesture or
hash immediately ends recovery, and unmount removes its frames, timer and observers.
Storage failures fall back to normal navigation. The session-only, bounded store
reuses the existing identity privacy check and never enables route DOM/draft caching.
The gallery filter toolbar demonstrates the same hook without creating another
identity provider or copying any example form fields into storage.

Notification record arrivals use a separate, feature-owned adapter rather than a remembered scroll position. Follow the [record navigation contract](../reference/technical-report.md#notification-record-navigation): validate the destination, commit its authorized panel/filter choices, then pass its arrival and read readiness to `useNotificationRecordReveal`. A fragment is never authority to query hidden records or change a draft. Keep record IDs transient and let explicit arrival, cancellation and access loss take precedence over session restoration.

## Retain local work while changing panels

For a long settings workspace, group existing owners with `SectionTabs` rather
than introducing a combined Save. Program settings and Crew illustrate separate
settings, records and review panels. Choose initial mounting deliberately: keep
already-mounted form owners, or mount on first access when the feature permits it.
Retain the owner while its panel is hidden. Hidden controls must leave the keyboard and
accessibility trees. Keep an active review, its accepted-operation keys and its
refresh recovery outside a panel that can be hidden. A tab change must neither
discard a draft nor replay an accepted write; permission revocation still removes
protected content.

Put creation behind one title-row action when an always-open form delays the
primary records. Compose the existing `ProfileDialog`, with draft state above its
visibility toggle. Give creation and row editing independent drafts, even when
they share field markup. Verify close/reopen, failed saves, nested confirmation,
pending dismissal and exact opener focus before migrating another caller.

Search only the records already authorized for the current roster scope. Reuse
`matchesPersonSearch` for four-part, preferred, alternative and legacy names, and
match identifiers only when the query already supplies them. Apply search before
sorting; clearing it must preserve the other filters. In an explicit-ID participant
picker, filtering hides candidates without changing selection. Keep a selected
summary and deliberate removal so a long list never conceals the submitted IDs.

Explain the existing save boundary beside the relevant fields: a blur save, one
form Save and publication are different operations. Additional actions at the end
of a long editor must reuse the same admission guard, pending state and payload as
its top actions. Do not introduce autosave, a global action registry or draft
storage merely to make controls look consistent.

## Profile editor completion

In profile editors, completion of one section must not dismiss a failed independent
draft. Profile and username saves therefore keep the editor open for deliberate
Close, even when every operation succeeds. The saved section refreshes automatically
after Save, reading the server even if the cache is fresh and adopting only its
own fields and expected version before becoming editable again. Other sections
retain their drafts and versions. A failed or missing-record read keeps the saved
section locked and exposes **Retry refresh** outside its disabled fieldset. This
recovery performs reads only and never repeats the accepted mutation. The long
dialog recipe demonstrates a failed draft alongside a saved section using
`ProfileEditSection`. Saved feedback is separate from the refresh lock; failed
synchronization does not block idle Close. Verify both completion orders, failed retry,
all-success and a committed write whose synchronization fails on the actual pages.
For [repeat profile editing (#282)](https://github.com/DupeisTaken/shbs-peer-tutoring-website/issues/282),
verify a third edit/save cycle without a restart action, failed automatic reads,
current version fences, same-frame duplicate submission, unchanged sibling focus and
retained drafts, including history editors. Use actual child components and the
installed QueryClient for composition coverage.

Gate refreshes independently when testing save completion. A rejected read must not
release dismissal or sibling submission while another refresh remains pending.
Use `settleRefreshes` at each aggregate boundary, including nested groups, and
present a refresh failure only after the remaining reads settle. Saved state must
continue to prevent replay of the committed mutation until its automatic matching
read or explicit recovery succeeds. Unrelated background refreshes never replace drafts.

Also test two active query variants under the same procedure prefix using the
installed QueryClient. Default invalidation can suppress GET errors; enabling
`throwOnError` alone can reject before another matching query finishes. The save's
refresh boundary must report actual read failures and own every matching read.
Mocked invalidation promises alone cannot establish either behavior.
Use `invalidateAndReport` inside `settleRefreshes` for these saved-section handlers:
it retains ordinary all-read waiting, then reports newly recorded errors from the
matching queries. `invalidateTuteeViews` exposes this behavior through its scoped
`reportErrors` option; its other callers retain their existing error handling.

For academic conflict Reload, verify academic and policy read failures separately,
including cached error results and thrown reads. The original draft, version and
school year must survive a failed read. Discard it only after both required reads
succeed; keep the reload guard until both settle even when the first read fails.
Historical identity previews remain separate, dismissible reads; a failed link
requires a fresh preview and acknowledgment.

## Loading navigation choices

Keep static tab/filter choices usable while their content queries load. Use
`restoreReady` for a parser that needs a dynamic catalog, not a fixed enum such
as the Requests panels or invalidity filter. Query readiness still gates page
scroll restoration; authoritative denial still clears preferences and hides
content. Preferences remain scoped to the current identity and program period.
An accepted explicit choice made before live session verification has transient
provenance for that exact identity/path/scope key. Once verified, that choice wins
the older saved/default view; only then may storage be written. Key changes,
denial and catalog invalidation discard the provenance. This does not persist
drafts or authorize any content.
