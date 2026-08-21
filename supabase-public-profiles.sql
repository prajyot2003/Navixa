-- Navixa — public profile pages (run once in Supabase → SQL Editor)
--
-- Deliberately a SEPARATE table from `profiles`: that table holds email, role
-- and usage stats which must never be world-readable. This one holds only the
-- curated snapshot the user explicitly chose to publish.

create table if not exists public.public_profiles (
  slug        text primary key,
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,   -- name, headline, summary, experience… (user-curated)
  published   boolean not null default false,
  views       int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- slugs: lowercase letters, numbers and hyphens, 3-40 chars
alter table public.public_profiles drop constraint if exists public_profiles_slug_format;
alter table public.public_profiles
  add constraint public_profiles_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

alter table public.public_profiles enable row level security;

-- ANYONE (including logged-out visitors) may read a profile that is published.
drop policy if exists public_profiles_read on public.public_profiles;
create policy public_profiles_read on public.public_profiles
  for select using (published = true);

-- Owners can always read their own, published or not.
drop policy if exists public_profiles_read_own on public.public_profiles;
create policy public_profiles_read_own on public.public_profiles
  for select using (auth.uid() = user_id);

-- Owners manage only their own row.
drop policy if exists public_profiles_insert on public.public_profiles;
create policy public_profiles_insert on public.public_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists public_profiles_update on public.public_profiles;
create policy public_profiles_update on public.public_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists public_profiles_delete on public.public_profiles;
create policy public_profiles_delete on public.public_profiles
  for delete using (auth.uid() = user_id);

-- keep updated_at fresh
create or replace function public.touch_public_profile()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists public_profiles_touch on public.public_profiles;
create trigger public_profiles_touch
  before update on public.public_profiles
  for each row execute function public.touch_public_profile();

-- Count a view without granting UPDATE on the row to the public.
create or replace function public.bump_profile_views(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.public_profiles set views = views + 1
   where slug = p_slug and published = true;
$$;

grant execute on function public.bump_profile_views(text) to anon, authenticated;
