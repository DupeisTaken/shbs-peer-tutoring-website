import { describe, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { notificationData, notifyUsers } from "./create";

vi.mock("~/server/db", () => ({ db: {} }));

describe("in-app notification fan-out", () => {
  it("preserves the recorded bilingual detail while deduplicating recipients", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const client = { notification: { createMany } } as unknown as TransactionDb;
    const detail = {
      en: "Tutee Morgan is assigned to Alex for Mathematics. The weekly schedule is awaiting confirmation.",
      zh: "学习伙伴 Morgan 已分配给 Alex，科目为数学。每周辅导时间待确认。",
    };
    await notifyUsers(
      ["student", "tutor", "student", ""],
      {
        ...notificationData("student_assignment_updated", undefined, detail),
        link: "/student",
      },
      client,
    );
    expect(createMany).toHaveBeenCalledWith({
      data: ["student", "tutor"].map((userId) => ({
        userId,
        title: "Tutoring Assignment Updated",
        body: null,
        link: "/student",
        event: "student_assignment_updated",
        context: { inAppDetail: detail },
      })),
    });
  });

  it("does not persist undeclared profile or review fields from a caller", async () => {
    const createMany = vi.fn();
    const client = { notification: { createMany } } as unknown as TransactionDb;
    await notifyUsers(
      ["reviewer"],
      {
        title: "Review",
        event: "management_review_pending",
        context: {
          privateReason: "Private reason",
          email: "private@example.test",
        } as never,
      },
      client,
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ context: {} })],
    });
  });
});
