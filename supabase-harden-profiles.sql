-- Navixa — lock identity columns on public.profiles
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS
-- RLS decides WHICH ROWS you may update, not WHICH COLUMNS. The existing policy
--   profiles_update_own USING (auth.uid() = id)
-- correctly stops you touching anyone else's row, but within your OWN row it
-- allowed every column. Only `role` was protected (by the old trigger).
--
-- That matters because the anon key is public by design: any signed-in user can
-- call PostgREST directly from a console and PATCH their own profile row. They
-- could not become an admin, but they could rewrite their `email`, which is the
-- field the admin console and feedback records identify people by.
--
-- This replaces the role-only guard with a full identity guard.

create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Admins manage other people's rows through the admin console.
  if public.is_admin() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'profiles.id cannot be changed';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only admins can change roles';
  end if;

  -- email mirrors the OAuth provider; it is an identifier, not a preference.
  if new.email is distinct from old.email then
    raise exception 'profiles.email is set by your sign-in provider and cannot be changed';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at cannot be changed';
  end if;

  return new;
end $$;

-- Replace the narrower role-only trigger.
drop trigger if exists profiles_guard_role on public.profiles;
drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

drop function if exists public.guard_role_change();

-- DELIBERATELY STILL WRITABLE BY THE OWNER:
--   name, avatar_url        cosmetic, and yours
--   xp, level, streak, stats, last_seen
--                           the browser is the only thing that computes these,
--                           so they are client-trusted BY DESIGN. A user can
--                           inflate their own XP. There is no leaderboard and
--                           nothing is awarded for it, so this is a cosmetic
--                           self-own, not a security boundary. Making it
--                           tamper-proof would require computing progress
--                           server-side, which this architecture does not have.
