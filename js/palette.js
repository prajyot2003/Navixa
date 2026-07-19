// Navixa — ⌘K command palette
import { $, $$, el, esc, icon } from './utils.js';
import { currentUser, globalSettings, saveGlobal, applyTheme } from './store.js';
import { getFlags } from './config.js';
import { cloudEnabled, isAdmin } from './cloud.js';

let wrap = null, inputEl = null, listEl = null, sel = 0, items = [];

function actions() {
  const flags = getFlags();
  const nav = [
    ['dashboard', 'home', 'Go to Dashboard'], ['matches', 'sparkles', 'Go to Suggestions'],
    ['jobs', 'briefcase', 'Go to Job search'], ['resume', 'file', 'Go to Resume builder'],
    ['chat', 'message', 'Go to AI chat'], ['learn', 'play', 'Go to Learning hub'],
    ['streaks', 'flame', 'Go to Streaks'], ['tracker', 'kanban', 'Go to Tracker'],
    ['profile', 'user', 'Go to Profile'], ['settings', 'gear', 'Go to Settings'], ['help', 'help', 'Go to Help'],
  ].filter(([k]) => ['dashboard', 'profile', 'settings', 'help'].includes(k) || flags[k] !== false)
    .map(([k, ic, label]) => ({ icon: ic, label, hint: `#/${k}`, run: () => { location.hash = `#/${k}`; } }));
  const extra = [
    { icon: 'plus', label: 'Start a new AI conversation', hint: 'chat', run: () => { location.hash = '#/chat'; } },
    { icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', label: 'Toggle light / dark theme', hint: 'theme', run: () => { saveGlobal({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }); applyTheme(); } },
  ];
  if (cloudEnabled() && isAdmin()) extra.unshift({ icon: 'shield', label: 'Open Admin console', hint: '#/admin', run: () => { location.hash = '#/admin'; } });
  return [...nav, ...extra];
}

function build() {
  if (wrap) return;
  wrap = el(`<div class="palette-backdrop" role="dialog" aria-label="Command palette">
    <div class="palette">
      <div class="palette-input">${icon('search', 19)}<input placeholder="Jump to a page or action…" aria-label="Command"></div>
      <div class="palette-list"></div>
      <div class="palette-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></div>
    </div>
  </div>`);
  inputEl = $('input', wrap);
  listEl = $('.palette-list', wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  inputEl.addEventListener('input', () => { sel = 0; renderList(); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); close(); }
    else if (e.key === 'Escape') close();
  });
  document.body.appendChild(wrap);
}

function renderList() {
  const q = inputEl.value.trim().toLowerCase();
  items = actions().filter((a) => !q || a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q));
  if (!items.length) { listEl.innerHTML = `<div class="palette-empty">Nothing matches “${esc(inputEl.value)}”</div>`; return; }
  listEl.innerHTML = items.map((a, i) => `
    <button class="palette-item ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(a.icon, 17)}<span>${esc(a.label)}</span><span class="p-hint">${esc(a.hint)}</span></button>`).join('');
  $$('.palette-item', listEl).forEach((b) => {
    b.onclick = () => { items[Number(b.dataset.i)]?.run(); close(); };
    b.onmousemove = () => { const i = Number(b.dataset.i); if (i !== sel) { sel = i; renderList(); } };
  });
  $('.palette-item.sel', listEl)?.scrollIntoView({ block: 'nearest' });
}

export function openPalette() {
  if (!currentUser()) return;
  build();
  sel = 0; inputEl.value = '';
  renderList();
  wrap.classList.add('open');
  setTimeout(() => inputEl.focus(), 30);
}
export function close() { wrap?.classList.remove('open'); }

export function initPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (wrap?.classList.contains('open')) close(); else openPalette();
    }
  });
}
