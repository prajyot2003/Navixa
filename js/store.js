// Navixa — state store (localStorage-backed, per-user namespaces, pub/sub, cloud sync)
import { schedulePush } from './cloud.js';

const GLOBAL_KEY = 'navixa:global';
const USERS_KEY = 'navixa:users';
const dataKey = (sub) => `navixa:data:${sub}`;

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(evt = {}) { listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } }); }

function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('storage write failed', e); } }

// ---------- global settings (pre-login, device level) ----------
export const globalSettings = Object.assign({ theme: 'system', accent: 'violet', googleClientId: '' }, read(GLOBAL_KEY, {}));
export function saveGlobal(patch = {}) { Object.assign(globalSettings, patch); write(GLOBAL_KEY, globalSettings); emit({ type: 'global' }); }

// ---------- accounts ----------
const usersState = Object.assign({ list: [], currentId: null }, read(USERS_KEY, {}));
function saveUsers() { write(USERS_KEY, usersState); }

export function currentUser() { return usersState.list.find((u) => u.sub === usersState.currentId) || null; }
export function knownUsers() { return usersState.list.slice(); }

export function signIn(profile) {
  const existing = usersState.list.find((u) => u.sub === profile.sub);
  if (existing) Object.assign(existing, profile, { lastLogin: Date.now() });
  else usersState.list.push({ ...profile, createdAt: Date.now(), lastLogin: Date.now() });
  usersState.currentId = profile.sub;
  saveUsers();
  loadUserData();
  emit({ type: 'auth' });
}

export function signOut() {
  usersState.currentId = null;
  saveUsers();
  state = null;
  emit({ type: 'auth' });
}

export function deleteAccountData(sub) {
  usersState.list = usersState.list.filter((u) => u.sub !== sub);
  if (usersState.currentId === sub) usersState.currentId = null;
  saveUsers();
  try { localStorage.removeItem(dataKey(sub)); } catch {}
  state = null;
  emit({ type: 'auth' });
}

// ---------- per-user state ----------
export function defaultState() {
  return {
    v: 1,
    profile: {
      role: '', headline: '', location: '', targetRole: '', weeklyGoalMins: 150,
      skills: [], interests: [], openTo: { internship: false, fulltime: true, remote: true },
      onboarded: false,
    },
    resume: null, // created lazily by resume module
    jobs: { saved: {}, board: {}, notes: {}, custom: {} }, // board: jobId -> column
    learn: { saved: {}, done: {}, lastQuery: '' },
    chat: { threads: [], activeId: null },
    gamify: {
      xp: 0, activity: {}, achievements: {}, shields: 0, shieldEarnedAtStreak: 0,
      goals: {}, visited: {}, counters: { chat: 0, mock: 0 },
    },
    settings: {
      sources: { remotive: true, jobicy: true, arbeitnow: true, muse: true },
      llm: { mode: 'auto', baseUrl: '', apiKey: '', model: '' },
    },
  };
}

let state = null;
export function loadUserData() {
  const u = currentUser();
  if (!u) { state = null; return null; }
  const raw = read(dataKey(u.sub), null);
  state = deepMerge(defaultState(), raw || {});
  return state;
}
export function getState() {
  if (!state) loadUserData();
  return state;
}
export function saveState() {
  const u = currentUser();
  if (u && state) {
    write(dataKey(u.sub), state);
    if (u.cloud) schedulePush(state, statsFor(state)); // debounced push to Supabase
  }
}

// Denormalized stats for the admin console (kept tiny; full state stays private)
export function statsFor(s) {
  const xp = s?.gamify?.xp || 0;
  let level = 1; while (xp >= 50 * level * (level + 1)) level++;
  const a = s?.gamify?.activity || {};
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const d = new Date(); let streak = 0;
  if (!a[key(d)]) d.setDate(d.getDate() - 1);
  while (a[key(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return {
    xp, level, streak,
    stats: {
      saved: Object.keys(s?.jobs?.saved || {}).length + Object.keys(s?.jobs?.custom || {}).length,
      applied: Object.values(s?.jobs?.board || {}).filter((c) => c !== 'saved').length,
      learnDone: Object.keys(s?.learn?.done || {}).length,
      chats: s?.gamify?.counters?.chat || 0,
    },
  };
}

// Seed the local cache for a cloud user before signIn() (cloud state wins on sign-in)
export function primeUserData(sub, data) {
  if (data && typeof data === 'object' && Object.keys(data).length) write(dataKey(sub), data);
}
export function update(mutator, evt = { type: 'state' }) {
  const s = getState(); if (!s) return;
  mutator(s);
  saveState();
  emit(evt);
}

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (over && typeof over === 'object') {
      for (const k of Object.keys(over)) {
        out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
      }
    }
    return out;
  }
  return over === undefined ? base : over;
}

// ---------- export / import ----------
export function exportAll() {
  const u = currentUser();
  return JSON.stringify({ app: 'navixa', version: 1, exportedAt: new Date().toISOString(), user: u, data: getState() }, null, 2);
}
export function importAll(json) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'navixa' || !parsed.data) throw new Error('Not a Navixa export file');
  state = deepMerge(defaultState(), parsed.data);
  saveState();
  emit({ type: 'state' });
}

// ---------- theme ----------
export function applyTheme() {
  const t = globalSettings.theme;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = globalSettings.accent || 'violet';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0b0d16' : '#f5f6fb';
}
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (globalSettings.theme === 'system') applyTheme();
  });
}
