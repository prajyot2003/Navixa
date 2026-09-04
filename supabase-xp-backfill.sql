-- Navixa — one-time XP backfill for accounts that predate the ledger.
-- Run once in Supabase → SQL Editor, AFTER supabase-leaderboard.sql. Safe to re-run.
--
-- WHY
-- supabase-leaderboard.sql reset every profile's xp/level/streak to the ledger's
-- truth, and the ledger started empty — so existing users correctly but jarringly
-- dropped to Level 1, 0 XP, 0-day streak. Their day-by-day activity history still
-- exists in user_state.data->gamify->activity, recorded long before any
-- leaderboard existed and therefore with no incentive to inflate it.
--
-- This seeds the ledger from that history so streaks survive and XP is
-- proportionate to real usage.
--
-- HONEST LIMIT: user_state is client-written, so this trusts client data exactly
-- once, for accounts that already existed. It is bounded three ways — capped
-- actions per day, a total ceiling, and it refuses to run if the ledger already
-- has rows — so it cannot be replayed or farmed. Everything AFTER this point
-- goes through award_xp and is server-decided.

create or replace function public.backfill_xp()
returns table (out_xp int, out_days int, out_ran boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  rec   record;
  total int := 0;
  days  int := 0;
  grant_pts int;
  MAX_TOTAL      constant int := 500;  -- ceiling on everything this can ever grant
  MAX_PER_DAY    constant int := 12;   -- actions counted per day
  PTS_PER_ACTION constant int := 5;
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  -- Only ever runs against an empty ledger. This is what makes it unfarmable.
  if exists (select 1 from public.xp_events where user_id = uid) then
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

  -- Touch the row so the guard trigger recomputes xp/level/streak from the
  -- ledger we just wrote. (The trigger is the single source of truth; this
  -- function deliberately does not set the score columns itself.)
  update public.profiles set last_seen = now() where id = uid;

  return query select p.xp, days, true from public.profiles p where p.id = uid;
end $$;

grant execute on function public.backfill_xp() to authenticated;
