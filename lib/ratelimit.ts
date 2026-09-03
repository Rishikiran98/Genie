/**
 * Fixed-window rate limiting.
 *
 * The limiter is keyed by an opaque string (the routes use `route:ip`) and
 * counts requests inside a fixed window. Time is injected via `now()` so the
 * window logic is unit-testable without fake timers.
 *
 * Deployment caveat: state lives in process memory, so on serverless or
 * multi-instance hosting every instance keeps its own counters and the
 * effective limit is `limit × instances`. That is good enough to blunt abuse
 * of the LLM proxy but is not a hard global cap. The `RateLimiter` interface
 * is intentionally async and backend-agnostic so a shared implementation
 * (Redis / Upstash) can be dropped in later without touching the routes.
 */

/** Default: 10 requests per minute per IP per route. */
export const DEFAULT_RATE_LIMIT = 10;
export const DEFAULT_WINDOW_MS = 60_000;

export interface RateLimitResult {
  /** Whether this request is inside the limit. */
  allowed: boolean;
  /** Requests still available in the current window (0 when blocked). */
  remaining: number;
  /** Whole seconds until the window resets — the value for `Retry-After`. */
  retryAfterSeconds: number;
}

/** Backend-agnostic contract; the in-memory version below is the only one today. */
export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface RateLimiterOptions {
  /** Max requests per window. `0` (or less) disables limiting entirely. */
  limit?: number;
  windowMs?: number;
  /** Clock in ms; injected for tests. */
  now?: () => number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

/** Keep memory bounded: sweep expired buckets once the map grows past this. */
const SWEEP_THRESHOLD = 10_000;

/** Creates an in-memory fixed-window limiter. */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? DEFAULT_RATE_LIMIT;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function sweep(current: number): void {
    if (buckets.size < SWEEP_THRESHOLD) return;
    for (const [key, bucket] of buckets) {
      if (current - bucket.windowStart >= windowMs) buckets.delete(key);
    }
  }

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };

      const current = now();
      sweep(current);

      let bucket = buckets.get(key);
      if (!bucket || current - bucket.windowStart >= windowMs) {
        bucket = { windowStart: current, count: 0 };
        buckets.set(key, bucket);
      }

      const resetInMs = bucket.windowStart + windowMs - current;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetInMs / 1000));

      if (bucket.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      bucket.count += 1;
      return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds };
    },
  };
}

/**
 * Reads the per-route limit from `GENIE_RATE_LIMIT` (requests per minute).
 * Falls back to the default on missing or unparseable values; `0` disables.
 */
export function readRateLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GENIE_RATE_LIMIT?.trim();
  if (!raw) return DEFAULT_RATE_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_RATE_LIMIT;
}

/**
 * Best-effort client address: first hop of `x-forwarded-for`, then
 * `x-real-ip`, else "unknown". Only trustworthy behind a proxy that overwrites
 * these headers (Vercel, most load balancers) — a direct client can spoof them.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

let shared: RateLimiter | null = null;

/** The process-wide limiter used by the API routes (reads env once). */
export function getRateLimiter(): RateLimiter {
  if (!shared) shared = createRateLimiter({ limit: readRateLimit() });
  return shared;
}
