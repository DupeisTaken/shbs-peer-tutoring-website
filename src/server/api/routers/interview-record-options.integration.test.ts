import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCallerFactory } from "~/server/api/trpc";
import { interviewManagementRouter } from "./interview-management";

// Only this run's synthetic rows are created inside rolled-back transactions.
// The route remains read-only; the guard rejects demo/production .env databases.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = `interview-order-${randomUUID()}`;
const statuses = [
  "PENDING",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
  "RECALLED",
] as const;
const actors = ["ADMIN", "COORDINATOR", "HEAD", "VIEWER", "STUDENT"] as const;
const base = Date.UTC(2026, 8, 1);
const day = 86_400_000;
// Deliberately disagreeing name, creation and completion orders expose sorting
// a fetched page locally. Repeated dates/names exercise deterministic tie breaks.
const records = Array.from({ length: 35 }, (_, index) => ({
  id: `${prefix}-${String(index).padStart(2, "0")}`,
  name: `Candidate ${String(34 - Math.floor(index / 2)).padStart(2, "0")}`,
  email: `${prefix}-${index}@example.test`,
  status: statuses[index % statuses.length]!,
  // Only qualification requests may be recalled; preserve their required identity
  // and recall evidence rather than manufacturing an impossible INITIAL state.
  ...(index % statuses.length === 4
    ? {
        type: "ADDITIONAL_SUBJECT" as const,
        requestedTutorId: `${prefix}-tutor`,
        requestedSubjectId: `${prefix}-subject`,
        qualificationReason: "Synthetic recalled qualification request",
        recalledAt: new Date(base),
        recalledById: `${prefix}-STUDENT`,
      }
    : {}),
  createdAt: new Date(base + Math.floor(index / 3) * day),
  interviewAt: new Date(base),
  interviewCompletedAt:
    index < 30 ? new Date(base + (29 - Math.floor(index / 2)) * day) : null,
  invalidatedAt: index === 32 ? new Date(base) : null,
  invalidReason: index === 32 ? "Synthetic invalid intake" : null,
  invalidatedById: index === 32 ? `${prefix}-ADMIN` : null,
  invalidatedByName: index === 32 ? "Synthetic ADMIN" : null,
  invalidityVersion: index === 32 ? 1 : 0,
}));
const caller = (database: typeof db, role: (typeof actors)[number] = "ADMIN") =>
  createCallerFactory(interviewManagementRouter)({
    db: database,
    headers: new Headers(),
    session: {
      user: { id: `${prefix}-${role}` },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });

async function withFixture(run: (database: typeof db) => Promise<void>) {
  const rollback = new Error("Rollback synthetic interview query fixtures");
  try {
    await db.$transaction(
      async (tx) => {
        await tx.user.createMany({
          data: actors.map((role) => ({
            id: `${prefix}-${role}`,
            name: `Synthetic ${role}`,
            role,
            email: `${prefix}-${role.toLowerCase()}@example.test`,
          })),
        });
        await tx.tutor.create({
          data: {
            id: `${prefix}-tutor`,
            englishName: "Synthetic recalled requester",
          },
        });
        await tx.subject.create({
          data: {
            id: `${prefix}-subject`,
            name: `${prefix} synthetic subject`,
          },
        });
        await tx.tutorApplication.createMany({ data: records });
        await run(tx as unknown as typeof db);
        // Recalled qualification history is intentionally undeletable. Roll back
        // the synthetic transaction instead of bypassing its retention trigger.
        throw rollback;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
afterAll(async () => {
  await db.$disconnect();
});

type Sort =
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "COMPLETED_DESC"
  | "COMPLETED_ASC"
  | "NAME_ASC"
  | "NAME_DESC";
function expectedOrder(sort: Sort) {
  return [...records]
    .sort((a, b) => {
      let primary = 0;
      if (sort.startsWith("COMPLETED")) {
        if (!a.interviewCompletedAt || !b.interviewCompletedAt) {
          if (!!a.interviewCompletedAt !== !!b.interviewCompletedAt)
            return a.interviewCompletedAt ? -1 : 1;
        } else {
          primary =
            a.interviewCompletedAt.getTime() - b.interviewCompletedAt.getTime();
        }
      } else if (sort.startsWith("CREATED")) {
        primary = a.createdAt.getTime() - b.createdAt.getTime();
      } else {
        primary = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      }
      if (primary) return sort.endsWith("DESC") ? -primary : primary;
      return (
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      );
    })
    .map((row) => row.id);
}

it.each<Sort>([
  "CREATED_DESC",
  "CREATED_ASC",
  "COMPLETED_DESC",
  "COMPLETED_ASC",
  "NAME_ASC",
  "NAME_DESC",
])(
  "orders the complete PostgreSQL result by %s before selecting 20-item pages",
  async (sort) =>
    withFixture(async (database) => {
      const api = caller(database);
      const first = await api.options({
        search: prefix,
        completion: "ALL",
        sort,
        page: 0,
      });
      const second = await api.options({
        search: prefix,
        completion: "ALL",
        sort,
        page: 1,
      });
      const expected = expectedOrder(sort);
      expect(first.applications).toMatchObject({ total: 35, pageSize: 20 });
      expect(second.applications.total).toBe(35);
      expect(first.applications.rows.map((row) => row.id)).toEqual(
        expected.slice(0, 20),
      );
      expect(second.applications.rows.map((row) => row.id)).toEqual(
        expected.slice(20),
      );
      expect(
        new Set(
          [...first.applications.rows, ...second.applications.rows].map(
            (row) => row.id,
          ),
        ).size,
      ).toBe(35);
      // Re-reading an offset page must keep ties in exactly the same positions.
      expect(
        (
          await api.options({
            search: prefix,
            completion: "ALL",
            sort,
            page: 1,
          })
        ).applications.rows.map((row) => row.id),
      ).toEqual(expected.slice(20));
      if (sort.startsWith("COMPLETED")) {
        expect(
          second.applications.rows
            .slice(-5)
            .every((row) => row.interviewCompletedAt === null),
        ).toBe(true);
      }
    }),
);

it("intersects application status with completion, count and open exclusions in PostgreSQL", async () =>
  withFixture(async (database) => {
    const api = caller(database);
    for (const status of statuses) {
      const completed = await api.options({
        search: prefix,
        status,
        completion: "COMPLETED",
        sort: "COMPLETED_ASC",
      });
      const expected = records.filter(
        (row) => row.status === status && row.interviewCompletedAt !== null,
      );
      expect(completed.applications.total).toBe(expected.length);
      expect(completed.applications.rows.map((row) => row.id).sort()).toEqual(
        expected.map((row) => row.id).sort(),
      );
      const open = await api.options({
        search: prefix,
        status,
        completion: "OPEN",
      });
      const expectedOpen = records.filter(
        (row) =>
          row.status === status &&
          row.status !== "RECALLED" &&
          row.interviewCompletedAt === null &&
          row.invalidatedAt === null,
      );
      expect(open.applications.total).toBe(expectedOpen.length);
      expect(open.applications.rows.map((row) => row.id)).toEqual(
        expectedOpen.map((row) => row.id),
      );
    }
    const recalled = await api.options({
      search: prefix,
      status: "RECALLED",
      completion: "ALL",
    });
    expect(recalled.applications.total).toBe(7);
    expect(
      recalled.applications.rows.every((row) => row.status === "RECALLED"),
    ).toBe(true);
  }));

it("retains current staff authorization for sorted and filtered history reads", async () =>
  withFixture(async (database) => {
    for (const role of ["ADMIN", "HEAD", "COORDINATOR"] as const) {
      expect(
        (
          await caller(database, role).options({
            search: prefix,
            completion: "COMPLETED",
            status: "ACCEPTED",
            sort: "COMPLETED_DESC",
          })
        ).applications.total,
      ).toBe(6);
    }
    for (const role of ["VIEWER", "STUDENT"] as const) {
      await expect(
        caller(database, role).options({
          search: prefix,
          completion: "ALL",
          sort: "NAME_ASC",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  }));
