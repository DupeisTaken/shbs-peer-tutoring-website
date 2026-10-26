import type { PNG } from "pngjs";

/** A scanner sees a PNG on its display/print surface, not uncomposited RGB
 * values in fully transparent pixels. Keep the exported alpha intact and blend
 * only a test copy onto the chosen background before decoding it. */
export function compositePng(
  png: Pick<PNG, "data" | "width" | "height">,
  background: readonly [number, number, number] = [255, 255, 255],
) {
  const data = Buffer.from(png.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]! / 255;
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.round(
        data[offset + channel]! * alpha + background[channel]! * (1 - alpha),
      );
    }
    data[offset + 3] = 255;
  }
  return { width: png.width, height: png.height, data };
}
