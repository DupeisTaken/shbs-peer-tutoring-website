import captures from "../../../docs/guides/help/captures.json";
import type { HelpLocale, HelpText } from "./types";

export type HelpScreenshot = {
  id: string;
  file: string;
  route: string;
  locale: HelpLocale;
  capturedAt: string;
  viewport: { width: number; height: number };
  /** Original CSS viewport, when a focused presentation crop is supplied. */
  browserViewport?: { width: number; height: number };
  crop?: { x: number; y: number; width: number; height: number };
  original?: { sha256: string; width: number; height: number };
  caption?: HelpText;
  role: string;
  sha256: string;
};

export const helpCaptureInfo = captures.info;
export const helpScreenshots = captures.screenshots as HelpScreenshot[];

export function getHelpScreenshot(id: string, locale = "en") {
  return (
    helpScreenshots.find((item) => item.id === id && item.locale === locale) ??
    helpScreenshots.find((item) => item.id === id && item.locale === "en")
  );
}
