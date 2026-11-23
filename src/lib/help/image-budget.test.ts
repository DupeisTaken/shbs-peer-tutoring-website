import { expect, it } from "vitest";
import {
  defaultHelpImageBudget,
  encodeWithinBudget,
  resolveHelpImageBudget,
} from "./image-budget";

it("resolves defaults and clamps environment overrides safely", () => {
  expect(resolveHelpImageBudget({})).toEqual(defaultHelpImageBudget);
  expect(
    resolveHelpImageBudget({
      HELP_IMAGE_MAX_KB: "80",
      HELP_IMAGE_QUALITY: "88",
      HELP_IMAGE_MIN_QUALITY: "76",
      HELP_IMAGE_MAX_WIDTH: "1200",
      HELP_IMAGE_CROP_PADDING_PX: "20",
    }),
  ).toEqual({
    maxWidth: 1200,
    quality: 88,
    minQuality: 76,
    maxFileBytes: 80_000,
    cropPaddingPx: 20,
  });
  // Invalid/out-of-range values fall back safely.
  expect(
    resolveHelpImageBudget({
      HELP_IMAGE_MAX_KB: "99999",
      HELP_IMAGE_QUALITY: "abc",
    }),
  ).toEqual(defaultHelpImageBudget);
});

it("steps quality down gently only when an image exceeds maxFileBytes, never below minQuality", async () => {
  const seen: number[] = [];
  const result = await encodeWithinBudget(
    async (quality) => {
      seen.push(quality);
      // Simulate smaller buffers at lower quality.
      return Buffer.alloc((quality - 60) * 5_000);
    },
    { quality: 85, minQuality: 74, maxFileBytes: 100_000 },
  );
  expect(seen).toEqual([85, 82, 79]);
  expect(result.quality).toBe(79);
  expect(result.bytes.length).toBeLessThanOrEqual(100_000);

  const floorSeen: number[] = [];
  const floored = await encodeWithinBudget(
    async (quality) => {
      floorSeen.push(quality);
      return Buffer.alloc(200_000);
    },
    { quality: 80, minQuality: 74, maxFileBytes: 50_000 },
  );
  expect(floorSeen).toEqual([80, 77, 74]);
  expect(floored.quality).toBe(74);
});
