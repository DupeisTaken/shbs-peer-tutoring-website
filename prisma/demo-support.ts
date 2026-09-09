import { createHash } from "node:crypto";

/** Stable CUID-shaped fixture keys satisfy the same validators as real records.
 * Human-readable labels stay in the seed source; production IDs are never rewritten. */
export function seedId(label: string): string {
  return `c${createHash("sha256").update(`shbs-demo:${label}`).digest("hex").slice(0, 24)}`;
}

/** Demo seeding rewrites example accounts and must fail closed outside an explicitly
 * acknowledged, loopback-only disposable database. No production escape hatch. */
export function assertDemoDatabase(
  connectionString: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    environment.NODE_ENV === "production" ||
    environment.SHBS_DEMO_SEED !== "1" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    [...url.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "port", "dbname", "service"].includes(
        key.toLowerCase(),
      ),
    ) ||
    !/^shbs_(?:[a-z0-9]+_)*(?:demo|test)$/.test(database)
  ) {
    throw new Error(
      "Demo seed requires SHBS_DEMO_SEED=1, a local shbs_*_demo or shbs_*_test database, and a non-production environment. Create a fresh disposable database; never point this command at real program data.",
    );
  }
}
