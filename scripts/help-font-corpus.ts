import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { helpArticles, helpAudienceTitles } from "../src/lib/help/catalogue";
import { helpCaptureInfo, helpScreenshots } from "../src/lib/help/screenshots";
import {
  annotationLabels,
  annotationNotice,
} from "../src/app/help/screenshot-annotations";

export function assembleHelpFontCorpus(
  payload: unknown,
  fixedSources: readonly string[],
) {
  // Runtime JSON includes decoded Unicode even when a capture receipt uses JSON
  // escape sequences. Font generation and checking consume this exact corpus.
  return (
    JSON.stringify(payload) +
    "\n" +
    fixedSources.join("\n") +
    Array.from({ length: 95 }, (_, index) =>
      String.fromCharCode(index + 32),
    ).join("") +
    "•·—→"
  );
}

export async function getHelpFontCorpus(root = process.cwd()) {
  return assembleHelpFontCorpus(
    {
      articles: helpArticles,
      audienceTitles: helpAudienceTitles,
      captures: { info: helpCaptureInfo, screenshots: helpScreenshots },
      annotationNotice,
      annotationLabels,
    },
    [await fs.readFile(path.join(root, "src/server/help/pdf.ts"), "utf8")],
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href &&
  process.argv.includes("--print")
)
  process.stdout.write(await getHelpFontCorpus());
