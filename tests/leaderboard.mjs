// Leaderboard + server-authoritative XP tests.
// The Supabase RPCs are stubbed, so this checks the CLIENT contract:
// the browser must never assert XP, and the leaderboard must expose no PII.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
  { url: 'https://navixa.test/', pretendToBeVisual: true });
const { window } = dom;
for (const k of ['HTMLElement', 'Node', 'CustomEvent', 'Event', 'DOMParser', 'getComputedStyle']) globalThis[k] = window[k];
globalThis.window = window; globalThis.document = window.document; globalThis.location = window.location;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 5);
const st = new Map();
globalThis.localStorage = { getItem: (k) => (st.has(k) ? st.get(k) : null), setItem: (k, v) => st.set(k, String(v)), removeItem: (k) => st.delete(k), clear: () => st.clear() };
const ss = new Map();
globalThis.sessionStorage = { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k), clear: () => ss.clear() };
window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.animate = function () { return { onfinish: null }; };
globalThis.fetch = window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? `\n      ${d}` : ''}`); } };

/* ---------- 1. the client must not be able to assert XP ---------- */
console.log('\n[1] the browser never writes xp/level/streak');
const cloudSrc = fs.readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
t('touchProfile strips xp/level/streak before the update',
  /const \{\s*xp,\s*level,\s*streak,\s*\.\.\.safe\s*\}/.test(cloudSrc));
t('the stripped object is what gets sent', /\.\.\.safe\s*\}/.test(cloudSrc) && !/\.\.\.statPatch\s*\}/.test(cloudSrc));

const gamifySrc = fs.readFileSync(new URL('../js/gamify.js', import.meta.url), 'utf8');
t('logActivity calls the server award function', /awardXp\(kind\)/.test(gamifySrc));
t('server totals overwrite the optimistic local figure', /st\.gamify\.xp = res\.xp/.test(gamifySrc));

/* ---------- 2. the SQL contract ---------- */
console.log('\n[2] SQL: XP is derived, not asserted');
const sql = fs.readFileSync(new URL('../supabase-leaderboard.sql', import.meta.url), 'utf8');
t('xp_events has no INSERT policy (only award_xp can write)',
  !/create policy[^;]*on public\.xp_events[^;]*for insert/i.test(sql));
t('xp_events is readable only by its owner',
  /create policy xp_events_select_own[\s\S]*?auth\.uid\(\) = user_id/.test(sql));
t('award_xp is SECURITY DEFINER', /function public\.award_xp[\s\S]*?security definer/.test(sql));
// award_xp must take ONLY the action name — if it accepted a points argument the
// caller could set its own score. (Careful: "p_points" also matches inside
// "xp_points", so assert on the signature rather than a bare substring.)
t('award_xp accepts only an action, never a points value',
  /function public\.award_xp\(p_action text\)/.test(sql));
t('points are looked up server-side from the action',
  /pts := public\.xp_points\(p_action\)/.test(sql));
t('unknown actions are rejected', /raise exception 'Unknown action/.test(sql));
t('per-action daily cap enforced', /used >= cap/.test(sql));
t('global daily ceiling enforced', /DAILY_MAX/.test(sql) && /day_total \+ pts > DAILY_MAX/.test(sql));
t('profiles.xp is recomputed from the ledger sum',
  /set xp = new_xp/.test(sql) && /sum\(points\)[\s\S]*?into new_xp/.test(sql));
t('guard trigger reverts client-sent scores',
  /new\.xp\s*:=\s*old\.xp/.test(sql) && /new\.level\s*:=\s*old\.level/.test(sql) && /new\.streak\s*:=\s*old\.streak/.test(sql));
t('legacy asserted XP is reconciled to the ledger on migration',
  /update public\.profiles p[\s\S]*?set xp = coalesce\(\(select sum\(e\.points\)/.test(sql));

/* ---------- 3. privacy of the leaderboard ---------- */
console.log('\n[3] leaderboard exposes a handle and nothing else');
const lbFn = sql.match(/create or replace function public\.leaderboard[\s\S]*?\$\$;/)[0];
t('returns only rank/handle/xp/level/streak/is_me',
  /returns table \(rank bigint, handle text, xp int, level int, streak int, is_me boolean\)/.test(lbFn));
for (const leak of ['email', 'avatar_url', 'p.name', 'raw_user_meta']) {
  t(`never selects ${leak}`, !new RegExp(leak.replace('.', '\\.')).test(lbFn));
}
t('user id is not returned (only a boolean is_me)', !/select[\s\S]*?\bp\.id\b(?![\s\S]*?= auth\.uid\(\) as is_me)/.test(lbFn));
t('requires explicit opt-in', /p\.leaderboard_opt_in/.test(lbFn));
t('requires a handle to appear', /p\.handle is not null/.test(lbFn));
t('opt-in defaults to false (private until chosen)',
  /leaderboard_opt_in boolean not null default false/.test(sql));

/* ---------- 4. handle validation ---------- */
console.log('\n[4] username rules');
const RE = /^[a-z][a-z0-9_]{2,19}$/;
for (const good of ['quiet_otter', 'abc', 'a1_b2', 'z'.repeat(20)]) t(`accepts "${good}"`, RE.test(good));
for (const bad of ['ab', '1abc', 'Has_Caps', 'with space', 'x'.repeat(21), 'bad-dash', '', 'émoji']) {
  t(`rejects ${JSON.stringify(bad)}`, !RE.test(bad));
}
t('DB enforces the same rule', /handle ~ '\^\[a-z\]\[a-z0-9_\]\{2,19\}\$'/.test(sql));
t('handles are unique case-insensitively', /unique index[\s\S]*?on public\.profiles \(lower\(handle\)\)/.test(sql));
t('reserved names blocked', /'admin','administrator','navixa'/.test(sql));

/* ---------- 5. UI escaping + no PII rendered ---------- */
console.log('\n[5] leaderboard UI');
const lbUi = fs.readFileSync(new URL('../js/leaderboard.js', import.meta.url), 'utf8');
t('handles are escaped before rendering', /esc\(r\.handle\)/.test(lbUi));
t('UI never reads email or real name', !/\.email|profile\.name/.test(lbUi));
t('privacy is stated to the user in Settings', /never published/i.test(lbUi));

const { levelFromXp } = await import('../js/gamify.js');
console.log('\n[6] level curve matches the SQL formula');
// SQL: floor((sqrt(1 + 4x/50) - 1)/2) + 1, clamped to >= 1
const sqlLevel = (x) => Math.max(1, Math.floor((Math.sqrt(1 + (4 * Math.max(x, 0)) / 50) - 1) / 2) + 1);
let mismatch = null;
for (const xp of [0, 1, 99, 100, 101, 299, 300, 301, 599, 600, 1000, 5000, 12345, 100000]) {
  if (levelFromXp(xp) !== sqlLevel(xp)) { mismatch = `xp=${xp}: js=${levelFromXp(xp)} sql=${sqlLevel(xp)}`; break; }
}
t('JS levelFromXp and SQL xp_level agree across the range', mismatch === null, mismatch || '');

console.log(`\n${fail === 0 ? '✅' : '❌'} leaderboard: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
