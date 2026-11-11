import { expect, it, vi } from "vitest";
import {
  localizedPatrolCorrectionError,
  PATROL_CHANGED_MESSAGE,
} from "./patrol-correction-error";

it("translates only the complete known patrol-version refusal", () => {
  const translate = vi.fn(() => "Guidance in the active language");
  expect(
    localizedPatrolCorrectionError(PATROL_CHANGED_MESSAGE, translate),
  ).toBe("Guidance in the active language");
  expect(translate).toHaveBeenCalledExactlyOnceWith("patrolChanged");
});

it.each([
  undefined,
  "",
  "Another record changed. Reload before correcting it.",
  ` ${PATROL_CHANGED_MESSAGE}`,
  `${PATROL_CHANGED_MESSAGE} `,
  `${PATROL_CHANGED_MESSAGE} Additional server detail.`,
  "Include each observation exactly once.",
  "Observation times cannot be in the future (one minute of clock difference is allowed).",
  "Account changed. Reload before submitting.",
  "Invalid program date or time zone.",
  "Invalid calendar date.",
  "This time occurs twice because of daylight saving. Choose another time.",
  "This time does not exist because of daylight saving. Choose another time.",
])("leaves unrecognized messages to the existing fallback: %s", (message) => {
  const translate = vi.fn(() => "Unrelated guidance");
  expect(localizedPatrolCorrectionError(message, translate)).toBeUndefined();
  expect(translate).not.toHaveBeenCalled();
});
