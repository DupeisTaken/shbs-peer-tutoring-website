import { describe, expect, it, vi } from "vitest";
import {
  acceptanceAccountAllowed,
  assertIsolatedRehearsalIdentity,
} from "./operator-cutover";
import { databaseIdentity } from "./operator-plan";
import {
  connectSourceMaintenance,
  setIsolatedAcceptancePassword,
  withReadOnlyAcceptanceApplication,
} from "./operator-cutover";
import { requireIdleRecoveryDatabase, type OperatorSql } from "./operator-site";

describe("sealed recovery database quiescence", () => {
  const database = "shbs_recovery_idle_test";
  const errorCode = "SYNTHETIC_IDLE_FENCE_CHANGED";
  const options = { sealed: true, owner: "synthetic_operator" };
  const idle = {
    datallowconn: false, owner: options.owner, public_connect: false,
    sessions: 0, autovacuum_sessions: 0,
  };
  const autovacuum = { ...idle, sessions: 2, autovacuum_sessions: 2 };
  function fixture(states: (Record<string, unknown> | undefined)[]) {
    let index = 0;
    const query = vi.fn<OperatorSql["query"]>().mockImplementation(async () => {
      const state = states[Math.min(index++, states.length - 1)];
      return { rows: state ? [state] : [] };
    });
    const close = vi.fn<OperatorSql["close"]>().mockImplementation(async () => {
      throw new Error("Idle check must not close the borrowed operator session");
    });
    return { admin: { query, close }, query, close };
  }

  it("admits only exact zero sessions and preserves supplied PID exclusions verbatim", async () => {
    vi.useFakeTimers();
    try {
      const { admin, query, close } = fixture([idle]);
      const exceptPids = [81, 18];
      await requireIdleRecoveryDatabase(admin, database, errorCode, { ...options, exceptPids });
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]?.[1]).toEqual([database, exceptPids]);
      expect(query.mock.calls[0]?.[1]?.[1]).toBe(exceptPids);
      expect(query.mock.calls[0]?.[0]).toContain("pg_stat_activity");
      expect(query.mock.calls[0]?.[0]).toContain("autovacuum worker");
      expect(exceptPids).toEqual([81, 18]);
      expect(vi.getTimerCount()).toBe(0);
      expect(close).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("waits in 250ms steps for exclusively verified autovacuum and still requires zero", async () => {
    vi.useFakeTimers();
    try {
      const { admin, query } = fixture([autovacuum, { ...idle, sessions: 1, autovacuum_sessions: 1 }, idle]);
      let admitted = false;
      const result = requireIdleRecoveryDatabase(admin, database, errorCode, options).then(
        () => { admitted = true; return "admitted"; },
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(249);
      expect(query).toHaveBeenCalledTimes(1);
      expect(admitted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(query).toHaveBeenCalledTimes(2);
      expect(admitted).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      expect(await result).toBe("admitted");
      expect(query).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("fails after at most twenty waits if verified maintenance never drains", async () => {
    vi.useFakeTimers();
    try {
      const { admin, query } = fixture([autovacuum]);
      const rejected = expect(requireIdleRecoveryDatabase(admin, database, errorCode, options)).rejects.toThrow(errorCode);
      await vi.advanceTimersByTimeAsync(4999);
      expect(query).toHaveBeenCalledTimes(20);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(query).toHaveBeenCalledTimes(21);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { ...idle, sessions: 1, autovacuum_sessions: 0 },
    { ...idle, sessions: 2, autovacuum_sessions: 1 },
    { ...idle, sessions: "0", autovacuum_sessions: "0" },
    { ...idle, sessions: -1 },
    { ...idle, sessions: 0.5 },
    { ...idle, autovacuum_sessions: 1 },
    { ...idle, autovacuum_sessions: -1 },
    { ...idle, sessions: Number.NaN },
    { ...idle, autovacuum_sessions: undefined },
    { ...idle, datallowconn: true },
    { ...idle, datallowconn: undefined },
    { ...idle, owner: "changed_operator" },
    { ...idle, owner: undefined },
    { ...idle, public_connect: true },
    { ...idle, public_connect: undefined },
    undefined,
  ].map((state) => ({ state })))("rejects unknown/client sessions or invalid fence state without waiting: %j", async ({ state }) => {
    vi.useFakeTimers();
    try {
      const { admin, query } = fixture([state]);
      await expect(requireIdleRecoveryDatabase(admin, database, errorCode, options)).rejects.toThrow(errorCode);
      expect(query).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { ...autovacuum, datallowconn: true },
    { ...autovacuum, owner: "changed_operator" },
    { ...autovacuum, public_connect: true },
    { ...autovacuum, sessions: 3 },
  ])("rechecks every fence invariant during the maintenance drain: %j", async (changed) => {
    vi.useFakeTimers();
    try {
      const { admin, query } = fixture([autovacuum, changed]);
      const rejected = expect(requireIdleRecoveryDatabase(admin, database, errorCode, options)).rejects.toThrow(errorCode);
      await vi.advanceTimersByTimeAsync(250);
      await rejected;
      expect(query).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("isolated operator cutover endpoint gate", () => {
  it("accepts only explicitly synthetic loopback databases", () => {
    expect(() =>
      assertIsolatedRehearsalIdentity(
        databaseIdentity(
          "postgresql://app:synthetic@127.0.0.1:55432/shbs_recovery_stage_test",
        ),
      ),
    ).not.toThrow();
    for (const url of [
      "postgresql://app:synthetic@production.example.test:5432/shbs_recovery_test",
      "postgresql://app:synthetic@127.0.0.1:5432/shbs_program",
      "postgresql://app:synthetic@127.0.0.1:5432/postgres",
    ])
      expect(() =>
        assertIsolatedRehearsalIdentity(databaseIdentity(url)),
      ).toThrow("CUTOVER_REQUIRES_ISOLATED_TEST_DATABASE");
  });
});

describe("exact synthetic credential notice containment", () => {
  it.each([
    "valid",
    "wrong-context",
    "wrong-recipient",
    "admitted",
    "extra-notice",
  ])("quarantines only positively attributed new mail: %s", async (mode) => {
    const context = {
      emailDetail: { en: "Password changed", zh: "密码已更改" },
    };
    const created: Record<string, unknown> = {
      id: "new-password-notice",
      userId: "actor",
      category: "security",
      event: "security_changed",
      recipient: "actor@example.test",
      context,
      status: "PENDING",
      attempts: 0,
      attemptId: null,
      attemptStartedAt: null,
      leaseUntil: null,
      completedAt: null,
      previousPrimary: false,
      preferenceTopic: null,
      destination: null,
      sourceNotificationId: null,
      requestKind: null,
      monthlyHoursReportId: null,
      schoolHoursReportId: null,
      createdAt: "2026-11-03T00:00:00",
      availableAt: "2026-11-03T00:00:00",
    };
    if (mode === "wrong-context")
      created.context = { changedFields: ["password"] };
    if (mode === "wrong-recipient")
      created.recipient = "unattributed@example.test";
    if (mode === "admitted") created.attemptStartedAt = "2026-11-03T00:00:01";
    let quarantinedIds: unknown;
    const db: OperatorSql = {
      async query(sql, values) {
        if (
          sql ===
          'SELECT id FROM public."EmailDelivery" ORDER BY id LIMIT 10001'
        )
          return { rows: [{ id: "restored-security-notice" }] };
        if (sql.includes('FROM public."AccountEmail"')) {
          expect(values).toEqual(["actor"]);
          expect(sql).toContain(
            "notification_email_context('security_changed'",
          );
          return { rows: [{ email: "actor@example.test", context }] };
        }
        if (sql.startsWith('UPDATE public."User"')) {
          expect(values?.[1]).toBe("actor");
          return { rows: [{ id: "actor" }] };
        }
        if (sql.startsWith("SELECT to_jsonb(d) AS row")) {
          expect(values).toEqual([["restored-security-notice"]]);
          return {
            rows:
              mode === "extra-notice"
                ? [
                    { row: created },
                    { row: { ...created, id: "other-notice" } },
                  ]
                : [{ row: created }],
          };
        }
        if (sql.startsWith('UPDATE public."EmailDelivery" d')) {
          quarantinedIds = values?.[0];
          return {
            rows: [{ row: { ...created, status: "CANCELLED_RECOVERY" } }],
          };
        }
        throw new Error("Unexpected credential containment SQL");
      },
      async close() {
        throw new Error(
          "Credential helper must not close its borrowed transaction",
        );
      },
    };
    if (mode === "valid") {
      expect(
        await setIsolatedAcceptancePassword(
          db,
          "actor",
          "Synthetic-password-trial-493!",
        ),
      ).toEqual({ noticesQuarantined: 1 });
      expect(quarantinedIds).toEqual(["new-password-notice"]);
    } else {
      await expect(
        setIsolatedAcceptancePassword(
          db,
          "actor",
          "Synthetic-password-trial-493!",
        ),
      ).rejects.toThrow("ACCEPTANCE_PASSWORD_MAIL_NOT_ATTRIBUTABLE");
      expect(quarantinedIds).toBeUndefined();
    }
  });
});

describe("acceptance database connection fence", () => {
  it.each(["success", "connect-failure", "probe-failure", "close-failure"])(
    "uses maintenance authority and reseals after %s",
    async (mode) => {
      const database = "shbs_recovery_acceptance_test";
      const user = "acceptance_app";
      let allowed = false;
      let granted = false;
      const calls: string[] = [];
      const app: OperatorSql = {
        async query(sql) {
          // PostgreSQL 22023: disabling connections to the current database
          // must never be attempted through the target/application session.
          if (sql.includes("ALLOW_CONNECTIONS false"))
            throw new Error("22023 current database cannot be disabled");
          calls.push("app-query");
          return { rows: [] };
        },
        async close() {
          calls.push("app-close");
          if (mode === "close-failure") throw new Error("close-failure");
        },
      };
      const maintenance: OperatorSql = {
        async query(sql) {
          calls.push(sql);
          switch (sql) {
            case `GRANT CONNECT ON DATABASE "${database}" TO "${user}"`:
              granted = true;
              break;
            case `ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`:
              allowed = true;
              break;
            case `ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`:
              allowed = false;
              break;
            case `REVOKE CONNECT ON DATABASE "${database}" FROM "${user}"`:
              granted = false;
              break;
            default:
              throw new Error("Unexpected maintenance SQL");
          }
          return { rows: [] };
        },
        async close() {
          throw new Error(
            "Acceptance must not close its borrowed maintenance session",
          );
        },
      };
      const apply = () =>
        withReadOnlyAcceptanceApplication(
          maintenance,
          { database, user },
          "postgresql://acceptance_app:synthetic@localhost/shbs_recovery_acceptance_test",
          {
            async connect() {
              expect(allowed).toBe(true);
              expect(granted).toBe(true);
              calls.push("app-connect");
              if (mode === "connect-failure")
                throw new Error("connect-failure");
              return app;
            },
          },
          async (connection) => {
            expect(allowed).toBe(false);
            await connection.query("SELECT 1");
            if (mode === "probe-failure") throw new Error("probe-failure");
            return "accepted";
          },
        );
      if (mode === "success") {
        expect(await apply()).toBe("accepted");
        // Same-intent resumed work starts from a sealed, privilege-free state.
        expect(allowed).toBe(false);
        expect(granted).toBe(false);
        expect(await apply()).toBe("accepted");
      } else await expect(apply()).rejects.toThrow(mode);
      expect(allowed).toBe(false);
      expect(granted).toBe(false);
      expect(calls.at(-2)).toBe(
        `ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`,
      );
      expect(calls.at(-1)).toBe(
        `REVOKE CONNECT ON DATABASE "${database}" FROM "${user}"`,
      );
    },
  );
});

describe("cutover source maintenance connection", () => {
  it("changes only the database on the validated source endpoint and verifies its identity before use", async () => {
    const source =
      "postgresql://synthetic%2Bowner:p%40ss%3Aword@[::1]:55432/shbs_recovery_source_test?sslmode=verify-full&schema=public";
    const calls: string[] = [];
    const control: OperatorSql = {
      async query(sql) {
        calls.push(sql);
        return {
          rows: [{ database: "postgres", username: "synthetic+owner" }],
        };
      },
      async close() {
        calls.push("close");
      },
    };
    const result = await connectSourceMaintenance(source, {
      async connect(url) {
        const expected = new URL(source);
        expected.pathname = "/postgres";
        expect(url).toBe(expected.toString());
        expect(databaseIdentity(source).database).toBe(
          "shbs_recovery_source_test",
        );
        return control;
      },
    });
    expect(result).toBe(control);
    expect(calls).toEqual([
      "SELECT current_database() AS database,current_user AS username",
    ]);
  });

  it.each([
    { database: "shbs_recovery_source_test", username: "synthetic_owner" },
    { database: "postgres", username: "unexpected_owner" },
  ])(
    "closes a mismatched control connection without any database mutation: %j",
    async (identity) => {
      const calls: string[] = [];
      const control: OperatorSql = {
        async query(sql) {
          calls.push(sql);
          return { rows: [identity] };
        },
        async close() {
          calls.push("close");
        },
      };
      await expect(
        connectSourceMaintenance(
          "postgresql://synthetic_owner:disposable@localhost:55432/shbs_recovery_source_test",
          {
            async connect() {
              return control;
            },
          },
        ),
      ).rejects.toThrow("CUTOVER_SOURCE_MAINTENANCE_ENDPOINT_MISMATCH");
      expect(calls).toEqual([
        "SELECT current_database() AS database,current_user AS username",
        "close",
      ]);
    },
  );

  it("does not retry a failed maintenance connection against the source database", async () => {
    const urls: string[] = [];
    await expect(
      connectSourceMaintenance(
        "postgresql://synthetic_owner:disposable@localhost:55432/shbs_recovery_source_test",
        {
          async connect(url) {
            urls.push(url);
            throw new Error("maintenance unavailable");
          },
        },
      ),
    ).rejects.toThrow("maintenance unavailable");
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).pathname).toBe("/postgres");
  });
});

describe("live isolated acceptance restrictions", () => {
  it("rechecks a newly suspended, retired, voided or credential-challenged identity", () => {
    const account = {
      role: "ADMIN",
      suspendedAt: null,
      mergedIntoId: null,
      recoveryVoidedAt: null,
      twoFactorEnabled: false,
    };
    expect(acceptanceAccountAllowed(account)).toBe(true);
    for (const revoked of [
      { suspendedAt: new Date() },
      { mergedIntoId: "survivor" },
      { recoveryVoidedAt: new Date() },
      { twoFactorEnabled: true },
    ])
      expect(acceptanceAccountAllowed({ ...account, ...revoked })).toBe(false);
  });
  it("rejects revoked participation while preserving independent management access", () => {
    const account = {
      role: "TUTOR",
      tutorStatus: "ACTIVE",
      tutorAccessRevoked: false,
      departurePresent: false,
    };
    expect(acceptanceAccountAllowed(account)).toBe(true);
    expect(
      acceptanceAccountAllowed({ ...account, tutorAccessRevoked: true }),
    ).toBe(false);
    expect(
      acceptanceAccountAllowed({ ...account, departurePresent: true }),
    ).toBe(false);
    expect(
      acceptanceAccountAllowed({ ...account, tutorStatus: "ARCHIVED" }),
    ).toBe(false);
    expect(
      acceptanceAccountAllowed({
        ...account,
        role: "ADMIN",
        tutorAccessRevoked: true,
      }),
    ).toBe(true);
  });
});
