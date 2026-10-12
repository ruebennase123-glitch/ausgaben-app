-- Haushaltsbuch: shared household sync schema
-- Every synced row: client-generated uuid / natural key, household_id, updated_at (client clock, LWW),
-- server_updated_at (server clock, pull cursor), deleted (tombstone).

create extension if not exists pgcrypto;

-- ---------- Households & members ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  settings jsonb not null default '{}'::jsonb,          -- { persons: [...], joint: {...} }
  settings_updated_at timestamptz not null default 'epoch',
  server_updated_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('p1', 'p2')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, slot),
  unique (user_id)
);

create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid());
$$;

-- ---------- Data tables ----------
create table if not exists public.transactions (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  amount_cents integer not null check (amount_cents >= 0),
  category_id text not null,
  person_id text not null check (person_id in ('p1', 'p2', 'joint')),
  note text,
  date date not null,
  recurring_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  created_by uuid default auth.uid(),
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.recurring_rules (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('expense', 'income')),
  amount_cents integer not null check (amount_cents >= 0),
  category_id text not null,
  person_id text not null check (person_id in ('p1', 'p2', 'joint')),
  note text not null default '',
  day_of_month smallint not null check (day_of_month between 1 and 31),
  start_month text not null,
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.budgets (
  household_id uuid not null references public.households(id) on delete cascade,
  category_id text not null,
  limit_cents integer not null check (limit_cents >= 0),
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (household_id, category_id)
);

create table if not exists public.savings_goals (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  emoji text not null,
  target_cents integer not null check (target_cents >= 0),
  reached_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- Deposits are append-only rows (no lost updates when both deposit at the same time)
create table if not exists public.goal_contributions (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  person_id text not null check (person_id in ('p1', 'p2', 'joint')),
  amount_cents integer not null,
  date date not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.checkins (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  person_id text not null check (person_id in ('p1', 'p2')),
  date date not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.badges (
  household_id uuid not null references public.households(id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (household_id, badge_id)
);

-- ---------- Last-write-wins trigger ----------
create or replace function public.sync_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- keep the newer version (by client updated_at); equal = no-op (prevents echo loops)
    if new.updated_at <= old.updated_at then
      return null;
    end if;
    new.household_id := old.household_id; -- rows can't be moved between households
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','recurring_rules','budgets','savings_goals','goal_contributions','checkins','badges'] loop
    execute format('drop trigger if exists %I_lww on public.%I', t, t);
    execute format('create trigger %I_lww before insert or update on public.%I for each row execute function public.sync_lww()', t, t);
    execute format('create index if not exists %I_pull_idx on public.%I (household_id, server_updated_at)', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "members insert" on public.%I', t);
    execute format('drop policy if exists "members update" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(household_id))', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.is_member(household_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
    -- no delete policy: deletions are tombstones (deleted = true)
  end loop;
end $$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
drop policy if exists "members read household" on public.households;
create policy "members read household" on public.households for select to authenticated using (public.is_member(id));
drop policy if exists "members read members" on public.household_members;
create policy "members read members" on public.household_members for select to authenticated using (public.is_member(household_id));

revoke all on all tables in schema public from anon;

-- ---------- RPCs ----------
create or replace function public.gen_invite_code() returns text language plpgsql set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  b bytea;
begin
  loop
    b := gen_random_bytes(6);
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function public.my_household()
returns table (household_id uuid, invite_code text, slot text, settings jsonb, settings_updated_at timestamptz, member_count int)
language sql stable security definer set search_path = public as $$
  select h.id, h.invite_code, m.slot, h.settings, h.settings_updated_at,
         (select count(*)::int from public.household_members x where x.household_id = h.id)
  from public.household_members m join public.households h on h.id = m.household_id
  where m.user_id = auth.uid();
$$;

create or replace function public.create_household(p_settings jsonb, p_settings_updated_at timestamptz)
returns setof public.households
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  insert into public.households (invite_code, settings, settings_updated_at, created_by)
  values (public.gen_invite_code(), coalesce(p_settings, '{}'::jsonb), coalesce(p_settings_updated_at, now()), auth.uid())
  returning id into hid;
  insert into public.household_members (household_id, user_id, slot) values (hid, auth.uid(), 'p1');
  return query select * from public.households where id = hid;
end $$;

create or replace function public.join_household(p_code text)
returns setof public.households
language plpgsql security definer set search_path = public as $$
declare h public.households; free_slot text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into h from public.households where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if h.id is null then raise exception 'invalid_code'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid() and household_id = h.id) then
    return query select * from public.households where id = h.id; return;
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  select s into free_slot from unnest(array['p1','p2']) s
   where not exists (select 1 from public.household_members m where m.household_id = h.id and m.slot = s) limit 1;
  if free_slot is null then raise exception 'household_full'; end if;
  insert into public.household_members (household_id, user_id, slot) values (h.id, auth.uid(), free_slot);
  return query select * from public.households where id = h.id;
end $$;

create or replace function public.update_household_settings(p_household uuid, p_settings jsonb, p_updated_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not_member'; end if;
  update public.households
     set settings = p_settings, settings_updated_at = p_updated_at, server_updated_at = clock_timestamp()
   where id = p_household and settings_updated_at < p_updated_at;
  return found;
end $$;

revoke execute on function public.create_household(jsonb, timestamptz) from anon, public;
revoke execute on function public.join_household(text) from anon, public;
revoke execute on function public.update_household_settings(uuid, jsonb, timestamptz) from anon, public;
revoke execute on function public.my_household() from anon, public;
revoke execute on function public.gen_invite_code() from anon, public, authenticated;
grant execute on function public.create_household(jsonb, timestamptz) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.update_household_settings(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.my_household() to authenticated;

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['households','transactions','recurring_rules','budgets','savings_goals','goal_contributions','checkins','badges'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
