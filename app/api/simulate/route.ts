import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { simulateFromRaw } from "@/lib/simulation/engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = await simulateFromRaw(body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid input.", issues: err.issues },
        { status: 400 },
      );
    }
    console.error("Unexpected simulation error:", err);
    return NextResponse.json({ error: "Genie hit an unexpected error. Please try again." }, { status: 500 });
  }
}
