import { describe, expect, it } from "vitest";
import { helpArticles } from "./catalogue";
import { getHelpScreenshot, getStepCallouts } from "./screenshots";
import {
  getDisplayCallouts,
  getScreenshotCaption,
  getStepFocus,
} from "./screenshot-copy";
import type { HelpStep } from "./types";

const text = (en: string, zh: string) => ({ en, zh });
const step: HelpStep = {
  title: text("Open delivery history", "打开投递历史"),
  body: text("Check the delivery. Read all rows.", "检查投递。阅读所有行。"),
};
const screenshot = getHelpScreenshot("send-private-messages-step-2-view-3")!;

describe("screenshot guidance", () => {
  it("places one marker for a repeated label in either edition", () => {
    const reviewed = getStepCallouts(step, screenshot);
    expect(
      reviewed.filter(({ label }) => label.en === "Delivery"),
    ).toHaveLength(2);
    expect(
      getDisplayCallouts(step, screenshot, "en")
        .map(({ label }) => label.en)
        .filter((label) => label === "Delivery"),
    ).toHaveLength(1);
    expect(
      getDisplayCallouts(step, screenshot, "zh")
        .map(({ label }) => label.zh)
        .filter((label) => label === "单独投递"),
    ).toHaveLength(1);
  });

  it("keeps straightforward fields in the image without publishing their reviewed markers", () => {
    const signIn = helpArticles.find(
      (article) => article.slug === "sign-in-recover",
    )!.steps[0]!;
    const capture = getHelpScreenshot(signIn.screenshot!)!;
    expect(getStepCallouts(signIn, capture).length).toBeGreaterThan(0);
    expect(getDisplayCallouts(signIn, capture, "en")).toEqual([]);
    expect(getDisplayCallouts(signIn, capture, "zh")).toEqual([]);
  });

  it("publishes new context and suppresses receipt, step and callout echoes", () => {
    expect(getScreenshotCaption(step, screenshot, "en")).toBeUndefined();
    const repeated = {
      ...screenshot,
      caption: text("CHECK the delivery!", "检查投递！"),
    };
    expect(getScreenshotCaption(step, repeated, "en")).toBeUndefined();
    expect(getScreenshotCaption(step, repeated, "zh")).toBeUndefined();
    expect(
      getScreenshotCaption(
        step,
        { ...screenshot, caption: text("Delivery.", "单独投递。") },
        "en",
      ),
    ).toBeUndefined();
    const caption = text(
      "Each recipient has a separate record.",
      "每位收件人均有独立记录。",
    );
    expect(getScreenshotCaption(step, { ...screenshot, caption }, "zh")).toBe(
      caption.zh,
    );
    expect(
      getStepFocus(
        {
          ...step,
          screenshot: screenshot.id,
          focus: text("Delivery", "单独投递"),
        },
        "en",
      ),
    ).toBeUndefined();
    expect(
      getStepFocus(
        { ...step, focus: text("Check the delivery!", "检查投递！") },
        "zh",
      ),
    ).toBeUndefined();
  });
});
