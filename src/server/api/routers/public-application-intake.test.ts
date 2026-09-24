import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type * as Notifications from "~/server/notifications/create";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailDeliveryAvailable: () => true,
}));
vi.mock("~/server/notifications/create", async (importOriginal) => {
  const actual = await importOriginal<typeof Notifications>();
  return { ...actual, notifyAdmins: vi.fn(actual.notifyAdmins) };
});

import { db } from "~/server/db";
import { createCaller } from "../root";
import { currentPolicy } from "~/server/policy-acceptance";
import { notifyAdmins } from "~/server/notifications/create";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  APPLICATION_EMAIL_MAX,
  APPLICATION_IP_MAX,
  applicationClientIp,
  applicationLimitKey,
} from "~/server/public-application-intake";

const client = (ip = "192.0.2.1") =>
  createCaller({
    db,
    session: null,
    headers: new Headers({ "x-forwarded-for": ip }),
  });
const tutorInput = async (email = "applicant@example.test") => ({
  name: "Original applicant",
  email,
  preferredContact: "Email",
  agreed: true as const,
  policyRevision: (await currentPolicy(db, "tutor-policy")).revision,
  subjects: [{ subjectId: "intake-math" }],
});
const crewInput = (email = "applicant@example.test") => ({
  name: "Original applicant",
  email,
  message: "Original message",
});
const bucket = (
  scope: "email" | "ip",
  value: string,
  count: number,
  expired = false,
) =>
  db.publicApplicationRateLimit.create({
    data: {
      key: applicationLimitKey(scope, value),
      count,
      resetsAt: new Date(Date.now() + (expired ? -1_000 : 60_000)),
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use shbs_shipping_test");
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
  vi.mocked(notifyAdmins).mockClear();
  for (const role of ["HEAD", "ADMIN", "COORDINATOR"] as const)
    await db.user.create({
      data: { name: role, email: `${role}@example.test`, role },
    });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Policy",
      body: "Synthetic policy",
    },
  });
  await db.term.create({
    data: { name: "Q1", schoolYear: "26-27", quarter: "Q1", active: true },
  });
  await db.subject.create({ data: { id: "intake-math", name: "Math" } });
});
afterAll(() => db.$disconnect());

it("serializes concurrent tutor retries across address casing and networks without extra notices", async () => {
  const input = await tutorInput();
  const result = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      client(`192.0.2.${i + 1}`).application.submit({
        ...input,
        email: i % 2 ? input.email.toUpperCase() : input.email,
      }),
    ),
  );
  expect(result).toEqual(Array.from({ length: 6 }, () => ({ ok: true })));
  expect(await db.tutorApplication.count()).toBe(1);
  expect(await db.notification.count()).toBe(3);
  expect(await db.publicApplicationRateLimit.count()).toBe(2);
  expect(
    (await db.publicApplicationRateLimit.findMany()).every(
      (row) => row.count === 1,
    ),
  ).toBe(true);
  await client().application.submit({
    ...input,
    name: "Untrusted replacement",
  });
  expect((await db.tutorApplication.findFirstOrThrow()).name).toBe(input.name);
});

it("serializes crew retries, preserves answers and does not disclose the earlier application", async () => {
  const input = crewInput();
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      client().crew.submitApplication({
        ...input,
        email: i % 2 ? input.email.toUpperCase() : input.email,
      }),
    ),
  );
  expect(await db.crewApplication.count()).toBe(1);
  expect(await db.notification.count()).toBe(3);
  await expect(
    client().crew.submitApplication({ ...input, message: "Replace this" }),
  ).resolves.toEqual({ ok: true });
  expect((await db.crewApplication.findFirstOrThrow()).message).toBe(
    input.message,
  );
});

it("treats an interview as pending, while allowing a new submission after a decision", async () => {
  const input = await tutorInput();
  await client().application.submit(input);
  await db.tutorApplication.updateMany({ data: { status: "INTERVIEW" } });
  await client().application.submit(input);
  expect(await db.tutorApplication.count()).toBe(1);
  await db.tutorApplication.updateMany({ data: { status: "REJECTED" } });
  await client().application.submit(input);
  expect(await db.tutorApplication.count()).toBe(2);
  expect(await db.notification.count()).toBe(6);
});

it("shares the email allowance between tutor and crew, and rolls back the over-limit transaction", async () => {
  const input = await tutorInput();
  await bucket("email", input.email, APPLICATION_EMAIL_MAX - 1);
  const results = await Promise.allSettled([
    client().application.submit(input),
    client("192.0.2.2").crew.submitApplication(crewInput(input.email)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
    code: "TOO_MANY_REQUESTS",
  });
  expect(
    (await db.tutorApplication.count()) + (await db.crewApplication.count()),
  ).toBe(1);
  expect(await db.notification.count()).toBe(3);
  expect(
    (
      await db.publicApplicationRateLimit.findUniqueOrThrow({
        where: { key: applicationLimitKey("email", input.email) },
      })
    ).count,
  ).toBe(APPLICATION_EMAIL_MAX);
});

it("serializes the last network allowance across distinct emails", async () => {
  await bucket("ip", "192.0.2.1", APPLICATION_IP_MAX - 1);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      client().crew.submitApplication(crewInput(`applicant${i}@example.test`)),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
  expect(await db.crewApplication.count()).toBe(1);
  expect(await db.publicApplicationRateLimit.count()).toBe(2);
  await expect(
    client("192.0.2.2").crew.submitApplication(crewInput("other@example.test")),
  ).resolves.toEqual({ ok: true });
});

it("keeps retries successful when limits are full, without reserving more capacity", async () => {
  const input = crewInput();
  await client().crew.submitApplication(input);
  await db.publicApplicationRateLimit.updateMany({
    data: { count: APPLICATION_IP_MAX },
  });
  await expect(client().crew.submitApplication(input)).resolves.toEqual({
    ok: true,
  });
  expect(
    (await db.publicApplicationRateLimit.findMany()).every(
      (row) => row.count === APPLICATION_IP_MAX,
    ),
  ).toBe(true);
  expect(await db.notification.count()).toBe(3);
});

it("resets expired email and network windows and prunes old unrelated counters", async () => {
  const input = crewInput();
  await bucket("email", input.email, APPLICATION_EMAIL_MAX, true);
  await bucket("ip", "192.0.2.1", APPLICATION_IP_MAX, true);
  await db.publicApplicationRateLimit.create({
    data: {
      key: "expired",
      count: 999,
      resetsAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
    },
  });
  await client().crew.submitApplication(input);
  const rows = await db.publicApplicationRateLimit.findMany();
  expect(rows).toHaveLength(2);
  expect(
    rows.every((row) => row.count === 1 && row.resetsAt > new Date()),
  ).toBe(true);
});

it("rolls back application and capacity when notification fan-out fails, then permits a retry", async () => {
  vi.mocked(notifyAdmins).mockRejectedValueOnce(
    new Error("Synthetic notification failure"),
  );
  await expect(client().crew.submitApplication(crewInput())).rejects.toThrow(
    "Synthetic notification failure",
  );
  expect(await db.crewApplication.count()).toBe(0);
  expect(await db.publicApplicationRateLimit.count()).toBe(0);
  expect(await db.notification.count()).toBe(0);
  await expect(client().crew.submitApplication(crewInput())).resolves.toEqual({
    ok: true,
  });
  expect(await db.notification.count()).toBe(3);
});

it("checks policy and subject validity even on retries, without consuming capacity", async () => {
  const input = await tutorInput();
  await client().application.submit(input);
  await expect(
    client().application.submit({ ...input, policyRevision: "stale" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    client().application.submit({
      ...input,
      subjects: [{ subjectId: "missing" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.publicApplicationRateLimit.findMany()).every(
      (row) => row.count === 1,
    ),
  ).toBe(true);
  expect(await db.notification.count()).toBe(3);
});

it("does not reserve capacity while crew is disabled or tutor recruitment is closed", async () => {
  await db.programFeature.create({ data: { key: "CREW", enabled: false } });
  await db.term.updateMany({ data: { tutorSignupEnabled: false } });
  await expect(
    client().crew.submitApplication(crewInput()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    client().application.submit(await tutorInput()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.publicApplicationRateLimit.count()).toBe(0);
});

it("canonicalizes IPv6 networks and mapped IPv4, and safely groups missing or invalid headers", () => {
  const ip = (value: string) =>
    applicationClientIp(new Headers({ "x-forwarded-for": value }));
  expect(ip("2001:0DB8:0001:0002::abcd")).toBe(ip("2001:db8:1:2::ffff"));
  expect(ip("::ffff:192.0.2.1")).toBe(ip("192.0.2.1"));
  expect(ip("192.0.2.1, 198.51.100.1")).toBe("192.0.2.1");
  expect(ip("not an address")).toBe("unknown");
  expect(ip("fe80::1%en0")).toBe("unknown");
  expect(applicationClientIp(new Headers())).toBe("unknown");
  expect(applicationClientIp(new Headers({ "x-real-ip": "192.0.2.2" }))).toBe(
    "192.0.2.2",
  );
});
