-- Navixa — tamper-resistant XP + privacy-preserving leaderboard
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- THE PROBLEM THIS SOLVES
-- xp/level/streak used to be plain columns the browser wrote directly. With no
-- leaderboard that was only a cosmetic self-own. The moment scores are ranked
-- publicly it becomes a real integrity problem: anyone could PATCH their own row
-- with the public anon key and sit at the top.
--
-- THE MODEL
-- The client can no longer write xp at all. It calls award_xp('action'), which
-- decides the points server-side, enforces daily caps, and appends to an
-- append-only ledger. profiles.xp is recomputed from that ledger and is
-- therefore derived, never asserted.
--
-- HONEST LIMIT: this bounds cheating, it does not eliminate it. A determined
-- user can still call award_xp for actions they didn't really perform, up to the
-- daily cap. Removing that entirely needs server-side verification of every
-- action, which a browser-only app cannot do. The caps make the ceiling low
-- enough that grinding the leaderboard is slower than just using the app.

-- ---------------------------------------------------------------- ledger
create table if not exists public.xp_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null,
  points     int  not null check (points >= 0 and points <= 100),
  day        date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists xp_events_user_day on public.xp_events (user_id, day);
create index if not exists xp_events_user     on public.xp_events (user_id);

alter table public.xp_events enable row level security;

-- Users may read their own history. NOBODY gets a direct INSERT/UPDATE/DELETE
-- policy — the only way in is award_xp(), which is SECURITY DEFINER.
drop policy if exists xp_events_select_own on public.xp_events;
create policy xp_events_select_own on public.xp_events
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------- profile columns
alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists leaderboard_opt_in boolean not null default false;

-- Handles are the only identity shown on the leaderboard, so they must be
-- unique and must not look like a real name unless the user chooses that.
create unique index if not exists profiles_handle_key on public.profiles (lower(handle));

alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles
  add constraint profiles_handle_format
  check (handle is null or handle ~ '^[a-z][a-z0-9_]{2,19}$');

-- ---------------------------------------------------------------- points table
create or replace function public.xp_points(p_action text)
returns int language sql immutable as $$
  select case p_action
    when 'chat_message'    then 5
    when 'job_save'        then 8
    when 'job_apply'       then 20
    when 'job_search'      then 2
    when 'resume_edit'     then 6
    when 'ats_run'         then 10
    when 'learn_save'      then 8
    when 'learn_complete'  then 15
    when 'tracker_move'    then 5
    when 'mock_interview'  then 15
    when 'goal_done'       then 10
    when 'onboarding'      then 20
    else null
  end
$$;

-- How many times per day an action may earn points.
create or replace function public.xp_daily_cap(p_action text)
returns int language sql immutable as $$
  select case p_action
    when 'chat_message'    then 10
    when 'job_save'        then 15
    when 'job_apply'       then 10
    when 'job_search'      then 20
    when 'resume_edit'     then 15
    when 'ats_run'         then 10
    when 'learn_save'      then 15
    when 'learn_complete'  then 10
    when 'tracker_move'    then 20
    when 'mock_interview'  then 10
    when 'goal_done'       then 3
    when 'onboarding'      then 1
    else 0
  end
$$;

-- ---------------------------------------------------------------- derived stats
create or replace function public.xp_streak(p_user uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  d date := (now() at time zone 'utc')::date;
  n int := 0;
begin
  -- Today only breaks the streak once yesterday is also missing.
  if not exists (select 1 from public.xp_events where user_id = p_user and day = d) then
    d := d - 1;
  end if;
  while exists (select 1 from public.xp_events where user_id = p_user and day = d) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end $$;

create or replace function public.xp_level(p_xp int)
returns int language sql immutable as $$
  -- mirrors levelFromXp() in js/gamify.js: 50*l*(l+1) cumulative to reach l+1
  select greatest(1, floor((sqrt(1 + (4.0 * greatest(p_xp, 0)) / 50.0) - 1) / 2)::int + 1)
$$;

-- ---------------------------------------------------------------- the only way to earn XP
create or replace function public.award_xp(p_action text)
returns table (xp int, level int, streak int, awarded int, capped boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid       uuid := auth.uid();
  pts       int;
  cap       int;
  used      int;
  today     date := (now() at time zone 'utc')::date;
  day_total int;
  new_xp    int;
  gave      int := 0;
  was_cap   boolean := false;
  DAILY_MAX constant int := 300;   -- global ceiling, whatever the mix of actions
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;

  pts := public.xp_points(p_action);
  if pts is null then
    raise exception 'Unknown action: %', p_action;   -- points are never client-supplied
  end if;
  cap := public.xp_daily_cap(p_action);

  if p_action = 'onboarding' then
    select count(*) into used from public.xp_events where user_id = uid and action = 'onboarding';
  else
    select count(*) into used from public.xp_events
     where user_id = uid and action = p_action and day = today;
  end if;

  select coalesce(sum(points), 0) into day_total
    from public.xp_events where user_id = uid and day = today;

  if used >= cap or day_total + pts > DAILY_MAX then
    was_cap := true;                      -- silently earn nothing; not an error
  else
    insert into public.xp_events (user_id, action, points) values (uid, p_action, pts);
    gave := pts;
  end if;

  select coalesce(sum(points), 0) into new_xp from public.xp_events where user_id = uid;

  update public.profiles p
     set xp = new_xp,
         level = public.xp_level(new_xp),
         streak = public.xp_streak(uid),
         last_seen = now()
   where p.id = uid;

  return query
    select new_xp, public.xp_level(new_xp), public.xp_streak(uid), gave, was_cap;
end $$;

-- ---------------------------------------------------------------- handle + opt-in
-- NOTE the out_ prefixes. Naming an OUT column `handle` would collide with
-- profiles.handle inside the function body — plpgsql resolves the bare name to
-- the OUT parameter and raises "column reference handle is ambiguous".
create or replace function public.set_handle(p_handle text, p_opt_in boolean default null)
returns table (out_handle text, out_opt_in boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h   text := lower(trim(coalesce(p_handle, '')));
begin
  if uid is null then raise exception 'Sign in required'; end if;

  if h <> '' then
    if h !~ '^[a-z][a-z0-9_]{2,19}$' then
      raise exception 'Username must be 3–20 characters: letters, numbers and underscores, starting with a letter.';
    end if;
    if h in ('admin','administrator','navixa','root','support','moderator','mod','staff','system','null','undefined','me') then
      raise exception 'That username is reserved — pick another.';
    end if;
    if exists (select 1 from public.profiles where lower(handle) = h and id <> uid) then
      raise exception 'That username is taken — pick another.';
    end if;
  end if;

  update public.profiles p
     set handle = nullif(h, ''),
         leaderboard_opt_in = coalesce(p_opt_in, p.leaderboard_opt_in)
   where p.id = uid;

  return query select p.handle, p.leaderboard_opt_in from public.profiles p where p.id = uid;
end $$;

-- ---------------------------------------------------------------- leaderboard reads
-- SECURITY DEFINER so it can rank across users, but it only ever returns the
-- handle. Real name, email, avatar and user id are never exposed. Appearing at
-- all requires opting in AND setting a handle.
create or replace function public.leaderboard(p_limit int default 25)
returns table (rank bigint, handle text, xp int, level int, streak int, is_me boolean)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by p.xp desc, p.handle asc) as rank,
         p.handle, p.xp, p.level, p.streak,
         p.id = auth.uid() as is_me
    from public.profiles p
   where p.leaderboard_opt_in
     and p.handle is not null
     and p.xp > 0
   order by p.xp desc, p.handle asc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
$$;

-- Your own position even when you are outside the top N.
create or replace function public.my_leaderboard_rank()
returns table (rank bigint, total bigint, handle text, xp int, level int, opted_in boolean)
language sql stable security definer set search_path = public as $$
  with board as (
    select p.id, row_number() over (order by p.xp desc, p.handle asc) as rank
      from public.profiles p
     where p.leaderboard_opt_in and p.handle is not null and p.xp > 0
  )
  select b.rank,
         (select count(*) from board),
         p.handle, p.xp, p.level, p.leaderboard_opt_in
    from public.profiles p
    left join board b on b.id = p.id
   where p.id = auth.uid()
$$;

grant execute on function public.award_xp(text)                    to authenticated;
grant execute on function public.set_handle(text, boolean)         to authenticated;
grant execute on function public.leaderboard(int)                  to authenticated, anon;
grant execute on function public.my_leaderboard_rank()             to authenticated;

-- ---------------------------------------------------------------- lock the score columns
-- Identity columns raise (an attempt is a signal). Derived score columns revert
-- silently, because an older cached client may still be pushing them and that
-- should not break its sync.
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Trusted server-side context (SQL editor, migrations, service role): auth.uid()
  -- is null only when there is no end-user JWT. This is NOT a hole — an anonymous
  -- PostgREST request also has a null uid, but the profiles_update_own policy
  -- (auth.uid() = id) matches zero rows for it, so RLS stops it before this runs.
  -- Without this, the reconciliation UPDATE at the bottom of this file would be
  -- silently reverted by this very trigger.
  if auth.uid() is null then
    return new;
  end if;

  -- Identity columns: admins may change these — that is what the console is for.
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

  -- Scores are DERIVED — for EVERYONE, admins included. Two things this gets
  -- right that earlier versions did not:
  --   * Recomputing (rather than reverting to the old value) means a cheating
  --     client's number is replaced by the real one, and award_xp's own UPDATE
  --     still lands. auth.uid() is still the end user inside a SECURITY DEFINER
  --     function, so a plain revert silently undid every award.
  --   * Admins are NOT exempt. Exempting them meant an admin's profile never
  --     recomputed at all, so their ledger could be full while the column stayed
  --     at zero. An admin has no more business asserting their own XP than
  --     anyone else.
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

-- One-time reconciliation: existing xp columns were client-asserted and cannot
-- be trusted, and there is no ledger behind them. Reset to the ledger's truth.
-- (Runs through the trigger above, which is why that trigger must let a null
--  auth.uid() through — otherwise this statement would revert itself.)
-- NOTE the ::int cast. sum() over an int column returns BIGINT, and Postgres
-- will not implicitly narrow that to match xp_level(int) — function resolution
-- only considers implicit casts, and bigint→int is an assignment cast. Without
-- the cast this fails with "function public.xp_level(bigint) does not exist".
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
