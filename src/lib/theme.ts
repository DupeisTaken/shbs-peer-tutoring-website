/**
 * Website accent themes. The accent color is exposed as `accent-*` Tailwind tokens (see
 * globals.css) backed by CSS variables, so switching `data-theme` on <html> re-skins the whole
 * app. The choice persists in the `THEME` cookie and is applied SSR in the root layout (no flash).
 */
export const THEMES = ["indigo", "violet", "emerald", "rose", "amber", "sky"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "indigo";

export const THEME_COOKIE = "THEME";

export function isTheme(value: string | undefined | null): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}
