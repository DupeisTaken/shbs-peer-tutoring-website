import { expect, it } from "vitest";
import { reviewInstant, reviewInstantValue } from "./review-instant";
import { approvalPresentation } from "./approval-presentation";
import { reviewCollectionFieldEqual } from "./approval-review-collections";

it("keeps a pairing room concurrency token out of business changes", () => {
  const model = approvalPresentation(
    "admin.updatePairing",
    { id: "pairing", expectedRoomVersion: 3 },
    { Pairing: [{ id: "pairing", roomVersion: 3 }] },
  );
  expect(model.changes).toHaveLength(0);
});

it.each([
  ["2026-10-25T00:00:00", "2026-10-25T00:00:00.000Z"],
  ["2026-10-25T00:00:00.123", "2026-10-25T00:00:00.123Z"],
  ["2026-10-25T08:00:00+08:00", "2026-10-25T00:00:00.000Z"],
])(
  "interprets captured UTC instants independently of host timezone: %s",
  (raw, iso) => {
    expect(reviewInstant(raw).toISOString()).toBe(iso);
    expect(reviewInstantValue(raw)).toBe(iso);
  },
);

it("retains calendar dates, invalid text and presence distinctions", () => {
  for (const value of [
    null,
    undefined,
    "2026-10-25",
    "invalid",
    "2026-10-25Tinvalid",
  ])
    expect(reviewInstantValue(value)).toBe(value);
  expect(
    reviewCollectionFieldEqual(
      "2026-10-25T00:00:00.123",
      new Date("2026-10-25T00:00:00.124Z"),
      "observedAt",
      ["observedAt"],
    ),
  ).toBe(false);
  expect(
    reviewCollectionFieldEqual(
      "2026-10-25T00:00:00",
      new Date("2026-10-25T00:00:00Z"),
      "observedAt",
      ["observedAt"],
    ),
  ).toBe(true);
  expect(
    reviewCollectionFieldEqual(
      "2026-10-25T00:00:00",
      new Date("2026-10-25T00:00:00Z"),
      "note",
      ["observedAt"],
    ),
  ).toBe(false);
});

it("does not invent an attendance date change or mutate its saved evidence", () => {
  const raw = "2026-10-25T00:00:00";
  const date = new Date(`${raw}Z`);
  const model = approvalPresentation(
    "corrections.correctAttendance",
    { id: "session", date },
    { Session: [{ id: "session", date: raw }] },
  );
  expect(model.changes).toHaveLength(0);
  expect(model.unchanged.find((field) => field.key === "date")).toMatchObject({
    before: raw,
    requested: date,
  });
});

it("compares recruitment UTC captures with restored requests without rewriting originals", () => {
  const raw = "2026-10-25T00:00:00";
  const date = new Date(`${raw}Z`);
  const model = approvalPresentation(
    "program.setSignupWindow",
    { audience: "tutee", opensAt: date, closesAt: date },
    { term: [{ signupOpensAt: raw, signupClosesAt: raw }] },
  );
  expect(model.changes).toHaveLength(0);
  expect(model.unchanged).toHaveLength(2);
  expect(model.unchanged[0]?.before).toBe(raw);
  expect(model.unchanged[0]?.requested).toBe(date);
});
