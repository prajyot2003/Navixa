// Navixa — Supabase cloud layer (auth, profile, state sync, app config, feedback)
// Degrades gracefully: if SUPABASE.url/anonKey are empty, the app runs in local mode.
import { SUPABASE } from './config.js';
import { debounce } from './utils.js';

let sb = null;
let session = null;
let profile = null;          // current user's profile row (has .role)
let appConfig = null;        // global app_config.config
const listeners = new Set();

export function onCloud(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitCloud(evt) { listeners.forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } }); }

export function cloudEnabled() {
  return !!(SUPABASE.url && SUPABASE.anonKey && (typeof window !== 'undefined') && window.supabase?.createClient);
}
export function client() {
  if (!cloudEnabled()) return null;
  if (!sb) {
    sb = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return sb;
}

export function cloudSession() { return session; }
export function cloudProfile() { return profile; }
export function isAdmin() { return profile?.role === 'admin'; }
export function getAppConfig() { return appConfig || {}; }

// ---------- boot ----------
export async function initCloud() {
  if (!cloudEnabled()) return { enabled: false };
  const c = client();
  const { data } = await c.auth.getSession();
  session = data?.session || null;
  c.auth.onAuthStateChange(async (_event, s) => {
    const had = !!session;
    session = s || null;
    if (session && !profile) await loadProfile();
    if (!session) profile = null;
    if (had !== !!session) emitCloud({ type: 'auth' });
  });
  await fetchAppConfig().catch(() => {});
  if (session) await loadProfile().catch((e) => console.warn('profile load', e));
  return { enabled: true, session };
}

export async function signInWithGoogle() {
  const c = client();
  if (!c) throw new Error('Backend not configured');
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function cloudSignOut() {
  try { await client()?.auth.signOut(); } catch (e) { console.warn(e); }
  session = null; profile = null;
}

// ---------- profile ----------
export async function loadProfile() {
  const c = client(); if (!c || !session) return null;
  const { data, error } = await c.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) throw error;
  profile = data;
  return profile;
}

export async function touchProfile(statPatch = {}) {
  const c = client(); if (!c || !session) return;
  const patch = { last_seen: new Date().toISOString(), ...statPatch };
  await c.from('profiles').update(patch).eq('id', session.user.id);
}

// ---------- per-user state sync ----------
export async function pullState() {
  const c = client(); if (!c || !session) return null;
  const { data, error } = await c.from('user_state').select('data, updated_at').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data?.data && Object.keys(data.data).length ? data.data : null;
}

let pushPayload = null;
const pushNow = async () => {
  const c = client(); if (!c || !session || !pushPayload) return;
  const { state, stats } = pushPayload; pushPayload = null;
  try {
    await c.from('user_state').upsert({ user_id: session.user.id, data: state, updated_at: new Date().toISOString() });
    await touchProfile(stats);
    emitCloud({ type: 'synced' });
  } catch (e) { console.warn('[cloud] push failed', e.message); }
};
const pushDebounced = debounce(pushNow, 2500);

export function schedulePush(state, stats) {
  if (!cloudEnabled() || !session) return;
  pushPayload = { state, stats };
  pushDebounced();
}
export function flushPush() { return pushNow(); }

// ---------- app config (global, admin-managed) ----------
export async function fetchAppConfig() {
  const c = client(); if (!c) return null;
  const { data, error } = await c.from('app_config').select('config').eq('id', 1).maybeSingle();
  if (error) throw error;
  appConfig = data?.config || {};
  // NOTE: read path does NOT emit 'config' — the listener re-renders the current
  // route, and the admin Config/Content panes call this on render, which would loop.
  return appConfig;
}

export async function saveAppConfig(patch) {
  const c = client(); if (!c) throw new Error('Backend not configured');
  const next = { ...(appConfig || {}), ...patch };
  const { error } = await c.from('app_config').update({ config: next, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw error;
  appConfig = next;
  emitCloud({ type: 'config' });
  return appConfig;
}

// ---------- feedback ----------
export async function sendFeedback(message) {
  const c = client(); if (!c || !session) throw new Error('Sign in with Google to send feedback');
  const { error } = await c.from('feedback').insert({
    user_id: session.user.id,
    email: session.user.email,
    name: profile?.name || session.user.user_metadata?.name || '',
    message,
  });
  if (error) throw error;
}

// ---------- admin queries ----------
async function assertAdmin() { if (!isAdmin()) throw new Error('Admin only'); }

export async function adminListProfiles({ q = '' } = {}) {
  await assertAdmin();
  const c = client();
  let query = c.from('profiles').select('*').order('last_seen', { ascending: false }).limit(500);
  if (q) query = query.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function adminSetRole(userId, role) {
  await assertAdmin();
  const { error } = await client().from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

export async function adminWipeUserState(userId) {
  await assertAdmin();
  const c = client();
  const { error } = await c.from('user_state').delete().eq('user_id', userId);
  if (error) throw error;
  await c.from('profiles').update({ xp: 0, level: 1, streak: 0, stats: {} }).eq('id', userId);
}

export async function adminListFeedback() {
  await assertAdmin();
  const { data, error } = await client().from('feedback').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data || [];
}

export async function adminSetFeedbackStatus(id, status) {
  await assertAdmin();
  const { error } = await client().from('feedback').update({ status }).eq('id', id);
  if (error) throw error;
}
