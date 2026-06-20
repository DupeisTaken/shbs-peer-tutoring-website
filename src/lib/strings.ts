/**
 * Translatable UI strings.
 *
 * Every piece of user-facing copy should come from here via `t(...)` rather than being
 * hardcoded, so the app can be translated and white-labelled for other organisations
 * WITHOUT code changes. Orgs override any subset of strings through a single environment
 * variable — `NEXT_PUBLIC_STRINGS`, a JSON object of `{ "key": "Translated text" }` — which
 * is merged over these English defaults at build time. (See .env.example.)
 *
 * Pair this with the env-driven titles in src/lib/branding.ts. Runtime locale switching
 * (per-request languages) is future work; today it's one build-time string set per deploy.
 */
import { env } from "~/env";

/** Default (English) copy. Keys are dot-namespaced by area. */
export const DEFAULT_STRINGS = {
  "common.dismiss": "Dismiss",
  "common.save": "Save",
  "common.saved": "Saved.",

  "dashboard.greeting": "Hi, {name}",
  "dashboard.subtitle": "Submit attendance and manage your availability.",
  "dashboard.hours.title": "Service hours",
  "dashboard.interviews.title": "Interviews to conduct",
  "dashboard.pairings.title": "My pairings",
  "dashboard.pairings.help":
    "Pick the default time slot for each pairing (you still enter actual session times when submitting attendance).",
  "dashboard.availability.title": "My availability",
  "dashboard.availability.help":
    "Mark the time slots you can teach. These help coordinators schedule you.",
  "dashboard.attendance.title": "Submit attendance",
  "dashboard.attendance.help":
    "Record a session for one of your pairings. Service hours are computed automatically.",
  "dashboard.schedule.title": "Room schedule",
  "dashboard.schedule.help":
    "Your pairings are highlighted. Blocked cells are unavailable rooms.",
} as const;

export type StringKey = keyof typeof DEFAULT_STRINGS;

/** Parse the optional org override blob; ignore anything malformed. */
function loadOverrides(): Record<string, string> {
  const raw = env.NEXT_PUBLIC_STRINGS;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // Invalid JSON -> fall back to defaults silently.
  }
  return {};
}

const STRINGS: Record<string, string> = { ...DEFAULT_STRINGS, ...loadOverrides() };

/**
 * Look up a string by key, with optional `{placeholder}` interpolation. Falls back to the
 * key itself if it's somehow missing, so the UI never renders blank.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let out = STRINGS[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}
