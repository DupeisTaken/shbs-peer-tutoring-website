import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { createCaller } from "~/server/api/root";
import { ApprovalQueued } from "~/server/approvals";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { hashCode, issueRegistrationCode } from "~/server/auth/registration";
import * as codeHelpers from "~/server/auth/code";
import * as audit from "~/server/audit/log";
import {
  inspectAccountInvitation,
  redeemAccountInvitation,
  enterDisplayedInvitation,
} from "~/server/auth/account-invitations";
import {
  crewApplicationStatus,
  decideCrewApplication,
  stageCrewVerification,
  verifyCrewApplication,
  type CrewApplicationResult,
} from "./signup";

const email = "crew@example.test";
const headers = new Headers({ "x-forwarded-for": "192.0.2.50" });
const draft = {
  name: "Original Crew",
  firstName: "Original",
  lastName: "Crew",
  email,
  message: "Original application",
};
const actor = (role: "HEAD" | "ADMIN" | "COORDINATOR" = "HEAD") =>
  createCaller({
    db,
    headers,
    session: {
      user: {
        id: role,
        name: role,
        email: `${role.toLowerCase()}@example.test`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
function code(target = email) {
  const message = mail.send.mock.calls
    .filter(([item]) => item.to === target)
    .at(-1)?.[0];
  if (!message?.presentation?.code) throw Error("Expected mailbox code");
  return message.presentation.code;
}
function receipt(result: CrewApplicationResult) {
  if (!result.invitation?.code || !result.invitation.proof)
    throw Error("Expected proved invitation receipt");
  return {
    ...result.invitation,
    code: result.invitation.code,
    proof: result.invitation.proof,
  };
}
async function pending() {
  await stageCrewVerification(db, email, draft);
  const result = await verifyCrewApplication(
    db,
    { email, code: code() },
    headers,
  );
  const application = await db.crewApplication.findFirstOrThrow();
  return { result, application };
}
async function approved() {
  const initial = await pending();
  const decision = await decideCrewApplication(
    db,
    { applicationId: initial.application.id, action: "ACCEPT" },
    { id: "HEAD", name: "HEAD" },
  );
  const result = await crewApplicationStatus(db, {
    email,
    statusProof: initial.result.statusProof,
  });
  return { ...initial, decision, current: result, invitation: receipt(result) };
}
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((table) => '"' + table.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  mail.send.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  await db.user.createMany({
    data: ["HEAD", "ADMIN", "COORDINATOR"].map((role) => ({
      id: role,
      name: role,
      role: role as "HEAD" | "ADMIN" | "COORDINATOR",
      email: `${role.toLowerCase()}@example.test`,
    })),
  });
});
afterAll(() => db.$disconnect());

it("keeps unverified drafts out of the queue and creates one application/notice on concurrent verification", async () => {
  await stageCrewVerification(db, email, draft);
  expect(await db.crewApplication.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
  const otp = code();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      verifyCrewApplication(
        db,
        { email: email.toUpperCase(), code: otp },
        headers,
      ),
    ),
  );
  expect(
    results.every(
      (result) => result.status === "PENDING" && !result.invitation,
    ),
  ).toBe(true);
  expect(new Set(results.map((result) => result.statusProof)).size).toBe(1);
  expect(await db.crewApplication.count()).toBe(1);
  expect(await db.notification.count()).toBe(1);
  expect(await db.notification.findFirstOrThrow()).toMatchObject({
    userId: "HEAD",
  });
  const creation = await db.auditLog.findMany({
    where: { operation: "crew.verifyApplication" },
  });
  expect(creation).toHaveLength(1);
  expect(creation[0]).toMatchObject({
    userId: null,
    userName: "System",
    details: {
      actorRole: "SYSTEM",
      outcome: "APPLIED",
      before: {},
      after: { status: "PENDING", name: draft.name },
    },
  });
  expect(JSON.stringify(creation[0]?.details)).not.toContain(email);
  expect(JSON.stringify(creation[0]?.details)).not.toContain(otp);
  expect(JSON.stringify(creation[0]?.details)).not.toContain(draft.message);
  expect(
    (await db.crewSignupVerification.findUniqueOrThrow({ where: { email } }))
      .draft,
  ).toBeNull();
  expect(await db.registrationCode.count()).toBe(0);
});
it("rolls back verified application, notice, capacity and proof when the creation audit fails", async () => {
  await stageCrewVerification(db, email, draft);
  const otp = code();
  const staged = await db.crewSignupVerification.findUniqueOrThrow({
    where: { email },
  });
  const failedAudit = vi
    .spyOn(audit, "recordAudit")
    .mockRejectedValueOnce(new Error("crew audit unavailable"));
  try {
    await expect(
      verifyCrewApplication(db, { email, code: otp }, headers),
    ).rejects.toThrow("crew audit unavailable");
  } finally {
    failedAudit.mockRestore();
  }
  expect(await db.crewApplication.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
  expect(
    await db.auditLog.count({ where: { operation: "crew.verifyApplication" } }),
  ).toBe(0);
  expect(await db.publicApplicationRateLimit.count()).toBe(0);
  expect(
    await db.crewSignupVerification.findUniqueOrThrow({ where: { email } }),
  ).toEqual(staged);
  await expect(
    verifyCrewApplication(db, { email, code: otp }, headers),
  ).resolves.toMatchObject({ status: "PENDING" });
  expect(await db.crewApplication.count()).toBe(1);
  expect(
    await db.auditLog.count({ where: { operation: "crew.verifyApplication" } }),
  ).toBe(1);
});
it("preserves a staged draft through explicit resend and refuses the preceding challenge", async () => {
  await stageCrewVerification(db, email, draft);
  const old = code();
  await stageCrewVerification(db, email, undefined, true);
  const replacement = code();
  expect(replacement).not.toBe(old);
  await expect(
    verifyCrewApplication(db, { email, code: old }, headers),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
  await verifyCrewApplication(db, { email, code: replacement }, headers);
  expect(await db.crewApplication.findFirstOrThrow()).toMatchObject({
    name: draft.name,
    message: draft.message,
  });
});
it("does not submit an unverified draft when the recipient starts check-existing", async () => {
  await stageCrewVerification(db, email, draft);
  await stageCrewVerification(db, email);
  expect(
    await verifyCrewApplication(db, { email, code: code() }, headers),
  ).toMatchObject({ status: "NOT_FOUND" });
  expect(await db.crewApplication.count()).toBe(0);
});
it("returns the same unproved response for unknown and existing emails, with no status or code", async () => {
  await db.crewApplication.create({ data: { ...draft, status: "REJECTED" } });
  const caller = createCaller({ db, session: null, headers });
  expect(await caller.crew.requestStatus({ email })).toEqual({ ok: true });
  expect(
    await caller.crew.requestStatus({ email: "unknown@example.test" }),
  ).toEqual({ ok: true });
  await expect(
    caller.crew.applicationStatus({ email, statusProof: "0".repeat(64) }),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
  expect(
    (await verifyCrewApplication(db, { email, code: code() }, headers)).status,
  ).toBe("REJECTED");
});
it("preserves legacy pending answers and notifies nobody again", async () => {
  const application = await db.crewApplication.create({ data: draft });
  await stageCrewVerification(db, email, {
    ...draft,
    name: "Replacement",
    message: "Replacement",
  });
  const result = await verifyCrewApplication(
    db,
    { email, code: code() },
    headers,
  );
  expect(result.status).toBe("PENDING");
  expect(
    await db.crewApplication.findUniqueOrThrow({
      where: { id: application.id },
    }),
  ).toMatchObject(draft);
  expect(await db.notification.count()).toBe(0);
});
it("adds an approved receipt after explicit refresh and recovers the same displayed code", async () => {
  const state = await approved();
  expect(state.current.invitationState).toBe("AVAILABLE");
  expect(state.invitation.code).toMatch(/^[0-9A-Z]{5}$/);
  expect(state.invitation.code).not.toBe(state.decision.code);
  expect(
    await crewApplicationStatus(db, {
      email,
      statusProof: state.result.statusProof,
    }),
  ).toEqual(state.current);
  expect(await db.user.count()).toBe(3);
  const inspected = await inspectAccountInvitation(db, state.invitation);
  expect(inspected).toMatchObject({
    kind: "CREW",
    firstName: draft.firstName,
    lastName: draft.lastName,
    needsPassword: true,
  });
});
it("creates a new crew account only on reviewed invitation acceptance", async () => {
  const state = await approved();
  await redeemAccountInvitation(db, {
    ...state.invitation,
    firstName: draft.firstName,
    lastName: draft.lastName,
    password: "Crew-new-password!",
    reviewed: true,
  });
  expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({
    role: "CREW",
    crewStatus: "ACTIVE",
    tutorId: null,
  });
  expect(
    await crewApplicationStatus(db, {
      email,
      statusProof: state.result.statusProof,
    }),
  ).toMatchObject({ status: "ACCEPTED", invitationState: "USED" });
});
it.each(["STUDENT", "VIEWER", "ADMIN"] as const)(
  "adds crew to existing %s without replacing identity/password",
  async (role) => {
    const passwordHash = hashPassword("Original-password!");
    const owner = await db.user.create({
      data: {
        email,
        name: "Existing Identity",
        firstName: "Existing",
        lastName: "Identity",
        role,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const state = await approved();
    await redeemAccountInvitation(
      db,
      {
        ...state.invitation,
        firstName: "Untrusted",
        lastName: "Overwrite",
        reviewed: true,
      },
      owner.id,
    );
    const current = await db.user.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(current).toMatchObject({
      name: "Existing Identity",
      passwordHash,
      crewStatus: "ACTIVE",
      role: role === "VIEWER" ? "CREW" : role,
    });
    expect(verifyPassword("Original-password!", current.passwordHash!)).toBe(
      true,
    );
  },
);
it("requires live Head review; proposal replay persists the recipient-retrievable grant", async () => {
  const initial = await pending();
  const queued = await actor("ADMIN")
    .admin.decideCrewApplication({
      applicationId: initial.application.id,
      action: "ACCEPT",
    })
    .catch((error: unknown) => error as { cause: unknown });
  expect((queued as { cause: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  expect(await db.registrationCode.count()).toBe(0);
  const request = await db.approvalRequest.findFirstOrThrow();
  await actor().approval.decide({
    id: request.id,
    approve: true,
    note: "Approved crew applicant",
  });
  expect(await db.registrationCode.count()).toBe(1);
  expect(
    await crewApplicationStatus(db, {
      email,
      statusProof: initial.result.statusProof,
    }),
  ).toMatchObject({ status: "ACCEPTED", invitationState: "AVAILABLE" });
});
it("serializes competing approval decisions and creates exactly one code/audit", async () => {
  const initial = await pending();
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      decideCrewApplication(
        db,
        { applicationId: initial.application.id, action: "ACCEPT" },
        { id: "HEAD", name: "HEAD" },
      ),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await db.registrationCode.count()).toBe(1);
  expect(
    await db.auditLog.count({
      where: {
        entity: "CrewApplication",
        operation: "admin.decideCrewApplication",
      },
    }),
  ).toBe(1);
});
it("waits for an in-flight Head demotion and rejects before issuing a grant", async () => {
  const initial = await pending();
  let release!: () => void;
  let actorLocked!: () => void;
  let demotionPid = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    actorLocked = resolve;
  });
  const bounded = <T>(work: Promise<T>, message: string) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 2000);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  };
  // Explicitly consume transaction thenables before awaiting their internal gates.
  const demotion = Promise.resolve(
    db.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      demotionPid = backend!.pid;
      await tx.user.update({ where: { id: "HEAD" }, data: { role: "ADMIN" } });
      actorLocked();
      await gate;
    }),
  );
  let decision:
    Promise<Awaited<ReturnType<typeof decideCrewApplication>>> | undefined;
  try {
    await bounded(
      Promise.race([
        locked,
        demotion.then(() => {
          throw Error("Demotion finished before its release gate");
        }),
      ]),
      "Head demotion did not acquire its actor row",
    );
    decision = decideCrewApplication(
      db,
      { applicationId: initial.application.id, action: "ACCEPT" },
      { id: "HEAD", name: "HEAD" },
    );
    let finished = false;
    void decision.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    let waiting: { query: string }[] = [];
    let actorShareWait = false;
    // Observe the actual database blocker through the production domain entry.
    // Without FOR SHARE, MVCC reads the old Head and finishes while demotion is
    // held. The required query must wait on this exact demotion backend instead.
    for (let attempt = 0; attempt < 20 && !finished; attempt++) {
      waiting = await db.$queryRaw<
        { query: string }[]
      >`SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${demotionPid} = ANY(pg_blocking_pids(pid))`;
      actorShareWait = waiting.some(
        ({ query }) =>
          query.includes('FROM "User"') && query.includes("FOR SHARE"),
      );
      if (actorShareWait) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    expect(
      actorShareWait,
      `Actual blocked SQL: ${waiting.map(({ query }) => query).join("; ") || "none"}; decision finished: ${finished}`,
    ).toBe(true);
    release();
    await demotion;
    await decision?.catch(() => undefined);
    await expect(decision).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    release();
    await demotion;
    await decision?.catch(() => undefined);
  }
  expect(await db.registrationCode.count()).toBe(0);
  expect(
    await db.auditLog.count({
      where: {
        entity: "CrewApplication",
        operation: "admin.decideCrewApplication",
      },
    }),
  ).toBe(0);
  expect(
    await db.crewApplication.findUniqueOrThrow({
      where: { id: initial.application.id },
    }),
  ).toMatchObject({ status: "PENDING" });
});
it("serializes receipt retrieval versus revoke, returns to pending and invalidates old source", async () => {
  const state = await approved();
  const grant = await db.registrationCode.findFirstOrThrow();
  const results = await Promise.allSettled([
    crewApplicationStatus(db, { email, statusProof: state.result.statusProof }),
    actor().admin.revokeRegistrationCode({ id: grant.id }),
  ]);
  expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  expect(await db.registrationCode.count()).toBe(0);
  expect(
    await crewApplicationStatus(db, {
      email,
      statusProof: state.result.statusProof,
    }),
  ).toMatchObject({ status: "PENDING" });
  await expect(
    inspectAccountInvitation(db, state.invitation),
  ).rejects.toMatchObject({ message: "INVITATION_INVALID" });
});
it.each(["USED", "EXPIRED", "UNAVAILABLE"] as const)(
  "reports accepted %s invitations without promising a receipt",
  async (mode) => {
    const state = await approved();
    const grant = await db.registrationCode.findFirstOrThrow();
    if (mode === "UNAVAILABLE")
      await db.registrationCode.delete({ where: { id: grant.id } });
    else
      await db.registrationCode.update({
        where: { id: grant.id },
        data:
          mode === "USED" ? { usedAt: new Date() } : { expiresAt: new Date(0) },
      });
    const result = await crewApplicationStatus(db, {
      email,
      statusProof: state.result.statusProof,
    });
    expect(result).toMatchObject({ status: "ACCEPTED", invitationState: mode });
    expect(result.invitation).toBeUndefined();
  },
);
it("invalidates status proofs on resend/edit, but leaves an old invitation valid until replacement verification", async () => {
  const state = await approved();
  await stageCrewVerification(db, email, undefined, true);
  await expect(
    crewApplicationStatus(db, { email, statusProof: state.result.statusProof }),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
  expect(await inspectAccountInvitation(db, state.invitation)).toMatchObject({
    kind: "CREW",
  });
  const next = await verifyCrewApplication(
    db,
    { email, code: code() },
    headers,
  );
  expect(next.invitationState).toBe("AVAILABLE");
  await expect(
    inspectAccountInvitation(db, state.invitation),
  ).rejects.toMatchObject({ message: "INVITATION_INVALID" });
  await stageCrewVerification(db, email, { ...draft, message: "Edited draft" });
  await expect(
    crewApplicationStatus(db, { email, statusProof: next.statusProof }),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
});
it("commits wrong-code attempts, expires proof and rolls back failed replacement email", async () => {
  const initial = await pending();
  mail.send.mockRejectedValueOnce(new Error("Synthetic delivery failure"));
  await expect(
    stageCrewVerification(db, email, undefined, true),
  ).rejects.toThrow("Synthetic delivery failure");
  expect(
    await crewApplicationStatus(db, {
      email,
      statusProof: initial.result.statusProof,
    }),
  ).toMatchObject({ status: "PENDING" });
  for (let i = 0; i < 6; i++)
    await expect(
      verifyCrewApplication(db, { email, code: "ZZZZZ" }, headers),
    ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
  expect(
    (await db.crewSignupVerification.findUniqueOrThrow({ where: { email } }))
      .attempts,
  ).toBe(6);
  await expect(
    crewApplicationStatus(db, {
      email,
      statusProof: initial.result.statusProof,
    }),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
  await db.crewSignupVerification.update({
    where: { email },
    data: { attempts: 0, codeExpiresAt: new Date(0) },
  });
  await expect(
    crewApplicationStatus(db, {
      email,
      statusProof: initial.result.statusProof,
    }),
  ).rejects.toMatchObject({ message: "SIGNUP_CREW_INVALID" });
});
it("checks application/module at redemption while preserving manual crew invitations", async () => {
  const state = await approved();
  await db.crewApplication.update({
    where: { id: state.application.id },
    data: { status: "PENDING" },
  });
  await expect(
    inspectAccountInvitation(db, state.invitation),
  ).rejects.toMatchObject({ message: "INVITATION_INVALID" });
  await db.crewApplication.update({
    where: { id: state.application.id },
    data: { status: "ACCEPTED" },
  });
  await db.programFeature.create({ data: { key: "CREW", enabled: false } });
  await expect(
    inspectAccountInvitation(db, state.invitation),
  ).rejects.toMatchObject({ message: "CREW_DISABLED" });
  await expect(
    redeemAccountInvitation(db, {
      ...state.invitation,
      firstName: "Original",
      lastName: "Crew",
      password: "New-password!",
      reviewed: true,
    }),
  ).rejects.toMatchObject({ message: "CREW_DISABLED" });
  const manual = await issueRegistrationCode({
    kind: "CREW",
    email,
    issuedById: "HEAD",
  });
  expect(
    await enterDisplayedInvitation(db, { code: manual.code }),
  ).toMatchObject({ kind: "staff", boundEmail: email });
});
it("never issues the approved staff key equal to the recipient mailbox challenge", async () => {
  const initial = await pending();
  const challenge = code();
  vi.spyOn(codeHelpers, "generateRegistrationCode")
    .mockReturnValueOnce(challenge)
    .mockReturnValueOnce("Z0I7P");
  const decision = await decideCrewApplication(
    db,
    { applicationId: initial.application.id, action: "ACCEPT" },
    { id: "HEAD", name: "HEAD" },
  );
  expect(decision.code).toBe("Z0I7P");
  expect(hashCode(decision.code!)).not.toBe(
    (await db.crewSignupVerification.findUniqueOrThrow({ where: { email } }))
      .codeHash,
  );
});
