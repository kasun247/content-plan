import { NextResponse } from "next/server";
import {
  allowedEmails,
  emailFromCode,
  googleEnabled,
  makeSession,
  originOf,
  readCookie,
  secureCookies,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Google sends the browser back here with ?code&state. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (error?: string) => {
    const res = NextResponse.redirect(`${originOf(req)}/${error ? `?auth_error=${error}` : ""}`);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return res;
  };

  if (!googleEnabled()) return back("not_configured");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(req, STATE_COOKIE)) return back("expired");

  let email: string;
  try {
    email = await emailFromCode(req, code);
  } catch (e) {
    console.error("google sign-in failed", e);
    return back("failed");
  }
  if (!allowedEmails().includes(email)) return back("not_allowed");

  const res = back();
  const session = makeSession(email);
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
