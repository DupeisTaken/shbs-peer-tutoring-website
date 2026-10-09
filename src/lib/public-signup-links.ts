const shortPaths: Record<string, string> = {
  "/register-account": "/register",
  "/signup": "/tutee",
  "/tutee-signup": "/tutee",
  "/signup/account": "/tutee/account",
  "/tutee-signup/account": "/tutee/account",
  "/tutor-signup": "/tutor",
  "/viewer-signup": "/viewer",
  "/crew-signup": "/crew",
};

/** Render existing CMS signup actions using short links without rewriting stored
 * content, external URLs, or invitation/query/fragment data. */
export function shortSignupHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const split = href.search(/[?#]/);
  const path = split < 0 ? href : href.slice(0, split);
  const short = shortPaths[path];
  return short ? short + (split < 0 ? "" : href.slice(split)) : href;
}
