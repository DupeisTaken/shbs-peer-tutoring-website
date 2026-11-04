import { describe, expect, it, vi } from "vitest";

import {
  assertFeatureEnabled,
  DEFAULT_FEATURES,
  getFeatures,
  type FeatureKey,
} from "./features";

/** Exercise effective flags without touching a developer's saved program settings. */
function featureDb(
  rows: { key: FeatureKey; enabled: boolean; pendingEnabled?: boolean | null }[],
) {
  return {
    programFeature: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as Parameters<typeof getFeatures>[0];
}

describe("program feature defaults", () => {
  it("enables automatic rooms when no setting has been saved", async () => {
    expect((await getFeatures(featureDb([]))).AUTO_ASSIGN_ROOMS).toBe(true);
    await expect(
      assertFeatureEnabled(featureDb([]), "AUTO_ASSIGN_ROOMS"),
    ).resolves.toBeUndefined();
  });

  it.each([
    { enabled: true, pendingEnabled: null },
    { enabled: false, pendingEnabled: null },
    { enabled: true, pendingEnabled: false },
    { enabled: false, pendingEnabled: true },
  ])(
    "preserves saved room automation $enabled with pending $pendingEnabled",
    async (row) => {
      const db = featureDb([{ key: "AUTO_ASSIGN_ROOMS", ...row }]);
      expect((await getFeatures(db)).AUTO_ASSIGN_ROOMS).toBe(row.enabled);
      if (!row.enabled) {
        await expect(
          assertFeatureEnabled(db, "AUTO_ASSIGN_ROOMS"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    },
  );

  it("makes all modules, including email 2FA, available by default", async () => {
    expect(Object.values(DEFAULT_FEATURES).every(Boolean)).toBe(true);
    expect(await getFeatures(featureDb([]))).toEqual(DEFAULT_FEATURES);
  });

  it("allows email 2FA procedures without a saved feature row", async () => {
    await expect(
      assertFeatureEnabled(featureDb([]), "EMAIL_2FA"),
    ).resolves.toBeUndefined();
  });

  it("preserves an explicitly disabled email 2FA feature", async () => {
    const db = featureDb([{ key: "EMAIL_2FA", enabled: false }]);
    expect((await getFeatures(db)).EMAIL_2FA).toBe(false);
    await expect(assertFeatureEnabled(db, "EMAIL_2FA")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("does not apply a staged disable before program refresh", async () => {
    const db = featureDb([
      { key: "EMAIL_2FA", enabled: true, pendingEnabled: false },
    ]);
    expect((await getFeatures(db)).EMAIL_2FA).toBe(true);
  });

  it("does not override a saved disable with a staged enable or the new default", async () => {
    const db = featureDb([
      { key: "EMAIL_2FA", enabled: false, pendingEnabled: true },
    ]);
    expect((await getFeatures(db)).EMAIL_2FA).toBe(false);
  });
});
