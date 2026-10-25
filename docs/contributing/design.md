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

### Accessible controls

Give form controls persistent visible labels, using `htmlFor`/`id` or a wrapping
label, and associate helper/error text with `aria-describedby`. A placeholder does
not replace a label. Disclosure buttons expose `aria-expanded` and identify their
controlled region; follow the [disclosure lifetime rules](interaction-patterns.md#drafts-pending-writes-and-nested-dialogs).
Measure the interactive target separately from its artwork against the
[control-height hierarchy](#control-height-hierarchy), including 44 px narrow-screen
targets. Normal-size text needs at least 4.5:1 contrast against its actual rendered
background, including muted metadata, inactive records and zero values. Check the
painted leaf rather than assuming a parent color applies. Translate every rendered
enum/status value in every bundled catalog, including hidden languages; follow the
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
values unchanged. A translated label must not change an availability Save or
schedule-review request payload.
Use a feature-specific final action label in the meeting absence-reason editor
(“Submit absence excuse”), while preserving its cutoff, reason and request rules.

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
qualified subjects whose willingness is not recorded, then unqualified subjects.
Keep the current catalog order within a group. Unknown willingness is a distinct
state, not an inferred No. Put editing behind a rightmost Edit action and retain
the feature's independent mutation, approval and failed-save recovery rules.

Bulk selection is a deliberate exception to the trailing-action rule: a checkbox
column goes at the far left, with a named select-all control. Details and editors
remain in the rightmost Actions column. Selection remains stable while filtering;
subject catalogs use the same default order as signup forms.

Use one compact warning for an academic value needing review rather than an
unknown-value sentence followed by the same review instruction. Put full reasons,
self-excused absences, comments, evaluations and recorded service hours in named
detail readers. Attendance abbreviations such as P, EA and UA require a visible
legend and accessible expanded column names. Keep all columns and trailing actions
reachable on narrow screens; avoid side-by-side tables that compress either table
below its useful width.

In a record action group, put ordinary text links on the left, boxed decision
buttons next, and Delete last. For example, Set Up Account precedes Flag invalid
and the other decision buttons. Keep this DOM order and keyboard order consistent
when the group wraps on a narrow screen; do not reorder unrelated form actions.

Delete and Decline labels are red at rest, including when their control is boxed.
Assign destructive styling explicitly in the owning component rather than matching
translated label text. All in-table link actions, including destructive actions
and semantic buttons that open details, remain unboxed at rest and on hover: no
border or filled hover surface. Preserve their readable text, underline affordance,
visible keyboard focus, disabled behavior and existing desktop/touch target sizes.
Shared table text actions use a 3 px underline with a 4 px offset for keyboard
focus, rather than a surrounding ring that looks like a boxed action. Keep this
indicator distinct from the ordinary hover underline; mouse focus adds no box.
Boxed consequential buttons keep their boundary and interaction treatment; the red
label must not depend on hover. Confirmation, approval, authorization, action
tickets and pending-dismissal rules remain owned by the existing feature.

## Room and participant composition

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
email callers declare `presentation.codePurpose` and provide matching bilingual
plaintext instructions. New invitations mix letters and numbers in five characters;
emailed challenges contain four digits, preserving leading zeros. Keep the legacy
single wide site input, gray `XXXXX`/`XXXX` placeholders and neutral text/borders;
change only the box background to green for invitations or blue for verification.
Email keeps the legacy single code panel's layout, typography and border, with dark
green (`#18342C`) or blue (`#172F49`) backgrounds and no added label/guidance wrapper.
Never infer authorization from this presentation metadata. Include old-format
acceptance, purpose confusion, attempt limits, resend and failed delivery in tests;
capture both site and email panels at desktop/mobile widths and verify that stripping
email styles preserves readable instructions, full codes and contrast.

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
