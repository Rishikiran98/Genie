import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createJsonHandler, hashIp, readBodyWithLimit } from "./http";
import { createRateLimiter } from "./ratelimit";

const req = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
  new Request("http://genie.test/x", { method: "POST", headers, body });

describe("readBodyWithLimit", () => {
  it("returns the text when under the cap", async () => {
    const r = await readBodyWithLimit(req("hello"), 10);
    expect(r).toEqual({ ok: true, text: "hello" });
  });

  it("rejects when the streamed body exceeds the cap", async () => {
    const r = await readBodyWithLimit(req("x".repeat(11)), 10);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects on an oversized declared Content-Length", async () => {
    const r = await readBodyWithLimit(req("hi", { "content-length": "999" }), 10);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("measures bytes, not characters", async () => {
    // 4 characters, 8 bytes in UTF-8.
    const r = await readBodyWithLimit(req("ééé é"), 6);
    expect(r.ok).toBe(false);
  });

  it("treats a missing body as empty text", async () => {
    const r = await readBodyWithLimit(new Request("http://genie.test/x", { method: "POST" }));
    expect(r).toEqual({ ok: true, text: "" });
  });
});

describe("hashIp", () => {
  it("is stable for a salt, differs across salts, and never contains the address", () => {
    const a = hashIp("203.0.113.9", "s1");
    expect(a).toBe(hashIp("203.0.113.9", "s1"));
    expect(a).not.toBe(hashIp("203.0.113.9", "s2"));
    expect(a).not.toContain("203");
    expect(a).toHaveLength(16);
  });
});

describe("createJsonHandler", () => {
  const schema = z.object({ n: z.number() });
  const handler = (limit = 100) =>
    createJsonHandler({
      route: "test",
      run: async (body) => {
        const { n } = schema.parse(body);
        if (n === 13) throw new Error("unlucky");
        return { doubled: n * 2 };
      },
      limiter: createRateLimiter({ limit, now: () => 0 }),
      maxBodyBytes: 64,
    });

  it("maps ZodError to 400 with issues", async () => {
    const res = await handler()(req(JSON.stringify({ n: "no" })));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.error).toBeTruthy();
  });

  it("maps unexpected errors to 500 without leaking details", async () => {
    const res = await handler()(req(JSON.stringify({ n: 13 })));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("unlucky");
  });

  it("returns the run result on success", async () => {
    const res = await handler()(req(JSON.stringify({ n: 4 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doubled: 8 });
  });

  it("uses the injected limiter", async () => {
    const h = handler(1);
    expect((await h(req("{\"n\":1}"))).status).toBe(200);
    expect((await h(req("{\"n\":1}"))).status).toBe(429);
  });
});
