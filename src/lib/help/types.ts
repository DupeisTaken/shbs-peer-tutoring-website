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

/** Bounds are fractions of the untouched full capture, never CSS viewport pixels. */
export type HelpBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type HelpPoint = { x: number; y: number };
export type HelpCallout = {
  bounds: HelpBounds;
  /** A translated screen can move a control; choose by the capture's actual locale. */
  boundsByLocale?: Partial<Record<HelpLocale, HelpBounds>>;
  label: HelpText;
  placement?: "above" | "below";
  /** Reviewed top-left label position in the same normalized image coordinates. */
  labelPosition?: HelpPoint;
  /** Reviewed badge center near its target, avoiding controls absent from callouts. */
  badgePosition?: HelpPoint;
};

export type HelpStep = {
  title: HelpText;
  body: HelpText;
  screenshot?: string;
  /** Additional full-context states for long forms, in view order after primary. */
  supplementaryScreenshots?: string[];
  focus?: HelpText;
  /** Overrides primary capture callouts only. An empty array deliberately suppresses them. */
  callouts?: HelpCallout[];
};

export type HelpArticle = {
  slug: string;
  audience: HelpAudience;
  /** Task placement is independent of the audience's authorization boundary. */
  category?: HelpCategory;
  title: HelpText;
  summary: HelpText;
  route: string;
  /** A maintained public destination for a task completed outside the portal. */
  externalAction?: { href: string; label: HelpText };
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
