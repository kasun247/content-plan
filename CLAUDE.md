# CLAUDE.md

## What this is

Kasun's content plan dashboard for his Framer Marketplace work (free templates like Coming Soon and Axia, plus components, promoted mainly on X and Contra). He drops rough notes in; the app turns them into dated content items on a weekly timeline.

It started as a Claude artifact and was ported to Next.js so it can live on GitHub and Vercel. `data/seed.json` holds the plan as it was in the artifact (13 Nov 2026).

Kasun is in Sri Lanka (UTC+5:30). Dates in the plan are local dates (`YYYY-MM-DD`), computed in the browser, weeks start Monday.

## Next steps (the reason this was handed to Claude Code)

1. `npm install && npm run build` to confirm it builds on this machine.
2. Create a GitHub repo and push:
   - `git init && git add -A && git commit -m "Content Plan: Next.js app"`
   - `gh repo create content-plan --private --source . --push` (or ask Kasun for an existing repo URL and `git remote add origin … && git push -u origin main`)
   - If `gh` isn't logged in, ask Kasun to run `gh auth login`.
3. Deploy to Vercel, either by importing the repo at vercel.com/new, or with the CLI: `npx vercel` then `npx vercel --prod`.
4. Help Kasun set env vars in Vercel (see `.env.example` and README): Upstash for Redis from the Vercel Marketplace (gives `KV_REST_API_URL`/`KV_REST_API_TOKEN`), `APP_PASSCODE`, optionally `ANTHROPIC_API_KEY`. Redeploy after.
5. Never commit `.env.local` or any key. `.gitignore` already covers it.

## Architecture

- `components/ContentPlan.tsx` is a single client component. It renders nothing date-dependent until mounted (avoids hydration mismatch from server vs. browser time zones).
- `GET /api/plan` returns the mode: `local` (browser storage), `locked` (passcode needed) or `cloud` (with the saved plan). The whole plan `{ items, notes }` is one JSON value in Redis under `content-plan:v1`; the client PUTs it back, debounced 400 ms. Single-user, last write wins.
- Cloud saving and `/api/organise` only work when the app is locked (`authMethod()` in `lib/server.ts`). Google sign-in wins when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and `ALLOWED_EMAILS` are set: `/api/auth/google` → Google → `/api/auth/callback` sets an HttpOnly HMAC-signed `cp_session` cookie (`lib/auth.ts`, no SDK). Otherwise `APP_PASSCODE`, sent as `x-plan-passcode`; 10 wrong tries per IP in 15 min → 429 (`content-plan:fail:<ip>` in Redis, in-memory fallback). All routes call async `authorise(req)`. `SESSION_SECRET` under 32 chars keeps Google sign-in off.
- Security headers (CSP, frame-ancestors none, nosniff, referrer policy) are set in `next.config.ts`; add any new external origin (fonts, scripts, APIs called from the browser) to the CSP there.
- `/api/organise` calls the Anthropic Messages API with `fetch` (no SDK). Model from `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`. Without a key, the client falls back to one idea per line (`fallbackOrganise`).
- Images: notes and items carry `images: string[]` (ids like `img…`). The browser resizes each to ≤1600px JPEG (`components/images.tsx`), then stores it in localStorage (`content-plan:img:<id>`) or, in cloud mode, PUTs it to `/api/image/[id]` (one Redis key per image, `content-plan:img:<id>`, value `<type>;<base64>`). Max 4 per note. `/api/organise` also sends them to Claude as image blocks. Deleting an item doesn't delete its images.
- `cleanDraft` / `cleanPlan` in `lib/plan.ts` validate everything from the AI and from storage. Keep channels/types/statuses in sync there.

## Conventions

- Plain CSS in `app/globals.css` with Carbon-named tokens in `:root` (g10) and a `prefers-color-scheme: dark` block (g100). No Tailwind.
- Visual style follows IBM's Carbon Design System (g10 light / g100 dark tokens, square corners, bottom-border fields, line tabs, Carbon button and tag colours), hand-written in CSS, not the Carbon packages.
- Fonts: IBM Plex Sans (300/400/600) and IBM Plex Mono via Google Fonts link in `app/layout.tsx`.
- Keep runtime dependencies to `next`, `react`, `react-dom` unless there's a clear reason.
