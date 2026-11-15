import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { helpArticles, helpAudienceTitles } from "../src/lib/help/catalogue";
import {
  helpScreenshots,
  helpCaptureInfo,
  getHelpScreenshot,
} from "../src/lib/help/screenshots";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const root = process.cwd();
const fingerprintsPath = path.join(
  root,
  "docs/guides/help/source-fingerprints.json",
);
const sources = [
  ...new Set(
    helpArticles
      .flatMap((article) => article.sources)
      .concat([
        "messages/en.json",
        "messages/zh.json",
        "src/styles/globals.css",
        "src/app/_components/workspace-header.tsx",
        "src/app/_components/admin-nav.tsx",
      ]),
  ),
]
  .filter((file) => file.startsWith("src/") || file.startsWith("messages/"))
  .sort();
const current: Record<string, string> = {};
// Git may check text out as CRLF on Windows and LF in CI. Review content changes,
// while keeping capture hashes bound to the original binary bytes below.
for (const file of sources)
  current[file] = hash(
    Buffer.from(
      (await fs.readFile(path.join(root, file), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
    ),
  );

if (process.argv.includes("--record-sources")) {
  const note = process.argv
    .find((arg) => arg.startsWith("--review-note="))
    ?.slice(14);
  if (!note?.trim())
    throw new Error("Record a screenshot review note with --review-note=...");
  await fs.writeFile(
    fingerprintsPath,
    JSON.stringify(
      {
        baselineRevision: helpCaptureInfo.sourceRevision,
        reviewedAt: new Date().toISOString(),
        reviewNote: note,
        files: current,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Recorded ${sources.length} reviewed help source fingerprints.`);
} else {
  const saved = JSON.parse(await fs.readFile(fingerprintsPath, "utf8")) as {
    baselineRevision: string;
    files: Record<string, string>;
  };
  const changed = [
    ...new Set([...Object.keys(saved.files), ...sources]),
  ].filter((file) => saved.files[file] !== current[file]);
  if (changed.length)
    throw new Error(
      `Help screenshots/content need review after source changes:\n${changed.join("\n")}\nFollow docs/contributing/help-catalogue.md; refresh affected captures before recording reviewed fingerprints.`,
    );
  if (saved.baselineRevision !== helpCaptureInfo.sourceRevision)
    throw new Error("Capture baseline and source-review baseline differ.");
}

const ids = new Set<string>();
for (const screenshot of helpScreenshots) {
  const key = `${screenshot.id}:${screenshot.locale}`;
  if (ids.has(key)) throw new Error(`Duplicate screenshot ${key}`);
  ids.add(key);
  if (!/^[a-z0-9-]+\.(en|zh)\.jpg$/.test(screenshot.file))
    throw new Error(`Unsafe filename ${key}`);
  const bytes = await fs.readFile(
    path.join(root, "docs/guides/help/assets", screenshot.file),
  );
  if (hash(bytes) !== screenshot.sha256)
    throw new Error(`Screenshot bytes differ from capture receipt: ${key}`);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error(`Not a JPEG: ${key}`);
  if (
    !screenshot.route.startsWith("/") ||
    /v[12]\.[A-Za-z0-9_-]+\.[1-9]\d*\./.test(screenshot.route)
  )
    throw new Error(`Unsafe screenshot route: ${key}`);
  if (!screenshot.role || !Number.isFinite(Date.parse(screenshot.capturedAt)))
    throw new Error(`Incomplete provenance: ${key}`);
}
for (const article of helpArticles) {
  if (!article.steps.some((step) => step.screenshot))
    throw new Error(`Guide needs visual guidance: ${article.slug}`);
  for (const step of article.steps) {
    if (step.screenshot && !getHelpScreenshot(step.screenshot))
      throw new Error(`Missing screenshot ${article.slug}: ${step.screenshot}`);
  }
}
console.log(
  `Verified ${helpScreenshots.length} capture receipts and visual coverage of ${helpArticles.length} guides.`,
);

// Inspect the actual embedded font through PDFKit's own installed font parser.
// A new Chinese character must not silently become a missing-glyph box in PDFs.
const require = createRequire(import.meta.url);
const pdfRequire = createRequire(require.resolve("pdfkit"));
const fontkit = pdfRequire("fontkit") as {
  openSync: (file: string) => {
    hasGlyphForCodePoint: (code: number) => boolean;
  };
};
const font = fontkit.openSync(
  path.join(root, "public/fonts/help/noto-sans-sc.otf"),
);
const corpus =
  JSON.stringify(helpArticles) +
  JSON.stringify(helpAudienceTitles) +
  JSON.stringify(helpCaptureInfo) +
  (await fs.readFile(path.join(root, "src/server/help/pdf.ts"), "utf8"));
const missingGlyphs = [
  ...new Set(
    [...corpus].filter(
      (character) =>
        !/\s/u.test(character) &&
        !font.hasGlyphForCodePoint(character.codePointAt(0)!),
    ),
  ),
];
if (missingGlyphs.length)
  throw new Error(
    `Help PDF font needs regeneration for: ${missingGlyphs.join("")}`,
  );
console.log("Verified Chinese PDF font coverage for the maintained corpus.");
