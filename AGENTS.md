# Project UI guidelines

## Start with the shared patterns

Preserve the existing slate surfaces, white cards and accent themes. Before adding
or changing a UI workflow, read the [contributor guidance](docs/contributing.md#reuse-interaction-patterns)
and [component boundaries](docs/technical-report.md#shared-ui-patterns), then inspect
the real components in the development-only `/ui-gallery`. Gallery examples live in
`src/app/ui-gallery/gallery.tsx` and `src/app/ui-gallery/recipes.tsx`.

| Interaction | Reuse |
| --- | --- |
| Navigation / alternate content panels / selected filters | Links / `SectionTabs` / `ChoiceButton` inside `FilterToolbar` |
| One set of fields saved together | `FormSection`, `FormActions`, context-sized `Button` |
| Participant identity and academics | `PersonNameFields`, `FieldRequirement` and existing academic/grade controls |
| Short review / long editor / policy reader | `Modal` / `ProfileDialog` / `CurrentPolicyDialog`, all using `NativeDialog` |
| Brief records with detail entries | `SummaryTable`, `TableActions`, `TableAction`, `TableDetails` |
| Collapsible content | `DisclosureSection` with an explicit lifetime |
| Settings and reviewed changes | `SettingRow` and `ChangeReview` with feature-owned state |
| Initial query state / background recovery | `StatePanel` / `InlineNotice` alongside retained content |
| Public forms and history navigation | `PublicFormPage`, `PublicFormCard`, `PublicPageNavigation` |

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

## Participant tables

- Use Users & Roles as the design reference for the Tutee List: shared table spacing,
  identity typography and action sizing, with session counts and discipline standing added.
- Keep the authorized history, profile, discipline, contact and detail entries in
  the rightmost Actions column. Historical linking belongs inside Edit Profile.
  Do not add an action solely for visual symmetry, especially in read-only history.
  Use Grade & Class for compact academics; class means graduating class.
- Keep participant names free of added scenario labels. Historical grades and class years
  must use the original enrollment period, never the linked account's current grade.

## Signup field requirements

- Use `FieldRequirement` beside signup field names for translated Required/Optional
  text. Keep asterisks and parenthetical requirement markers out of field-name
  translations; use the same treatment for fixed, configurable and conditional fields.
- Match the existing validation rules and configured state. Hidden fields have no
  marker, and required tutor qualification questions still accept a negative answer.
- The student signup email label opens its guidance on hover, keyboard focus or
  click/tap. Keep the input's accessible name/description, dismiss on Escape or
  outside interaction, and preserve the 44 px mobile trigger target and row alignment.

## Control-height hierarchy

Choose control height by its place in the interface. Keep controls in the same
row visually aligned; primary versus secondary emphasis comes from color and
weight, not an arbitrary height difference.

| Level / location | Desktop height | Narrow screens / touch |
| --- | --- | --- |
| Global header: workspace-entry and return buttons, language selector | **32 px** (`2rem`) at `lg` and above; the language selector is the reference | **At least 44 px** (`2.75rem`) below `lg` |
| Page-level actions and standard single-line form controls | 36–40 px, consistent within each action/form row | At least 44 px for interactive targets |
| Section navigation, compact toolbar and table actions | 28–32 px, with one consistent size per row | At least 44 px for interactive targets |
| Non-interactive badges and metadata | 20–24 px or natural text height | Keep text readable; the 44 px target rule applies only if interactive |

- In this project, `lg` starts at 1024 CSS pixels. Check sizes with
  `getBoundingClientRect()` in the running application, not just class names.
- Use the shared compact size for all controls in a filter toolbar, including
  Refresh and native selects. Native `.input` padding/min-height can override
  `control-compact`; the approval queue uses `lg:min-h-8 lg:py-1` to retain its
  32 px baseline. Measure the result and preserve at least 44 px below `lg`.
- Header text buttons must match the language selector's rendered height.
  `WorkspaceLinks` uses `min-h-11 lg:min-h-8 lg:py-0`; the compact desktop
  `LanguageSwitcher` uses `h-11 lg:h-8`.
- Header identity text stays vertically centered. Avatar and icon artwork may
  be smaller than their hit area; do not enlarge artwork to fill a touch target.
- Let groups wrap on narrow screens. Long translations or enlarged text may
  grow beyond the baseline height to avoid clipping; never hide text or reduce
  accessibility just to force a fixed height.
- When changing shared header sizing, verify management, tutor and tutee pages
  on the complete running site at desktop and mobile widths. Capture screenshots
  and compare the entry/return button heights with the language selector. Keep
  browser/server work serial and stop temporary processes after verification.

## Mobile header hierarchy

- Use a prominent brand (20 px on mobile) and the language selector on the top row.
- Put the management hamburger menu at the far left of the second row; align theme,
  notifications and account controls to its right. Give the icon an accessible name.
- Keep workspace entry/return links together on a third row, separated with a subtle
  top border and space. Let long translated labels wrap without clipping.
- Preserve 44 px mobile touch targets. Make the header spacious and the rows clear
  rather than shrinking interactive controls to obtain a shorter header.
- At desktop widths retain a single compact row, 18 px branding, and 32 px workspace
  buttons/language selector. Keep only one instance of each interactive control.

## Table summaries and detail submenus

- Use one table language throughout the application: columns contain brief names,
  dates, counts and statuses. Long explanations, contact details, full lists and
  editing forms belong in detail dialogs or editors.
- Put every row's detail/editor entry in the **rightmost Actions column**, using
  text links visually (semantic buttons when opening a dialog). Follow Users & Roles.
  Do not place boxed detail buttons below names or reveal controls in other cells.
- Compose `SummaryTable`, `TableActions`, `TableAction` and `TableDetails` from
  `src/app/_components/ui/summary-table.tsx`. Existing domain dialogs may use the same
  text-action class; their authorization and confirmation rules remain authoritative.
- Keep stacked text actions compact, as established in PR #172: **28 px minimum
  on desktop, 44 px below `lg`, and no added gap between links**. Let wrapped or
  enlarged labels grow naturally; the hit targets provide their own spacing.
- Keep trailing actions reachable on narrow screens while the table scrolls locally.
  Preserve 44 px mobile hit targets, clear focus, brief column values and full detail
  access. Do not hide actions outside the viewport or replace them with hover-only UI.
- Comparison matrices follow the same rule: compact cell values, full explanations
  behind a rightmost row-detail link. Preserve full exports and printed report data.
- Mount detail queries on demand. Verify summary, open-detail, editing, read-only,
  keyboard and translated states in the gallery and actual affected pages.

## Verification and handoff

- Follow the [UI verification matrix](docs/local-development.md#ui-verification-matrix)
  on the affected real pages as well as the gallery. Use actual desktop/mobile
  viewports, English/Chinese, long labels, keyboard navigation and role restrictions.
- Keep browser/server work serial and tests bounded. Stop only processes you own;
  inspect shared dependency junctions and database ownership before cache cleanup.
- Document which commit, cases and measurements were checked. Distinguish full-suite
  results from focused reruns, and gallery layout checks from contrast measurements.
- Keep human guidance in the existing `docs/` guides and local HTML/screenshot
  evidence in ignored `outputs/` or `.validation/`. Track new proposals through the
  [issue conventions](docs/issues.md), link PRs to their issues, and keep broader
  migration trackers open when only part of their scope is delivered.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
