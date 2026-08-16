// Navixa — Learn (playlist finder: videos + articles + courses) and Streaks
import { getState, update } from './store.js';
import { $, $$, el, esc, icon, timeAgo, fmtNum, skeleton, emptyState, toast } from './utils.js';
import { searchVideos, searchArticles, curatedCourses, llmChat, systemPrompt } from './api.js';
import { logActivity, checkAchievements, computeStreak, streakAliveToday, heatmapData, achievementList, goalsToday, levelProgress } from './gamify.js';
import { md } from './chat.js';

/* ================= Learn ================= */

function isSavedItem(id) { return !!getState().learn.saved[id]; }
function isDoneItem(id) { return !!getState().learn.done[id]; }

function toggleSaveItem(item) {
  const was = isSavedItem(item.id);
  update((s) => { if (was) delete s.learn.saved[item.id]; else s.learn.saved[item.id] = { ...item, savedAt: Date.now() }; }, { type: 'learn' });
  if (!was) { logActivity('learn_save'); toast('Added to your playlist'); }
  checkAchievements();
  return !was;
}
function toggleDoneItem(item) {
  const was = isDoneItem(item.id);
  update((s) => {
    if (was) delete s.learn.done[item.id];
    else { s.learn.done[item.id] = Date.now(); if (!s.learn.saved[item.id]) s.learn.saved[item.id] = { ...item, savedAt: Date.now() }; }
  }, { type: 'learn' });
  if (!was) { logActivity('learn_complete'); toast('Marked complete — nice work!', 'xp'); }
  checkAchievements();
  return !was;
}

function mediaCard(item) {
  const saved = isSavedItem(item.id), done = isDoneItem(item.id);
  const thumb = item.kind === 'video'
    ? `<a class="media-thumb" href="${esc(item.url)}" target="_blank" rel="noopener">
        <img src="${esc(item.thumb || `https://i.ytimg.com/vi/${esc(item.id.replace('yt-', ''))}/hqdefault.jpg`)}" alt="" loading="lazy">
        ${item.duration ? `<span class="dur">${esc(item.duration)}</span>` : ''}
        <span class="play-ov">${icon('play', 44)}</span></a>`
    : item.cover ? `<a class="media-thumb" href="${esc(item.url)}" target="_blank" rel="noopener"><img src="${esc(item.cover)}" alt="" loading="lazy"></a>` : '';
  const card = el(`<div class="card media-card">
    ${thumb}
    <div class="media-body">
      <div class="media-title"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></div>
      <div class="media-sub">
        <span>${esc(item.by || '')}</span>
        ${item.kind === 'video' && item.views ? `<span>${fmtNum(item.views)} views</span>` : ''}
        ${item.mins ? `<span>${item.mins} min read</span>` : ''}
        ${item.reactions ? `<span>♥ ${fmtNum(item.reactions)}</span>` : ''}
        ${item.kindLabel ? `<span class="badge acc">${esc(item.kindLabel)}</span>` : ''}
      </div>
      <div class="media-actions">
        <button class="btn btn-sm ${saved ? 'btn-soft' : 'btn-ghost'}" data-save>${icon(saved ? 'check' : 'plus', 14)} ${saved ? 'Saved' : 'Save'}</button>
        <button class="btn btn-sm ${done ? 'btn-soft' : 'btn-ghost'}" data-done title="Mark complete">${icon('check', 14)} ${done ? 'Done' : 'Complete'}</button>
      </div>
    </div>
  </div>`);
  $('[data-save]', card).onclick = (e) => { const now = toggleSaveItem(item); e.currentTarget.className = `btn btn-sm ${now ? 'btn-soft' : 'btn-ghost'}`; e.currentTarget.innerHTML = `${icon(now ? 'check' : 'plus', 14)} ${now ? 'Saved' : 'Save'}`; };
  $('[data-done]', card).onclick = (e) => { const now = toggleDoneItem(item); e.currentTarget.className = `btn btn-sm ${now ? 'btn-soft' : 'btn-ghost'}`; e.currentTarget.innerHTML = `${icon('check', 14)} ${now ? 'Done' : 'Complete'}`; };
  return card;
}

export function learnView() {
  const root = el('<div></div>');
  const s = getState();
  let tab = 'discover';
  let kind = 'all';
  let q = s.learn.lastQuery || s.profile.interests[0] || s.profile.targetRole || 'career growth';

  root.innerHTML = `
    <div class="page-head">
      <div><h2>Learning hub</h2><p class="lede">Videos, articles and free courses matched to your goals. Build your own playlist.</p></div>
      <button class="btn btn-primary" data-path>${icon('sparkles', 16)} AI learning path</button>
    </div>
    <div class="tabs mb-2">
      <button class="tab active" data-tab="discover">Discover</button>
      <button class="tab" data-tab="playlist">My playlist <span class="nav-badge" style="background:var(--surface-3);color:var(--text-2)">${Object.keys(s.learn.saved).length}</span></button>
    </div>
    <div data-pane></div>`;

  const pane = $('[data-pane]', root);

  function renderDiscover() {
    pane.innerHTML = `
      <div class="filter-bar">
        <div class="search-wrap">${icon('search', 18)}<input class="input" data-q value="${esc(q)}" placeholder="What do you want to learn? e.g. react hooks, sql joins…"></div>
        <select class="select" data-kind>
          <option value="all">Everything</option><option value="video">Videos</option>
          <option value="article">Articles</option><option value="course">Courses</option>
        </select>
        <button class="btn btn-primary" data-go>Search</button>
      </div>
      <div class="chip-cloud mb-2" data-sugg></div>
      <div data-gap class="mb-2"></div>
      <div data-results><div class="media-grid">${skeleton(6, 'card media-card')}</div></div>`;
    import('./tailor-ui.js').then(({ skillGapPanel }) => {
      const host = $('[data-gap]', pane);
      if (host) host.appendChild(skillGapPanel());
    });
    const sugg = [...s.profile.interests.slice(0, 4), ...s.profile.skills.slice(0, 3)].filter(Boolean).slice(0, 6);
    $('[data-sugg]', pane).innerHTML = sugg.map((x) => `<button class="chip-pick">${esc(x)}</button>`).join('');
    $$('.chip-pick', pane).forEach((c) => c.onclick = () => { q = c.textContent; $('[data-q]', pane).value = q; load(); });
    $('[data-go]', pane).onclick = () => { q = $('[data-q]', pane).value.trim() || q; load(); };
    $('[data-q]', pane).addEventListener('keydown', (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); load(); } });
    $('[data-kind]', pane).value = kind;
    $('[data-kind]', pane).onchange = (e) => { kind = e.target.value; load(); };
    // skill-gap panel asks us to search for a specific skill
    const onGapSearch = (e) => {
      if (!root.isConnected) { window.removeEventListener('navixa:learn-search', onGapSearch); return; }
      q = String(e.detail || '').trim() || q;
      const input = $('[data-q]', pane);
      if (input) input.value = q;
      load();
      $('[data-results]', pane)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('navixa:learn-search', onGapSearch);
    load();
  }

  async function load() {
    update((st) => { st.learn.lastQuery = q; }, { type: 'learn' });
    const box = $('[data-results]', pane);
    box.innerHTML = `<div class="media-grid">${skeleton(6, 'card media-card')}</div>`;
    const wantV = kind === 'all' || kind === 'video';
    const wantA = kind === 'all' || kind === 'article';
    const wantC = kind === 'all' || kind === 'course';
    const [videos, articles] = await Promise.all([
      wantV ? searchVideos(q) : Promise.resolve([]),
      wantA ? searchArticles(q) : Promise.resolve([]),
    ]);
    const courses = wantC ? curatedCourses(q, s.profile.interests).map((c, i) => ({
      id: `course-${i}-${c.title.replace(/\W+/g, '').slice(0, 20)}`, kind: 'course', kindLabel: c.kind,
      title: c.title, by: c.by, url: c.url,
    })) : [];
    const vids = videos.map((v) => ({ ...v, id: v.id?.startsWith('yt-') ? v.id : `yt-${v.id}` }));
    box.innerHTML = '';
    const sections = [
      ['Videos', vids, 'play', q],
      ['Articles', articles, 'book', null],
      ['Free courses & paths', courses, 'award', null],
    ];
    let any = false;
    for (const [label, items, ic, fallbackQ] of sections) {
      if ((kind !== 'all') && !items.length && !fallbackQ) continue;
      if (kind === 'all' || items.length || fallbackQ) {
        if (!items.length && !fallbackQ) continue;
        const sec = el(`<div class="mt-2"><div class="card-title">${icon(ic)} ${label}</div><div class="media-grid"></div></div>`);
        const grid = $('.media-grid', sec);
        if (items.length) { any = true; items.slice(0, 9).forEach((it) => grid.appendChild(mediaCard(it))); }
        else if (fallbackQ && (kind === 'all' || kind === 'video')) {
          any = true;
          grid.appendChild(el(`<div class="card" style="grid-column:1/-1">
            <p class="sub">${icon('info', 16)} Live video results are unavailable right now — open your search directly:</p>
            <div class="row wrap mt-1">
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' tutorial')}">${icon('play', 14)} YouTube: “${esc(q)} tutorial”</a>
              <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' full course')}">${icon('play', 14)} “${esc(q)} full course”</a>
            </div></div>`));
        }
        if ($$('.media-grid > *', sec).length) box.appendChild(sec);
      }
    }
    if (!any) box.innerHTML = emptyState('book', 'Nothing found', 'Try a broader topic — e.g. “python”, “product design”, “data analytics”.');
  }

  function renderPlaylist() {
    const saved = Object.values(getState().learn.saved).sort((a, b) => b.savedAt - a.savedAt);
    if (!saved.length) {
      pane.innerHTML = emptyState('book', 'Your playlist is empty', 'Save videos, articles and courses from Discover and they will live here.',
        '<button class="btn btn-primary" data-back>Browse resources</button>');
      $('[data-back]', pane).onclick = () => switchTab('discover');
      return;
    }
    const doneCount = saved.filter((x) => isDoneItem(x.id)).length;
    pane.innerHTML = `<p class="sub mb-2">${doneCount}/${saved.length} completed ${doneCount === saved.length && saved.length ? '— playlist crushed! 🏁' : ''}</p><div class="media-grid"></div>`;
    const grid = $('.media-grid', pane);
    saved.forEach((it) => grid.appendChild(mediaCard(it)));
  }

  function switchTab(t) {
    tab = t;
    $$('.tab', root).forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
    if (t === 'discover') renderDiscover(); else renderPlaylist();
  }
  $$('.tab', root).forEach((t) => t.onclick = () => switchTab(t.dataset.tab));

  $('[data-path]', root).onclick = async () => {
    const { modal } = await import('./utils.js');
    const body = el(`<div><p class="sub mb-2">A step-by-step path to <b>${esc(s.profile.targetRole || q)}</b>, built by the AI from your profile.</p><div data-out class="sub"><div class="sk-line w90"></div><div class="sk-line w60"></div><div class="sk-line w90"></div></div></div>`);
    modal({ title: 'AI learning path', body, wide: true, actions: [{ label: 'Close', primary: true }] });
    try {
      const text = await llmChat([
        { role: 'system', content: systemPrompt('copilot') },
        { role: 'user', content: `Create a practical 6-step learning path for becoming a ${s.profile.targetRole || q}. For each step: a bold title, 1-2 sentence description, and one concrete free resource suggestion (name it, no fake URLs). Keep it under 300 words.` },
      ], {});
      $('[data-out]', body).innerHTML = md(text);
      logActivity('learn_save');
    } catch (e) {
      $('[data-out]', body).innerHTML = `<p>⚠️ The free AI service is busy (${esc(e.message)}). Try again shortly.</p>`;
    }
  };

  renderDiscover();
  return root;
}

/* ================= Streaks ================= */
export function streaksView() {
  const root = el('<div></div>');
  const s = getState();
  const g = s.gamify;
  const streak = computeStreak();
  const alive = streakAliveToday();
  const goals = goalsToday();
  const lp = levelProgress(g.xp);
  const badges = achievementList();
  const earnedCount = badges.filter((b) => b.earned).length;
  const days = heatmapData(22);
  const activeDays = Object.keys(g.activity).length;

  root.innerHTML = `
    <div class="page-head"><div><h2>Streaks & achievements</h2><p class="lede">Show up daily — momentum is the real career hack.</p></div></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="streak-hero">
          <div class="flame-big ${streak ? '' : 'cold'}">${icon('flame', 54)}</div>
          <div class="streak-count">
            <b>${streak} day${streak === 1 ? '' : 's'}</b>
            <span>${alive ? 'You’ve shown up today. Keep it rolling!' : streak ? 'Do one action today to keep the flame alive.' : 'Do anything today to start a streak.'}</span>
            <div class="row mt-1 wrap">
              <span class="badge acc">${icon('shield', 13)} ${g.shields || 0} shield${g.shields === 1 ? '' : 's'}</span>
              <span class="badge">${icon('calendar', 13)} ${activeDays} active days</span>
              <span class="badge">${icon('zap', 13)} ${g.xp} XP · Level ${lp.lvl}</span>
            </div>
          </div>
        </div>
        <p class="muted mt-2">${icon('info', 14)} Earn a shield every 7-day streak (max 3). A shield auto-covers one missed day.</p>
      </div>
      <div class="card">
        <div class="card-title">${icon('target')} Today’s goals</div>
        ${goals.map((goal) => `
          <div class="goal-item ${goal.done ? 'done' : ''}">
            <span class="goal-check">${icon('check', 15)}</span>
            <div><div class="g-label">${esc(goal.label)}</div><div class="g-hint">${esc(goal.hint)}</div></div>
          </div>`).join('')}
        <p class="muted mt-1">Each goal gives +10 XP. Goals reset at midnight.</p>
      </div>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('grid')} Activity — last ${Math.round(days.length / 7)} weeks</div>
      <div class="heatmap">${days.map((d) => {
        const l = d.count >= 4 ? 3 : d.count >= 2 ? 2 : d.count >= 1 ? 1 : d.count === 0.5 ? 's' : 0;
        return `<span class="heat-cell" data-l="${l}" title="${d.key}: ${d.count === 0.5 ? 'shielded' : d.count + ' actions'}"></span>`;
      }).join('')}</div>
    </div>
    <div class="card mt-2">
      <div class="card-title">${icon('trophy')} Achievements <span class="more muted">${earnedCount}/${badges.length}</span></div>
      <div class="badge-grid">
        ${badges.map((b) => `<div class="badge-card ${b.earned ? '' : 'locked'}" title="${b.earned ? 'Earned ' + new Date(b.at).toLocaleDateString() : 'Locked'}">
          <div class="b-ic">${icon(b.icon, 24)}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  return root;
}
