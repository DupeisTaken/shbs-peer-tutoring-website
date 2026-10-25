import { afterEach, beforeEach, expect, it, vi } from "vitest";
import jsQR, { type QRCode } from "jsqr";
import { PNG } from "pngjs";
import { compositePng } from "~/test/composite-png";
import * as publicQrRenderer from "~/server/public-qr/render";
import { GET } from "./route";

const origin = "https://tutoring.example.edu";
const localFetch = globalThis.fetch;
const fetchUrl = (input: RequestInfo | URL) =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : input;
const targets = [
  ["tutor", "/tutor"],
  ["tutee", "/tutee"],
  ["crew", "/crew"],
  ["site", "/"],
] as const;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_URL", origin);
  // next/og initializes its bundled WASM via a data URI. Permit those local
  // bytes, but fail any network request for fallback glyphs or remote assets.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchUrl(input).startsWith("data:")) return localFetch(input, init);
      throw new Error("Unexpected network access while rendering a public QR");
    }),
  );
});

afterEach(() => {
  const fetch = globalThis.fetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const [input] of vi.mocked(fetch).mock.calls)
    expect(fetchUrl(input).startsWith("data:")).toBe(true);
});

function request(query: string, headers?: HeadersInit) {
  return new Request(`https://internal:3000/api/public-qr?${query}`, {
    headers,
  });
}

async function readPng(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  return PNG.sync.read(Buffer.from(await response.arrayBuffer()));
}

function decode(png: Pick<PNG, "data" | "width" | "height">) {
  const surface = compositePng(png);
  return jsQR(new Uint8ClampedArray(surface.data), png.width, png.height);
}

/** Average each 2x2 pixel area: verify the final image after a real reduction,
 * rather than decoding qrcode's pre-composition source or a separate SVG. */
function halfSize(png: Pick<PNG, "data" | "width" | "height">) {
  const reduced = new PNG({
    width: Math.floor(png.width / 2),
    height: Math.floor(png.height / 2),
  });
  for (let y = 0; y < reduced.height; y++) {
    for (let x = 0; x < reduced.width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            sum +=
              png.data[((y * 2 + dy) * png.width + x * 2 + dx) * 4 + channel]!;
          }
        }
        reduced.data[(y * reduced.width + x) * 4 + channel] = Math.round(
          sum / 4,
        );
      }
    }
  }
  return reduced;
}

function verifyQuietZoneAndSingleCode(png: PNG, decoded: QRCode) {
  const corners = [
    decoded.location.topLeftCorner,
    decoded.location.topRightCorner,
    decoded.location.bottomLeftCorner,
    decoded.location.bottomRightCorner,
  ];
  const left = Math.round(Math.min(...corners.map(({ x }) => x)));
  const right = Math.round(Math.max(...corners.map(({ x }) => x)));
  const top = Math.round(Math.min(...corners.map(({ y }) => y)));
  const bottom = Math.round(Math.max(...corners.map(({ y }) => y)));
  const moduleCount = decoded.version * 4 + 17;
  const scale = (right - left) / moduleCount;
  expect(scale).toBeGreaterThanOrEqual(4);
  expect(Number.isInteger(scale)).toBe(true);
  const quietZone = scale * 4;
  expect(left - quietZone).toBeGreaterThanOrEqual(0);
  expect(top - quietZone).toBeGreaterThanOrEqual(0);
  expect(right + quietZone).toBeLessThanOrEqual(png.width);
  expect(bottom + quietZone).toBeLessThanOrEqual(png.height);
  const remainder = Buffer.from(png.data);
  let quietPixelsTransparent = true;
  let transparentPixels = 0;
  let onlyBlackInk = true;
  let labelPixelCount = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const insideCode = x >= left && x < right && y >= top && y < bottom;
      const insideQuietZone =
        x >= left - quietZone &&
        x < right + quietZone &&
        y >= top - quietZone &&
        y < bottom + quietZone;
      const alpha = png.data[offset + 3]!;
      if (alpha === 0) transparentPixels++;
      else
        onlyBlackInk &&=
          png.data[offset] === 0 &&
          png.data[offset + 1] === 0 &&
          png.data[offset + 2] === 0;
      if (insideQuietZone && !insideCode)
        quietPixelsTransparent &&= alpha === 0;
      if (insideCode) remainder.fill(0, offset, offset + 4);
      else if (png.data[offset]! < 128 && png.data[offset + 3] === 255)
        labelPixelCount++;
    }
  }
  expect(
    quietPixelsTransparent,
    "all four module quiet-zone bands stay clear",
  ).toBe(true);
  expect(onlyBlackInk, "no white plate remains under the QR or text").toBe(
    true,
  );
  expect(transparentPixels).toBeGreaterThan((png.width * png.height) / 2);
  expect(png.data[3], "outer canvas is transparent").toBe(0);
  expect(
    labelPixelCount,
    "the exported raster includes visible labels",
  ).toBeGreaterThan(100);
  // jsQR can report an empty version-1 candidate from text alone. There must be
  // no second payload; the real code's complete URL is asserted independently.
  expect(decode({ ...png, data: remainder })?.data ?? "").toBe("");
}

it.each(
  targets.flatMap(([destination, path]) =>
    ["en", "zh"].map((locale) => ({ destination, path, locale })),
  ),
)(
  "exports one transparent labeled $locale $destination PNG that scans on light surfaces at half size",
  async ({ destination, path, locale }) => {
    const response = await GET(
      request(`destination=${destination}&locale=${locale}&download=1`, {
        host: "spoofed.example",
        forwarded: "host=spoofed.example;proto=http",
        "x-forwarded-host": "spoofed.example",
        "x-forwarded-proto": "http",
        origin: "https://browser.example",
        cookie: "private-session=never-export",
        authorization: "Bearer never-export",
      }),
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="shbs-${destination}-qr-${locale}.png"`,
    );
    const png = await readPng(response);
    const decoded = decode(png);
    expect(decoded?.data).toBe(`${origin}${path}`);
    verifyQuietZoneAndSingleCode(png, decoded!);
    // Verify the actual composed export on common poster surfaces, at both
    // sizes. Transparent pixels must reveal the surface rather than carry a
    // baked-in white QR plate; raw alpha is checked separately above.
    for (const background of [
      [255, 255, 255],
      [247, 240, 224],
      [226, 239, 249],
    ] as const) {
      const surface = compositePng(png, background);
      expect(decode(surface)?.data).toBe(`${origin}${path}`);
      expect(decode(halfSize(surface))?.data).toBe(`${origin}${path}`);
    }
  },
  20_000,
);

it("defaults to an English inline image and downloads the identical final raster", async () => {
  const inline = await GET(request("destination=tutee"));
  const download = await GET(request("destination=tutee&locale=en&download=1"));
  expect(inline.headers.get("Content-Disposition")).toBe(
    'inline; filename="shbs-tutee-qr-en.png"',
  );
  expect(Buffer.from(await inline.arrayBuffer())).toEqual(
    Buffer.from(await download.arrayBuffer()),
  );
});

it("regenerates against the current configured origin without carrying request parameters", async () => {
  const first = await readPng(await GET(request("destination=site")));
  expect(decode(first)?.data).toBe(`${origin}/`);
  vi.stubEnv("AUTH_URL", "https://new-school.example.edu///");
  const second = await readPng(await GET(request("destination=site")));
  expect(decode(second)?.data).toBe("https://new-school.example.edu/");
});

it.each(["en", "zh"])(
  "retains a long valid host in the final %s PNG and its half-size copy",
  async (locale) => {
    const hostname = [
      "m".repeat(63),
      "w".repeat(63),
      "m".repeat(63),
      "w".repeat(57),
      "edu",
    ].join(".");
    expect(hostname.length).toBe(253);
    vi.stubEnv("AUTH_URL", `https://${hostname}`);
    const png = await readPng(
      await GET(request(`destination=tutor&locale=${locale}`)),
    );
    const decoded = decode(png);
    expect(decoded?.data).toBe(`https://${hostname}/tutor`);
    verifyQuietZoneAndSingleCode(png, decoded!);
    expect(decode(halfSize(png))?.data).toBe(`https://${hostname}/tutor`);
  },
  20_000,
);

it.each([
  "",
  "destination=",
  "destination=admin",
  "destination=__proto__",
  "destination=constructor",
  "destination=/tutor",
  "destination=https%3A%2F%2Fevil.example",
  "destination=tutor&destination=crew",
  "destination=tutor&destination=tutor",
  "destination=tutor&locale=",
  "destination=tutor&locale=es",
  "destination=tutor&locale=ZH",
  "destination=tutor&locale=en&locale=zh",
  "destination=tutor&download=",
  "destination=tutor&download=0",
  "destination=tutor&download=1&download=1",
  "destination=tutor&url=https%3A%2F%2Fevil.example",
  "destination=tutor&path=/admin",
  "destination=tutor&filename=private.png",
  "destination=tutor&token=private-token",
  "destination=tutor&code=private-invitation",
])(
  "rejects invalid, duplicate or unrecognized export parameters: %s",
  async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.json()).toEqual({
      error: "Choose a valid public QR destination and image language.",
    });
  },
);

it.each([
  undefined,
  "",
  "not-a-url",
  "http://school.example.edu",
  "https://localhost",
  "https://LOCALHOST.",
  "https://school.localhost",
  "https://school.localhost.",
  "https://127.0.0.1",
  "https://127.0.0.1.",
  "https://127.234.5.6",
  "https://127.1",
  "https://0.0.0.0",
  "https://[::]",
  "https://[0:0:0:0:0:0:0:0]",
  "https://[::1]",
  "https://[0:0:0:0:0:0:0:1]",
  "https://[::ffff:127.0.0.1]",
  "https://[::ffff:127.234.5.6]",
  "https://[0:0:0:0:0:ffff:7f00:1]",
  "https://[::ffff:0.0.0.0]",
  "https://private-user:private-secret@internal.example.edu",
  "https://school.example.edu/private-path",
  "https://school.example.edu?secret=private-query",
  "https://school.example.edu#private-fragment",
  "javascript:alert(1)",
])(
  "fails closed with an actionable generic production configuration error: %s",
  async (configured) => {
    vi.stubEnv("AUTH_URL", configured);
    const response = await GET(request("destination=tutor"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.json()).toEqual({
      error:
        "QR export is unavailable. Ask the operator to configure AUTH_URL as the public HTTPS site origin.",
    });
  },
);

it("returns a generic failure before sending PNG headers when composition fails", async () => {
  vi.spyOn(publicQrRenderer, "renderPublicQrPng").mockRejectedValueOnce(
    new Error("Internal asset path or private deployment details"),
  );
  const response = await GET(request("destination=site&download=1"));
  expect(response.status).toBe(503);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("Content-Disposition")).toBeNull();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: "QR export is unavailable. Try again or contact the operator.",
  });
});
