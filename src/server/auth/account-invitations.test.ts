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
import {
  issueRegistrationCode,
  setEmailVerification,
  hashCode,
  registrationCompletionProof,
} from "./registration";
import * as codeHelpers from "./code";
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
  enterDisplayedInvitation,
  emailDisplayedInvitation,
  sendInvitationVerification,
  type InvitationSource,
} from "./account-invitations";
import {
  startHistoryAccount,
  verifyHistoryAccount,
} from "~/server/history-account-setup";
import { claimTuteeHistory } from "~/server/tutee-history";
import {
  submitSurvey,
  surveyInput,
  verifySurveyEmail,
  surveyEmailCode,
  resendSurvey,
} from "~/server/student-survey";
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

async function displayedViewer() {
  const started = await startViewerSignup({
    email,
    name: "New Viewer",
    affiliation: "Family",
  });
  if (!started.ok) throw Error("Expected request");
  const verified = await verifyViewerCode(email, started.code);
  if (!verified.ok) throw Error("Expected verified email");
  return issueViewerAccountInvitation(
    db,
    email,
    verified.completionProof,
    true,
  );
}

it("fills genuinely missing identity when an existing account accepts management access", async () => {
  const account = await owner({ name: "", firstName: null, lastName: null });
  const invite = await staff("ADMIN");
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    role: "ADMIN",
    name: "New Member",
    firstName: "New",
    lastName: "Member",
    passwordHash: account.passwordHash,
  });
});

it("recovers a completed displayed invitation after refresh without replaying access or expired login proof", async () => {
  const invite = await displayedViewer();
  await redeemAccountInvitation(db, {
    ...profile,
    invitationId: invite.invitationId,
    proof: invite.proof!,
  });
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  expect(
    await enterDisplayedInvitation(db, {
      code: invite.code!,
      userId: account.id,
    }),
  ).toMatchObject({ invitationId: invite.invitationId });
  await db.accountInvitation.update({
    where: { id: invite.invitationId },
    data: { expiresAt: new Date(0) },
  });
  expect(
    await enterDisplayedInvitation(db, {
      code: invite.code!,
      userId: account.id,
    }),
  ).toMatchObject({ proof: invite.proof });
  await expect(
    enterDisplayedInvitation(db, { code: invite.code!, proof: invite.proof }),
  ).rejects.toThrow();
  expect(await db.user.count({ where: { email } })).toBe(1);
});

it("rank-only management invitations do not require returning to school participation", async () => {
  const account = await owner();
  await db.schoolDeparture.create({
    data: {
      userId: account.id,
      reason: "GRADUATED",
      revision: 1,
      source: "HEAD",
    },
  });
  const invite = await staff("ADMIN");
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    role: "ADMIN",
    tutorId: null,
    passwordHash: account.passwordHash,
  });
  expect(
    (
      await db.schoolDeparture.findUniqueOrThrow({
        where: { userId: account.id },
      })
    ).reason,
  ).toBe("GRADUATED");
});

it("a redundant generic tutor invitation preserves an opted-out existing tutor", async () => {
  const account = await owner();
  const first = await staff("TUTOR");
  await redeemAccountInvitation(db, { ...profile, ...first }, account.id);
  const linked = await db.user.findUniqueOrThrow({ where: { id: account.id } });
  await db.tutor.update({
    where: { id: linked.tutorId! },
    data: { status: "OPTED_OUT" },
  });
  const before = await db.tutor.findUniqueOrThrow({
    where: { id: linked.tutorId! },
  });
  const second = await staff("TUTOR");
  await redeemAccountInvitation(db, { ...profile, ...second }, account.id);
  expect(
    await db.tutor.findUniqueOrThrow({ where: { id: before.id } }),
  ).toEqual(before);
  expect(await db.tutor.count()).toBe(1);
});

it("displays an invitation without mail, preserves its receipt, and requires separate identity proof", async () => {
  const invite = await displayedViewer();
  expect(invite.code).toMatch(/^[023456789ABCDEFGHIJKMNPQRSTUVWXYZ]{5}$/);
  expect(invite.code).toMatch(/[A-Z]/);
  expect(invite.code).toMatch(/[02-9]/);
  expect(mail.send).not.toHaveBeenCalled();
  expect(await enterDisplayedInvitation(db, { code: invite.code! })).toEqual({
    kind: "display",
    invitationId: invite.invitationId,
  });
  expect(
    await enterDisplayedInvitation(db, {
      code: invite.code!,
      proof: invite.proof,
    }),
  ).toMatchObject({ proof: invite.proof, email });
  await expect(
    verifyAccountInvitation(db, {
      invitationId: invite.invitationId,
      email,
      code: invite.code!,
    }),
  ).rejects.toThrow("INVITATION_INVALID");
  await sendInvitationVerification(db, {
    invitationId: invite.invitationId,
    email,
    code: invite.code!,
  });
  const otp = code();
  expect(otp).not.toBe(invite.code);
  expect(
    await verifyAccountInvitation(db, {
      invitationId: invite.invitationId,
      email,
      code: otp,
    }),
  ).toEqual({ proof: invite.proof });
  const before = await db.accountInvitation.findUniqueOrThrow({
    where: { id: invite.invitationId },
  });
  mail.send.mockRejectedValueOnce(Error("offline"));
  await expect(
    emailDisplayedInvitation(db, {
      invitationId: invite.invitationId,
      proof: invite.proof!,
    }),
  ).rejects.toThrow("offline");
  expect(
    await db.accountInvitation.findUniqueOrThrow({
      where: { id: invite.invitationId },
    }),
  ).toEqual(before);
  await emailDisplayedInvitation(db, {
    invitationId: invite.invitationId,
    proof: invite.proof!,
  });
  expect(code()).toBe(invite.code);
  expect(mail.send.mock.calls.at(-1)?.[0].text).toContain(
    `&code=${invite.code}`,
  );
});

it.each(["staff", "display"] as const)(
  "retries and retains a five-character candidate reserved by %s",
  async (kind) => {
    const first = await displayedViewer();
    const original = await db.accountInvitation.findUniqueOrThrow({
      where: { id: first.invitationId },
    });
    await db.accountInvitation.delete({ where: { id: original.id } });
    if (kind === "staff") {
      await db.registrationCode.create({
        data: { code: first.code!, expiresAt: new Date(0) },
      });
    } else {
      await db.accountInvitation.create({
        data: {
          kind: original.kind,
          email: original.email,
          source: original.source as InvitationSource,
          codeHash: original.codeHash,
          displayedCode: true,
          displayCodeNonce: original.displayCodeNonce,
          sourceKey: "reserved-display",
          completedAt: new Date(),
          expiresAt: new Date(0),
        },
      });
    }
    const input = {
      display: true,
      kind: original.kind,
      email: original.email,
      sourceKey: original.sourceKey,
      source: original.source as InvitationSource,
    };
    const next = await deliverAccountInvitation(db, input);
    expect(next.code).not.toBe(first.code);
    expect(
      (
        await db.accountInvitation.findUniqueOrThrow({
          where: { id: next.invitationId },
        })
      ).displayCodeNonce,
    ).toBeGreaterThan(original.displayCodeNonce!);
    expect(await deliverAccountInvitation(db, input)).toEqual(next);
    await emailDisplayedInvitation(db, {
      invitationId: next.invitationId,
      proof: next.proof!,
    });
    expect(code()).toBe(next.code);
  },
);

it("staff issuance skips displayed codes and a corrupted ambiguous namespace fails closed", async () => {
  const invite = await displayedViewer();
  const fallback = invite.code === "Q7M2R" ? "Z8P4T" : "Q7M2R";
  const generator = vi
    .spyOn(codeHelpers, "generateRegistrationCode")
    .mockReturnValueOnce(invite.code!)
    .mockReturnValueOnce(fallback);
  try {
    const staffCode = await issueRegistrationCode({ kind: "TUTOR" });
    expect(staffCode.code).toBe(fallback);
    expect(
      await enterDisplayedInvitation(db, {
        code: ` ${fallback.toLowerCase()} `,
      }),
    ).toMatchObject({ kind: "staff", boundEmail: null });
  } finally {
    generator.mockRestore();
  }
  await db.registrationCode.create({
    data: { code: invite.code!, expiresAt: new Date(Date.now() + 60_000) },
  });
  await expect(
    enterDisplayedInvitation(db, { code: invite.code!, proof: invite.proof }),
  ).rejects.toThrow("INVITATION_INVALID");
});

// Reconstruct persisted receipts using their original alphabet, independent of
// production recovery. Positive nonces ensure retries cannot masquerade as versions.
function fixtureDisplayCode(
  sourceKey: string,
  nonce: number,
  alphabet: string,
) {
  const digest = registrationCompletionProof(
    "invitation",
    `display:${sourceKey}:${nonce}`,
    "display",
    new Date(0),
  );
  let entropy = BigInt(`0x${digest}`);
  let result = "";
  for (let index = 0; index < 5; index++) {
    result += alphabet[Number(entropy % BigInt(alphabet.length))];
    entropy /= BigInt(alphabet.length);
  }
  return result;
}

it("retains pre-zero five-character receipts through retry, email, verification and redemption", async () => {
  const invite = await displayedViewer();
  const row = await db.accountInvitation.findUniqueOrThrow({
    where: { id: invite.invitationId },
  });
  let nonce = 1;
  let legacy = "";
  for (; nonce < 1000; nonce++) {
    legacy = fixtureDisplayCode(
      row.sourceKey,
      nonce,
      "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
    );
    const current = fixtureDisplayCode(
      row.sourceKey,
      nonce,
      codeHelpers.REG_CODE_ALPHABET,
    );
    if (/[A-Z]/.test(legacy) && /[2-9]/.test(legacy) && legacy !== current)
      break;
  }
  expect(nonce).toBeLessThan(1000);
  await db.accountInvitation.update({
    where: { id: row.id },
    data: { displayCodeNonce: nonce, codeHash: hashCode(legacy) },
  });
  const restored = await deliverAccountInvitation(db, {
    display: true,
    kind: row.kind,
    email: row.email,
    sourceKey: row.sourceKey,
    source: row.source as InvitationSource,
  });
  expect(restored.code).toBe(legacy);
  expect(
    await enterDisplayedInvitation(db, {
      code: legacy.toLowerCase(),
      proof: restored.proof,
    }),
  ).toMatchObject({ proof: restored.proof });
  await emailDisplayedInvitation(db, {
    invitationId: row.id,
    proof: restored.proof!,
  });
  expect(code()).toBe(legacy);
  await sendInvitationVerification(db, {
    invitationId: row.id,
    email,
    code: legacy,
  });
  const verified = await verifyAccountInvitation(db, {
    invitationId: row.id,
    email,
    code: code(),
  });
  expect(verified.proof).toBe(restored.proof);
  await redeemAccountInvitation(db, {
    ...profile,
    invitationId: row.id,
    proof: verified.proof,
  });
  expect(
    (await db.accountInvitation.findUniqueOrThrow({ where: { id: row.id } }))
      .completedAt,
  ).not.toBeNull();
});

it("issues a zero-only-digit receipt with I and preserves it across alias entry, retries and optional mail", async () => {
  const invite = await displayedViewer();
  const row = await db.accountInvitation.findUniqueOrThrow({
    where: { id: invite.invitationId },
  });
  await db.accountInvitation.delete({ where: { id: row.id } });
  let sourceKey = "",
    candidate = "";
  for (let index = 0; index < 1000; index++) {
    sourceKey = `zero-fixture:${index}`;
    candidate = fixtureDisplayCode(sourceKey, 0, codeHelpers.REG_CODE_ALPHABET);
    if (
      candidate !== "ABI0D" &&
      candidate.includes("0") &&
      candidate.includes("I") &&
      !/[1-9]/.test(candidate)
    )
      break;
  }
  expect(candidate).toMatch(/0/);
  expect(candidate).toMatch(/I/);
  expect(candidate).not.toMatch(/[1-9]/);
  const input = {
    display: true,
    kind: row.kind,
    email: row.email,
    sourceKey,
    source: row.source as InvitationSource,
  };
  const issued = await deliverAccountInvitation(db, input);
  expect(issued.code).toBe(candidate);
  expect(await deliverAccountInvitation(db, input)).toEqual(issued);
  for (const alias of [
    candidate,
    candidate.replaceAll("0", "O"),
    candidate.toLowerCase().replaceAll("0", "o"),
    candidate.replaceAll("I", "1"),
    candidate.toLowerCase().replaceAll("0", "o").replaceAll("i", "1"),
  ]) {
    expect(
      await anonymous().accountInvitation.enter({
        code: ` ${alias} `,
        proof: issued.proof,
      }),
    ).toMatchObject({ proof: issued.proof });
  }
  await emailDisplayedInvitation(db, {
    invitationId: issued.invitationId,
    proof: issued.proof!,
  });
  expect(code()).toBe(candidate);
  expect(await deliverAccountInvitation(db, input)).toEqual(issued);
  const generator = vi
    .spyOn(codeHelpers, "generateRegistrationCode")
    .mockReturnValue("ABI0D");
  try {
    await sendInvitationVerification(db, {
      invitationId: issued.invitationId,
      email,
      code: candidate.replaceAll("0", "O").replaceAll("I", "1"),
    });
    expect(code()).toBe("ABI0D");
    expect(
      await anonymous().accountInvitation.verify({
        invitationId: issued.invitationId,
        email,
        code: " aB-1 oD ",
      }),
    ).toEqual({ proof: issued.proof });
  } finally {
    generator.mockRestore();
  }
});

it("looks up staff codes by their canonical zero and I for every alias", async () => {
  const generator = vi
    .spyOn(codeHelpers, "generateRegistrationCode")
    .mockReturnValue("ABI0D");
  try {
    const issued = await issueRegistrationCode({ kind: "TUTOR" });
    expect(issued.code).toBe("ABI0D");
    for (const alias of ["ABI0D", "ABIOD", "abiod", " aB-1 oD "]) {
      expect(
        await anonymous().accountInvitation.enter({ code: alias }),
      ).toMatchObject({ kind: "staff" });
      expect(
        await anonymous().registration.check({ code: alias }),
      ).toBeTruthy();
    }
  } finally {
    generator.mockRestore();
  }
});

it.each([null, 7])(
  "fails closed when a persisted receipt hash matches no derivation (nonce=%s)",
  async (nonce) => {
    const invite = await displayedViewer();
    const row = await db.accountInvitation.update({
      where: { id: invite.invitationId },
      data: { displayCodeNonce: nonce, codeHash: "corrupted" },
    });
    const proof = registrationCompletionProof(
      "invitation",
      `account:${row.id}`,
      row.codeHash,
      row.verifiedAt!,
    );
    await expect(
      deliverAccountInvitation(db, {
        display: true,
        kind: row.kind,
        email: row.email,
        sourceKey: row.sourceKey,
        source: row.source as InvitationSource,
      }),
    ).rejects.toThrow("INVITATION_INVALID");
    await expect(
      emailDisplayedInvitation(db, { invitationId: row.id, proof }),
    ).rejects.toThrow("INVITATION_INVALID");
    expect(mail.send).not.toHaveBeenCalled();
  },
);

it("keeps previously issued twelve-character links recoverable", async () => {
  const invite = await displayedViewer();
  const row = await db.accountInvitation.findUniqueOrThrow({
    where: { id: invite.invitationId },
  });
  let sourceKey = "",
    legacy = "";
  for (let index = 0; index < 1000; index++) {
    sourceKey = `legacy-hex-fixture:${index}`;
    legacy = registrationCompletionProof(
      "invitation",
      `display:${sourceKey}`,
      "display",
      new Date(0),
    )
      .slice(0, 12)
      .toUpperCase();
    if (legacy.includes("0") && legacy.includes("1")) break;
  }
  expect(legacy).toContain("0");
  expect(legacy).toContain("1");
  await db.accountInvitation.update({
    where: { id: row.id },
    data: { sourceKey, displayCodeNonce: null, codeHash: hashCode(legacy) },
  });
  const restored = await deliverAccountInvitation(db, {
    display: true,
    kind: row.kind,
    email: row.email,
    sourceKey,
    source: row.source as InvitationSource,
  });
  expect(restored.code).toBe(legacy);
  expect(
    await enterDisplayedInvitation(db, {
      code: legacy.toLowerCase().replaceAll("0", "o"),
      proof: restored.proof,
    }),
  ).toMatchObject({ kind: "display", proof: restored.proof });
  await emailDisplayedInvitation(db, {
    invitationId: restored.invitationId,
    proof: restored.proof!,
  });
  expect(code()).toBe(legacy);
});

it("serializes a staff issue racing a displayed receipt for the same candidate", async () => {
  const first = await displayedViewer();
  const row = await db.accountInvitation.findUniqueOrThrow({
    where: { id: first.invitationId },
  });
  await db.accountInvitation.delete({ where: { id: row.id } });
  const fallback = first.code === "Q7M2R" ? "Z8P4T" : "Q7M2R";
  const generator = vi
    .spyOn(codeHelpers, "generateRegistrationCode")
    .mockReturnValueOnce(first.code!)
    .mockReturnValue(fallback);
  try {
    const [staffCode, displayed] = await Promise.all([
      issueRegistrationCode({ kind: "TUTOR" }),
      deliverAccountInvitation(db, {
        display: true,
        kind: row.kind,
        email: row.email,
        sourceKey: row.sourceKey,
        source: row.source as InvitationSource,
      }),
    ]);
    expect(staffCode.code).not.toBe(displayed.code);
    expect(
      await enterDisplayedInvitation(db, { code: staffCode.code }),
    ).toMatchObject({ kind: "staff" });
    expect(
      await enterDisplayedInvitation(db, { code: displayed.code! }),
    ).toMatchObject({ kind: "display", invitationId: displayed.invitationId });
  } finally {
    generator.mockRestore();
  }
});

it("re-derives the displayed candidate when it matches the verified source challenge", async () => {
  const first = await displayedViewer();
  const row = await db.accountInvitation.findUniqueOrThrow({
    where: { id: first.invitationId },
  });
  const source = row.source as InvitationSource;
  if (source.type !== "viewer") throw Error("Expected viewer fixture");
  await db.accountInvitation.delete({ where: { id: row.id } });
  source.challenge = hashCode(first.code!);
  await db.viewerSignup.update({
    where: { id: source.id },
    data: { codeHash: source.challenge },
  });
  const next = await deliverAccountInvitation(db, {
    display: true,
    kind: row.kind,
    email: row.email,
    sourceKey: row.sourceKey,
    source,
  });
  expect(next.code).not.toBe(first.code);
  expect(
    (
      await db.accountInvitation.findUniqueOrThrow({
        where: { id: next.invitationId },
      })
    ).codeHash,
  ).toBe(hashCode(next.code!));
  await emailDisplayedInvitation(db, {
    invitationId: next.invitationId,
    proof: next.proof!,
  });
  expect(code()).toBe(next.code);
});

it("resending manual verification invalidates the old OTP without replacing the invitation", async () => {
  const invite = await displayedViewer();
  const input = {
    invitationId: invite.invitationId,
    email,
    code: invite.code!,
  };
  await sendInvitationVerification(db, input);
  const first = code();
  await sendInvitationVerification(db, input);
  const second = code();
  await expect(
    verifyAccountInvitation(db, { ...input, code: first }),
  ).rejects.toThrow();
  expect(await verifyAccountInvitation(db, { ...input, code: second })).toEqual(
    { proof: invite.proof },
  );
  await expect(
    sendInvitationVerification(db, { ...input, email: "other@example.test" }),
  ).rejects.toThrow();
});

it.each(["TUTOR", "CREW", "ADMIN", "COORDINATOR"] as const)(
  "upgrades a verified Viewer through a %s invitation atomically",
  async (kind) => {
    const account = await owner({ role: "VIEWER" });
    const invitation = await staff(kind);
    await redeemAccountInvitation(
      db,
      { ...profile, ...invitation },
      account.id,
    );
    const after = await db.user.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after).toMatchObject({
      role: kind,
      passwordHash: account.passwordHash,
      name: account.name,
    });
    expect(after.id).toBe(account.id);
  },
);

it("an already granted tutor capability is reused and lower management invitations never demote", async () => {
  const account = await owner({ role: "ADMIN" });
  const first = await staff("TUTOR");
  await redeemAccountInvitation(db, { ...profile, ...first }, account.id);
  const tutor = (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
    .tutorId;
  const second = await staff("TUTOR");
  await redeemAccountInvitation(db, { ...profile, ...second }, account.id);
  const coordinator = await staff("COORDINATOR");
  await redeemAccountInvitation(db, { ...profile, ...coordinator }, account.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    role: "ADMIN",
    tutorId: tutor,
    passwordHash: account.passwordHash,
  });
  expect(await db.tutor.count()).toBe(1);
});

it("tutee mailbox codes preserve priority, commit failed guesses and rotate on resend", async () => {
  await stagedSurvey(email);
  const before = await db.studentSurvey.findFirstOrThrow({ where: { email } });
  const initial = surveyEmailCode(before.tokenHash);
  expect(mail.send.mock.calls.at(-1)?.[0].text).toContain(initial);
  await expect(verifySurveyEmail(db, email, "WRONG")).rejects.toThrow();
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: before.id } }))
      .verificationAttempts,
  ).toBe(1);
  expect((await verifySurveyEmail(db, email, initial)).id).toBe(before.id);
  await resendSurvey(db, email, false);
  await expect(verifySurveyEmail(db, email, initial)).rejects.toThrow();
  const after = await db.studentSurvey.findUniqueOrThrow({
    where: { id: before.id },
  });
  expect(after.submittedAt).toEqual(before.submittedAt);
  expect(after.payload).toEqual(before.payload);
  expect(after.verificationDueAt).toEqual(before.verificationDueAt);
  expect(
    (await verifySurveyEmail(db, email, surveyEmailCode(after.tokenHash))).id,
  ).toBe(before.id);
});

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

it.each(["TUTOR", "VIEWER"] as const)(
  "accepting %s proof verifies the primary without replacing established credentials",
  async (kind) => {
    const account = await owner({
      emailVerifiedAt: null,
      mustChangePassword: true,
    });
    const invite = kind === "VIEWER" ? await viewer() : await staff();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
        .emailVerifiedAt,
    ).toBeNull();
    await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
    const after = await db.user.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(after.emailVerifiedAt).toBeInstanceOf(Date);
    expect(after).toMatchObject({
      passwordHash: account.passwordHash,
      mustChangePassword: true,
      name: account.name,
      email: account.email,
    });
    if (kind === "VIEWER") expect(after.role).toBe(account.role);
  },
);

it("adding Tutor participation preserves an existing Crew role and membership", async () => {
  const account = await owner({
    role: "CREW",
    crewStatus: "ACTIVE",
  });
  const invite = await staff();
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  const after = await db.user.findUniqueOrThrow({ where: { id: account.id } });
  expect(after.tutorId).toBeTruthy();
  expect(after).toMatchObject({
    role: "CREW",
    crewStatus: "ACTIVE",
    passwordHash: account.passwordHash,
    name: account.name,
  });
});

it("sign-in-only completion consumes a Viewer source once and rejects participation invitations", async () => {
  const account = await owner({ emailVerifiedAt: null });
  const invite = await viewer();
  await expect(
    redeemAccountInvitation(db, { ...profile, ...invite }, undefined, true),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await redeemAccountInvitation(
    db,
    { ...profile, ...invite },
    account.id,
    true,
  );
  await redeemAccountInvitation(
    db,
    { ...profile, ...invite },
    account.id,
    true,
  );
  expect(
    await db.auditLog.count({
      where: { operation: "accountInvitation.redeem" },
    }),
  ).toBe(1);
  expect(
    (await db.viewerSignup.findUniqueOrThrow({ where: { email } })).usedAt,
  ).toBeInstanceOf(Date);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    role: "STUDENT",
    passwordHash: account.passwordHash,
    name: account.name,
  });
  const participation = await staff();
  await expect(
    redeemAccountInvitation(
      db,
      { ...profile, ...participation },
      account.id,
      true,
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("resolves verified secondary email without replacing the primary identity or password", async () => {
  const account = await owner({ emailVerifiedAt: null });
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
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
      .emailVerifiedAt,
  ).toBeNull();
});

it.each(["TUTOR", "CREW"] as const)(
  "%s invitation preserves canonical academics and ignores posted profile changes",
  async (kind) => {
    await db.term.create({
      data: {
        id: "academic-term",
        name: "Current",
        active: true,
        schoolYear: "26-27",
        quarter: "Q1",
      },
    });
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
    const receipt = await redeemAccountInvitation(
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
    expect(receipt.academicConfirmationRequired).toBe(true);
    expect(
      await redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
    ).toEqual(receipt);
    expect(
      await inspectAccountInvitation(db, { ...invite, userId: account.id }),
    ).toMatchObject({ completed: true, academicConfirmationRequired: true });
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

it("preserves an accountless bound roster's exact legacy identity in the invitation preview", async () => {
  const roster = await db.tutor.create({
    data: { englishName: "Original Unsplit Roster Name", email },
  });
  const invite = await staff();
  await db.registrationCode.update({
    where: { id: invite.row.id },
    data: { tutorId: roster.id },
  });
  expect(await inspectAccountInvitation(db, invite)).toMatchObject({
    name: roster.englishName,
    legacyName: roster.englishName,
    firstName: "",
    lastName: "",
    existing: false,
  });
});

it("only the exact authenticated recipient can recover an expired completed receipt", async () => {
  const account = await owner();
  const invite = await staff("CREW");
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  await db.accountInvitation.update({
    where: { id: invite.invitationId },
    data: { expiresAt: new Date(0) },
  });
  expect(
    await inspectAccountInvitation(db, {
      invitationId: invite.invitationId,
      userId: account.id,
    }),
  ).toMatchObject({ completed: true, kind: "CREW" });
  await expect(inspectAccountInvitation(db, invite)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    inspectAccountInvitation(db, { ...invite, userId: "head" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    consumeInvitationLogin(invite.invitationId, invite.proof),
  ).resolves.toBeNull();
  const unfinished = await staff();
  await db.accountInvitation.update({
    where: { id: unfinished.invitationId },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    inspectAccountInvitation(db, { ...unfinished, userId: account.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

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
  "management %s invitation upgrades its verified existing account without replacing credentials",
  async (kind) => {
    const account = await owner();
    const invite = await staff(kind);
    await expect(
      redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      id: account.id,
      role: kind,
      name: account.name,
      passwordHash: account.passwordHash,
    });
    expect(
      (
        await db.registrationCode.findUniqueOrThrow({
          where: { id: invite.row.id },
        })
      ).usedAt,
    ).not.toBeNull();
  },
);

it.each(["suspended", "departure", "crewInactive"] as const)(
  "cannot restore restricted participation: %s",
  async (state) => {
    const account = await owner(
      state === "suspended"
        ? { suspendedAt: new Date() }
        : state === "crewInactive"
          ? { crewStatus: "INACTIVE" }
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
  await expect(
    anonymous().tutee.confirmSurvey({ token, password: profile.password }),
  ).rejects.toThrow(/Open the invitation we emailed/);
  expect(
    await db.accountInvitation.findUnique({
      where: { id: invite.invitationId },
    }),
  ).not.toBeNull();
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

async function stagedSurvey(target: string) {
  await db.term.upsert({
    where: { id: "term" },
    update: {},
    create: {
      id: "term",
      name: "Intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.subject.upsert({
    where: { id: "math" },
    update: {},
    create: { id: "math", name: "Math" },
  });
  await db.timeSlot.upsert({
    where: { id: "slot" },
    update: {},
    create: {
      id: "slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  if (!(await db.policyDocument.count()))
    await db.policyDocument.create({
      data: {
        slug: "tutee-policy",
        locale: "en",
        title: "Policy",
        body: "Respect your partner.",
      },
    });
  const policy = await currentPolicy(db, "tutee-policy");
  await submitSurvey(
    db,
    surveyInput.parse({
      englishName: "Invited Student",
      email: target,
      preferredContact: target,
      firstChoiceId: "math",
      slotIds: ["slot"],
      signatureName: "Invited Student",
      agreed: true,
      policyRevision: policy.revision,
    }),
  );
  return /token=([a-f0-9]{64})/.exec(mail.send.mock.calls.at(-1)![0].text)![1]!;
}
async function surveyInvitation(target: string, token: string) {
  const invite = await issueSurveyAccountInvitation(db, token);
  const verified = await verifyAccountInvitation(db, {
    ...invite,
    email: target,
    code: code(),
  });
  return { ...invite, ...verified };
}
it.each([false, true])(
  "quarter withdrawal prevents verified-alias enrollment (alias linked after submission=%s)",
  async (late) => {
    const account = await owner(),
      alias = "survey-alias@example.test";
    let token = "";
    if (late) token = await stagedSurvey(alias);
    await db.accountEmail.create({
      data: { userId: account.id, email: alias, verifiedAt: new Date() },
    });
    await db.studentQuarterBlock.create({
      data: {
        userId: account.id,
        email,
        intakeTermId: "term",
        surveyId: "retained-withdrawal-source",
      },
    });
    if (!late)
      await expect(stagedSurvey(alias)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    else {
      const invite = await surveyInvitation(alias, token);
      await expect(
        redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (
          await db.accountInvitation.findUniqueOrThrow({
            where: { id: invite.invitationId },
          })
        ).completedAt,
      ).toBeNull();
    }
    expect(await db.tutee.count()).toBe(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: account.id } }))
        .tuteeMember,
    ).toBe(false);
  },
);
it.each([false, true])(
  "an existing confirmed request rejects an alias duplicate (alias linked after submission=%s)",
  async (late) => {
    const account = await owner(),
      alias = "survey-alias@example.test";
    const aliasToken = late ? await stagedSurvey(alias) : "";
    const original = await surveyInvitation(email, await stagedSurvey(email));
    await redeemAccountInvitation(db, { ...profile, ...original }, account.id);
    await db.accountEmail.create({
      data: { userId: account.id, email: alias, verifiedAt: new Date() },
    });
    if (!late)
      await expect(stagedSurvey(alias)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    else {
      const invite = await surveyInvitation(alias, aliasToken);
      await expect(
        redeemAccountInvitation(db, { ...profile, ...invite }, account.id),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await db.tutee.count()).toBe(1);
    expect(
      await db.studentSurvey.count({ where: { confirmedAt: { not: null } } }),
    ).toBe(1);
  },
);
it("a first valid verified-alias survey preserves canonical credentials and submission evidence", async () => {
  const account = await owner({ emailVerifiedAt: null }),
    alias = "survey-alias@example.test";
  await db.accountEmail.create({
    data: { userId: account.id, email: alias, verifiedAt: new Date() },
  });
  const token = await stagedSurvey(alias),
    before = await db.studentSurvey.findFirstOrThrow();
  const invite = await surveyInvitation(alias, token);
  await redeemAccountInvitation(db, { ...profile, ...invite }, account.id);
  expect(
    await db.user.findUniqueOrThrow({ where: { id: account.id } }),
  ).toMatchObject({
    email,
    emailVerifiedAt: null,
    name: account.name,
    passwordHash: account.passwordHash,
    tuteeMember: true,
  });
  expect((await db.studentSurvey.findFirstOrThrow()).submittedAt).toEqual(
    before.submittedAt,
  );
  expect((await db.policyAcceptance.findFirstOrThrow()).acceptedAt).toEqual(
    before.submittedAt,
  );
});
