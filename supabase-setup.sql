-- ============================================================
-- Navixa — Supabase schema, roles & row-level security
-- Paste this whole file into: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run (idempotent-ish: uses "if not exists" / "or replace")
-- ============================================================

-- 1) PROFILES: one row per user; role drives admin/client separation
create table if not exists public.profiles (
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

-- 2) USER STATE: each user's app data (private — admins can NOT read it)
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3) APP CONFIG: global settings the admin console controls
create table if not exists public.app_config (
  id int primary key check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id, config) values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- 4) FEEDBACK: client submissions → admin inbox
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  name text,
  message text not null check (char_length(message) between 3 and 4000),
  status text not null default 'new' check (status in ('new','seen','done')),
  created_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

-- Auto-create profile + state on signup. FIRST ADMIN IS SEEDED BY EMAIL BELOW.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email,'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case when lower(coalesce(new.email,'')) = lower('prajyotkumar2003@gmail.com') then 'admin' else 'client' end
  ) on conflict (id) do nothing;
  insert into public.user_state (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles; nobody can self-service-promote.
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------- row level security ----------
alter table public.profiles  enable row level security;
alter table public.user_state enable row level security;
alter table public.app_config enable row level security;
alter table public.feedback  enable row level security;

-- profiles: read own; admins read all; update own (role guarded); admins update any
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (auth.uid() = id or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (auth.uid() = id);
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update
  using (public.is_admin());

-- user_state: strictly private to the owner. Admins may DELETE (wipe) but never read.
drop policy if exists state_select_own on public.user_state;
create policy state_select_own on public.user_state for select using (auth.uid() = user_id);
drop policy if exists state_upsert_own on public.user_state;
create policy state_upsert_own on public.user_state for insert with check (auth.uid() = user_id);
drop policy if exists state_update_own on public.user_state;
create policy state_update_own on public.user_state for update using (auth.uid() = user_id);
drop policy if exists state_delete on public.user_state;
create policy state_delete on public.user_state for delete
  using (auth.uid() = user_id or public.is_admin());

-- app_config: anyone (even signed-out) can read; only admins write
drop policy if exists config_read_all on public.app_config;
create policy config_read_all on public.app_config for select using (true);
drop policy if exists config_write_admin on public.app_config;
create policy config_write_admin on public.app_config for update using (public.is_admin());

-- feedback: signed-in users insert their own; admins read/update/delete
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert
  with check (auth.uid() = user_id);
drop policy if exists feedback_admin_select on public.feedback;
create policy feedback_admin_select on public.feedback for select using (public.is_admin());
drop policy if exists feedback_admin_update on public.feedback;
create policy feedback_admin_update on public.feedback for update using (public.is_admin());
drop policy if exists feedback_admin_delete on public.feedback;
create policy feedback_admin_delete on public.feedback for delete using (public.is_admin());

-- Done. If you signed in BEFORE running this file, promote yourself once:
-- update public.profiles set role = 'admin' where lower(email) = lower('prajyotkumar2003@gmail.com');
