import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HelpArticle } from "./types";
import type { HelpScreenshot } from "./screenshots";
import { validateScreenshotState } from "./screenshots";
import {
  directionsSha256,
  jpegDimensions,
  validateCaptureReceipt,
  validateStepCaptureCoverage,
} from "../../../scripts/help-capture-validation";
import {
  assembleHelpFontCorpus,
  getHelpFontCorpus,
} from "../../../scripts/help-font-corpus";

const title = { en: "Save the reviewed change", zh: "保存已审阅变更" };
const body = {
  en: "Review this exact record, then choose Save.",
  zh: "检查此准确记录后选择保存。",
};
const article: HelpArticle = {
  slug: "review-change",
  audience: "staff",
  title,
  summary: title,
  route: "/admin",
  prerequisites: [title],
  steps: [{ title, body, screenshot: "review-change-step-1" }],
  expected: title,
  explanation: [title],
  troubleshooting: [{ problem: title, solution: body }],
  sources: [],
  covers: [],
};

function frame(): HelpScreenshot & {
  review: { acceptedAt: string; method: string };
} {
  return {
    id: "review-change-step-1",
    file: "review-change-step-1.en.jpg",
    locale: "en",
    role: "HEAD",
    route: "/admin",
    capturedAt: "2026-11-16T00:00:00Z",
    viewport: { width: 1265, height: 712 },
    browserViewport: { width: 1280, height: 720 },
    captureMode: "viewport",
    sha256: "a".repeat(64),
    sourceRevision: "b".repeat(40),
    sourceLabel: "Reviewed development baseline",
    state: {
      en: "The exact change review is visible",
      zh: "准确变更审阅已显示",
    },
    stepBinding: {
      guide: article.slug,
      step: 1,
      title,
      directionsSha256: directionsSha256(body),
    },
    callouts: [
      {
        bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.08 },
        label: { en: "Save", zh: "保存" },
      },
    ],
    review: {
      acceptedAt: "2026-11-16T00:00:10Z",
      method: "Inspected the saved full browser frame and targets",
    },
  };
}

describe("exact full-step capture coverage", () => {
  it("rejects malformed bilingual captions at the shared read boundary", () => {
    for (const state of [
      "English caption only",
      null,
      { en: "Saved" },
      { en: " ", zh: "已保存" },
    ]) {
      expect(() =>
        validateScreenshotState({ id: "example", locale: "en", state }),
      ).toThrow("Screenshot state requires English and Chinese: example:en");
    }
    expect(() =>
      validateScreenshotState({ id: "legacy", locale: "en" }),
    ).not.toThrow();
    expect(() =>
      validateScreenshotState({
        id: "example", locale: "en", state: { en: "Saved", zh: "已保存" },
      }),
    ).not.toThrow();
  });
  it("counts every actual instruction and rejects overview substitution by default", () => {
    expect(() =>
      validateStepCaptureCoverage(
        [
          {
            ...article,
            steps: [{ title, body, screenshot: "admin-overview" }],
          },
        ],
        [],
      ),
    ).toThrow("0/1");
    expect(
      validateStepCaptureCoverage([article], [], { allowPending: true }),
    ).toEqual({
      steps: 1,
      illustrated: 0,
      missing: ["review-change-step-1: Save the reviewed change"],
    });
  });

  it("accepts an exactly bound reviewed frame and explicit English fallback", () => {
    expect(validateStepCaptureCoverage([article], [frame()])).toEqual({
      steps: 1,
      illustrated: 1,
      missing: [],
    });
  });

  it.each(["guide", "ordinal", "title", "directions"])(
    "rejects stale %s binding even in authoring mode",
    (change) => {
      const capture = frame();
      if (change === "guide") capture.stepBinding!.guide = "another-guide";
      if (change === "ordinal") capture.stepBinding!.step = 2;
      if (change === "title")
        capture.stepBinding!.title = { ...title, zh: "不同标题" };
      if (change === "directions")
        capture.stepBinding!.directionsSha256 = "c".repeat(64);
      expect(() =>
        validateStepCaptureCoverage([article], [capture], {
          allowPending: true,
        }),
      ).toThrow("exact step binding");
    },
  );

  it("does not attach an exact frame through an obsolete overview reference", () => {
    expect(() =>
      validateStepCaptureCoverage(
        [
          {
            ...article,
            steps: [{ ...article.steps[0]!, screenshot: "admin-overview" }],
          },
        ],
        [frame()],
      ),
    ).toThrow("not bound to its exact capture");
  });

  it("rejects a reordered/orphan frame and a missing English fallback", () => {
    expect(() => validateStepCaptureCoverage([], [frame()])).toThrow(
      "missing or reordered",
    );
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...frame(), locale: "zh", file: "review-change-step-1.zh.jpg" }],
      ),
    ).toThrow("0/1");
  });

  it("rejects presentation crops, unreviewed targets and incomplete source/state", () => {
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...frame(), crop: { x: 1, y: 1, width: 1265, height: 712 } }],
      ),
    ).toThrow("full viewport");
    expect(() =>
      validateStepCaptureCoverage([article], [{ ...frame(), callouts: [] }]),
    ).toThrow("in-image labels");
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...frame(), sourceRevision: undefined }],
      ),
    ).toThrow("per-image source");
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...frame(), state: { en: "Saved", zh: "" } }],
      ),
    ).toThrow("bilingual state");
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [
          {
            ...frame(),
            review: { acceptedAt: "2026-11-15T23:59:00Z", method: "Checked" },
          },
        ],
      ),
    ).toThrow("review after capture");
  });

  it("allows full-page height beyond the visible browser viewport without accepting a crop", () => {
    const capture = {
      ...frame(),
      captureMode: "full-page" as const,
      viewport: { width: 1265, height: 3200 },
    };
    expect(validateStepCaptureCoverage([article], [capture]).illustrated).toBe(
      1,
    );
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...capture, viewport: { width: 1265, height: 300 } }],
      ),
    ).toThrow("omits part");
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...capture, captureMode: undefined }],
      ),
    ).toThrow("capture mode");
  });

  it("accepts an explicitly cropped focused step capture with valid bounds", () => {
    const cropped = {
      ...frame(),
      captureMode: "cropped" as const,
      browserViewport: { width: 1280, height: 800 },
      crop: { x: 240, y: 60, width: 800, height: 620 },
      viewport: { width: 800, height: 620 },
    };
    expect(validateStepCaptureCoverage([article], [cropped]).illustrated).toBe(
      1,
    );
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...cropped, crop: { x: 900, y: 60, width: 800, height: 620 } }],
      ),
    ).toThrow("valid crop bounds");
  });

  it("allows a native scrollbar's bounded CSS width on mobile, without widening crop tolerance", () => {
    const capture = {
      ...frame(),
      browserViewport: { width: 390, height: 844 },
      viewport: { width: 375, height: 844 },
    };
    expect(validateStepCaptureCoverage([article], [capture]).illustrated).toBe(
      1,
    );
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [{ ...capture, viewport: { width: 340, height: 844 } }],
      ),
    ).toThrow("aspect differs");
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [
          {
            ...capture,
            browserViewport: { width: 1440, height: 1000 },
            viewport: { width: 1360, height: 1000 },
          },
        ],
      ),
    ).toThrow("aspect differs");
  });

  it("rejects a small percentage crop beyond the native scrollbar allowance", () => {
    for (const viewport of [
      { width: 1410, height: 1000 },
      { width: 1460, height: 1000 },
    ]) {
      expect(() =>
        validateStepCaptureCoverage(
          [article],
          [{ ...frame(), browserViewport: { width: 1440, height: 1000 }, viewport }],
        ),
      ).toThrow("aspect differs");
    }
    expect(
      validateStepCaptureCoverage(
        [article],
        [{ ...frame(), viewport: { width: 2530, height: 1423 } }],
      ).illustrated,
    ).toBe(1);
  });

  it("binds both direction languages canonically and invalidates changed wording", () => {
    expect(directionsSha256({ zh: body.zh, en: body.en })).toBe(
      directionsSha256(body),
    );
    expect(directionsSha256({ ...body, zh: body.zh + "核对。" })).not.toBe(
      directionsSha256(body),
    );
  });

  it("requires each supplemental view to keep its own exact binding and reviewed labels", () => {
    const supplementary = {
      ...frame(),
      id: "review-change-step-1-view-2",
      file: "review-change-step-1-view-2.en.jpg",
    };
    const gallery = {
      ...article,
      steps: [
        {
          ...article.steps[0]!,
          supplementaryScreenshots: [supplementary.id],
          callouts: [
            {
              bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 },
              label: title,
            },
          ],
        },
      ],
    };
    expect(
      validateStepCaptureCoverage([gallery], [frame(), supplementary])
        .illustrated,
    ).toBe(1);
    expect(() => validateStepCaptureCoverage([gallery], [frame()])).toThrow(
      "view-2",
    );
    expect(() =>
      validateStepCaptureCoverage(
        [gallery],
        [frame(), { ...supplementary, callouts: [] }],
      ),
    ).toThrow("in-image labels");
    expect(() =>
      validateStepCaptureCoverage(
        [gallery],
        [
          frame(),
          {
            ...supplementary,
            stepBinding: {
              ...supplementary.stepBinding!,
              directionsSha256: "c".repeat(64),
            },
          },
        ],
      ),
    ).toThrow("exact step binding");
    expect(() =>
      validateStepCaptureCoverage(
        [gallery],
        [
          frame(),
          { ...supplementary, crop: { x: 1, y: 1, width: 100, height: 100 } },
        ],
      ),
    ).toThrow("full viewport");
  });

  it("rejects unrelated, duplicate, missing-number and undeclared gallery views", () => {
    for (const ids of [
      ["another-guide-step-1-view-2"],
      ["review-change-step-1-view-3"],
      ["review-change-step-1-view-2", "review-change-step-1-view-2"],
    ]) {
      const gallery = {
        ...article,
        steps: [{ ...article.steps[0]!, supplementaryScreenshots: ids }],
      };
      expect(() => validateStepCaptureCoverage([gallery], [frame()])).toThrow(
        "unique, ordered views",
      );
    }
    expect(() =>
      validateStepCaptureCoverage(
        [article],
        [frame(), { ...frame(), id: "review-change-step-1-view-2" }],
      ),
    ).toThrow("missing or reordered");
  });
});

describe("capture bitmap integrity", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 2, 200, 4, 241, 1, 0xff, 0xd9,
  ]);
  it("reads real frame dimensions without image decoding", () => {
    expect(jpegDimensions(jpeg)).toEqual({ width: 1265, height: 712 });
    const capture = {
      ...frame(),
      sha256: createHash("sha256").update(jpeg).digest("hex"),
    };
    expect(() => validateCaptureReceipt(capture, jpeg)).not.toThrow();
    expect(() =>
      validateCaptureReceipt(
        { ...capture, viewport: { width: 1265, height: 713 } },
        jpeg,
      ),
    ).toThrow("dimensions differ");
    expect(() =>
      validateCaptureReceipt({ ...capture, sha256: "b".repeat(64) }, jpeg),
    ).toThrow("bytes differ");
  });
  it("rejects a missing/truncated frame, path mismatch and credential query", () => {
    expect(() =>
      jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 8])),
    ).toThrow("Truncated");
    expect(() =>
      jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])),
    ).toThrow("missing");
    const capture = {
      ...frame(),
      sha256: createHash("sha256").update(jpeg).digest("hex"),
    };
    expect(() =>
      validateCaptureReceipt({ ...capture, file: "../private.en.jpg" }, jpeg),
    ).toThrow("filename");
    expect(() =>
      validateCaptureReceipt(
        { ...capture, route: "/reset-password?token=private" },
        jpeg,
      ),
    ).toThrow("Unsafe published capture route");
  });
});

it("uses decoded capture metadata and the maintained caption controls in the font corpus", async () => {
  const escaped = JSON.parse(
    '{"state":"\\u9f98","callouts":[{"label":"\\u6807\\u6ce8"}]}',
  ) as unknown;
  expect(assembleHelpFontCorpus(escaped, ["Fixed PDF label"])).toContain("龘");
  const corpus = await getHelpFontCorpus();
  expect(corpus).toContain("Capture details");
  expect(corpus).toContain("截图详情");
  expect(corpus).toContain("screenshots");
  expect(corpus).toContain("Capture source");
});
