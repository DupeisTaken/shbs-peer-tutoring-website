import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw Error("Dedicated local test database required");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((t) => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
});
afterAll(() => db.$disconnect());

it.each(["HEAD", "ADMIN", "COORDINATOR", "TUTOR", "STUDENT", "CREW", "VIEWER"] as const)(
  "limits suspended %s sessions to their identity, suspension and appeal", async (role) => {
    await db.user.create({ data: { id: "suspended", email: "suspended@example.test", name: "Suspended", role, suspendedAt: new Date(), suspendedReason: "Review pending" } });
    const session: Session = { user: { id: "suspended" }, role, tutorId: null, expires: "2099-01-01" };
    const caller = createCaller({ db, session, headers: new Headers() });
    expect(await caller.account.me()).toMatchObject({ id: "suspended" });
    expect(await caller.account.suspension()).toMatchObject({ suspended: true, reason: "Review pending", appeal: null });
    expect(await caller.account.submitAppeal({ message: "Please review this suspension." })).toMatchObject({ ok: true });
    expect(await caller.account.suspension()).toMatchObject({ appeal: { state: "PENDING" } });
    // The same identity cannot read management/participant records or alter account settings.
    await expect(caller.admin.tutors()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.student.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.tutor.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.crew.myStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.account.updateName({ name: "Changed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: "suspended" } })).name).toBe("Suspended");
  },
);
