// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HelpScreenshot } from "~/lib/help/screenshots";
import {
  getScreenshotSource,
  getStepCallouts,
  helpCaptureInfo,
} from "~/lib/help/screenshots";
import type { HelpBounds, HelpCallout, HelpStep } from "~/lib/help/types";
import { AnnotatedScreenshot } from "./annotated-screenshot";
import {
  layoutHelpCallouts,
  validateHelpCallouts,
} from "./screenshot-annotations";

const text = { en: "Choose Save", zh: "选择保存" };
const callout: HelpCallout = {
  bounds: { x: 0.2, y: 0.3, width: 0.15, height: 0.08 },
  label: text,
};
const screenshot: HelpScreenshot = {
  id: "reviewed-step",
  file: "reviewed-step.en.jpg",
  route: "/my-account",
  locale: "en",
  capturedAt: "2026-11-16T00:00:00Z",
  viewport: { width: 1000, height: 800 },
  role: "TUTOR",
  sha256: "a".repeat(64),
  callouts: [callout],
};
const step: HelpStep = { title: text, body: text, screenshot: screenshot.id };

function badgeClearsRectangle(
  badge: { x: number; y: number; radius: number },
  rectangle: HelpBounds,
) {
  const nearestX = Math.max(
    rectangle.x,
    Math.min(badge.x, rectangle.x + rectangle.width),
  );
  const nearestY = Math.max(
    rectangle.y,
    Math.min(badge.y, rectangle.y + rectangle.height),
  );
  return (
    Math.hypot(badge.x - nearestX, badge.y - nearestY) >=
    badge.radius + 2 - 1e-6
  );
}

afterEach(cleanup);

describe("reviewed screenshot annotation geometry", () => {
  it.each([
    { x: -0.1, y: 0.1, width: 0.1, height: 0.1 },
    { x: 0.9, y: 0.1, width: 0.2, height: 0.1 },
    { x: 0.1, y: 0.95, width: 0.1, height: 0.1 },
    { x: 0.1, y: 0.1, width: 0, height: 0.1 },
    { x: Number.NaN, y: 0.1, width: 0.1, height: 0.1 },
  ])(
    "rejects invalid target bounds %j rather than guessing a control",
    (bounds) => {
      expect(() => validateHelpCallouts([{ ...callout, bounds }])).toThrow(
        "bounds must fit",
      );
    },
  );

  it("requires bilingual labels and finite reviewed label positions", () => {
    expect(() =>
      validateHelpCallouts([{ ...callout, label: { en: "Save", zh: "" } }]),
    ).toThrow("English and Chinese");
    expect(() =>
      validateHelpCallouts([
        { ...callout, labelPosition: { x: Number.POSITIVE_INFINITY, y: 0 } },
      ]),
    ).toThrow("label positions");
    expect(() =>
      validateHelpCallouts(Array.from({ length: 13 }, () => callout)),
    ).toThrow("twelve");
  });

  it("renders complete one-character Chinese field labels while rejecting blank translations", () => {
    for (const [en, zh] of [
      ["First name", "名"],
      ["Last name", "姓"],
    ] as const) {
      const field = { ...callout, label: { en, zh } };
      expect(() => validateHelpCallouts([field])).not.toThrow();
      expect(
        layoutHelpCallouts({ ...step, callouts: [field] }, screenshot, "zh")[0]
          ?.text,
      ).toBe(zh);
    }
    for (const label of [
      { en: "First name", zh: " \t" },
      { en: " ", zh: "名" },
    ])
      expect(() => validateHelpCallouts([{ ...callout, label }])).toThrow(
        "English and Chinese",
      );
  });

  it("uses the actual image locale for bounds while translating the label", () => {
    const localized = {
      ...callout,
      boundsByLocale: {
        en: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
        zh: { x: 0.6, y: 0.5, width: 0.2, height: 0.1 },
      },
    };
    const [englishFallback] = layoutHelpCallouts(
      { ...step, callouts: [localized] },
      screenshot,
      "zh",
    );
    expect(englishFallback!.target).toEqual({
      x: 100,
      y: 160,
      width: 200,
      height: 80,
    });
    expect(englishFallback!.text).toBe("选择保存");
    const [chineseCapture] = layoutHelpCallouts(
      { ...step, callouts: [localized] },
      { ...screenshot, locale: "zh" },
      "zh",
    );
    expect(chineseCapture!.target.x).toBe(600);
  });

  it("honors step overrides including an explicitly empty list", () => {
    expect(getStepCallouts(step, screenshot)).toEqual([callout]);
    expect(getStepCallouts({ ...step, callouts: [] }, screenshot)).toEqual([]);
    expect(
      layoutHelpCallouts({ ...step, callouts: [] }, screenshot, "en"),
    ).toEqual([]);
  });

  it("refuses to position full-image targets on an unreviewed presentation crop", () => {
    expect(() =>
      layoutHelpCallouts(
        step,
        { ...screenshot, crop: { x: 10, y: 10, width: 1000, height: 800 } },
        "en",
      ),
    ).toThrow("full viewport");
  });

  it("allows reviewed callouts on an explicitly cropped frame", () => {
    const layouts = layoutHelpCallouts(
      step,
      {
        ...screenshot,
        captureMode: "cropped",
        crop: { x: 140, y: 80, width: 1000, height: 800 },
      },
      "en",
    );
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.target).toEqual({ x: 200, y: 240, width: 150, height: 64 });
  });

  it("fits reviewed safe-area labels inside the full capture without moving the target", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [{ ...callout, labelPosition: { x: 0.99, y: 0.99 } }],
      },
      screenshot,
      "en",
    );
    expect(layout!.target).toEqual({ x: 200, y: 240, width: 150, height: 64 });
    expect(layout!.label.x + layout!.label.width).toBeLessThanOrEqual(1000);
    expect(layout!.label.y + layout!.label.height).toBeLessThanOrEqual(800);
  });

  it("preserves mixed source revisions rather than relabeling old captures", () => {
    expect(
      getScreenshotSource({
        ...screenshot,
        sourceRevision: "b".repeat(40),
        sourceLabel: "Reviewed earlier source",
      }),
    ).toEqual({ revision: "b".repeat(40), label: "Reviewed earlier source" });
    expect(getScreenshotSource(screenshot).revision).toBe(
      helpCaptureInfo.sourceRevision,
    );
  });

  it("places a right-facing button badge and its entire connector beyond the button rectangle", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            ...callout,
            bounds: { x: 0.2, y: 0.3, width: 0.15, height: 0.08 },
            labelPosition: { x: 0.7, y: 0.3 },
          },
        ],
      },
      screenshot,
      "en",
    );
    const { target, targetBadge, leader } = layout!;
    expect(targetBadge.x - targetBadge.radius).toBeGreaterThan(
      target.x + target.width,
    );
    expect(targetBadge.y).toBe(target.y + target.height / 2);
    expect(leader).toBeDefined();
    // Both endpoints lie in the open half-plane to the right of the real
    // button, so no part of this straight connector can cross its text.
    expect(Math.min(leader!.from.x, leader!.to.x)).toBeGreaterThan(
      target.x + target.width,
    );
  });

  it("keeps target numbers separate from their annotation pill", () => {
    const nearby = {
      ...callout,
      bounds: { x: 0.2, y: 0.3, width: 0.15, height: 0.08 },
      labelPosition: { x: 0.36, y: 0.31 },
    };
    const [layout] = layoutHelpCallouts(
      { ...step, callouts: [nearby] },
      screenshot,
      "en",
    );
    const { label, targetBadge: badge } = layout!;
    expect(
      Math.hypot(
        Math.max(label.x - badge.x, 0, badge.x - label.x - label.width),
        Math.max(label.y - badge.y, 0, badge.y - label.y - label.height),
      ),
    ).toBeGreaterThanOrEqual(badge.radius + 2);
    expect(() =>
      layoutHelpCallouts(
        {
          ...step,
          callouts: [{ ...nearby, badgePosition: { x: 0.36545, y: 0.34 } }],
        },
        screenshot,
        "en",
      ),
    ).toThrow("clear of its annotation label");
  });

  it("keeps a sign-in number left of the Username field instead of over its label", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            ...callout,
            bounds: { x: 0.35, y: 0.3, width: 0.3, height: 0.06 },
            labelPosition: { x: 0.03, y: 0.3 },
          },
        ],
      },
      screenshot,
      "en",
    );
    const { target, targetBadge, leader } = layout!;
    expect(targetBadge.x + targetBadge.radius).toBeLessThan(target.x);
    expect(targetBadge.y).toBe(target.y + target.height / 2);
    expect(targetBadge.y - targetBadge.radius).toBeGreaterThan(target.y);
    expect(leader).toBeDefined();
    expect(Math.max(leader!.from.x, leader!.to.x)).toBeLessThan(target.x);
  });

  it("uses the roomier mobile side, then an outside corner for an edge-to-edge panel", () => {
    const mobile = { ...screenshot, viewport: { width: 375, height: 844 } };
    const [field] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          { ...callout, bounds: { x: 0.65, y: 0.3, width: 0.3, height: 0.08 } },
        ],
      },
      mobile,
      "zh",
    );
    expect(field!.targetBadge.x + field!.targetBadge.radius).toBeLessThan(
      field!.target.x,
    );
    expect(field!.targetBadge.y).toBe(
      field!.target.y + field!.target.height / 2,
    );
    const [panel] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            ...callout,
            bounds: { x: 0.005, y: 0.3, width: 0.99, height: 0.08 },
          },
        ],
      },
      mobile,
      "zh",
    );
    expect(panel!.targetBadge.y - panel!.targetBadge.radius).toBeGreaterThan(
      panel!.target.y + panel!.target.height,
    );
    expect(
      panel!.targetBadge.x - panel!.targetBadge.radius,
    ).toBeGreaterThanOrEqual(0);
    expect(
      panel!.targetBadge.x + panel!.targetBadge.radius,
    ).toBeLessThanOrEqual(375);
    expect(panel!.leader).toBeUndefined();
  });

  it("omits a connector that would cross an edge-adjacent control when only its opposite side fits", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            ...callout,
            bounds: { x: 0.8, y: 0.3, width: 0.2, height: 0.08 },
            labelPosition: { x: 0.9, y: 0.3 },
          },
        ],
      },
      screenshot,
      "en",
    );
    expect(layout!.targetBadge.x + layout!.targetBadge.radius).toBeLessThan(
      layout!.target.x,
    );
    expect(layout!.leader).toBeUndefined();
  });

  it("honors a reviewed badge above End without covering the unannotated adjacent Now button", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            bounds: { x: 0.3, y: 0.5, width: 0.2, height: 0.05 },
            label: text,
            labelPosition: { x: 0.7, y: 0.5 },
            badgePosition: { x: 0.45, y: 0.475 },
          },
        ],
      },
      screenshot,
      "en",
    );
    expect(layout!.targetBadge).toMatchObject({ x: 450, y: 380 });
    expect(badgeClearsRectangle(layout!.targetBadge, layout!.target)).toBe(
      true,
    );
    // Now is intentionally absent from the callout inventory. Its human-reviewed
    // safe point remains the authority; the solver cannot discover image pixels.
    expect(
      badgeClearsRectangle(layout!.targetBadge, {
        x: 510,
        y: 400,
        width: 50,
        height: 40,
      }),
    ).toBe(true);
  });

  it.each([
    { x: Number.NaN, y: 0.4 },
    { x: 1.1, y: 0.4 },
    { x: 0.4, y: -0.1 },
  ])("rejects invalid normalized reviewed badge point %j", (badgePosition) => {
    expect(() => validateHelpCallouts([{ ...callout, badgePosition }])).toThrow(
      "badge positions",
    );
  });

  it.each([
    { x: 0.4, y: 0.525 }, // Inside End.
    { x: 0, y: 0.475 }, // Center in frame, but its circle escapes the bitmap.
    { x: 0.9, y: 0.1 }, // Unrelated blank space far from End.
  ])(
    "rejects an unsafe reviewed badge even when its normalized center is valid %j",
    (badgePosition) => {
      expect(() =>
        layoutHelpCallouts(
          {
            ...step,
            callouts: [
              {
                bounds: { x: 0.3, y: 0.5, width: 0.2, height: 0.05 },
                label: text,
                badgePosition,
              },
            ],
          },
          screenshot,
          "en",
        ),
      ).toThrow("Reviewed screenshot badge position");
    },
  );

  it("rejects a reviewed badge over another annotated control", () => {
    expect(() =>
      layoutHelpCallouts(
        {
          ...step,
          callouts: [
            {
              bounds: { x: 0.2, y: 0.4, width: 0.15, height: 0.08 },
              label: text,
              badgePosition: { x: 0.37, y: 0.44 },
            },
            {
              bounds: { x: 0.36, y: 0.4, width: 0.15, height: 0.08 },
              label: text,
            },
          ],
        },
        screenshot,
        "en",
      ),
    ).toThrow("Reviewed screenshot badge position");
  });

  it("keeps Message and Suggest badges outside both adjacent controls", () => {
    const layouts = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            bounds: { x: 0.0965, y: 0.5, width: 0.17944, height: 0.05 },
            label: text,
            labelPosition: { x: 0.7, y: 0.5 },
          },
          {
            bounds: { x: 0.28394, y: 0.5, width: 0.12708, height: 0.05 },
            label: { en: "Suggest a time", zh: "建议时间" },
            labelPosition: { x: 0.03, y: 0.5 },
          },
        ],
      },
      screenshot,
      "en",
    );
    for (const layout of layouts)
      for (const other of layouts)
        expect(badgeClearsRectangle(layout.targetBadge, other.target)).toBe(
          true,
        );
    expect(
      layouts[0]!.targetBadge.x + layouts[0]!.targetBadge.radius,
    ).toBeLessThan(layouts[0]!.target.x);
    expect(
      layouts[1]!.targetBadge.x - layouts[1]!.targetBadge.radius,
    ).toBeGreaterThan(layouts[1]!.target.x + layouts[1]!.target.width);
  });

  it("uses deterministic vertical fallbacks for dense mobile tabs without overlapping badges", () => {
    const mobile = { ...screenshot, viewport: { width: 375, height: 844 } };
    const dense: HelpStep = {
      ...step,
      callouts: [
        {
          bounds: {
            x: 10 / 375,
            y: 100 / 844,
            width: 110 / 375,
            height: 40 / 844,
          },
          label: text,
        },
        {
          bounds: {
            x: 125 / 375,
            y: 100 / 844,
            width: 110 / 375,
            height: 40 / 844,
          },
          label: { en: "Requests", zh: "申请" },
        },
        {
          bounds: {
            x: 240 / 375,
            y: 100 / 844,
            width: 125 / 375,
            height: 40 / 844,
          },
          label: { en: "Schedule", zh: "日程" },
        },
      ],
    };
    const layouts = layoutHelpCallouts(dense, mobile, "en");
    expect(layoutHelpCallouts(dense, mobile, "en")).toEqual(layouts);
    for (const [index, layout] of layouts.entries()) {
      for (const other of layouts)
        expect(badgeClearsRectangle(layout.targetBadge, other.target)).toBe(
          true,
        );
      expect(Math.abs(layout.targetBadge.y - 120)).toBeGreaterThan(20);
      for (const previous of layouts.slice(0, index))
        expect(
          Math.hypot(
            layout.targetBadge.x - previous.targetBadge.x,
            layout.targetBadge.y - previous.targetBadge.y,
          ),
        ).toBeGreaterThanOrEqual(
          layout.targetBadge.radius + previous.targetBadge.radius + 2 - 1e-6,
        );
    }
  });

  it("reserves later reviewed badge space before placing automatic badges", () => {
    const radius = (1000 / 60) * 1.35 * 0.42;
    const reviewedX = 350 + radius + 6;
    const layouts = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            bounds: { x: 0.2, y: 0.45, width: 0.15, height: 0.08 },
            label: text,
            labelPosition: { x: 0.7, y: 0.45 },
          },
          {
            bounds: { x: 0.4, y: 0.45, width: 0.15, height: 0.08 },
            label: { en: "Choose Next", zh: "选择下一步" },
            badgePosition: { x: reviewedX / 1000, y: 392 / 800 },
          },
        ],
      },
      screenshot,
      "en",
    );
    expect(layouts[1]!.targetBadge).toMatchObject({ x: reviewedX, y: 392 });
    expect(
      Math.hypot(
        layouts[0]!.targetBadge.x - reviewedX,
        layouts[0]!.targetBadge.y - 392,
      ),
    ).toBeGreaterThanOrEqual(radius * 2 + 2);
  });

  it("ignores a containing section as an obstacle to its own nested control", () => {
    const layouts = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          { bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 }, label: text },
          {
            bounds: { x: 0.3, y: 0.4, width: 0.16, height: 0.05 },
            label: { en: "Nested control", zh: "内部选项" },
          },
        ],
      },
      screenshot,
      "en",
    );
    const nested = layouts[1]!;
    expect(badgeClearsRectangle(nested.targetBadge, nested.target)).toBe(true);
    expect(nested.targetBadge.x).toBeGreaterThan(layouts[0]!.target.x);
    expect(nested.targetBadge.x).toBeLessThan(
      layouts[0]!.target.x + layouts[0]!.target.width,
    );
  });

  it("rejects two reviewed points that would paint their numbers over each other", () => {
    const point = {
      x: (350 + (1000 / 60) * 1.35 * 0.42 + 6) / 1000,
      y: 392 / 800,
    };
    expect(() =>
      layoutHelpCallouts(
        {
          ...step,
          callouts: [
            {
              bounds: { x: 0.2, y: 0.45, width: 0.15, height: 0.08 },
              label: text,
              badgePosition: point,
            },
            {
              bounds: { x: 0.4, y: 0.45, width: 0.15, height: 0.08 },
              label: text,
              badgePosition: point,
            },
          ],
        },
        screenshot,
        "en",
      ),
    ).toThrow("Reviewed screenshot badge position");
  });

  it("requires a clearer frame when no in-frame badge can avoid the target", () => {
    expect(() =>
      layoutHelpCallouts(
        {
          ...step,
          callouts: [
            {
              bounds: { x: 0, y: 0, width: 1, height: 1 },
              label: text,
            },
          ],
        },
        screenshot,
        "en",
      ),
    ).toThrow("no safe space near its target");
  });

  it("omits a connector crossing a different highlighted control", () => {
    const [layout] = layoutHelpCallouts(
      {
        ...step,
        callouts: [
          {
            bounds: { x: 0.2, y: 0.4, width: 0.15, height: 0.08 },
            label: text,
            badgePosition: { x: 0.37, y: 0.44 },
            labelPosition: { x: 0.8, y: 0.4 },
          },
          { bounds: { x: 0.45, y: 0.3, width: 0.1, height: 0.3 }, label: text },
        ],
      },
      screenshot,
      "en",
    );
    expect(layout!.leader).toBeUndefined();
  });
});

it("links the unchanged image to its full annotated view and exposes readable callout text", () => {
  const { container } = render(
    <AnnotatedScreenshot
      step={step}
      screenshot={screenshot}
      locale="zh"
      src="/api/help/images/reviewed-step?locale=zh"
      alt="保存设置的位置"
      href="/help/account-profile/screenshots/1"
      linkLabel="打开完整标注截图"
    />,
  );
  expect(
    screen.getByRole("link", { name: "打开完整标注截图" }).getAttribute("href"),
  ).toBe("/help/account-profile/screenshots/1");
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "/api/help/images/reviewed-step?locale=zh",
  );
  expect(
    screen
      .getByRole("list", { name: "截图标注" })
      .classList.contains("sm:sr-only"),
  ).toBe(true);
  expect(
    container
      .querySelector("[data-callout-label]")
      ?.classList.contains("max-sm:hidden"),
  ).toBe(true);
  expect(screen.getByRole("list", { name: "截图标注" }).textContent).toContain(
    "选择保存",
  );
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

it("renders annotation labels as text even when they contain markup-like wording", () => {
  const label = "<script>read</script>";
  const { container } = render(
    <AnnotatedScreenshot
      step={{
        ...step,
        callouts: [{ ...callout, label: { en: label, zh: "阅读标注" } }],
      }}
      screenshot={screenshot}
      locale="en"
      src="/api/help/images/reviewed-step"
      alt="A reviewed screen"
    />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(
    screen.getByRole("list", { name: "Screenshot callouts" }).textContent,
  ).toContain(label);
});

it("matches two displaced labels to numbered targets without covering the control text", () => {
  const displaced: HelpStep = {
    ...step,
    callouts: [
      { ...callout, labelPosition: { x: 0.7, y: 0.05 } },
      {
        bounds: { x: 0.6, y: 0.5, width: 0.2, height: 0.08 },
        label: { en: "Choose Next", zh: "选择下一步" },
        labelPosition: { x: 0.05, y: 0.75 },
      },
    ],
  };
  const layouts = layoutHelpCallouts(displaced, screenshot, "en");
  expect(layouts.map((item) => item.number)).toEqual([1, 2]);
  for (const item of layouts) {
    expect(item.leader?.to).toEqual({
      x: item.targetBadge.x,
      y: item.targetBadge.y,
    });
    expect(item.targetBadge.y).toBe(item.target.y + item.target.height / 2);
  }
  expect(
    layouts[0]!.targetBadge.x - layouts[0]!.targetBadge.radius,
  ).toBeGreaterThan(layouts[0]!.target.x + layouts[0]!.target.width);
  expect(
    layouts[1]!.targetBadge.x + layouts[1]!.targetBadge.radius,
  ).toBeLessThan(layouts[1]!.target.x);
  const { container } = render(
    <AnnotatedScreenshot
      step={displaced}
      screenshot={screenshot}
      locale="en"
      src="/api/help/images/reviewed-step"
      alt="Two reviewed controls"
    />,
  );
  expect(
    [...container.querySelectorAll("[data-callout-target-number]")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["1", "2"]);
  expect(container.querySelectorAll("[data-callout-leader]")).toHaveLength(2);
  expect(
    container
      .querySelector("svg")
      ?.lastElementChild?.getAttribute("data-callout-targets"),
  ).toBe("true");
  expect(
    screen.getByRole("list", { name: "Screenshot callouts" }).textContent,
  ).toContain("Choose Next");
});

it("keeps narrow-frame controls clear with target numbers and a readable external legend", () => {
  const narrow = { ...screenshot, viewport: { width: 375, height: 844 } };
  const mobileStep = {
    ...step,
    callouts: [{ ...callout, labelPosition: { x: 0.7, y: 0.05 } }],
  };
  const layout = layoutHelpCallouts(mobileStep, narrow, "zh")[0]!;
  expect(layout.showLabel).toBe(false);
  expect(layout.leader).toBeUndefined();
  const { container } = render(
    <AnnotatedScreenshot
      step={mobileStep}
      screenshot={narrow}
      locale="zh"
      src="/api/help/images/reviewed-step"
      alt="窄屏真实页面"
    />,
  );
  expect(container.querySelector("[data-callout-label]")).toBeNull();
  expect(container.querySelector("[data-callout-leader]")).toBeNull();
  expect(
    container.querySelector("[data-callout-target-number]")?.textContent,
  ).toBe("1");
  expect(container.querySelectorAll("rect")).toHaveLength(2);
  expect(screen.getByRole("list", { name: "截图标注" }).textContent).toContain(
    "选择保存",
  );
  expect(
    screen
      .getByRole("list", { name: "截图标注" })
      .classList.contains("sr-only"),
  ).toBe(false);
});
