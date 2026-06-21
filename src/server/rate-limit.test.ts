import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to max hits, then blocks", () => {
    const opts = { max: 3, windowMs: 1000 };
    expect(rateLimit("a", opts).ok).toBe(true);
    expect(rateLimit("a", opts).ok).toBe(true);
    expect(rateLimit("a", opts).ok).toBe(true);
    const blocked = rateLimit("a", opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("recovers once the window passes", () => {
    const opts = { max: 2, windowMs: 1000 };
    rateLimit("b", opts);
    rateLimit("b", opts);
    expect(rateLimit("b", opts).ok).toBe(false);
    vi.setSystemTime(1001);
    expect(rateLimit("b", opts).ok).toBe(true);
  });

  it("does not count blocked hits (they can't push the window forward)", () => {
    const opts = { max: 1, windowMs: 1000 };
    expect(rateLimit("c", opts).ok).toBe(true); // counted at t=0
    vi.setSystemTime(500);
    expect(rateLimit("c", opts).ok).toBe(false); // blocked, not counted
    vi.setSystemTime(1001); // the t=0 hit has aged out
    expect(rateLimit("c", opts).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const opts = { max: 1, windowMs: 1000 };
    expect(rateLimit("k1", opts).ok).toBe(true);
    expect(rateLimit("k2", opts).ok).toBe(true);
    expect(rateLimit("k1", opts).ok).toBe(false);
  });
});
