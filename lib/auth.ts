import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google sign-in (OAuth 2.0 authorization code flow, no SDK).
 *
 * On when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET and ALLOWED_EMAILS are all set.
 * After sign-in the server sets an HttpOnly cookie holding `{ email, exp }` signed with SESSION_SECRET.
 * Only addresses in ALLOWED_EMAILS (comma-separated) can sign in.
 */

export const SESSION_COOKIE = "cp_session";
export const STATE_COOKIE = "cp_oauth_state";
const SESSION_DAYS = 30;

export const googleEnabled = () =>
  Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.SESSION_SECRET &&
      allowedEmails().length,
  );

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(value: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET as string).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeSession(email: string): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const payload = b64url(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + maxAge }));
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

/** The signed-in email from the session cookie, if valid, unexpired and still allowed. */
export function sessionEmail(req: Request): string | null {
  if (!googleEnabled()) return null;
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { email?: string; exp?: number };
    if (!email || !exp || exp < Date.now() / 1000) return null;
    return allowedEmails().includes(email.toLowerCase()) ? email : null;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const newState = () => b64url(randomBytes(24));

/** Origin the browser used, honouring Vercel's proxy headers. */
export function originOf(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const redirectUri = (req: Request) => `${originOf(req)}/api/auth/callback`;
export const secureCookies = (req: Request) => originOf(req).startsWith("https://");

export function googleAuthUrl(req: Request, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/**
 * Swap the code for tokens and read the email from the ID token.
 * The token comes straight from Google's token endpoint over TLS, so its payload can be
 * trusted without verifying the signature (OpenID Connect Core 3.1.3.7); we still check aud/iss/exp.
 */
export async function emailFromCode(req: Request, code: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  const payload = id_token?.split(".")[1];
  if (!payload) throw new Error("Google returned no ID token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    aud?: string;
    iss?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
  };
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("ID token is for another app");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com")
    throw new Error("ID token issuer is not Google");
  if (!claims.exp || claims.exp < Date.now() / 1000) throw new Error("ID token has expired");
  if (!claims.email || !claims.email_verified) throw new Error("Google account has no verified email");
  return claims.email.toLowerCase();
}

/** Reject cross-site writes: browsers send Origin on POST/PUT, and it must be this site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === originOf(req) || origin === new URL(req.url).origin;
}
