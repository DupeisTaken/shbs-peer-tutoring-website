import { expect, it, vi } from "vitest";
import { validateInterviewDecision, validatePanel } from "./interviews";
import type { TransactionDb } from "./transactions";

vi.mock("~/server/qualifications", () => ({ lockCatalogue: vi.fn() }));
vi.mock("~/server/request-invalidity", () => ({
  assertRequestProcessable: vi.fn(),
}));

/** Exercise the common chair policy without connecting to a database. Route
 * integration coverage separately verifies approval replay and completion writes. */
function panelFixture(roles: string[]) {
  const panel = roles.map((role, index) => ({
    id: `panel-${index}`,
    user: {
      role,
      suspendedAt: null as Date | null,
      tutorAccessRevoked: false,
      mergedIntoId: null as string | null,
    },
  }));
  const tx = {
    tutor: { findMany: vi.fn(async () => panel) },
    applicationSubjectIntent: {
      findMany: vi.fn(async () => [{ subjectId: "subject" }]),
    },
    qualificationGrant: { count: vi.fn(async () => 1) },
    tutorApplication: {
      findUniqueOrThrow: vi.fn(async () => ({ invalidatedAt: null })),
    },
    interviewAssignment: {
      findMany: vi.fn(async () =>
        panel.map((member, index) => ({
          tutorId: member.id,
          isHead: index === 0,
        })),
      ),
    },
    interviewVote: {
      findMany: vi.fn(async () =>
        panel.map((member, index) => ({
          tutorId: member.id,
          accept: index < 2,
        })),
      ),
    },
  };
  return {
    tx: tx as unknown as TransactionDb,
    mocks: tx,
    ids: panel.map((member) => member.id),
  };
}

it.each(["ADMIN", "HEAD"])(
  "allows a selected %s chair alongside a Head panelist",
  async (role) => {
    const { tx, ids } = panelFixture([role, "HEAD", "COORDINATOR", "TUTOR"]);
    await expect(
      validatePanel(tx, "application", ids, ids[0]!),
    ).resolves.toBeUndefined();
  },
);

it.each(["COORDINATOR", "TUTOR", "STUDENT", "CREW", "VIEWER"])(
  "rejects a selected %s chair even when another panelist is Head",
  async (role) => {
    const { tx, ids } = panelFixture([role, "HEAD", "TUTOR"]);
    await expect(
      validatePanel(tx, "application", ids, ids[0]!),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Select an Admin or Head panelist as chair.",
    });
  },
);

it("rejects an otherwise qualified coordinator-only management panel", async () => {
  const { tx, ids } = panelFixture(["COORDINATOR", "TUTOR", "TUTOR"]);
  await expect(
    validatePanel(tx, "application", ids, ids[0]!),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("requires the selected chair to belong to the panel", async () => {
  const { tx, ids } = panelFixture(["HEAD", "ADMIN", "TUTOR"]);
  await expect(
    validatePanel(tx, "application", ids, "outside-panel"),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it.each(["suspended", "revoked", "merged"] as const)(
  "rejects a %s panelist even when their tutor row remains ACTIVE",
  async (restriction) => {
    const { tx, mocks, ids } = panelFixture(["HEAD", "ADMIN", "TUTOR"]);
    const panel = await mocks.tutor.findMany();
    const member = panel[2]!;
    if (restriction === "suspended") member.user.suspendedAt = new Date();
    if (restriction === "revoked") member.user.tutorAccessRevoked = true;
    if (restriction === "merged") member.user.mergedIntoId = "another-account";
    await expect(
      validatePanel(tx, "application", ids, ids[0]!),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  },
);

it.each(["COORDINATOR", "TUTOR"])(
  "retains a recorded %s chair only when validating completed service",
  async (role) => {
    const { tx, ids } = panelFixture([role, "ADMIN", "TUTOR"]);
    await expect(
      validatePanel(tx, "application", ids, ids[0]!, {
        chairEligibility: "recorded",
      }),
    ).resolves.toBeUndefined();
    await expect(
      validatePanel(tx, "application", ids, ids[0]!),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      validatePanel(tx, "application", ids, "outside-panel", {
        chairEligibility: "recorded",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  },
);

it("still requires active panel membership and subject qualification for recorded service", async () => {
  const { tx, mocks, ids } = panelFixture(["COORDINATOR", "ADMIN", "TUTOR"]);
  mocks.tutor.findMany.mockResolvedValueOnce([]);
  await expect(
    validatePanel(tx, "application", ids, ids[0]!, {
      chairEligibility: "recorded",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Every panelist needs an active tutor account.",
  });
  mocks.qualificationGrant.count.mockResolvedValueOnce(0);
  await expect(
    validatePanel(tx, "application", ids, ids[0]!, {
      chairEligibility: "recorded",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message:
      "The panel needs a staff-confirmed tutor qualified in an applicant subject.",
  });
});

it("lets the selected Admin chair resolve a tie without transferring authority to the Head panelist", async () => {
  const { tx, ids } = panelFixture(["ADMIN", "HEAD", "COORDINATOR", "TUTOR"]);
  await expect(
    validateInterviewDecision(tx, "application", true, ids[0]!),
  ).resolves.toBeUndefined();
  await expect(
    validateInterviewDecision(tx, "application", false, ids[0]!),
  ).resolves.toBeUndefined();
  await expect(
    validateInterviewDecision(tx, "application", true, ids[1]!),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "Only the selected panel chair may break a tie.",
  });
});

it("rechecks a legacy coordinator chair before accepting a decision", async () => {
  const { tx, ids } = panelFixture(["COORDINATOR", "TUTOR", "TUTOR"]);
  await expect(
    validateInterviewDecision(tx, "application", true, ids[0]!),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Select an Admin or Head panelist as chair.",
  });
});
