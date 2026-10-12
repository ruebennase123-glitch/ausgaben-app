-- 0004: Join another household although already in one (e.g. both partners created their own).
-- Allowed only if the caller is the ONLY member of the current household: that household is then
-- deleted (cascade; the app first offers to move this phone's local entries into the new household).
-- Households with 2 members are never touched.
create or replace function public.switch_household(p_code text)
returns setof public.households
language plpgsql security definer set search_path = public as $$
declare target public.households; cur uuid; n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into target from public.households where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if target.id is null then raise exception 'invalid_code'; end if;
  select household_id into cur from public.household_members where user_id = auth.uid();
  if cur = target.id then return query select * from public.households where id = target.id; return; end if;
  if cur is not null then
    select count(*) into n from public.household_members where household_id = cur;
    if n > 1 then raise exception 'household_shared'; end if;
    if (select count(*) from public.household_members where household_id = target.id) >= 2 then raise exception 'household_full'; end if;
    delete from public.households where id = cur;  -- cascades membership + data of the 1-person household
  end if;
  return query select * from public.join_household(p_code);
end $$;
revoke execute on function public.switch_household(text) from anon, public;
grant execute on function public.switch_household(text) to authenticated;
