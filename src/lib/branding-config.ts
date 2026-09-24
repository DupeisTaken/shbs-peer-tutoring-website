/** Repository-owned defaults, also usable when rendering isolated client components. */
export const DEFAULT_BRANDING = {
  APP_TITLE: "SHBS Peer Tutoring",
  TEAM_TITLE: "SHBS Peer Tutoring Team",
  ORG_NAME: "SHBS Peer Tutoring",
  SUPPORT_EMAIL: "",
  PROGRAM_TERM_LABEL: "",
};

export type PublicBranding = typeof DEFAULT_BRANDING;

/** Blank and whitespace-only overrides have the same meaning as an unset variable. */
function label(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Explicit allowlist: never serialize the environment object or copy arbitrary keys. */
export function resolveBranding(
  values: Partial<Record<keyof PublicBranding, string | undefined>>,
): PublicBranding {
  const APP_TITLE = label(values.APP_TITLE, DEFAULT_BRANDING.APP_TITLE);
  return {
    APP_TITLE,
    TEAM_TITLE: label(values.TEAM_TITLE, DEFAULT_BRANDING.TEAM_TITLE),
    ORG_NAME: label(values.ORG_NAME, APP_TITLE),
    SUPPORT_EMAIL: label(values.SUPPORT_EMAIL),
    PROGRAM_TERM_LABEL: label(values.PROGRAM_TERM_LABEL),
  };
}
