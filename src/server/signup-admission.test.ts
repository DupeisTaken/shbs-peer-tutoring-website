import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
}));
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { db } from "./db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  reserveSignupQuotas,
  withSignupAdmission,
  withSignupLease,
} from "./signup-admission";
import { createCaller } from "./api/root";
import { currentPolicy } from "./policy-acceptance";
import { emailSender } from "./email/sender";
import { hashCode } from "./auth/registration";

const headers = new Headers({ "x-signup-client-ip": "192.0.2.1" });
const caller = () => createCaller({ db, headers, session: null });
// eslint-disable-next-line @typescript-eslint/unbound-method
const send = vi.mocked(emailSender.send);
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
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
  vi.stubEnv("SIGNUP_TRUST_PROXY", "true");
  send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
afterAll(() => db.$disconnect());

it("cannot overspend the final durable allowance across independent clients or reconnects", async () => {
  const second = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const quotas = [{ key: "mail:global", max: 1, windowMs: 900_000 }];
  const results = await Promise.allSettled([
    reserveSignupQuotas(db, quotas),
    reserveSignupQuotas(second, quotas),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await second.$disconnect();
  await expect(reserveSignupQuotas(second, quotas)).rejects.toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  await second.$disconnect();
});
it("counts failed business operations, normalizes email, and keeps completion independent", async () => {
  const work = vi.fn(async () => {
    throw new Error("business failure");
  });
  await expect(
    withSignupAdmission(db, headers, "mail", " A@EXAMPLE.test ", work),
  ).rejects.toThrow("business failure");
  await expect(
    withSignupAdmission(db, headers, "mail", "a@example.test", work),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(work).toHaveBeenCalledTimes(1);
  vi.stubEnv("SIGNUP_MAIL_GLOBAL", "1");
  await expect(
    withSignupAdmission(db, headers, "mail", "b@example.test", work),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  await expect(
    withSignupAdmission(
      db,
      headers,
      "complete",
      "a@example.test",
      async () => "confirmed",
    ),
  ).resolves.toBe("confirmed");
});
it("bounds in-flight work without a queue, releases failures and recovers expired leases", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = withSignupLease(
    db,
    "test",
    async () => {
      entered();
      await pending;
    },
    1,
  );
  await started;
  await expect(
    withSignupLease(db, "test", async () => undefined, 1),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  release();
  await first;
  await expect(
    withSignupLease(
      db,
      "test",
      async () => {
        throw Error("failed");
      },
      1,
    ),
  ).rejects.toThrow("failed");
  expect(await db.signupLease.count()).toBe(0);
  await db.signupLease.create({
    data: { slot: "test:1", owner: "crashed", expiresAt: new Date(0) },
  });
  await expect(withSignupLease(db, "test", async () => true, 1)).resolves.toBe(
    true,
  );
});
it("concurrent viewer starts send one mail and failed delivery retains previous proof", async () => {
  const input = {
    name: "Viewer",
    affiliation: "Family",
    email: "one@example.test",
  };
  const results = await Promise.allSettled([
    caller().viewer.start(input),
    caller().viewer.start(input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(send).toHaveBeenCalledTimes(1);
  const before = await db.viewerSignup.findUniqueOrThrow({
    where: { email: input.email },
  });
  await db.signupQuota.deleteMany({
    where: { OR: [{ key: { startsWith: "mail:cooldown:" } }, { key: { startsWith: "mail:delivery-cooldown:" } }] },
  });
  send.mockRejectedValueOnce(new Error("SMTP failed"));
  await expect(caller().viewer.start(input)).rejects.toMatchObject({
    message: "SIGNUP_MAIL_FAILED",
  });
  const after = await db.viewerSignup.findUniqueOrThrow({
    where: { email: input.email },
  });
  expect(after.codeHash).toBe(before.codeHash);
  expect(after.codeExpiresAt).toEqual(before.codeExpiresAt);
});
it("allows 100 mixed registrations, reads, verification and ordinary retries from one school in 15 minutes", async () => {
  await db.term.create({
    data: { name: "Intake", schoolYear: "26-27", quarter: "Q1", active: true },
  });
  await db.subject.create({ data: { id: "math", name: "Math" } });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Be kind.",
    },
  });
  await db.timeSlot.create({
    data: {
      id: "slot",
      label: "After school",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  const policy = await currentPolicy(db, "tutee-policy");
  const start = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  for (let i = 0; i < 100; i++) {
    vi.setSystemTime(start + i * 8_000);
    await caller().tutee.signupOptions();
    const email = `school-${i}@example.test`;
    if (i % 2 === 0) {
      await caller().tutee.requestSignup({
        englishName: `Student ${i}`,
        email,
        firstChoiceId: "math",
        slotIds: ["slot"],
        signatureName: "Student",
        preferredContact: email,
        agreed: true,
        policyRevision: policy.revision,
      });
      const token = /token=([a-f0-9]{64})/.exec(
        send.mock.calls.at(-1)![0].text,
      )![1]!;
      await caller().tutee.inspectSurvey({ token });
      await caller().tutee.confirmSurvey({
        token,
        password: "StudentPassword42",
      });
    } else {
      await caller().viewer.start({
        name: "Viewer",
        affiliation: "Family",
        email,
      });
      const code = /code is ([0-9A-Z]{5})/.exec(
        send.mock.calls.at(-1)![0].text,
      )![1]!;
      if (i % 5 === 0)
        await expect(
          caller().viewer.verify({
            email,
            code: hashCode(code) === hashCode("AAAAA") ? "BBBBB" : "AAAAA",
          }),
        ).rejects.toThrow();
      const verified = await caller().viewer.verify({ email, code });
      await caller().viewer.complete({
        email,
        password: "ViewerPassword42",
        completionProof: verified.completionProof,
      });
    }
  }
  expect(await db.user.count()).toBe(100);
  expect(send).toHaveBeenCalledTimes(100);
}, 60_000);
