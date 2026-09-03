// Navixa — server-authoritative XP + privacy-preserving leaderboard.
//
// XP is never written by the browser. `award_xp` decides the points server-side,
// caps them per day, and appends to a ledger; profiles.xp is derived from it.
// See supabase-leaderboard.sql. The leaderboard shows a user-chosen handle only —
// never a real name, email or user id — and requires an explicit opt-in.
import { client, cloudEnabled, cloudSession } from './cloud.js';
import { $, $$, el, esc, icon, toast, skeleton } from './utils.js';

const SETUP = 'SETUP';
const isMissing = (e) => {
  const m = `${e?.message || ''} ${e?.details || ''}`;
  return String(e?.code) === '42883' || String(e?.code) === '42P01'
    || (/award_xp|xp_events|leaderboard|set_handle|handle/i.test(m)
        && /does not exist|schema cache|could not find/i.test(m));
};

/* ---------------- data ---------------- */

/** Award XP for an action. Returns the server's authoritative totals, or null. */
export async function awardXp(action) {
  const c = client();
  if (!c || !cloudSession()) return null;
  const { data, error } = await c.rpc('award_xp', { p_action: action });
  if (error) {
    if (isMissing(error)) return null;      // migration not run yet — stay local
    console.warn('[xp] award failed', error.message);
    return null;
  }
  return Array.isArray(data) ? data[0] : data;
}

export async function fetchLeaderboard(limit = 25) {
  const c = client();
  if (!c) throw new Error(SETUP);
  const { data, error } = await c.rpc('leaderboard', { p_limit: limit });
  if (error) throw new Error(isMissing(error) ? SETUP : error.message);
  return data || [];
}

export async function myRank() {
  const c = client();
  if (!c || !cloudSession()) return null;
  const { data, error } = await c.rpc('my_leaderboard_rank');
  if (error) { if (isMissing(error)) throw new Error(SETUP); throw error; }
  return Array.isArray(data) ? data[0] : data;
}

export async function setHandle(handle, optIn) {
  const c = client();
  if (!c || !cloudSession()) throw new Error('Sign in with Google first.');
  const { data, error } = await c.rpc('set_handle', { p_handle: handle, p_opt_in: optIn });
  if (error) throw new Error(isMissing(error) ? SETUP : error.message);
  const row = Array.isArray(data) ? data[0] : data;
  // set_handle's OUT columns are out_handle/out_opt_in (renamed to dodge a
  // plpgsql name collision with profiles.handle). Accept both shapes.
  return row ? { handle: row.out_handle ?? row.handle,
                 leaderboard_opt_in: row.out_opt_in ?? row.leaderboard_opt_in } : null;
}

/* ---------------- UI ---------------- */

const setupNotice = `<p class="sub">${icon('info', 14)} Leaderboard isn’t set up on this deployment yet —
  run <code>supabase-leaderboard.sql</code> in the Supabase SQL editor, then reload.</p>`;

/** Card for the Streaks page: your rank + the top players. */
export function leaderboardCard() {
  const wrap = el(`<div class="card mt-2">
    <div class="card-title">${icon('flame')} Leaderboard
      <span class="more muted">by XP · usernames only</span></div>
    <div data-out>${skeleton(2)}</div>
  </div>`);
  const out = $('[data-out]', wrap);

  (async () => {
    if (!cloudEnabled() || !cloudSession()) {
      out.innerHTML = '<p class="sub">Sign in with Google to join the leaderboard.</p>';
      return;
    }
    let rows, mine;
    try {
      [rows, mine] = await Promise.all([fetchLeaderboard(25), myRank()]);
    } catch (e) {
      out.innerHTML = e.message === SETUP ? setupNotice : `<p class="sub">${esc(e.message)}</p>`;
      return;
    }
    render(rows, mine);
  })();

  function render(rows, mine) {
    const joined = mine?.opted_in && mine?.handle;
    const banner = joined
      ? (mine.rank
        ? `<div class="lb-you">${icon('flame', 15)} You’re <b>#${mine.rank}</b> of ${mine.total}
             as <b>@${esc(mine.handle)}</b> · ${mine.xp} XP</div>`
        : `<div class="lb-you muted">${icon('info', 15)} Earn your first XP to appear on the board.</div>`)
      : `<div class="lb-you muted">${icon('info', 15)} You’re not on the leaderboard.
           <button class="btn btn-sm btn-soft" data-join>Choose a username</button></div>`;

    out.innerHTML = banner + (rows.length
      ? `<ol class="lb-list">${rows.map((r) => `
          <li class="lb-row ${r.is_me ? 'is-me' : ''}">
            <span class="lb-rank ${r.rank <= 3 ? 'top' : ''}">${r.rank}</span>
            <span class="lb-name">@${esc(r.handle)}${r.is_me ? ' <span class="badge acc">you</span>' : ''}</span>
            <span class="lb-meta">Lv ${r.level}${r.streak ? ` · ${r.streak}d` : ''}</span>
            <span class="lb-xp">${r.xp.toLocaleString()}</span>
          </li>`).join('')}</ol>`
      : '<p class="sub">Nobody has opted in yet — be the first.</p>');

    $('[data-join]', out)?.addEventListener('click', () => {
      location.hash = '#/settings';
      setTimeout(() => document.querySelector('[data-handle]')?.focus(), 500);
    });
  }

  return wrap;
}

/** Settings card: pick a username and opt in/out. */
export function handleCard() {
  const wrap = el(`<div class="card mt-2">
    <div class="card-title">${icon('flame')} Leaderboard &amp; username
      <span class="more muted">optional</span></div>
    <div data-out>${skeleton(1)}</div>
  </div>`);
  const out = $('[data-out]', wrap);

  (async () => {
    if (!cloudEnabled() || !cloudSession()) {
      out.innerHTML = '<p class="sub">Sign in with Google to join the leaderboard.</p>';
      return;
    }
    let mine;
    try { mine = await myRank(); }
    catch (e) { out.innerHTML = e.message === SETUP ? setupNotice : `<p class="sub">${esc(e.message)}</p>`; return; }
    render(mine || {});
  })();

  function render(mine) {
    out.innerHTML = `
      <div class="field"><label for="lb-handle">Username</label>
        <div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap">
          <span class="muted">@</span>
          <input class="input" id="lb-handle" data-handle maxlength="20" spellcheck="false"
                 value="${esc(mine.handle || '')}" placeholder="e.g. quiet_otter" style="min-width:0">
        </div>
        <p class="muted" style="margin-top:6px">3–20 characters: letters, numbers and underscores, starting with a letter.</p>
      </div>
      <label class="switch" style="margin:2px 0 10px">
        <input type="checkbox" data-optin ${mine.opted_in ? 'checked' : ''}><span class="track"></span>
        Show me on the public leaderboard
      </label>
      <p class="muted" style="margin:0 0 12px">${icon('info', 12)}
        Only your username, XP, level and streak are ever shown. Your real name, email and
        avatar are never published, and this is off until you turn it on.</p>
      <div class="row" style="gap:8px">
        <button class="btn btn-primary btn-sm" data-save>${icon('check', 15)} Save</button>
        ${mine.handle ? `<button class="btn btn-ghost btn-sm" data-leave>${icon('x', 15)} Leave the board</button>` : ''}
      </div>`;

    $('[data-save]', out).onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const res = await setHandle($('[data-handle]', out).value.trim().toLowerCase(),
                                    $('[data-optin]', out).checked);
        toast(res?.leaderboard_opt_in ? 'You’re on the leaderboard' : 'Username saved');
        render({ ...mine, handle: res?.handle, opted_in: res?.leaderboard_opt_in });
      } catch (err) {
        toast(err.message === SETUP ? 'Run the setup SQL first' : err.message, 'warn');
        btn.disabled = false;
      }
    };
    $('[data-leave]', out)?.addEventListener('click', async () => {
      try {
        await setHandle(mine.handle, false);
        toast('Removed from the leaderboard');
        render({ ...mine, opted_in: false });
      } catch (err) { toast(err.message, 'warn'); }
    });
  }

  return wrap;
}
