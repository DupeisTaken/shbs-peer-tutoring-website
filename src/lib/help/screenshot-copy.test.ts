import { describe, expect, it, vi } from "vitest";
import type * as ScreenshotsModule from "./screenshots";
import type { HelpScreenshot } from "./screenshots";
import { getStepCallouts } from "./screenshots";
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

const screenshot: HelpScreenshot = vi.hoisted(() => ({
  id: "send-private-messages-step-2-view-3",
  file: "send-private-messages-step-2-view-3.en.jpg",
  route: "/admin/messages",
  locale: "en" as const,
  capturedAt: "2026-11-23T00:00:00Z",
  viewport: { width: 1280, height: 800 },
  role: "HEAD",
  sha256: "a".repeat(64),
  callouts: [
    {
      bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.06 },
      label: { en: "Delivery", zh: "单独投递" },
    },
    {
      bounds: { x: 0.1, y: 0.35, width: 0.2, height: 0.06 },
      label: { en: "Delivery", zh: "单独投递" },
    },
  ],
}));

vi.mock("./screenshots", async (importOriginal) => {
  const actual = await importOriginal<typeof ScreenshotsModule>();
  return {
    ...actual,
    getHelpScreenshot: (id: string) =>
      id === screenshot.id ? screenshot : actual.getHelpScreenshot(id),
  };
});

const omittedFieldsScreenshot: HelpScreenshot = {
  ...screenshot,
  id: "sign-in-recover-step-1",
  file: "sign-in-recover-step-1.en.jpg",
  route: "/signin",
  role: "PUBLIC",
  callouts: [
    {
      bounds: { x: 0.3, y: 0.3, width: 0.4, height: 0.06 },
      label: text("Username or email", "用户名或邮箱"),
      omitFromGuide: true,
    },
  ],
};

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
    const signIn: HelpStep = {
      title: text("Enter your credentials", "输入你的账号和密码"),
      body: text("Fill in your username and password.", "填写用户名和密码。"),
      screenshot: omittedFieldsScreenshot.id,
    };
    expect(getStepCallouts(signIn, omittedFieldsScreenshot).length).toBeGreaterThan(0);
    expect(getDisplayCallouts(signIn, omittedFieldsScreenshot, "en")).toEqual([]);
    expect(getDisplayCallouts(signIn, omittedFieldsScreenshot, "zh")).toEqual([]);
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
