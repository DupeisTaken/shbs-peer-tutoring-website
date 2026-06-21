/**
 * Single source of truth for the small UI glyphs used across the app.
 *
 * Keep iconography here so collapse/expand/close/etc. stay visually consistent everywhere
 * and are trivial to swap later. Prefer the `DisclosureIcon` component (src/app/_components/icons.tsx)
 * for expand/collapse affordances rather than hand-writing a triangle.
 */
export const SYMBOLS = {
  /** Disclosure triangle for collapsible sections. Rotate 90° when expanded. */
  disclosure: "▶",
  /** Dismiss / close (modals, dialogs). */
  close: "✕",
  /** Affirmative / done. */
  check: "✓",
  /** Negative / removed. */
  cross: "✕",
  /** Inline separator between bits of metadata. */
  dot: "·",
} as const;

export type SymbolKey = keyof typeof SYMBOLS;
