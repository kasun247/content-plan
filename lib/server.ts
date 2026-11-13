import { googleEnabled, sameOrigin, sessionEmail } from "./auth";
import { CHANNELS, STATUSES, TYPES } from "./plan";

const KEY = "content-plan:v1";

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const passcodeSet = () => Boolean(process.env.APP_PASSCODE);

/** How the app is locked: Google sign-in when configured, else the passcode, else not at all (browser-only mode). */
export const authMethod = (): "google" | "passcode" | null =>
  googleEnabled() ? "google" : passcodeSet() ? "passcode" : null;

/** Cloud saving needs both a store and a lock, so a public URL can't be edited by anyone. */
export const cloudEnabled = () => authMethod() !== null && redisEnv() !== null;
export const aiEnabled = () => authMethod() !== null && Boolean(process.env.ANTHROPIC_API_KEY);

function passcodeOk(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  const got = req.headers.get("x-plan-passcode") ?? "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ---------- wrong-passcode lockout ---------- */

export const MAX_FAILS = 10;
const FAIL_WINDOW_S = 15 * 60;
const memFails = new Map<string, { n: number; until: number }>(); // fallback when Redis isn't set up

function clientIp(req: Request): string {
  return (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}

async function redisCmd(path: string): Promise<unknown> {
  const env = redisEnv();
  if (!env) return null;
  const res = await fetch(`${env.url}/${path}`, { headers: { Authorization: `Bearer ${env.token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Storage error (${res.status})`);
  return ((await res.json()) as { result: unknown }).result;
}

async function failCount(ip: string): Promise<number> {
  if (redisEnv()) return Number(await redisCmd(`get/${encodeURIComponent(`content-plan:fail:${ip}`)}`)) || 0;
  const m = memFails.get(ip);
  return m && m.until > Date.now() ? m.n : 0;
}

async function recordFail(ip: string): Promise<void> {
  if (redisEnv()) {
    const key = encodeURIComponent(`content-plan:fail:${ip}`);
    const n = Number(await redisCmd(`incr/${key}`));
    if (n === 1) await redisCmd(`expire/${key}/${FAIL_WINDOW_S}`);
    return;
  }
  const m = memFails.get(ip);
  memFails.set(ip, m && m.until > Date.now() ? { n: m.n + 1, until: m.until } : { n: 1, until: Date.now() + FAIL_WINDOW_S * 1000 });
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 429; error: string };

/**
 * Signed in (Google session cookie) or the right passcode. After MAX_FAILS wrong passcodes from one IP
 * in 15 minutes, that IP gets 429 until the window passes, even with the right passcode.
 */
export async function authorise(req: Request): Promise<AuthResult> {
  const method = authMethod();
  const no: AuthResult = { ok: false, status: 401, error: "Not signed in" };
  if (method === "google") return sessionEmail(req) !== null && (req.method === "GET" || sameOrigin(req)) ? { ok: true } : no;
  if (method !== "passcode") return no;

  const ip = clientIp(req);
  const limited: AuthResult = { ok: false, status: 429, error: "Too many wrong passcodes. Try again in 15 minutes." };
  try {
    if ((await failCount(ip)) >= MAX_FAILS) return limited;
    if (passcodeOk(req)) return { ok: true };
    if (req.headers.get("x-plan-passcode")) await recordFail(ip);
  } catch (e) {
    console.error("passcode check failed", e);
    return { ok: false, status: 401, error: "Couldn't check the passcode. Try again." };
  }
  return no;
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

/* ---------- images: one Redis key per image, value "<media type>;<base64>" ---------- */

const imgKey = (id: string) => `content-plan:img:${id}`;

export async function readImage(id: string): Promise<{ type: string; bytes: Buffer } | null> {
  const env = redisEnv();
  if (!env) return null;
  const res = await fetch(`${env.url}/get/${encodeURIComponent(imgKey(id))}`, {
    headers: { Authorization: `Bearer ${env.token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
  const { result } = (await res.json()) as { result: string | null };
  if (!result) return null;
  const i = result.indexOf(";");
  return { type: result.slice(0, i), bytes: Buffer.from(result.slice(i + 1), "base64") };
}

export async function writeImage(id: string, type: string, bytes: Buffer): Promise<void> {
  const env = redisEnv();
  if (!env) throw new Error("Storage is not configured");
  const res = await fetch(`${env.url}/set/${encodeURIComponent(imgKey(id))}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}` },
    body: `${type};${bytes.toString("base64")}`,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Storage write failed (${res.status})`);
}

export function buildPrompt(text: string, todayLong: string, todayIso: string, existing: string, imageCount = 0): string {
  return `You organise rough notes into a content plan for Kasun, a designer in Sri Lanka who publishes free Framer templates (Coming Soon, Axia) and components on the Framer Marketplace and promotes them on X (including a Build in Public community) and Contra.

Today is ${todayLong} (${todayIso}). Weeks start on Monday.

Existing plan items (do not duplicate these):
${existing || "(none yet)"}

NOTE:
"""
${text || "(no text, only images)"}
"""
${
  imageCount
    ? `\nThe note comes with ${imageCount} attached image${imageCount > 1 ? "s" : ""} (above). They may be screenshots of drafts, lists, chats or calendars that contain the content ideas and dates, or the graphic a post will use. Read them and use what they show together with the text. Quote short text from them in "notes" when it helps (e.g. a tweet draft).\n`
    : ""
}
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

export type PromptImage = { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };

export async function askClaude(prompt: string, images: PromptImage[] = []): Promise<string> {
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
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({ type: "image", source: { type: "base64", ...img } })),
            { type: "text", text: prompt },
          ],
        },
      ],
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
