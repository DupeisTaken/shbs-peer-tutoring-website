import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { db as database } from "~/server/db";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";
import { applyUndo } from "~/server/audit/log";
import { announcementVisibility } from "~/lib/announcement-recipients";

/** Exercise real tRPC authorization/handlers using an isolated in-memory adapter, no live DB. */
function fixture(
  role: Session["role"] = "ADMIN",
  tutorId: string | null = null,
) {
  const mock = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ role, tutorId, suspendedAt: null, name: "Test" }),
      findMany: vi.fn().mockResolvedValue([{ id: "student-a", tutorId: "a" }]),
    },
    tutor: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "a",
          englishName: "A",
          gradeLevel: 12,
          status: "ACTIVE",
          pairings: [],
        },
        {
          id: "b",
          englishName: "B",
          gradeLevel: 11,
          status: "ACTIVE",
          pairings: [],
        },
      ]),
    },
    tutorQualification: { findMany: vi.fn().mockResolvedValue([]) },
    subject: { findMany: vi.fn().mockResolvedValue([]) },
    term: { findFirst: vi.fn().mockResolvedValue({ id: "term" }) },
    announcement: {
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: unknown }) => ({
          id: "announcement",
          ...(data as object),
        })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    announcementAck: { upsert: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = mock as unknown as typeof database;
  const session: Session = {
    user: { id: "actor", name: "Test" },
    role,
    tutorId,
    expires: "2099-01-01",
  };
  return {
    mock,
    db,
    caller: createCaller({ db, session, headers: new Headers() }),
  };
}

beforeEach(() => vi.clearAllMocks());
describe("announcement publication and access", () => {
  it("persists the server-resolved snapshot and limits notification queries", async () => {
    const { caller, mock } = fixture();
    const result = await caller.admin.createAnnouncement({
      title: "Grade 12",
      body: "Private",
      audience: { mode: "filtered", grades: [12] },
    });
    expect(result).toMatchObject({
      audienceRestricted: true,
      recipientTutorIds: ["a"],
    });
    expect(mock.user.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        OR: [
          { tutorId: { in: ["a"] } },
          { role: { in: ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"] } },
        ],
      },
    });
    // Future roster mutations cannot alter the persisted identity array.
    mock.tutor.findMany.mockResolvedValue([]);
    expect(result.recipientTutorIds).toEqual(["a"]);
    expect(mock.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "student-a",
          title: "📣 Grade 12",
          body: "Private",
          link: "/dashboard",
        },
      ],
    });
  });
  it("blocks empty, deleted and missing-active-term recipients without writes", async () => {
    const { caller, mock } = fixture();
    await expect(
      caller.admin.createAnnouncement({
        title: "Empty",
        body: "Body",
        audience: { mode: "specific" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.admin.createAnnouncement({
        title: "Deleted",
        body: "Body",
        audience: { mode: "specific", includeTutorIds: ["gone"] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    mock.term.findFirst.mockResolvedValue(null);
    await expect(
      caller.admin.createAnnouncement({
        title: "Term",
        body: "Body",
        audience: { mode: "filtered", assignment: "without" },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.announcement.create).not.toHaveBeenCalled();
    expect(mock.notification.createMany).not.toHaveBeenCalled();
  });
  it("enforces the same predicate for reads and acknowledgements", async () => {
    const { caller, mock } = fixture("TUTOR", "b");
    await caller.tutor.myAnnouncements();
    expect(mock.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, ...announcementVisibility("b") },
      }),
    );
    await expect(
      caller.tutor.acknowledgeAnnouncement({ announcementId: "private" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mock.announcement.findFirst).toHaveBeenCalledWith({
      where: { id: "private", active: true, ...announcementVisibility("b") },
      select: { id: true },
    });
    expect(mock.announcementAck.upsert).not.toHaveBeenCalled();
    mock.announcement.findFirst.mockResolvedValue({ id: "allowed" });
    await caller.tutor.acknowledgeAnnouncement({ announcementId: "allowed" });
    expect(mock.announcementAck.upsert).toHaveBeenCalledOnce();
  });
  it("rejects tutor access to recipient rosters and publication", async () => {
    const { caller, mock } = fixture("TUTOR", "a");
    await expect(caller.admin.announcementCandidates()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.admin.createAnnouncement({ title: "Test", body: "Body" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mock.announcement.create).not.toHaveBeenCalled();
  });
  it("restores snapshot audiences and keeps old audit payloads compatible", async () => {
    const { db, mock } = fixture();
    const payload = {
      id: "old",
      title: "Test",
      body: "Body",
      active: true,
      pinned: false,
      createdById: null,
    };
    await applyUndo(
      {
        kind: "announcement.restore",
        payload: {
          ...payload,
          audienceRestricted: true,
          recipientTutorIds: ["a"],
        },
      },
      db,
    );
    expect(mock.announcement.create.mock.calls.at(-1)?.[0]).toMatchObject({
      data: {
        audienceRestricted: true,
        recipientTutorIds: ["a"],
      },
    });
    await applyUndo({ kind: "announcement.restore", payload }, db);
    expect(mock.announcement.create.mock.calls.at(-1)?.[0]).toMatchObject({
      data: {
        audienceRestricted: false,
        recipientTutorIds: [],
      },
    });
  });
});
