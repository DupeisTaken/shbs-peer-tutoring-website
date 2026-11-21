import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { beforeEach, expect, it, vi } from "vitest";
import { layoutHelpCallouts } from "~/app/help/screenshot-annotations";
import { getHelpScreenshot, getScreenshotSource } from "~/lib/help/screenshots";
import type { HelpLocale } from "~/lib/help/types";
import { renderHelpPdf } from "./pdf";

const mock = vi.hoisted(() => ({
  repeatAnnotatedStep: false,
  gallery: false,
  pagination: undefined as "grouped" | "oversized" | undefined,
  fixtureTitle: { en: "Find the control", zh: "找到控件" },
  fixtureDirections: { en: "Read the marked fields.", zh: "阅读标注的内容。" },
}));
const primary = "observe-program-step-1";
const supplemental = "observe-program-step-2";

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
                ? "admin-overview"
                : "admin-crew",
            ...(mock.pagination === "grouped"
              ? { supplementaryScreenshots: [supplemental] }
              : mock.gallery
                ? { supplementaryScreenshots: ["admin-overview"] }
                : {}),
            focus: text,
          },
          ...(mock.repeatAnnotatedStep
            ? [
                {
                  title: text,
                  body: text,
                  screenshot: "admin-overview",
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

beforeEach(() => {
  mock.repeatAnnotatedStep = false;
  mock.gallery = false;
  mock.pagination = undefined;
});

it.each(["en", "zh"] as const)(
  "renders the real %s font, image and footer without appending footer-only pages",
  async (locale) => {
    const bytes = await renderHelpPdf("observer", locale);
    const pdf = bytes.toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(pdf).toContain("/FontFile3");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/Outlines");
  },
);

it("includes a repeated step capture and its bottom-of-screen vector labels", async () => {
  mock.repeatAnnotatedStep = true;
  const bytes = await renderHelpPdf("observer", "zh");
  const pdf = bytes.toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  // The same source image still belongs to both steps. PDFKit receives each
  // original buffer rather than suppressing the second step's illustration.
  expect(pdf.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
  expect(pdf).toContain("/FontFile3");
});

it("includes every supplemental screenshot within the same numbered instruction", async () => {
  mock.gallery = true;
  const pdf = (await renderHelpPdf("observer", "en")).toString("latin1");
  expect(pdf.match(/\/Subtype \/Image\b/g)).toHaveLength(2);
  expect(pdf).toContain("/FontFile3");
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
    // Pass the original arguments through unchanged, including absolute
    // annotation coordinates on PDFKit's alternate text overload.
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
      const source = getScreenshotSource(screenshot);
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
      const scale = Math.min(
        300 / screenshot.viewport.height,
        (595.28 - 96) / screenshot.viewport.width,
      );
      for (const annotation of annotations) {
        const numbered = `${annotation.number}. ${annotation.text}`;
        if (annotation.showLabel && annotation.fontSize * scale >= 8) {
          expect(samePage).not.toContain(numbered);
          for (const line of annotation.lines) expect(samePage).toContain(line);
        } else {
          expect(samePage).toContain(numbered);
        }
      }
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
