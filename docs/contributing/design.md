# Design conventions

Use these conventions for new UI work and changes to existing pages. They describe
the accepted presentation rules. [Interaction patterns](interaction-patterns.md)
own state and save behavior; [technical reference](../reference/technical-report.md#architecture)
describes the implemented system.

## Foundations

Use slate surfaces, white cards and the existing Geist font stack. Brand choices
use `accent-*` utilities backed by the six palettes in
[global styles](../../src/styles/globals.css) and [theme configuration](../../src/lib/theme.ts).
Keep semantic error, warning and success colors independent of the selected accent.
Reuse existing utilities and components before adding tokens.

Use the neutral gray `badge-slate` treatment for Edited metadata, including
translation overrides. Edit history is informational; warning/review states retain
their existing semantic colors.

### Accessible controls

Give form controls persistent visible labels, using `htmlFor`/`id` or a wrapping
label, and associate helper/error text with `aria-describedby`. A placeholder does
not replace a label. Disclosure buttons expose `aria-expanded` and identify their
controlled region; follow the [disclosure lifetime rules](interaction-patterns.md#drafts-pending-writes-and-nested-dialogs).
Measure the interactive target separately from its artwork against the
[control-height hierarchy](#control-height-hierarchy), including 44 px narrow-screen
targets. Normal-size text needs at least 4.5:1 contrast against its actual rendered
background, including muted metadata, inactive records and zero values. Check the
painted leaf rather than assuming a parent color applies. Enabled placeholders
need the same text contrast: at least 4.5:1 at normal size, or 3:1 for regular text
24 px and larger. Check the actual control background, including purpose tints.
Translate every rendered enum/status value in every bundled catalog, including
hidden languages; follow the
[catalog checks](verification.md#required-checks) and verify the displayed states.

## Compose a page by its purpose

Choose a frame for the task before adjusting individual cards. These are composition
roles using existing utilities, not new CSS tokens or a requirement to resize every
page. Preserve the slate background, white `.card` surfaces, existing font family
and accent themes. Use semantic warning/error/success treatments for outcomes;
changing the user's accent must not change what an outcome means.

| Role                  | Frame and current reference                                                                                                                           | Composition rule                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Management workspace  | `max-w-7xl` (1280 px), [admin layout](<../../src/app/(admin)/layout.tsx>)                                                                             | This outer frame includes navigation and its gap; it is not a 1280 px editor. Keep the shared content edge and local table scrolling. |
| Participant workspace | `max-w-6xl` (1152 px), [student layout](../../src/app/student/layout.tsx) and [tutor dashboard](<../../src/app/(tutor)/dashboard/page.tsx>)           | Allow schedule, roster and overview content to use the workspace. Do not shrink it to a reading column.                               |
| Standalone workflow   | `max-w-5xl` (1024 px), [WorkflowShell](../../src/app/_components/workflow-shell.tsx)                                                                  | Use for a broad task outside the main workspace; keep explicit return context and the existing header contract.                       |
| Reader or long form   | `max-w-3xl` (768 px), [handbook](<../../src/app/(tutor)/handbook/page.tsx>) and wide [PublicFormPage](../../src/app/_components/public-form-page.tsx) | Favor readable lines and one clear save scope. A feature may use a narrower frame when its fields warrant it.                         |
| Compact public form   | `max-w-lg` (512 px), default `PublicFormPage`                                                                                                         | Center the outer frame and its short introduction; keep fields and labels left-aligned through `PublicFormCard`.                      |

Pixel values describe maximum widths at the default root font size, not fixed
viewport widths. Keep responsive gutters and let enlarged text grow. Center an
outer reader/form frame when useful; align its fields, notices and actions to one
content edge. Do not center table data or form labels merely to make unlike pages
look identical. Embedded sections inherit the host's width and heading hierarchy.

Use a small spacing vocabulary: 4–8 px between a label and its helper, 12–16 px
between related controls, and 24–32 px between independent page sections. Prefer
16 px narrow / 20 px wider padding (`p-4 sm:p-5`) for compact workspace cards;
independent settings forms may use 20/24 px (`p-5 sm:p-6`). Match adjacent cards
with the same purpose before changing unrelated surfaces. The existing
`PublicFormCard` deliberately uses a roomier 24/32 px (`p-6 sm:p-8`) composition.
A proposed denser 20/24 px public long-form variant needs an explicit shared
contract and real-page verification; it is not an existing prop or a reason for
per-caller padding overrides. Follow the [control-height hierarchy](#control-height-hierarchy)
and [table-summary rules](#table-summaries-and-detail-submenus) for
interactive spacing rather than deriving target sizes from these content gaps.

Keep one page H1. Use the existing `.page-title` (24 px) and `.section-title`
(18 px) for workspace hierarchy; body/form text is normally 14–16 px and secondary
metadata 12–14 px. Public entry pages intentionally use a larger 30 px title.
Preserve semantic heading order independently of font size. Do not add a heading
to every wrapper or repeat the active tab name as an otherwise empty section title.
Essential evidence and instructions must remain readable; do not fade an entire
historical record or truncate the text needed to make a decision.

`InlineNotice` gives guidance a flexible 16rem basis so recovery moves below it
when their combined widths do not fit. This follows the notice's available width,
including narrow cards in a desktop workspace. Its action slot bounds buttons,
links and wrapping groups and lets long labels wrap locally at every breakpoint;
keep a caller's nested action groups wrapping. A short message may also stack
when the remaining space is below that basis. Preserve control targets and full
labels rather than truncating recovery or changing global button styles.

Start a page with its task title and only the context needed to act, followed by
local navigation/filters and the working content. Use specific section names such
as “Availability” or “Email addresses” instead of generic “Management” or “Details”
headings that convey no context. Keep descriptions only when they explain a
consequence, eligibility, save boundary or recovery step. Place field guidance by
its labelled control and decision evidence beside its action. Preserve permission,
consent and historical-ownership explanations even when they require more text.
Use existing schedule/request data when prioritizing work; layout changes alone
must not introduce a new computed next-session feature or domain rule.

Render recurring weekday labels with `formatWeekday(dayOfWeek, locale)` using the
active `next-intl` locale, including availability group names exposed to assistive
technology. Keep stored ISO weekday numbers, group order, slot IDs and minute
values unchanged; translated labels must not change Save or schedule-review payloads.

## Align controls to their visual row

Choose the alignment reference before choosing flex or grid alignment. A labelled
field contains three different regions: label, interactive control and optional
guidance. A sibling badge, checkbox or action belongs at the vertical center of
the **control box**, not the center or bottom of all three regions. Put guidance
in its own grid row and associate it with the field using `aria-describedby`.
Announcement badges align with the title input; assignment labels and actions
align with the tutor selector; report checkboxes align with the adjacent selects.
Do not use ad hoc top margins that depend on English labels being one line.

A summary card has a different reference: center its action group against the
whole summary, including its secondary line. Within a participant heading,
center badges on the name line. Wrapped metadata starts at the name's content
edge, after the reserved disclosure space. Keep action typography consistent even
when one action navigates and another opens a dialog. Use a shared minimum row
height for lists containing both buttons and non-interactive badges; badges need
not grow to fill the row. Translated or enlarged text may grow beyond that minimum.

## Keep summaries compact and editing explicit

Show each subject as a brief row with its name, level badge, qualification and
willingness. Do not repeat a Qualification heading beside a Qualified badge.
Order qualified and willing subjects first, qualified and unwilling next, then
qualified subjects whose willingness is not recorded, then unqualified subjects
(preserving catalog order within each group). Unknown willingness is a distinct
state, not an inferred No. Put editing behind a rightmost Edit action.

Use one compact warning for an academic value needing review rather than an
unknown-value sentence followed by the same review instruction. Put full reasons,
self-excused absences, comments, evaluations and recorded service hours in named
detail readers. Attendance abbreviations (`P`, `EA`, `UA`) require a visible
legend and accessible expanded column names. Keep all columns and trailing actions
reachable on narrow screens; avoid side-by-side tables that compress either table
below its useful width.

In a record action group, place ordinary text links first, boxed decision buttons
next, and Delete last (for example, `Set Up Account` before `Flag invalid` and
other decision buttons). Keep DOM and keyboard order aligned when wrapped on
narrow screens.

Delete and Decline labels are red at rest, including when boxed — assign
destructive styling explicitly in the owning component rather than matching
translated text. Keep in-table actions unboxed at rest and on hover (no border or
filled hover surface), using a 3 px underline with a 4 px offset for keyboard
focus so it stays distinct from hover underline without adding a box on mouse
focus. Boxed consequential buttons keep their boundary and red rest label;
confirmation, approval, authorization and pending-dismissal rules stay with the
owning feature.

## Room and participant composition

Tutor pairing cards render both single-assignment groups and combined groups in one unified layout: subject heading (with leading combine selection checkboxes revealed only when Combine groups is active — dynamically greying out incompatible cards and auto-selecting required companion cards to preserve complete student × subject coverage — a combined badge for multi-assignment groups, and dated-session navigation ahead of the split action in the card header), split 50/50 on wider screens with shared schedule/room facts and a compact default slot selector on the left and distinct students listed one per row on the right (stacking on narrow screens). Show a single shared subject once; retain each student’s subject associations for mixed-subject groups, with direct per-assignment Details entries. Dashboard hour
summaries separate the reporting period, primary total and wrapping breakdown;
Crew credit remains distinct from tutoring credit. Align the hours labels, period,
totals and wrapping breakdown to the right edge of their header summary cards.
Use a bold 36 px total with the hour unit in the same size, weight and color,
14 px breakdown text, and compact 12 px uppercase headings. This preserves the
legacy summary's readable numeric emphasis within the current card composition.
These feature-local compositions do not change scheduling, room intent,
calculation or save ownership.

Keep a confirmed room name and its allocation-status badge inline, with the badge
immediately after the name and natural wrapping for long names or narrow screens.
Use `RoomAllocationStatus` across tutor summaries, tutee weekly arrangements and
management details; an unscheduled room selection still displays only its awaiting
status and must not imply a reservation.

Put room Move up and Move down controls in the existing room rows, beside the
other row actions. Do not introduce a separate ordering menu or duplicate room
list. Preserve the existing complete-order review/save boundary, expected version,
permissions and the distinction between room display order, patrol order and
booking conflicts. Disabled endpoint and pending states retain their current
meaning; moving a row must not save unrelated room-detail drafts.

For each tutee, put existing availability and existing Reject/relay actions inside
that participant's Details. Keep their current access rules, conditions, payloads,
confirmation and refresh behavior. The outer list stays concise, while Details
provides the existing information and actions together. Layout changes do not authorize changes to mutual-time ranking, interview
scheduling or their feature-owned rules. Check the current implementation before
proposing new behavior.

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

| Level / location                                                     | Desktop height                                                               | Narrow screens / touch                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Global header: workspace-entry and return buttons, language selector | **32 px** (`2rem`) at `lg` and above; the language selector is the reference | **At least 44 px** (`2.75rem`) below `lg`                             |
| Page-level actions and standard single-line form controls            | 36–40 px, consistent within each action/form row                             | At least 44 px for interactive targets                                |
| Section navigation and compact toolbar                               | 28–32 px, with one consistent size per row                                   | At least 44 px for interactive targets                                |
| Stacked table text actions                                           | 24 px minimum, with no added gap                                             | At least 44 px for interactive targets                                |
| Non-interactive badges and metadata                                  | 20–24 px or natural text height                                              | Keep text readable; the 44 px target rule applies only if interactive |

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
- When changing shared header sizing, verify management, tutor and tutee pages at
  desktop and mobile widths against the language selector's rendered height.

## Selectors and dropdown menus

Keep native `<select>` elements across single-value forms, dialogs and filter toolbars
so keyboard navigation, screen-reader announcements and OS mobile pickers stay intact.

- **Single-value `.select`:** Always give `<select>` controls the `.select` class
  (never `.input`). In [global styles](../../src/styles/globals.css), single-value
  `.select` controls (`:not([multiple]):not([size])` and `[size="1"]`) use
  `appearance-none`, a 14 px `slate-500` SVG chevron (4.76:1 contrast on white),
  and logical inline padding (`ps-3 pe-8`, chevron `0.625rem` from the trailing edge)
  so long translated option labels never collide with the indicator.
- **Compact & inline selects:** Pair `.select.control-compact` with `field-auto`
  (or `field-auto-bounded` with `[--field-min-width:...]` in wrapping forms) for
  headers, filter toolbars and inline row selectors. `.select.control-compact` tightens
  padding to `ps-2.5 pe-7` with the chevron `0.5rem` from the trailing edge while
  preserving 44 px narrow-screen targets and a 32 px desktop baseline. Full-width form
  selects keep `w-full` and standard `ps-3 pe-8` padding.
- **Multi-select listboxes (avoid raw `<select multiple>`):** Do not use native
  `<select multiple>` (ambiguous `Ctrl`/`Cmd`-click gestures, unfocused gray row bars
  and cramped touch targets). Use `CheckboxListbox`
  (`src/app/_components/ui/checkbox-listbox.tsx`) for multi-select forms, `ChoiceButton`
  groups for small 2–6 option filter toggles, and `MultiFilter` when explicit
  Include/Exclude filtering is needed. For long option sets (8+ items), `CheckboxListbox`
  keeps a bounded scroll container (`max-h-60`) with sticky group headers, local search
  filtering that preserves hidden selections, a `Selected only` view, and a capped
  removable summary strip (`+N more`) so very long lists stay scannable and never expand
  the page unboundedly.
- **States and accessibility exceptions:** Disabled selects use a quiet `slate-50`
  surface with readable `slate-500` text and `cursor-not-allowed`; invalid selects
  (`aria-invalid="true"`) show semantic red borders and focus rings; `:dir(rtl)` flips
  the chevron to the left edge; and `@media (forced-colors: active)` restores the native
  OS indicator.
- **Floating menus vs. inline disclosures:** Floating header/picker menus (`HeaderMenu`,
  `UserAvatar`, `ThemeSwitcher`, `NotificationBell` and workspace switchers) share the
  sculpted `.popover-surface` card (`rounded-xl border border-slate-200/90 bg-white
  shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/5`) and rotating `ChevronDownIcon`
  triggers with `DetailsAutoClose` or Escape/outside-click handling. Keep in-flow
  collapsible sections (`DisclosureSection` / `DisclosureIcon`) visually distinct from
  floating menus.

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

`WorkspaceHeaderFrame` measures the rendered header for native document scroll
padding, including translated wrapping and enlarged text. After ordinary focus
scrolling, it reveals a covered control through its actual vertical scroll owner
without focusing it again. Management's desktop content pane already starts below
the header; do not add the header height to that pane's inset. Preserve visible
large tabpanels, header utilities and dialog-owned scrolling/focus. Verify native
Tab and Shift+Tab through date controls as well as ordinary links and fields.

## Table summaries and detail submenus

- Use one table language throughout the application: columns contain brief names,
  dates, counts and statuses. Long explanations, contact details, full lists and
  editing forms belong in detail dialogs or editors.
- Put every row's detail/editor entry in the **rightmost Actions column**, using
  text links visually (semantic buttons when opening a dialog). Follow Users & Roles.
  Do not place boxed detail buttons below names or reveal controls in other cells.
- Bulk-selection checkboxes are a deliberate exception: use a leading selection
  column, while detail/editor entries remain at the right. Preserve selected IDs
  through filtering and follow the signup catalog's default subject order.
- Compose `SummaryTable`, `TableActions`, `TableAction` and `TableDetails` from
  `src/app/_components/ui/summary-table.tsx`. Existing domain dialogs may use the same
  text-action class; their authorization and confirmation rules remain authoritative.
- Keep stacked text actions compact: **24 px minimum
  on desktop, 44 px below `lg`, and no added gap between links**. Let wrapped or
  enlarged labels grow naturally; the hit targets provide their own spacing.
- Keep trailing actions reachable on narrow screens while the table scrolls locally.
  Preserve 44 px mobile hit targets, clear focus, brief column values and full detail
  access. Do not hide actions outside the viewport or replace them with hover-only UI.
- Comparison matrices follow the same rule: compact cell values, full explanations
  behind a rightmost row-detail link. Preserve full exports and printed report data.
- Mount detail queries on demand. Verify summary, open-detail, editing, read-only,
  keyboard and translated states in the gallery and actual affected pages.

## Name field wording and layout

Use **Name in Another Language** instead of **Alternate Name in another Language**. “Alternate” adds length without explaining what to enter. “Another language or writing system” in the help text covers both a translated name and the same name written in another script.

Keep **First Name** and **Last Name** as familiar field labels. Their help text explains given and family names without assuming that every culture writes them in that order. Use **Preferred Name** for the name someone wants to be called; keep username suggestions separate.

Use **Latin letters**, rather than **English name**, **English letters** or **A–Z only**. Accented names such as José, Zoë and Chloé are valid. State the rule in help text; “Force Latin” describes an implementation setting rather than a useful instruction to a person completing the form.

### Errors and layout

When every name field is Hidden, the self-profile shows a read-only explanation instead of an empty editor with Save/Cancel. Other profile, academic and account actions remain available under their own permissions. Public intake omits Latin-name guidance when no Latin name field is visible. A loading or failed policy read never substitutes default requirements; retained drafts remain blocked until current requirements are available.

- Required first name: **Enter your first name.**
- Invalid Latin field: **Use Latin letters, including accents such as é. Spaces, apostrophes and hyphens are allowed.**
- Keep errors next to the field and connect them with `aria-describedby`.
- Put First Name and Last Name beside each other when space permits; stack them on narrow screens.
- Put Preferred Name and Name in Another Language on separate full-width rows.
- Display Required/Optional beside the label using the existing requirement treatment.
- Keep controls at least 44 px tall on touch layouts. Preserve visible keyboard focus and support long translations.
- Place a live participant-name example below the two display switches.

## Invitation and verification code presentation

Invitation codes and emailed verification challenges have separate
[generation, display and compatibility contracts](../reference/technical-report.md#opaque-invitation-codes).
Use the shared purpose-specific code field/display for site entry and receipts;
email callers declare `presentation.codePurpose` and provide matching single-language
plaintext instructions. Select maintained English/Chinese copy before composition;
never split assembled bilingual prose or remove characters heuristically. New invitations mix letters and numbers in five characters;
emailed challenges contain four digits, preserving leading zeros. Keep the legacy
single wide site input, gray `XXXXX`/`XXXX` placeholders and neutral text/borders;
change only the box background to green for invitations or blue for verification.
Display labels use neutral `slate-600` text to meet normal-text contrast on both
purpose backgrounds; retain the same readable label treatment for each purpose.
Email keeps the legacy single code panel's layout, typography and border, with dark
green (`#18342C`) or blue (`#172F49`) backgrounds and no added label/guidance wrapper.
Never infer authorization from presentation metadata. See
[verification](verification.md#ui-verification-matrix) for code-field and email
testing requirements.

## Writing UI copy

Keep visible interface copy brief, task-oriented and written for high-school participants and student officers rather than engineers. Treat every word, badge and persistent banner as interface chrome that competes with the user's primary task.

1. **Describe the user's outcome, not the implementation.** Omit optimistic-locking versions, draft/snapshot internals, idempotent retry deduplication, SMTP transport handoffs, database keys and audit actors from everyday UI copy.
2. **State what happens rather than listing everything that does not.** Keep a negative caveat only when a person would otherwise reasonably worry about data loss or an irreversible side effect.
3. **Keep inline guidance short (1–2 sentences) and use progressive disclosure.** Put secondary historical rules, edge-case specifications or archival footnotes inside a collapsed disclosure (`<details>` / `DisclosureSection`) or tooltip so primary workflows stay scannable.
4. **Avoid redundant chrome and leaked internal IDs.** Do not repeat a page-level notice as a badge on every standard card when only exceptions differ (for example, `MessageInbox` keeps the supervision notice at the top and marks only legacy participant-only messages). Show technical disambiguators such as database record IDs in participant tables only when visible names collide, while keeping accessible labels and detail dialogs complete.
5. **Put prerequisite inputs before the gated actions they explain.** When a field unlocks or authorizes adjacent buttons (such as `Current password` gating `Make primary` and `Remove` in `AccountEmails`), place the prerequisite field above the controls it governs so disabled states explain themselves immediately.
6. **Make recovery copy actionable.** State what happened and the next step (for example, `"Saved, but the page could not refresh. Try refreshing."`) instead of explaining how read-only retries avoid replaying writes.
7. **Keep labels audience-appropriate and free of manual requirement markers.** Never reuse staff-prefixed titles on participant actions, keep shared participant copy role-neutral when both tutors and tutees read it, and never embed `*` or `(optional)` inside translation strings—render `FieldRequirement` beside the label.
8. **Follow one English/Chinese glossary and register.** Use **tutor** / **tutee** (`辅导伙伴` / `学习伙伴`) per [implementation wording](implementation.md#english-peer-tutoring-wording), Title Case **Head** (`负责人`, never raw `HEAD` or `Admin` in Chinese prose), **巡查队** / **巡查成员** / **巡查** for Crew, **服务时数** for service hours, **账号** (not `账户`), **加载** (not `载入`), and peer-friendly **你** (not `您`) consistently across Chinese UI catalogs.

## Evolving the conventions

Before adding or changing a design rule, inspect the current component, gallery
example and real caller. State the problem, affected audiences, alternatives and
tradeoffs in an [issue](issues.md); resolve any product or permission decision
before implementing it. A proposal is not an available prop, token or approved
workflow. Keep unimplemented ideas in issues and PRs, explicitly marked as proposed.

Once a rule is implemented and verified, update this guide and the relevant
interaction recipe. Update reference documentation only for behavior that exists,
and user guides only for actions their audience can perform. Do not add a global
registry, generator, new layout API or eligibility calculation solely for visual
consistency. Extract shared behavior when real callers share its contract,
lifetime and failure semantics.
