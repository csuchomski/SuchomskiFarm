-- 074 — the shop knows whose shelf it is
--
-- STATUS: run 2026-10-21
--
-- Asked for: the farm store showing one farm at a time. An owner of three
-- farms opened the shop and got all three farms' products in one list, with
-- nothing saying which was which, because the product policy lets a member
-- see their own farms' products as well as every farm whose store is open.
--
-- The shop can tell the products apart — each carries business_id — but it
-- cannot put a name to them. `businesses` is readable only by members, so a
-- customer, who is a member of nothing, sees ids and no names.
--
-- This returns the name of a farm only where the shop is allowed to show its
-- products anyway: the farm's store is switched on, or the caller is one of
-- its people. Asking about any other farm returns nothing for it, so this is
-- no way to list the farms on the instance.

create or replace function public.shop_farm_names(p_ids bigint[])
returns table (id bigint, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.name
    from public.businesses b
   where b.id = any(p_ids)
     and (public.business_has_module(b.id, 'store') or public.is_business_member(b.id))
   order by b.name;
$$;

revoke execute on function public.shop_farm_names(bigint[]) from public;
grant  execute on function public.shop_farm_names(bigint[]) to anon, authenticated;
