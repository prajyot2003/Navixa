# Navixa — navigate your career

**Live: https://navixa-woad.vercel.app**

A career-navigation web app for students and working professionals. No build step and no framework — the client is plain ES modules running on free public APIs, backed by Supabase (Postgres) for Google sign-in, cloud sync and a role-guarded admin console. With no backend configured it falls back to a fully local, browser-only mode.

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
