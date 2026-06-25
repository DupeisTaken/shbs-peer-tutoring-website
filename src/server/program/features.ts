/**
 * Optional program modules a HEAD can switch off to fit a different program. Effective flags come
 * from the `ProgramFeature` table; a missing row defaults to ON (a fresh deployment has everything
 * enabled). Changes a HEAD makes are *staged* (`pendingEnabled`) and applied at the next program
 * refresh — see `applyPendingFeatures`. Node runtime only (touches the DB).
 *
 * QUARTER_SYSTEM is a mode, not a disable: enabled = quarters (Q1–Q4), disabled = semesters
 * (S1/S2). Everything else, when disabled, hides its portals/nav/cards and blocks its procedures.
 */
import type { PrismaClient } from "../../../generated/prisma";

type Db = Pick<PrismaClient, "programFeature">;

export const FEATURE_KEYS = [
  "CREW",
  "DISCIPLINE",
  "MEETINGS",
  "INTERVIEWS",
  "SERVICE_HOURS",
  "QUARTER_SYSTEM",
  "OBSERVER_SIGNUP",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** All modules on — the default for an unconfigured deployment. */
export const DEFAULT_FEATURES: Features = Object.fromEntries(
  FEATURE_KEYS.map((k) => [k, true]),
) as Features;

/** Effective on/off for every module (missing row = on). */
export async function getFeatures(db: Db): Promise<Features> {
  const rows = await db.programFeature.findMany({ select: { key: true, enabled: true } });
  const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, byKey.get(k) ?? true])) as Features;
}

/**
 * Apply any staged feature changes (pendingEnabled -> enabled) and clear them. Called from the
 * program refresh so toggles take effect at the period boundary. Returns the keys that changed.
 */
export async function applyPendingFeatures(
  db: Pick<PrismaClient, "programFeature">,
): Promise<FeatureKey[]> {
  const pending = await db.programFeature.findMany({
    where: { pendingEnabled: { not: null } },
    select: { key: true, pendingEnabled: true },
  });
  const changed: FeatureKey[] = [];
  for (const row of pending) {
    if (row.pendingEnabled == null) continue;
    await db.programFeature.update({
      where: { key: row.key },
      data: { enabled: row.pendingEnabled, pendingEnabled: null },
    });
    changed.push(row.key);
  }
  return changed;
}
