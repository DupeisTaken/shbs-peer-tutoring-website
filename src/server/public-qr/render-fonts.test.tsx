import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { PNG } from "pngjs";
import ts from "typescript";
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
      36,
      26,
    );
    await expectWebsiteText(png, "tutor", png.height - 68, 36, 26);
  },
);

it.each(["en", "zh"] as const)(
  "keeps the enlarged %s URL inside clear side gutters with a maximum-length wide hostname",
  async (locale) => {
    // Wide lowercase glyphs stress the actual font, unlike a long run of narrow
    // letters. Every URL row must have visible ink and retain both side gutters.
    const hostname = [
      "m".repeat(63),
      "w".repeat(63),
      "m".repeat(63),
      "w".repeat(57),
      "edu",
    ].join(".");
    expect(hostname).toHaveLength(253);
    const png = PNG.sync.read(
      Buffer.from(
        await renderPublicQrPng({
          destination: "tutor",
          locale,
          url: `https://${hostname}/tutor`,
        }),
      ),
    );
    let clearGutters = true;
    let footerInk = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const alpha = png.data[(y * png.width + x) * 4 + 3]!;
        if (x < 32 || x >= png.width - 32) clearGutters &&= alpha === 0;
        if (y >= png.height - 104 && alpha > 0) footerInk++;
      }
    }
    expect(
      clearGutters,
      "wide URL glyphs never clip into the 32px side gutters",
    ).toBe(true);
    expect(footerInk, "complete footer remains visible").toBeGreaterThan(100);
  },
);

type NodeFileTrace = (
  files: string[],
  options: {
    base: string;
    processCwd: string;
    ignore?: string[];
  },
) => Promise<{ fileList: Set<string> }>;

function loadNodeFileTrace(): NodeFileTrace {
  const loadCjs = createRequire(import.meta.url);
  const nft: unknown = loadCjs("next/dist/compiled/@vercel/nft");
  if (
    typeof nft !== "object" ||
    nft === null ||
    !("nodeFileTrace" in nft) ||
    typeof nft.nodeFileTrace !== "function"
  ) {
    throw new Error("Expected nodeFileTrace export from Next's bundled NFT");
  }
  return nft.nodeFileTrace as NodeFileTrace;
}

it("traces only the two packaged fonts and never local ignored evidence directories", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "shbs-public-qr-nft-"));
  try {
    const source = await readFile(
      join(process.cwd(), "src/server/public-qr/render.tsx"),
      "utf8",
    );
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;

    const modulePath = join(fixtureDir, "src/server/public-qr/render.js");
    await mkdir(join(fixtureDir, "src/server/public-qr"), { recursive: true });
    await writeFile(modulePath, transpiled, "utf8");
    await writeFile(
      join(fixtureDir, "src/server/public-qr/url-lines.js"),
      "export function publicQrUrlLines(url) { return [url]; }\n",
      "utf8",
    );

    const expectedFonts = [
      "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
      "public/fonts/public-qr/shbs-public-qr.otf",
    ];
    const ignoredEvidence = [
      "outputs/sentinel.png",
      ".validation/sentinel.log",
      "local-operations/sentinel.txt",
      "backups/sentinel.sql",
      "coverage/sentinel.json",
      ".env",
    ];
    for (const rel of [...expectedFonts, ...ignoredEvidence]) {
      const full = join(fixtureDir, rel);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, "synthetic-sentinel", "utf8");
    }

    const nodeFileTrace = loadNodeFileTrace();
    const result = await nodeFileTrace([modulePath], {
      base: fixtureDir,
      processCwd: fixtureDir,
      ignore: [
        "node_modules/next/**",
        "node_modules/qrcode/**",
        "node_modules/react/**",
      ],
    });
    const traced = [...result.fileList].map((entry) =>
      entry.replaceAll("\\", "/"),
    );

    for (const font of expectedFonts) {
      expect(traced).toContain(font);
    }
    for (const sentinel of ignoredEvidence) {
      expect(traced).not.toContain(sentinel);
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
