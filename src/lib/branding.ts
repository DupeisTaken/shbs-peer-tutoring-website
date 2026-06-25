import { env } from "~/env";

/**
 * Display titles for the app, sourced from environment variables so they can be
 * rebranded without touching code — set `NEXT_PUBLIC_APP_TITLE` and
 * `NEXT_PUBLIC_TEAM_TITLE` in `.env` (see `.env.example`). Defaults live in
 * `src/env.js`. Both are `NEXT_PUBLIC_*`, so they're available in server and
 * client components alike.
 */

/** Public-facing brand (students, landing page, tutee/tutor signup). */
export const APP_TITLE = env.NEXT_PUBLIC_APP_TITLE;

/** Brand for the tutor/coordinator/admin management area ("the team"). */
export const TEAM_TITLE = env.NEXT_PUBLIC_TEAM_TITLE;

/**
 * Optional program-identity labels for white-labeling a deployment. All env-driven (inlined at
 * build, usable in server + client). Empty env values fall back sensibly so the app runs
 * unconfigured. Rebuild after changing them.
 */

/** Organization / school name (letterhead, emails, footer). Falls back to the app title. */
export const ORG_NAME = env.NEXT_PUBLIC_ORG_NAME || APP_TITLE;

/** Public support/contact email, or "" when unset (callers should hide the line when empty). */
export const SUPPORT_EMAIL = env.NEXT_PUBLIC_SUPPORT_EMAIL;

/** Display label for the program season/year, e.g. "2025–26", or "" when unset. */
export const PROGRAM_TERM_LABEL = env.NEXT_PUBLIC_PROGRAM_TERM_LABEL;
