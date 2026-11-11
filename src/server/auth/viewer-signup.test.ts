import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({ send: vi.fn<(message: EmailMessage) => Promise<void>>().mockResolvedValue(undefined) }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import {
  startViewerSignup,
  verifyViewerCode,
  completeViewerSignup,
} from "./viewer-signup";
import { verifyPassword } from "./password";

const email = "viewer-proof@example.test";
const password = "ViewerPassword123!";
let serial = 0;
const publicCaller = () =>
  createCaller({
    db,
    session: null,
    headers: new Headers({ "x-real-ip": `viewer-proof-${++serial}` }),
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
});
afterAll(() => db.$disconnect());

it("retains the request language through mailbox verification and initializes only the new account", async () => {
  const staged = await startViewerSignup({ email, name: "Language Viewer", affiliation: "Family", emailLocale: "zh" });
  if (!staged.ok) throw Error("Expected signup");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("zh");
  const resent = await startViewerSignup({ email, name: "Language Viewer", affiliation: "Family", emailLocale: "en" });
  if (!resent.ok) throw Error("Expected resend");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("zh");
  const proof = await verifyViewerCode(email, resent.code);
  if (!proof.ok) throw Error("Expected mailbox proof");
  expect(await completeViewerSignup(email, password, proof.completionProof)).toEqual({ ok: true });
  expect((await db.user.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("zh");
  const retry = await startViewerSignup({ email, name: "Language Viewer", affiliation: "Family", emailLocale: "en" });
  if (!retry.ok) throw Error("Expected challenge");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("en");
  const existingProof = await verifyViewerCode(email, retry.code);
  if (!existingProof.ok) throw Error("Expected mailbox proof");
  expect(await completeViewerSignup(email, password, existingProof.completionProof)).toEqual({ ok: false, error: "email-taken" });
  expect((await db.user.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("zh");
});

it("captures only a supported public cookie language and honors verified-secondary account preference", async () => {
  const start = (target: string, cookie: string) => createCaller({ db, session: null, headers: new Headers({ cookie, "x-real-ip": `viewer-language-${++serial}` }) })
    .viewer.start({ email: target, name: "Language Viewer", affiliation: "Family" });
  await start(email, "NEXT_LOCALE=zh");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email } })).emailLocale).toBe("zh");
  expect(mail.send.mock.lastCall![0].subject).toBe("验证观察员注册");
  expect(mail.send.mock.lastCall![0].text).not.toContain("Enter this code");
  const resendTarget = "resend-language@example.test";
  await startViewerSignup({ email: resendTarget, name: "Language Viewer", affiliation: "Family", emailLocale: "zh" });
  await start(resendTarget, "NEXT_LOCALE=en");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email: resendTarget } })).emailLocale).toBe("zh");
  expect(mail.send.mock.lastCall![0].subject).toBe("验证观察员注册");
  const unsupported = "unsupported-language@example.test";
  await start(unsupported, "NEXT_LOCALE=fr");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email: unsupported } })).emailLocale).toBe("en");
  expect(mail.send.mock.lastCall![0].subject).toBe("Verify Viewer signup");
  const owner = await db.user.create({ data: { email: "saved-language@example.test", emailVerifiedAt: new Date(), emailLocale: "zh" } });
  const alias = "saved-language-alias@example.test";
  await db.accountEmail.create({ data: { userId: owner.id, email: alias, verifiedAt: new Date() } });
  await start(alias, "NEXT_LOCALE=en");
  expect((await db.viewerSignup.findUniqueOrThrow({ where: { email: alias } })).emailLocale).toBe("en");
  expect(mail.send.mock.lastCall![0].subject).toBe("验证观察员注册");
  expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).emailLocale).toBe("zh");
});
async function verify(target = email) {
  const started = await startViewerSignup({
    email: target,
    name: "Viewer",
    affiliation: "Family",
  });
  if (!started.ok) throw Error("Expected signup");
  const verified = await publicCaller().viewer.verify({
    email: target,
    code: started.code,
  });
  return {
    code: started.code,
    completionProof: verified.completionProof,
    invitationId: verified.invitationId,
  };
}

it("rejects another browser that knows a verified email but lacks its proof", async () => {
  const verified = await verify();
  await expect(
    publicCaller().viewer.complete({
      email,
      password: "AttackerPassword!",
      completionProof: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  await expect(
    publicCaller().viewer.complete({
      email,
      password,
      completionProof: verified.completionProof,
    }),
  ).rejects.toThrow(/Open the invitation we emailed/);
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  const sent = mail.send.mock.lastCall![0] as {
    presentation: { code: string };
  };
  const recipient = await publicCaller().accountInvitation.verify({
    invitationId: verified.invitationId,
    email,
    code: sent.presentation.code,
  });
  await publicCaller().accountInvitation.complete({
    invitationId: verified.invitationId,
    proof: recipient.proof,
    password,
    reviewed: true,
  });
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  expect(account.role).toBe("VIEWER");
  expect(account.personId).toBeTruthy();
  expect(await db.person.findUniqueOrThrow({ where: { id: account.personId! } })).toMatchObject({ primaryUserId: account.id });
  expect(await db.tutor.count()).toBe(0);
  expect(await db.tutee.count()).toBe(0);
  expect(verifyPassword(password, account.passwordHash!)).toBe(true);
});

it("binds completion to the verified email and expires proof with its challenge", async () => {
  const first = await verify();
  await verify("another-viewer@example.test");
  expect(
    await completeViewerSignup(
      "another-viewer@example.test",
      password,
      first.completionProof,
    ),
  ).toEqual({ ok: false, error: "email-unverified" });
  await db.viewerSignup.update({
    where: { email },
    data: { codeExpiresAt: new Date(0) },
  });
  expect(
    await completeViewerSignup(email, password, first.completionProof),
  ).toEqual({ ok: false, error: "email-unverified" });
  expect(await db.user.count()).toBe(0);
});

it("invalidates previous proofs on resend and permits only one concurrent completion", async () => {
  const old = await verify();
  const fresh = await verify();
  expect(
    await completeViewerSignup(email, password, old.completionProof),
  ).toEqual({ ok: false, error: "email-unverified" });
  const attempts = await Promise.allSettled([
    completeViewerSignup(email, password, fresh.completionProof),
    completeViewerSignup(email, password, fresh.completionProof),
  ]);
  expect(
    attempts.filter(
      (result) => result.status === "fulfilled" && result.value.ok,
    ),
  ).toHaveLength(1);
  expect(await db.user.count({ where: { email } })).toBe(1);
  expect(await db.person.count()).toBe(1);
});

it("does not grant completion before verification or after exhausting guesses", async () => {
  const staged = await startViewerSignup({
    email,
    name: "Viewer",
    affiliation: "Family",
  });
  if (!staged.ok) throw Error("Expected signup");
  expect(await completeViewerSignup(email, password, "0".repeat(64))).toEqual({
    ok: false,
    error: "email-unverified",
  });
  const wrong = staged.code === "AAAAA" ? "BBBBB" : "AAAAA";
  for (let i = 0; i < 6; i++)
    expect((await verifyViewerCode(email, wrong)).ok).toBe(false);
  expect(await verifyViewerCode(email, staged.code)).toEqual({
    ok: false,
    error: "too-many-attempts",
  });
});
