import { type db as DbClient } from "~/server/db";
import { DEFAULT_LAYOUT, LANDING_OWNER, layoutSchema, type Block } from "~/lib/page-blocks";

/**
 * Server loader for the landing-page block layout. The block schema, types, and pure helpers live in
 * the client-safe `~/lib/page-blocks` (re-exported here for server callers); only the DB read lives
 * here so the in-browser editor never imports `~/server`.
 */
export * from "~/lib/page-blocks";

/** A container's block layout (`fallback` when unconfigured or the stored JSON is invalid). */
export async function getLayout(
  db: typeof DbClient,
  ownerKey: string,
  fallback: Block[] = [],
): Promise<Block[]> {
  const row = await db.pageLayout.findUnique({ where: { ownerKey }, select: { blocks: true } });
  if (!row) return fallback;
  const parsed = layoutSchema.safeParse(row.blocks);
  return parsed.success ? parsed.data : fallback;
}

/** The landing page's block layout; DEFAULT_LAYOUT when unconfigured (today's page). */
export function getLandingLayout(db: typeof DbClient): Promise<Block[]> {
  return getLayout(db, LANDING_OWNER, DEFAULT_LAYOUT);
}
