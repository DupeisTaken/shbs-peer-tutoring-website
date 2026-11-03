import { db } from "~/server/db";
import type { DomainDb } from "~/server/transactions";
import { getProgramTimeZone as readProgramTimeZone } from "./time-zone-reader";

/** Web convenience wrapper; database-injected callers use time-zone-reader. */
export function getProgramTimeZone(client: DomainDb = db): Promise<string> {
  return readProgramTimeZone(client);
}
