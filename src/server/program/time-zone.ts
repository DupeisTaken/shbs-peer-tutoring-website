import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { db } from "~/server/db";
import type { DomainDb } from "~/server/transactions";

/** Read per operation/request so a saved program change takes effect without a server restart.
 * Missing singleton means the original Shanghai behavior; timestamps are never rewritten.
 */
export async function getProgramTimeZone(
  client: DomainDb = db,
): Promise<string> {
  const settings = await client.programSettings.findUnique({
    where: { id: "program" },
  });
  return settings?.timeZone ?? DEFAULT_TIME_ZONE;
}
