import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainDb, TransactionDb } from "~/server/transactions";

const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("~/server/recovery/checkpoint", () => ({
  withAutomaticRecoveryCheckpoint: async (
    _tx: unknown,
    _source: unknown,
    _actor: unknown,
    work: () => Promise<unknown>,
  ) => work(),
}));
vi.mock("~/server/audit/evidence", () => ({
  recordDomainAudit: async () => {
    if (audit.fail) throw new Error("Synthetic audit failure");
  },
}));

import { finalizeDueOptOuts } from "./removal";

type Notice = { userId: string; event: string; link: string; context: unknown };
type State = {
  status: string;
  request: {
    id: string;
    tuteeId: string;
    state: string;
    pairingId: string;
    requestedByTutorId: string;
  };
  links: Array<{
    pairingId: string;
    pairing: { tutor: { user: { id: string } | null } };
  }>;
  notices: Notice[];
};

/** Only checkpoint bookkeeping is mocked; the writer, source wrapper and audience
 * query execute against a rollback-capable, database-free transaction adapter. */
function fixture(role: "ADMIN" | "HEAD", overlap = true, raceClaim = false) {
  const users = [
    {
      id: "dual",
      role,
      suspendedAt: null as Date | null,
      mergedIntoId: null as string | null,
    },
    {
      id: "manager",
      role: role === "ADMIN" ? "HEAD" : "ADMIN",
      suspendedAt: null,
      mergedIntoId: null,
    },
    {
      id: "suspended",
      role: "ADMIN",
      suspendedAt: new Date(),
      mergedIntoId: null,
    },
    { id: "merged", role: "HEAD", suspendedAt: null, mergedIntoId: "manager" },
  ];
  const state: State = {
    status: "ACTIVE",
    request: {
      id: "removal",
      tuteeId: "learner",
      state: "PENDING",
      pairingId: "p1",
      requestedByTutorId: "tutor",
    },
    links: ["tutor", "tutor", overlap ? "dual" : "second-tutor", null].map(
      (id, i) => ({
        pairingId: `p${i + 1}`,
        pairing: { tutor: { user: id ? { id } : null } },
      }),
    ),
    notices: [],
  };
  const query = vi.fn(
    async (_query: TemplateStringsArray, ..._values: unknown[]) => [],
  );
  const managers = vi.fn(async () =>
    users.filter((user) => !user.suspendedAt && !user.mergedIntoId),
  );
  const insert = vi.fn();
  function client(current: State) {
    return {
      $queryRaw: query,
      $executeRaw: vi.fn().mockResolvedValue(0),
      term: { findFirst: async () => null },
      pairingExecutionSuccessor: { findMany: async () => [] },
      user: { findMany: managers },
      tutee: {
        findUniqueOrThrow: async () => ({
          id: "learner",
          englishName: "Synthetic Learner",
          status: current.status,
        }),
        update: async ({ data }: { data: { status: string } }) => {
          current.status = data.status;
        },
      },
      pairingTutee: {
        findFirst: async () => ({ tuteeId: "learner" }),
        findMany: async () => current.links,
        deleteMany: async () => {
          current.links = [];
          return { count: 4 };
        },
      },
      tuteeRemovalRequest: {
        findMany: async () =>
          current.request.state === "PENDING" ? [current.request] : [],
        findUnique: async () => ({ ...current.request }),
        update: async ({ data }: { data: { state: string } }) =>
          Object.assign(current.request, data),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id?: string; tuteeId?: string; state?: string };
          data: { state: string };
        }) => {
          if (raceClaim && current.request.state === "PENDING") {
            current.request.state = "RECALLED";
            return { count: 0 };
          }
          if (
            (where.id && where.id !== current.request.id) ||
            (where.tuteeId && where.tuteeId !== current.request.tuteeId) ||
            (where.state && where.state !== current.request.state)
          ) {
            return { count: 0 };
          }
          Object.assign(current.request, data);
          return { count: 1 };
        },
      },
      notification: {
        createMany: async ({ data }: { data: Notice[] }) => {
          insert(data);
          current.notices.push(...data);
          return { count: data.length };
        },
      },
    };
  }
  const db = {
    $transaction: async (work: (tx: TransactionDb) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const result = await work(client(draft) as unknown as TransactionDb);
      Object.assign(state, draft);
      return result;
    },
  } as unknown as DomainDb;
  return { db, state, users, managers, query, insert };
}

beforeEach(() => {
  audit.fail = false;
});

describe("removal notification audience", () => {
  it.each(["ADMIN", "HEAD"] as const)(
    "sends one management copy to an affected %s tutor",
    async (role) => {
      const f = fixture(role);
      expect(await finalizeDueOptOuts(f.db)).toBe(1);
      expect(f.state.notices.map(({ userId, link }) => [userId, link])).toEqual(
        [
          ["tutor", "/dashboard"],
          ["dual", "/admin/tutee-requests"],
          ["manager", "/admin/tutee-requests"],
        ],
      );
      expect(
        f.state.notices.every((notice) => notice.event === "tutee_removed"),
      ).toBe(true);
      expect(
        new Set(f.state.notices.map((notice) => JSON.stringify(notice.context)))
          .size,
      ).toBe(1);
      expect(f.insert).toHaveBeenCalledOnce();
      // One source scope encloses the complete recipient union and restores it once.
      expect(
        f.query.mock.calls.filter(([sql]) =>
          sql.join("").includes("set_config"),
        ),
      ).toHaveLength(2);
      expect(await finalizeDueOptOuts(f.db)).toBe(0);
      expect(f.state.notices).toHaveLength(3);
    },
  );

  it("preserves disjoint audiences and deduplicates multiple affected pairings", async () => {
    const f = fixture("ADMIN", false);
    await finalizeDueOptOuts(f.db);
    expect(f.state.notices).toHaveLength(4);
    expect(new Set(f.state.notices.map((notice) => notice.userId)).size).toBe(
      4,
    );
    expect(
      f.state.notices.find((notice) => notice.userId === "second-tutor")?.link,
    ).toBe("/dashboard");
  });

  it.each(["suspended", "merged"] as const)(
    "does not give a %s manager the management destination",
    async (restriction) => {
      const f = fixture("ADMIN");
      if (restriction === "suspended") f.users[0]!.suspendedAt = new Date();
      else f.users[0]!.mergedIntoId = "manager";
      await finalizeDueOptOuts(f.db);
      expect(
        f.state.notices.find((notice) => notice.userId === "dual")?.link,
      ).toBe("/dashboard");
      expect(
        f.state.notices.some((notice) =>
          ["suspended", "merged"].includes(notice.userId),
        ),
      ).toBe(false);
      expect(f.managers).toHaveBeenCalledWith({
        where: {
          role: { in: ["ADMIN", "HEAD"] },
          suspendedAt: null,
          mergedIntoId: null,
        },
        select: { id: true, role: true },
      });
    },
  );

  it("rolls back roster state and every notice when the removal transaction fails", async () => {
    const f = fixture("HEAD");
    audit.fail = true;
    await expect(finalizeDueOptOuts(f.db)).rejects.toThrow(
      "Synthetic audit failure",
    );
    expect(f.state.status).toBe("ACTIVE");
    expect(f.state.request.state).toBe("PENDING");
    expect(f.state.links).toHaveLength(4);
    expect(f.state.notices).toEqual([]);
  });

  it("does not overwrite a recalled removal or detach pairings when the request is no longer PENDING", async () => {
    // Simulate a concurrent tutor recall committing after the initial due scan
    // but before finalizeRemoval claims the request conditionally.
    const f = fixture("HEAD", true, true);
    expect(await finalizeDueOptOuts(f.db)).toBe(0);
    expect(f.state.request.state).toBe("RECALLED");
    expect(f.state.status).toBe("ACTIVE");
    expect(f.state.links).toHaveLength(4);
    expect(f.state.notices).toEqual([]);
  });
});
