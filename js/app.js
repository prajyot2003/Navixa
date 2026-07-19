// Navixa — app shell: router, layout, nav, cloud boot, admin guard
import { getState, currentUser, subscribe, applyTheme, globalSettings, signIn, primeUserData, saveGlobal } from './store.js';
import { $, $$, el, esc, icon, avatarHtml, toast } from './utils.js';
import { signOut } from './auth.js';
import { computeStreak, applyShieldIfNeeded, markVisited } from './gamify.js';
import { getFlags, setRuntimeConfig } from './config.js';
import { cloudEnabled, initCloud, onCloud, cloudProfile, loadProfile, pullState, isAdmin, getAppConfig, cloudSession, flushPush } from './cloud.js';
import { loginView, onboardingView, dashboardView, profileView, settingsView, helpView } from './views-home.js';
import { jobsView, matchesView, trackerView } from './views-jobs.js';
import { learnView, streaksView } from './views-learn.js';
import { chatView } from './chat.js';
import { resumeView } from './resume.js';
import { adminView } from './views-admin.js';
import { initPalette, openPalette } from './palette.js';
import { initMotion, withTransition, moveNavIndicator } from './motion.js';

const ROUTES = {
  dashboard: { title: 'Dashboard', icon: 'home', view: dashboardView, nav: 'main', always: true },
  matches: { title: 'Suggestions', icon: 'sparkles', view: matchesView, nav: 'main' },
  jobs: { title: 'Job search', icon: 'briefcase', view: jobsView, nav: 'main' },
  resume: { title: 'Resume', icon: 'file', view: resumeView, nav: 'main' },
  chat: { title: 'AI chat', icon: 'message', view: chatView, nav: 'main' },
  learn: { title: 'Learn', icon: 'play', view: learnView, nav: 'main' },
  streaks: { title: 'Streaks', icon: 'flame', view: streaksView, nav: 'main' },
  tracker: { title: 'Tracker', icon: 'kanban', view: trackerView, nav: 'main' },
  profile: { title: 'Profile', icon: 'user', view: profileView, nav: 'account', always: true },
  settings: { title: 'Settings', icon: 'gear', view: settingsView, nav: 'account', always: true },
  help: { title: 'Help', icon: 'help', view: helpView, nav: 'account', always: true },
  admin: { title: 'Admin console', icon: 'shield', view: adminView, nav: 'admin', always: true },
};

const app = $('#app');
let layoutEl = null;

function route() {
  const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  if (/^(access_token|error|provider_token|code)=/.test(h)) return 'dashboard'; // OAuth callback hash — Supabase parses it
  const base = h.split('/')[0] || 'dashboard';
  return ROUTES[base] ? base : 'dashboard';
}

export function go(name) { location.hash = `#/${name}`; }

function renderLogin() {
  layoutEl = null;
  app.innerHTML = '';
  app.appendChild(loginView({ onDone: () => { location.hash = '#/dashboard'; render(); } }));
}

function renderOnboarding() {
  layoutEl = null;
  app.innerHTML = '';
  app.appendChild(onboardingView({ onDone: () => { location.hash = '#/dashboard'; render(); } }));
}

function navItems(group) {
  const flags = getFlags();
  return Object.entries(ROUTES)
    .filter(([k, r]) => r.nav === group && (r.always || flags[k] !== false))
    .map(([k, r]) => `<a class="nav-item" data-nav="${k}" href="#/${k}">${icon(r.icon, 19)}${r.title}${k === 'streaks' ? `<span class="nav-badge" data-streak-badge></span>` : ''}</a>`)
    .join('');
}

function buildLayout() {
  const u = currentUser();
  const admin = isAdmin();
  layoutEl = el(`<div class="layout">
    <div class="scrim" data-scrim></div>
    <aside class="sidebar" aria-label="Navigation">
      <a class="brand" href="#/dashboard" aria-label="Navixa — go to dashboard">
        <span class="brand-mark">${icon('compass', 21)}</span>
        <span class="brand-name">Navi<em>xa</em></span>
      </a>
      <button class="kbd-hint" data-palette title="Command palette">${icon('search', 15)} <span>Quick find</span> <kbd>${navigator.platform?.includes('Mac') ? '⌘' : '^'}K</kbd></button>
      <nav class="nav">
        <span class="nav-ind" aria-hidden="true"></span>
        <div class="nav-label">Workspace</div>
        ${navItems('main')}
        <div class="nav-label">Account</div>
        ${navItems('account')}
        ${admin ? `<div class="nav-label">Admin</div><a class="nav-item nav-admin" data-nav="admin" href="#/admin">${icon('shield', 19)}<span>Admin console</span></a>` : ''}
      </nav>
      <div class="side-foot">
        <button class="side-user" data-nav-profile title="Open profile">
          ${avatarHtml(u, 36)}
          <span class="u-meta"><span class="u-name">${esc((u?.name || '').split(' ')[0])}${admin ? ' <span class="badge acc">admin</span>' : ''}</span><span class="u-sub">${esc(u?.cloud ? u.email : 'Local account')}</span></span>
          ${icon('logout', 17)}
        </button>
        <div class="user-menu">
          <button class="nav-item" data-signout>${icon('logout', 17)}<span>Sign out</span></button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn hamburger" data-menu aria-label="Menu">${icon('menu', 19)}</button>
        <h1 data-title class="top-title"></h1>
        <div class="spacer"></div>
        <span class="streak-pill" title="Current streak — do one action a day to grow it">${icon('flame', 16)}<span data-streak>0</span></span>
        <button class="icon-btn" data-theme-toggle title="Toggle theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 18)}</button>
      </header>
      <div class="content" data-outlet></div>
    </div>
  </div>`);

  const foot = $('.side-foot', layoutEl);
  $('[data-signout]', layoutEl).onclick = async () => { await flushPush(); signOut(); location.hash = '#/'; render(); };
  $('[data-palette]', layoutEl).onclick = () => openPalette();
  $('[data-nav-profile]', layoutEl).onclick = (e) => { e.stopPropagation(); foot.classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.side-foot')) foot?.classList.remove('open'); });
  $('[data-theme-toggle]', layoutEl).onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    saveGlobal({ theme: next }); applyTheme(); updateThemeBtn();
  };
  $('[data-menu]', layoutEl).onclick = () => { $('.sidebar', layoutEl).classList.add('open'); $('[data-scrim]', layoutEl).classList.add('show'); };
  $('[data-scrim]', layoutEl).onclick = closeMenu;
  $$('.nav-item[data-nav]', layoutEl).forEach((a) => a.addEventListener('click', closeMenu));
  $('.brand', layoutEl).addEventListener('click', closeMenu);
  app.innerHTML = '';
  app.appendChild(layoutEl);
}

function closeMenu() {
  $('.sidebar', layoutEl)?.classList.remove('open');
  $('[data-scrim]', layoutEl)?.classList.remove('show');
}

function updateThemeBtn() {
  const b = $('[data-theme-toggle]', layoutEl);
  if (b) b.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 18);
}

function updateChrome() {
  if (!layoutEl) return;
  const r = route();
  $('[data-title]', layoutEl).textContent = ROUTES[r].title;
  $$('.nav-item[data-nav]', layoutEl).forEach((a) => a.classList.toggle('active', a.dataset.nav === r));
  const streak = computeStreak();
  const sEl = $('[data-streak]', layoutEl); if (sEl) sEl.textContent = streak;
  const badge = $('[data-streak-badge]', layoutEl); if (badge) { badge.textContent = streak || ''; badge.style.display = streak ? '' : 'none'; }
  moveNavIndicator($('.nav', layoutEl));
  document.title = `${ROUTES[r].title} · Navixa`;
}

export function rebuildLayout() { layoutEl = null; }

export function render() {
  applyTheme();
  const u = currentUser();
  if (!u) { renderLogin(); document.title = 'Navixa — navigate your career'; return; }
  const s = getState();
  if (!s.profile.onboarded) { renderOnboarding(); document.title = 'Welcome · Navixa'; return; }
  let r = route();
  // ---- guards: admin console is admin-only; flagged-off features redirect ----
  if (r === 'admin' && cloudEnabled() && !isAdmin()) {
    toast('That area is for administrators', 'warn');
    location.hash = '#/dashboard';
    r = 'dashboard';
  }
  if (r !== 'admin' && !ROUTES[r].always && getFlags()[r] === false) {
    toast('This feature is currently disabled', 'warn');
    location.hash = '#/dashboard';
    r = 'dashboard';
  }
  const fresh = !layoutEl || !document.body.contains(layoutEl);
  if (fresh) buildLayout();
  const outlet = $('[data-outlet]', layoutEl);
  const swap = () => { outlet.innerHTML = ''; outlet.appendChild(ROUTES[r].view()); window.scrollTo(0, 0); };
  if (fresh) swap(); else withTransition(swap);
  updateChrome();
  markVisited(r);
}

window.addEventListener('hashchange', render);
subscribe((evt) => { if (evt.type === 'gamify' || evt.type === 'achievement') updateChrome(); });

// ---------- boot ----------
applyTheme();
initPalette();
initMotion();
(async () => {
  try {
    if (cloudEnabled()) {
      const { session } = await initCloud();
      setRuntimeConfig(getAppConfig());
      if (session) await adoptCloudSession();
      onCloud(async (evt) => {
        if (evt.type === 'config') { setRuntimeConfig(getAppConfig()); rebuildLayout(); render(); }
        if (evt.type === 'auth') {
          if (cloudSession()) { await adoptCloudSession(); }
          rebuildLayout(); render();
        }
      });
    }
  } catch (e) { console.warn('[cloud] init failed — running local', e); }
  try { if (currentUser()) applyShieldIfNeeded(); } catch (e) { console.warn(e); }
  render();
})();

async function adoptCloudSession() {
  const sess = cloudSession(); if (!sess) return;
  const sub = `sb-${sess.user.id}`;
  const already = currentUser()?.sub === sub;
  let prof = cloudProfile();
  if (!prof) { try { prof = await loadProfile(); } catch (e) { console.warn('profile', e); } }
  if (!already) {
    try { const data = await pullState(); if (data) primeUserData(sub, data); } catch (e) { console.warn('pull', e); }
    signIn({
      sub, provider: 'google', cloud: true,
      name: prof?.name || sess.user.user_metadata?.full_name || sess.user.email,
      email: sess.user.email || '',
      picture: prof?.avatar_url || sess.user.user_metadata?.avatar_url || '',
    });
    rebuildLayout();
  }
}
