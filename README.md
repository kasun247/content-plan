# Content Plan

A content plan timeline for Framer templates, components and launches. Drop in a rough note and it becomes dated items on a week-by-week timeline, with a status board and a history of every note.

Built with Next.js (App Router) and no other runtime dependencies.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it saves

The app picks its mode from environment variables, so it works out of the box and gets better as you add them:

| Set in env | Saving | "Organise into plan" |
| --- | --- | --- |
| nothing | in this browser (localStorage) | one idea per line |
| a lock (Google sign-in or `APP_PASSCODE`) + Upstash/KV vars | cloud, same plan on every device | one idea per line |
| a lock + `ANTHROPIC_API_KEY` | (as above) | AI splits the note into dated items |

Cloud saving and AI only switch on once the app is locked, so nobody can edit your plan or spend your API credit from the public URL.

### Images

Paste, drop or pick up to 4 images per note (screenshots, post graphics). They're resized in the browser, kept with the note and every item it creates, and shown on the timeline, board and notes. With AI organising on, Claude also reads them to make the plan items. In cloud mode images are stored in the same Upstash database as the plan, so there's nothing extra to set up.

### Google sign-in

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` and `SESSION_SECRET` and the page shows "Sign in with Google" instead of the passcode box. Only the emails in `ALLOWED_EMAILS` get in; a signed cookie keeps you signed in for 30 days.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project → **APIs & Services → OAuth consent screen**: External, app name, your email. Add yourself as a test user (or publish the app).
2. **Credentials → Create credentials → OAuth client ID → Web application**. Authorised redirect URIs: `https://<your-vercel-domain>/api/auth/callback` and, for local dev, `http://localhost:3000/api/auth/callback`.
3. Copy the client ID and secret into Vercel's env vars, add `ALLOWED_EMAILS` and a `SESSION_SECRET` (`openssl rand -base64 32`), then redeploy.

When Google sign-in is set up, `APP_PASSCODE` is ignored.

See `.env.example` for every variable.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project**, import the repo. The defaults are right (framework: Next.js).
3. **Storage → Upstash for Redis** (Marketplace), create a free database, and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables**: add the Google sign-in variables (see above) or `APP_PASSCODE`, and, if you want AI organising, `ANTHROPIC_API_KEY`.
5. Redeploy so the new variables apply.

On first load in cloud mode, the plan starts from `data/seed.json` (your plan as it was in the Claude artifact).

## Files

- `components/ContentPlan.tsx`: the whole UI (timeline, board, notes, edit dialog)
- `lib/plan.ts`: types, channels/types/statuses, date helpers, validation
- `lib/auth.ts`: Google sign-in (OAuth code flow) and the signed session cookie
- `app/api/auth/*`: `google` (start sign-in), `callback`, `logout`
- `lib/server.ts`: lock check, Upstash REST storage, Anthropic API call and prompt
- `app/api/plan/route.ts`: `GET`/`PUT` the plan
- `app/api/organise/route.ts`: `POST` a note (and images), get back plan items
- `app/api/image/[id]/route.ts`: `PUT`/`GET` one image
- `components/images.tsx`: resizing, storing and showing images
- `data/seed.json`: starting data
