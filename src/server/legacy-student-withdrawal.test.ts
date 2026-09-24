import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentRequestReview } from "../../generated/prisma";
import type { TransactionDb } from "./transactions";
import {
  applyLegacyStudentWithdrawal,
  approveLegacyStudentWithdrawal,
  ownedLegacyParticipation,
} from "./legacy-student-withdrawal";
const controls = vi.hoisted(() => ({ consume: vi.fn(), policy: vi.fn() }));
vi.mock("./student-workflow", () => ({
  consumeStudentAction: controls.consume,
}));
vi.mock("./policy-acceptance", () => ({ requirePolicy: controls.policy }));

function fixture() {
  const db = {
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "owner",
        studentId: "student",
        email: "owner@example.test",
        suspendedAt: null,
      }),
      findMany: vi.fn().mockResolvedValue([{ id: "admin" }]),
    },
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
    term: { findFirst: vi.fn().mockResolvedValue({ id: "current" }) },
    tutee: {
      findUnique: vi.fn().mockResolvedValue({
        id: "student",
        status: "ACTIVE",
        intakeTermId: "current",
        pairings: [],
      }),
      update: vi.fn(),
    },
    studentSurvey: { findUnique: vi.fn().mockResolvedValue(null) },
    studentRequestReview: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    notification: { createMany: vi.fn() },
    studentQuarterBlock: { upsert: vi.fn() },
    pairingTutee: { deleteMany: vi.fn() },
  };
  return { mock: db, db: db as unknown as TransactionDb };
}
beforeEach(() => vi.clearAllMocks());
describe("manual student withdrawal ownership and policy", () => {
  it("rejects another student's ID even when contact details could match", async () => {
    const { db, mock } = fixture();
    await expect(
      applyLegacyStudentWithdrawal(
        db,
        "owner",
        "somebody-else",
        "Leaving",
        "ticket",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.studentRequestReview.create).not.toHaveBeenCalled();
    expect(controls.consume).not.toHaveBeenCalled();
  });
  it("accepts retained explicit ownership and rejects suspended accounts", async () => {
    const { db, mock } = fixture();
    mock.user.findUnique.mockResolvedValue({
      id: "owner",
      studentId: "new-profile",
      email: "owner@example.test",
      suspendedAt: null,
    });
    mock.studentProfileOwnership.findMany.mockResolvedValue([
      { tuteeId: "student" },
    ]);
    await expect(
      ownedLegacyParticipation(db, "owner", "student"),
    ).resolves.toHaveProperty("student.id", "student");
    mock.user.findUnique.mockResolvedValue({
      id: "owner",
      studentId: "student",
      email: "owner@example.test",
      suspendedAt: new Date(),
    });
    await expect(
      ownedLegacyParticipation(db, "owner", "student"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("requires policy and an account-bound timed confirmation without ending participation", async () => {
    const { db, mock } = fixture();
    await applyLegacyStudentWithdrawal(
      db,
      "owner",
      "student",
      "Leaving",
      "ticket",
    );
    expect(controls.policy).toHaveBeenCalledWith(db, "owner", "tutee-policy");
    expect(controls.consume).toHaveBeenCalledWith(
      db,
      "ticket",
      "owner",
      "ABORT",
      "legacy:student",
    );
    expect(mock.studentRequestReview.create).toHaveBeenCalledWith({
      data: {
        legacyTuteeId: "student",
        legacyIntakeTermId: "current",
        kind: "STUDENT_ABORT",
        requestedByUserId: "owner",
        reason: "Leaving",
      },
    });
    expect(mock.pairingTutee.deleteMany).not.toHaveBeenCalled();
  });
  it("supports the active primary manual profile before its first pairing and rejects inactive profiles", async () => {
    const { db, mock } = fixture();
    mock.tutee.findUnique.mockResolvedValue({
      id: "student",
      status: "ACTIVE",
      intakeTermId: null,
      pairings: [],
    });
    await expect(
      ownedLegacyParticipation(db, "owner", "student"),
    ).resolves.toHaveProperty("student.id", "student");
    mock.tutee.findUnique.mockResolvedValue({
      id: "student",
      status: "INACTIVE",
      intakeTermId: null,
      pairings: [],
    });
    await expect(
      ownedLegacyParticipation(db, "owner", "student"),
    ).rejects.toThrow("no current");
  });
  it("blocks duplicate submissions and stale or survey-backed enrollments", async () => {
    const { db, mock } = fixture();
    mock.studentRequestReview.count.mockResolvedValue(1);
    await expect(
      applyLegacyStudentWithdrawal(db, "owner", "student", "Leaving", "ticket"),
    ).rejects.toThrow("already awaiting review");
    mock.studentSurvey.findUnique.mockResolvedValue({ id: "survey" });
    await expect(
      ownedLegacyParticipation(db, "owner", "student"),
    ).rejects.toThrow("no current");
  });
  it("approval blocks repeat signup and releases only current-quarter pairings", async () => {
    const { db, mock } = fixture();
    const review = {
      id: "review",
      requestedByUserId: "owner",
      legacyTuteeId: "student",
      legacyIntakeTermId: "current",
    } as StudentRequestReview;
    await approveLegacyStudentWithdrawal(db, review);
    expect(mock.studentQuarterBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          email: "owner@example.test",
          intakeTermId: "current",
          userId: "owner",
          legacyTuteeId: "student",
        },
      }),
    );
    expect(mock.pairingTutee.deleteMany).toHaveBeenCalledWith({
      where: { tuteeId: "student", pairing: { termId: "current" } },
    });
    await expect(
      approveLegacyStudentWithdrawal(db, {
        ...review,
        legacyIntakeTermId: "ended",
      }),
    ).rejects.toThrow("quarter ended");
  });
});
