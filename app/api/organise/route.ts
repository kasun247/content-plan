import { NextResponse } from "next/server";
import { cleanDraft } from "@/lib/plan";
import { aiEnabled, askClaude, authorised, buildPrompt } from "@/lib/server";

export const dynamic = "force-dynamic";

type Body = { text?: string; todayLong?: string; todayIso?: string; existing?: string };

export async function POST(req: Request) {
  if (!aiEnabled()) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  if (!authorised(req)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim().slice(0, 5000);
  if (!text) return NextResponse.json({ error: "Note is empty" }, { status: 400 });
  const todayIso = /^\d{4}-\d{2}-\d{2}$/.test(body.todayIso ?? "") ? (body.todayIso as string) : new Date().toISOString().slice(0, 10);
  const todayLong = String(body.todayLong ?? todayIso).slice(0, 80);
  const existing = String(body.existing ?? "").slice(0, 6000);

  try {
    const out = await askClaude(buildPrompt(text, todayLong, todayIso, existing));
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    const parsed = start >= 0 && end > start ? JSON.parse(out.slice(start, end + 1)) : null;
    const items = Array.isArray(parsed?.items) ? parsed.items.map(cleanDraft).filter(Boolean) : [];
    return NextResponse.json({ items });
  } catch (e) {
    console.error("organise failed", e);
    return NextResponse.json({ error: "Organising failed. Try again in a minute." }, { status: 502 });
  }
}
