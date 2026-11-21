import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { helpArticles } from "../src/lib/help/catalogue";
import { helpScreenshots, helpCaptureInfo } from "../src/lib/help/screenshots";
import {
  validateCaptureReceipt,
  validateStepCaptureCoverage,
} from "./help-capture-validation";
import { getHelpFontCorpus } from "./help-font-corpus";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const root = process.cwd();
const recordSources = process.argv.includes("--record-sources");
const allowPending = process.argv.includes("--allow-pending-step-captures");
const reviewNote = process.argv
  .find((arg) => arg.startsWith("--review-note="))
  ?.slice(14);
if (recordSources && !reviewNote?.trim())
  throw new Error("Record a screenshot review note with --review-note=...");
if (recordSources && allowPending)
  throw new Error(
    "Source fingerprints cannot be recorded in the pending-capture authoring mode",
  );
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
        "src/lib/help/types.ts",
        "src/lib/help/catalogue.ts",
        "src/lib/help/participant-content.ts",
        "src/lib/help/management-content.ts",
        "src/lib/help/screenshots.ts",
        "src/lib/help/screenshot-copy.ts",
        "src/lib/help/capture-route.ts",
        "src/app/student/views.ts",
        "src/app/help/screenshot-annotations.ts",
        "src/app/help/annotated-screenshot.tsx",
        "src/app/help/screenshot-caption.tsx",
        "src/app/help/step-screenshot-gallery.tsx",
        "src/app/help/annotation-assets.ts",
        "src/app/help/[slug]/screenshots/[step]/page.tsx",
        "src/app/help/[slug]/page.tsx",
        "src/server/help/assets.ts",
        "src/server/help/pdf.ts",
        "scripts/export-help.ts",
        "scripts/help-capture-validation.ts",
        "scripts/help-font-corpus.ts",
        "scripts/subset-help-font.py",
      ]),
  ),
]
  .filter(
    (file) =>
      file.startsWith("src/") ||
      file.startsWith("messages/") ||
      file.startsWith("scripts/"),
  )
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

if (
  !/^[a-f0-9]{40}$/.test(helpCaptureInfo.sourceRevision) ||
  !helpCaptureInfo.releaseRef.trim() ||
  !Number.isFinite(Date.parse(helpCaptureInfo.capturedAt))
)
  throw new Error(
    "The common capture baseline needs an exact revision, attestation and date",
  );

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
  validateCaptureReceipt(screenshot, bytes);
}
const coverage = validateStepCaptureCoverage(helpArticles, helpScreenshots, {
  allowPending,
});
console.log(
  `Verified ${helpScreenshots.length} raw capture receipts and ${coverage.illustrated}/${coverage.steps} exact step captures across ${helpArticles.length} guides.`,
);
if (coverage.missing.length)
  console.log(
    `AUTHORING ONLY: ${coverage.missing.length} actual steps still need full captures. Default help:check and CI remain strict.`,
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
const corpus = await getHelpFontCorpus(root);
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

// Recording is deliberately last: missing steps, invalid receipts or missing
// glyphs must never leave a newly stamped source-review file behind.
if (recordSources) {
  await fs.writeFile(
    fingerprintsPath,
    JSON.stringify(
      {
        baselineRevision: helpCaptureInfo.sourceRevision,
        reviewedAt: new Date().toISOString(),
        reviewNote,
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
