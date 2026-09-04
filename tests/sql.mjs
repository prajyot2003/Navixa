// Executes the Supabase migrations against a real Postgres (PGlite = Postgres
// compiled to WASM), so SQL is verified rather than assumed. This catches the
// class of bug that only appears at runtime: type-resolution errors, triggers
// that revert their own migration, RLS that blocks the wrong thing.
//
//   npm install @electric-sql/pglite      (then)  node tests/sql.mjs
//
// Supabase-only pieces (auth schema, auth.uid(), RLS impersonation) are stubbed
// below to match Supabase's behaviour.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? `\n      ${d}` : ''}`); } };

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const exec = (sql) => db.exec(sql);

/* ---------- Supabase scaffolding ---------- */
await exec(`
  -- Supabase ships these roles; vanilla Postgres does not, and the migration
  -- GRANTs to them.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  -- Supabase derives auth.uid() from the request JWT. Mirror that with a GUC so
  -- tests can "become" a user. Unset => null, exactly like the SQL editor.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
`);

// Supabase's API connects as `authenticated`, which does NOT own the tables — so
// RLS applies to it. The owner (postgres) is exempt from RLS unless FORCE is set,
// which is exactly why SECURITY DEFINER functions can bypass the policies. Run
// user-facing assertions as `authenticated` or RLS silently never engages.
const asUser = async (uid) => {
  await exec('reset role');
  await exec(`select set_config('test.uid', ${uid ? `'${uid}'` : "''"}, false)`);
  await exec('set role authenticated');
};
const asSystem = async () => { await exec('reset role'); };
const become = asUser;

/* ---------- the parts of supabase-setup.sql this migration depends on ---------- */
await exec(`
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text unique,
    name text,
    avatar_url text,
    role text not null default 'client' check (role in ('client','admin')),
    xp int not null default 0,
    level int not null default 1,
    streak int not null default 0,
    stats jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now()
  );
  create or replace function public.is_admin() returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    $$;
  alter table public.profiles enable row level security;
  create policy profiles_select on public.profiles for select
    using (auth.uid() = id or public.is_admin());
  create policy profiles_update_own on public.profiles for update
    using (auth.uid() = id);
  create policy profiles_update_admin on public.profiles for update
    using (public.is_admin());
`);

// Two users, one with legacy inflated XP that the migration must reconcile.
const cheat = (await q(`insert into auth.users (email) values ('cheat@x.com') returning id`)).rows[0].id;
const honest = (await q(`insert into auth.users (email) values ('honest@x.com') returning id`)).rows[0].id;
await exec(`
  insert into public.profiles (id, email, xp, level, streak) values
    ('${cheat}',  'cheat@x.com',  999999, 99, 42),
    ('${honest}', 'honest@x.com', 0, 1, 0);
`);

/* ---------- run the real migration ---------- */
console.log('\n[1] the migration executes against real Postgres');
let migrationError = null;
try {
  await exec(read('supabase-leaderboard.sql'));
} catch (e) {
  migrationError = e.message;
}
t('supabase-leaderboard.sql runs with no errors', migrationError === null, migrationError || '');
await exec(`
  grant usage on schema public to authenticated, anon;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);
if (migrationError) {
  console.log(`\n❌ sql: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

/* ---------- reconciliation ---------- */
console.log('\n[2] legacy asserted XP is actually reset (not silently reverted)');
const after = (await q(`select xp, level, streak from public.profiles where id = $1`, [cheat])).rows[0];
t('inflated xp 999999 → 0', after.xp === 0, `got xp=${after.xp}`);
t('inflated level 99 → 1', after.level === 1, `got level=${after.level}`);
t('inflated streak 42 → 0', after.streak === 0, `got streak=${after.streak}`);

/* ---------- the cheat is blocked ---------- */
console.log('\n[3] a signed-in user cannot assert their own score');
await become(cheat);
await q(`update public.profiles set xp = 999999, level = 99 where id = $1`, [cheat]);
const cheated = (await q(`select xp, level from public.profiles where id = $1`, [cheat])).rows[0];
t('direct UPDATE of xp is reverted by the trigger', cheated.xp === 0, `got xp=${cheated.xp}`);
t('direct UPDATE of level is reverted', cheated.level === 1, `got level=${cheated.level}`);

let identityErr = null;
try { await q(`update public.profiles set email = 'attacker@x.com' where id = $1`, [cheat]); }
catch (e) { identityErr = e.message; }
t('email rewrite still raises', /cannot be changed|sign-in provider/i.test(identityErr || ''), identityErr || 'no error raised');

let roleErr = null;
try { await q(`update public.profiles set role = 'admin' where id = $1`, [cheat]); }
catch (e) { roleErr = e.message; }
t('role escalation still raises', /Only admins/i.test(roleErr || ''), roleErr || 'no error raised');

/* ---------- earning XP ---------- */
console.log('\n[4] award_xp is the only way in, and it caps');
const a1 = (await q(`select * from public.award_xp('job_apply')`)).rows[0];
t('award_xp returns the new totals', a1.xp === 20 && a1.awarded === 20, JSON.stringify(a1));
t('level is derived from the ledger', a1.level === 1);
t('streak counts today', a1.streak === 1, `got ${a1.streak}`);

let unknownErr = null;
try { await q(`select * from public.award_xp('give_me_a_million')`); }
catch (e) { unknownErr = e.message; }
t('unknown actions are rejected', /Unknown action/.test(unknownErr || ''), unknownErr || 'no error');

// job_apply is 20 points, capped at 10/day = 200 max from this action.
for (let i = 0; i < 12; i++) await q(`select * from public.award_xp('job_apply')`);
const capped = (await q(`select * from public.award_xp('job_apply')`)).rows[0];
t('per-action daily cap holds', capped.xp <= 200, `xp=${capped.xp}`);
t('hitting the cap awards nothing and is not an error', capped.capped === true && capped.awarded === 0);

// Global ceiling: pile on other actions and confirm 300/day is never exceeded.
for (const act of ['job_search', 'chat_message', 'resume_edit', 'tracker_move', 'learn_save', 'ats_run']) {
  for (let i = 0; i < 25; i++) await q(`select * from public.award_xp('${act}')`);
}
const ceiling = (await q(`select xp from public.profiles where id = $1`, [cheat])).rows[0];
t('global 300/day ceiling is never exceeded', ceiling.xp <= 300, `xp=${ceiling.xp}`);

const ledgerSum = (await q(`select coalesce(sum(points),0)::int s from public.xp_events where user_id = $1`, [cheat])).rows[0].s;
t('profiles.xp always equals the ledger sum', ceiling.xp === ledgerSum, `xp=${ceiling.xp} ledger=${ledgerSum}`);

console.log('\n[5] the ledger is append-only for users');
let insErr = null;
try { await q(`insert into public.xp_events (user_id, action, points) values ($1,'hack',100)`, [cheat]); }
catch (e) { insErr = e.message; }
t('direct INSERT into xp_events is blocked by RLS', insErr !== null, insErr || 'INSERT SUCCEEDED — no policy blocked it');

let delErr = null;
try { await q(`delete from public.xp_events where user_id = $1`, [cheat]); }
catch (e) { delErr = e.message; }
const stillThere = (await q(`select count(*)::int c from public.xp_events where user_id = $1`, [cheat])).rows[0].c;
t('users cannot delete their ledger history', stillThere > 0, `rows left: ${stillThere}`);

/* ---------- leaderboard privacy ---------- */
console.log('\n[6] leaderboard privacy');
const noHandle = (await q(`select * from public.leaderboard(25)`)).rows;
t('not listed without a handle + opt-in', noHandle.length === 0, `got ${noHandle.length} rows`);

await q(`select * from public.set_handle('quiet_otter', true)`);
const listed = (await q(`select * from public.leaderboard(25)`)).rows;
t('appears after opting in', listed.length === 1 && listed[0].handle === 'quiet_otter', JSON.stringify(listed));
t('returns only safe columns',
  JSON.stringify(Object.keys(listed[0]).sort()) === JSON.stringify(['handle', 'is_me', 'level', 'rank', 'streak', 'xp']),
  Object.keys(listed[0]).join(','));
t('no email/name/id in the payload', !JSON.stringify(listed[0]).includes('@') && !JSON.stringify(listed[0]).includes(cheat));

let badHandle = null;
try { await q(`select * from public.set_handle('Has Caps', true)`); } catch (e) { badHandle = e.message; }
t('invalid handle rejected', /Username must be/.test(badHandle || ''), badHandle || 'no error');

let reserved = null;
try { await q(`select * from public.set_handle('admin', true)`); } catch (e) { reserved = e.message; }
t('reserved handle rejected', /reserved/.test(reserved || ''), reserved || 'no error');

await become(honest);
let taken = null;
try { await q(`select * from public.set_handle('quiet_otter', true)`); } catch (e) { taken = e.message; }
t('duplicate handle rejected', /taken/.test(taken || ''), taken || 'no error');

await become(cheat);
await q(`select * from public.set_handle('quiet_otter', false)`);
const optedOut = (await q(`select * from public.leaderboard(25)`)).rows;
t('opting out removes you from the board', optedOut.length === 0, `got ${optedOut.length} rows`);

/* ---------- level curve parity with the JS ---------- */
console.log('\n[7] SQL level curve matches js/gamify.js');
const { levelFromXp } = await import('../js/gamify.js');
let bad = null;
for (const xp of [0, 1, 99, 100, 101, 299, 300, 301, 599, 600, 1000, 5000, 12345]) {
  const sqlLvl = (await q(`select public.xp_level($1) l`, [xp])).rows[0].l;
  if (sqlLvl !== levelFromXp(xp)) { bad = `xp=${xp}: sql=${sqlLvl} js=${levelFromXp(xp)}`; break; }
}
t('xp_level() and levelFromXp() agree', bad === null, bad || '');

/* ---------- backfill for pre-ledger accounts ---------- */
console.log('\n[8] one-time XP backfill from pre-ledger activity');
await asSystem();
await exec(`
  create table if not exists public.user_state (
    user_id uuid primary key references auth.users(id) on delete cascade,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );
  alter table public.user_state enable row level security;
  create policy state_select_own on public.user_state for select using (auth.uid() = user_id);
  grant select, insert, update on public.user_state to authenticated;
`);
// 'honest' has a week of real activity recorded before the ledger existed.
await q(`insert into public.user_state (user_id, data) values ($1, $2)`, [honest, JSON.stringify({
  gamify: { activity: { '2026-07-17': 1, '2026-07-18': 7, '2026-07-19': 9, '2026-07-26': 1, '2026-07-27': 1 } },
})]);
// A fabricated history, to prove the ceiling holds.
const greedy = (await q(`insert into auth.users (email) values ('greedy@x.com') returning id`)).rows[0].id;
await exec(`insert into public.profiles (id, email) values ('${greedy}', 'greedy@x.com')`);
const fakeDays = {};
for (let i = 0; i < 400; i++) fakeDays[`2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`] = 9999;
await q(`insert into public.user_state (user_id, data) values ($1, $2)`, [greedy, JSON.stringify({ gamify: { activity: fakeDays } })]);
await exec(read('supabase-xp-backfill.sql'));
await exec(`grant execute on function public.backfill_xp() to authenticated`);

// Earn a point BEFORE backfilling. The first version guarded on "ledger is
// empty", which meant one normal action made the pre-ledger history
// permanently unrecoverable — exactly what happened in production.
await become(honest);
await q(`select * from public.award_xp('job_search')`);
const bf = (await q(`select * from public.backfill_xp()`)).rows[0];
t('backfill runs for a pre-ledger account', bf.out_ran === true);
t('restores XP proportionate to real activity (on top of the 2 already earned)',
  bf.out_xp === 97, `got ${bf.out_xp} (expect 2 earned + 19 actions × 5)`);
t('backfill still works after the user has already earned some XP', bf.out_ran === true);
t('restores the day history (streak can survive)', bf.out_days === 5, `got ${bf.out_days}`);
const hs = (await q(`select xp, level, streak from public.profiles where id = $1`, [honest])).rows[0];
t('profile reflects the backfill', hs.xp === 97 && hs.level > 0, JSON.stringify(hs));

const again = (await q(`select * from public.backfill_xp()`)).rows[0];
t('refuses to run twice (not farmable)', again.out_ran === false);
const afterTwice = (await q(`select xp from public.profiles where id = $1`, [honest])).rows[0];
t('a second call does not add XP', afterTwice.xp === 97, `got ${afterTwice.xp}`);

await become(greedy);
const g = (await q(`select * from public.backfill_xp()`)).rows[0];
t('fabricated history is capped at the ceiling', g.out_xp <= 500, `got ${g.out_xp}`);
t('per-day action count is clamped too', g.out_xp === 500, `got ${g.out_xp}`);

await become(honest);
const post = (await q(`select * from public.award_xp('job_apply')`)).rows[0];
t('normal earning continues on top of the backfill', post.xp === 117, `got ${post.xp}`);

/* ---------- admins are not exempt from derivation ---------- */
console.log('\n[9] an admin\'s score is derived too');
await asSystem();
const boss = (await q(`insert into auth.users (email) values ('boss@x.com') returning id`)).rows[0].id;
await exec(`insert into public.profiles (id, email, role) values ('${boss}', 'boss@x.com', 'admin')`);
await q(`insert into public.user_state (user_id, data) values ($1, $2)`, [boss, JSON.stringify({
  gamify: { activity: { '2026-07-01': 4, '2026-07-02': 6 } },
})]);
await become(boss);
const bossBf = (await q(`select * from public.backfill_xp()`)).rows[0];
// The whole failure was: ledger written, profile column left at zero, because
// the trigger returned early for admins.
const bossLedger = (await q(`select coalesce(sum(points),0)::int s from public.xp_events where user_id = $1`, [boss])).rows[0].s;
const bossProfile = (await q(`select xp, level, streak from public.profiles where id = $1`, [boss])).rows[0];
t('admin backfill writes the ledger', bossLedger === 50, `ledger=${bossLedger}`);
t('admin profile.xp matches the ledger (not left at 0)', bossProfile.xp === bossLedger,
  `profile=${bossProfile.xp} ledger=${bossLedger}`);
t('backfill reports the real total for an admin', bossBf.out_xp === 50, `got ${bossBf.out_xp}`);
const bossEarn = (await q(`select * from public.award_xp('job_apply')`)).rows[0];
t('an admin earning XP updates their profile', bossEarn.xp === 70, `got ${bossEarn.xp}`);
await q(`update public.profiles set xp = 999999 where id = $1`, [boss]);
const bossCheat = (await q(`select xp from public.profiles where id = $1`, [boss])).rows[0];
t('an admin cannot assert their own XP either', bossCheat.xp === 70, `got ${bossCheat.xp}`);
await q(`update public.profiles set role = 'client' where id = $1`, [honest]);
const demoted = (await q(`select role from public.profiles where id = $1`, [honest])).rows[0];
t('admins can still manage other users\' roles', demoted.role === 'client', `got ${demoted.role}`);

/* ---------- bulk repair: every user in one run ---------- */
console.log('\n[10] supabase-fix-all-scores.sql repairs EVERY user in one pass');
await asSystem();
// Three users who have never signed in since the ledger existed.
const bulk = [];
for (const [email, activity] of [
  ['a@x.com', { '2026-06-01': 2, '2026-06-02': 3 }],
  ['b@x.com', { '2026-06-10': 12, '2026-06-11': 12 }],
  ['c@x.com', {}],                                   // no history at all
]) {
  const id = (await q(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id;
  await exec(`insert into public.profiles (id, email) values ('${id}', '${email}')`);
  await q(`insert into public.user_state (user_id, data) values ($1, $2)`,
    [id, JSON.stringify({ gamify: { activity } })]);
  bulk.push({ id, email });
}
const beforeBulk = (await q(`select coalesce(sum(xp),0)::int s from public.profiles where id = any($1)`,
  [bulk.map((b) => b.id)])).rows[0].s;
t('the untouched users start at 0', beforeBulk === 0, `got ${beforeBulk}`);

await exec(read('supabase-fix-all-scores.sql'));

const a = (await q(`select xp, streak from public.profiles where email = 'a@x.com'`)).rows[0];
const b = (await q(`select xp from public.profiles where email = 'b@x.com'`)).rows[0];
const cUser = (await q(`select xp from public.profiles where email = 'c@x.com'`)).rows[0];
t('user with 5 actions restored to 25', a.xp === 25, `got ${a.xp}`);
t('per-day clamp applied (12 actions max, not 99)', b.xp === 120, `got ${b.xp}`);
t('user with no history stays at 0 without erroring', cUser.xp === 0, `got ${cUser.xp}`);

// Everyone who was already correct must be untouched.
const bossAfter = (await q(`select xp from public.profiles where email = 'boss@x.com'`)).rows[0];
t('already-migrated users are not double-counted', bossAfter.xp === 70, `got ${bossAfter.xp}`);

// Every profile must equal its ledger, with no exceptions.
const drift = (await q(`
  select count(*)::int n from public.profiles p
   where p.xp is distinct from
     (select coalesce(sum(e.points),0)::int from public.xp_events e where e.user_id = p.id)`)).rows[0].n;
t('every profile now equals its ledger sum', drift === 0, `${drift} profiles disagree`);

// Re-running must not inflate anyone.
const totalBefore = (await q(`select coalesce(sum(xp),0)::int s from public.profiles`)).rows[0].s;
await exec(read('supabase-fix-all-scores.sql'));
const totalAfter = (await q(`select coalesce(sum(xp),0)::int s from public.profiles`)).rows[0].s;
t('re-running the whole script changes nothing', totalBefore === totalAfter,
  `${totalBefore} → ${totalAfter}`);

await asSystem();
console.log('\n[11] the migration is safe to re-run');
let rerun = null;
try { await exec(read('supabase-leaderboard.sql')); } catch (e) { rerun = e.message; }
t('running it a second time is idempotent', rerun === null, rerun || '');

await db.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} sql: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
