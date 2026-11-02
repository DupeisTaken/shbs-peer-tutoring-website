import { afterEach, expect, it, vi } from "vitest";
import {
  issueSchoolHoursToken,
  parseSchoolHoursToken,
  schoolHoursTokenHash,
  schoolHoursTokenMatches,
} from "./school-hours-link";

afterEach(() => vi.unstubAllEnvs());
it("reproduces a scoped high-entropy capability while storing only its digest", () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-school-link-secret");
  const token = issueSchoolHoursToken("synthetic-report", 1);
  expect(issueSchoolHoursToken("synthetic-report", 1)).toBe(token);
  expect(parseSchoolHoursToken(token)).toEqual({
    reportId: "synthetic-report",
    linkVersion: 1,
  });
  expect(schoolHoursTokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(schoolHoursTokenHash(token)).not.toContain(token);
  expect(schoolHoursTokenMatches(token, schoolHoursTokenHash(token))).toBe(
    true,
  );
  expect(
    schoolHoursTokenMatches(
      issueSchoolHoursToken("other-report", 1),
      schoolHoursTokenHash(token),
    ),
  ).toBe(false);
  expect(
    schoolHoursTokenMatches(
      issueSchoolHoursToken("synthetic-report", 2),
      schoolHoursTokenHash(token),
    ),
  ).toBe(false);
});
it("keeps an issued capability hash-valid after secret rotation, while requiring reissue before sending a new token", () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-before-rotation");
  const token = issueSchoolHoursToken("synthetic-report", 1),
    hash = schoolHoursTokenHash(token);
  vi.stubEnv("AUTH_SECRET", "synthetic-after-rotation");
  expect(schoolHoursTokenMatches(token, hash)).toBe(true);
  expect(
    schoolHoursTokenMatches(issueSchoolHoursToken("synthetic-report", 1), hash),
  ).toBe(false);
});
it("rejects traversal, malformed versions, oversized inputs and noncanonical signatures", () => {
  for (const value of [
    "",
    "../report",
    "v1.report.0.bad",
    "x".repeat(500),
    `v1.report.1.${"A".repeat(42)}B`,
  ])
    expect(parseSchoolHoursToken(value)).toBeNull();
  expect(() => issueSchoolHoursToken("../report", 1)).toThrow();
  expect(() => issueSchoolHoursToken("report", 0)).toThrow();
});
