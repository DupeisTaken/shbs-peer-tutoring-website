import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: delivery.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { updateAccountProfile } from "~/server/account-profile";

const caller = (id = "profile-admin", role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Session name", email: `${id}@example.test` },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const input = {
  userId: "profile-person",
  name: "Alice Chen",
  alternativeNames: "陈爱丽",
  expectedProfileVersion: 0,
};

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["/shbs_shipping_test", "/shbs_account_profiles_test"].includes(
      url.pathname,
    )
  )
    throw new Error(
      "Profile tests require an explicitly isolated local test database",
    );
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((row) => '"' + row.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  delivery.send.mockReset();
  await db.tutor.create({
    data: {
      id: "profile-tutor",
      englishName: "Original Person",
      firstName: "Original",
      lastName: "Person",
      email: "person@example.test",
      username: "profileperson",
    },
  });
  await db.tutee.createMany({
    data: [
      {
        id: "profile-tutee",
        englishName: "Original Person",
        email: "person@example.test",
        signatureName: "Original signature",
      },
      {
        id: "profile-unlinked",
        englishName: "Original Person",
        email: "person@example.test",
      },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: "profile-admin",
        role: "ADMIN",
        name: "Admin",
        email: "admin@example.test",
      },
      {
        id: "profile-coordinator",
        role: "COORDINATOR",
        name: "Coordinator",
        email: "coordinator@example.test",
      },
      {
        id: "profile-viewer",
        role: "VIEWER",
        name: "Viewer",
        email: "viewer@example.test",
      },
      {
        id: "profile-person",
        role: "TUTOR",
        name: "Original Person",
        email: "person@example.test",
        username: "profileperson",
        tutorId: "profile-tutor",
        studentId: "profile-tutee",
      },
    ],
  });
});
afterAll(() => db.$disconnect());

it("uses the account profile for both explicit participation links without touching lookalikes or signatures", async () => {
  await caller("profile-person", "TUTOR").account.updateName({
    name: "林",
    alternativeNames: "Lin",
    expectedProfileVersion: 0,
  });
  expect(
    await db.user.findUnique({ where: { id: "profile-person" } }),
  ).toMatchObject({
    name: "林",
    alternativeNames: "Lin",
    role: "TUTOR",
    tutorId: "profile-tutor",
    studentId: "profile-tutee",
    profileVersion: 1,
  });
  expect(
    await db.tutor.findUnique({ where: { id: "profile-tutor" } }),
  ).toMatchObject({
    englishName: "林",
    firstName: "林",
    lastName: null,
    alternativeNames: "Lin",
    username: "profileperson",
  });
  expect(
    await db.tutee.findUnique({ where: { id: "profile-tutee" } }),
  ).toMatchObject({
    englishName: "林",
    alternativeNames: "Lin",
    signatureName: "Original signature",
  });
  expect(
    await db.tutee.findUnique({ where: { id: "profile-unlinked" } }),
  ).toMatchObject({ englishName: "Original Person", alternativeNames: null });
});

it("returns no credential fields and rejects stale simultaneous account edits", async () => {
  const results = await Promise.allSettled([
    caller().admin.updateAccountProfile(input),
    caller().admin.updateAccountProfile({ ...input, name: "Different Name" }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const success = results.find((result) => result.status === "fulfilled");
  if (success?.status === "fulfilled")
    expect(success.value).toEqual({ profileVersion: 1 });
  const account = await db.user.findUniqueOrThrow({
    where: { id: "profile-person" },
  });
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "profile-tutor" } }))
      .englishName,
  ).toBe(account.name);
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: "profile-tutee" } }))
      .englishName,
  ).toBe(account.name);
});

it("queues coordinator changes and applies the synchronized profile only after approval", async () => {
  await expect(
    caller("profile-coordinator", "COORDINATOR").admin.updateAccountProfile(
      input,
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: input.userId } })).name,
  ).toBe("Original Person");
  const proposal = await db.approvalRequest.findFirstOrThrow();
  expect(proposal.targets).toMatchObject({
    User: [
      {
        record: {
          name: "Original Person",
          alternativeNames: null,
          profileVersion: 0,
          tutorId: "profile-tutor",
          studentId: "profile-tutee",
        },
      },
    ],
  });
  expect(JSON.stringify(proposal.targets)).not.toContain("passwordHash");
  await caller().approval.decide({
    id: proposal.id,
    approve: true,
    note: "Profile correction verified",
  });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: "profile-tutee" } }))
      .englishName,
  ).toBe(input.name);
  expect(
    await db.auditLog.count({
      where: { operation: "admin.updateAccountProfile" },
    }),
  ).toBeGreaterThan(0);
});

it("blocks stale approval after a self-service profile correction", async () => {
  await expect(
    caller("profile-coordinator", "COORDINATOR").admin.updateAccountProfile(
      input,
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow();
  await caller("profile-person", "TUTOR").account.updateName({
    name: "Corrected by owner",
  });
  await expect(
    caller().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Old proposal",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rejects viewer/tutor admin writes and refuses an outdated participation link", async () => {
  for (const [id, role] of [
    ["profile-viewer", "VIEWER"],
    ["profile-person", "TUTOR"],
  ] as const)
    await expect(
      caller(id, role).admin.updateAccountProfile(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    updateAccountProfile(db, "profile-person", {
      name: "Wrong target",
      expectedStudentId: "profile-unlinked",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "profile-person" } })).name,
  ).toBe("Original Person");
});

it("roster corrections propagate names while preserving verified account email ownership", async () => {
  const row = await db.tutee.findUniqueOrThrow({
    where: { id: "profile-tutee" },
  });
  await caller().admin.updateTutee({
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    englishName: "Updated in roster",
    alternativeNames: "更名",
    status: row.status,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "profile-person" } })).name,
  ).toBe("Updated in roster");
  const tutor = await db.tutor.findUniqueOrThrow({
    where: { id: "profile-tutor" },
  });
  await caller().admin.updateTutor({
    id: tutor.id,
    expectedUpdatedAt: tutor.updatedAt,
    firstName: "Tutor",
    lastName: "Correction",
    alternativeNames: "改名",
    username: "profileperson",
    status: tutor.status,
  });
  expect(
    (await db.tutee.findUniqueOrThrow({ where: { id: row.id } })).englishName,
  ).toBe("Tutor Correction");
  await expect(
    caller().admin.updateTutee({
      id: row.id,
      expectedUpdatedAt: row.updatedAt,
      englishName: "Stale",
      status: row.status,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const fresh = await db.tutee.findUniqueOrThrow({ where: { id: row.id } });
  await expect(
    caller().admin.updateTutee({
      id: row.id,
      expectedUpdatedAt: fresh.updatedAt,
      englishName: fresh.englishName,
      status: row.status,
      email: "other@example.test",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("sends verification only after a staff action to the resolved account, rate limits resend and refuses verified accounts", async () => {
  expect(delivery.send).not.toHaveBeenCalled();
  await expect(
    caller("profile-viewer", "VIEWER").admin.sendAccountVerification({
      userId: "profile-person",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(delivery.send).not.toHaveBeenCalled();
  await caller(
    "profile-coordinator",
    "COORDINATOR",
  ).admin.sendAccountVerification({ userId: "profile-person" });
  expect(delivery.send).toHaveBeenCalledTimes(1);
  expect(delivery.send.mock.calls[0]?.[0]).toMatchObject({
    to: "person@example.test",
  });
  await expect(
    caller().admin.sendAccountVerification({ userId: "profile-person" }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  await db.user.update({
    where: { id: "profile-person" },
    data: { emailVerifiedAt: new Date() },
  });
  await expect(
    caller().admin.sendAccountVerification({ userId: "profile-person" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(delivery.send).toHaveBeenCalledTimes(1);
});

async function headCaller() {
  await db.user.update({ where: { id: "profile-admin" }, data: { role: "HEAD" } });
  return caller(); // Deliberately keep the old cookie role.
}
it.each(["profile-admin", "profile-person", "profile-viewer", "profile-coordinator"])("Head renames %s with current permissions and preserves identity", async (userId) => {
  const head = await headCaller();
  const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const updated = await head.admin.updateAccountUsername({ userId, username: "  NewHandle93  ", expectedProfileVersion: 0 });
  expect(updated).toMatchObject({ id: userId, username: "newhandle93", role: before.role, email: before.email, passwordHash: before.passwordHash, tutorId: before.tutorId, studentId: before.studentId });
  if (before.tutorId) expect(await db.tutor.findUnique({ where: { id: before.tutorId } })).toMatchObject({ username: "newhandle93" });
  expect(await db.auditLog.findFirst({ where: { operation: "admin.updateAccountUsername" } })).toMatchObject({ userId: "profile-admin", entityId: userId, details: { oldUsername: before.username, newUsername: "newhandle93" } });
  await head.admin.updateAccountUsername({ userId, username: "newhandle93", expectedProfileVersion: 1 });
  expect(await db.auditLog.count({ where: { operation: "admin.updateAccountUsername", action: "Updated account username" } })).toBe(1);
  await expect(head.admin.updateAccountUsername({ userId, username: "stale", expectedProfileVersion: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
});
it.each(["profile-admin", "profile-coordinator", "profile-person", "profile-viewer"])("rejects unauthorized rename by %s despite a Head cookie", async (id) => {
  await expect(caller(id, "HEAD").admin.updateAccountUsername({ userId: "profile-person", username: "forbidden", expectedProfileVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("rejects invalid and colliding usernames in both tables without partial changes", async () => {
  const head = await headCaller();
  for (const username of ["", "a@b", "a-b", "a b", "爱丽", "a".repeat(65)]) {
    await expect(head.admin.updateAccountUsername({ userId: "profile-person", username, expectedProfileVersion: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  await db.user.update({ where: { id: "profile-viewer" }, data: { username: "takenuser" } });
  await db.tutor.create({ data: { englishName: "Unlinked", username: "takentutor" } });
  for (const username of ["TakenUser", "TakenTutor"]) await expect(head.admin.updateAccountUsername({ userId: "profile-person", username, expectedProfileVersion: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.user.findUnique({ where: { id: "profile-person" } })).toMatchObject({ username: "profileperson", profileVersion: 0 });
});
it("renaming removes the old tutor sign-in alias and preserves email and credentials", async () => {
  const { hashPassword } = await import("~/server/auth/password");
  const { verifySigninPassword } = await import("~/server/auth/credentials");
  const head = await headCaller();
  await db.user.update({ where: { id: "profile-person" }, data: { passwordHash: hashPassword("Password123!") } });
  await head.admin.updateAccountUsername({ userId: "profile-person", username: "renamed93", expectedProfileVersion: 0 });
  expect(await verifySigninPassword("profileperson", "Password123!", "rename-test")).toMatchObject({ ok: false });
  for (const identifier of [" RENAMED93 ", "person@example.test"]) expect(await verifySigninPassword(identifier, "Password123!", "rename-test")).toMatchObject({ ok: true, user: { id: "profile-person" } });
});

it("ordinary tutor profile edits preserve handles and reject the legacy rename path", async () => {
  await expect(caller().admin.updateTutor({ id: "profile-tutor", firstName: "New", lastName: "Name", username: "bypass", status: "ACTIVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().admin.updateTutor({ id: "profile-tutor", firstName: "New", lastName: "Name", status: "ACTIVE" });
  expect(await db.user.findUnique({ where: { id: "profile-person" } })).toMatchObject({ username: "profileperson" });
  expect(await db.tutor.findUnique({ where: { id: "profile-tutor" } })).toMatchObject({ username: "profileperson", englishName: "New Name" });
});
it("suspended Head cannot rename an account", async () => {
  const head = await headCaller();
  await db.user.update({ where: { id: "profile-admin" }, data: { suspendedAt: new Date() } });
  await expect(head.admin.updateAccountUsername({ userId: "profile-person", username: "denied", expectedProfileVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
