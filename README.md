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
| `APP_PASSCODE` + Upstash/KV vars | cloud, same plan on every device | one idea per line |
| `APP_PASSCODE` + `ANTHROPIC_API_KEY` | (as above) | AI splits the note into dated items |

Cloud saving and AI only switch on when `APP_PASSCODE` is set, so nobody can edit your plan or spend your API credit from the public URL. The page asks for the passcode once per browser.

See `.env.example` for every variable.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project**, import the repo. The defaults are right (framework: Next.js).
3. **Storage → Upstash for Redis** (Marketplace), create a free database, and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables**: add `APP_PASSCODE` and, if you want AI organising, `ANTHROPIC_API_KEY`.
5. Redeploy so the new variables apply.

On first load in cloud mode, the plan starts from `data/seed.json` (your plan as it was in the Claude artifact).

## Files

- `components/ContentPlan.tsx`: the whole UI (timeline, board, notes, edit dialog)
- `lib/plan.ts`: types, channels/types/statuses, date helpers, validation
- `lib/server.ts`: passcode check, Upstash REST storage, Anthropic API call and prompt
- `app/api/plan/route.ts`: `GET`/`PUT` the plan
- `app/api/organise/route.ts`: `POST` a note, get back plan items
- `data/seed.json`: starting data
