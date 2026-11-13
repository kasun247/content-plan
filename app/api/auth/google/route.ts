import { NextResponse } from "next/server";
import { googleAuthUrl, googleEnabled, newState, secureCookies, STATE_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Start Google sign-in: remember a random state in a short cookie, then send the browser to Google. */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/?auth_error=not_configured", req.url));
  const state = newState();
  const res = NextResponse.redirect(googleAuthUrl(req, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: secureCookies(req),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
