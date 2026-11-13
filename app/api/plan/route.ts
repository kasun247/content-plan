import { NextResponse } from "next/server";
import { cleanPlan } from "@/lib/plan";
import { aiEnabled, authorised, cloudEnabled, passcodeSet, readPlan, writePlan } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET → which mode the app runs in, plus the saved plan when cloud saving is on.
 *   { mode: "local", ai }                      no passcode/storage: browser storage
 *   { mode: "locked" }  (401)                  passcode set, header missing or wrong
 *   { mode: "cloud", ai, plan: Plan | null }   signed in
 */
export async function GET(req: Request) {
  if (!passcodeSet()) return NextResponse.json({ mode: "local", ai: false });
  if (!authorised(req)) return NextResponse.json({ mode: "locked" }, { status: 401 });
  if (!cloudEnabled()) return NextResponse.json({ mode: "local", ai: aiEnabled() });
  try {
    const plan = cleanPlan(await readPlan());
    return NextResponse.json({ mode: "cloud", ai: aiEnabled(), plan });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  if (!cloudEnabled()) return NextResponse.json({ error: "Cloud saving is not set up" }, { status: 400 });
  if (!authorised(req)) return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 900_000) return NextResponse.json({ error: "Plan is too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const plan = cleanPlan(parsed);
  if (!plan) return NextResponse.json({ error: "Body must be { items, notes }" }, { status: 400 });
  try {
    await writePlan(plan);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
