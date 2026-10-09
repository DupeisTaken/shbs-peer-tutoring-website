import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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
import { issueRegistrationCode, setEmailVerification } from "./registration";
import { startViewerSignup, verifyViewerCode } from "./viewer-signup";
import { hashPassword, verifyPassword } from "./password";
import {
  deliverAccountInvitation,
  verifyAccountInvitation,
  inspectAccountInvitation,
  redeemAccountInvitation,
  consumeInvitationLogin,
  issueViewerAccountInvitation,
  issueSurveyAccountInvitation,
  issueHistoryAccountInvitation,
  historyInvitationDigest,
} from "./account-invitations";
import {
  startHistoryAccount,
  verifyHistoryAccount,
} from "~/server/history-account-setup";
import { claimTuteeHistory } from "~/server/tutee-history";
import { submitSurvey, surveyInput } from "~/server/student-survey";
import { currentPolicy } from "~/server/policy-acceptance";
import { lockAccountProfile } from "~/server/account-profile";
import * as accountProfile from "~/server/account-profile";
import { createCaller } from "~/server/api/root";

const email = "recipient@example.test";
const password = "Existing-password-268!";
const profile = {
  firstName: "New",
  lastName: "Member",
  password: "New-password-268!",
  reviewed: true as const,
};
let callerId = 0;
const anonymous = () =>
  createCaller({
    db,
    session: null,
    headers: new Headers({ "x-real-ip": `invitation-${++callerId}` }),
  });
const code = () => {
  const value = mail.send.mock.calls.at(-1)?.[0].presentation?.code;
  if (!value) throw Error("Expected recipient-delivered code");
  return value;
};
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
  await db.user.create({
    data: {
      id: "head",
      email: "head@example.test",
      role: "HEAD",
      name: "Head",
      emailVerifiedAt: new Date(),
      passwordHash: hashPassword(password),
    },
  });
});
afterAll(() => db.$disconnect());

async function owner(extra = {}) {
  return db.user.create({
    data: {
      email,
      name: "Established Identity",
      firstName: "Established",
      lastName: "Identity",
      role: "STUDENT",
      passwordHash: hashPassword(password),
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });
}
async function staff(
  kind: "TUTOR" | "CREW" | "ADMIN" | "COORDINATOR" = "TUTOR",
  target = email,
) {
  const issued = await issueRegistrationCode({
    kind,
    email: target,
    issuedById: "head",
  });
  const initial = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const challenge = await setEmailVerification(initial, target);
  if (!challenge.ok) throw Error("Expected staff challenge");
  const row = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const invite = await deliverAccountInvitation(db, {
    kind,
    email: target,
    code: challenge.emailCode,
    sourceKey: `staff:${row.id}:${row.emailCodeHash}`,
    source: { type: "staff", id: row.id, challenge: row.emailCodeHash! },
  });
  const secret = code();
  const proof = await verifyAccountInvitation(db, {
    ...invite,
    email: target,
    code: secret,
  });
  return {
    invitationId: invite.invitationId,
    proof: proof.proof,
    secret,
    row,
    staffKey: issued.code,
  };
}
async function viewer(target = email) {
  const started = await startViewerSignup({
    email: target,
    name: "New Viewer",
    affiliation: "Family",
  });
  if (!started.ok) throw Error("Expected public request");
  const verified = await verifyViewerCode(target, started.code);
  if (!verified.ok) throw Error("Expected email verification");
  const invitation = await issueViewerAccountInvitation(
    db,
    target,
    verified.completionProof,
  );
  const secret = code();
  const proof = await verifyAccountInvitation(db, {
    ...invitation,
    email: target,
    code: secret,
  });
  return {
    ...invitation,
    proof: proof.proof,
    initialCode: started.code,
    secret,
  };
}

it.each(["TUTOR", "CREW"] as const)(
  "preserves established credentials and identity while reviewing %s participation",
  async (kind) => {
    const account = await owner();
    const invitation = await staff(kind);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toEqual(account);
    await expect(
      redeemAccountInvitation(db, { ...profile, ...invitation }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      await consumeInvitationLogin(invitation.invitationId, invitation.proof),
    ).toMatchObject({ id: account.id });
    expect(
      await consumeInvitationLogin(invitation.invitationId, invitation.proof),
    ).toBeNull();
    await redeemAccountInvitation(
      db,
      { ...profile, ...invitation },
      account.id,
    );
    const after = await db.user.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after.name).toBe(account.name);
    expect(after.passwordHash).toBe(account.passwordHash);
    expect(after.email).toBe(account.email);
    expect(
      kind === "TUTOR" ? Boolean(after.tutorId) : after.crewStatus === "ACTIVE",
    ).toBe(true);
  },
);

it("resolves verified secondary email without replacing the primary identity or password", async () => {
  const account = await owner();
  await db.accountEmail.create({
    data: {
      email: "alias@example.test",
      userId: account.id,
      verifiedAt: new Date(),
    },
  });
  const invite = await staff("CREW", "alias@example.test");
  expect(
    await consumeInvitationLogin(invite.invitationId, invite.proof),
  ).toMatchObject({ id: account.id, email });
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  expect(await db.user.count({ where: { email: "alias@example.test" } })).toBe(
    0,
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
      .passwordHash,
  ).toBe(account.passwordHash);
});

it.each(["TUTOR", "CREW"] as const)(
  "%s invitation preserves canonical academics and ignores posted profile changes",
  async (kind) => {
    const account = await owner({ gradeLevel: 11 });
    await db.academicProfile.create({
      data: {
        userId: account.id,
        gradeLevel: 11,
        schoolYear: "25-26",
        status: "REPORTED",
        confirmedAt: new Date("2025-09-01"),
        reconfirmRequired: false,
      },
    });
    const before = await db.academicProfile.findUniqueOrThrow({
      where: { userId: account.id },
    });
    const invite = await staff(kind);
    await redeemAccountInvitation(
      db,
      {
        ...profile,
        ...invite,
        gradeLevel: 1,
        firstName: "Injected",
        lastName: "Identity",
      },
      account.id,
    );
    expect(
      await db.academicProfile.findUniqueOrThrow({
        where: { userId: account.id },
      }),
    ).toEqual(before);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      name: account.name,
      gradeLevel: 11,
      passwordHash: account.passwordHash,
    });
  },
);

it("uses a distinct Viewer invitation and creates credentials only after its explicit review", async () => {
  const invite = await viewer();
  expect(invite.secret).not.toBe(invite.initialCode);
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  await redeemAccountInvitation(db, { ...profile, ...invite });
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  expect(account).toMatchObject({
    role: "VIEWER",
    tutorId: null,
    studentId: null,
    crewStatus: null,
    tuteeMember: false,
  });
  expect(verifyPassword(profile.password, account.passwordHash!)).toBe(true);
  expect(
    await consumeInvitationLogin(invite.invitationId, invite.proof),
  ).toMatchObject({ id: account.id });
});

it("starts a fresh fixed review window after near-expiry Viewer verification", async () => {
  const started = await startViewerSignup({
    email,
    name: "Late Viewer",
    affiliation: "Family",
  });
  if (!started.ok) throw Error("Expected signup");
  const oldExpiry = new Date(Date.now() + 1000);
  await db.viewerSignup.update({
    where: { email },
    data: { codeExpiresAt: oldExpiry },
  });
  const verified = await verifyViewerCode(email, started.code);
  if (!verified.ok) throw Error("Expected verification");
  const source = await db.viewerSignup.findUniqueOrThrow({ where: { email } });
  expect(+source.codeExpiresAt - +source.verifiedAt!).toBe(15 * 60_000);
  const again = await verifyViewerCode(email, started.code);
  expect(again).toEqual(verified);
  expect(
    (await db.viewerSignup.findUniqueOrThrow({ where: { email } }))
      .codeExpiresAt,
  ).toEqual(source.codeExpiresAt);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(+oldExpiry + 1000);
  try {
    const invite = await issueViewerAccountInvitation(
      db,
      email,
      verified.completionProof,
    );
    const row = await db.accountInvitation.findUniqueOrThrow({
      where: { id: invite.invitationId },
    });
    expect(row.expiresAt).toEqual(source.codeExpiresAt);
    expect(mail.send.mock.lastCall![0].text).toContain(
      source.codeExpiresAt.toISOString(),
    );
    const proof = await verifyAccountInvitation(db, {
      ...invite,
      email,
      code: code(),
    });
    await redeemAccountInvitation(db, { ...profile, ...invite, ...proof });
  } finally {
    vi.useRealTimers();
  }
});

it("caps recipient proof at staff authorization expiry without extending its seven-day grant", async () => {
  const issued = await issueRegistrationCode({
    kind: "CREW",
    email,
    issuedById: "head",
  });
  const expiresAt = new Date(Date.now() + 60_000);
  const source = await db.registrationCode.update({
    where: { id: issued.id },
    data: { expiresAt },
  });
  const challenge = await setEmailVerification(source, email);
  if (!challenge.ok) throw Error("Expected challenge");
  const current = await db.registrationCode.findUniqueOrThrow({
    where: { id: issued.id },
  });
  const invite = await deliverAccountInvitation(db, {
    kind: "CREW",
    email,
    code: challenge.emailCode,
    sourceKey: `staff:${current.id}:${current.emailCodeHash}`,
    source: {
      type: "staff",
      id: current.id,
      challenge: current.emailCodeHash!,
    },
  });
  expect(
    (
      await db.accountInvitation.findUniqueOrThrow({
        where: { id: invite.invitationId },
      })
    ).expiresAt,
  ).toEqual(expiresAt);
  expect(
    (await db.registrationCode.findUniqueOrThrow({ where: { id: issued.id } }))
      .expiresAt,
  ).toEqual(expiresAt);
});

it.each(["HEAD", "STUDENT", "VIEWER"] as const)(
  "existing %s requests a public code without being converted to Viewer",
  async (role) => {
    const account =
      role === "HEAD"
        ? await db.user.findUniqueOrThrow({ where: { id: "head" } })
        : await owner({ role });
    const invite = await viewer(account.email);
    const review = await inspectAccountInvitation(db, {
      ...invite,
      userId: account.id,
    });
    expect(review.kind).toBe("LOGIN");
    await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toEqual(account);
  },
);

it("does not substitute one mailbox factor for enforced password plus email verification", async () => {
  const account = await owner({ twoFactorEnabled: true });
  const invite = await staff("CREW");
  expect(
    await consumeInvitationLogin(invite.invitationId, invite.proof),
  ).toBeNull();
  expect(await inspectAccountInvitation(db, invite)).toMatchObject({
    mfaRequired: true,
    requiresSignIn: true,
  });
  await expect(
    redeemAccountInvitation(db, { ...profile, ...invite }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
      .twoFactorEnabled,
  ).toBe(true);
});

it("finishes missing credentials but does not overwrite an established forced-change password", async () => {
  const account = await owner({
    passwordHash: null,
    mustChangePassword: true,
    emailVerifiedAt: null,
  });
  const invite = await staff("CREW");
  await redeemAccountInvitation(db, { ...profile, ...invite });
  const after = await db.user.findUniqueOrThrow({ where: { id: account.id } });
  expect(after.mustChangePassword).toBe(false);
  expect(verifyPassword(profile.password, after.passwordHash!)).toBe(true);
  await db.user.update({
    where: { id: account.id },
    data: { mustChangePassword: true },
  });
  const next = await viewer();
  await redeemAccountInvitation(db, { ...profile, ...next }, account.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    passwordHash: after.passwordHash,
    mustChangePassword: true,
  });
});

it.each(["ADMIN", "COORDINATOR"] as const)(
  "management %s invitation cannot elevate an existing account",
  async (kind) => {
    const account = await owner();
    const invite = await staff(kind);
    await expect(
      redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toEqual(account);
    expect(
      (
        await db.registrationCode.findUniqueOrThrow({
          where: { id: invite.row.id },
        })
      ).usedAt,
    ).toBeNull();
  },
);

it.each(["suspended", "departure", "crewInactive", "viewer"] as const)(
  "cannot restore restricted participation: %s",
  async (state) => {
    const account = await owner(
      state === "suspended"
        ? { suspendedAt: new Date() }
        : state === "crewInactive"
          ? { crewStatus: "INACTIVE" }
          : state === "viewer"
            ? { role: "VIEWER" }
            : {},
    );
    if (state === "departure")
      await db.schoolDeparture.create({
        data: {
          userId: account.id,
          reason: "GRADUATED",
          revision: 1,
          source: "HEAD",
        },
      });
    const invite = await staff("CREW");
    await expect(
      redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
    ).rejects.toBeTruthy();
    expect(
      (
        await db.accountInvitation.findUniqueOrThrow({
          where: { id: invite.invitationId },
        })
      ).completedAt,
    ).toBeNull();
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toEqual(account);
  },
);

it("rejects forged proofs, wrong recipients, expiry and exhausted guesses without consuming authorization", async () => {
  const invite = await staff();
  await expect(
    inspectAccountInvitation(db, {
      invitationId: invite.invitationId,
      proof: "0".repeat(64),
    }),
  ).rejects.toBeTruthy();
  for (let i = 0; i < 6; i++)
    await expect(
      verifyAccountInvitation(db, {
        invitationId: invite.invitationId,
        email: "other@example.test",
        code: invite.secret,
      }),
    ).rejects.toBeTruthy();
  await expect(
    redeemAccountInvitation(db, { ...profile, ...invite }),
  ).rejects.toBeTruthy();
  expect(
    (
      await db.registrationCode.findUniqueOrThrow({
        where: { id: invite.row.id },
      })
    ).usedAt,
  ).toBeNull();
  const another = await staff();
  await db.accountInvitation.update({
    where: { id: another.invitationId },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    redeemAccountInvitation(db, { ...profile, ...another }),
  ).rejects.toBeTruthy();
});

it.each(["cancel", "resend"] as const)(
  "revokes old source proof after %s",
  async (change) => {
    const account = await owner();
    const invite = await staff();
    if (change === "cancel")
      await db.registrationCode.delete({ where: { id: invite.row.id } });
    else await setEmailVerification(invite.row, email);
    await expect(inspectAccountInvitation(db, invite)).rejects.toBeTruthy();
    await expect(
      consumeInvitationLogin(invite.invitationId, invite.proof),
    ).rejects.toBeTruthy();
    await expect(
      redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
    ).rejects.toBeTruthy();
  },
);

it("preserves the old emailed invitation when replacement delivery fails", async () => {
  const invite = await staff();
  mail.send.mockRejectedValueOnce(Error("SMTP offline"));
  await expect(
    anonymous().registration.sendEmailCode({ code: invite.staffKey, email }),
  ).rejects.toBeTruthy();
  expect(await inspectAccountInvitation(db, invite)).toMatchObject({
    kind: "TUTOR",
  });
});

it("concurrent redemption and lost-response retry create one identity and never reset its password", async () => {
  const invite = await viewer();
  const results = await Promise.all([
    redeemAccountInvitation(db, { ...profile, ...invite }),
    redeemAccountInvitation(db, { ...profile, ...invite }),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  await redeemAccountInvitation(db, {
    ...profile,
    ...invite,
    password: "DifferentPassword123!",
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
      .passwordHash,
  ).toBe(account.passwordHash);
  expect(
    await db.auditLog.count({
      where: { operation: "accountInvitation.redeem" },
    }),
  ).toBe(1);
});

it("revokes preview and login after alias transfer or credential generation change", async () => {
  const account = await owner();
  const invite = await staff();
  await db.user.update({
    where: { id: account.id },
    data: { passwordHash: hashPassword("RotatedPassword123!") },
  });
  await expect(inspectAccountInvitation(db, invite)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    consumeInvitationLogin(invite.invitationId, invite.proof),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const alias = "secondary@example.test";
  await db.accountEmail.create({
    data: { email: alias, userId: account.id, verifiedAt: new Date() },
  });
  const next = await staff("CREW", alias);
  await db.accountEmail.delete({ where: { email: alias } });
  const other = await db.user.create({
    data: {
      email: alias,
      name: "Other Owner",
      passwordHash: hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  });
  await expect(inspectAccountInvitation(db, next)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    redeemAccountInvitation(db, { ...profile, ...next }, other.id),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rechecks credentials after waiting on the account lock", async () => {
  const account = await owner();
  const invite = await staff();
  let release!: () => void;
  let locked!: () => void;
  const signal = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rotation = db.$transaction(async (tx) => {
    await lockAccountProfile(tx, account.id);
    locked();
    await gate;
    await tx.user.update({
      where: { id: account.id },
      data: { passwordHash: hashPassword("ConcurrentNewPassword!") },
    });
  });
  await signal;
  let waiting!: () => void;
  const attempted = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const originalLock = accountProfile.lockAccountProfile;
  const lockSpy = vi
    .spyOn(accountProfile, "lockAccountProfile")
    .mockImplementation(async (tx, id) => {
      waiting();
      return originalLock(tx, id);
    });
  const signing = consumeInvitationLogin(invite.invitationId, invite.proof);
  try {
    // The sign-in has read the old candidate and reached its lock while rotation owns it.
    await attempted;
    release();
    await rotation;
    await expect(signing).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    release();
    lockSpy.mockRestore();
  }
});

it("tutee email confirmation issues an invitation before credentials or request consumption", async () => {
  await db.term.create({
    data: {
      id: "term",
      name: "Intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.create({ data: { id: "math", name: "Mathematics" } });
  await db.timeSlot.create({
    data: {
      id: "slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Respect your tutor.",
    },
  });
  const policy = await currentPolicy(db, "tutee-policy");
  await submitSurvey(
    db,
    surveyInput.parse({
      englishName: "New Member",
      email,
      preferredContact: email,
      firstChoiceId: "math",
      slotIds: ["slot"],
      signatureName: "New Member",
      agreed: true,
      policyRevision: policy.revision,
    }),
  );
  const token = /token=([a-f0-9]{64})/.exec(
    mail.send.mock.calls.at(-1)![0].text,
  )![1]!;
  const before = await db.studentSurvey.findFirstOrThrow();
  const invite = await issueSurveyAccountInvitation(db, token);
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect((await db.studentSurvey.findFirstOrThrow()).confirmedAt).toBeNull();
  const proof = await verifyAccountInvitation(db, {
    ...invite,
    email,
    code: code(),
  });
  await redeemAccountInvitation(db, { ...profile, ...invite, ...proof });
  expect((await db.studentSurvey.findFirstOrThrow()).submittedAt).toEqual(
    before.submittedAt,
  );
  expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({
    tuteeMember: true,
    role: "STUDENT",
  });
  expect(await db.policyAcceptance.count()).toBe(1);
});

it("history-only credentials preserve the archived record until a separate explicit claim", async () => {
  const token = "a".repeat(64);
  const archive = await db.tutee.create({
    data: {
      englishName: "Archived Person",
      status: "INACTIVE",
      gradeLevel: "9",
    },
  });
  await db.tuteeHistoryInvitation.create({
    data: {
      tuteeId: archive.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      email,
      expectedUpdatedAt: archive.updatedAt,
      issuedById: "head",
      reason: "Reviewed historical evidence",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await startHistoryAccount(db, { token, email });
  const oldDeadline = new Date(Date.now() + 1000);
  await db.tuteeHistoryInvitation.update({
    where: { tuteeId: archive.id },
    data: { setupCodeExpiresAt: oldDeadline },
  });
  const verified = await verifyHistoryAccount(db, {
    token,
    email,
    code: code(),
  });
  const source = await db.tuteeHistoryInvitation.findUniqueOrThrow({
    where: { tuteeId: archive.id },
  });
  expect(+source.setupCodeExpiresAt! - +source.setupVerifiedAt!).toBe(
    15 * 60_000,
  );
  expect(+source.setupCodeExpiresAt!).toBeGreaterThan(+oldDeadline);
  const invite = await issueHistoryAccountInvitation(db, {
    token,
    email,
    ...verified,
  });
  const proof = await verifyAccountInvitation(db, {
    ...invite,
    email,
    code: code(),
  });
  await redeemAccountInvitation(db, { ...profile, ...invite, ...proof });
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  expect(account).toMatchObject({
    tuteeMember: false,
    studentId: null,
    tutorId: null,
    role: "STUDENT",
    name: archive.englishName,
  });
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: archive.id } }),
  ).toEqual(archive);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  const digest = await historyInvitationDigest(
    db,
    invite.invitationId,
    account.id,
  );
  await claimTuteeHistory(db, account.id, digest, true);
  expect(
    await db.studentProfileOwnership.findUnique({
      where: { tuteeId: archive.id },
    }),
  ).toMatchObject({ userId: account.id });
  expect(await db.policyAcceptance.count()).toBe(0);
});
