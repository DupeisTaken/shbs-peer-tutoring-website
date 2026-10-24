import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { db as database } from "~/server/db";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// Keep these read-contract checks independent of local database ownership.
vi.mock("~/server/db", () => ({ db: {} }));
import { createCallerFactory } from "~/server/api/trpc";
import { interviewManagementRouter } from "./interview-management";

function fixture(role = "ADMIN") {
  const empty = () => ({
    findMany: vi.fn(async (_query: { where: Record<string, unknown> }) => []),
  });
  const mock = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        role,
        name: "Reader",
        username: "reader",
        tutorId: null,
        suspendedAt: null,
        schoolDeparture: null,
      }),
    },
    tutorApplication: { ...empty(), count: vi.fn().mockResolvedValue(43) },
    registrationCode: empty(),
    tutor: empty(),
    approvalRequest: empty(),
  };
  const caller = createCallerFactory(interviewManagementRouter)({
    db: mock as unknown as typeof database,
    headers: new Headers(),
    session: {
      user: { id: "reader", name: "Reader" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    } as Session,
  });
  return { mock, caller };
}

describe("interview record queue read controls", () => {
  it("retains creation-descending defaults and a deterministic 20-item page", async () => {
    const { mock, caller } = fixture();
    const result = await caller.options();
    expect(mock.tutorApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        skip: 0,
        where: expect.objectContaining({
          interviewCompletedAt: null,
          status: { not: "RECALLED" },
          invalidatedAt: null,
        }) as unknown,
      }),
    );
    expect(result.applications).toMatchObject({ pageSize: 20, total: 43 });
  });

  it.each([
    [
      "COMPLETED_DESC",
      [
        { interviewCompletedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    ],
    [
      "COMPLETED_ASC",
      [
        { interviewCompletedAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    ],
    ["CREATED_DESC", [{ createdAt: "desc" }, { id: "desc" }]],
    ["CREATED_ASC", [{ createdAt: "asc" }, { id: "desc" }]],
    ["NAME_ASC", [{ name: "asc" }, { createdAt: "desc" }, { id: "desc" }]],
    ["NAME_DESC", [{ name: "desc" }, { createdAt: "desc" }, { id: "desc" }]],
  ] as const)(
    "applies %s before offset pagination and shares all restrictions with count",
    async (sort, orderBy) => {
      const { mock, caller } = fixture();
      await caller.options({
        page: 2,
        search: " Math ",
        completion: "COMPLETED",
        status: "ACCEPTED",
        sort,
      });
      const query = mock.tutorApplication.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
        skip: number;
      };
      expect(query).toMatchObject({ orderBy, take: 20, skip: 40 });
      expect(query.where.AND).toEqual(
        expect.arrayContaining([{ status: "ACCEPTED" }]),
      );
      expect(query.where.interviewCompletedAt).toEqual({ not: null });
      expect(query.where.OR).toEqual(
        expect.arrayContaining([
          { name: { contains: "Math", mode: "insensitive" } },
        ]),
      );
      expect(mock.tutorApplication.count).toHaveBeenCalledWith({
        where: query.where,
      });
    },
  );

  it("intersects recalled status with the open scope instead of replacing its exclusion", async () => {
    const { mock, caller } = fixture();
    await caller.options({ status: "RECALLED" });
    expect(mock.tutorApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: "RECALLED" },
          AND: expect.arrayContaining([{ status: "RECALLED" }]) as unknown,
        }) as unknown,
      }),
    );
  });

  it("allows recalled history in ALL while retaining interview-history eligibility", async () => {
    const { mock, caller } = fixture();
    await caller.options({ completion: "ALL", status: "RECALLED" });
    const where = mock.tutorApplication.findMany.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("interviewCompletedAt");
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { status: "RECALLED" },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { interviewCompletedAt: { not: null } },
          ]) as unknown,
        }),
      ]),
    );
  });

  it("rejects unsupported controls and preserves staff-only queue access", async () => {
    const { caller } = fixture();
    await expect(
      caller.options({ sort: "unexpected" as "NAME_ASC" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.options({ status: "unexpected" as "ACCEPTED" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const viewer = fixture("VIEWER");
    await expect(
      viewer.caller.options({ completion: "ALL", sort: "COMPLETED_DESC" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(viewer.mock.tutorApplication.findMany).not.toHaveBeenCalled();
  });
});
