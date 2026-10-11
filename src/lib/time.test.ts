import { expect, it } from "vitest";
import { formatWeekday, minToHm } from "./time";
import { pairingScheduleText } from "./pairing-schedule";

it("localizes all stored weekdays while keeping Monday first and Sunday last", () => {
  const days = [1, 2, 3, 4, 5, 6, 7];
  expect(days.map((day) => formatWeekday(day, "en"))).toEqual([
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
  ]);
  expect(days.map((day) => formatWeekday(day, "zh"))).toEqual([
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
  ]);
});

it.each([0, 8, -1, 1.5, Number.NaN])(
  "does not invent a weekday for %s",
  (day) => {
    expect(formatWeekday(day, "en")).toBe("");
  },
);

it("localizes confirmed schedule labels without changing program clock values", () => {
  const pairing = {
    scheduleConfirmed: true,
    dayOfWeek: 7,
    startMin: 0,
    endMin: 1439,
  };
  expect(pairingScheduleText(pairing, "Awaiting schedule")).toBe(
    "Sun 00:00–23:59",
  );
  expect(pairingScheduleText(pairing, "等待安排", "zh")).toBe(
    "周日 00:00–23:59",
  );
  expect(minToHm(930)).toBe("15:30");
});

it("never turns numeric placeholders into an agreed time before confirmation", () => {
  const pairing = {
    scheduleConfirmed: false,
    dayOfWeek: 1,
    startMin: 0,
    endMin: 0,
  };
  expect(pairingScheduleText(pairing, "等待安排", "zh")).toBe("等待安排");
});
