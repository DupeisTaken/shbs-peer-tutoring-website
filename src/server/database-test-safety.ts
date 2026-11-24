export const TEST_DATABASE_GUARD_ERROR =
  "Database tests require an explicit local PostgreSQL *_test database.";

/** Test connections must never inherit a demo/production target from local .env.
 * Keep this independent of test helpers so the real database client and fixture
 * hooks enforce one exact loopback *_test policy before any write or cleanup. */
export function assertIsolatedTestDatabase(rawUrl: string | undefined): void {
  let url: URL;
  try {
    url = new URL(rawUrl ?? "");
  } catch {
    throw new Error(TEST_DATABASE_GUARD_ERROR);
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    // PostgreSQL drivers can honor query targets ahead of the visible URL host/port.
    [...url.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "port", "dbname", "database", "service"].includes(
        key.toLowerCase(),
      ),
    ) ||
    !/^\/[a-zA-Z0-9_-]+_test$/.test(url.pathname)
  ) {
    throw new Error(TEST_DATABASE_GUARD_ERROR);
  }
}
