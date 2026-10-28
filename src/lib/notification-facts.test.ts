import { describe, expect, it } from "vitest";
import {
  notificationAttendanceStatus,
  notificationCard,
  notificationInstant,
  notificationLabel,
  notificationList,
  notificationSchedule,
} from "./notification-facts";

describe("notification facts", () => {
  it("distinguishes equal wall-clock times on different dates and respects the program timezone", () => {
    const first = notificationInstant(
      new Date("2026-10-28T16:30:00Z"),
      "Asia/Shanghai",
      "en",
    );
    const second = notificationInstant(
      new Date("2026-10-29T16:30:00Z"),
      "Asia/Shanghai",
      "en",
    );
    expect(first).toContain("29/10/2026");
    expect(first).toContain("00:30");
    expect(second).toContain("30/10/2026");
    expect(first).not.toBe(second);
    expect(
      notificationInstant(
        new Date("2026-10-28T16:30:00Z"),
        "Asia/Shanghai",
        "zh",
      ),
    ).toContain("2026/10/29");
  });
  it("keeps bounded identities and an explicit count of omitted participants", () => {
    expect(notificationLabel(" A\n B ")).toBe("A B");
    expect(notificationLabel("x".repeat(200))).toHaveLength(80);
    expect(
      notificationList(["Alice", "Alice", "Bob", "Cara", "Dan", "Emma"]),
    ).toBe("Alice, Bob, Cara, Dan (+1)");
  });
  it("identifies the same schedule and card in each supported detail language", () => {
    const slot = { dayOfWeek: 7, startMin: 545, endMin: 610 };
    expect(notificationSchedule(slot, "en")).toBe("Sunday 09:05–10:10");
    expect(notificationSchedule(slot, "zh")).toBe("周日 09:05–10:10");
    expect(notificationCard("RED", "en")).toBe("red card");
    expect(notificationCard("YELLOW", "zh")).toBe("黄卡");
    expect(notificationAttendanceStatus("EXCUSED_ABSENT", "en")).toBe(
      "Excused absence",
    );
    expect(notificationAttendanceStatus("UNEXCUSED_ABSENT", "zh")).toBe(
      "无故缺席",
    );
    expect(notificationAttendanceStatus("arbitrary private text", "en")).toBe(
      "—",
    );
  });
});
