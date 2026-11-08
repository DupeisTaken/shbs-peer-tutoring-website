import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestNoticeEmailCopy } from "./request-notice-copy";
import { renderEmail } from "./template";

const notice = {
  id: "synthetic-notice",
  createdAt: new Date("2026-11-08T02:00:00Z"),
  requestKind: "application",
  requestInvalid: true,
  requestSubmittedAt: new Date("2026-11-07T16:30:00Z"),
  requestTimeZone: "Asia/Shanghai",
  requestReason: "Review the synthetic evidence",
};
const appealUrl = "https://school.example.test/request-appeal?token=synthetic";

beforeEach(() => {
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  vi.stubEnv("AUTH_SECRET", "synthetic-request-copy-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("request delivery wording", () => {
  it.each([
    ["application", "Tutor application", "辅导伙伴申请"],
    ["signup", "Tutee signup", "学习伙伴报名申请"],
    ["survey", "Tutee signup", "学习伙伴报名申请"],
  ])(
    "identifies %s and its actual invalidity outcome in the subject",
    (kind, en, zh) => {
      const invalid = requestNoticeEmailCopy(
        { ...notice, requestKind: kind },
        false,
        appealUrl,
      );
      expect(invalid.subject).toBe(`${en} flagged invalid / ${zh}已标记为无效`);
      expect(invalid.text).toContain(
        "Processing is paused until authorized management clears the flag",
      );
      expect(invalid.presentation.action.url).toBe(appealUrl);
      const cleared = requestNoticeEmailCopy(
        { ...notice, requestKind: kind, requestInvalid: false },
        false,
        appealUrl,
      );
      expect(cleared.subject).toBe(
        `${en} invalid flag cleared / ${zh}无效标记已解除`,
      );
      expect(cleared.text).toContain(
        "This does not itself approve the request or confirm participation",
      );
      expect(cleared.presentation.action.url).toBe(
        "https://school.example.test/privacy",
      );
    },
  );

  it("uses a fixed generic title for unknown historical request kinds", () => {
    const copy = requestNoticeEmailCopy(
      { ...notice, requestKind: "PRIVATE_INTERNAL_KIND" },
      false,
      appealUrl,
    );
    expect(copy.subject).toBe("Request flagged invalid / 申请已标记为无效");
    expect(copy.subject).not.toContain("PRIVATE_INTERNAL_KIND");
  });

  it("includes a private bilingual reason once after both languages and escapes its markup", () => {
    const reason = "**Synthetic / 示例** <script>privateReason()</script>";
    const row = { ...notice, requestReason: reason };
    const unverified = requestNoticeEmailCopy(row, false, appealUrl);
    const verified = requestNoticeEmailCopy(row, true, appealUrl);
    expect(unverified.text).not.toContain("privateReason");
    expect(unverified.text).not.toContain("Reason / 原因:");
    expect(verified.text.split(reason)).toHaveLength(2);
    expect(verified.text.indexOf("Reason / 原因:")).toBeGreaterThan(
      verified.text.indexOf("提交时间："),
    );
    const html = renderEmail({ brand: "Synthetic program", ...verified });
    expect(html).toContain("&lt;script&gt;privateReason()&lt;/script&gt;");
    expect(html.match(/privateReason\(\)/g)).toHaveLength(1);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("PRIVATE_INTERNAL_KIND");
    expect(verified.text).toContain("November 8, 2026");
    expect(verified.text).toContain("2026年11月8日");
    expect(verified.text).toContain("Asia/Shanghai");
  });

  it.each([null, ""])(
    "omits an empty verified reason (%s)",
    (requestReason) => {
      const copy = requestNoticeEmailCopy(
        { ...notice, requestReason },
        true,
        appealUrl,
      );
      expect(copy.text).not.toContain("Reason / 原因:");
    },
  );

  it("retains the survey appeal period and queue consequence without inventing an unavailable link", () => {
    const row = { ...notice, requestKind: "survey" };
    const available = requestNoticeEmailCopy(row, false, appealUrl);
    expect(available.text).toContain("Appeal during the current signup period");
    expect(available.text).toContain("removes its queue priority");
    expect(available.text).toContain(
      "does not grant an account or approve participation",
    );
    expect(available.presentation.action.url).toBe(appealUrl);
    const unavailable = requestNoticeEmailCopy(row, false);
    expect(unavailable.text).toContain("This appeal link is unavailable");
    expect(unavailable.presentation.action.url).toBe(
      "https://school.example.test/privacy",
    );
    expect(unavailable.text).not.toContain("?token=");
  });

  it("never substitutes a notice timestamp for missing original submission evidence", () => {
    const copy = requestNoticeEmailCopy(
      { ...notice, requestSubmittedAt: null },
      false,
      appealUrl,
    );
    expect(copy.text).toContain("Original submission time unavailable");
    expect(copy.text).toContain("原始提交时间不可用");
    expect(copy.text).not.toContain("November 8");
    expect(copy.text).not.toContain("2026年11月8日");
  });
});
