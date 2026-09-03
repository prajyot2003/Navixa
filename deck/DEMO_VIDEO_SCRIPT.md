# Navixa — Demo Video Script (3–4 minutes)

For: **Builders Pitch Fest 2026 — Prototype/MVP submission**

---

## Before you hit record

**Prepare the account so nothing is empty on screen.** An empty tracker or a
blank resume kills the demo. Ten minutes of prep:

- Sign in, complete onboarding with a real target role (e.g. *Frontend Engineer*).
- Fill the resume: name, headline, 1–2 experience entries with real bullets,
  education, 6–8 skills. It appears on three different screens.
- Save 4–5 jobs. Move two into **Applied** and one into **Interview** so the
  tracker and its analytics have something to show.
- Open the Learn page once so it isn't cold.
- Set a leaderboard username in Settings so that screen isn't blank.

**Technical setup**

- Record at **1920×1080**, browser in full screen, **zoom at 100%** (`Cmd+0`).
- Use a clean Chrome profile: no bookmarks bar, no extensions, one tab.
- Close Slack/Mail — no notification banners mid-take.
- Tools: OBS Studio (free), or QuickTime → File → New Screen Recording on Mac.
- Record **screen and voice in one pass** if you're comfortable; otherwise record
  the screen silently, then narrate over it. Narrating live is faster and sounds
  more natural.
- Speak ~15% slower than feels normal. Everyone rushes on camera.

**Don't** show sign-in with your real Google account on camera — start already
signed in. It wastes 15 seconds and shows your email.

---

## The script

Timings are targets, not rules. Total ≈ 3 min 30 s.

### 0:00 – 0:25 — The problem (screen: your own messy setup)

> **Show:** A browser with 4–5 tabs open — LinkedIn, a Google Doc resume, a
> spreadsheet, ChatGPT. Just a few seconds of it.

**Say:**

> "This is what a job search actually looks like. A job board in one tab, my
> resume in another, a spreadsheet tracking who I've applied to, and a chatbot I
> re-explain myself to every single time.
>
> None of these tools know about each other. My resume doesn't know what the job
> asked for. The AI doesn't know what's on my resume. And nothing remembers what
> already worked.
>
> That's the problem Navixa solves."

---

### 0:25 – 0:45 — What it is (screen: Navixa dashboard)

> **Show:** Navigate to the dashboard. Let it load. Move the mouse slowly across
> the sidebar so viewers register the sections.

**Say:**

> "Navixa is one workspace where every part of the job search shares the same
> context. Job search, resume, application tracker, interview prep — all reading
> from each other. It's live, it's free, and it runs entirely in the browser."

---

### 0:45 – 1:25 — Job search → tailoring (the core loop; spend time here)

> **Show:** Click **Job search**. Let real listings load. Scroll a little.
> Point out the match percentage on a card. Then click the **tailor icon** on a
> job that matches your resume.

**Say:**

> "Job search pulls live listings from four public boards, removes duplicates,
> and scores each one against my actual skills.
>
> Now here's the part that matters. Instead of rewriting my resume by hand for
> this posting…"

> **Show:** The tailor panel running. Wait for the result — don't cut away.
> Point at the match score, the missing keywords, then a suggested bullet rewrite.

> "…Navixa reads the posting *and* my resume together. It gives me a match
> score, tells me which keywords I'm missing, and rewrites my bullets to fit
> this specific role. One click applies it straight into my resume.
>
> That's about thirty minutes of work, done in under a minute."

---

### 1:25 – 2:00 — Tracker (proof it's a real product)

> **Show:** Click **Tracker**. Drag a card from *Applied* to *Interview*.
> Scroll to the insights panel. Then click the follow-up icon on a stale card.

**Say:**

> "Every application lands on the tracker. As I move cards through the stages,
> Navixa records what actually happened — response rate, how long each stage
> takes, which sources convert.
>
> And when something's gone quiet, it drafts the follow-up email for me.
>
> This history is the part I care most about long term. It's the difference
> between advice that's generic and advice that knows my track record."

---

### 2:00 – 2:45 — Interview prep (the strongest demo moment)

> **Show:** Open **Interview prep** from the tracker card or the AI chat page.
> Paste a job description. Let the questions generate. **Scroll to a "Gap probe"
> question and pause on it** — this is your best moment, let it breathe.

**Say:**

> "Interview prep is where the shared context really pays off. It reads the job
> description against my resume and generates the questions I'm actually likely
> to face.
>
> Including these — 'gap probes'. It found that this role wants GraphQL and my
> resume doesn't have it, so it's forcing me to prepare for exactly the question
> I'd otherwise get blindsided by."

> **Show:** Click **Practise this**. Click record. Answer out loud for ~15
> seconds — genuinely answer, don't mumble. Stop. Click **Get feedback**.
> Let the score and metrics appear.

> "I can practise out loud. It transcribes me in the browser, times me, and
> tracks my pace and filler words — all computed locally.
>
> Then it scores the answer and tells me what to sharpen."

---

### 2:45 – 3:10 — Momentum + privacy (leaderboard)

> **Show:** Click **Streaks**. Show the streak, then scroll to the leaderboard.
> Then briefly show **Settings → username toggle**.

**Say:**

> "Job hunting is a grind, so Navixa tracks streaks and XP, with a leaderboard
> for a bit of momentum.
>
> Two things there. Scores are computed on the server, so they can't be faked.
> And the leaderboard is opt-in and shows only a username you choose — never your
> real name or email."

---

### 3:10 – 3:30 — Close

> **Show:** Back to the dashboard. Hold still on it.

**Say:**

> "Navixa is live today at navixa-woad.vercel.app — a working product, not a
> mockup. Over a hundred and fifty automated tests, a documented security audit,
> and every AI feature falls back gracefully when the model is unavailable.
>
> One workspace, one context, for everyone doing this alone.
>
> Thanks for watching."

---

## Recording tips that actually matter

**Do it in sections.** Record each section separately and stitch them. One
continuous 3-minute perfect take is not worth chasing.

**Wait for loading, don't cut it.** Judges are suspicious of demos that cut away
at every load. Letting a real API call resolve on camera proves it's real.
If a call takes more than ~4 seconds, speed that clip to 2× rather than cutting.

**Mouse discipline.** Move deliberately, pause before clicking. Frantic cursor
movement makes a product look chaotic.

**Don't narrate the UI.** Say *why*, not *what*. "It found the gap in my resume"
beats "now I'm clicking the interview prep button."

**If a feature errors on camera**, don't panic-cut — the free AI gateway is
occasionally rate-limited. Re-record just that section later.

**Captions.** Add them if you can. Many judges watch muted first.

---

## Cutting to 3:00 flat if you need to

Drop these in order:

1. The Streaks/leaderboard section (0:25) — nice, not essential.
2. The follow-up-email beat in Tracker (0:10).
3. Shorten the problem intro to two sentences (0:10).

**Never cut** the tailoring section or the gap-probe moment. Those two are the
whole differentiator.

---

## Checklist before uploading

- [ ] Audio is audible and has no background hum
- [ ] No email address, real name or Google account visible anywhere
- [ ] No browser notifications appeared mid-take
- [ ] Under 5 minutes (the brief says 3–5)
- [ ] Uploaded **unlisted** to YouTube or Drive, and **link sharing is on** —
      test the link in a private window before submitting
- [ ] Link added to slide 12 of the pitch deck
