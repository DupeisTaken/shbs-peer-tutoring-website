export type HelpLocale = "en" | "zh";
export type HelpText = { en: string; zh: string };
export type HelpCategory =
  "start" | "account" | "sessions" | "operations" | "administration";
export type HelpAudience =
  | "public"
  | "account"
  | "student"
  | "tutor"
  | "crew"
  | "observer"
  | "staff"
  | "admin"
  | "head"
  | "translator";

export type HelpStep = {
  title: HelpText;
  body: HelpText;
  screenshot?: string;
  focus?: HelpText;
};

export type HelpArticle = {
  slug: string;
  audience: HelpAudience;
  /** Task placement is independent of the audience's authorization boundary. */
  category?: HelpCategory;
  title: HelpText;
  summary: HelpText;
  route: string;
  /** Email capabilities cannot be replaced by a tokenless example-route link. */
  requiresPrivateLink?: boolean;
  prerequisites: HelpText[];
  steps: HelpStep[];
  expected: HelpText;
  explanation: HelpText[];
  troubleshooting: { problem: HelpText; solution: HelpText }[];
  related?: string[];
  /** Source paths and named actions make gaps reviewable as the product evolves. */
  sources: string[];
  covers: string[];
};

export const helpText = (en: string, zh: string): HelpText => ({ en, zh });

export function helpLocale(locale: string): HelpLocale {
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}
