import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "../../generated/prisma";
import type { TransactionDb } from "./transactions";

/** Approval replay must include legacy helpers which import the shared db directly.
 * Async-local scope keeps those writes in the decision transaction without crossing requests. */
export const databaseScope = new AsyncLocalStorage<TransactionDb>();
export const approvalScope = new AsyncLocalStorage<string>();

export function scopedDatabase(base: PrismaClient): PrismaClient {
  return new Proxy(base, {
    get(target, key) {
      const tx = databaseScope.getStore();
      if (tx && key === "$transaction") {
        // Existing handlers use both Prisma transaction forms. Compose, never nest.
        return (
          work:
            ((client: TransactionDb) => Promise<unknown>) | Promise<unknown>[],
        ) => (typeof work === "function" ? work(tx) : Promise.all(work));
      }
      const client = tx ?? target;
      const value: unknown = Reflect.get(client, key);
      const bound: unknown =
        typeof value === "function" ? value.bind(client) : value;
      return bound;
    },
    has(target, key) {
      if (databaseScope.getStore() && key === "$transaction") return false;
      return Reflect.has(databaseScope.getStore() ?? target, key);
    },
  });
}
