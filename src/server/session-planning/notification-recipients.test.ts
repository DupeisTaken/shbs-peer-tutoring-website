import { expect, it, vi } from "vitest";
import type { User } from "../../../generated/prisma";
import { notificationTuteeRecipients } from "./notification-recipients";

// These fixtures model the User delegate boundary. The helper must return the
// original complete row rather than project away delivery/account information.
function user(
  id: string,
  studentId: string | null = null,
  changes: Partial<User> = {},
): User {
  return {
    id,
    studentId,
    email: `${id}@example.test`,
    role: "STUDENT",
    tuteeMember: true,
    suspendedAt: null,
    mergedIntoId: null,
    ...changes,
  } as User;
}

function fixture(
  users: User[] = [],
  ownerships: { tuteeId: string; userId: string }[] = [],
) {
  const reads = {
    studentProfileOwnership: {
      findMany: vi.fn().mockResolvedValue(ownerships),
    },
    user: { findMany: vi.fn().mockResolvedValue(users) },
    // Deliberately ineligible evidence must not turn lifecycle notices into
    // formal scheduling authorization or introduce qualification reads.
    tutee: { findUnique: vi.fn().mockResolvedValue({ status: "INACTIVE" }) },
    schoolDeparture: {
      findUnique: vi.fn().mockResolvedValue({ reason: "TRANSFERRED" }),
    },
    policyAcceptance: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    reads,
    db: reads as unknown as Parameters<typeof notificationTuteeRecipients>[0],
  };
}

it("does not read the database when no tutees need a notice", async () => {
  const { db, reads } = fixture();
  expect(await notificationTuteeRecipients(db, [])).toEqual([]);
  expect(reads.studentProfileOwnership.findMany).not.toHaveBeenCalled();
  expect(reads.user.findMany).not.toHaveBeenCalled();
});

it("prefers retained ownership over a different direct account without matching contact information", async () => {
  const retained = user("retained-owner");
  const direct = user("direct-owner", "tutee");
  const { db, reads } = fixture(
    [direct, retained],
    [{ tuteeId: "tutee", userId: retained.id }],
  );
  const recipients = await notificationTuteeRecipients(db, ["tutee"]);
  expect(recipients).toEqual([{ tuteeId: "tutee", user: retained }]);
  expect(recipients[0]!.user).toBe(retained);
  expect(reads.user.findMany).toHaveBeenCalledExactlyOnceWith({
    where: { OR: [{ id: { in: [retained.id] } }] },
  });
});

it("skips a missing retained owner without falling back to a different live direct account", async () => {
  const direct = user("direct-owner", "retained");
  const unowned = user("unowned-user", "unowned");
  const { db, reads } = fixture(
    [direct, unowned],
    [{ tuteeId: "retained", userId: "missing-owner" }],
  );
  expect(
    await notificationTuteeRecipients(db, ["retained", "unowned"]),
  ).toEqual([{ tuteeId: "unowned", user: unowned }]);
  expect(reads.user.findMany).toHaveBeenCalledExactlyOnceWith({
    where: {
      OR: [
        { id: { in: ["missing-owner"] } },
        { studentId: { in: ["unowned"] } },
      ],
    },
  });
});

it("preserves input order, duplicate actor IDs and complete User rows while batching unique reads", async () => {
  const a = user("a-user", "a", { name: "Synthetic A", tutorId: "tutor-a" });
  const b = user("b-user", "b", { emailVerifiedAt: new Date(0) });
  const retained = user("retained-user");
  const { db, reads } = fixture(
    [a, retained, b],
    [{ tuteeId: "old", userId: retained.id }],
  );
  const recipients = await notificationTuteeRecipients(db, [
    "b",
    "a",
    "b",
    "missing",
    "old",
  ]);
  expect(recipients).toEqual([
    { tuteeId: "b", user: b },
    { tuteeId: "a", user: a },
    { tuteeId: "b", user: b },
    { tuteeId: "old", user: retained },
  ]);
  expect(recipients[0]!.user).toBe(b);
  expect(recipients[1]!.user).toBe(a);
  expect(recipients[2]!.user).toBe(b);
  expect(
    reads.studentProfileOwnership.findMany,
  ).toHaveBeenCalledExactlyOnceWith({
    where: { tuteeId: { in: ["b", "a", "missing", "old"] } },
    select: { tuteeId: true, userId: true },
  });
  expect(reads.user.findMany).toHaveBeenCalledExactlyOnceWith({
    where: {
      OR: [
        { id: { in: [retained.id] } },
        { studentId: { in: ["b", "a", "missing"] } },
      ],
    },
  });
});

it("retains distinct tutee aliases of one owner as separate notice actors", async () => {
  const owner = user("one-owner");
  const { db } = fixture(
    [owner],
    [
      { tuteeId: "first-alias", userId: owner.id },
      { tuteeId: "second-alias", userId: owner.id },
    ],
  );
  expect(
    await notificationTuteeRecipients(db, ["second-alias", "first-alias"]),
  ).toEqual([
    { tuteeId: "second-alias", user: owner },
    { tuteeId: "first-alias", user: owner },
  ]);
});

it.each([
  { role: "VIEWER" as const, tuteeMember: false },
  { tuteeMember: false },
  { suspendedAt: new Date(0) },
  { mergedIntoId: "surviving-user" },
  { tutorAccessRevoked: true },
  { emailVerifiedAt: null },
  { email: "" },
  { tutorId: "dual-role-tutor" },
])(
  "retains existing lifecycle recipients despite qualification changes: %j",
  async (changes) => {
    const recipient = user("former-participant", null, changes);
    const { db, reads } = fixture(
      [recipient],
      [{ tuteeId: "tutee", userId: recipient.id }],
    );
    expect(await notificationTuteeRecipients(db, ["tutee"])).toEqual([
      { tuteeId: "tutee", user: recipient },
    ]);
    expect(reads.tutee.findUnique).not.toHaveBeenCalled();
    expect(reads.schoolDeparture.findUnique).not.toHaveBeenCalled();
    expect(reads.policyAcceptance.findFirst).not.toHaveBeenCalled();
  },
);
