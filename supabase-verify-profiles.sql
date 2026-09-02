-- Navixa — verify the profiles guard actually works.
-- Run in Supabase → SQL Editor AFTER supabase-harden-profiles.sql.
-- Read-only: every write is rolled back.
--
-- Expected output: six rows, all with result = 'PASS'.

do $$
declare
  victim uuid;
  other  uuid;
  msg    text;
  ok     boolean;
begin
  select id into victim from public.profiles where role = 'client' order by created_at limit 1;
  select id into other  from public.profiles where id <> victim limit 1;

  if victim is null then
    raise notice 'SKIPPED — no client profile to test against';
    return;
  end if;

  -- Impersonate that user: this is exactly what the anon key gives a signed-in
  -- person in their browser console.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', victim, 'role', 'authenticated')::text, true);

  -- 1. role escalation
  begin
    update public.profiles set role = 'admin' where id = victim;
    raise notice 'role escalation      | result = FAIL (update succeeded!)';
  exception when others then
    raise notice 'role escalation      | result = PASS (blocked: %)', sqlerrm;
  end;

  -- 2. email rewrite
  begin
    update public.profiles set email = 'attacker@example.com' where id = victim;
    raise notice 'email rewrite        | result = FAIL (update succeeded!)';
  exception when others then
    raise notice 'email rewrite        | result = PASS (blocked: %)', sqlerrm;
  end;

  -- 3. created_at rewrite
  begin
    update public.profiles set created_at = now() - interval '10 years' where id = victim;
    raise notice 'created_at rewrite   | result = FAIL (update succeeded!)';
  exception when others then
    raise notice 'created_at rewrite   | result = PASS (blocked: %)', sqlerrm;
  end;

  -- 4. writing to SOMEONE ELSE's row (should be stopped by RLS, not the trigger)
  if other is not null then
    update public.profiles set name = 'hacked' where id = other;
    get diagnostics msg = row_count;
    if msg = '0' then
      raise notice 'edit another user    | result = PASS (RLS matched 0 rows)';
    else
      raise notice 'edit another user    | result = FAIL (% rows changed!)', msg;
    end if;
  end if;

  -- 5. reading SOMEONE ELSE's private app data
  select count(*) = 0 into ok from public.user_state where user_id <> victim;
  raise notice 'read others'' state   | result = %', case when ok then 'PASS (0 rows visible)' else 'FAIL (visible!)' end;

  -- 6. changing your own display name still works (must NOT be broken)
  begin
    update public.profiles set name = name where id = victim;
    raise notice 'own name still editable | result = PASS';
  exception when others then
    raise notice 'own name still editable | result = FAIL (%)', sqlerrm;
  end;

  raise exception 'rollback — verification only, no data changed';
exception
  when others then
    if sqlerrm <> 'rollback — verification only, no data changed' then raise; end if;
    raise notice '--- all test writes rolled back ---';
end $$;
