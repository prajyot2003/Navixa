# Security

How Navixa is hardened, what was fixed, and — honestly — what risk remains.

Run the security regression suite any time:

```bash
node tests/security.mjs    # 62 checks
node tests/ratelimit.mjs   # 19 checks (both backends + failure modes)
node tests/run.mjs         # 33 functional tests
```

## Rate limiting

Limits are per IP **per endpoint**, so browsing jobs cannot consume the AI chat
budget: `llm` 12/min, `videos` 30/min, `proxy` 60/min.

By default the counter is in-memory, which is per serverless instance and
therefore best-effort. To make it durable and shared across instances, add
Vercel's **Upstash Redis** integration (Vercel KV was sunset in Dec 2024 and
existing stores were migrated to Upstash). The integration injects
`KV_REST_API_URL` and `KV_REST_API_TOKEN`, which is all this code needs — no npm
package, no build step. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
also work.

Design notes:

- The IP is **hashed** before use — the limiter needs to tell callers apart, not
  identify them, so no raw IPs are stored.
- Redis calls time out at 1.2s and **fail open to the in-memory limiter**. A
  Redis outage must not take the app down, but it should not remove all limits
  either. Tested against a refused connection, an HTTP 500, and a hung server.
- The window does not slide: the TTL is set with `NX` so a burst cannot keep
  extending its own window.
- `X-RateLimit-Backend` on a 429 response says which backend decided, which makes
  it obvious in production whether Redis is actually being used.

---

## Threat model

Navixa is a static client-side app. It has no server session and no server-side
user data. That shapes everything below:

- **All authorisation lives in Postgres row-level security**, not in JavaScript.
  Client-side checks are UX, never a security boundary — anyone can edit the JS
  in their own browser.
- **The Supabase publishable key is public by design.** It is safe in the bundle
  *because* RLS restricts what it can reach. The `service_role` key must never
  appear in client code; the test suite asserts this.
- The main untrusted inputs are: third-party job/video APIs, AI model output,
  user-uploaded resumes, and published public profiles.

---

## Fixed in this pass

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `javascript:` URLs from third-party job/video feeds flowed into `href`. `esc()` doesn't neutralise them — it only escapes HTML characters, and `javascript:alert(1)` contains none. | **High** | Added `safeUrl()` / `safeImageUrl()` (scheme allowlist, control-character rejection) and applied them at every sink. |
| 2 | `stripHtml()` assigned untrusted job HTML to `div.innerHTML`. Scripts don't run that way, but a detached node still loads images, so `<img src=x onerror=…>` executed. | **High** | Rewritten on `DOMParser`, which produces an inert document: no script execution, no resource loads. |
| 3 | No `Content-Security-Policy`; page could be framed (clickjacking); no HSTS. | **Medium** | Full CSP with no `unsafe-inline`/`unsafe-eval` for scripts, plus `frame-ancestors 'none'`, HSTS, `X-Frame-Options`, `Permissions-Policy`, COOP. |
| 4 | `/api/llm` was an open, unauthenticated AI relay — anyone could farm free inference against the project's quota. Same for `/api/proxy` and `/api/videos`. | **Medium** | Added `api/_guard.js`: same-origin check + per-IP rate limits (12/min LLM, 30/min videos, 60/min proxy). Wildcard CORS replaced with origin reflection + `Vary`. |
| 5 | Supabase loaded from a floating `@2` CDN tag — the CDN could serve new code into the page at any time. | **Medium** | Pinned to an exact version (`2.112.4`) and integrity-checked with SHA-384 SRI, so the browser refuses the file if a single byte differs. |
| 6 | Inline `onerror=` handler on job logos would break under a strict CSP. | Low | Replaced with an `addEventListener` fallback. |

---

## Verified already sound (no change needed)

- **`md()`** — the AI-output markdown renderer escapes *first*, then applies
  formatting only to neutralised text, and its link rule requires an `https?:`
  prefix. Tested against script tags, `svg/onload`, `img onerror`, iframes and
  attribute-breakout payloads.
- **SSRF allowlist** in `api/proxy.js` — built on `new URL().hostname`, not
  string matching, so `evil.com#remotive.com`, `remotive.com.evil.com`,
  `…@remotive.com.attacker.net` and cloud-metadata IPs (`169.254.169.254`) are
  all rejected. HTTPS is enforced.
- **Row-level security** — `user_state` is readable only by its owner (admins
  can delete but *not* read it). A trigger blocks role self-promotion, so a user
  cannot make themselves admin. `public_profiles` is world-readable only while
  `published = true`.
- **Public profile privacy** — only ticked sections are uploaded; email and
  phone default to off. Verified at the database level, not just in the UI.
- **No secrets** in the working tree or anywhere in git history.

---

## Residual risk — what is NOT solved

Being straight about this matters more than a green checklist.

1. **Rate limiting is only as strong as its backend.** With Upstash Redis
   configured the budget is shared across instances and holds properly. Without
   it, the in-memory fallback is per-instance and a distributed attacker can
   exceed the nominal rate. Either way the limit is **per IP**, so a botnet or a
   large NAT/VPN pool is not meaningfully constrained; blocking that needs
   upstream protection (Vercel WAF / Cloudflare), not application code.
2. **Upgrading Supabase is now a two-step change.** The CDN script is pinned and
   SRI-protected, so bumping the version *without* regenerating the hash will
   make the browser refuse the script and break sign-in. Always do both:
   ```bash
   curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<VERSION>/dist/umd/supabase.min.js \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```
   Then update `src` and `integrity` together in `index.html`.
   `tests/security.mjs` fails if any remote script lacks a valid hash or
   `crossorigin` (SRI is silently ignored without the latter).
3. **`app_config` is world-readable** (`using (true)`) by design, so the app can
   read config while signed out. Never put anything sensitive in that table.
4. **Profile view counts can be inflated** — `bump_profile_views` is callable
   repeatedly. Cosmetic only.
5. **Prompt injection is not solved.** A malicious job description or uploaded
   résumé can influence what the AI says. Output is rendered safely (see `md()`),
   so it cannot execute — but it can mislead. Treat AI output as advice, not fact.
6. **Account security depends on Google OAuth** and on the user's own Google
   account hygiene.
7. **Anyone can publish a public profile** containing whatever text they like.
   It is escaped and cannot execute, but it is not moderated.

## Reporting

Found something? Open a GitHub issue marked **security**, or email the address in
the repository profile. Please don't post working exploit details publicly first.
