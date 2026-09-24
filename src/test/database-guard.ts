/** Destructive fixtures must never inherit a demo/production database from local .env. */
export function assertIsolatedTestDatabase(rawUrl: string | undefined): void {
  let url: URL;
  try {
    url = new URL(rawUrl ?? "");
  } catch {
    throw new Error(
      "Database tests require an explicit local PostgreSQL *_test database.",
    );
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
    throw new Error(
      "Database tests require an explicit local PostgreSQL *_test database.",
    );
  }
}
