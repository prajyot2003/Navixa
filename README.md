# Navixa — navigate your career

**Live: https://navixa-woad.vercel.app**

A career-navigation web app for students and working professionals. No build step, no database, no paid services — everything runs in the browser with free public APIs.

## Features

- **Job search engine** — live listings aggregated from Remotive, Jobicy, Arbeitnow and The Muse, with search, type/remote/source filters and smart sorting
- **Suggestions** — jobs & internships scored against your skills, interests and target role (match % + why)
- **Resume builder** — live preview, 3 templates, accent color, ATS readiness score with a full report, print-perfect PDF download, and **import from an existing PDF / Word (.docx) resume** (text extracted in-browser, then structured by the AI gateway with a heuristic parser as fallback) plus JSON import/export
- **AI career chat** — free open-source model (Gemma 3 27B via keyless LLM7 gateway), streaming replies, three modes: Career Copilot, Interview Coach (mock interviews), Resume Reviewer
- **Learning hub** — video search (serverless YouTube scraper + Piped fallback), dev.to articles, curated free courses, personal playlist with completion tracking, AI-generated learning paths
- **Streaks & achievements** — daily goals, XP + levels, GitHub-style heatmap, streak shields, 14 badges
- **Application tracker** — kanban (Saved → Applied → Interview → Offer → Closed) with drag & drop and notes
- **Auth** — real "Continue with Google" via Supabase Auth (live), plus local demo accounts; multi-account, per-user data
- **Admin console** (`#/admin`) — fully separated from the client app: overview stats, user management with roles (client/admin), feedback inbox, feature flags, announcement banner, content overrides. Requires the Supabase backend (see below); clients can never see or open it, and even admins cannot read a user's private data (RLS)
- **Profile / Settings / Help** — theme (light/dark/system), 5 accent colors, job-source toggles, custom LLM provider, data export/import, FAQ + feedback

All personal data stays in `localStorage`. External calls go only to the public APIs above.

## Run locally

Any static server works (ES modules need http://):

```bash
cd Navixa
npx serve .        # or: python3 -m http.server 8000
```

Note: `/api/*` functions (video search, CORS relay) only run on Vercel — locally the app falls back to direct API calls and YouTube search links.

## Deploy (Vercel)

```bash
npx vercel deploy --prod
```

The `api/` folder auto-deploys as serverless functions.

The `api/` folder auto-deploys as serverless functions and production serves this folder's raw ES modules directly (no bundling step). The source here is the single source of truth.

## Tests

```bash
npm install jsdom       # one-time
node tests/run.mjs      # 33 tests: units + full jsdom boot/navigation smoke
```

## Enable the cloud backend + admin console (Supabase)

1. Create a free project at [supabase.com](https://supabase.com)
2. SQL Editor → paste all of `supabase-setup.sql` → Run (seeds `prajyotkumar2003@gmail.com` as first admin)
3. Authentication → Sign In / Providers → Google: enable, paste your Google Client ID + secret
4. In Google Cloud Console, add `https://<project>.supabase.co/auth/v1/callback` under **Authorized redirect URIs**
5. Authentication → URL Configuration: set Site URL to the live app URL
6. Put the project URL + anon key into `js/config.js` (`SUPABASE = { url, anonKey }`) and redeploy

Until step 6 the app runs in local mode (browser-only accounts); `#/admin` shows these setup steps.

## Stack

Vanilla ES modules + hand-rolled design system (no framework, no build), Vercel serverless functions (Node) for the LLM relay, API proxy and video search.
