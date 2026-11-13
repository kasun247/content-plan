import { NextResponse } from "next/server";
import { cleanPlan } from "@/lib/plan";
import { sessionEmail } from "@/lib/auth";
import { aiEnabled, authMethod, authorised, cloudEnabled, readPlan, writePlan } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * GET → which mode the app runs in, plus the saved plan when cloud saving is on.
 *   { mode: "local", ai }                      no passcode/storage: browser storage
 *   { mode: "locked", auth }  (401)            not signed in (auth: "google" | "passcode")
 *   { mode: "cloud", ai, plan: Plan | null }   signed in
 * Signed-in responses also carry `auth` and, for Google, the signed-in `email`.
 */
export async function GET(req: Request) {
  const auth = authMethod();
  if (!auth) return NextResponse.json({ mode: "local", ai: false, auth });
  if (!authorised(req)) return NextResponse.json({ mode: "locked", auth }, { status: 401 });
  const who = { auth, email: auth === "google" ? sessionEmail(req) : null };
  if (!cloudEnabled()) return NextResponse.json({ mode: "local", ai: aiEnabled(), ...who });
  try {
    const plan = cleanPlan(await readPlan());
    return NextResponse.json({ mode: "cloud", ai: aiEnabled(), plan, ...who });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  if (!cloudEnabled()) return NextResponse.json({ error: "Cloud saving is not set up" }, { status: 400 });
  if (!authorised(req)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
