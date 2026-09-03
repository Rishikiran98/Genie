import { createJsonHandler } from "@/lib/http";
import { actionPlanFromRaw } from "@/lib/simulation/actionplan";

export const runtime = "nodejs";

export const POST = createJsonHandler({ route: "actionplan", run: actionPlanFromRaw });
