// Navixa — login, onboarding, dashboard, profile, settings, help
import { getState, update, globalSettings, saveGlobal, applyTheme, currentUser, exportAll, importAll, deleteAccountData } from './store.js';
import { $, $$, el, esc, icon, avatarHtml, toast, modal, timeAgo, emptyState, skeleton, countUp } from './utils.js';
import { hasGoogle, renderGoogleButton, demoSignIn, saveClientId } from './auth.js';
import { SKILL_SUGGESTIONS, INTEREST_SUGGESTIONS, APP, JOB_SOURCES, SUPABASE, getTips, getBanner } from './config.js';
import { cloudEnabled, cloudProfile, isAdmin, sendFeedback } from './cloud.js';
import { levelProgress, computeStreak, goalsToday, achievementList } from './gamify.js';
import { searchJobs, matchJobs, llmPing, llmConfig } from './api.js';
import { jobCard } from './views-jobs.js';

/* ================= Login ================= */
export function loginView({ onDone }) {
  const root = el(`<div class="login">
    <div class="login-hero">
      <div class="brand">
        <span class="brand-mark">${icon('compass', 22)}</span>
        <span class="brand-name" style="color:#fff">Navi<em>xa</em></span>
      </div>
      <h1>Your career, <em>navigated</em> — not guessed.</h1>
      <p class="lede">One workspace for students and professionals: find roles you'll love, build a resume that passes the bots, learn the right skills, and keep the momentum going.</p>
      <div class="hero-feats">
        <div class="hero-feat">${icon('briefcase', 18)}<div><b>Live job & internship engine</b><span>4 sources, smart filters, match scores</span></div></div>
        <div class="hero-feat">${icon('sparkles', 18)}<div><b>AI career copilot</b><span>Free open-source model, interview coach</span></div></div>
        <div class="hero-feat">${icon('file', 18)}<div><b>ATS-ready resume builder</b><span>Live preview, 3 templates, PDF export</span></div></div>
        <div class="hero-feat">${icon('flame', 18)}<div><b>Streaks & achievements</b><span>Daily goals that build real momentum</span></div></div>
      </div>
    </div>
    <div class="login-panel">
      <div class="login-card">
        <h2>Welcome</h2>
        <p class="sub">Sign in to sync your journey on this device.</p>
        <div class="g-slot" data-g></div>
        <div class="divider">or</div>
        <div class="field"><label>Your name</label><input class="input" data-name placeholder="e.g. Prajyot" autocomplete="name"></div>
        <button class="btn btn-ghost btn-block btn-lg" data-demo>${icon('user', 18)} Continue without Google</button>
        <p class="login-note">${cloudEnabled()
          ? 'Google accounts sync across devices. Guest mode stays on this device only.'
          : 'All data stays in your browser — nothing is sent to a server.'}<br>
        ${cloudEnabled() ? '' : '<a href="#" data-setup>Admin: configure Google Sign-In</a>'}</p>
      </div>
    </div>
  </div>`);

  const gSlot = $('[data-g]', root);
  (async () => {
    const ok = await renderGoogleButton(gSlot, { onSignedIn: onDone });
    if (!ok) {
      gSlot.innerHTML = `<button class="btn btn-ghost btn-block btn-lg" data-g-disabled>${icon('google', 18)} Continue with Google</button>`;
      $('[data-g-disabled]', gSlot).onclick = () => setupModal(() => location.reload());
    }
  })();

  $('[data-demo]', root).onclick = () => { demoSignIn($('[data-name]', root).value); onDone(); };
  $('[data-name]', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { demoSignIn(e.target.value); onDone(); } });
  const setupLink = $('[data-setup]', root);
  if (setupLink) setupLink.onclick = (e) => { e.preventDefault(); setupModal(() => location.reload()); };
  return root;
}

export function setupModal(after) {
  const body = el(`<div>
    <p class="sub">Real Google OAuth needs a (free) Client ID from Google Cloud — takes ~3 minutes:</p>
    <ol class="sub" style="padding-left:20px;line-height:1.9">
      <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com/apis/credentials</a></li>
      <li>Create a project → <b>Create credentials → OAuth client ID → Web application</b></li>
      <li>Add this site's URL (<code>${esc(location.origin)}</code>) under <b>Authorized JavaScript origins</b></li>
      <li>Copy the Client ID (ends in <code>.apps.googleusercontent.com</code>) and paste it below</li>
    </ol>
    <div class="field mt-1"><label>Google OAuth Client ID</label>
      <input class="input" data-cid value="${esc(globalSettings.googleClientId)}" placeholder="1234567890-xxxx.apps.googleusercontent.com"></div>`);
  modal({
    title: 'Enable “Continue with Google”', body,
    actions: [
      { label: 'Cancel' },
      { label: 'Save', primary: true, onClick: () => { saveClientId($('[data-cid]', body).value); toast('Saved — Google Sign-In is now active'); after?.(); } },
    ],
  });
}

/* ================= Onboarding ================= */
export function onboardingView({ onDone }) {
  const s = getState();
  const u = currentUser();
  const draft = { role: s.profile.role || '', targetRole: s.profile.targetRole || '', location: s.profile.location || '', skills: [...s.profile.skills], interests: [...s.profile.interests], openTo: { ...s.profile.openTo } };
  let step = 0;
  const root = el(`<div class="onboard"><div class="onboard-card card" style="padding:28px"></div></div>`);
  const card = $('.onboard-card', root);

  const chipCloud = (list, chosen, extraPh) => `
    <div class="chip-cloud" data-cloud>
      ${list.map((x) => `<button class="chip-pick ${chosen.includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}
    </div>
    <div class="field mt-2"><input class="input" data-extra placeholder="${esc(extraPh)}"></div>`;

  function bindCloud(container, chosen) {
    $$('.chip-pick', container).forEach((c) => c.onclick = () => {
      const v = c.dataset.v;
      const i = chosen.indexOf(v);
      if (i >= 0) { chosen.splice(i, 1); c.classList.remove('on'); }
      else if (chosen.length < 15) { chosen.push(v); c.classList.add('on'); }
    });
    $('[data-extra]', container).addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); if (!v) return;
      if (!chosen.includes(v)) {
        chosen.push(v);
        $('[data-cloud]', container).appendChild(el(`<button class="chip-pick on" data-v="${esc(v)}">${esc(v)}</button>`));
        bindCloud(container, chosen);
      }
      e.target.value = '';
    });
  }

  function render() {
    const dots = `<div class="steps-dots">${[0, 1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
    if (step === 0) {
      card.innerHTML = `${dots}
        <h2>Hey ${esc((u?.name || '').split(' ')[0] || 'there')} 👋</h2>
        <p class="sub mt-1 mb-2">Let's set your bearings. Which describes you best?</p>
        <div class="role-cards">
          <button class="role-card ${draft.role === 'student' ? 'on' : ''}" data-role="student"><b>${icon('book', 18)} Student</b><span>Hunting internships, first roles and skills that get me hired.</span></button>
          <button class="role-card ${draft.role === 'professional' ? 'on' : ''}" data-role="professional"><b>${icon('briefcase', 18)} Professional</b><span>Growing, switching or levelling up my career.</span></button>
        </div>
        <div class="row mt-3" style="justify-content:space-between">
          <button class="btn btn-ghost" data-skip>Skip for now</button>
          <button class="btn btn-primary" data-next ${draft.role ? '' : 'disabled'}>Continue ${icon('arrowR', 16)}</button>
        </div>`;
      $$('.role-card', card).forEach((c) => c.onclick = () => { draft.role = c.dataset.role; render(); });
    } else if (step === 1) {
      card.innerHTML = `${dots}
        <h2>Your skills</h2><p class="sub mt-1 mb-2">Pick what you know — this powers job matching and learning suggestions.</p>
        ${chipCloud(SKILL_SUGGESTIONS, draft.skills, 'Type another skill and press Enter')}
        <div class="row mt-3" style="justify-content:space-between">
          <button class="btn btn-ghost" data-back>${icon('chevL', 16)} Back</button>
          <button class="btn btn-primary" data-next>Continue ${icon('arrowR', 16)}</button>
        </div>`;
      bindCloud(card, draft.skills);
    } else if (step === 2) {
      card.innerHTML = `${dots}
        <h2>Your interests</h2><p class="sub mt-1 mb-2">What pulls you in? We'll find content and roles around these.</p>
        ${chipCloud(INTEREST_SUGGESTIONS, draft.interests, 'Type another interest and press Enter')}
        <div class="row mt-3" style="justify-content:space-between">
          <button class="btn btn-ghost" data-back>${icon('chevL', 16)} Back</button>
          <button class="btn btn-primary" data-next>Continue ${icon('arrowR', 16)}</button>
        </div>`;
      bindCloud(card, draft.interests);
    } else {
      card.innerHTML = `${dots}
        <h2>Your destination</h2><p class="sub mt-1 mb-2">A target makes every suggestion sharper. You can change it anytime.</p>
        <div class="field"><label>Target role</label><input class="input" data-target value="${esc(draft.targetRole)}" placeholder="e.g. Frontend Developer, Data Analyst, Product Manager"></div>
        <div class="field"><label>Location (optional)</label><input class="input" data-loc value="${esc(draft.location)}" placeholder="e.g. Pune, India"></div>
        <div class="row wrap mt-1">
          <label class="switch"><input type="checkbox" data-o="remote" ${draft.openTo.remote ? 'checked' : ''}><span class="track"></span>Open to remote</label>
          <label class="switch"><input type="checkbox" data-o="internship" ${draft.openTo.internship || draft.role === 'student' ? 'checked' : ''}><span class="track"></span>Open to internships</label>
        </div>
        <div class="row mt-3" style="justify-content:space-between">
          <button class="btn btn-ghost" data-back>${icon('chevL', 16)} Back</button>
          <button class="btn btn-primary btn-lg" data-finish>${icon('check', 18)} Start navigating</button>
        </div>`;
    }
    $('[data-next]', card)?.addEventListener('click', () => { step++; render(); });
    $('[data-back]', card)?.addEventListener('click', () => { step--; render(); });
    $('[data-skip]', card)?.addEventListener('click', finish);
    $('[data-finish]', card)?.addEventListener('click', () => {
      draft.targetRole = $('[data-target]', card).value.trim();
      draft.location = $('[data-loc]', card).value.trim();
      draft.openTo.remote = $('[data-o="remote"]', card).checked;
      draft.openTo.internship = $('[data-o="internship"]', card).checked;
      finish();
    });
  }

  function finish() {
    update((st) => { Object.assign(st.profile, draft, { onboarded: true }); }, { type: 'profile' });
    import('./gamify.js').then(({ logActivity, checkAchievements }) => { logActivity('onboarding'); checkAchievements(); });
    onDone();
  }

  render();
  return root;
}

/* ================= Dashboard ================= */
export function dashboardView() {
  const root = el('<div></div>');
  const s = getState();
  const u = currentUser();
  const lp = levelProgress(s.gamify.xp);
  const streak = computeStreak();
  const goals = goalsToday();
  const tips = getTips();
  const tip = tips[new Date().getDate() % tips.length];
  const banner = getBanner();
  const bannerDismissed = sessionStorage.getItem('navixa:banner-dismissed') === banner;
  const savedN = Object.keys(s.jobs.saved).length + Object.keys(s.jobs.custom).length;
  const appliedN = Object.values(s.jobs.board).filter((c) => c !== 'saved').length;
  const learnDone = Object.keys(s.learn.done).length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const recentBadges = achievementList().filter((b) => b.earned).sort((a, b) => b.at - a.at).slice(0, 4);

  root.innerHTML = `
    ${banner && !bannerDismissed ? `<div class="card banner-card" data-banner-card>
      <span>${icon('flag', 16)} ${esc(banner)}</span>
      <button class="icon-btn plain" data-banner-x aria-label="Dismiss">${icon('x', 15)}</button>
    </div>` : ''}
    <div class="dash-hello">
      <p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 class="mega">${greet},<br><em>${esc((u?.name || 'Explorer').split(' ')[0])}.</em></h2>
      <p class="dash-sub">${s.profile.targetRole ? `Destination — <b>${esc(s.profile.targetRole)}</b>. Every action gets you closer.` : 'Set a target role in your profile to sharpen every match.'}</p>
    </div>
    <div class="marquee" aria-hidden="true"><div class="marquee-track"><span>${'apply · learn · grow · repeat · '.repeat(6)}</span><span>${'apply · learn · grow · repeat · '.repeat(6)}</span></div></div>

    <section class="bento">
      <div class="tile t-level hero-card" data-sheen>
        <span class="t-label">Level</span>
        <b class="giant" data-count="${lp.lvl}">0</b>
        <div class="level-ring" style="--pct:0" data-pct="${lp.pct}"><div><b>${lp.pct}%</b><span>to L${lp.lvl + 1}</span></div></div>
        <span class="t-foot">${lp.into} / ${lp.span} XP</span>
      </div>
      <div class="tile t-streak">
        <span class="t-label">Streak</span>
        <b class="giant" data-count="${streak}">0</b>
        <span class="t-unit">day${streak === 1 ? '' : 's'} ${icon('flame', 22)}</span>
      </div>
      <div class="tile t-xp">
        <span class="t-label">Total XP</span>
        <b class="giant" data-count="${s.gamify.xp}">0</b>
        <span class="t-unit">${savedN} jobs · ${learnDone} lessons</span>
      </div>
      <div class="tile t-goals">
        <div class="card-title">${icon('target')} Today's goals <a class="more" href="#/streaks">Streaks →</a></div>
        ${goals.map((g) => `<div class="goal-item ${g.done ? 'done' : ''}"><span class="goal-check">${icon('check', 15)}</span><div><div class="g-label">${esc(g.label)}</div><div class="g-hint">${esc(g.hint)}</div></div></div>`).join('')}
      </div>
      <a class="tile t-qa qa" href="#/jobs"><span class="qa-n">01</span>${icon('search', 22)}<b>Find jobs</b><span class="qa-arrow">${icon('arrowR', 18)}</span></a>
      <a class="tile t-qa qa" href="#/resume"><span class="qa-n">02</span>${icon('file', 22)}<b>Resume</b><span class="qa-arrow">${icon('arrowR', 18)}</span></a>
      <a class="tile t-qa qa" href="#/chat"><span class="qa-n">03</span>${icon('message', 22)}<b>Ask AI</b><span class="qa-arrow">${icon('arrowR', 18)}</span></a>
      <a class="tile t-qa qa" href="#/learn"><span class="qa-n">04</span>${icon('play', 22)}<b>Learn</b><span class="qa-arrow">${icon('arrowR', 18)}</span></a>
      <div class="tile t-tip">
        <span class="t-label">Tip of the day</span>
        <p class="tip-serif">“${esc(tip)}”</p>
        ${recentBadges.length ? `<div class="row wrap mt-1">${recentBadges.map((b) => `<span class="badge acc" title="${esc(b.desc)}">${icon(b.icon, 13)} ${esc(b.name)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="tile t-matches">
        <div class="card-title">${icon('briefcase')} Matched to you <a class="more" href="#/matches">See all →</a></div>
        <div data-matches>${skeleton(2)}</div>
      </div>
    </section>`;

  $('[data-banner-x]', root)?.addEventListener('click', () => {
    sessionStorage.setItem('navixa:banner-dismissed', banner);
    $('[data-banner-card]', root).remove();
  });

  // motion: count-up stats, level-ring sweep, cursor glow on hero
  requestAnimationFrame(() => {
    $$('[data-count]', root).forEach((b) => countUp(b, b.dataset.count, { suffix: b.dataset.suffix || '' }));
    const ring = $('.level-ring', root);
    if (ring) {
      const target = Number(ring.dataset.pct) || 0;
      const t0 = performance.now();
      const sweep = (now) => {
        const t = Math.min(1, (now - t0) / 900);
        ring.style.setProperty('--pct', (target * (1 - Math.pow(1 - t, 3))).toFixed(1));
        if (t < 1) requestAnimationFrame(sweep);
      };
      requestAnimationFrame(sweep);
    }
  });
  const hero = $('.hero-card', root);
  hero?.addEventListener('mousemove', (e) => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    hero.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  });

  (async () => {
    const box = $('[data-matches]', root);
    const p = getState().profile;
    if (!p.skills.length && !p.targetRole) {
      box.innerHTML = emptyState('sparkles', 'No matches yet', 'Add skills and a target role to your profile to unlock personalised matches.', '<a class="btn btn-primary" href="#/profile">Complete profile</a>');
      return;
    }
    try {
      const { items } = await searchJobs({ q: p.targetRole || p.skills[0] || '' });
      const matches = matchJobs(items, p).slice(0, 3);
      box.innerHTML = '';
      if (!matches.length) { box.innerHTML = emptyState('briefcase', 'Nothing strong right now', 'Check the full job engine for more.', '<a class="btn btn-primary" href="#/jobs">Open job search</a>'); return; }
      matches.forEach((m) => box.appendChild(jobCard(m.job, { match: m })));
    } catch {
      box.innerHTML = emptyState('alert', 'Could not load jobs', 'Job sources may be briefly unavailable — try again in a minute.');
    }
  })();

  return root;
}

/* ================= Profile ================= */
export function profileView() {
  const root = el('<div></div>');
  const s = getState();
  const u = currentUser();
  const lp = levelProgress(s.gamify.xp);
  const badges = achievementList();

  const cloudEditor = (label, values, suggestions, key) => `
    <div class="field"><label>${label}</label>
      <div class="chip-cloud" data-cloud="${key}">
        ${values.map((x) => `<span class="chip on">${esc(x)}<button data-rm="${esc(x)}" aria-label="Remove">${icon('x', 12)}</button></span>`).join('')}
        <button class="chip chip-in" data-add-chip="${key}">${icon('plus', 13)} Add</button>
      </div>
    </div>`;

  root.innerHTML = `
    <div class="page-head"><div><h2>Profile</h2><p class="lede">This drives your matches, suggestions and AI context.</p></div></div>
    <div class="card">
      <div class="profile-head">
        ${avatarHtml(u, 76)}
        <div style="flex:1;min-width:220px">
          <h3 style="font-size:20px">${esc(u?.name || '')}</h3>
          <p class="muted">${esc(u?.email || (u?.provider === 'demo' ? 'Local account' : ''))} · ${esc(s.profile.role || 'role not set')}</p>
          <div class="row mt-1 wrap">
            <span class="badge acc">${icon('zap', 13)} Level ${lp.lvl} · ${s.gamify.xp} XP</span>
            <span class="badge">${icon('flame', 13)} ${computeStreak()} day streak</span>
            <span class="badge">${icon('trophy', 13)} ${badges.filter((b) => b.earned).length}/${badges.length} badges</span>
          </div>
        </div>
      </div>
      <div class="ats-meter mt-2" title="Progress to next level"><i style="width:${lp.pct}%"></i></div>
      <p class="muted mt-1">${lp.into}/${lp.span} XP to level ${lp.lvl + 1}</p>
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('user')} About you</div>
      <div class="grid grid-2">
        <div class="field"><label>I am a…</label>
          <select class="select" data-f="role"><option value="">—</option>
            <option value="student" ${s.profile.role === 'student' ? 'selected' : ''}>Student</option>
            <option value="professional" ${s.profile.role === 'professional' ? 'selected' : ''}>Working professional</option>
          </select></div>
        <div class="field"><label>Target role</label><input class="input" data-f="targetRole" value="${esc(s.profile.targetRole)}" placeholder="Frontend Developer"></div>
        <div class="field"><label>Headline</label><input class="input" data-f="headline" value="${esc(s.profile.headline)}" placeholder="CS student who ships side projects"></div>
        <div class="field"><label>Location</label><input class="input" data-f="location" value="${esc(s.profile.location)}" placeholder="Pune, India"></div>
      </div>
      <div class="row wrap">
        <label class="switch"><input type="checkbox" data-o="remote" ${s.profile.openTo.remote ? 'checked' : ''}><span class="track"></span>Open to remote</label>
        <label class="switch"><input type="checkbox" data-o="internship" ${s.profile.openTo.internship ? 'checked' : ''}><span class="track"></span>Open to internships</label>
        <label class="switch"><input type="checkbox" data-o="fulltime" ${s.profile.openTo.fulltime ? 'checked' : ''}><span class="track"></span>Open to full-time</label>
      </div>
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('zap')} Skills & interests</div>
      ${cloudEditor('Skills', s.profile.skills, SKILL_SUGGESTIONS, 'skills')}
      ${cloudEditor('Interests', s.profile.interests, INTEREST_SUGGESTIONS, 'interests')}
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('trophy')} Achievement gallery</div>
      <div class="badge-grid">
        ${badges.map((b) => `<div class="badge-card ${b.earned ? '' : 'locked'}"><div class="b-ic">${icon(b.icon, 24)}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}
      </div>
    </div>`;

  $$('[data-f]', root).forEach((inp) => inp.addEventListener('change', () => {
    update((st) => { st.profile[inp.dataset.f] = inp.value.trim ? inp.value.trim() : inp.value; }, { type: 'profile' });
    toast('Profile updated');
  }));
  $$('[data-o]', root).forEach((inp) => inp.addEventListener('change', () => {
    update((st) => { st.profile.openTo[inp.dataset.o] = inp.checked; }, { type: 'profile' });
  }));
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const key = rm.closest('[data-cloud]').dataset.cloud;
      update((st) => { st.profile[key] = st.profile[key].filter((x) => x !== rm.dataset.rm); }, { type: 'profile' });
      rm.closest('.chip').remove();
    }
    const add = e.target.closest('[data-add-chip]');
    if (add) {
      const key = add.dataset.addChip;
      const body = el(`<div><div class="field"><label>Add ${key === 'skills' ? 'a skill' : 'an interest'}</label><input class="input" data-v placeholder="Type and press Add"></div>
        <div class="chip-cloud">${(key === 'skills' ? SKILL_SUGGESTIONS : INTEREST_SUGGESTIONS).filter((x) => !getState().profile[key].includes(x)).slice(0, 14).map((x) => `<button class="chip-pick" data-s="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`);
      const m = modal({
        title: key === 'skills' ? 'Add skill' : 'Add interest', body,
        actions: [{ label: 'Cancel' }, {
          label: 'Add', primary: true, onClick: () => {
            const v = $('[data-v]', body).value.trim();
            if (v) update((st) => { if (!st.profile[key].includes(v)) st.profile[key].push(v); }, { type: 'profile' });
            rerender();
          },
        }],
      });
      $$('[data-s]', body).forEach((b) => b.onclick = () => {
        update((st) => { if (!st.profile[key].includes(b.dataset.s)) st.profile[key].push(b.dataset.s); }, { type: 'profile' });
        m.close(); rerender();
      });
    }
  });
  function rerender() { root.replaceWith(profileView()); }
  import('./public-profile.js').then(({ publicProfileCard }) => root.appendChild(publicProfileCard()));
  return root;
}

/* ================= Settings ================= */
export function settingsView() {
  const root = el('<div></div>');
  const s = getState();
  const u = currentUser();
  const llm = s.settings.llm;

  root.innerHTML = `
    <div class="page-head"><div><h2>Settings</h2><p class="lede">Make Navixa yours.</p></div></div>

    <div class="card">
      <div class="card-title">${icon('sun')} Appearance</div>
      <div class="grid grid-2">
        <div class="field"><label>Theme</label>
          <select class="select" data-theme-sel>
            <option value="system" ${globalSettings.theme === 'system' ? 'selected' : ''}>System</option>
            <option value="light" ${globalSettings.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${globalSettings.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select></div>
        <div class="field"><label>Accent</label>
          <div class="swatches">${['violet', 'cyan', 'emerald', 'rose', 'amber'].map((a) => `<button class="swatch sw-${a} ${globalSettings.accent === a ? 'on' : ''}" data-accent="${a}" title="${a}"></button>`).join('')}</div></div>
      </div>
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('shield')} Accounts & backend</div>
      ${cloudEnabled() ? `
        <p class="sub">Cloud mode ✓ — accounts, roles and sync run on Supabase (<code>${esc(SUPABASE.url.replace('https://', ''))}</code>).
        You are signed in as <b>${esc(u?.email || u?.name || '')}</b>${isAdmin() ? ' · <span class="badge acc">admin</span>' : ' · client'}.</p>
        ${isAdmin() ? `<a class="btn btn-soft mt-1" href="#/admin">${icon('shield', 15)} Open admin console</a>` : '<p class="muted mt-1">Admin areas are managed separately and not visible to client accounts.</p>'}
      ` : `
        <p class="sub mb-1">Running in <b>local mode</b> — data lives in this browser. Google Sign-In (local): ${globalSettings.googleClientId ? `configured ✓ <span class="muted">(${esc(globalSettings.googleClientId.slice(0, 18))}…)</span>` : 'not configured.'}</p>
        <button class="btn btn-ghost" data-gsetup>${icon('gear', 16)} ${globalSettings.googleClientId ? 'Update' : 'Set up'} Client ID</button>
      `}
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('sparkles')} AI model</div>
      <p class="sub mb-2">Default: free keyless gateway running open-source models (currently <b>${esc(llmConfig().model)}</b>). Add your own OpenAI-compatible endpoint for more speed/reliability (Groq, Together, Pollinations, local Ollama…).</p>
      <div class="field"><label>Mode</label>
        <select class="select" data-llm="mode">
          <option value="auto" ${llm.mode !== 'custom' ? 'selected' : ''}>Free keyless (recommended)</option>
          <option value="custom" ${llm.mode === 'custom' ? 'selected' : ''}>Custom provider</option>
        </select></div>
      <div data-custom style="display:${llm.mode === 'custom' ? 'block' : 'none'}">
        <div class="grid grid-2">
          <div class="field"><label>Base URL</label><input class="input" data-llm="baseUrl" value="${esc(llm.baseUrl)}" placeholder="https://api.groq.com/openai/v1"></div>
          <div class="field"><label>API key</label><input class="input" type="password" data-llm="apiKey" value="${esc(llm.apiKey)}" placeholder="sk-…"></div>
        </div>
        <div class="field"><label>Model</label><input class="input" data-llm="model" value="${esc(llm.model)}" placeholder="llama-3.3-70b-versatile"></div>
      </div>
      <button class="btn btn-soft" data-ping>${icon('refresh', 15)} Test connection</button>
      <span class="muted" data-ping-out style="margin-left:10px"></span>
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('briefcase')} Job sources</div>
      <div class="row wrap">
        ${Object.entries(JOB_SOURCES).map(([k, v]) => `<label class="switch"><input type="checkbox" data-src="${k}" ${s.settings.sources[k] ? 'checked' : ''}><span class="track"></span>${v.label}</label>`).join('')}
      </div>
    </div>

    <div class="card mt-2">
      <div class="card-title">${icon('shield')} Your data</div>
      <p class="sub mb-2">Everything lives in this browser's local storage. Export a backup anytime.</p>
      <div class="row wrap">
        <button class="btn btn-ghost" data-export>${icon('download', 16)} Export data</button>
        <button class="btn btn-ghost" data-import>${icon('upload', 16)} Import data</button>
        <button class="btn btn-danger" data-wipe>${icon('trash', 16)} Delete this account's data</button>
      </div>
    </div>`;

  $('[data-theme-sel]', root).onchange = (e) => { saveGlobal({ theme: e.target.value }); applyTheme(); };
  $$('[data-accent]', root).forEach((b) => b.onclick = () => {
    saveGlobal({ accent: b.dataset.accent }); applyTheme();
    $$('[data-accent]', root).forEach((x) => x.classList.toggle('on', x === b));
  });
  const gsetup = $('[data-gsetup]', root); if (gsetup) gsetup.onclick = () => setupModal();
  $$('[data-llm]', root).forEach((inp) => inp.addEventListener('change', () => {
    update((st) => { st.settings.llm[inp.dataset.llm] = inp.value; }, { type: 'settings' });
    if (inp.dataset.llm === 'mode') $('[data-custom]', root).style.display = inp.value === 'custom' ? 'block' : 'none';
  }));
  $('[data-ping]', root).onclick = async (e) => {
    const out = $('[data-ping-out]', root);
    out.textContent = 'Testing…'; e.target.disabled = true;
    try { const r = await llmPing(); out.textContent = r.ok ? `✓ OK (${r.ms} ms)` : `Reached, odd reply: “${r.text}”`; }
    catch (err) { out.textContent = `✗ ${err.message}`; }
    e.target.disabled = false;
  };
  $$('[data-src]', root).forEach((inp) => inp.onchange = () => {
    update((st) => { st.settings.sources[inp.dataset.src] = inp.checked; }, { type: 'settings' });
  });
  $('[data-export]', root).onclick = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = el(`<a download="navixa-backup-${new Date().toISOString().slice(0, 10)}.json" href="${URL.createObjectURL(blob)}"></a>`);
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup downloaded');
  };
  $('[data-import]', root).onclick = () => {
    const inp = el('<input type="file" accept="application/json" hidden>');
    inp.onchange = async () => {
      try { importAll(await inp.files[0].text()); toast('Data imported'); location.hash = '#/dashboard'; location.reload(); }
      catch (e) { toast(`Import failed: ${e.message}`, 'warn'); }
    };
    document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
  };
  $('[data-wipe]', root).onclick = () => {
    modal({
      title: 'Delete account data?',
      body: `<p class="sub">This permanently removes <b>${esc(u?.name || '')}</b>'s profile, resume, tracker, chats and streaks from this browser. There is no undo.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Delete everything', danger: true, onClick: () => { deleteAccountData(u.sub); location.hash = '#/login'; location.reload(); } }],
    });
  };
  return root;
}

/* ================= Help ================= */
export function helpView() {
  const root = el('<div></div>');
  const faqs = [
    ['How do job matches work?', 'Navixa aggregates live listings from Remotive, Jobicy, Arbeitnow and The Muse, then scores each against your skills, interests and target role. The % ring shows the strength of the overlap — tune your profile to improve it.'],
    ['Is the AI really free?', 'Yes. Chat runs on a keyless gateway (LLM7) serving open-source models like Gemma 3 27B. Free tiers can rate-limit at busy times; you can plug in any OpenAI-compatible provider (Groq, Together, local Ollama) in Settings → AI model.'],
    ['How do I enable real Google sign-in?', 'Create a free OAuth Client ID: <ol><li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console → Credentials</a></li><li>Create credentials → OAuth client ID → Web application</li><li>Add this site\'s URL as an Authorized JavaScript origin</li><li>Paste the Client ID in Settings → Google Sign-In</li></ol>Sign-out and the login page will show the real Google button.'],
    ['What is the admin console?', 'Navixa separates <b>clients</b> and <b>admins</b>. Admins manage users & roles, read feedback, set announcement banners, toggle features and edit content at <code>#/admin</code> — an area client accounts can neither see nor open. Roles are enforced by the database (Supabase row-level security), and even admins cannot read your personal resume, chats or tracker.'],
    ['How do streaks and shields work?', 'Any meaningful action (saving a job, finishing a lesson, asking the AI…) marks the day active. Consecutive active days build your streak. Every 7-day streak earns a shield (max 3) that automatically covers one missed day.'],
    ['Can recruiters see my data?', 'No. Everything is stored locally in your browser (localStorage). Job/article/video searches call public APIs directly; your profile and resume never leave the device. Use Settings → Export for backups.'],
    ['How do I download my resume as PDF?', 'Open Resume → “Download PDF”. Your browser\'s print dialog opens with a clean print layout — choose “Save as PDF”. Fonts, spacing and template colors are preserved.'],
    ['What does the ATS score mean?', 'It\'s a heuristic based on how applicant-tracking systems parse resumes: contact info, action verbs, quantified bullets, length, keyword match with your target role. 80+ is strong. Use chat\'s Resume Reviewer mode for a deep AI critique.'],
    ['A job source shows “unavailable” — why?', 'Free public APIs occasionally rate-limit or go down. Navixa keeps working with the remaining sources and retries on refresh.'],
    ['Where do achievements/XP come from?', 'Every action grants XP (e.g. apply = 20 XP, complete a lesson = 15 XP). Levels follow a rising curve. Badges unlock at milestones — see Streaks page for the full gallery.'],
  ];
  root.innerHTML = `
    <div class="page-head"><div><h2>Help & feedback</h2><p class="lede">Everything you need to get the most out of Navixa.</p></div></div>
    <div class="grid grid-3">
      <a class="qa" href="#/jobs">${icon('briefcase', 20)}<b>Job engine</b><span>Search live roles across 4 boards with filters and match scores.</span></a>
      <a class="qa" href="#/resume">${icon('file', 20)}<b>Resume studio</b><span>Live preview, 3 templates, ATS meter, PDF export.</span></a>
      <a class="qa" href="#/chat">${icon('message', 20)}<b>AI copilot</b><span>Market questions, mock interviews, resume review.</span></a>
      <a class="qa" href="#/learn">${icon('play', 20)}<b>Learning hub</b><span>Videos, articles & courses in one playlist.</span></a>
      <a class="qa" href="#/streaks">${icon('flame', 20)}<b>Streaks</b><span>Daily goals, heatmap, shields and badges.</span></a>
      <a class="qa" href="#/tracker">${icon('kanban', 20)}<b>Tracker</b><span>Kanban for every application, with notes.</span></a>
    </div>
    <h3 class="mt-3 mb-2" style="font-size:17px">Frequently asked</h3>
    ${faqs.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)} ${icon('plus', 16)}</summary><div class="faq-body">${a}</div></details>`).join('')}
    <div class="card mt-3">
      <div class="card-title">${icon('mail')} Feedback</div>
      <p class="sub mb-2">Found a bug or have an idea? It goes straight to the maker.</p>
      <div class="field"><textarea class="input" data-fb rows="3" placeholder="What's working? What's missing?"></textarea></div>
      <div class="row">
        <button class="btn btn-primary" data-send-fb>${icon('send', 15)} ${cloudEnabled() && currentUser()?.cloud ? 'Send feedback' : 'Send via email'}</button>
        <button class="btn btn-ghost" data-copy-fb>${icon('copy', 15)} Copy text</button>
      </div>
    </div>
    <p class="muted mt-3" style="text-align:center">Navixa ${APP.version} · Data: <a href="https://remotive.com" target="_blank" rel="noopener">Remotive</a>, <a href="https://jobicy.com" target="_blank" rel="noopener">Jobicy</a>, <a href="https://www.arbeitnow.com" target="_blank" rel="noopener">Arbeitnow</a>, <a href="https://www.themuse.com" target="_blank" rel="noopener">The Muse</a>, <a href="https://dev.to" target="_blank" rel="noopener">DEV</a> · AI: open-source models via LLM7 · Made with Navixa 💜</p>`;

  $('[data-send-fb]', root).onclick = async (e) => {
    const txt = $('[data-fb]', root).value.trim();
    if (cloudEnabled() && currentUser()?.cloud) {
      if (txt.length < 3) { toast('Write a little more first', 'warn'); return; }
      e.currentTarget.disabled = true;
      try { await sendFeedback(txt); $('[data-fb]', root).value = ''; toast('Sent — thank you! The admin will see it in the console.'); }
      catch (err) { toast(err.message, 'warn'); }
      e.currentTarget.disabled = false;
      return;
    }
    location.href = `mailto:prajyotkumar2003@gmail.com?subject=${encodeURIComponent('Navixa feedback')}&body=${encodeURIComponent(txt || 'Feedback on Navixa:')}`;
  };
  $('[data-copy-fb]', root).onclick = async () => {
    try { await navigator.clipboard.writeText($('[data-fb]', root).value); toast('Copied'); } catch { toast('Could not copy', 'warn'); }
  };
  return root;
}
