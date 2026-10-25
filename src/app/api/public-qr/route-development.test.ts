import { afterEach, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { compositePng } from "~/test/composite-png";
import { GET } from "./route";

// next/og initializes CSS parsing for the process mode. Keep development renders
// in their own module lifetime, as a real development server would do.
afterEach(() => vi.unstubAllEnvs());

it.each([
  [undefined, "http://localhost:3000/crew"],
  ["http://localhost:3046", "http://localhost:3046/crew"],
])(
  "uses a configured development origin or local fallback: %s",
  async (configured, expected) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_URL", configured);
    const response = await GET(
      new Request("http://spoofed.internal/api/public-qr?destination=crew"),
    );
    expect(response.status).toBe(200);
    const png = compositePng(
      PNG.sync.read(Buffer.from(await response.arrayBuffer())),
    );
    expect(
      jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    ).toBe(expected);
  },
);
