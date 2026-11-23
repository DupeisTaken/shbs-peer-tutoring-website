/** Controllable image-size and quality budget for Help screenshots and exports.
 * Tune defaults here or via HELP_IMAGE_MAX_KB / HELP_IMAGE_QUALITY / HELP_IMAGE_MAX_WIDTH. */
export type HelpImageBudget = {
  /** Maximum output width in pixels when downscaling oversized captures. */
  maxWidth: number;
  /** Primary encoder quality (1-100). */
  quality: number;
  /** Lowest quality allowed when stepping down to meet maxFileBytes. */
  minQuality: number;
  /** Soft per-image byte ceiling; stepped down gently until met or minQuality is reached. */
  maxFileBytes: number;
  /** Padding around focused element/card crops in CSS pixels. */
  cropPaddingPx: number;
};

function positiveInt(raw: string | undefined, fallback: number, min: number, max: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export const defaultHelpImageBudget: Readonly<HelpImageBudget> = Object.freeze({
  maxWidth: 1280,
  quality: 85,
  minQuality: 74,
  maxFileBytes: 110_000,
  cropPaddingPx: 28,
});

export function resolveHelpImageBudget(
  env: Record<string, string | undefined> = process.env,
): HelpImageBudget {
  const quality = positiveInt(
    env.HELP_IMAGE_QUALITY,
    defaultHelpImageBudget.quality,
    50,
    98,
  );
  const minQuality = Math.min(
    quality,
    positiveInt(
      env.HELP_IMAGE_MIN_QUALITY,
      defaultHelpImageBudget.minQuality,
      45,
      quality,
    ),
  );
  const maxFileBytes =
    positiveInt(
      env.HELP_IMAGE_MAX_KB,
      Math.round(defaultHelpImageBudget.maxFileBytes / 1000),
      20,
      500,
    ) * 1000;
  const maxWidth = positiveInt(
    env.HELP_IMAGE_MAX_WIDTH,
    defaultHelpImageBudget.maxWidth,
    640,
    1920,
  );
  const cropPaddingPx = positiveInt(
    env.HELP_IMAGE_CROP_PADDING_PX,
    defaultHelpImageBudget.cropPaddingPx,
    0,
    96,
  );
  return { maxWidth, quality, minQuality, maxFileBytes, cropPaddingPx };
}

/** Encode via a caller-supplied codec function, stepping quality down in small
 * increments only when an outlier exceeds maxFileBytes, never below minQuality. */
export async function encodeWithinBudget(
  encodeAtQuality: (quality: number) => Promise<Buffer>,
  budget: Pick<HelpImageBudget, "quality" | "minQuality" | "maxFileBytes"> = defaultHelpImageBudget,
): Promise<{ bytes: Buffer; quality: number }> {
  let quality = budget.quality;
  let bytes = await encodeAtQuality(quality);
  while (bytes.length > budget.maxFileBytes && quality > budget.minQuality) {
    quality = Math.max(budget.minQuality, quality - 3);
    bytes = await encodeAtQuality(quality);
  }
  return { bytes, quality };
}
