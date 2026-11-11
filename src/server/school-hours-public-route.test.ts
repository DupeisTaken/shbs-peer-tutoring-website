// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("~/server/db", () => ({
  db: { schoolHoursReport: { findUnique: fixture.findUnique } },
}));
import { GET, HEAD } from "~/app/reports/service-hours/[token]/route";
import {
  issueSchoolHoursToken,
  schoolHoursTokenHash,
} from "./school-hours-link";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";
let token: string;
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "synthetic-public-report-language-secret");
  token = issueSchoolHoursToken("synthetic-report", 1);
  fixture.findUnique.mockReset().mockResolvedValue({
    snapshot: schoolHoursTestSnapshot(),
    linkVersion: 1,
    linkTokenHash: schoolHoursTokenHash(token),
    linkRevokedAt: null,
    supersededById: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["en", "zh"] as const)(
  "supports %s on legacy read-only links without a session or forms",
  async (locale) => {
    const response = await GET(
      new Request(
        `https://reports.example.test/reports/service-hours/${token}?lang=${locale}`,
      ),
      { params: Promise.resolve({ token }) },
    );
    const doc = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Language")).toBe(locale);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "form-action 'none'",
    );
    expect(doc.documentElement.lang).toBe(locale);
    expect(doc.querySelector("h1")?.textContent).toBe(
      locale === "en" ? "School Report" : "学校报告",
    );
    expect(doc.querySelector("form,script,#reminder")).toBeNull();
    expect(doc.querySelectorAll(".school-summary")).toHaveLength(
      doc.querySelectorAll(".hours-button").length,
    );
    const head = await HEAD(
      new Request(
        `https://reports.example.test/reports/service-hours/${token}?lang=${locale}`,
        { method: "HEAD" },
      ),
      { params: Promise.resolve({ token }) },
    );
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Language")).toBe(locale);
  },
);

it("falls back to English for an unsupported language without reflecting query content", async () => {
  const response = await GET(
    new Request(
      `https://reports.example.test/reports/service-hours/${token}?lang=%22%3E%3Cscript%3E`,
    ),
    { params: Promise.resolve({ token }) },
  );
  const html = await response.text();
  expect(response.headers.get("Content-Language")).toBe("en");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<h1>School Report</h1>");
});
