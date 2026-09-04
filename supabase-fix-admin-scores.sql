-- Navixa — fix: admin profiles never recomputed their score.
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- THE BUG
-- The guard trigger returned early for admins, so xp/level/streak were never
-- recalculated for them. An admin's ledger could be fully populated while the
-- profile columns sat at 0 — which is exactly what happened: backfill_xp() wrote
-- all seven days to xp_events, and profiles.xp stayed at zero.
--
-- THE FIX
-- Admins keep their exemption for IDENTITY columns (that is what the console is
-- for), but scores are now derived for everyone. An admin has no more business
-- asserting their own XP than anyone else.
--
-- This file replaces the trigger function and then recomputes every profile from
-- the ledger, so existing accounts are corrected immediately.

create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server-side context (SQL editor, migrations, service role).
  -- Safe: an anonymous PostgREST request also has a null uid, but the
  -- profiles_update_own policy (auth.uid() = id) matches zero rows for it.
  if auth.uid() is null then
    return new;
  end if;

  -- Identity columns — admins may change these.
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

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- Recompute every profile from its ledger. Runs with a null auth.uid(), so the
-- trigger passes it straight through and these explicit values stick.
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

-- Show the result.
select email, xp, level, streak from public.profiles order by xp desc;
