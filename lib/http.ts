import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log, serializeError } from "./log";
import { clientIp, getRateLimiter, type RateLimiter } from "./ratelimit";

/**
 * Shared plumbing for Genie's JSON API routes. Every POST route runs the same
 * pipeline — rate limit → body-size guard → JSON parse → validate + run →
 * error mapping — so it lives here and the route files stay one-liners.
 */

/** Largest request body the routes accept, in bytes (32 KB). */
export const MAX_BODY_BYTES = 32 * 1024;

/**
 * Salt for IP hashing. `GENIE_IP_HASH_SALT` keeps hashes stable across
 * instances and restarts (so one client can be correlated); without it a
 * random per-process salt is used and hashes are only stable within one
 * process. Either way the raw address never reaches the logs.
 */
const IP_HASH_SALT = process.env.GENIE_IP_HASH_SALT?.trim() || randomBytes(16).toString("hex");

/** Short, salted SHA-256 of a client address — safe to log and to group by. */
export function hashIp(ip: string, salt: string = IP_HASH_SALT): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

export type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" };

/**
 * Reads a request body as text while enforcing a byte cap. Rejects early on a
 * declared `Content-Length` over the cap and otherwise streams the body,
 * cancelling as soon as the cap is exceeded so an oversized payload is never
 * buffered in full or handed to `JSON.parse`.
 */
export async function readBodyWithLimit(request: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(joined) };
}

export interface JsonHandlerOptions<T> {
  /** Route name; used for the rate-limit key. */
  route: string;
  /** Validates the parsed body and produces the response payload. Throw `ZodError` for a 400. */
  run: (body: unknown) => Promise<T>;
  /** Defaults to the process-wide limiter. Injected in tests. */
  limiter?: RateLimiter;
  maxBodyBytes?: number;
}

/**
 * Builds a Next.js route handler that applies the abuse guards and maps
 * errors to HTTP statuses:
 *
 *   429 — rate limit exceeded (with `Retry-After`)
 *   413 — body over `maxBodyBytes`
 *   400 — malformed JSON, or `ZodError` from `run` (with `issues`)
 *   500 — anything else
 */
export function createJsonHandler<T>(options: JsonHandlerOptions<T>): (request: Request) => Promise<Response> {
  const { route, run, maxBodyBytes = MAX_BODY_BYTES } = options;

  return async function handler(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const ip = clientIp(request);
    const ipHash = hashIp(ip);
    log.info("request.received", { route, ipHash });

    const respond = (status: number, payload: unknown, headers?: HeadersInit, reason?: string): Response => {
      log.info("request.completed", { route, ipHash, status, durationMs: Date.now() - startedAt, reason });
      return NextResponse.json(payload, { status, headers });
    };

    const limiter = options.limiter ?? getRateLimiter();
    const verdict = await limiter.check(`${route}:${ip}`);
    if (!verdict.allowed) {
      log.warn("ratelimit.exceeded", { route, ipHash, retryAfterSeconds: verdict.retryAfterSeconds });
      return respond(
        429,
        { error: `Too many requests. Try again in ${verdict.retryAfterSeconds}s.` },
        { "Retry-After": String(verdict.retryAfterSeconds) },
        "rate_limited",
      );
    }

    const read = await readBodyWithLimit(request, maxBodyBytes);
    if (!read.ok) {
      return respond(
        413,
        { error: `Request body is too large (limit ${Math.floor(maxBodyBytes / 1024)} KB).` },
        undefined,
        "body_too_large",
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return respond(400, { error: "Request body must be valid JSON." }, undefined, "invalid_json");
    }

    try {
      const result = await run(body);
      return respond(200, result);
    } catch (err) {
      if (err instanceof ZodError) {
        return respond(
          400,
          { error: err.issues[0]?.message ?? "Invalid input.", issues: err.issues },
          undefined,
          "validation_failed",
        );
      }
      log.error("request.failed", { route, ipHash, ...serializeError(err) });
      return respond(500, { error: "Genie hit an unexpected error. Please try again." }, undefined, "unexpected");
    }
  };
}
