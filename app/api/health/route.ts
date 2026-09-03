import { NextResponse } from "next/server";
import { readLlmConfig } from "@/lib/simulation/provider";
import { storeBackend } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + configuration check. Reports what is configured, never the
 * values, and makes no upstream calls so it is safe to poll.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    llmConfigured: readLlmConfig() !== null,
    store: storeBackend(),
  });
}
