import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import {
  editStudentSignupAnswers,
  restoreStudentSignupAnswers,
  studentSignupAnswersInput,
} from "./student-signup-state";
import { withAutomaticRecoveryCheckpoint } from "./recovery/checkpoint";

vi.mock("./recovery/checkpoint", () => ({ withAutomaticRecoveryCheckpoint: vi.fn(
  async (_tx: unknown, _source: unknown, _actor: unknown, work: () => Promise<unknown>) => work(),
) }));
vi.mock("./account-profile-lock", () => ({ lockAccountProfile: vi.fn() }));
vi.mock("./request-review", () => ({ lockStudentRequestReview: vi.fn() }));
vi.mock("./student-workflow", () => { throw new Error("Signup state must not import web action-proof workflows"); });
vi.mock("~/server/db", () => { throw new Error("Signup state requires an injected database"); });
vi.mock("~/env", () => { throw new Error("Signup state must not initialize application environment"); });

beforeEach(() => vi.clearAllMocks());

function answers() {
  return studentSignupAnswersInput.parse({
    firstName: "Synthetic", lastName: "Learner", englishName: "Synthetic Learner",
    preferredContact: "Synthetic contact", firstChoiceId: "synthetic-subject", slotIds: ["synthetic-slot"],
  });
}

function fixture(reviewed: boolean) {
  const row = { id: "synthetic-survey", tuteeId: "synthetic-learner", state: "OPEN",
    intakeTermId: "synthetic-ended-term", confirmedAt: new Date("2026-10-01T00:00:00Z"),
    verificationDueAt: null, currentVersion: 0 };
  const revision = vi.fn(async () => null);
  const write = vi.fn();
  const query = vi.fn(async (_parts: TemplateStringsArray) => reviewed ? [{ id: "reviewed-action" }] : []);
  const tx = {
    $executeRaw: vi.fn(async () => 1), $queryRaw: query,
    studentSurvey: { findUnique: vi.fn(async () => row), findUniqueOrThrow: vi.fn(async () => row), update: write },
    user: { findUniqueOrThrow: vi.fn(async () => ({ id: "synthetic-reviewer", name: "Synthetic reviewer",
      suspendedAt: null, mergedIntoId: null, role: "ADMIN" })) },
    studentSignupRevision: { findUnique: revision, create: write },
    term: { findUnique: vi.fn(async () => ({ active: false })) },
  } as unknown as TransactionDb;
  return { tx, query, revision, write };
}

it("rejects ordinary management edits without an injected action-proof consumer before any domain work", async () => {
  await expect(editStudentSignupAnswers({} as TransactionDb, "synthetic-reviewer", {
    id: "synthetic-survey", expectedVersion: 0, clientKey: "00000000-0000-4000-8000-000000000001", answers: answers(),
  }, { signedTicket: "synthetic-proof", releaseChangedAssignments: true }))
    .rejects.toMatchObject({ code: "FORBIDDEN", message: "Ordinary signup management edits require the action proof consumer." });
  expect(withAutomaticRecoveryCheckpoint).not.toHaveBeenCalled();
});

it("does not treat a caller-supplied recovery action ID as authority", async () => {
  const f = fixture(false);
  await expect(restoreStudentSignupAnswers(f.tx, "synthetic-reviewer", {
    id: "synthetic-survey", expectedVersion: 0, answers: answers(),
  }, "unreviewed-action")).rejects.toMatchObject({ code: "FORBIDDEN", message: "Reviewed recovery transaction required." });
  expect(f.query).toHaveBeenCalledOnce();
  expect(f.revision).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it("rechecks exact recovery transaction binding and current edit-period validation before any revision", async () => {
  const f = fixture(true);
  await expect(restoreStudentSignupAnswers(f.tx, "synthetic-reviewer", {
    id: "synthetic-survey", expectedVersion: 0, answers: answers(),
  }, "reviewed-action")).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "SIGNUP_EDIT_CLOSED" });
  const sql = (f.query.mock.calls[0]?.[0] as unknown as TemplateStringsArray).join("?");
  expect(sql).toContain("RecoveryCheckpoint");
  expect(sql).toContain("shbs.recovery_compensating");
  expect(sql).toContain("adapter='STUDENT_WORKFLOW'");
  expect(f.revision).toHaveBeenCalledOnce();
  expect(f.write).not.toHaveBeenCalled();
});
