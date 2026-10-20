import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import type * as Environment from "~/env";
import type { PrismaClient } from "../../generated/prisma";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

type Mail = { to: string; text: string };
type Acceptance = { accepted: string[]; rejected: string[] };
const smtp = vi.hoisted(() => {
  const env: Record<string, unknown> = {};
  return {
    env,
    send: vi.fn<(message: Mail) => Promise<Acceptance>>(),
    close: vi.fn(),
  };
});
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Environment>();
  Object.assign(smtp.env, actual.env);
  return { ...actual, env: smtp.env };
});
// Keep the sender, audit middleware and real PostgreSQL transactions intact.
// Only the synthetic SMTP provider boundary is replaced; no mail leaves this test.
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: smtp.send, close: smtp.close }),
  },
}));

import { createCaller } from "./api/root";
import { db } from "./db";
import { approvalScope, databaseScope } from "./db-scope";
import { historyTokenDigest, inviteTuteeHistory } from "./tutee-history";
import {
  startHistoryAccount,
  verifyHistoryAccount,
  completeHistoryAccount,
} from "./history-account-setup";
import {
  issueHistoryAccountInvitation,
  redeemAccountInvitation,
} from "./auth/account-invitations";
import { RECORD_TABLES } from "./record-transfer";

const reason =
  "Reviewed historical identity and accessible school archive email";
const oldToken = "a".repeat(64);
let actorId: string;
const caller = (id = actorId, role: Session["role"] = "ADMIN", client = db) =>
  createCaller({
    db: client,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });
const invite = async (email = "replacement@example.test", client = db) => {
  const record = await db.tutee.findUniqueOrThrow({
    where: { id: "history-past" },
  });
  return caller(actorId, "ADMIN", client).tuteeHistory.invite({
    tuteeId: record.id,
    email,
    expectedUpdatedAt: record.updatedAt,
    reason,
  });
};
const current = () =>
  db.tuteeHistoryInvitation.findUnique({ where: { tuteeId: "history-past" } });
const latest = () =>
  db.tuteeHistoryInvitationAttempt.findFirstOrThrow({
    where: { tuteeId: "history-past" },
    orderBy: { sequence: "desc" },
  });
const status = () =>
  caller().tuteeHistory.invitationStatus({ tuteeId: "history-past" });
const accepted = (message: Mail) => ({ accepted: [message.to], rejected: [] });
const mailToken = (message: Mail) => {
  const token = /token=([a-f0-9]{64})/.exec(message.text)?.[1];
  if (!token) throw new Error("Missing historical invitation token");
  return token;
};
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
async function entered(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SMTP did not start")), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// This root-client wrapper preserves real transactions while simulating the two
// possible outcomes of a lost database acknowledgement after external acceptance.
function faultClient(
  fault: "rollback" | "committed" | "unreadable" | "unavailable",
) {
  let transactions = 0;
  return new Proxy(db, {
    get(target, key) {
      if (key === "$transaction")
        return async (
          work: Parameters<PrismaClient["$transaction"]>[0],
          options?: unknown,
        ) => {
          const turn = ++transactions;
          if (turn === 2 && ["rollback", "unreadable"].includes(fault))
            throw new Error("Injected finalization outage");
          const result = await (
            target.$transaction as (
              callback: unknown,
              settings?: unknown,
            ) => Promise<unknown>
          )(work, options);
          if (turn === 1 && fault === "unavailable")
            smtp.env.SMTP_SECURITY_PASSWORD = undefined;
          if (turn === 2 && fault === "committed")
            throw new Error("Injected lost commit acknowledgement");
          return result;
        };
      if (key === "tuteeHistoryInvitationAttempt" && fault === "unreadable")
        return new Proxy(target.tuteeHistoryInvitationAttempt, {
          get(delegate, method) {
            if (method === "findUnique" && !databaseScope.getStore())
              return async () => {
                throw new Error("Injected read outage");
              };
            const value: unknown = Reflect.get(delegate, method);
            return value;
          },
        });
      const value: unknown = Reflect.get(target, key);
      return value;
    },
  });
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  vi.stubEnv("AUTH_URL", "https://history.example.test");
  Object.assign(smtp.env, {
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 465,
    EMAIL_SECURITY_FROM: "security@example.test",
    SMTP_SECURITY_PASSWORD: "synthetic-secret",
    SMTP_SECURITY_USER: undefined,
    EMAIL_FROM: undefined,
    SMTP_PASSWORD: undefined,
  });
  smtp.send.mockReset().mockImplementation(async (message) => ({
    accepted: [message.to],
    rejected: [],
  }));
  actorId = `history-admin-${randomUUID()}`;
  await db.user.createMany({
    data: [
      { id: actorId, email: "admin@example.test", role: "ADMIN" },
      {
        id: "history-student",
        email: "old@example.test",
        role: "STUDENT",
        emailVerifiedAt: new Date(),
        passwordHash: "unused-test-password-hash",
      },
    ],
  });
  await db.term.create({
    data: {
      id: "history-current",
      name: "Current",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  const record = await db.tutee.create({
    data: {
      id: "history-past",
      englishName: "Historical Learner",
      status: "INACTIVE",
    },
  });
  await db.tuteeHistoryInvitation.create({
    data: {
      tuteeId: record.id,
      tokenHash: historyTokenDigest(oldToken),
      email: "old@example.test",
      expectedUpdatedAt: record.updatedAt,
      issuedById: actorId,
      reason,
      expiresAt: new Date(Date.now() + 86400000),
      setupAttempts: 2,
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

it("keeps the predecessor usable at real post-commit SMTP handoff and after rejected delivery", async () => {
  const before = await current();
  let atHandoff: unknown;
  let handoffScope: unknown = "not reached";
  smtp.send.mockImplementation(async (message) => {
    handoffScope = databaseScope.getStore();
    atHandoff = await current();
    return { accepted: [], rejected: [message.to] };
  });
  await invite();
  expect(smtp.send).toHaveBeenCalledTimes(1);
  expect(handoffScope).toBeUndefined();
  expect(atHandoff).toEqual(before);
  expect(await current()).toEqual(before);
  await expect(
    caller("history-student", "STUDENT").tuteeHistory.inspectClaim({
      token: oldToken,
    }),
  ).resolves.toMatchObject({ name: "Historical Learner" });
});

it.each(["accepted", "rejected", "empty", "thrown", "unavailable"] as const)(
  "settles %s SMTP with durable admission and truthful publication evidence",
  async (outcome) => {
    const before = await current();
    let observed: unknown;
    let scopes: unknown[] = [];
    smtp.send.mockImplementation(async (message) => {
      observed = { predecessor: await current(), attempt: await latest() };
      scopes = [databaseScope.getStore(), approvalScope.getStore()];
      if (outcome === "thrown") throw new Error("PRIVATE-SMTP-CREDENTIAL");
      if (outcome === "empty") return { accepted: [], rejected: [] };
      if (outcome === "rejected")
        return { accepted: [], rejected: [message.to] };
      return accepted(message);
    });
    const receipt = await invite(
      "replacement@example.test",
      outcome === "unavailable" ? faultClient("unavailable") : db,
    );
    expect(receipt).toMatchObject({
      status: outcome === "accepted" ? "PUBLISHED" : "DELIVERY_FAILED",
    });
    expect(smtp.send).toHaveBeenCalledTimes(outcome === "unavailable" ? 0 : 1);
    if (outcome !== "unavailable") {
      expect(scopes).toEqual([undefined, undefined]);
      expect(observed).toMatchObject({
        predecessor: before,
        attempt: { status: "ADMITTED", id: receipt.attemptId },
      });
    }
    const attempt = await latest();
    expect(attempt.status).toBe(receipt.status);
    expect(+attempt.expiresAt - +attempt.createdAt).toBeGreaterThanOrEqual(
      7 * 86400000 - 1000,
    );
    expect(+attempt.expiresAt - +attempt.createdAt).toBeLessThan(
      7 * 86400000 + 1000,
    );
    if (outcome === "accepted") {
      expect(await current()).toMatchObject({
        tokenHash: historyTokenDigest(mailToken(smtp.send.mock.calls[0]![0])),
        setupAttempts: 0,
      });
      expect(receipt.expiresAt).toEqual(attempt.expiresAt);
    } else {
      expect(await current()).toEqual(before);
      expect(receipt.expiresAt).toBeNull();
    }
    const evidence = JSON.stringify(await db.auditLog.findMany());
    expect(evidence).not.toContain(attempt.tokenHash);
    expect(evidence).not.toContain(attempt.predecessorFingerprint);
    expect(evidence).not.toContain("PRIVATE-SMTP-CREDENTIAL");
    expect(evidence).toContain(
      outcome === "accepted" ? "PUBLISHED" : "DELIVERY_FAILED",
    );
    expect(RECORD_TABLES as readonly string[]).not.toContain(
      "TuteeHistoryInvitationAttempt",
    );
    expect(await db.user.count()).toBe(2);
    expect(await db.studentProfileOwnership.count()).toBe(0);
  },
);

it("does not send or retire the predecessor when admission audit rolls back", async () => {
  const before = await current();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION history_delivery_fail_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'tuteeHistory.invite' AND NEW.kind <> 'ATTEMPT' THEN RAISE EXCEPTION 'Injected admission audit failure'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      `CREATE TRIGGER history_delivery_fail_admission BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION history_delivery_fail_admission()`,
    );
    try {
      await expect(invite()).rejects.toBeDefined();
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS history_delivery_fail_admission ON "AuditLog"`,
      );
    }
  } finally {
    await db.$executeRawUnsafe(
      `DROP FUNCTION history_delivery_fail_admission()`,
    );
  }
  expect(smtp.send).not.toHaveBeenCalled();
  expect(await current()).toEqual(before);
  expect(await db.tuteeHistoryInvitationAttempt.count()).toBe(0);
});

it.each(["rollback", "committed", "unreadable"] as const)(
  "recovers %s finalization without replaying SMTP or admission",
  async (fault) => {
    const before = await current();
    const receipt = await invite(
      "replacement@example.test",
      faultClient(fault),
    );
    expect(receipt.status).toBe(
      fault === "committed" ? "PUBLISHED" : "UNCERTAIN",
    );
    expect((await latest()).status).toBe(
      fault === "committed" ? "PUBLISHED" : "ADMITTED",
    );
    expect(smtp.send).toHaveBeenCalledTimes(1);
    expect(await db.tuteeHistoryInvitationAttempt.count()).toBe(1);
    if (fault !== "committed") expect(await current()).toEqual(before);
    const refreshed = await status();
    expect(refreshed?.attempt?.status).toBe(receipt.status);
    expect(smtp.send).toHaveBeenCalledTimes(1);
  },
);

it.each(["accepted", "rejected"] as const)(
  "keeps latest staff intent authoritative when a newer %s attempt overtakes slow accepted SMTP",
  async (newOutcome) => {
    const before = await current();
    const started = gate();
    const release = gate();
    let calls = 0;
    smtp.send.mockImplementation(async (message) => {
      if (++calls === 1) {
        started.open();
        await release.promise;
        return accepted(message);
      }
      return newOutcome === "accepted"
        ? accepted(message)
        : { accepted: [], rejected: [message.to] };
    });
    const slow = invite("slow@example.test");
    const settled = Promise.allSettled([slow]);
    let fast: Awaited<ReturnType<typeof invite>> | undefined;
    try {
      await entered(started.promise);
      fast = await invite("newest@example.test");
    } finally {
      release.open();
      await settled;
    }
    expect((await slow).status).toBe("SUPERSEDED");
    expect(fast?.status).toBe(
      newOutcome === "accepted" ? "PUBLISHED" : "DELIVERY_FAILED",
    );
    if (newOutcome === "accepted")
      expect((await current())?.email).toBe("newest@example.test");
    else expect(await current()).toEqual(before);
    expect((await status())?.attempt?.attemptId).toBe(fast?.attemptId);
    expect(smtp.send).toHaveBeenCalledTimes(2);
  },
);

it.each(["accepted", "rejected"] as const)(
  "keeps the old accepted attempt superseded while the latest %s delivery is still pending",
  async (newOutcome) => {
    const before = await current();
    const oldStarted = gate();
    const newStarted = gate();
    const oldRelease = gate();
    const newRelease = gate();
    let calls = 0;
    smtp.send.mockImplementation(async (message) => {
      if (++calls === 1) {
        oldStarted.open();
        await oldRelease.promise;
        return accepted(message);
      }
      newStarted.open();
      await newRelease.promise;
      return newOutcome === "accepted"
        ? accepted(message)
        : { accepted: [], rejected: [message.to] };
    });
    const older = invite("older@example.test");
    let newer: ReturnType<typeof invite> | undefined;
    try {
      await entered(oldStarted.promise);
      newer = invite("newer@example.test");
      await entered(newStarted.promise);
      oldRelease.open();
      expect((await older).status).toBe("SUPERSEDED");
      expect(await current()).toEqual(before);
      expect((await status())?.attempt?.status).toBe("UNCERTAIN");
    } finally {
      oldRelease.open();
      newRelease.open();
      await Promise.allSettled([older, ...(newer ? [newer] : [])]);
    }
    expect((await newer)?.status).toBe(
      newOutcome === "accepted" ? "PUBLISHED" : "DELIVERY_FAILED",
    );
    if (newOutcome === "accepted")
      expect((await current())?.email).toBe("newer@example.test");
    else expect(await current()).toEqual(before);
  },
);

it("rolls back accepted publication atomically when its final audit fails", async () => {
  const before = await current();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION history_delivery_fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'tuteeHistory.inviteDelivery' AND NEW.details->>'outcome' = 'PUBLISHED' THEN RAISE EXCEPTION 'Injected publication audit failure'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      `CREATE TRIGGER history_delivery_fail_publication BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION history_delivery_fail_publication()`,
    );
    try {
      expect((await invite()).status).toBe("UNCERTAIN");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS history_delivery_fail_publication ON "AuditLog"`,
      );
    }
  } finally {
    await db.$executeRawUnsafe(
      `DROP FUNCTION history_delivery_fail_publication()`,
    );
  }
  expect(await current()).toEqual(before);
  expect((await latest()).status).toBe("ADMITTED");
  expect(smtp.send).toHaveBeenCalledTimes(1);
  const refreshed = await status();
  expect(refreshed?.attempt?.status).toBe("UNCERTAIN");
  expect(smtp.send).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "cancels in-flight delivery with first send=%s before it can publish",
  async (firstSend) => {
    if (firstSend) await db.tuteeHistoryInvitation.deleteMany();
    const started = gate();
    const release = gate();
    smtp.send.mockImplementation(async (message) => {
      started.open();
      await release.promise;
      return accepted(message);
    });
    const pending = invite();
    const settled = Promise.allSettled([pending]);
    try {
      await entered(started.promise);
      const displayed = await status();
      expect(displayed?.attempt).toMatchObject({
        status: "UNCERTAIN",
        expiresAt: null,
      });
      expect(displayed?.invitation === null).toBe(firstSend);
      await expect(
        caller().tuteeHistory.cancelInvitation({
          tuteeId: "history-past",
          revision: displayed!.revision,
        }),
      ).resolves.toEqual({ cancelled: true });
    } finally {
      release.open();
      await settled;
    }
    expect((await pending).status).toBe("SUPERSEDED");
    expect(await current()).toBeNull();
  },
);

it("requires fresh cancellation review after candidate publication", async () => {
  const started = gate();
  const release = gate();
  smtp.send.mockImplementation(async (message) => {
    started.open();
    await release.promise;
    return accepted(message);
  });
  const pending = invite();
  const settled = Promise.allSettled([pending]);
  let revision = "";
  try {
    await entered(started.promise);
    revision = (await status())!.revision;
  } finally {
    release.open();
    await settled;
  }
  expect((await pending).status).toBe("PUBLISHED");
  await expect(
    caller().tuteeHistory.cancelInvitation({
      tuteeId: "history-past",
      revision,
    }),
  ).rejects.toThrow("HISTORY_STALE");
  expect(await current()).not.toBeNull();
});

it.each([
  "record",
  "owner",
  "currentOwner",
  "current",
  "demotion",
  "suspension",
  "merged",
  "claim",
  "staffLink",
  "setup",
  "expiry",
] as const)(
  "refuses accepted publication after %s changes during delivery",
  async (change) => {
    const before = await current();
    const transitionErrors: unknown[] = [];
    smtp.send.mockImplementation(async (message) => {
      try {
        if (change === "record")
          await db.tutee.update({
            where: { id: "history-past" },
            data: { englishName: "Corrected label" },
          });
        if (change === "owner")
          await db.studentProfileOwnership.create({
            data: { tuteeId: "history-past", userId: "history-student" },
          });
        if (change === "currentOwner")
          await db.user.update({
            where: { id: "history-student" },
            data: { studentId: "history-past" },
          });
        if (change === "current")
          await db.tutee.update({
            where: { id: "history-past" },
            data: { status: "ACTIVE", intakeTermId: "history-current" },
          });
        if (change === "demotion")
          await db.user.update({
            where: { id: actorId },
            data: { role: "STUDENT" },
          });
        if (change === "suspension")
          await db.user.update({
            where: { id: actorId },
            data: { suspendedAt: new Date() },
          });
        if (change === "merged")
          await db.user.update({
            where: { id: actorId },
            data: { mergedIntoId: "history-student" },
          });
        if (change === "claim")
          await caller("history-student", "STUDENT").tuteeHistory.claim({
            token: oldToken,
          });
        if (change === "staffLink") {
          const preview = await caller().tuteeHistory.preview({
            tuteeId: "history-past",
            userId: "history-student",
          });
          await caller().tuteeHistory.link({
            tuteeId: "history-past",
            userId: "history-student",
            fingerprint: preview.fingerprint,
            reason,
          });
        }
        if (change === "setup")
          await db.tuteeHistoryInvitation.update({
            where: { tuteeId: "history-past" },
            data: {
              setupAttempts: { increment: 1 },
              setupVerifiedAt: new Date(),
            },
          });
        if (change === "expiry")
          await db.tuteeHistoryInvitationAttempt.update({
            where: { id: (await latest()).id },
            data: { expiresAt: new Date(0) },
          });
      } catch (error) {
        transitionErrors.push(error);
        throw error;
      }
      return accepted(message);
    });
    expect((await invite()).status).toBe("SUPERSEDED");
    expect(transitionErrors).toEqual([]);
    if (change === "claim" || change === "staffLink")
      expect(await current()).toBeNull();
    else if (change === "setup")
      expect(await current()).toMatchObject({
        tokenHash: before?.tokenHash,
        setupAttempts: 3,
      });
    else expect(await current()).toEqual(before);
  },
);

it("rechecks the active-period historical predicate after term rollover during SMTP", async () => {
  await db.term.create({
    data: {
      id: "history-old",
      name: "Old",
      schoolYear: "24-25",
      quarter: "Q1",
      active: false,
    },
  });
  const record = await db.tutee.update({
    where: { id: "history-past" },
    data: { status: "ACTIVE", intakeTermId: "history-old" },
  });
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: record.id },
    data: { expectedUpdatedAt: record.updatedAt },
  });
  const before = await current();
  smtp.send.mockImplementation(async (message) => {
    await db.term.update({
      where: { id: "history-current" },
      data: { active: false },
    });
    await db.term.update({
      where: { id: "history-old" },
      data: { active: true },
    });
    return accepted(message);
  });
  expect((await invite()).status).toBe("SUPERSEDED");
  expect(await current()).toEqual(before);
});

it("lets the old recipient request a separate setup code while replacement SMTP is pending", async () => {
  const started = gate();
  const release = gate();
  smtp.send.mockImplementation(async (message) => {
    if (message.text.includes("token=")) {
      started.open();
      await release.promise;
    }
    return accepted(message);
  });
  const pending = invite();
  const settled = Promise.allSettled([pending]);
  let progressed: Awaited<ReturnType<typeof current>> = null;
  try {
    await entered(started.promise);
    await startHistoryAccount(db, {
      token: oldToken,
      email: "old@example.test",
    });
    progressed = await current();
    expect(progressed?.setupCodeHash).not.toBeNull();
  } finally {
    release.open();
    await settled;
  }
  expect((await pending).status).toBe("SUPERSEDED");
  expect(await current()).toEqual(progressed);
  expect(smtp.send).toHaveBeenCalledTimes(2);
});

it("preserves an older in-flight candidate when a newer admission rolls back", async () => {
  const started = gate();
  const release = gate();
  smtp.send.mockImplementation(async (message) => {
    started.open();
    await release.promise;
    return accepted(message);
  });
  const pending = invite("older@example.test");
  const settled = Promise.allSettled([pending]);
  try {
    await entered(started.promise);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION history_delivery_fail_newer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'tuteeHistory.invite' AND NEW.kind <> 'ATTEMPT' THEN RAISE EXCEPTION 'Injected newer admission rollback'; END IF; RETURN NEW; END $$`,
    );
    try {
      await db.$executeRawUnsafe(
        `CREATE TRIGGER history_delivery_fail_newer BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION history_delivery_fail_newer()`,
      );
      try {
        await expect(invite("newer@example.test")).rejects.toBeDefined();
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS history_delivery_fail_newer ON "AuditLog"`,
        );
      }
    } finally {
      await db.$executeRawUnsafe(`DROP FUNCTION history_delivery_fail_newer()`);
    }
    expect((await latest()).status).toBe("ADMITTED");
    expect(smtp.send).toHaveBeenCalledTimes(1);
  } finally {
    release.open();
    await settled;
  }
  expect((await pending).status).toBe("PUBLISHED");
  expect((await current())?.email).toBe("older@example.test");
  expect(await db.tuteeHistoryInvitationAttempt.count()).toBe(1);
});

async function verifiedSetup(email = "old@example.test") {
  await startHistoryAccount(db, { token: oldToken, email });
  const code = / is ([0-9]{4})/.exec(smtp.send.mock.calls.at(-1)![0].text)?.[1];
  if (!code) throw new Error("Missing separate setup verification code");
  return {
    token: oldToken,
    email,
    ...(await verifyHistoryAccount(db, { token: oldToken, email, code })),
  };
}

it.each(["created", "completed"] as const)(
  "preserves a history account envelope %s during replacement SMTP even when the invitation row does not change",
  async (progress) => {
    const setup = await verifiedSetup();
    const envelope =
      progress === "completed"
        ? await issueHistoryAccountInvitation(db, setup, true)
        : null;
    const before = await current();
    smtp.send.mockClear();
    const errors: unknown[] = [];
    smtp.send.mockImplementation(async (message) => {
      try {
        if (progress === "created")
          await issueHistoryAccountInvitation(db, setup, true);
        else
          await redeemAccountInvitation(
            db,
            {
              invitationId: envelope!.invitationId,
              proof: envelope!.proof!,
              firstName: "",
              lastName: "",
              reviewed: true,
            },
            "history-student",
          );
      } catch (error) {
        errors.push(error);
        throw error;
      }
      return accepted(message);
    });
    expect((await invite()).status).toBe("SUPERSEDED");
    expect(errors).toEqual([]);
    expect(await current()).toEqual(before);
    const stored = await db.accountInvitation.findFirstOrThrow({
      where: { kind: "HISTORY" },
    });
    expect(stored.completedAt !== null).toBe(progress === "completed");
    expect((await current())?.setupUserId).toBeNull();
    await expect(
      caller("history-student", "STUDENT").tuteeHistory.inspectClaim({
        token: oldToken,
      }),
    ).resolves.toMatchObject({ name: "Historical Learner" });
  },
);

it("preserves credentials completed during SMTP, then permits a separate explicit claim without adding access", async () => {
  const email = "history-only@example.test";
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: "history-past" },
    data: { email },
  });
  const setup = await verifiedSetup(email);
  const archive = await db.tutee.findUniqueOrThrow({
    where: { id: "history-past" },
  });
  const errors: unknown[] = [];
  smtp.send.mockImplementation(async (message) => {
    try {
      await completeHistoryAccount(db, {
        ...setup,
        password: "History-only-password-412!",
      });
    } catch (error) {
      errors.push(error);
      throw error;
    }
    return accepted(message);
  });
  expect((await invite()).status).toBe("SUPERSEDED");
  expect(errors).toEqual([]);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user).toMatchObject({
    role: "STUDENT",
    tuteeMember: false,
    tutorId: null,
    studentId: null,
    tutorAccessRevoked: true,
  });
  expect((await current())?.setupUserId).toBe(user.id);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  await caller(user.id, "STUDENT").tuteeHistory.claim({ token: oldToken });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: archive.id } }),
  ).toEqual(archive);
  expect(
    await db.studentProfileOwnership.findUnique({
      where: { tuteeId: archive.id },
    }),
  ).toMatchObject({ userId: user.id });
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(
    user,
  );
});

it("rejects unavailable, unauthorized and stale admissions before SMTP or candidate creation", async () => {
  smtp.env.SMTP_SECURITY_PASSWORD = undefined;
  await expect(invite()).rejects.toThrow("HISTORY_EMAIL_UNAVAILABLE");
  smtp.env.SMTP_SECURITY_PASSWORD = "synthetic-secret";
  await db.user.update({
    where: { id: actorId },
    data: { role: "COORDINATOR" },
  });
  await expect(invite()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: actorId }, data: { role: "ADMIN" } });
  await expect(
    caller().tuteeHistory.invite({
      tuteeId: "history-past",
      email: "replacement@example.test",
      expectedUpdatedAt: new Date(0),
      reason,
    }),
  ).rejects.toThrow("HISTORY_STALE");
  expect(await db.tuteeHistoryInvitationAttempt.count()).toBe(0);
  expect(smtp.send).not.toHaveBeenCalled();
});

it.each(["bare", "scoped"] as const)(
  "refuses a %s transaction without an after-commit owner before admitting or sending",
  async (mode) => {
    const before = await current();
    const record = await db.tutee.findUniqueOrThrow({
      where: { id: "history-past" },
    });
    await expect(
      db.$transaction(async (tx) => {
        const work = () =>
          inviteTuteeHistory(mode === "bare" ? tx : db, actorId, {
            tuteeId: record.id,
            email: "replacement@example.test",
            expectedUpdatedAt: record.updatedAt,
            reason,
          });
        await expect(
          mode === "bare" ? work() : databaseScope.run(tx, work),
        ).rejects.toThrow("HISTORY_DELIVERY_COMMIT_REQUIRED");
        throw new Error("Deliberate caller rollback");
      }),
    ).rejects.toThrow("Deliberate caller rollback");
    expect(smtp.send).not.toHaveBeenCalled();
    expect(await db.tuteeHistoryInvitationAttempt.count()).toBe(0);
    expect(await current()).toEqual(before);
  },
);
