import "server-only";

import { env } from "~/env";
import { resolveBranding } from "~/lib/branding-config";

/** Runtime server configuration. Only this explicit public projection may reach React clients. */
export const BRANDING = resolveBranding(env);
export const {
  APP_TITLE,
  TEAM_TITLE,
  ORG_NAME,
  SUPPORT_EMAIL,
  PROGRAM_TERM_LABEL,
} = BRANDING;
