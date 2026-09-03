import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, readRateLimit } from "./ratelimit";

/** A controllable clock so window behaviour is deterministic. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the limit and then blocks", async () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });

    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    const third = await limiter.check("a");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = await limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates counters per key", async () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect((await limiter.check("ip-1")).allowed).toBe(true);
    expect((await limiter.check("ip-1")).allowed).toBe(false);
    expect((await limiter.check("ip-2")).allowed).toBe(true);
  });

  it("resets when the window rolls over", async () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(false);

    c.advance(999);
    expect((await limiter.check("a")).allowed).toBe(false);

    c.advance(1);
    expect((await limiter.check("a")).allowed).toBe(true);
  });

  it("reports retry-after as whole seconds until the window ends", async () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    await limiter.check("a");
    c.advance(30_500);
    const blocked = await limiter.check("a");
    expect(blocked.allowed).toBe(false);
    // 29.5s left → rounds up to 30.
    expect(blocked.retryAfterSeconds).toBe(30);
  });

  it("disables limiting when limit is 0", async () => {
    const limiter = createRateLimiter({ limit: 0, now: () => 0 });
    for (let i = 0; i < 50; i++) expect((await limiter.check("a")).allowed).toBe(true);
  });

  it("does not grow without bound across many keys", async () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    for (let i = 0; i < 10_001; i++) await limiter.check(`k${i}`);
    c.advance(1000);
    // A sweep runs on this call; the old keys are all expired and get dropped,
    // so a previously-blocked key is allowed again.
    expect((await limiter.check("k0")).allowed).toBe(true);
  });
});

describe("readRateLimit", () => {
  it("defaults to 10 and parses overrides", () => {
    expect(readRateLimit({})).toBe(10);
    expect(readRateLimit({ GENIE_RATE_LIMIT: "25" })).toBe(25);
    expect(readRateLimit({ GENIE_RATE_LIMIT: "0" })).toBe(0);
    expect(readRateLimit({ GENIE_RATE_LIMIT: "lots" })).toBe(10);
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" } });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip and then 'unknown'", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
