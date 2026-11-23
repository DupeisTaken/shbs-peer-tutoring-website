import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { helpArticles } from "~/lib/help/catalogue";
import { getHelpScreenshot, type HelpScreenshot } from "~/lib/help/screenshots";
import type { HelpAudience } from "~/lib/help/types";

export const helpPrivateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

export function permittedScreenshot(
  id: string,
  audiences: HelpAudience[],
  locale: string,
) {
  const referenced = helpArticles.some(
    (article) =>
      audiences.includes(article.audience) &&
      article.steps.some(
        (step) =>
          step.screenshot === id || step.supplementaryScreenshots?.includes(id),
      ),
  );
  return referenced ? getHelpScreenshot(id, locale) : undefined;
}

export function screenshotPath(screenshot: HelpScreenshot) {
  // Only reviewed manifest filenames are accepted. User input never becomes a path.
  if (!/^[a-z0-9-]+\.(en|zh)\.jpg$/.test(screenshot.file))
    throw new Error("Invalid help asset filename");
  return path.join(process.cwd(), "docs/guides/help/assets", screenshot.file);
}

export async function readScreenshot(screenshot: HelpScreenshot) {
  return readFile(screenshotPath(screenshot));
}
