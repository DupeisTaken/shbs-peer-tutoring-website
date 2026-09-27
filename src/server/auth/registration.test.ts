import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import {
  issueRegistrationCode,
  resolveUsableCode,
  completeRegistration,
  setEmailVerification,
  confirmEmailCode,
} from "./registration";
import {
  REGISTRATION_KINDS,
  type RegistrationKind,
} from "~/lib/registration-kind";
let ip = 0;
const actor = (id: string, role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers({ "x-real-ip": `invite-${++ip}` }),
    session: {
      user: { id, email: `${id}@example.test`, name: id },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const publicCaller = () =>
  createCaller({
    db,
    headers: new Headers({ "x-real-ip": `public-${++ip}` }),
    session: null,
  });
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw Error("Dedicated local test database required");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].map((role) => ({
      id: role.toLowerCase(),
      role: role as Session["role"],
      email: `${role.toLowerCase()}@example.test`,
      name: role,
    })),
  });
  mail.send.mockReset();
});
afterAll(() => db.$disconnect());
async function verified(kind: RegistrationKind, email = "new@example.test") {
  const issued = await actor("head").admin.issueRegistrationCode({
    kind,
    email,
  });
  let row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const staged = await setEmailVerification(row, email);
  if (!staged.ok) throw Error("Expected verification challenge");
  row = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  const confirmed = await confirmEmailCode(row, staged.emailCode);
  if (!confirmed.ok) throw Error("Expected email verification");
  const verifiedRow = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  if (!verifiedRow.code) throw Error("Expected an issued invitation code");
  return { ...verifiedRow, code: verifiedRow.code, completionProof: confirmed.completionProof };
}
const profile = {
  firstName: "New",
  lastName: "Person",
  password: "Password123!",
};
it("preserves a Head-selected account handle when tutor registration changes name and grade", async () => {
  await db.user.create({ data: { email: "new@example.test", name: "Old Name", role: "STUDENT", username: "customhandle", emailVerifiedAt: new Date() } });
  await db.term.create({ data: { name: "Test Term", schoolYear: "26-27", quarter: "Q1", active: true } });
  const row = await verified("TUTOR");
  expect(await completeRegistration(row, { ...profile, gradeLevel: 11, completionProof: row.completionProof })).toEqual({ ok: true, username: "customhandle" });
  const account = await db.user.findUniqueOrThrow({ where: { email: "new@example.test" }, include: { tutor: true } });
  expect(account.username).toBe("customhandle");
  expect(account.tutor?.username).toBe("customhandle");
});
it("adopts a new account's provisional roster username instead of regenerating it", async () => {
  // A reported grade now belongs to the active program year, never a free-form client year.
  await db.term.create({ data: { name: "Test Term", schoolYear: "26-27", quarter: "Q1", active: true } });
  const roster = await db.tutor.create({ data: { englishName: "Old Name", email: "new@example.test", username: "rosterhandle" } });
  const row = await verified("TUTOR");
  await db.registrationCode.update({ where: { id: row.id }, data: { tutorId: roster.id } });
  expect(await completeRegistration({ ...row, tutorId: roster.id }, { ...profile, gradeLevel: 12, completionProof: row.completionProof })).toEqual({ ok: true, username: "rosterhandle" });
});
it("accepts single-token names and optional Latin spelling for new verified accounts", async () => {
  const row = await verified("CREW");
  // No reported grade means no academic suffix or mandatory confirmation; the
  // completion contract still explicitly distinguishes login creation from activation.
  expect(await publicCaller().registration.complete({ code: row.code, completionProof: row.completionProof, firstName: "王小明", lastName: "", preferredLatinName: "Xiaoming Wang", password: profile.password })).toEqual({ ok: true, username: "xwang", academicConfirmationRequired: false });
});
it.each(REGISTRATION_KINDS)(
  "completes verified %s registration with only the intended participation",
  async (kind) => {
    const client = publicCaller();
    const issued = await actor("head").admin.issueRegistrationCode({
      kind,
      email: "new@example.test",
    });
    expect(
      await client.registration.check({ code: issued.code }),
    ).toMatchObject({ kind, emailVerified: false });
    await expect(
      client.registration.complete({ code: issued.code, completionProof: "0".repeat(64), ...profile }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await client.registration.sendEmailCode({
      code: issued.code,
      email: "new@example.test",
    });
    const sent = mail.send.mock.calls[0]?.[0] as { text: string };
    const otp = /verification code is ([A-Z0-9]{5})/.exec(sent.text)?.[1];
    if (!otp) throw Error("No email OTP captured");
    await expect(
      client.registration.verifyEmail({
        code: issued.code,
        emailCode: "WRONG",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { completionProof } = await client.registration.verifyEmail({
      code: issued.code,
      emailCode: otp,
    });
    await client.registration.complete({ code: issued.code, completionProof, ...profile });
    const user = await db.user.findUniqueOrThrow({
      where: { email: "new@example.test" },
    });
    expect(user.role).toBe(kind);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(Boolean(user.tutorId)).toBe(kind === "TUTOR");
    expect(user.crewStatus).toBe(kind === "CREW" ? "ACTIVE" : null);
    expect(user.tuteeMember).toBe(false);
    expect(user.canTranslate).toBe(false);
    expect(
      await db.registrationCode.findUnique({ where: { id: issued.id } }),
    ).toMatchObject({ issuedById: "head", usedByUserId: user.id });
    await expect(
      client.registration.complete({ code: issued.code, completionProof, ...profile }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  },
);
it.each(["ADMIN", "COORDINATOR"] as const)(
  "requires Head authorization and hides %s codes from non-Head accounts",
  async (kind) => {
    for (const id of ["admin", "coordinator"]) {
      await expect(
        actor(id).admin.issueRegistrationCode({ kind }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await db.registrationCode.count()).toBe(0);
    }
    const requests = await db.approvalRequest.findMany();
    await expect(
      actor("admin").approval.decide({
        id: requests[0]!.id,
        approve: true,
        note: "Not Head",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await actor("head").approval.decide({
      id: requests[0]!.id,
      approve: true,
      note: "Management invitation authorized",
    });
    const codes = await actor("head").admin.registrationCodes();
    expect(codes).toHaveLength(1);
    expect(codes[0]?.kind).toBe(kind);
    for (const id of ["admin", "coordinator", "viewer"])
      expect(await actor(id).admin.registrationCodes()).toHaveLength(0);
    await expect(
      actor("admin").admin.revokeRegistrationCode({ id: codes[0]!.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await actor("head").admin.revokeRegistrationCode({ id: codes[0]!.id });
    expect(await resolveUsableCode(codes[0]!.code!)).toEqual({
      ok: false,
      error: "not-found",
    });
  },
);
it.each(["ADMIN", "COORDINATOR"] as const)(
  "preserves existing primary and secondary account credentials for %s codes",
  async (kind) => {
    await db.accountEmail.create({
      data: {
        email: "alias@example.test",
        userId: "admin",
        verifiedAt: new Date(),
      },
    });
    const before = await db.user.findUniqueOrThrow({ where: { id: "admin" } });
    for (const email of ["admin@example.test", "alias@example.test"]) {
      const row = await verified(kind, email);
      expect(await completeRegistration(row, { ...profile, completionProof: row.completionProof })).toEqual({
        ok: false,
        error: "email-taken",
      });
      expect(
        (await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } }))
          .usedAt,
      ).toBeNull();
    }
    const after = await db.user.findUniqueOrThrow({ where: { id: "admin" } });
    expect(after).toEqual(before);
  },
);
it.each(["ADMIN", "COORDINATOR"] as const)(
  "rejects expired, revoked and replaced verification evidence for %s",
  async (kind) => {
    const row = await verified(kind);
    await db.registrationCode.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(completeRegistration(row, { ...profile, completionProof: row.completionProof })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await db.registrationCode.update({
      where: { id: row.id },
      data: { expiresAt: new Date("2099-01-01"), emailVerifiedAt: null },
    });
    await expect(completeRegistration(row, { ...profile, completionProof: row.completionProof })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await actor("head").admin.revokeRegistrationCode({ id: row.id });
    await expect(completeRegistration(row, { ...profile, completionProof: row.completionProof })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await db.user.findUnique({ where: { email: "new@example.test" } }),
    ).toBeNull();
  },
);
it("rejects non-Head helper issuance, suspension, participation bindings and HEAD codes", async () => {
  await expect(
    issueRegistrationCode({ kind: "ADMIN", issuedById: "admin" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    actor("head").admin.issueRegistrationCode({
      kind: "ADMIN",
      tutorId: "any-tutor",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    actor("head").admin.issueRegistrationCode({ kind: "HEAD" as "ADMIN" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.user.update({
    where: { id: "head" },
    data: { suspendedAt: new Date() },
  });
  await expect(
    actor("head").admin.issueRegistrationCode({ kind: "ADMIN" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("keeps email binding and public request rate limits", async () => {
  const issued = await actor("head").admin.issueRegistrationCode({
    kind: "ADMIN",
    email: "bound@example.test",
  });
  await expect(
    publicCaller().registration.sendEmailCode({
      code: issued.code,
      email: "other@example.test",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const client = publicCaller();
  for (let i = 0; i < 10; i++)
    await client.registration.check({ code: issued.code });
  await expect(
    client.registration.check({ code: issued.code }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("serializes competing redemptions and retains used invitation history", async () => {
  const row = await verified("ADMIN");
  const results = await Promise.allSettled([
    completeRegistration(row, { ...profile, completionProof: row.completionProof }),
    completeRegistration(row, { ...profile, completionProof: row.completionProof }),
  ]);
  expect(
    results.filter((r) => r.status === "fulfilled" && r.value.ok),
  ).toHaveLength(1);
  expect(await db.user.count({ where: { email: "new@example.test" } })).toBe(1);
  await expect(
    actor("head").admin.revokeRegistrationCode({ id: row.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } }))
      .usedByUserId,
  ).not.toBeNull();
});

it.each(REGISTRATION_KINDS)("requires the verifier's completion proof for %s invitations", async (kind) => {
  const row = await verified(kind);
  const attacker = publicCaller();
  const inspected = await attacker.registration.check({ code: row.code });
  expect(inspected).not.toHaveProperty("completionProof");
  await expect(attacker.registration.complete({ code: row.code, ...profile, completionProof: "0".repeat(64) }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.user.findUnique({ where: { email: row.pendingEmail! } })).toBeNull();
  await expect(publicCaller().registration.complete({ code: row.code, ...profile, completionProof: row.completionProof }))
    .resolves.toMatchObject({ ok: true });
});

it("expires verified invitation grants and invalidates them when mail is resent", async () => {
  const row = await verified("ADMIN");
  await db.registrationCode.update({ where: { id: row.id }, data: { emailCodeExpiresAt: new Date(0) } });
  await expect(publicCaller().registration.complete({ code: row.code, ...profile, completionProof: row.completionProof }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  const staged = await setEmailVerification(row, row.pendingEmail!);
  if (!staged.ok) throw Error("Expected resend");
  const replacement = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  const verifiedAgain = await confirmEmailCode(replacement, staged.emailCode);
  if (!verifiedAgain.ok) throw Error("Expected replacement verification");
  await expect(publicCaller().registration.complete({ code: row.code, ...profile, completionProof: row.completionProof }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(publicCaller().registration.complete({ code: row.code, ...profile, completionProof: verifiedAgain.completionProof }))
    .resolves.toMatchObject({ ok: true });
});
