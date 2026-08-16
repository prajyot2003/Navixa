// Navixa — Jobs search, AI suggestions (matches), application tracker
import { getState, update } from './store.js';
import { $, $$, el, esc, icon, timeAgo, skeleton, emptyState, toast, modal, uid } from './utils.js';
import { searchJobs, filterJobs, matchJobs } from './api.js';
import { JOB_SOURCES } from './config.js';
import { logActivity, checkAchievements } from './gamify.js';

const COLS = [
  { id: 'saved', label: 'Saved', color: '#818cf8' },
  { id: 'applied', label: 'Applied', color: '#22d3ee' },
  { id: 'interview', label: 'Interview', color: '#f59e0b' },
  { id: 'offer', label: 'Offer', color: '#34d399' },
  { id: 'rejected', label: 'Closed', color: '#94a3b8' },
];

function isSaved(id) { return !!getState().jobs.saved[id]; }

export function toggleSave(job) {
  const saved = isSaved(job.id);
  update((s) => {
    if (saved) { delete s.jobs.saved[job.id]; delete s.jobs.board[job.id]; }
    else { s.jobs.saved[job.id] = job; s.jobs.board[job.id] = s.jobs.board[job.id] || 'saved'; }
  }, { type: 'jobs' });
  if (!saved) { logActivity('job_save'); toast('Saved to your tracker'); }
  checkAchievements();
  return !saved;
}

export function jobCard(job, { match } = {}) {
  const saved = isSaved(job.id);
  const logo = job.logo
    ? `<img src="${esc(job.logo)}" alt="" loading="lazy" onerror="this.replaceWith(this.parentNode.dataset.f)">`
    : (job.company || '?').trim()[0]?.toUpperCase() || '?';
  const card = el(`<div class="card job-card">
    <div class="job-logo" data-f="${esc((job.company || '?')[0] || '?')}">${typeof logo === 'string' && logo.startsWith('<img') ? logo : esc(String(logo))}</div>
    <div class="job-main">
      <div class="job-title"><a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a></div>
      <div class="job-co">${esc(job.company)}${job.visa ? ' · <span class="badge ok">Visa sponsor</span>' : ''}</div>
      <div class="job-meta">
        <span>${icon('pin', 14)}${esc(job.location || '—')}</span>
        ${job.type ? `<span>${icon('clock', 14)}${esc(job.type)}</span>` : ''}
        ${job.level ? `<span>${icon('layers', 14)}${esc(job.level)}</span>` : ''}
        ${job.salary ? `<span>${icon('zap', 14)}${esc(job.salary)}</span>` : ''}
        <span>${icon('calendar', 14)}${timeAgo(job.postedAt)}</span>
        <span class="badge">${esc(JOB_SOURCES[job.source]?.label || job.source)}</span>
      </div>
      ${match?.matched?.length ? `<div class="job-tags">${match.matched.map((m) => `<span class="chip on">${esc(m)}</span>`).join('')}</div>`
        : job.tags?.length ? `<div class="job-tags">${job.tags.slice(0, 5).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="job-side">
      ${match ? `<div class="match-ring" style="--pct:${match.pct}" title="Match score"><span>${match.pct}%</span></div>` : ''}
      <div class="row">
        <button class="icon-btn" data-tailor title="Tailor your resume to this job">${icon('target', 17)}</button>
        <button class="icon-btn" data-save title="${saved ? 'Remove from tracker' : 'Save to tracker'}" style="${saved ? 'color:var(--accent-strong);border-color:var(--accent)' : ''}">${icon(saved ? 'check' : 'plus', 17)}</button>
        <a class="btn btn-soft btn-sm" href="${esc(job.url)}" target="_blank" rel="noopener">Apply ${icon('external', 14)}</a>
      </div>
    </div>
  </div>`);
  $('[data-tailor]', card).onclick = () => {
    import('./tailor-ui.js').then(({ openTailor }) => openTailor(job));
  };
  $('[data-save]', card).onclick = (e) => {
    const nowSaved = toggleSave(job);
    const b = e.currentTarget;
    b.innerHTML = icon(nowSaved ? 'check' : 'plus', 17);
    b.style.cssText = nowSaved ? 'color:var(--accent-strong);border-color:var(--accent)' : '';
  };
  return card;
}

/* ================= Jobs search ================= */
export function jobsView() {
  const root = el('<div></div>');
  const st = { q: '', type: '', remoteOnly: false, source: '', sort: 'auto', loading: false };

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Job search engine</h2><p class="lede">Live listings aggregated from ${Object.values(JOB_SOURCES).map((s) => s.label).join(', ')} — filtered to your criteria.</p></div>
      <button class="btn btn-ghost" data-refresh>${icon('refresh', 16)} Refresh</button>
    </div>
    <div class="filter-bar">
      <div class="search-wrap">${icon('search', 18)}<input class="input" data-q placeholder="Title, skill or company — e.g. react developer" aria-label="Search jobs"></div>
      <select class="select" data-type>
        <option value="">Any type</option><option value="full">Full-time</option><option value="part">Part-time</option>
        <option value="contract">Contract</option><option value="internship">Internship</option>
      </select>
      <select class="select" data-source>
        <option value="">All sources</option>
        ${Object.entries(JOB_SOURCES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
      </select>
      <select class="select" data-sort><option value="auto">Sort: Smart</option><option value="date">Sort: Newest</option></select>
      <label class="switch"><input type="checkbox" data-remote><span class="track"></span>Remote only</label>
    </div>
    <div class="src-status" data-status></div>
    <div class="job-list mt-2" data-list>${skeleton(4)}</div>`;

  const listEl = $('[data-list]', root);
  const statusEl = $('[data-status]', root);
  let all = [];

  async function load(force = false) {
    st.loading = true;
    listEl.innerHTML = skeleton(4);
    const { items, failed } = await searchJobs({ q: st.q, internship: st.type === 'internship', force });
    all = items;
    st.loading = false;
    statusEl.innerHTML = failed?.length
      ? failed.map((f) => `<span class="badge warn">${icon('alert', 12)} ${esc(JOB_SOURCES[f]?.label || f)} unavailable</span>`).join('')
      : '';
    render();
  }

  function render() {
    const jobs = filterJobs(all, st).slice(0, 60);
    listEl.innerHTML = '';
    if (!jobs.length) {
      listEl.innerHTML = emptyState('briefcase', 'No jobs match', 'Try broader keywords or fewer filters. Sources refresh every few minutes.');
      return;
    }
    const count = el(`<p class="muted mb-1">${jobs.length} matching role${jobs.length === 1 ? '' : 's'}</p>`);
    listEl.appendChild(count);
    jobs.forEach((j) => listEl.appendChild(jobCard(j)));
  }

  let searchTimer;
  $('[data-q]', root).addEventListener('input', (e) => {
    st.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (st.q.length > 2) { logActivity('job_search'); load(); } else render();
    }, 550);
  });
  $('[data-type]', root).onchange = (e) => { st.type = e.target.value; if (st.type === 'internship') load(); else render(); };
  $('[data-source]', root).onchange = (e) => { st.source = e.target.value; render(); };
  $('[data-sort]', root).onchange = (e) => { st.sort = e.target.value; render(); };
  $('[data-remote]', root).onchange = (e) => { st.remoteOnly = e.target.checked; render(); };
  $('[data-refresh]', root).onclick = () => load(true);

  load();
  return root;
}

/* ================= Suggestions / matches ================= */
export function matchesView() {
  const root = el('<div></div>');
  const s = getState();
  const p = s.profile;
  let tab = p.role === 'student' ? 'internships' : 'jobs';

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Suggested for you</h2>
      <p class="lede">Matched against your ${p.skills.length} skill${p.skills.length === 1 ? '' : 's'} and ${p.interests.length} interest${p.interests.length === 1 ? '' : 's'}${p.targetRole ? ` — aiming for <b>${esc(p.targetRole)}</b>` : ''}.</p></div>
      <a class="btn btn-ghost" href="#/profile">${icon('edit', 16)} Tune profile</a>
    </div>
    <div class="tabs mb-2">
      <button class="tab ${tab === 'jobs' ? 'active' : ''}" data-tab="jobs">Jobs</button>
      <button class="tab ${tab === 'internships' ? 'active' : ''}" data-tab="internships">Internships</button>
    </div>
    <div class="job-list" data-list>${skeleton(4)}</div>`;

  const listEl = $('[data-list]', root);

  async function load() {
    listEl.innerHTML = skeleton(4);
    if (!p.skills.length && !p.interests.length && !p.targetRole) {
      listEl.innerHTML = emptyState('sparkles', 'Tell us about you first', 'Add skills and interests to your profile and suggestions will appear here.',
        `<a class="btn btn-primary" href="#/profile">Complete profile</a>`);
      return;
    }
    const seedQ = tab === 'internships' ? '' : (p.targetRole || p.skills[0] || '');
    const { items } = await searchJobs({ q: seedQ, internship: tab === 'internships' });
    let matches = matchJobs(items, p, { internships: tab === 'internships' });
    if (matches.length < 5 && seedQ) {
      const broad = await searchJobs({ q: '', internship: tab === 'internships' });
      const seen = new Set(matches.map((m) => m.job.id));
      matches = matches.concat(matchJobs(broad.items, p, { internships: tab === 'internships' }).filter((m) => !seen.has(m.job.id)));
    }
    listEl.innerHTML = '';
    if (!matches.length) {
      listEl.innerHTML = emptyState('briefcase', 'No strong matches right now', 'Sources rotate constantly — check back soon, broaden your skills list, or search manually.',
        `<a class="btn btn-primary" href="#/jobs">Open job search</a>`);
      return;
    }
    matches.slice(0, 30).forEach((m) => listEl.appendChild(jobCard(m.job, { match: m })));
  }

  $$('.tab', root).forEach((t) => t.onclick = () => {
    tab = t.dataset.tab;
    $$('.tab', root).forEach((x) => x.classList.toggle('active', x === t));
    load();
  });

  load();
  return root;
}

/* ================= Tracker (kanban) ================= */
export function trackerView() {
  const root = el('<div></div>');

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Application tracker</h2><p class="lede">Drag cards between stages. Saved jobs land here automatically.</p></div>
      <button class="btn btn-primary" data-add>${icon('plus', 17)} Add manually</button>
    </div>
    <div class="kanban" data-board></div>`;

  const board = $('[data-board]', root);

  function allTracked() {
    const s = getState();
    return { ...s.jobs.saved, ...s.jobs.custom };
  }

  function render() {
    const s = getState();
    const jobs = allTracked();
    board.innerHTML = COLS.map((c) => `
      <div class="kan-col" data-col="${c.id}">
        <div class="kan-head"><span class="dot" style="background:${c.color}"></span>${c.label}<span class="n" data-n></span></div>
        <div data-cards></div>
      </div>`).join('');
    for (const [id, job] of Object.entries(jobs)) {
      const col = s.jobs.board[id] || 'saved';
      const colEl = $(`[data-col="${col}"] [data-cards]`, board) || $(`[data-col="saved"] [data-cards]`, board);
      const note = s.jobs.notes[id];
      const card = el(`<div class="kan-card" draggable="true" data-id="${esc(id)}">
        <b>${esc(job.title)}</b>
        <div class="muted">${esc(job.company)}${job.location ? ' · ' + esc(job.location) : ''}</div>
        ${note ? `<div class="muted" style="margin-top:5px">${icon('edit', 12)} ${esc(note.length > 60 ? note.slice(0, 58) + '…' : note)}</div>` : ''}
        <div class="row">
          <div class="row" style="gap:4px">
            <button class="icon-btn plain" data-note title="Notes">${icon('edit', 15)}</button>
            ${job.url ? `<a class="icon-btn plain" href="${esc(job.url)}" target="_blank" rel="noopener" title="Open listing">${icon('external', 15)}</a>` : ''}
            <button class="icon-btn plain" data-remove title="Remove">${icon('trash', 15)}</button>
          </div>
          <select class="select" data-move style="padding:3px 26px 3px 8px;font-size:12px;min-width:0">
            ${COLS.map((c) => `<option value="${c.id}" ${c.id === col ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      </div>`);
      colEl.appendChild(card);
    }
    $$('.kan-col', board).forEach((colEl) => {
      const n = $$('[data-cards] .kan-card', colEl).length;
      $('[data-n]', colEl).textContent = n || '';
    });
    bindDnd(); bindCardActions();
  }

  function moveCard(id, colId) {
    const prev = getState().jobs.board[id];
    if (prev === colId) return;
    update((s) => { s.jobs.board[id] = colId; }, { type: 'jobs' });
    if (colId === 'applied') logActivity('job_apply'); else logActivity('tracker_move');
    checkAchievements();
    render();
  }

  function bindDnd() {
    $$('.kan-card', board).forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => card.classList.add('dragging'));
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $$('.kan-col', board).forEach((colEl) => {
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('dragover'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('dragover'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault(); colEl.classList.remove('dragover');
        moveCard(e.dataTransfer.getData('text/plain'), colEl.dataset.col);
      });
    });
  }

  function bindCardActions() {
    $$('.kan-card', board).forEach((card) => {
      const id = card.dataset.id;
      $('[data-move]', card).onchange = (e) => moveCard(id, e.target.value);
      $('[data-remove]', card).onclick = () => {
        update((s) => { delete s.jobs.saved[id]; delete s.jobs.custom[id]; delete s.jobs.board[id]; delete s.jobs.notes[id]; }, { type: 'jobs' });
        render();
      };
      $('[data-note]', card).onclick = () => {
        const s = getState();
        const body = el(`<div><div class="field"><label>Notes for this application</label>
          <textarea class="input" rows="5" placeholder="Recruiter name, follow-up dates, prep notes…">${esc(s.jobs.notes[id] || '')}</textarea></div></div>`);
        modal({
          title: 'Application notes', body,
          actions: [
            { label: 'Cancel' },
            { label: 'Save', primary: true, onClick: () => { const v = $('textarea', body).value.trim(); update((st) => { if (v) st.jobs.notes[id] = v; else delete st.jobs.notes[id]; }, { type: 'jobs' }); render(); } },
          ],
        });
      };
    });
  }

  $('[data-add]', root).onclick = () => {
    const body = el(`<div>
      <div class="field"><label>Job title *</label><input class="input" data-f="title" placeholder="Product Designer"></div>
      <div class="field"><label>Company *</label><input class="input" data-f="company" placeholder="Acme"></div>
      <div class="grid grid-2">
        <div class="field"><label>Location</label><input class="input" data-f="location" placeholder="Remote / Pune"></div>
        <div class="field"><label>Listing URL</label><input class="input" data-f="url" placeholder="https://…"></div>
      </div></div>`);
    modal({
      title: 'Track a job manually', body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add to tracker', primary: true,
          onClick: () => {
            const get = (k) => $(`[data-f="${k}"]`, body).value.trim();
            if (!get('title') || !get('company')) { toast('Title and company are required', 'warn'); return false; }
            const id = `custom-${uid()}`;
            update((s) => {
              s.jobs.custom[id] = { id, source: 'custom', title: get('title'), company: get('company'), location: get('location'), url: get('url'), postedAt: Date.now() };
              s.jobs.board[id] = 'saved';
            }, { type: 'jobs' });
            logActivity('job_save');
            render();
          },
        },
      ],
    });
  };

  render();
  return root;
}
