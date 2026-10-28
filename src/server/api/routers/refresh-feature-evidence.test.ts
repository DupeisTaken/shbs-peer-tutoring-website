import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { ApprovalQueued } from "~/server/approvals";
import { FEATURE_KEYS } from "~/server/program/features";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const source = "feature-refresh-source";
const caller = (role: "ADMIN" | "HEAD") => createCaller({ db, headers: new Headers(),
  session: { user: { id: `feature-refresh-${role}`, name: role }, role,
    tutorId: null, expires: "2099-01-01" } });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Feature refresh evidence requires serial local shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: (["ADMIN", "HEAD"] as const).map((role) => ({
    id: `feature-refresh-${role}`, role, email: `${role}@example.test`, name: role,
  })) });
  await db.term.create({ data: { id: source, name: "Feature refresh Q1",
    schoolYear: "26-27", quarter: "Q1", active: true } });
});
afterAll(() => db.$disconnect());

// Every staged module is part of the destructive activation review, including
// generations which change away and back to the same displayed value.
it.each(FEATURE_KEYS.flatMap((key) => (["direct", "queued"] as const).map((mode) => ({ key, mode }))))(
  "$mode refresh rejects $key staging drift away and back without activating anything",
  async ({ key, mode }) => {
    await caller("ADMIN").program.setFeaturePending({ key, enabled: false });
    const snapshot = await caller("HEAD").program.nextRecruitment();
    const input = { confirm: "REFRESH" as const, expectedTermId: source,
      expectedPreparation: snapshot.refreshEvidence };
    let request: Awaited<ReturnType<typeof db.approvalRequest.findUniqueOrThrow>> | null = null;
    if (mode === "queued") {
      const error: unknown = await caller("ADMIN").admin.refresh(input).catch((error: unknown) => error);
      expect((error as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
      request = await db.approvalRequest.findUniqueOrThrow({ where: {
        id: (error as { cause: ApprovalQueued }).cause.approvalId,
      } });
    }
    await caller("ADMIN").program.setFeaturePending({ key, enabled: true });
    await caller("HEAD").program.setFeaturePending({ key, enabled: false });
    const features = await db.programFeature.findMany();
    const operation = request
      ? caller("HEAD").approval.decide({ id: request.id, approve: true, note: "Review predates feature staging" })
      : caller("HEAD").admin.refresh(input);
    await expect(operation).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.term.count()).toBe(1);
    expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(source);
    expect(await db.programFeature.findMany()).toEqual(features);
    if (request) expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toEqual(request);
  },
);
