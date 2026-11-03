import { describe, expect, it } from "vitest";
import {
  acceptanceAccountAllowed,
  assertIsolatedRehearsalIdentity,
} from "./operator-cutover";
import { databaseIdentity } from "./operator-plan";
import {
  connectSourceMaintenance,
  withReadOnlyAcceptanceApplication,
} from "./operator-cutover";
import type { OperatorSql } from "./operator-site";

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
        async close() {},
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
