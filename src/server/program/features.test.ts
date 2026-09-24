import { describe, expect, it, vi } from "vitest";

import {
  assertFeatureEnabled,
  DEFAULT_FEATURES,
  getFeatures,
} from "./features";

/** Exercise effective flags without touching a developer's saved program settings. */
function featureDb(
  rows: { key: "EMAIL_2FA"; enabled: boolean; pendingEnabled?: boolean }[],
) {
  return {
    programFeature: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as Parameters<typeof getFeatures>[0];
}

describe("program feature defaults", () => {
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
