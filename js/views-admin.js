// Navixa — Admin console (#/admin/*) — cloud-backed, role-guarded, fully separate from the client app
import { $, $$, el, esc, icon, avatarHtml, timeAgo, toast, modal, skeleton, emptyState, initials } from './utils.js';
import { getFlags, getBanner, getTips, getPrompts, getCourses, LLM, JOB_SOURCES, SUPABASE } from './config.js';
import {
  cloudEnabled, cloudProfile, getAppConfig, saveAppConfig, fetchAppConfig,
  adminListProfiles, adminSetRole, adminWipeUserState, adminListFeedback, adminSetFeedbackStatus,
} from './cloud.js';

const SECTIONS = [
  { id: 'overview', icon: 'grid', label: 'Overview' },
  { id: 'users', icon: 'user', label: 'Users' },
  { id: 'feedback', icon: 'mail', label: 'Feedback' },
  { id: 'config', icon: 'gear', label: 'Configuration' },
  { id: 'content', icon: 'edit', label: 'Content' },
];

export function adminSection() {
  const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  const part = h.split('/')[1] || 'overview';
  return SECTIONS.some((s) => s.id === part) ? part : 'overview';
}

export function adminView() {
  const root = el('<div></div>');

  if (!cloudEnabled()) {
    root.innerHTML = `
      <div class="admin-bar">${icon('shield', 16)} ADMIN CONSOLE</div>
      <div class="card mt-2" style="max-width:720px">
        <div class="card-title">${icon('info')} Backend not connected yet</div>
        <p class="sub">The admin console needs the Supabase backend so admins and clients are truly separate (roles enforced in the database, not in the browser). Setup takes ~5 minutes:</p>
        <ol class="sub" style="line-height:2;padding-left:20px">
          <li>Create a free project at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a></li>
          <li>Open <b>SQL Editor</b> → paste the contents of <code>supabase-setup.sql</code> (in the project folder) → Run</li>
          <li>In <b>Authentication → Sign In / Providers → Google</b>: enable it and paste your Google Client ID + secret</li>
          <li>In Google Cloud Console, add <code>https://&lt;project&gt;.supabase.co/auth/v1/callback</code> as an authorized redirect URI</li>
          <li>Send the project URL + anon key to your developer (or paste into <code>js/config.js</code>) and redeploy</li>
        </ol>
        <p class="muted">Your email (${esc('prajyotkumar2003@gmail.com')}) is pre-seeded as the first admin in the SQL file.</p>
      </div>`;
    return root;
  }

  const section = adminSection();
  root.innerHTML = `
    <div class="admin-bar">${icon('shield', 16)} ADMIN CONSOLE <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">— signed in as ${esc(cloudProfile()?.email || '')}</span></div>
    <div class="admin-nav">
      ${SECTIONS.map((s) => `<a class="chip ${s.id === section ? 'on' : ''}" href="#/admin/${s.id}">${icon(s.icon, 14)} ${s.label}</a>`).join('')}
      <a class="chip" href="#/dashboard" style="margin-left:auto">${icon('chevL', 14)} Back to app</a>
    </div>
    <div data-pane class="mt-2">${skeleton(3)}</div>`;

  const pane = $('[data-pane]', root);
  ({ overview, users, feedback, config, content })[section](pane);
  return root;
}

/* ================= Overview ================= */
async function overview(pane) {
  let profiles = [], fb = [];
  try { [profiles, fb] = await Promise.all([adminListProfiles(), adminListFeedback()]); }
  catch (e) { pane.innerHTML = errCard(e); return; }
  const now = Date.now(), day = 86400e3;
  const active7 = profiles.filter((p) => now - new Date(p.last_seen).getTime() < 7 * day).length;
  const activeToday = profiles.filter((p) => now - new Date(p.last_seen).getTime() < day).length;
  const admins = profiles.filter((p) => p.role === 'admin').length;
  const newFb = fb.filter((f) => f.status === 'new').length;

  // signups per week (last 8 weeks)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = now - (7 - i + 1) * 7 * day, end = start + 7 * day;
    return profiles.filter((p) => { const t = new Date(p.created_at).getTime(); return t >= start && t < end; }).length;
  });
  const maxW = Math.max(1, ...weeks);
  const top = [...profiles].sort((a, b) => (b.xp || 0) - (a.xp || 0)).slice(0, 8);

  pane.innerHTML = `
    <div class="stat-tiles">
      ${tile('user', profiles.length, 'total users')}
      ${tile('zap', activeToday, 'active today')}
      ${tile('calendar', active7, 'active this week')}
      ${tile('mail', newFb, 'new feedback')}
    </div>
    <div class="grid grid-2 mt-2">
      <div class="card">
        <div class="card-title">${icon('grid')} Signups — last 8 weeks</div>
        <div class="admin-bars">${weeks.map((w) => `<div title="${w} signups"><i style="height:${Math.round((w / maxW) * 100)}%"></i><span>${w}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="card-title">${icon('trophy')} Most active users</div>
        ${top.length ? top.map((p) => `
          <div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)">
            ${avatarHtml({ name: p.name, picture: p.avatar_url }, 28)}
            <span style="flex:1;min-width:0"><b style="font-size:13.5px">${esc(p.name || p.email)}</b> ${p.role === 'admin' ? '<span class="badge acc">admin</span>' : ''}</span>
            <span class="muted">L${p.level} · ${p.xp} XP · 🔥${p.streak}</span>
          </div>`).join('') : '<p class="muted">No users yet.</p>'}
      </div>
    </div>
    <p class="muted mt-2">${icon('shield', 14)} Admins see profile stats only — each user's resume, chats and tracker data stay private to them (enforced by database row-level security).</p>`;
}

const tile = (ic, n, label) => `<div class="stat-tile">${icon(ic, 18)}<b>${n}</b><span>${label}</span></div>`;
const errCard = (e) => `<div class="card"><div class="card-title">${icon('alert')} Could not load</div><p class="sub">${esc(e.message)}</p></div>`;

/* ================= Users ================= */
async function users(pane) {
  pane.innerHTML = `
    <div class="filter-bar">
      <div class="search-wrap">${icon('search', 18)}<input class="input" data-q placeholder="Search name or email…"></div>
      <button class="btn btn-ghost" data-reload>${icon('refresh', 15)} Reload</button>
    </div>
    <div data-list>${skeleton(3)}</div>`;
  const listEl = $('[data-list]', pane);
  const me = cloudProfile();

  async function load(q = '') {
    listEl.innerHTML = skeleton(3);
    let profiles;
    try { profiles = await adminListProfiles({ q }); }
    catch (e) { listEl.innerHTML = errCard(e); return; }
    if (!profiles.length) { listEl.innerHTML = emptyState('user', 'No users found', q ? 'Try another search.' : 'Users appear here after their first Google sign-in.'); return; }
    const adminCount = profiles.filter((p) => p.role === 'admin').length;
    listEl.innerHTML = `<div class="card" style="padding:6px 0;overflow-x:auto"><table class="admin-table">
      <thead><tr><th>User</th><th>Role</th><th>Level</th><th>XP</th><th>Streak</th><th>Jobs</th><th>Joined</th><th>Last seen</th><th></th></tr></thead>
      <tbody>${profiles.map((p) => `
        <tr data-id="${esc(p.id)}">
          <td><span class="row" style="gap:8px">${avatarHtml({ name: p.name, picture: p.avatar_url }, 28)}<span style="min-width:0"><b>${esc(p.name || '—')}</b><br><span class="muted">${esc(p.email || '')}</span></span></span></td>
          <td><select class="select" data-role style="padding:4px 26px 4px 8px;font-size:12.5px">
            <option value="client" ${p.role === 'client' ? 'selected' : ''}>client</option>
            <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>admin</option>
          </select></td>
          <td>${p.level}</td><td>${p.xp}</td><td>${p.streak}🔥</td>
          <td>${(p.stats?.saved ?? 0)} / ${(p.stats?.applied ?? 0)}</td>
          <td class="muted">${new Date(p.created_at).toLocaleDateString()}</td>
          <td class="muted">${timeAgo(p.last_seen)}</td>
          <td><button class="icon-btn plain" data-wipe title="Wipe this user's app data">${icon('trash', 15)}</button></td>
        </tr>`).join('')}</tbody></table></div>
      <p class="muted mt-1">Jobs column = saved / applied. Wiping resets a user's cloud data (they keep their account). Full account deletion lives in the Supabase dashboard → Authentication.</p>`;

    $$('tr[data-id]', listEl).forEach((tr) => {
      const id = tr.dataset.id;
      const p = profiles.find((x) => x.id === id);
      $('[data-role]', tr).onchange = async (e) => {
        const role = e.target.value;
        if (p.id === me?.id && role !== 'admin' && adminCount <= 1) {
          toast('You are the last admin — appoint another admin first', 'warn');
          e.target.value = 'admin'; return;
        }
        try { await adminSetRole(id, role); toast(`${p.name || p.email} is now ${role}`); }
        catch (err) { toast(err.message, 'warn'); e.target.value = p.role; }
      };
      $('[data-wipe]', tr).onclick = () => modal({
        title: 'Wipe user data?',
        body: `<p class="sub">This permanently deletes <b>${esc(p.name || p.email)}</b>'s cloud app data (resume, tracker, chats, streaks) and resets their stats. Their account and role stay. No undo.</p>`,
        actions: [{ label: 'Cancel' }, {
          label: 'Wipe data', danger: true,
          onClick: async () => { try { await adminWipeUserState(id); toast('User data wiped'); load($('[data-q]', pane).value.trim()); } catch (err) { toast(err.message, 'warn'); } },
        }],
      });
    });
  }

  let t;
  $('[data-q]', pane).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 400); });
  $('[data-reload]', pane).onclick = () => load($('[data-q]', pane).value.trim());
  load();
}

/* ================= Feedback ================= */
async function feedback(pane) {
  let items;
  try { items = await adminListFeedback(); }
  catch (e) { pane.innerHTML = errCard(e); return; }
  if (!items.length) { pane.innerHTML = emptyState('mail', 'Inbox zero', 'Client feedback from the Help page lands here.'); return; }
  const STATUSES = ['new', 'seen', 'done'];
  pane.innerHTML = items.map((f) => `
    <div class="card mb-1" data-id="${f.id}" style="padding:14px 18px">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap">
        <span class="row" style="gap:8px">${avatarHtml({ name: f.name || f.email }, 26)}
          <b style="font-size:13.5px">${esc(f.name || 'Anonymous')}</b>
          <span class="muted">${esc(f.email || '')} · ${timeAgo(f.created_at)}</span></span>
        <span class="row" style="gap:6px">${STATUSES.map((s) => `<button class="chip ${f.status === s ? 'on' : ''}" data-status="${s}">${s}</button>`).join('')}</span>
      </div>
      <p class="sub mt-1" style="white-space:pre-wrap">${esc(f.message)}</p>
    </div>`).join('');
  $$('[data-id]', pane).forEach((card) => {
    $$('[data-status]', card).forEach((b) => b.onclick = async () => {
      try {
        await adminSetFeedbackStatus(Number(card.dataset.id), b.dataset.status);
        $$('[data-status]', card).forEach((x) => x.classList.toggle('on', x === b));
      } catch (e) { toast(e.message, 'warn'); }
    });
  });
}

/* ================= Configuration ================= */
async function config(pane) {
  try { await fetchAppConfig(); } catch (e) { pane.innerHTML = errCard(e); return; }
  const cfg = getAppConfig();
  const flags = { jobs: true, matches: true, resume: true, chat: true, learn: true, streaks: true, tracker: true, ...(cfg.flags || {}) };
  const FLAG_LABELS = { jobs: 'Job search', matches: 'Suggestions', resume: 'Resume builder', chat: 'AI chat', learn: 'Learning hub', streaks: 'Streaks', tracker: 'Tracker' };

  pane.innerHTML = `
    <div class="card">
      <div class="card-title">${icon('flag')} Announcement banner</div>
      <p class="muted mb-1">Shown to every client on their dashboard. Leave empty for none.</p>
      <input class="input" data-banner value="${esc(cfg.banner || '')}" placeholder="e.g. 🎉 New: mock interviews in AI chat — try the Interview Coach mode!">
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('layers')} Feature flags <span class="more muted">turn client features on/off for everyone</span></div>
      <div class="row wrap" style="gap:14px">
        ${Object.entries(FLAG_LABELS).map(([k, label]) => `<label class="switch"><input type="checkbox" data-flag="${k}" ${flags[k] ? 'checked' : ''}><span class="track"></span>${label}</label>`).join('')}
      </div>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('sparkles')} AI defaults</div>
      <div class="field"><label>Default model (keyless gateway)</label>
        <select class="select" data-model>${LLM.providers[0].models.map((m) => `<option ${((cfg.llmModel || LLM.defaultModel) === m) ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('shield')} Backend</div>
      <p class="sub">Supabase project: <code>${esc(SUPABASE.url)}</code> · schema <code>supabase-setup.sql</code> · RLS active.</p>
    </div>
    <div class="row mt-2"><button class="btn btn-primary" data-save>${icon('check', 16)} Save configuration</button><span class="muted" data-out></span></div>`;

  $('[data-save]', pane).onclick = async (e) => {
    e.target.disabled = true;
    const patch = {
      banner: $('[data-banner]', pane).value.trim(),
      flags: Object.fromEntries($$('[data-flag]', pane).map((i) => [i.dataset.flag, i.checked])),
      llmModel: $('[data-model]', pane).value,
    };
    try { await saveAppConfig(patch); toast('Configuration saved — live for all clients'); }
    catch (err) { toast(err.message, 'warn'); }
    e.target.disabled = false;
  };
}

/* ================= Content ================= */
async function content(pane) {
  try { await fetchAppConfig(); } catch (e) { pane.innerHTML = errCard(e); return; }
  const cfg = getAppConfig();
  const lines = (arr) => (arr || []).join('\n');

  pane.innerHTML = `
    <p class="sub mb-2">Override the built-in content clients see. Empty = use Navixa's defaults.</p>
    <div class="card">
      <div class="card-title">${icon('sparkles')} Tips of the day <span class="more muted">one per line</span></div>
      <textarea class="input" data-tips rows="6" placeholder="${esc(getTips()[0])}">${esc(lines(cfg.tips))}</textarea>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('message')} Chat quick prompts <span class="more muted">one per line</span></div>
      <textarea class="input" data-prompts rows="5" placeholder="${esc(getPrompts()[0])}">${esc(lines(cfg.prompts))}</textarea>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('book')} Curated courses <span class="more muted">JSON array: {match[], title, by, url, kind}</span></div>
      <textarea class="input mono" data-courses rows="8" placeholder='${esc(JSON.stringify(getCourses().slice(0, 1), null, 1))}'>${esc(cfg.courses ? JSON.stringify(cfg.courses, null, 1) : '')}</textarea>
    </div>
    <div class="row mt-2"><button class="btn btn-primary" data-save>${icon('check', 16)} Save content</button></div>`;

  $('[data-save]', pane).onclick = async (e) => {
    const splitLines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    let courses = null;
    const rawCourses = $('[data-courses]', pane).value.trim();
    if (rawCourses) {
      try {
        courses = JSON.parse(rawCourses);
        if (!Array.isArray(courses) || courses.some((c) => !c.title || !c.url)) throw new Error('each course needs title + url');
      } catch (err) { toast(`Courses JSON invalid: ${err.message}`, 'warn'); return; }
    }
    e.target.disabled = true;
    try {
      await saveAppConfig({
        tips: splitLines($('[data-tips]', pane).value),
        prompts: splitLines($('[data-prompts]', pane).value),
        courses,
      });
      toast('Content saved — live for all clients');
    } catch (err) { toast(err.message, 'warn'); }
    e.target.disabled = false;
  };
}
