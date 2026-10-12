-- 0006: every 5 minutes: call the push-dispatch edge function (it works in Europe/Berlin time itself).
-- Requires private.settings rows 'push_function_url' and 'push_cron_secret' (inserted separately, not in repo).
create or replace function private.call_push_dispatch() returns void
language plpgsql security definer set search_path = private, public as $$
declare u text; s text;
begin
  select value into u from private.settings where key = 'push_function_url';
  select value into s from private.settings where key = 'push_cron_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(url := u, body := '{"action":"dispatch"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s), timeout_milliseconds := 25000);
end $$;
revoke all on function private.call_push_dispatch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'push-dispatch';
select cron.schedule('push-dispatch', '*/5 * * * *', $$select private.call_push_dispatch()$$);
