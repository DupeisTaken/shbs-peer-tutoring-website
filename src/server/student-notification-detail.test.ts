import { describe, expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { studentScheduleDetail } from "./student-request-state";

describe("student schedule notification snapshots", () => {
  const tx = {
    pairing: {
      findUnique: vi.fn(async () => ({
        subject: "Mathematics",
        tutor: { englishName: "Alice" },
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
        reason: "Private medical reason",
      })),
    },
  } as unknown as TransactionDb;
  it("identifies the assignment and keeps proposed and committed actions distinct", async () => {
    const pending = await studentScheduleDetail(
      tx,
      "pairing",
      "Emma",
      "student_schedule_review_pending",
    );
    const approved = await studentScheduleDetail(
      tx,
      "pairing",
      "Emma",
      "student_schedule_review_approved",
    );
    const declined = await studentScheduleDetail(
      tx,
      "pairing",
      "Emma",
      "student_schedule_review_declined",
    );
    expect(pending.en).toContain(
      "Emma / Tutor Alice / Mathematics, Monday 15:00–16:00",
    );
    expect(pending.en).toContain(
      "awaits review; the assignment remains unchanged",
    );
    expect(approved.en).toContain("this original request releases its assignment");
    expect(approved.en).toContain("Other independently assigned requests remain in effect");
    expect(approved.zh).toContain("本原始申请解除对应分配");
    expect(approved.zh).toContain("其他独立申请的分配继续有效");
    expect(declined.en).toContain("declined; the assignment remains unchanged");
    expect(JSON.stringify([pending, approved, declined])).not.toMatch(
      /medical|Private/,
    );
  });
});
