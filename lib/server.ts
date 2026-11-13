import { CHANNELS, STATUSES, TYPES } from "./plan";

const KEY = "content-plan:v1";

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const passcodeSet = () => Boolean(process.env.APP_PASSCODE);
/** Cloud saving needs both a store and a passcode, so a public URL can't be edited by anyone. */
export const cloudEnabled = () => passcodeSet() && redisEnv() !== null;
export const aiEnabled = () => passcodeSet() && Boolean(process.env.ANTHROPIC_API_KEY);

/** Constant-time-ish comparison of the passcode header. */
export function authorised(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  const got = req.headers.get("x-plan-passcode") ?? "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function readPlan(): Promise<unknown | null> {
  const env = redisEnv();
  if (!env) return null;
  const res = await fetch(`${env.url}/get/${encodeURIComponent(KEY)}`, {
    headers: { Authorization: `Bearer ${env.token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
  const body = (await res.json()) as { result: string | null };
  return body.result ? JSON.parse(body.result) : null;
}

export async function writePlan(plan: unknown): Promise<void> {
  const env = redisEnv();
  if (!env) throw new Error("Storage is not configured");
  const res = await fetch(`${env.url}/set/${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}` },
    body: JSON.stringify(plan),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Storage write failed (${res.status})`);
}

export function buildPrompt(text: string, todayLong: string, todayIso: string, existing: string): string {
  return `You organise rough notes into a content plan for Kasun, a designer in Sri Lanka who publishes free Framer templates (Coming Soon, Axia) and components on the Framer Marketplace and promotes them on X (including a Build in Public community) and Contra.

Today is ${todayLong} (${todayIso}). Weeks start on Monday.

Existing plan items (do not duplicate these):
${existing || "(none yet)"}

NOTE:
"""
${text}
"""

Turn the note into content plan items. Rules:
- One item per distinct piece of content. If one piece goes to several channels, make one item per channel.
- Only include things the note actually asks for. Do not invent extra content.
- title: short and specific, in the note's own words where possible (max ~70 characters).
- date: YYYY-MM-DD. Resolve relative dates ("Monday" = the next Monday on or after today, "next week" = Monday of next week, "end of month" = last day of this month, "tomorrow", etc.). null if no time is given.
- channel: one of ${JSON.stringify(CHANNELS)}. Use "X" for Twitter/X posts. Use "Framer Marketplace" for publishing or updating a listing.
- type: one of ${JSON.stringify(TYPES)}.
- status: one of ${JSON.stringify(STATUSES)}. "Published" if the note says it is already done/posted; "In progress" if being worked on now; "Planned" if it has a date; otherwise "Idea".
- product: the template or component name it is about, or "".
- notes: any extra detail from the note (hooks, links, times, assets needed), or "".

Return only JSON, no prose: {"items":[{"title":"","date":null,"channel":"","type":"","status":"","product":"","notes":""}]}`;
}

export async function askClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}
