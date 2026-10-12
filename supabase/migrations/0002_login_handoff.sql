-- Login hand-off for the installed iOS home-screen app (PWA).
-- On the free plan with the built-in email provider, email templates can't be changed, so the
-- sign-in email only contains a link (no code). Links open in Safari, whose storage is separate
-- from the home-screen app. Flow:
--   1. App generates a random 256-bit secret, requests the email with redirect ...?pair=<secret>.
--   2. User taps the link -> Safari page receives the session, calls store_login_handoff(secret, refresh_token)
--      and discards its own copy (never uses it again).
--   3. The app polls claim_login_handoff(secret) and signs in with the refresh token (one-time, 15 min TTL).
-- Only the SHA-256 hash of the secret is stored.

create table if not exists public.login_handoffs (
  secret_hash text primary key,
  refresh_token text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.login_handoffs enable row level security; -- no policies: only reachable via functions below
revoke all on public.login_handoffs from anon, authenticated;

create or replace function public.store_login_handoff(p_secret text, p_refresh_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if length(p_secret) < 32 then raise exception 'weak_secret'; end if;
  delete from public.login_handoffs where created_at < now() - interval '15 minutes';
  insert into public.login_handoffs (secret_hash, refresh_token, user_id)
  values (encode(digest(p_secret, 'sha256'), 'hex'), p_refresh_token, auth.uid())
  on conflict (secret_hash) do update set refresh_token = excluded.refresh_token, user_id = excluded.user_id, created_at = now();
end $$;

create or replace function public.claim_login_handoff(p_secret text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if length(p_secret) < 32 then return null; end if;
  delete from public.login_handoffs
   where secret_hash = encode(digest(p_secret, 'sha256'), 'hex') and created_at > now() - interval '15 minutes'
  returning refresh_token into tok;
  return tok;
end $$;

revoke execute on function public.store_login_handoff(text, text) from public, anon;
grant execute on function public.store_login_handoff(text, text) to authenticated;
revoke execute on function public.claim_login_handoff(text) from public;
grant execute on function public.claim_login_handoff(text) to anon, authenticated;
