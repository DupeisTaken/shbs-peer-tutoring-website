/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * Suited to the single-VPS / single-container deployment (no external store needed). It is
 * per-process: counts reset on restart and aren't shared across replicas — fine here, but swap
 * for a Redis-backed limiter if the app is ever scaled horizontally. Node runtime only.
 */

interface Entry {
  /** Hit timestamps (ms) within the active window, oldest first. */
  hits: number[];
}

const globalForRateLimit = globalThis as unknown as {
  rateLimitStore?: Map<string, Entry>;
  rateLimitLastSweep?: number;
};
const store = (globalForRateLimit.rateLimitStore ??= new Map<string, Entry>());

/** Drop keys with no recent hits so the map can't grow unbounded across many distinct keys. */
const SWEEP_INTERVAL_MS = 5 * 60_000;
const SWEEP_TTL_MS = 60 * 60_000;
function maybeSweep(now: number): void {
  if (now - (globalForRateLimit.rateLimitLastSweep ?? 0) < SWEEP_INTERVAL_MS) return;
  globalForRateLimit.rateLimitLastSweep = now;
  const cutoff = now - SWEEP_TTL_MS;
  for (const [key, entry] of store) {
    const last = entry.hits[entry.hits.length - 1];
    if (last === undefined || last < cutoff) store.delete(key);
  }
}

export interface RateLimitOptions {
  /** Max allowed hits within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** True if this hit is within the limit (and has been counted). */
  ok: boolean;
  /** Hits remaining in the current window after this call. */
  remaining: number;
  /** When blocked, ms until the oldest hit ages out and a retry could succeed. */
  retryAfterMs: number;
}

/**
 * Record a hit for `key` and report whether it's within `max` per `windowMs`. A blocked hit is
 * NOT counted, so a caller hammering the endpoint can't push its own retry window forward.
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  const windowStart = now - opts.windowMs;
  const entry = store.get(key);
  const hits = (entry?.hits ?? []).filter((t) => t > windowStart);

  if (hits.length >= opts.max) {
    store.set(key, { hits });
    const retryAfterMs = Math.max(0, hits[0]! + opts.windowMs - now);
    return { ok: false, remaining: 0, retryAfterMs };
  }

  hits.push(now);
  store.set(key, { hits });
  return { ok: true, remaining: opts.max - hits.length, retryAfterMs: 0 };
}
