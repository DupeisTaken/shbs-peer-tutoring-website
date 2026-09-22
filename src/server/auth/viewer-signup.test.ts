import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { startViewerSignup, verifyViewerCode, completeViewerSignup } from "./viewer-signup";
import { verifyPassword } from "./password";

const email = "viewer-proof@example.test";
const password = "ViewerPassword123!";
let serial = 0;
const publicCaller = () => createCaller({ db, session: null, headers: new Headers({ "x-real-ip": `viewer-proof-${++serial}` }) });
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw Error("Dedicated local test database required");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((t) => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
});
afterAll(() => db.$disconnect());
async function verify(target = email) {
  const started = await startViewerSignup({ email: target, name: "Viewer", affiliation: "Family" });
  if (!started.ok) throw Error("Expected signup");
  const verified = await publicCaller().viewer.verify({ email: target, code: started.code });
  return { code: started.code, completionProof: verified.completionProof };
}

it("rejects another browser that knows a verified email but lacks its proof", async () => {
  const verified = await verify();
  await expect(publicCaller().viewer.complete({ email, password: "AttackerPassword!", completionProof: "0".repeat(64) }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  await expect(publicCaller().viewer.complete({ email, password, completionProof: verified.completionProof })).resolves.toMatchObject({ ok: true });
  const account = await db.user.findUniqueOrThrow({ where: { email } });
  expect(account.role).toBe("VIEWER");
  expect(verifyPassword(password, account.passwordHash!)).toBe(true);
});

it("binds completion to the verified email and expires proof with its challenge", async () => {
  const first = await verify();
  await verify("another-viewer@example.test");
  expect(await completeViewerSignup("another-viewer@example.test", password, first.completionProof)).toEqual({ ok: false, error: "email-unverified" });
  await db.viewerSignup.update({ where: { email }, data: { codeExpiresAt: new Date(0) } });
  expect(await completeViewerSignup(email, password, first.completionProof)).toEqual({ ok: false, error: "email-unverified" });
  expect(await db.user.count()).toBe(0);
});

it("invalidates previous proofs on resend and permits only one concurrent completion", async () => {
  const old = await verify();
  const fresh = await verify();
  expect(await completeViewerSignup(email, password, old.completionProof)).toEqual({ ok: false, error: "email-unverified" });
  const attempts = await Promise.allSettled([
    completeViewerSignup(email, password, fresh.completionProof),
    completeViewerSignup(email, password, fresh.completionProof),
  ]);
  expect(attempts.filter((result) => result.status === "fulfilled" && result.value.ok)).toHaveLength(1);
  expect(await db.user.count({ where: { email } })).toBe(1);
});

it("does not grant completion before verification or after exhausting guesses", async () => {
  const staged = await startViewerSignup({ email, name: "Viewer", affiliation: "Family" });
  if (!staged.ok) throw Error("Expected signup");
  expect(await completeViewerSignup(email, password, "0".repeat(64))).toEqual({ ok: false, error: "email-unverified" });
  const wrong = staged.code === "AAAAA" ? "BBBBB" : "AAAAA";
  for (let i = 0; i < 6; i++) expect((await verifyViewerCode(email, wrong)).ok).toBe(false);
  expect(await verifyViewerCode(email, staged.code)).toEqual({ ok: false, error: "too-many-attempts" });
});
