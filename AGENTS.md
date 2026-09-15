# Project UI guidelines

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
