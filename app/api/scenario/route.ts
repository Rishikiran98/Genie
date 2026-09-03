import { createJsonHandler } from "@/lib/http";
import { scenarioFromRaw } from "@/lib/simulation/scenario";

export const runtime = "nodejs";

export const POST = createJsonHandler({ route: "scenario", run: scenarioFromRaw });
