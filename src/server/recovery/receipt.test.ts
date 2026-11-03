import { expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import { readRecoveryReceipt } from "./receipt";
import { recoveryHash } from "./capture";
const identity = vi.hoisted(() => vi.fn());
vi.mock("./adapters/shared", () => ({ participantIdentity: identity }));

function fixture(evidence: unknown) {
  const source = {
    id: "receipt",
    actionId: "action",
    actorId: "reviewer",
    reason: "Synthetic correction",
    channel: "WEBSITE",
    fingerprint: "f".repeat(64),
    createdAt: new Date(),
    evidence,
  };
  const client = {
    recoveryReceipt: { findUniqueOrThrow: vi.fn().mockResolvedValue(source) },
    recoveryWorkflowDraft: { findMany: vi.fn().mockResolvedValue([]) },
    recoveryCheckpoint: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "checkpoint",
          adapter: "ATTENDANCE",
          adapterVersion: 1,
          schemaVersion: 1,
          sourceEntity: "Session",
          sourceId: "session",
        }),
    },
  };
  return { client, db: client as unknown as DomainDb };
}
it("shares complete safe receipt metadata and outcomes while excluding private snapshots and results", async () => {
  const { db } = fixture({
    version: 1,
    checkpointId: "checkpoint",
    effects: ["Recompute supported hours"],
    preserved: ["Original attendance"],
    before: { secret: "private-before" },
    result: { token: "private-result" },
    deliveries: {
      version: 1,
      effects: [
        {
          id: "effect",
          eventId: "event",
          deliveryId: "delivery",
          notificationId: null,
          disposition: "IN_FLIGHT_OR_UNKNOWN",
          cancellation: null,
        },
      ],
    },
  });
  const receipt = await readRecoveryReceipt(db, "receipt");
  expect(receipt).toMatchObject({
    version: 1,
    evidenceVersion: 1,
    fingerprint: "f".repeat(64),
    effects: ["Recompute supported hours"],
    preserved: ["Original attendance"],
    deliveries: { version: 1 },
  });
  expect(receipt).not.toHaveProperty("evidence");
  expect(receipt).not.toHaveProperty("clientKey");
  expect(JSON.stringify(receipt)).not.toContain("private-before");
  expect(JSON.stringify(receipt)).not.toContain("private-result");
});

const draftResult = {
  outcome: "AWAITING_OWNER_ACTION",
  draftId: "draft",
  ownerUserId: "owner",
  version: 1,
  destination: "/signup?recoveryDraft=draft",
  requiredAction:
    "Review and submit a new request with current policy agreement and fresh mailbox verification.",
};
it("projects pending owner draft metadata without granting management a recipient link", async () => {
  const { db, client } = fixture({ version: 1, result: draftResult });
  client.recoveryCheckpoint.findUnique.mockResolvedValue({
    id: "checkpoint",
    adapter: "STUDENT_WORKFLOW",
    adapterVersion: 1,
    schemaVersion: 1,
    sourceEntity: "StudentSurvey",
    sourceId: "survey",
  });
  client.recoveryWorkflowDraft.findMany.mockResolvedValue([
    {
      id: "draft",
      actionId: "action",
      ownerUserId: "owner",
      version: 1,
      state: "PENDING_OWNER_REVIEW",
      sourceTuteeId: "student",
      ownerBindingHash: "not-public",
    },
  ]);
  const receipt = await readRecoveryReceipt(db, "receipt", "management");
  expect(receipt.result).toMatchObject({
    outcome: "AWAITING_OWNER_ACTION",
    drafts: [
      {
        draftId: "draft",
        ownerUserId: "owner",
        state: "PENDING_OWNER_REVIEW",
        destination: null,
      },
    ],
  });
  expect(JSON.stringify(receipt)).not.toContain("not-public");
  expect(identity).not.toHaveBeenCalled();
});
it("offers a follow-up link only to the exact current unrestricted draft owner", async () => {
  const { db, client } = fixture({
    version: 1,
    result: {
      outcome: "AWAITING_OWNER_ACTION",
      sourceTermId: "term",
      destinationTermId: "next",
      drafts: [draftResult],
    },
  });
  client.recoveryCheckpoint.findUnique.mockResolvedValue({
    id: "checkpoint",
    adapter: "PROGRAM_REFRESH",
    adapterVersion: 1,
    schemaVersion: 1,
    sourceEntity: "Term",
    sourceId: "term",
  });
  const binding = { synthetic: "exact source ownership" };
  client.recoveryWorkflowDraft.findMany.mockResolvedValue([
    {
      id: "draft",
      actionId: "action",
      ownerUserId: "owner",
      version: 1,
      state: "PENDING_OWNER_REVIEW",
      sourceTuteeId: "student",
      ownerBindingHash: recoveryHash(binding),
    },
  ]);
  identity.mockResolvedValue({
    binding,
    ownerIds: ["owner"],
    owners: [
      {
        id: "owner",
        suspendedAt: null,
        mergedIntoId: null,
        recoveryVoidedAt: null,
      },
    ],
  });
  expect(
    (await readRecoveryReceipt(db, "receipt", "owner")).result?.drafts[0]
      ?.destination,
  ).toBe("/signup?recoveryDraft=draft");
  identity.mockResolvedValue({
    binding: { changed: true },
    ownerIds: ["owner"],
    owners: [{ id: "owner" }],
  });
  expect(
    (await readRecoveryReceipt(db, "receipt", "owner")).result?.drafts[0]
      ?.destination,
  ).toBeNull();
});
it.each([
  { ...draftResult, destination: "https://untrusted.example/secret" },
  { ...draftResult, arbitrary: "private-token" },
])(
  "omits unknown or unsafe result formats instead of emitting arbitrary destinations",
  async (result) => {
    const { db, client } = fixture({ version: 1, result });
    client.recoveryCheckpoint.findUnique.mockResolvedValue({
      id: "checkpoint",
      adapter: "STUDENT_WORKFLOW",
      adapterVersion: 1,
      schemaVersion: 1,
      sourceEntity: "StudentSurvey",
      sourceId: "survey",
    });
    expect(
      (await readRecoveryReceipt(db, "receipt", "owner")).result,
    ).toBeNull();
  },
);
it.each([{}, { version: 2, effects: ["Unknown future state"] }])(
  "keeps legacy/future evidence metadata-only instead of inventing format support",
  async (evidence) => {
    const { db } = fixture(evidence);
    expect(await readRecoveryReceipt(db, "receipt")).toMatchObject({
      evidenceVersion: null,
      effects: null,
      preserved: null,
      deliveries: null,
    });
  },
);
it("refuses arbitrary delivery JSON despite a known outer version", async () => {
  const { db } = fixture({
    version: 1,
    deliveries: {
      version: 1,
      effects: [{ recipient: "private@example.test", token: "private-token" }],
    },
  });
  const receipt = await readRecoveryReceipt(db, "receipt");
  expect(receipt.deliveries).toBeNull();
  expect(JSON.stringify(receipt)).not.toContain("private@example.test");
});
