import { types, type Client } from "pg";

/**
 * Prisma treats our timestamp-without-time-zone columns as UTC. PostgreSQL must
 * use the same zone for defaults, triggers and mixed timestamp comparisons.
 * Startup options apply before the first query on every pooled connection;
 * appending UTC also overrides a conflicting option in the supplied URL.
 * Keep this module independent of Next/env so CLI utilities share the policy.
 */
export function utcDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  const options = url.searchParams.get("options");
  url.searchParams.set(
    "options",
    [options, "-c timezone=UTC"].filter(Boolean).join(" "),
  );
  return url.toString();
}

/** Keep UTC-naive database values independent of the operator host's time zone. */
export function configureUtcPgTimestamps(
  client: Pick<Client, "setTypeParser">,
): void {
  const parseWithZone = types.getTypeParser(
    types.builtins.TIMESTAMPTZ,
    "text",
  ) as (value: string) => Date | number | null;
  // Use the driver's offset-aware parser, including its infinity/BC handling.
  // setTypeParser belongs to this client; shared/global parsers stay untouched.
  client.setTypeParser(types.builtins.TIMESTAMP, "text", (value) =>
    parseWithZone(
      /^-?infinity$/i.test(value) ? value : value.replace(/( BC)?$/, "+00$1"),
    ),
  );
}
