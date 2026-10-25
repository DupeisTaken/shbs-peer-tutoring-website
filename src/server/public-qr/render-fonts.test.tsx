import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { PNG } from "pngjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderPublicQrPng } from "./render";

const localFetch = globalThis.fetch;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("data:"))
      throw new Error("Font rendering must stay offline");
    return localFetch(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Compare actual glyph pixels, not just a configured CSS family: a fallback
 * can silently draw a different font even when the requested family is correct. */
async function expectWebsiteText(
  png: PNG,
  text: string,
  top: number,
  height: number,
  fontSize: number,
) {
  const geist = await readFile(
    "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
  );
  const reference = new ImageResponse(
    <div
      style={{
        display: "flex",
        width: png.width,
        height: png.height,
        position: "relative",
        fontFamily: "Website Sans",
        fontWeight: 400,
        color: "#000000",
        backgroundColor: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 32,
          top,
          width: 736,
          height,
          alignItems: "center",
          justifyContent: "center",
          fontSize,
          lineHeight: 1.3,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>,
    {
      width: png.width,
      height: png.height,
      fonts: [
        { name: "Website Sans", data: geist, style: "normal", weight: 400 },
      ],
    },
  );
  const expected = PNG.sync.read(Buffer.from(await reference.arrayBuffer()));
  const crop = (image: PNG) =>
    Buffer.concat(
      Array.from({ length: height }, (_, row) => {
        const start = ((top + row) * png.width + 32) * 4;
        return image.data.subarray(start, start + 736 * 4);
      }),
    );
  expect(
    crop(png).equals(crop(expected)),
    `Website Geist glyphs for ${text}`,
  ).toBe(true);
}

it.each(["en", "zh"] as const)(
  "uses the website's Geist glyphs for Latin text in the %s export",
  async (locale) => {
    const png = PNG.sync.read(
      Buffer.from(
        await renderPublicQrPng({
          destination: "tutor",
          locale,
          url: "https://tutoring.example.edu/tutor",
        }),
      ),
    );
    if (locale === "en")
      await expectWebsiteText(png, "Tutor signup", 32, 72, 44);
    // Both locales use Geist for the complete URL, including beneath CJK labels.
    await expectWebsiteText(
      png,
      "https://tutoring.example.edu/",
      png.height - 104,
      32,
      22,
    );
    await expectWebsiteText(png, "tutor", png.height - 72, 32, 22);
  },
);
