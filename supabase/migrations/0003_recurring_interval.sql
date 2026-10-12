-- 0003: Fixkosten-Intervall (monatlich / vierteljährlich / halbjährlich / jährlich)
-- Backward compatible: new column with default 1 (= monthly, the old behaviour). Older app versions
-- neither send nor read it; their upserts leave it untouched.
alter table public.recurring_rules
  add column if not exists interval_months smallint not null default 1;
do $$ begin
  alter table public.recurring_rules add constraint recurring_rules_interval_chk check (interval_months in (1, 3, 6, 12));
exception when duplicate_object then null; end $$;

-- Guard against older app versions (which book every month): an auto-generated booking
-- (recurring_id set, untouched: created_at = updated_at) for a non-monthly rule is only accepted
-- in due months. Off-period rows are silently skipped, so they never reach the other phone.
create or replace function public.recurring_due_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; d int;
begin
  if new.recurring_id is null or new.created_at is distinct from new.updated_at then return new; end if;
  select interval_months, start_month into r from public.recurring_rules
    where id = new.recurring_id and household_id = new.household_id;
  if not found or r.interval_months = 1 then return new; end if;
  d := (extract(year from new.date)::int * 12 + extract(month from new.date)::int)
     - (split_part(r.start_month, '-', 1)::int * 12 + split_part(r.start_month, '-', 2)::int);
  if d < 0 or d % r.interval_months <> 0 then return null; end if;
  return new;
end $$;
revoke execute on function public.recurring_due_guard() from public, anon, authenticated;

drop trigger if exists transactions_recurring_guard on public.transactions;
create trigger transactions_recurring_guard before insert on public.transactions
  for each row execute function public.recurring_due_guard();
