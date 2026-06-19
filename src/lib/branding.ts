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
