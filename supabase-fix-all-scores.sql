-- Navixa — ONE script that repairs XP for every user. Run once in Supabase →
-- SQL Editor. Safe to re-run. Supersedes supabase-fix-admin-scores.sql.
--
-- WHAT WENT WRONG (two separate faults, both fixed here)
--
-- 1. The guard trigger returned early for admins, so their xp/level/streak were
--    never recomputed. An admin's ledger could be full while the profile columns
--    sat at 0.
--
-- 2. backfill_xp() only ever runs for ONE user — the caller — and only when they
--    open the app. So restoring history one sign-in at a time left every other
--    account at Level 1 / 0 XP / 0 streak indefinitely.
--
-- This file: fixes the trigger, fixes the per-user function for future sign-ins,
-- then backfills EVERY existing user from their own recorded activity in one
-- pass, and recomputes every profile from the ledger.
--
-- Bounds (unchanged): at most 12 actions counted per day, 5 XP each, 500 XP
-- total per user, and nobody is migrated twice.

-- ---------------------------------------------------------------- 1. trigger
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server-side context (SQL editor, migrations, service role).
  -- Safe: an anonymous PostgREST request also has a null uid, but the
  -- profiles_update_own policy (auth.uid() = id) matches zero rows for it.
  if auth.uid() is null then
    return new;
  end if;

  -- Identity columns — admins may change these; that is what the console is for.
  if not public.is_admin() then
    if new.id is distinct from old.id then
      raise exception 'profiles.id cannot be changed';
    end if;
    if new.role is distinct from old.role then
      raise exception 'Only admins can change roles';
    end if;
    if new.email is distinct from old.email then
      raise exception 'profiles.email is set by your sign-in provider and cannot be changed';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'profiles.created_at cannot be changed';
    end if;
  end if;

  -- Scores are derived from the ledger for EVERYONE, admins included.
  new.xp     := (select coalesce(sum(e.points), 0)::int
                   from public.xp_events e where e.user_id = new.id);
  new.level  := public.xp_level(new.xp);
  new.streak := public.xp_streak(new.id);

  return new;
end $$;

drop trigger if exists profiles_guard_role on public.profiles;
drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ---------------------------------------------------------------- 2. per-user fn
-- Kept for anyone who signs in later. Guarded on the 'migrated' marker, not on
-- an empty ledger — guarding on "empty" meant a single earned point made a
-- user's pre-ledger history permanently unrecoverable.
create or replace function public.backfill_xp()
returns table (out_xp int, out_days int, out_ran boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  rec   record;
  total int := 0;
  days  int := 0;
  grant_pts int;
  MAX_TOTAL      constant int := 500;
  MAX_PER_DAY    constant int := 12;
  PTS_PER_ACTION constant int := 5;
begin
  if uid is null then raise exception 'Sign in required'; end if;

  if exists (select 1 from public.xp_events where user_id = uid and action = 'migrated') then
    return query select p.xp, 0, false from public.profiles p where p.id = uid;
    return;
  end if;

  for rec in
    select (kv.key)::date as day,
           least(greatest((kv.value)::numeric::int, 0), MAX_PER_DAY) as actions
      from public.user_state us,
           lateral jsonb_each_text(coalesce(us.data->'gamify'->'activity', '{}'::jsonb)) kv
     where us.user_id = uid
       and kv.key ~ '^\d{4}-\d{2}-\d{2}$'
       and (kv.value)::numeric > 0
     order by 1
  loop
    exit when total >= MAX_TOTAL;
    grant_pts := least(rec.actions * PTS_PER_ACTION, MAX_TOTAL - total);
    exit when grant_pts <= 0;
    insert into public.xp_events (user_id, action, points, day)
      values (uid, 'migrated', grant_pts, rec.day);
    total := total + grant_pts;
    days  := days + 1;
  end loop;

  update public.profiles set last_seen = now() where id = uid;
  return query select p.xp, days, true from public.profiles p where p.id = uid;
end $$;

grant execute on function public.backfill_xp() to authenticated;

-- ---------------------------------------------------------------- 3. bulk backfill
-- Every user at once, from their own recorded activity. The running-total window
-- applies the 500 XP ceiling per user; `not exists` skips anyone already migrated,
-- which is what makes this safe to re-run.
with days as (
  select us.user_id,
         (kv.key)::date as day,
         least(greatest((kv.value)::numeric::int, 0), 12) * 5 as pts
    from public.user_state us
    join public.profiles p on p.id = us.user_id
    cross join lateral jsonb_each_text(coalesce(us.data->'gamify'->'activity', '{}'::jsonb)) kv
   where kv.key ~ '^\d{4}-\d{2}-\d{2}$'
     and (kv.value)::numeric > 0
     and not exists (
       select 1 from public.xp_events e
        where e.user_id = us.user_id and e.action = 'migrated')
),
capped as (
  select user_id, day, pts,
         sum(pts) over (partition by user_id order by day
                        rows between unbounded preceding and current row) as running
    from days
)
insert into public.xp_events (user_id, action, points, day)
select user_id, 'migrated', pts, day
  from capped
 where running <= 500 and pts > 0;

-- ---------------------------------------------------------------- 4. recompute all
-- Runs with a null auth.uid(), so the trigger passes these explicit values through.
update public.profiles p
   set xp     = t.total,
       level  = public.xp_level(t.total),
       streak = public.xp_streak(p.id)
  from (
    select pr.id,
           coalesce((select sum(e.points) from public.xp_events e where e.user_id = pr.id), 0)::int as total
      from public.profiles pr
  ) t
 where t.id = p.id;

-- ---------------------------------------------------------------- 5. report
select p.email,
       p.role,
       p.xp,
       p.level,
       p.streak,
       (select count(*) from public.xp_events e
         where e.user_id = p.id and e.action = 'migrated') as days_restored
  from public.profiles p
 order by p.xp desc, p.email;
