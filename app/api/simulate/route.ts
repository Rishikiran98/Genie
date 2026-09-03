import { createJsonHandler } from "@/lib/http";
import { simulateFromRaw } from "@/lib/simulation/engine";

export const runtime = "nodejs";

export const POST = createJsonHandler({ route: "simulate", run: simulateFromRaw });
