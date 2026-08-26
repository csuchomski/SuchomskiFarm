-- Remove the two demo farms seeded by migration 063, completely.
--
-- **This is a hard delete and it is meant to be.** Every other delete in
-- this codebase is a soft one, because every other row is somebody's
-- record. These are fixtures: nothing here happened, nobody needs it back,
-- and leaving soft-deleted demo rows behind would put invented animals in
-- the way of every future count.
--
-- Run this before re-running 063; the seed refuses to run twice.
--
-- ── Why this sweeps rather than lists ──────────────────────────────────
--
-- Eighty-eight tables in the herd schema carry a `farm_id`, and creating a
-- farm fills several of them by trigger — `registries` is seeded per farm,
-- which is what a hand-written list first tripped over. A list of table
-- names would be wrong the day somebody adds the eighty-ninth.
--
-- So it deletes from every base table that has a `farm_id`, in repeated
-- passes, swallowing foreign-key violations and trying again. A row that
-- cannot go yet is a row whose child is still there, and the next pass
-- takes it. When a pass frees nothing, whatever is left is genuinely stuck
-- and is reported by name rather than passed over in silence.

begin;

do $drop$
declare
  v_names text[] := array['Grassway Organics', 'Green Pastures Farm'];
  v_name text;
  v_business bigint;
  v_farm uuid;
  v_customers uuid[];
  v_tables text[];
  v_tbl text;
  v_freed bigint;
  v_pass int;
  v_left bigint;
  v_stuck text[];
  v_n bigint;
begin
  -- Base tables only: several of these names are views over the same data,
  -- and a delete against a view either fails or lies.
  select array_agg(c.table_name order by c.table_name)
    into v_tables
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'herd'
     and c.column_name = 'farm_id'
     and t.table_type = 'BASE TABLE'
     -- Handled explicitly at the end: membership is what the farm row needs
     -- gone last, and the audit log is a record of the deleting itself.
     and c.table_name not in ('farm_members', 'audit_log');

  foreach v_name in array v_names loop
    select id into v_business from public.businesses where name = v_name;
    if v_business is null then
      raise notice 'No business named "%" — nothing to drop.', v_name;
      continue;
    end if;

    select id into v_farm from herd.farms where business_id = v_business;

    -- ── store ───────────────────────────────────────────────────────
    --
    -- Customers are collected before the orders go, because the orders are
    -- what identifies them.
    select coalesce(array_agg(distinct customer_id), '{}')
      into v_customers
      from public.orders where business_id = v_business;

    delete from public.orders where business_id = v_business;
    delete from public.schedules where business_id = v_business;
    delete from public.inventory_batches where business_id = v_business;
    delete from public.products where business_id = v_business;
    delete from public.payment_methods where business_id = v_business;

    -- Only the seeded ones. A real customer who also bought here would not
    -- match all three conditions, and must not go with the fixture.
    delete from public.profiles
     where id = any(v_customers)
       and has_login = false
       and email like 'demo+%@example.invalid';

    -- ── books ───────────────────────────────────────────────────────
    delete from public.ledger_transactions where business_id = v_business;
    delete from public.ledger_accounts where business_id = v_business;

    -- ── herd, swept ─────────────────────────────────────────────────
    if v_farm is not null then
      for v_pass in 1..12 loop
        v_freed := 0;
        foreach v_tbl in array v_tables loop
          begin
            execute format('delete from herd.%I where farm_id = $1', v_tbl) using v_farm;
            get diagnostics v_n = row_count;
            v_freed := v_freed + v_n;
          exception when foreign_key_violation then
            -- A child is still holding it. The next pass will get it once
            -- that child's own table has been cleared.
            null;
          end;
        end loop;
        exit when v_freed = 0;
      end loop;

      -- Anything still standing is a real dependency this does not know
      -- about, and saying so beats a farm row that silently will not delete.
      v_stuck := array[]::text[];
      foreach v_tbl in array v_tables loop
        execute format('select count(*) from herd.%I where farm_id = $1', v_tbl)
          into v_left using v_farm;
        if v_left > 0 then
          v_stuck := v_stuck || (v_tbl || '=' || v_left);
        end if;
      end loop;
      if array_length(v_stuck, 1) > 0 then
        raise exception 'Could not clear % — rows left in: %', v_name, array_to_string(v_stuck, ', ');
      end if;

      delete from herd.audit_log where farm_id = v_farm;
      delete from herd.farm_members where farm_id = v_farm;
      delete from herd.farms where id = v_farm;
    end if;

    -- ── the business itself ─────────────────────────────────────────
    delete from public.business_members where business_id = v_business;
    delete from public.business_modules where business_id = v_business;
    delete from public.businesses where id = v_business;

    raise notice 'Dropped % (business %, farm %)', v_name, v_business, v_farm;
  end loop;
end
$drop$;

commit;
