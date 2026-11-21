import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { HelpScreenshot } from "~/lib/help/screenshots";
import type { HelpStep } from "~/lib/help/types";
import {
  annotationOverlaySvg,
  annotationRecipeHash,
  annotationWebpEncoding,
  annotationWebpRecipeHash,
  assertAnnotationImageDimensions,
  encodeAnnotationWebp,
  isCurrentAnnotationWebpMetadata,
  verifyAnnotationWebp,
  type AnnotationWebpMetadata,
} from "./annotation-assets";

const title = { en: "Read guide", zh: "查看指南" };
const step: HelpStep = {
  title,
  body: title,
  callouts: [
    { bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, label: title },
  ],
};
const screenshot: HelpScreenshot = {
  id: "fixture",
  file: "fixture.en.jpg",
  locale: "en",
  role: "TUTOR",
  route: "/dashboard",
  capturedAt: "2026-11-16T00:00:00Z",
  viewport: { width: 1440, height: 1000 },
  sha256: "a".repeat(64),
};

it("outlines bilingual labels in an overlay without embedding or replacing capture pixels", () => {
  const svg = annotationOverlaySvg(step, screenshot, "zh");
  expect(svg).toContain('width="1440" height="1000"');
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<image");
  expect(svg).not.toContain("<text");
  expect(svg).not.toContain("data:");
  expect(svg).not.toContain("font-family");
  const markup = annotationOverlaySvg(
    {
      ...step,
      callouts: [
        {
          ...step.callouts![0]!,
          label: { en: "<script>read</script>", zh: "查看指南" },
        },
      ],
    },
    screenshot,
    "en",
  );
  expect(markup).not.toContain("<script>");
});

it("binds recipes to original bytes, exact localized labels and reviewed geometry", () => {
  const overlay = annotationOverlaySvg(step, screenshot, "en");
  const recipe = annotationRecipeHash(screenshot, overlay, step, "en");
  expect(annotationRecipeHash(screenshot, overlay, step, "en")).toBe(recipe);
  expect(
    annotationRecipeHash(
      { ...screenshot, sha256: "b".repeat(64) },
      overlay,
      step,
      "en",
    ),
  ).not.toBe(recipe);
  expect(annotationRecipeHash(screenshot, overlay, step, "zh")).not.toBe(
    recipe,
  );
  expect(
    annotationRecipeHash(
      screenshot,
      overlay,
      {
        ...step,
        callouts: [
          {
            ...step.callouts![0]!,
            bounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
          },
        ],
      },
      "en",
    ),
  ).not.toBe(recipe);
});

it("keeps matching target numbers and leaders in the PNG overlay when labels are displaced", () => {
  const displaced: HelpStep = {
    ...step,
    callouts: [
      { ...step.callouts![0]!, labelPosition: { x: 0.7, y: 0.03 } },
      {
        bounds: { x: 0.6, y: 0.5, width: 0.2, height: 0.08 },
        label: { en: "Choose Next", zh: "选择下一步" },
        labelPosition: { x: 0.05, y: 0.75 },
      },
    ],
  };
  const svg = annotationOverlaySvg(displaced, screenshot, "zh");
  expect(svg).toContain('data-callout-leader="1"');
  expect(svg).toContain('data-callout-leader="2"');
  expect(svg).toContain('data-callout-target="1"');
  expect(svg).toContain('data-callout-target="2"');
  expect(svg.indexOf('data-callout-targets="true"')).toBeGreaterThan(
    svg.lastIndexOf("<rect"),
  );
});

it("omits text pills and leaders on narrow PNGs while preserving numbered target outlines", () => {
  const svg = annotationOverlaySvg(
    step,
    { ...screenshot, viewport: { width: 375, height: 844 } },
    "zh",
  );
  expect(svg).toContain('data-callout-target="1"');
  expect(svg).not.toContain('data-callout-label="');
  expect(svg).not.toContain('data-callout-leader="');
  expect(svg.match(/<rect\b/g)).toHaveLength(2);
});

const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function tinyProductionPng() {
  const png = new PNG({ width: 4, height: 2 });
  // Include hidden RGB under transparent pixels: `exact` must preserve it too.
  png.data = Buffer.from([
    17, 39, 211, 0, 255, 1, 109, 255, 30, 210, 71, 73, 89, 25, 238, 128, 230,
    240, 250, 255, 0, 0, 0, 255, 191, 41, 60, 0, 1, 2, 3, 200,
  ]);
  return { bytes: PNG.sync.write(png), rgba: png.data };
}

it("encodes deterministic lossless WebP with exact RGBA parity including transparency", async () => {
  const png = tinyProductionPng();
  const original = Buffer.from(png.bytes);
  const first = await encodeAnnotationWebp(png.bytes);
  const second = await encodeAnnotationWebp(png.bytes);
  expect(first.bytes.toString("ascii", 8, 12)).toBe("WEBP");
  expect(first.bytes.equals(second.bytes)).toBe(true);
  expect(first.pixelParity).toEqual(second.pixelParity);
  expect(first.pixelParity).toMatchObject({
    schemaVersion: 1,
    algorithm: "sharp-srgb-ensureAlpha-rgba8",
    width: 4,
    height: 2,
    channels: 4,
    pngSha256: hash(png.bytes),
    pngRgbaSha256: hash(png.rgba),
    webpRgbaSha256: hash(png.rgba),
  });
  expect(png.bytes.equals(original)).toBe(true);
  await expect(
    verifyAnnotationWebp(first.bytes, first.pixelParity),
  ).resolves.toBeUndefined();
});

it("rejects wrong format, dimensions and a pixel proof from a different image", async () => {
  const png = tinyProductionPng();
  const image = await encodeAnnotationWebp(png.bytes);
  await expect(encodeAnnotationWebp(Buffer.from("not a PNG"))).rejects.toThrow(
    "production PNG",
  );
  await expect(
    verifyAnnotationWebp(png.bytes, image.pixelParity),
  ).rejects.toThrow("wrong format");
  await expect(
    verifyAnnotationWebp(image.bytes, {
      ...image.pixelParity,
      width: 2,
      height: 4,
    }),
  ).rejects.toThrow("dimensions differ");
  await expect(
    verifyAnnotationWebp(image.bytes, {
      ...image.pixelParity,
      pngRgbaSha256: "a".repeat(64),
      webpRgbaSha256: "a".repeat(64),
    }),
  ).rejects.toThrow("accepted PNG proof");
});

it("bounds source PNG allocation before invoking a native decoder", async () => {
  for (const [width, height] of [
    [0, 10],
    [2.5, 4],
    [16_384, 1],
    [4_001, 4_000],
  ])
    expect(() => assertAnnotationImageDimensions(width!, height!)).toThrow(
      "bounded",
    );
  const oversized = tinyProductionPng().bytes;
  oversized.writeUInt32BE(4_001, 16);
  oversized.writeUInt32BE(4_000, 20);
  await expect(encodeAnnotationWebp(oversized)).rejects.toThrow("bounded");
});

it("versions the format recipe and rejects old PNG manifests or incomplete parity evidence", () => {
  const pngRecipeSha256 = "a".repeat(64);
  const recipe = annotationWebpRecipeHash(pngRecipeSha256);
  expect(recipe).toMatch(/^[a-f0-9]{64}$/);
  expect(recipe).not.toBe(pngRecipeSha256);
  expect(annotationWebpRecipeHash(pngRecipeSha256)).toBe(recipe);
  expect(annotationWebpRecipeHash("b".repeat(64))).not.toBe(recipe);
  expect(() => annotationWebpRecipeHash("old-recipe.png")).toThrow(
    "recipe hash",
  );
  const viewport = { width: 4, height: 2 };
  const current: AnnotationWebpMetadata = {
    schemaVersion: 2,
    format: "webp",
    encoding: annotationWebpEncoding,
    pngRecipeSha256,
    pixelParity: {
      schemaVersion: 1,
      algorithm: "sharp-srgb-ensureAlpha-rgba8",
      ...viewport,
      channels: 4,
      pngSha256: "b".repeat(64),
      pngRgbaSha256: "c".repeat(64),
      webpRgbaSha256: "c".repeat(64),
    },
  };
  expect(
    isCurrentAnnotationWebpMetadata(current, pngRecipeSha256, viewport),
  ).toBe(true);
  for (const invalid of [
    null,
    {
      file: `assets/annotated/${pngRecipeSha256}.png`,
      recipeSha256: pngRecipeSha256,
    },
    { ...current, schemaVersion: 1 },
    { ...current, format: "png" },
    { ...current, pngRecipeSha256: "d".repeat(64) },
    { ...current, encoding: { ...annotationWebpEncoding, lossless: false } },
    { ...current, encoding: { ...annotationWebpEncoding, nearLossless: true } },
    { ...current, encoding: { ...annotationWebpEncoding, exact: false } },
    { ...current, encoding: { ...annotationWebpEncoding, quality: 99 } },
    { ...current, encoding: { ...annotationWebpEncoding, unexpected: true } },
    { ...current, pixelParity: undefined },
    {
      ...current,
      pixelParity: { ...current.pixelParity, algorithm: "any SHA" },
    },
    {
      ...current,
      pixelParity: { ...current.pixelParity, width: 2, height: 4 },
    },
    {
      ...current,
      pixelParity: { ...current.pixelParity, pngSha256: "missing" },
    },
    {
      ...current,
      pixelParity: { ...current.pixelParity, webpRgbaSha256: "d".repeat(64) },
    },
  ])
    expect(
      isCurrentAnnotationWebpMetadata(invalid, pngRecipeSha256, viewport),
    ).toBe(false);
});
