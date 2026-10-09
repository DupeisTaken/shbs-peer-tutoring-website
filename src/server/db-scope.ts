import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "../../generated/prisma";
import type { TransactionDb } from "./transactions";

/** Approval replay must include legacy helpers which import the shared db directly.
 * Async-local scope keeps those writes in the decision transaction without crossing requests. */
export const databaseScope = new AsyncLocalStorage<TransactionDb>();
export const approvalScope = new AsyncLocalStorage<string>();

export type AuditActor = { id: string; name: string | null; role: string };
/** Evidence interception is request-local; secrets never become transport input. */
export const auditActorScope = new AsyncLocalStorage<AuditActor>();
export const auditCaptureScope = new AsyncLocalStorage<{
  delegate: (name: string, value: object) => object;
}>();
export const afterCommitScope = new AsyncLocalStorage<{
  effects: Array<() => Promise<void>>; committed: boolean; onFailure: () => Promise<void>;
}>();

/** Return true only when an outer owner will run this effect after its commit. */
export function deferUntilCommit(effect: () => Promise<void>): boolean {
  const queue = afterCommitScope.getStore();
  if (!queue || queue.committed) return false;
  queue.effects.push(effect);
  return true;
}

/** An owned transaction releases effects immediately at commit, so its resolver's
 * existing post-commit delivery code can still report actual transport outcomes. */
export async function flushCommittedEffects() {
  const queue = afterCommitScope.getStore();
  if (!queue || queue.committed) return;
  queue.committed = true;
  for (const effect of queue.effects) {
    try { await effect(); } catch {
      try { await queue.onFailure(); } catch {
        // The primary audit is already durable. Never invite resubmission of its
        // applied write by turning a delivery/diagnostic outage into a write failure.
        console.error("[audit] Could not record delivery failure after committed change.");
      }
    }
  }
  queue.effects.length = 0;
}

/** Internal publication authority is scoped to one already-reviewed immutable draft,
 * one reviewer and one operation. HTTP input cannot create this scope. */
export const translationPublicationScope = new AsyncLocalStorage<{ reviewerId: string; operation: string }>();
export function isTranslationPublication(userId: string, role: string, path: string) {
  const scope = translationPublicationScope.getStore();
  return !!scope && scope.reviewerId === userId && ["HEAD", "ADMIN"].includes(role) &&
    (scope.operation === path || scope.operation.split(".").at(-1) === path);
}

export function scopedDatabase(base: PrismaClient): PrismaClient {
  base = databaseBases.get(base) ?? base;
  const proxy = new Proxy(base, {
    get(target, key) {
      const current = databaseScope.getStore();
      const tx = current ? databaseBases.get(current as PrismaClient) ?? current : undefined;
      if (tx && key === "$transaction") {
        // Existing handlers use both Prisma transaction forms. Compose, never nest.
        return (
          work:
            ((client: TransactionDb) => Promise<unknown>) | Promise<unknown>[],
        ) => {
          if (typeof work === "function") return work(scopedDatabase(tx as PrismaClient));
          return (async () => {
            const results: unknown[] = [];
            for (const statement of work) results.push(await statement);
            return results;
          })();
        };
      }
      const client = tx ?? target;
      const value: unknown = Reflect.get(client, key);
      if (typeof key === "string" && value && typeof value === "object") {
        const capture = auditCaptureScope.getStore();
        if (capture) return capture.delegate(key, value);
      }
      if (!tx && key === "$transaction" && auditCaptureScope.getStore()) {
        // Preserve the transaction owner's options/retry boundary while making its
        // explicitly passed client participate in the same evidence interception.
        return async (work: ((client: TransactionDb) => Promise<unknown>) | Promise<unknown>[], options?: unknown) => {
          const queue = afterCommitScope.getStore();
          const firstEffect = queue?.effects.length ?? 0;
          let result: unknown;
          try { result = await Reflect.apply(Reflect.get(target, key) as (...args: unknown[]) => unknown, target, [
            typeof work === "function" ? (inner: TransactionDb) =>
              databaseScope.run(inner, () => work(scopedDatabase(inner as PrismaClient))) : work,
            options,
          ]); } catch (error) {
            queue?.effects.splice(firstEffect);
            throw error;
          }
          await flushCommittedEffects();
          return result;
        };
      }
      const bound: unknown =
        typeof value === "function" ? value.bind(client) : value;
      return bound;
    },
    has(target, key) {
      const current = databaseScope.getStore();
      if (current && key === "$transaction") return false;
      return Reflect.has(current ? databaseBases.get(current as PrismaClient) ?? current : target, key);
    },
  });
  databaseBases.set(proxy, base);
  return proxy;
}

const databaseBases = new WeakMap<PrismaClient, PrismaClient>();
