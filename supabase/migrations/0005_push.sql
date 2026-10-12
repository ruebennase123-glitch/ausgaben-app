-- 0005: Web-Push-Benachrichtigungen (iOS 16.4+ Home-Bildschirm-App). Additive / abwärtskompatibel.

-- Who entered a booking (needed for „Partner hat etwas eingetragen“). Older app versions don't send it;
-- the default fills it on insert, upserts of existing rows leave it untouched.
alter table public.transactions add column if not exists created_by uuid default auth.uid();

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions read" on public.push_subscriptions;
drop policy if exists "own subscriptions delete" on public.push_subscriptions;
create policy "own subscriptions read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own subscriptions delete" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
-- insert/update only via register_push_subscription (an endpoint may move to another account on the same phone)

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  evening_enabled boolean not null default true,
  evening_time time not null default '20:30',
  monthly_enabled boolean not null default true,
  partner_enabled boolean not null default false,
  budget_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  last_evening_sent date,
  last_monthly_sent text,
  partner_cursor timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "own prefs read" on public.notification_prefs;
drop policy if exists "own prefs insert" on public.notification_prefs;
drop policy if exists "own prefs update" on public.notification_prefs;
create policy "own prefs read" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "own prefs insert" on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "own prefs update" on public.notification_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- clients may only change the toggles, not the server's bookkeeping columns
revoke update on public.notification_prefs from authenticated;
grant select, insert on public.notification_prefs to authenticated;
grant update (evening_enabled, evening_time, monthly_enabled, partner_enabled, budget_enabled, updated_at) on public.notification_prefs to authenticated;

-- Dedupe for budget warnings (per household, category, month, level 80/100)
create table if not exists public.budget_alerts_sent (
  household_id uuid not null references public.households(id) on delete cascade,
  category_id text not null,
  month text not null,
  level int not null,
  sent_at timestamptz not null default now(),
  primary key (household_id, category_id, month, level)
);
alter table public.budget_alerts_sent enable row level security; -- no policies: server only

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, failures = 0;
  insert into public.notification_prefs (user_id) values (auth.uid()) on conflict do nothing;
end $$;
revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Server-side secret for the cron → edge function call (never exposed to clients)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);
revoke all on private.settings from public, anon, authenticated;

create extension if not exists pg_net;
create extension if not exists pg_cron;
