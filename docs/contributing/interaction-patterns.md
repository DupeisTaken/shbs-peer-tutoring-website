# Interaction patterns

Choose an interaction after identifying its save boundary, read lifetime and
authorized audience. Use [design conventions](design.md) for visual rules and
[implementation](implementation.md#add-an-action-or-feature) for the extension
recipe.

## Start with the shared patterns

Preserve slate surfaces, white cards and accent themes. Before adding or changing
a workflow, check [component boundaries](../reference/technical-report.md#shared-ui-patterns)
and inspect the real components in `/ui-gallery` (`src/app/ui-gallery/gallery.tsx`
and `src/app/ui-gallery/recipes.tsx`).

| Interaction                                              | Reuse                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Navigation / alternate content panels / selected filters | Links / `SectionTabs` / `ChoiceButton` inside `FilterToolbar`                                                       |
| One set of fields saved together                         | `FormSection`, `FormActions`, context-sized `Button`                                                                |
| Participant identity and academics                       | `ConfiguredPersonNameFields` (built on `PersonNameFields`), `FieldRequirement` and existing academic/grade controls |
| Short review / long editor / policy reader               | `Modal` / `ProfileDialog` / `CurrentPolicyDialog`, all using `NativeDialog`                                         |
| Brief records with detail entries                        | `SummaryTable`, `TableActions`, `TableAction`, `TableDetails`                                                       |
| Collapsible content                                      | `DisclosureSection` with an explicit lifetime (`lazy`, `retained`, or `mounted`)                                    |
| Settings and reviewed changes                            | `SettingRow` and `ChangeReview` with feature-owned state                                                            |
| Initial query state / background recovery                | `StatePanel` / `QueryFeedback` / `InlineNotice` alongside retained content; `formatClientError`; `RouteError` / `GlobalError` |
| Header branding, skip navigation and public forms        | `BrandMark`, `.skip-link`, `PublicHeader` / `WorkspaceHeader`, `PublicFormPage`, `PublicFormCard`, `PublicPageNavigation` |

Extend a shared component only when its contract fits every caller; otherwise
compose existing components. Add a gallery example and behavior tests for any new
reusable pattern. Presentation must never alter server permissions, confirmation
tickets, approval rules, immutable evidence, query access or version ownership.

## Reuse interaction patterns

- **Selections vs. actions:** A selected `ChoiceButton` or filter is not a submitted
  write. Place `FormSection` Save/Cancel buttons after all affected fields, and put
  prerequisite verification inputs (such as `Current password` in `AccountEmails`)
  above the controls they unlock so disabled states explain themselves immediately.
- **Pagination:** Use the shared `Pager` from `student-portal.tsx` for participant
  and message lists. Give separate lists distinct translated labels, preserve each
  list's page/filter state, and use its `more` signal — never invent a total count.
- **Sortable tables:** Opt into `<SummaryTable sortable>` for information tables so
  each header cycles ascending → descending → incoming order. Use `data-sort-value`
  for domain values (numeric hours, schedules, component-rendered names) and
  `data-sortable={false}` for selection headers. Keep logs, submissions, historical
  reports and server-paginated tables unsortable.
- **Table details and long readers:** Only explicit `TableActions` cells become
  sticky; read-only history tables may omit actions. Never mount private query or
  mutation children for observers. For tall readers (such as room grids or original
  Crew text), use `TableDetails longReader`, which composes `ProfileDialog` with a
  sticky Close header above the scrolling body stacking context so nested sticky
  action cells never paint over the header.
- **Query feedback:** `QueryFeedback` composes `StatePanel` (initial load/empty/error/denied)
  with a background `InlineNotice` and read-only Retry. `hasData` means a completed
  response exists (including an empty array). Denied access must never show as an
  indefinite loader.
- **Review revocation:** When a `useActionReview` displays private evidence and
  authoritative access is revoked, conceal it immediately and call `revoke()` while
  preserving accepted keys and pending writes.
- **Screen-reader labels in bounded scrollers:** Keep `sr-only` labels inside a
  positioned form boundary (such as recruitment fieldsets) so a clipped 1 px label
  cannot enlarge the document scroll range.

## Drafts, pending writes and nested dialogs

- **Independent forms and pending leases:** Each independent form owns its draft
  and version snapshot. Register its pending write with `useDialogPending(ownPending)`
  and use the aggregate return value to disable siblings — never pass that aggregate
  back into registration or busy state can latch. Guard same-tick double submits.
- **Draft preservation and conflicts:** Keep drafts and cached content mounted on
  failed saves and background refreshes. A conflict Retry must not silently adopt a
  new expected version; explicit Reload replaces a draft only after a successful fetch.
- **Retained owners vs. write admission:** Ordinary read failures may keep an
  authorized identity's settings drafts (including hidden panels) while blocking
  dependent writes in submit handlers, callbacks and disabled controls. Identity/rank
  replacement, read-only access or authoritative denial must still unmount private
  owners without transferring old drafts.
- **Accepted write vs. failed refresh:** Treat a committed write whose refresh fails
  differently from a rejected write. Recover with read-only refresh (`Retry refresh`),
  never by replaying the mutation.
- **Dialog isolation:** Give each target/opening its own password, draft and review
  snapshot so late reads from a closed dialog cannot populate its replacement. Keep
  pending-write admission and accepted receipts in the list/route owner so row
  removal cannot admit another write or drop recovery.
- **Authoritative denial:** Conceal private evidence immediately on denial and latch
  it through transport errors and query-key changes until fresh authorized reads
  succeed (evicting cached data on denial).
- **Nested dialogs and focus:** Nested review owns Escape and restores the exact
  opener if usable, otherwise the parent dialog. Top-level owners whose opener may
  disappear can supply `returnFocusFallback` on `ReviewedAction` or `Modal` (never
  stealing focus from an outside control or guessing page-wide targets). Pending
  writes block parent dismissal until settled.
- **Disclosure lifetimes:** Choose `lazy` for disposable read details, `retained`
  for drafts mounted on first open, and `mounted` for forms required from the start.

## Reuse configured identity fields

Production intake and profile forms use
[ConfiguredPersonNameFields](../../src/app/_components/person-name-fields.tsx)
(built on `PersonNameFields`). Pass `accountType` for new intake, or `profileTarget`
for an existing profile so `program.nameFieldsForProfile` resolves the account's
current role (never union Tutor, Crew and Tutee memberships). Use `management` only
inside an authorized staff editor to reveal retained Hidden originals.

Tie form submission to `onPolicyAvailabilityChange`: missing or failed policy reads
must never fall back to default requirements. Cached configured fields and drafts
stay mounted but disabled during read recovery. Hidden fields show no requirement
markers and participant edits preserve stored originals; an all-hidden policy is
valid and an unsplit legacy label must not expose hidden parts. Server validation
and username fallback stay in [name-fields.ts](../../src/server/program/name-fields.ts);
see [name-field reference](../reference/name-fields.md).

## Keep settings and navigation predictable

- **Management sidebar:** **Overview** holds daily queues/rosters; **Administration**
  holds program settings, signup forms, landing/policies/translations, codes,
  approvals, users and PDF handbook distribution; **Data & Recovery** groups archival,
  audit and recovery tools (**Program Records**, **Academic Corrections**, **Audit Log**,
  **Admission Recovery**, **Database Records**). **Help Center** (`/help`) lives in the
  top bar (workspace switcher and `?` icon) and landing footer rather than the Overview
  sidebar. Grouping never changes route permissions or approval policy.
- **Program Settings tabs:** **Recruitment and Refresh**, **Account Settings**,
  **Deployment Configurations**, and **Optional Features**. Grouping never combines
  independent save operations or broadens authorization.
- **Invalidity filters:** Default to **Active** (not marked invalid), followed by
  **Invalid** and **All**.
- **Blur-save groups and file pickers:** Place one shared save-boundary explanation
  above blur-save fields (linked via `aria-describedby`), and keep compact file
  pickers with the selected filename beside them.

### Session view state, denial latches and scroll restoration

Temporary navigation may restore the active tab, filters, pagination and scroll
within one browser session — never form drafts, passwords, private text or
authorization results. Explicit URL/hash destinations, user gestures and access
changes always win.

- **`useSessionViewState({ id, initialState, parse, scope, enabled, restoreReady })`**
  (`src/app/_components/session-view-state.tsx`): Give each view a stable `id`,
  include period/validated query context in `scope`, and allowlist valid values via
  `viewEnum`, `viewPage`, `viewSearch`, `viewIdentifier` (160-char ID bound) and
  `viewFields`. The optional third tuple entry `reconcileValue(next)` reconciles
  guarded in-component arrivals (e.g., authorized notification links). Writes occur
  after commit within a 4 KiB UTF-8 entry / 160-char scalar storage bound (longer
  valid searches stay usable in memory and clear stale saved entries). Set
  `restoreReady: query.data !== undefined` for dynamic catalogs and `enabled: false`
  on authoritative denial or disabled modules (not ordinary loading). Apply-only
  filters save committed criteria, not unfinished inputs; full-message supervision
  searches/selections stay transient.
- **`useSessionAccessDenied(...ownedQueries)`:** Latches authoritative access
  denial across subsequent transport failures until owned reads succeed again. Pass
  a stable `{ ...query, denialKey, queryKey: trpcQueryKey(...) }` so denial recovery
  tracks monotonic `QueryClient` read receipts (`installSessionReadReceipts`) rather
  than wall-clock timestamps — backward clock skew, equal timestamps, older cached
  default scopes, local `setQueryData` writes, and pre-denial in-flight fetches
  cannot release an active denial latch, while a genuine fresh read recovers cleanly.
  The helper never grants permission or replaces server checks.
- **`useSessionPageScroll({ id, scope, ready, enabled })` / `SessionPagePosition`:**
  Register once per authorized page. Restores `#admin-content` at `lg` (`>=1024 px`)
  for management and the document otherwise; excludes dialogs, tables and sidebars;
  stops delayed content recovery after 5 seconds or immediately on user gesture/hash.
- **Notification arrivals:** Use `useNotificationRecordReveal` per the
  [record navigation contract](../reference/technical-report.md#notification-record-navigation);
  fragments never authorize hidden queries or overwrite drafts.

## Retain local work while changing panels

- Group long settings workspaces with `SectionTabs` instead of inventing a combined
  Save. Retain mounted form owners when hidden while removing hidden controls from
  keyboard/accessibility trees; keep active reviews, accepted keys and refresh
  recovery outside hideable panels.
- Put creation forms behind one title-row action (`ProfileDialog` with draft state
  above its visibility toggle) when an always-open form pushes records down, giving
  creation and row editing independent drafts.
- Search only authorized records in the current scope using `matchesPersonSearch`,
  applying search before sorting and preserving other filters when cleared. In
  explicit-ID pickers, filtering hides candidates without clearing selection; keep a
  visible selected summary.
- Keep top and footer Save buttons wired to the same admission guard, pending state
  and payload; do not add autosave or global draft storage.

## Profile editor completion

Completing one section in a profile editor must not dismiss another section's
failed draft. Profile and username saves therefore keep the editor open for explicit
Close:

1. After Save, the saved section automatically fetches fresh server state (even if
   cached) and adopts only its own fields and expected version before unlocking.
   Sibling sections keep their drafts, versions and focus.
2. If that refresh fails or the record is missing, the saved section stays locked
   with **Retry refresh** outside its disabled fieldset — running reads only and
   never replaying the mutation. Idle Close remains allowed.
3. Wrap multi-query refresh handlers in `settleRefreshes` and `invalidateAndReport`
   (or `invalidateTuteeViews` with `reportErrors`) so every matching active query
   variant settles before reporting errors or releasing dismissal/submission guards.
4. For academic conflict Reload, discard the original draft, version and school year
   only after both academic and policy reads succeed. Historical identity previews
   stay separate, dismissible reads; a failed link requires a fresh preview and
   acknowledgment.

## Loading navigation choices

Keep static tab and filter controls usable while content queries load; reserve
`restoreReady` for dynamic catalogs. An explicit choice made before live session
verification carries transient provenance for that exact identity/path/scope key
and wins over older saved defaults once verified (writing storage only then). Key
changes, denial and catalog invalidation discard that provenance.
