import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import jsQR from "jsqr";

const origin = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const publicOrigin = new URL(process.env.AUTH_URL).origin;
// Exercise the shipped image, not the source renderer: missing traced font files
// must fail the deployment gate, including after recreating the container.
for (const locale of ["en", "zh"]) {
  for (const destination of ["tutor", "tutee", "crew", "site"]) {
    test(`shipped ${locale} ${destination} PNG has local fonts and scans`, async () => {
      const response = await fetch(
        `${origin}/api/public-qr?destination=${destination}&locale=${locale}`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
      assert.equal(png.data[3], 0, "export background stays transparent");
      // Scanners see the displayed image; composite a test copy on white.
      const displayed = Buffer.from(png.data);
      for (let offset = 0; offset < displayed.length; offset += 4) {
        const alpha = displayed[offset + 3] / 255;
        for (let channel = 0; channel < 3; channel++)
          displayed[offset + channel] = Math.round(
            displayed[offset + channel] * alpha + 255 * (1 - alpha),
          );
        displayed[offset + 3] = 255;
      }
      assert.equal(
        jsQR(new Uint8ClampedArray(displayed), png.width, png.height)?.data,
        `${publicOrigin}/${destination === "site" ? "" : destination}`,
      );
    });
  }
}
