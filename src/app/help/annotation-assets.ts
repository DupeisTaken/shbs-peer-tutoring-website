/** Build-time derivatives only. Raw capture files and their hashes are never rewritten. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { HelpScreenshot } from "~/lib/help/screenshots";
import type { HelpLocale, HelpStep } from "~/lib/help/types";
import {
  annotationColors,
  layoutHelpCallouts,
  type AnnotationLayout,
} from "./screenshot-annotations";

type FontPosition = {
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
};
type OutlineFont = {
  unitsPerEm: number;
  hasGlyphForCodePoint: (code: number) => boolean;
  layout: (text: string) => {
    glyphs: { path: { toSVG: () => string } }[];
    positions: FontPosition[];
  };
};
// Next owns the installed native image dependency. Keep its small build-time
// boundary typed without requiring a second root-level installation of Sharp.
type SharpPipeline = {
  composite: (
    layers: { input: Uint8Array; left: number; top: number }[],
  ) => SharpPipeline;
  png: (options: {
    compressionLevel: number;
    adaptiveFiltering: boolean;
    palette: boolean;
  }) => SharpPipeline;
  webp: (options: typeof annotationWebpEncoding) => SharpPipeline;
  toColourspace: (space: "srgb") => SharpPipeline;
  ensureAlpha: () => SharpPipeline;
  raw: () => SharpPipeline;
  metadata: () => Promise<{
    format?: string;
    width?: number;
    height?: number;
    pages?: number;
  }>;
  toBuffer: () => Promise<Buffer>;
};
type SharpFactory = {
  (input: Uint8Array, options?: { limitInputPixels: number }): SharpPipeline;
  concurrency: (threads: number) => number;
  cache: (enabled: false) => unknown;
};

// GitHub derivatives use a separate format recipe. Keep the production PNG
// compositor and its recipe unchanged for visual-review previews.
export const annotationWebpEncoding = Object.freeze({
  lossless: true,
  nearLossless: false,
  quality: 100,
  alphaQuality: 100,
  effort: 4,
  exact: true,
});
const annotationMaxPixels = 16_000_000;
const annotationMaxDimension = 16_383;
const rgbaAlgorithm = "sharp-srgb-ensureAlpha-rgba8";
const shaPattern = /^[a-f0-9]{64}$/;

export type AnnotationPixelParity = {
  schemaVersion: 1;
  algorithm: typeof rgbaAlgorithm;
  width: number;
  height: number;
  channels: 4;
  pngSha256: string;
  pngRgbaSha256: string;
  webpRgbaSha256: string;
};
export type AnnotationWebpMetadata = {
  schemaVersion: 2;
  format: "webp";
  encoding: typeof annotationWebpEncoding;
  pngRecipeSha256: string;
  pixelParity: AnnotationPixelParity;
};

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function assertAnnotationImageDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > annotationMaxDimension ||
    height > annotationMaxDimension ||
    width * height > annotationMaxPixels
  )
    throw new Error(
      "Annotated WebP dimensions exceed the bounded export limit",
    );
}

export function annotationWebpRecipeHash(pngRecipeSha256: string) {
  if (!shaPattern.test(pngRecipeSha256))
    throw new Error("Annotated WebP requires a current PNG recipe hash");
  return sha256(
    JSON.stringify({
      schemaVersion: 2,
      format: "webp",
      pngRecipeSha256,
      encoding: annotationWebpEncoding,
      pixelAlgorithm: rgbaAlgorithm,
    }),
  );
}

/** Old PNG manifests require explicit regeneration; they are never codec proofs. */
export function isCurrentAnnotationWebpMetadata(
  value: unknown,
  pngRecipeSha256: string,
  viewport: { width: number; height: number },
): value is AnnotationWebpMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AnnotationWebpMetadata>;
  const proof = record.pixelParity;
  return (
    record.schemaVersion === 2 &&
    record.format === "webp" &&
    record.pngRecipeSha256 === pngRecipeSha256 &&
    !!record.encoding &&
    Object.keys(record.encoding).length ===
      Object.keys(annotationWebpEncoding).length &&
    Object.entries(annotationWebpEncoding).every(
      ([key, expected]) =>
        record.encoding![key as keyof typeof annotationWebpEncoding] ===
        expected,
    ) &&
    !!proof &&
    proof.schemaVersion === 1 &&
    proof.algorithm === rgbaAlgorithm &&
    proof.width === viewport.width &&
    proof.height === viewport.height &&
    Number.isSafeInteger(proof.width) &&
    Number.isSafeInteger(proof.height) &&
    proof.width > 0 &&
    proof.height > 0 &&
    proof.width <= annotationMaxDimension &&
    proof.height <= annotationMaxDimension &&
    proof.width * proof.height <= annotationMaxPixels &&
    proof.channels === 4 &&
    typeof proof.pngSha256 === "string" &&
    shaPattern.test(proof.pngSha256) &&
    typeof proof.pngRgbaSha256 === "string" &&
    shaPattern.test(proof.pngRgbaSha256) &&
    proof.pngRgbaSha256 === proof.webpRgbaSha256
  );
}

function boundedSharp(input: Uint8Array) {
  const sharp = nextRequire("sharp") as SharpFactory;
  sharp.concurrency(1);
  sharp.cache(false);
  return sharp(input, { limitInputPixels: annotationMaxPixels });
}

function pngDimensions(png: Buffer) {
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Lossless annotation export requires the production PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assertAnnotationImageDimensions(width, height);
  return { width, height };
}

function rgba(input: Uint8Array) {
  return boundedSharp(input)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function webpRgba(bytes: Buffer, width: number, height: number) {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    throw new Error("Annotated WebP bytes have the wrong format");
  const metadata = await boundedSharp(bytes).metadata();
  if (
    metadata.format !== "webp" ||
    metadata.width !== width ||
    metadata.height !== height ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error("Annotated WebP dimensions differ from production PNG");
  return rgba(bytes);
}

/** Prove equality against the actual composited PNG before accepting any WebP. */
export async function encodeAnnotationWebp(png: Buffer) {
  const { width, height } = pngDimensions(png);
  const pngRgba = await rgba(png);
  const bytes = await boundedSharp(png).webp(annotationWebpEncoding).toBuffer();
  const decodedWebp = await webpRgba(bytes, width, height);
  if (pngRgba.length !== width * height * 4 || !pngRgba.equals(decodedWebp))
    throw new Error(
      "Lossless annotation WebP differs from production PNG pixels",
    );
  const pixelParity: AnnotationPixelParity = {
    schemaVersion: 1,
    algorithm: rgbaAlgorithm,
    width,
    height,
    channels: 4,
    pngSha256: sha256(png),
    pngRgbaSha256: sha256(pngRgba),
    webpRgbaSha256: sha256(decodedWebp),
  };
  return { bytes, pixelParity };
}

/** Checks decode immutable bytes against the accepted PNG proof, without
 * re-encoding native PNGs differently on another platform. */
export async function verifyAnnotationWebp(
  bytes: Buffer,
  proof: AnnotationPixelParity,
) {
  assertAnnotationImageDimensions(proof.width, proof.height);
  const decoded = await webpRgba(bytes, proof.width, proof.height);
  if (
    decoded.length !== proof.width * proof.height * 4 ||
    sha256(decoded) !== proof.pngRgbaSha256 ||
    proof.pngRgbaSha256 !== proof.webpRgbaSha256
  )
    throw new Error("Annotated WebP pixels differ from the accepted PNG proof");
}

const require = createRequire(import.meta.url);
const pdfRequire = createRequire(require.resolve("pdfkit"));
const nextRequire = createRequire(require.resolve("next/package.json"));
let outlineFont: OutlineFont | undefined;
let annotationFontSha256: string | undefined;

function font() {
  if (!outlineFont) {
    const fontkit = pdfRequire("fontkit") as {
      openSync: (file: string) => OutlineFont;
    };
    const filename = path.join(
      process.cwd(),
      "public/fonts/help/noto-sans-sc.otf",
    );
    annotationFontSha256 = createHash("sha256")
      .update(readFileSync(filename))
      .digest("hex");
    outlineFont = fontkit.openSync(filename);
  }
  return outlineFont;
}

function outlinedText(
  text: string,
  x: number,
  baseline: number,
  size: number,
  color: string,
  centered = false,
) {
  const face = font();
  for (const character of text) {
    if (
      !/\s/u.test(character) &&
      !face.hasGlyphForCodePoint(character.codePointAt(0)!)
    )
      throw new Error(`Help annotation font is missing a glyph: ${character}`);
  }
  const run = face.layout(text);
  const scale = size / face.unitsPerEm;
  let cursorX = centered
    ? x -
      run.positions.reduce(
        (sum, position) => sum + position.xAdvance * scale,
        0,
      ) /
        2
    : x;
  let cursorY = baseline;
  return run.glyphs
    .map((glyph, index) => {
      const position = run.positions[index]!;
      const data = glyph.path.toSVG();
      const result = `<path fill="${color}" d="${data}" transform="translate(${cursorX + position.xOffset * scale} ${cursorY - position.yOffset * scale}) scale(${scale} ${-scale})"/>`;
      cursorX += position.xAdvance * scale;
      cursorY -= position.yAdvance * scale;
      return result;
    })
    .join("");
}

function svgCallout(annotation: AnnotationLayout) {
  const { target, label, padding, badgeSize, fontSize, lineHeight } =
    annotation;
  const badgeX = label.x + padding + badgeSize / 2;
  const badgeY = label.y + label.height / 2;
  return `<rect x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" rx="4" fill="none" stroke="${annotationColors.backing}" stroke-width="5"/>
<rect x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" rx="4" fill="none" stroke="${annotationColors.outline}" stroke-width="3"/>
${
  annotation.showLabel
    ? `<g data-callout-label="${annotation.number}"><rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="6" fill="${annotationColors.ink}" stroke="${annotationColors.backing}" stroke-width="2"/>
<circle cx="${badgeX}" cy="${badgeY}" r="${badgeSize / 2}" fill="${annotationColors.backing}"/>
${outlinedText(String(annotation.number), badgeX, badgeY + fontSize * 0.35, fontSize, annotationColors.ink, true)}
${annotation.lines.map((line, index) => outlinedText(line, label.x + padding * 2 + badgeSize, label.y + padding + fontSize + index * lineHeight, fontSize, annotationColors.text)).join("")}</g>`
    : ""
}`;
}

function svgLeader(annotation: AnnotationLayout) {
  return annotation.leader
    ? `<line x1="${annotation.leader.from.x}" y1="${annotation.leader.from.y}" x2="${annotation.leader.to.x}" y2="${annotation.leader.to.y}" stroke="${annotationColors.backing}" stroke-width="6"/>
<line data-callout-leader="${annotation.number}" x1="${annotation.leader.from.x}" y1="${annotation.leader.from.y}" x2="${annotation.leader.to.x}" y2="${annotation.leader.to.y}" stroke="${annotationColors.outline}" stroke-width="2"/>`
    : "";
}

function svgTargetNumber(annotation: AnnotationLayout) {
  return `<circle data-callout-target="${annotation.number}" cx="${annotation.targetBadge.x}" cy="${annotation.targetBadge.y}" r="${annotation.targetBadge.radius}" fill="${annotationColors.ink}" stroke="${annotationColors.backing}" stroke-width="2"/>
${outlinedText(String(annotation.number), annotation.targetBadge.x, annotation.targetBadge.y + annotation.fontSize * 0.85 * 0.35, annotation.fontSize * 0.85, annotationColors.text, true)}`;
}

export function annotationOverlaySvg(
  step: HelpStep,
  screenshot: HelpScreenshot,
  locale: HelpLocale,
) {
  const layout = layoutHelpCallouts(step, screenshot, locale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${screenshot.viewport.width}" height="${screenshot.viewport.height}" viewBox="0 0 ${screenshot.viewport.width} ${screenshot.viewport.height}"><g data-callout-leaders="true">${layout.map(svgLeader).join("")}</g>${layout.map(svgCallout).join("")}<g data-callout-targets="true">${layout.map(svgTargetNumber).join("")}</g></svg>`;
}

export function annotationRecipeHash(
  screenshot: HelpScreenshot,
  overlay: string,
  step: HelpStep,
  locale: HelpLocale,
) {
  font();
  return createHash("sha256")
    .update(
      JSON.stringify({
        rawSha256: screenshot.sha256,
        fontSha256: annotationFontSha256,
        locale,
        geometryAndLabels: layoutHelpCallouts(step, screenshot, locale),
        overlay,
      }),
    )
    .digest("hex");
}

export async function renderAnnotatedCapture(
  screenshot: HelpScreenshot,
  overlay: string,
) {
  if (!/^[a-z0-9-]+\.(en|zh)\.jpg$/.test(screenshot.file))
    throw new Error("Annotated captures require a reviewed raw JPEG filename");
  const raw = await readFile(
    path.join(process.cwd(), "docs/guides/help/assets", screenshot.file),
  );
  if (createHash("sha256").update(raw).digest("hex") !== screenshot.sha256)
    throw new Error(
      `Original screenshot differs from its reviewed receipt: ${screenshot.id}`,
    );
  const sharp = nextRequire("sharp") as SharpFactory;
  // This short-lived export process performs derivatives serially on the local machine.
  sharp.concurrency(1);
  return sharp(raw)
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}
