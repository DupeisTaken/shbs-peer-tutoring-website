import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "~/server/email/sender";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
  available: true,
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => mail.available,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { issueTutorSetupLink, resetPassword } from "./password-reset";
import { hashPassword, verifyPassword } from "./password";
import { lockUsernameNamespace } from "./username";
import { linkTutorHistory, previewTutorHistory } from "../tutor-history";

const password = "OriginalPassword123!";
const caller = (role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "actor" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
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
  mail.send.mockReset().mockResolvedValue(undefined);
  mail.available = true;
});
afterAll(() => db.$disconnect());

it(
  "preserves direct-login recovery while rejecting a different retained owner",
  async () => {
    const tutor = await db.tutor.create({
      data: {
        englishName: "Archived Tutor",
        email: "old@example.test",
        status: "ARCHIVED",
      },
    });
    await db.user.createMany({
      data: [
        { id: "actor", email: "head@example.test", role: "HEAD" },
        {
          id: "owner",
          email: "current@example.test",
          role: "STUDENT",
          tutorId: tutor.id,
          passwordHash: hashPassword(password),
          emailVerifiedAt: new Date(),
        },
      ],
    });
    await db.user.create({
      data: {
        id: "previous-owner",
        email: "previous-owner@example.test",
        role: "STUDENT",
      },
    });
    // The database rejects conflicting owners; recovery never repairs or
    // bypasses that invariant. Same-owner retained/direct links remain valid.
    await expect(
      db.tutorProfileOwnership.create({
        data: { tutorId: tutor.id, userId: "previous-owner" },
      }),
    ).rejects.toThrow("Tutor has another current login; use account combination");
    await db.tutorProfileOwnership.create({
      data: { tutorId: tutor.id, userId: "owner" },
    });
    expect(
      await caller("HEAD").admin.sendTutorSetup({ tutorId: tutor.id }),
    ).toEqual({ emailed: true });
    expect(mail.send.mock.calls[0]![0].to).toBe("current@example.test");
    expect(await db.registrationCode.count()).toBe(0);
    expect(await db.accountInvitation.count()).toBe(0);
    expect(await db.passwordResetToken.count()).toBe(1);
    expect(
      await db.tutorProfileOwnership.findUnique({ where: { tutorId: tutor.id } }),
    ).toMatchObject({ userId: "owner" });
    expect(await db.user.findUnique({ where: { id: "owner" } })).toMatchObject({
      tutorId: tutor.id,
      role: "STUDENT",
    });
  },
);

it.each([
  ["COORDINATOR", "HEAD"],
  ["COORDINATOR", "ADMIN"],
  ["ADMIN", "HEAD"],
  ["ADMIN", "ADMIN"],
] as const)(
  "%s receives no recovery secret for a tutor-linked %s; only the recipient can redeem mail",
  async (actorRole, targetRole) => {
    const tutor = await db.tutor.create({
      data: { englishName: "Target", email: "target@example.test" },
    });
    await db.user.createMany({
      data: [
        { id: "actor", email: "actor@example.test", role: actorRole },
        {
          id: "target",
          email: "target@example.test",
          role: targetRole,
          tutorId: tutor.id,
          passwordHash: hashPassword(password),
          emailVerifiedAt: new Date(),
        },
      ],
    });
    const result = await caller(actorRole).admin.sendTutorSetup({
      tutorId: tutor.id,
    });
    expect(result).toEqual({ emailed: true });
    expect(result).not.toHaveProperty("link");
    expect(mail.send).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0]![0];
    expect(message.to).toBe("target@example.test");
    const token = /token=([a-f0-9]{64})/.exec(message.text)?.[1];
    if (!token) throw Error("Expected recipient-only reset token");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(
      await resetPassword("0".repeat(64), "AttackerPassword123!"),
    ).toBeNull();
    expect(
      verifyPassword(
        password,
        (await db.user.findUniqueOrThrow({ where: { id: "target" } }))
          .passwordHash!,
      ),
    ).toBe(true);
    expect(await resetPassword(token, "OwnerNewPassword123!")).toMatchObject({
      email: "target@example.test",
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: "target" } })).role,
    ).toBe(targetRole);
  },
);

it.each(["ADMIN", "HEAD"] as const)("allows %s provisioning and never returns a setup token even internally", async (role) => {
  const tutor = await db.tutor.create({
    data: { englishName: "New Tutor", email: "new-tutor@example.test" },
  });
  await db.user.create({
    data: { id: "actor", email: "actor@example.test", role: "COORDINATOR" },
  });
  await expect(
    caller("COORDINATOR").admin.sendTutorSetup({ tutorId: tutor.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.passwordResetToken.count()).toBe(0);
  await db.user.update({ where: { id: "actor" }, data: { role } });
  expect(await issueTutorSetupLink(tutor.id, "actor")).toEqual({
    ok: true,
    emailed: true,
  });
  expect(
    await db.user.findUnique({ where: { email: "new-tutor@example.test" } }),
  ).toBeNull();
  expect(
    await db.accountInvitation.findFirst({
      where: { email: "new-tutor@example.test" },
    }),
  ).toMatchObject({ kind: "TUTOR", completedAt: null });
  expect(
    await db.registrationCode.findFirst({ where: { tutorId: tutor.id } }),
  ).toMatchObject({ kind: "TUTOR", usedAt: null });
  expect(mail.send.mock.calls[0]![0].to).toBe("new-tutor@example.test");
});

it("fails before provisioning or issuing grants when email delivery is unavailable", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "New Tutor", email: "new-tutor@example.test" },
  });
  await db.user.create({
    data: { id: "actor", email: "actor@example.test", role: "HEAD" },
  });
  mail.available = false;
  await expect(
    caller("HEAD").admin.sendTutorSetup({ tutorId: tutor.id }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.user.count()).toBe(1);
  expect(await db.passwordResetToken.count()).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});

it("rechecks retained ownership after setup waits behind a historical-link transaction", async () => {
  const tutor = await db.tutor.create({
    data: {
      englishName: "Historical source",
      email: "archive@example.test",
      status: "ARCHIVED",
    },
  });
  await db.user.createMany({
    data: [
      { id: "actor", email: "actor@example.test", role: "HEAD" },
      {
        id: "history-owner",
        name: "Historical owner",
        email: "owner@example.test",
        role: "STUDENT",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    ],
  });
  const input = { tutorId: tutor.id, userId: "history-owner" };
  const preview = await previewTutorHistory(db, input);
  let releaseOwnership!: () => void;
  let ownershipCreated!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseOwnership = resolve;
  });
  const created = new Promise<void>((resolve) => {
    ownershipCreated = resolve;
  });
  const ownership = db.$transaction(
    async (tx) => {
      await linkTutorHistory(tx, "actor", {
        ...input,
        fingerprint: preview.fingerprint,
        reason: "Verified original historical identity",
        acknowledged: true,
      });
      ownershipCreated();
      await release;
    },
    { timeout: 10000 },
  );
  await Promise.race([created, ownership]);
  // The uncommitted owner is invisible to both setup preflights. The shared
  // namespace must hold issuance until ownership commits, then reject the write.
  const setup = caller("HEAD").admin.sendTutorSetup({ tutorId: tutor.id });
  const rejected = expect(setup).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message:
      "This tutor record has a retained historical owner. Use existing account recovery.",
  });
  try {
    await vi.waitFor(
      async () => {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        expect(Number(waiting[0]?.count)).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 25 },
    );
  } finally {
    releaseOwnership();
    await ownership;
    await rejected;
  }
  expect(
    await db.tutorProfileOwnership.findUnique({ where: { tutorId: tutor.id } }),
  ).toMatchObject({ userId: "history-owner" });
  expect(await db.registrationCode.count()).toBe(0);
  expect(await db.accountInvitation.count()).toBe(0);
  expect(await db.passwordResetToken.count()).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});

it.each([
  "attached-login",
  "changed-email",
  "missing-email",
  "deleted-tutor",
] as const)(
  "rechecks %s committed after accountless setup preflight",
  async (change) => {
    const tutor = await db.tutor.create({
      data: { englishName: "Setup target", email: "original@example.test" },
    });
    await db.user.create({
      data: { id: "actor", email: "actor@example.test", role: "HEAD" },
    });
    let releaseChange!: () => void;
    let changePrepared!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseChange = resolve;
    });
    const prepared = new Promise<void>((resolve) => {
      changePrepared = resolve;
    });
    // Keep the authoritative change uncommitted while setup reads its original
    // preflight. The real namespace fence admits issuance only after this commits.
    const update = db.$transaction(
      async (tx) => {
        await lockUsernameNamespace(tx);
        if (change === "attached-login")
          await tx.user.create({
            data: {
              id: "new-owner",
              email: "owner@example.test",
              role: "TUTOR",
              tutorId: tutor.id,
            },
          });
        else if (change === "deleted-tutor")
          await tx.tutor.delete({ where: { id: tutor.id } });
        else
          await tx.tutor.update({
            where: { id: tutor.id },
            data: {
              email: change === "changed-email" ? "current@example.test" : null,
            },
          });
        changePrepared();
        await release;
      },
      { timeout: 10000 },
    );
    await Promise.race([prepared, update]);
    // Observe rejection immediately so a broken fence cannot create an unhandled
    // rejection while the test waits to inspect its transactional result.
    const setup = caller("HEAD").admin.sendTutorSetup({ tutorId: tutor.id }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      await vi.waitFor(
        async () => {
          const waiting = await db.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
          expect(Number(waiting[0]?.count)).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 25 },
      );
    } finally {
      releaseChange();
      await update;
      await setup;
    }
    const result = await setup;
    if (change === "changed-email") {
      expect(result).toEqual({ ok: true, value: { emailed: true } });
      expect(
        await db.registrationCode.findFirst({ where: { tutorId: tutor.id } }),
      ).toMatchObject({ email: "current@example.test", usedAt: null });
      expect(await db.accountInvitation.findMany()).toEqual([
        expect.objectContaining({ email: "current@example.test", kind: "TUTOR" }),
      ]);
      expect(mail.send).toHaveBeenCalledOnce();
      expect(mail.send.mock.calls[0]![0].to).toBe("current@example.test");
    } else {
      const expected = {
        "attached-login": {
          code: "CONFLICT",
          message:
            "This tutor now has an attached login. Refresh before sending setup.",
        },
        "missing-email": {
          code: "BAD_REQUEST",
          message: "Add an email for this tutor before sending a setup link.",
        },
        "deleted-tutor": { code: "NOT_FOUND", message: "Tutor not found." },
      }[change];
      expect(result).toMatchObject({ ok: false, error: expected });
      expect(await db.registrationCode.count()).toBe(0);
      expect(await db.accountInvitation.count()).toBe(0);
      expect(mail.send).not.toHaveBeenCalled();
    }
    expect(await db.passwordResetToken.count()).toBe(0);
  },
);
