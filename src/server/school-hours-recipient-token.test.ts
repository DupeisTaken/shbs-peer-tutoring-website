import { afterEach, expect, it, vi } from "vitest";
import {
  issueSchoolHoursRecipientToken,
  parseSchoolHoursRecipientToken,
  schoolHoursRecipientTokenMatches,
} from "./school-hours-recipient-token";
import { issueSchoolHoursToken } from "./school-hours-link";

const row = {
  id: "synthetic-school-delivery",
  schoolHoursReportId: "synthetic-school-report",
  recipient: "school-office@example.test",
};
const secret = "synthetic-school-recipient-secret";
afterEach(() => vi.unstubAllEnvs());

function token() {
  vi.stubEnv("AUTH_SECRET", secret);
  return issueSchoolHoursRecipientToken(row, 3);
}

it("reproduces a recipient-bound capability without exposing its mailbox or report in the URL", () => {
  const value = token();
  expect(value).toBe(issueSchoolHoursRecipientToken(row, 3));
  expect(value).toMatch(
    /^v2\.synthetic-school-delivery\.3\.[a-zA-Z0-9_-]{43}$/,
  );
  expect(value).not.toContain(row.recipient);
  expect(value).not.toContain(row.schoolHoursReportId);
  expect(parseSchoolHoursRecipientToken(value)).toEqual({
    deliveryId: row.id,
    linkVersion: 3,
  });
  expect(schoolHoursRecipientTokenMatches(value, row, 3)).toBe(true);
});

it.each([
  { ...row, id: "different-delivery" },
  { ...row, schoolHoursReportId: "different-report" },
  { ...row, recipient: "different-office@example.test" },
  { ...row, recipient: "School-Office@example.test" },
])("rejects substituting a stored delivery, report or mailbox: %j", (other) => {
  const value = token();
  expect(schoolHoursRecipientTokenMatches(value, other, 3)).toBe(false);
});

it("rejects changed link versions, forged signatures and a copied signature on another delivery", () => {
  const value = token();
  const parts = value.split(".");
  const forged = [
    ...parts.slice(0, 3),
    `${parts[3]!.startsWith("A") ? "B" : "A"}${parts[3]!.slice(1)}`,
  ].join(".");
  expect(schoolHoursRecipientTokenMatches(value, row, 4)).toBe(false);
  expect(
    schoolHoursRecipientTokenMatches(value.replace(".3.", ".4."), row, 4),
  ).toBe(false);
  expect(schoolHoursRecipientTokenMatches(forged, row, 3)).toBe(false);
  const other = { ...row, id: "different-delivery" };
  expect(
    schoolHoursRecipientTokenMatches(value.replace(row.id, other.id), other, 3),
  ).toBe(false);
});

it("keeps the legacy report-only purpose separate from recipient authority", () => {
  token();
  const legacy = issueSchoolHoursToken(row.id, 3);
  expect(parseSchoolHoursRecipientToken(legacy)).toBeNull();
  expect(
    schoolHoursRecipientTokenMatches(legacy.replace(/^v1\./, "v2."), row, 3),
  ).toBe(false);
});

it("rejects malformed, oversized and noncanonical token representations", () => {
  const value = token();
  const lastAlphabetIndex =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(
      value.at(-1)!,
    );
  const noncanonical = `${value.slice(0, -1)}${"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[lastAlphabetIndex + 1]}`;
  // Change only unused final base64 bits: decoded bytes match, spelling does not.
  expect(Buffer.from(noncanonical.split(".")[3]!, "base64url")).toEqual(
    Buffer.from(value.split(".")[3]!, "base64url"),
  );
  for (const invalid of [
    "",
    "v2",
    `${value}=`,
    `${value}\n`,
    ` ${value}`,
    `${value}.extra`,
    value.replace(".3.", ".03."),
    value.replace(".3.", ".0."),
    value.replace(".3.", ".1000000000."),
    value.replace(".3.", ".1.5."),
    value.replace(row.id, "bad.delivery"),
    value.replace(row.id, "a".repeat(129)),
    noncanonical,
    "a".repeat(321),
  ]) {
    expect(parseSchoolHoursRecipientToken(invalid)).toBeNull();
    expect(schoolHoursRecipientTokenMatches(invalid, row, 3)).toBe(false);
  }
});

it.each([0, -1, 1.5, NaN, Infinity, 1000000000, Number.MAX_SAFE_INTEGER + 1])(
  "rejects an invalid link version %s",
  (version) => {
    token();
    expect(() => issueSchoolHoursRecipientToken(row, version)).toThrow(
      "Invalid school report recipient link identity",
    );
  },
);

it.each([
  { ...row, id: "" },
  { ...row, id: "bad.id" },
  { ...row, id: "synthetic-school-delivery\n" },
  { ...row, id: "a".repeat(129) },
  { ...row, schoolHoursReportId: "" },
  { ...row, schoolHoursReportId: "bad.id" },
  { ...row, schoolHoursReportId: "synthetic-school-report\n" },
  { ...row, schoolHoursReportId: "a".repeat(129) },
  { ...row, recipient: "" },
  { ...row, recipient: "a".repeat(255) },
  { ...row, recipient: " school-office@example.test" },
  { ...row, recipient: "school-office@example.test\nextra" },
])("rejects an invalid stored recipient identity: %j", (invalid) => {
  const value = token();
  expect(() => issueSchoolHoursRecipientToken(invalid, 3)).toThrow(
    "Invalid school report recipient link identity",
  );
  expect(schoolHoursRecipientTokenMatches(value, invalid, 3)).toBe(false);
});

it("accepts bounded delivery/report identifiers and the maximum supported version", () => {
  token();
  const bounded = {
    ...row,
    id: "a".repeat(128),
    schoolHoursReportId: "b".repeat(128),
  };
  const value = issueSchoolHoursRecipientToken(bounded, 999999999);
  expect(schoolHoursRecipientTokenMatches(value, bounded, 999999999)).toBe(
    true,
  );
});

it("invalidates old recipient signatures after secret rotation", () => {
  const value = token();
  vi.stubEnv("AUTH_SECRET", "synthetic-replacement-secret");
  expect(schoolHoursRecipientTokenMatches(value, row, 3)).toBe(false);
  expect(issueSchoolHoursRecipientToken(row, 3)).not.toBe(value);
});

it.each([undefined, "", "   "])(
  "fails closed without a configured signing secret: %s",
  (missing) => {
    const value = token();
    vi.stubEnv("AUTH_SECRET", missing);
    expect(() => issueSchoolHoursRecipientToken(row, 3)).toThrow(
      "Configure AUTH_SECRET",
    );
    expect(schoolHoursRecipientTokenMatches(value, row, 3)).toBe(false);
  },
);
