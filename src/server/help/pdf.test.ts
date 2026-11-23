import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { layoutHelpCallouts } from "~/app/help/screenshot-annotations";
import type * as ScreenshotsModule from "~/lib/help/screenshots";
import type { HelpScreenshot } from "~/lib/help/screenshots";
import { getHelpScreenshot, getScreenshotSource } from "~/lib/help/screenshots";
import type { HelpLocale } from "~/lib/help/types";
import { pdfImageHeight, renderHelpPdf } from "./pdf";

const primary = "observe-program-step-1";
const supplemental = "observe-program-step-2";
const simple = "account-emails-step-1";

const mock = vi.hoisted(() => ({
  repeatAnnotatedStep: false,
  gallery: false,
  noScreenshots: false,
  pagination: undefined as "grouped" | "oversized" | undefined,
  fixtureTitle: { en: "Find the control", zh: "找到控件" },
  fixtureDirections: { en: "Read the marked fields.", zh: "阅读标注的内容。" },
  fixtures: new Map<string, { meta: HelpScreenshot; bytes: Buffer }>(),
}));

const oversizedDirections = (locale: HelpLocale) =>
  Array.from(
    { length: 54 },
    (_, index) => `${index + 1}. ${mock.fixtureDirections[locale]}`,
  ).join("\n");

vi.mock("~/lib/help/catalogue", () => {
  const text = { en: "Read guide", zh: "查看指南" };
  return {
    helpArticles: [],
    helpAudienceTitles: { observer: text },
    handbookArticles: () => [
      {
        slug: "short-guide",
        audience: "observer",
        title: text,
        summary:
          mock.pagination === "grouped"
            ? {
                en: "Read these prerequisites.\n".repeat(12).trimEnd(),
                zh: "请先阅读准备事项。\n".repeat(12).trimEnd(),
              }
            : text,
        route: "/help",
        prerequisites: [text],
        steps: [
          {
            title: mock.pagination ? mock.fixtureTitle : text,
            body:
              mock.pagination === "oversized"
                ? {
                    en: oversizedDirections("en"),
                    zh: oversizedDirections("zh"),
                  }
                : mock.pagination
                  ? mock.fixtureDirections
                  : { en: "中文", zh: "中文" },
            screenshot: mock.pagination
              ? primary
              : mock.repeatAnnotatedStep || mock.gallery
                ? primary
                : simple,
            ...(mock.pagination === "grouped" || mock.gallery
              ? { supplementaryScreenshots: [supplemental] }
              : {}),
            ...(!mock.pagination && !mock.repeatAnnotatedStep && !mock.gallery
              ? { callouts: [] }
              : {}),
            focus: text,
          },
          ...(mock.repeatAnnotatedStep
            ? [
                {
                  title: text,
                  body: text,
                  screenshot: primary,
                  focus: text,
                  callouts: [
                    {
                      bounds: { x: 0.8, y: 0.86, width: 0.1, height: 0.06 },
                      label: text,
                    },
                  ],
                },
              ]
            : []),
        ],
        expected: text,
        explanation: [text],
        troubleshooting: [{ problem: text, solution: text }],
      },
    ],
  };
});

vi.mock("~/lib/help/screenshots", async (importOriginal) => {
  const actual = await importOriginal<typeof ScreenshotsModule>();
  return {
    ...actual,
    getHelpScreenshot: (id: string) =>
      mock.noScreenshots ? undefined : mock.fixtures.get(id)?.meta,
  };
});

vi.mock("./assets", () => ({
  readScreenshot: async (screenshot: HelpScreenshot) => {
    const entry = mock.fixtures.get(screenshot.id);
    if (!entry) throw new Error(`Missing fixture ${screenshot.id}`);
    return entry.bytes;
  },
}));

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve("next/package.json"));
  const sharp = nextRequire("sharp") as (opts: {
    create: {
      width: number;
      height: number;
      channels: number;
      background: { r: number; g: number; b: number };
    };
  }) => { jpeg: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> } };

  const makeFixture = async (
    id: string,
    width: number,
    height: number,
    callouts: HelpScreenshot["callouts"],
  ) => {
    const bytes = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 248, g: 250, b: 252 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    mock.fixtures.set(id, {
      bytes,
      meta: {
        id,
        file: `${id}.en.jpg`,
        route: "/observe",
        locale: "en",
        capturedAt: "2026-11-23T00:00:00Z",
        viewport: { width, height },
        browserViewport: { width, height },
        captureMode: "viewport",
        role: "OBSERVER",
        sha256,
        sourceRevision: "8540496ad9f7c9e64c436270e5e466724c58bb81",
        sourceLabel: "Synthetic test fixture",
        state: { en: "Observer view is open", zh: "观察者视图已打开" },
        callouts,
      },
    });
  };

  await makeFixture(primary, 1280, 800, [
    {
      bounds: { x: 0.12, y: 0.2, width: 0.25, height: 0.08 },
      label: { en: "Check summary", zh: "查看摘要" },
    },
    {
      bounds: { x: 0.55, y: 0.45, width: 0.22, height: 0.08 },
      label: { en: "Inspect schedule", zh: "查看安排" },
    },
  ]);
  await makeFixture(supplemental, 1280, 800, [
    {
      bounds: { x: 0.15, y: 0.25, width: 0.3, height: 0.08 },
      label: { en: "Review log", zh: "查看记录" },
    },
    {
      bounds: { x: 0.6, y: 0.6, width: 0.2, height: 0.08 },
      label: { en: "Verify status", zh: "确认状态" },
    },
  ]);
  await makeFixture(simple, 1280, 720, []);
});

beforeEach(() => {
  mock.repeatAnnotatedStep = false;
  mock.gallery = false;
  mock.noScreenshots = false;
  mock.pagination = undefined;
});

it.each(["en", "zh"] as const)(
  "renders Geist and Noto Sans SC fonts, image and footer cleanly for %s",
  async (locale) => {
    const bytes = await renderHelpPdf("observer", locale);
    const pdf = bytes.toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    // Cover + guide + Capture sources (or 2 pages if Capture sources fits); footer must not append pages.
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeLessThanOrEqual(3);
    expect(pdf).toContain("/FontFile2"); // Geist TrueType
    expect(pdf).toContain("/FontFile3"); // Noto Sans SC OpenType/CFF
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/Outlines");
  },
);

it("renders clean text-only handbooks when CI-baked screenshots are absent locally", async () => {
  mock.noScreenshots = true;
  const bytes = await renderHelpPdf("observer", "en");
  const pdf = bytes.toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf).toContain("/FontFile2");
  expect(pdf).not.toContain("/Subtype /Image");
});

it("includes a repeated step capture and its bottom-of-screen vector labels", async () => {
  mock.repeatAnnotatedStep = true;
  const bytes = await renderHelpPdf("observer", "zh");
  const pdf = bytes.toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
  expect(pdf).toContain("/FontFile3");
});

it("includes every supplemental screenshot within the same numbered instruction", async () => {
  mock.gallery = true;
  const pdf = (await renderHelpPdf("observer", "en")).toString("latin1");
  expect(pdf.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
  expect(pdf).toContain("/FontFile2");
});

async function traceRendering(locale: HelpLocale) {
  const text: { value: string; page: number; finishPage: number }[] = [];
  const images: { page: number; sha256: string }[] = [];
  const prototype = PDFDocument.prototype as Pick<
    PDFKit.PDFDocument,
    "text" | "image"
  >;
  const writeText = prototype.text;
  const drawImage = prototype.image;
  const textSpy = vi.spyOn(prototype, "text").mockImplementation(function (
    this: PDFKit.PDFDocument,
    ...args
  ) {
    const page = this.page.dictionary.id;
    const result = Reflect.apply(writeText, this, args);
    text.push({ value: args[0], page, finishPage: this.page.dictionary.id });
    return result;
  });
  const imageSpy = vi.spyOn(prototype, "image").mockImplementation(function (
    this: PDFKit.PDFDocument,
    ...args
  ) {
    const source = args[0];
    if (!Buffer.isBuffer(source))
      throw new Error("Expected original JPEG bytes");
    images.push({
      page: this.page.dictionary.id,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
    return Reflect.apply(drawImage, this, args);
  });
  try {
    await renderHelpPdf("observer", locale);
    return {
      images,
      text,
      completeRowsOn: (page: number) =>
        text
          .filter((row) => row.page === page && row.finishPage === page)
          .map((row) => row.value),
    };
  } finally {
    textSpy.mockRestore();
    imageSpy.mockRestore();
  }
}

it.each(["en", "zh"] as const)(
  "keeps the %s step and figure together and identifies the supplemental continuation",
  async (locale) => {
    mock.pagination = "grouped";
    const rendered = await traceRendering(locale);
    expect(rendered.images).toHaveLength(2);
    const first = rendered.images[0]!;
    const second = rendered.images[1]!;
    expect(first.page).not.toBe(second.page);

    const firstPage = rendered.completeRowsOn(first.page);
    expect(firstPage).toContain(locale === "zh" ? "操作步骤" : "Walkthrough");
    expect(firstPage).toContain(`1. ${mock.fixtureTitle[locale]}`);
    expect(firstPage).toContain(mock.fixtureDirections[locale]);
    expect(firstPage).toContain(locale === "zh" ? "视图 1" : "View 1");
    expect(rendered.completeRowsOn(second.page)).toContain(
      locale === "zh" ? "步骤 1 · 视图 2（续）" : "Step 1 · View 2 (continued)",
    );

    for (const [index, id] of [primary, supplemental].entries()) {
      const screenshot = getHelpScreenshot(id, locale)!;
      const draw = rendered.images[index]!;
      const source = getScreenshotSource(screenshot, locale);
      const annotations = layoutHelpCallouts(
        { title: mock.fixtureTitle, body: mock.fixtureDirections },
        screenshot,
        locale,
      );
      const samePage = rendered.completeRowsOn(draw.page);
      expect(draw.sha256).toBe(screenshot.sha256);
      expect(annotations.length).toBeGreaterThanOrEqual(2);
      expect(samePage).not.toContain(screenshot.state?.[locale]);
      expect(samePage).toContain(
        `${screenshot.route} · ${screenshot.locale.toUpperCase()} · ${screenshot.capturedAt.slice(0, 10)} · ${source.revision.slice(0, 12)}`,
      );
      expect(
        rendered.text.filter(
          ({ value }) => value === `${source.revision} · ${source.label}`,
        ),
      ).toHaveLength(1);
    }
  },
);

it("allows an oversized step to flow before its named figure continuation", async () => {
  mock.pagination = "oversized";
  const rendered = await traceRendering("en");
  expect(rendered.images).toHaveLength(1);
  const prose = rendered.text.find(
    (row) => row.value === oversizedDirections("en"),
  );
  expect(prose?.page).toBeDefined();
  expect(prose?.finishPage).not.toBe(prose?.page);
  expect(rendered.completeRowsOn(rendered.images[0]!.page)).toContain(
    "Step 1 · View 1 (continued)",
  );
});

it("gives tall full-page screenshots full-page vertical height instead of microscopic 300pt thumbnails", () => {
  const width = 595.28 - 100;
  const pageHeight = 841.89 - 100;
  const landscape = pdfImageHeight(
    { width: 1440, height: 1001 },
    width,
    pageHeight,
    "viewport",
  );
  expect(landscape).toBe(300);
  const fullPage = pdfImageHeight(
    { width: 1265, height: 2835 },
    width,
    pageHeight,
    "full-page",
  );
  expect(fullPage).toBeGreaterThan(600);
  expect((fullPage * 1265) / 2835).toBeGreaterThan(260);
});
