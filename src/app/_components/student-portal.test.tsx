// @vitest-environment jsdom
import { expect, it } from "vitest";

import { canSubmitCardAppeal } from "./student-portal";

const now = new Date("2026-09-10T00:00:00Z");

it.each([
  ["PENDING", false, "2026-09-10T00:00:00Z", true],
  ["VALID", false, "2026-09-10T00:00:00Z", true],
  ["INVALID", false, "2026-09-10T00:00:00Z", false],
  ["PENDING", true, "2026-09-10T00:00:00Z", false],
  ["VALID", false, "2026-09-09T23:59:59Z", false],
] as const)(
  "allows only one open appeal for a non-invalid card (%s, existing=%s)",
  (reviewStatus, hasExistingAppeal, deadline, expected) => {
    expect(
      canSubmitCardAppeal({
        reviewStatus,
        hasExistingAppeal,
        deadline: new Date(deadline),
        now,
      }),
    ).toBe(expected);
  },
);
