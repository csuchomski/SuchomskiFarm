-- 063 — Two demo farms, so the app can be tested and shown at scale.
--
-- Every screen in this app has only ever been seen against one farm with six
-- animals and twelve ledger entries. That is not a test of anything: a
-- paddock list that reads well at five rows may be unusable at fifty, a mob
-- of six weighs nothing, and a thirteen-week cash forecast built from two
-- transactions cannot show a trough.
--
-- So: two farms, sized like real ones.
--
--   Grassway Organics, East Troy WI — mid-sized. Organic dairy with a farm
--   store: a milking herd, a rotation of medium paddocks, a weekly customer
--   trade.
--
--   Green Pastures Farm, Missouri — large. Greg Judy's operation is the
--   reference for mob grazing at scale: many small paddocks, several mobs,
--   a lot of head, and direct-marketed beef.
--
-- ── This is invented data ──────────────────────────────────────────────
--
-- The names and locations are real farms. **Everything below is synthetic.**
-- No figure here came from either business, none of it is a claim about how
-- they operate or what they earn, and none of it should ever be presented as
-- their records. They are recognisable names on a fixture, chosen so a demo
-- feels like a farm rather than like a spreadsheet.
--
-- Each farm's grazing plan carries "Sample data" in its notes so anybody
-- looking at the database can tell.
--
-- ── Re-running ─────────────────────────────────────────────────────────
--
-- Refuses rather than duplicating. If either business already exists this
-- raises and rolls back, so a second run cannot silently create a second
-- Grassway with another 96 animals in it. To reseed, run the teardown in
-- docs/migrations/runbook/063-drop-demo-farms.sql first.
--
-- ── Owner ──────────────────────────────────────────────────────────────
--
-- Both farms are granted to c3bec7a2-9b0d-4ec6-8994-accd67660e1f, in
-- `business_members` *and* `herd.farm_members`. Both are needed and they are
-- not the same grant: the workspace switcher reads the first, and every RLS
-- policy in the herd schema reads the second. One without the other gives
-- you a farm you can select and cannot read.

begin;

do $seed$
declare
  v_owner uuid := 'c3bec7a2-9b0d-4ec6-8994-accd67660e1f';
  v_today date := current_date;

  -- Per-farm configuration, walked in the loop below.
  v_cfg record;
  v_business bigint;
  v_farm uuid;
  v_plan uuid;
  v_mob uuid;
  v_mobs uuid[];
  v_paddocks uuid[];
  v_animals uuid[];
  v_customers uuid[];
  v_products bigint[];
  v_prices numeric[];
  v_schedule bigint;
  v_pid bigint;
  v_cust uuid;
  v_animal uuid;
  v_pad uuid;
  i int;
  j int;
  k int;
  v_day date;
  v_qty numeric;
  v_price numeric;
  v_status text;
  v_total numeric;
  v_acres numeric;
  -- paddock geometry
  v_cols int;
  v_row int;
  v_col int;
  v_along numeric;
  v_across numeric;
  v_lat0 numeric;
  v_lon0 numeric;
  v_dlat numeric;
  v_dlon numeric;
  v_heading numeric;
  c_pitch_ft constant numeric := 2800;
  c_ft_per_deg_lat constant numeric := 364000;
begin
  -- Same data every run, so a demo shown twice looks the same twice.
  perform setseed(0.4242);

  for v_cfg in
    select * from (values
      -- name, paddocks, acres each, animals, mobs, customers, orders,
      -- schedules, ledger rows, opening cash, purpose, and the point the
      -- paddock grid is laid out around.
      ('Grassway Organics',   14, 27.0,  96, 2, 34, 210, 11, 280, 18400.00, 'dairy', 42.7869, -88.4006),
      ('Green Pastures Farm', 46, 34.0, 340, 4, 58, 380, 17, 520, 41200.00, 'beef',  39.2800, -92.3500)
    ) as t(name, n_paddocks, acres, n_animals, n_mobs, n_customers,
           n_orders, n_schedules, n_ledger, opening_cash, purpose, lat, lon)
  loop
    if exists (select 1 from public.businesses where name = v_cfg.name) then
      raise exception
        'A business named "%" already exists. Run runbook/063-drop-demo-farms.sql to reseed.',
        v_cfg.name;
    end if;

    -- ── the business, the farm, and access to both ────────────────────
    insert into public.businesses (name, type) values (v_cfg.name, 'farm')
      returning id into v_business;

    insert into herd.farms (name, business_id, created_by)
      values (v_cfg.name, v_business, v_owner)
      returning id into v_farm;

    insert into public.business_members (business_id, user_id, role)
      values (v_business, v_owner, 'owner');

    insert into herd.farm_members (farm_id, user_id, role)
      values (v_farm, v_owner, 'owner');

    -- Orders carry a payment method by FK, so the business needs its own.
    insert into public.payment_methods (business_id, code, label, active, sort_order)
    values (v_business, 'cash', 'Cash', true, 10),
           (v_business, 'check', 'Check', true, 20),
           (v_business, 'venmo', 'Venmo', true, 30);

    -- ── money ─────────────────────────────────────────────────────────
    insert into public.ledger_accounts (name, opening_balance, business_id)
    values (v_cfg.name || ' Operating', v_cfg.opening_cash, v_business),
           (v_cfg.name || ' Savings', round((v_cfg.opening_cash * 1.4)::numeric, 2), v_business);

    -- Eighteen months of trade. Expenses outnumber receipts because a farm
    -- buys in small amounts often and sells in large amounts rarely, which
    -- is the shape that makes a cash trough appear at all.
    for i in 0..(v_cfg.n_ledger - 1) loop
      v_day := v_today - ((i * 540) / v_cfg.n_ledger);
      if i % 4 = 0 then
        insert into public.ledger_transactions (business_id, date, type, category, amount, payer, account, note)
        values (
          v_business, v_day, 'income',
          (array['Milk sales','Beef sales','Farm store','Eggs','Wholesale'])[1 + (i % 5)],
          round((350 + random() * 2400)::numeric, 2),
          (array['Organic Valley','Farm store','CSA member','Co-op','Restaurant'])[1 + (i % 5)],
          v_cfg.name || ' Operating', null
        );
      else
        insert into public.ledger_transactions (business_id, date, type, category, amount, payer, account, note)
        values (
          v_business, v_day, 'expense',
          (array['Feed','Fuel','Vet','Fencing','Repairs','Seed','Utilities','Labour'])[1 + (i % 8)],
          round((60 + random() * 900)::numeric, 2),
          (array['Co-op','Fuel depot','Large animal vet','Kencove','Hardware'])[1 + (i % 5)],
          v_cfg.name || ' Operating', null
        );
      end if;
    end loop;

    -- ── the ground ────────────────────────────────────────────────────
    --
    -- Every paddock gets a drawn boundary, and that is not decoration: the
    -- Move page draws the farm from these, places the wire on them, and
    -- measures a strip off them. Without a boundary there is no map and no
    -- strip to size, which is most of what a demo is for.
    --
    -- The rectangle is derived from the two figures the app already uses, so
    -- they cannot disagree: it runs `sweep_length_ft` along the sweep
    -- heading, and whatever depth makes the area come to `acres_measured`.
    -- Drawn acres and recorded acres are then the same number by
    -- construction rather than by luck.
    v_cols := ceil(sqrt(v_cfg.n_paddocks::numeric));
    v_paddocks := array[]::uuid[];
    for i in 1..v_cfg.n_paddocks loop
      -- One draw, held in a variable. Calling random() twice made grazable
      -- acres a different paddock's size from measured, and the constraint
      -- that grazable never exceeds measured caught it.
      v_acres := round((v_cfg.acres + (random() - 0.5) * 8)::numeric, 2);
      v_heading := (array[0, 90, 180, 270])[1 + (i % 4)];
      v_along := round((700 + random() * 400)::numeric, 0);
      v_across := round((v_acres * 43560 / v_along)::numeric, 1);

      -- A sweep east-west runs along longitude; north-south runs along
      -- latitude. Getting this backwards would draw every strip across the
      -- paddock instead of along it.
      if v_heading in (90, 270) then
        v_dlon := v_along / (c_ft_per_deg_lat * cosd(v_cfg.lat));
        v_dlat := v_across / c_ft_per_deg_lat;
      else
        v_dlat := v_along / c_ft_per_deg_lat;
        v_dlon := v_across / (c_ft_per_deg_lat * cosd(v_cfg.lat));
      end if;

      v_row := (i - 1) / v_cols;
      v_col := (i - 1) % v_cols;
      v_lat0 := v_cfg.lat + v_row * (c_pitch_ft / c_ft_per_deg_lat);
      v_lon0 := v_cfg.lon + v_col * (c_pitch_ft / (c_ft_per_deg_lat * cosd(v_cfg.lat)));

      insert into herd.paddocks (
        farm_id, name, code, acres_measured, acres_grazable, unit_type,
        sweep_heading_deg, sweep_length_ft, rotation_order, active, created_by,
        boundary
      ) values (
        v_farm,
        'Paddock ' || i,
        'P' || i,
        v_acres,
        round((v_acres - 1.2)::numeric, 2),
        'permanent',
        v_heading,
        v_along,
        i, true, v_owner,
        jsonb_build_object(
          'type', 'Polygon',
          'coordinates', jsonb_build_array(jsonb_build_array(
            jsonb_build_array(v_lon0,          v_lat0),
            jsonb_build_array(v_lon0 + v_dlon, v_lat0),
            jsonb_build_array(v_lon0 + v_dlon, v_lat0 + v_dlat),
            jsonb_build_array(v_lon0,          v_lat0 + v_dlat),
            jsonb_build_array(v_lon0,          v_lat0)
          ))
        )
      ) returning id into v_pad;
      v_paddocks := v_paddocks || v_pad;
    end loop;

    -- ── the plan every other screen compares against ──────────────────
    insert into herd.grazing_plans (
      farm_id, name, period_start, period_end,
      monitoring_cadence_kind, monitoring_cadence_value,
      default_dmi_pct_bw, lb_dm_per_acre_inch, target_residual_height_in,
      default_utilization_pct, active, created_by, notes
    ) values (
      v_farm,
      extract(year from v_today)::text || ' grazing season',
      make_date(extract(year from v_today)::int, 4, 1),
      make_date(extract(year from v_today)::int, 11, 15),
      'every_n_days', 30,
      case when v_cfg.purpose = 'dairy' then 3.2 else 2.6 end,
      case when v_cfg.purpose = 'dairy' then 300 else 250 end,
      case when v_cfg.purpose = 'dairy' then 5 else 4 end,
      case when v_cfg.purpose = 'dairy' then 70 else 55 end,
      true, v_owner,
      'Sample data — this farm is a demo fixture, not a real record.'
    ) returning id into v_plan;

    insert into herd.plan_paddock_targets (
      plan_id, paddock_id, farm_id, target_entry_height_in, target_residual_height_in,
      min_recovery_days_growing, min_recovery_days_dormant, created_by
    )
    select v_plan, p, v_farm,
           case when v_cfg.purpose = 'dairy' then 10 else 14 end,
           case when v_cfg.purpose = 'dairy' then 5 else 4 end,
           28, 65, v_owner
    from unnest(v_paddocks) as p;

    -- ── the mobs ──────────────────────────────────────────────────────
    v_mobs := array[]::uuid[];
    for i in 1..v_cfg.n_mobs loop
      insert into herd.grazing_groups (farm_id, name, species, class, active, created_by)
      values (
        v_farm,
        case
          when v_cfg.purpose = 'dairy' then (array['Milking herd','Dry cows','Heifers','Bulls'])[i]
          else (array['Main mob','Yearlings','Cow-calf','Finishers'])[i]
        end,
        'cattle', 'mixed', true, v_owner
      ) returning id into v_mob;
      v_mobs := v_mobs || v_mob;
    end loop;

    -- ── the herd ──────────────────────────────────────────────────────
    v_animals := array[]::uuid[];
    for i in 1..v_cfg.n_animals loop
      insert into herd.animals (
        farm_id, ear_tag, barn_name, purpose, sex, class, birth_date,
        origin, status, record_type, created_by, tag_color, tag_location
      ) values (
        v_farm,
        lpad(i::text, 4, '0'),
        case when i % 7 = 0 then
          (array['Buttercup','Daisy','Willow','Juniper','Clover','Maple','Hazel','Poppy'])[1 + (i % 8)]
        else '' end,
        v_cfg.purpose,
        case when i % 12 = 0 then 'male' else 'female' end,
        case
          when i % 12 = 0 then 'bull'
          when i % 5 = 0 then 'heifer'
          when i % 11 = 0 then 'calf'
          else 'cow'
        end,
        v_today - ((400 + random() * 2600)::int),
        case when i % 9 = 0 then 'purchased' else 'born_on_farm' end,
        'active', 'herd', v_owner,
        (array['yellow','white','green','orange'])[1 + (i % 4)],
        'left_ear'
      ) returning id into v_animal;
      v_animals := v_animals || v_animal;

      -- A weight, or the mob weighs nothing and every forage figure is null.
      insert into herd.weights (farm_id, animal_id, date, weight_lb, weight_type, created_by)
      values (
        v_farm, v_animal, v_today - (random() * 45)::int,
        case
          when i % 11 = 0 then round((320 + random() * 240)::numeric, 0)
          when i % 12 = 0 then round((1500 + random() * 500)::numeric, 0)
          when i % 5 = 0 then round((820 + random() * 260)::numeric, 0)
          else round((1080 + random() * 340)::numeric, 0)
        end,
        'adhoc', v_owner
      );

      -- Spread across the mobs, so the head counts differ the way they do
      -- on a real farm rather than dividing evenly.
      insert into herd.grazing_group_members (farm_id, group_id, animal_id, joined_on, created_by)
      values (
        v_farm,
        v_mobs[1 + (i % v_cfg.n_mobs)],
        v_animal,
        v_today - 200, v_owner
      );
    end loop;

    -- ── where they have been ──────────────────────────────────────────
    --
    -- Each mob walks the rotation, a couple of days a paddock, for the last
    -- four months. The most recent move per mob is left open — no exit — so
    -- the Move page opens on a mob that is somewhere, which is the state the
    -- page is actually used in.
    for i in 1..v_cfg.n_mobs loop
      k := 0;
      v_day := v_today - 118;
      while v_day < v_today loop
        v_pad := v_paddocks[1 + ((k + i * 3) % v_cfg.n_paddocks)];
        insert into herd.grazing_events (
          farm_id, paddock_id, group_id, entered_at, exited_at,
          head_count, avg_weight_lb, forage_height_in_entry, residual_height_in_exit,
          swept_from, swept_to, supplemental_feed, created_by
        ) values (
          v_farm, v_pad, v_mobs[i],
          v_day::timestamptz + interval '8 hours',
          case when v_day + 2 >= v_today then null else (v_day + 2)::timestamptz + interval '8 hours' end,
          (v_cfg.n_animals / v_cfg.n_mobs)::int,
          round((1020 + random() * 220)::numeric, 0),
          round((8 + random() * 6)::numeric, 1),
          case when v_day + 2 >= v_today then null else round((3.5 + random() * 2)::numeric, 1) end,
          0, round((0.25 + random() * 0.5)::numeric, 3),
          false, v_owner
        );
        k := k + 1;
        v_day := v_day + 2;
      end loop;
    end loop;

    -- ── the store ─────────────────────────────────────────────────────
    v_products := array[]::bigint[];
    v_prices := array[]::numeric[];
    for i in 1..5 loop
      insert into public.products (name, unit, price, business_id, type_code)
      values (
        case when v_cfg.purpose = 'dairy'
          then (array['Milk','Cheese','Yogurt','Ground Beef','Eggs'])[i]
          else (array['Ground Beef','Ribeye','Quarter Beef','Lamb','Eggs'])[i]
        end,
        case when v_cfg.purpose = 'dairy'
          then (array['gallon','pound','quart','pound','dozen'])[i]
          else (array['pound','pound','share','pound','dozen'])[i]
        end,
        case when v_cfg.purpose = 'dairy'
          then (array[9.00, 16.00, 7.50, 8.50, 6.00])[i]
          else (array[9.50, 24.00, 950.00, 14.00, 6.50])[i]
        end,
        v_business,
        -- product_types is a real lookup with a foreign key: milk, meat,
        -- eggs, honey, produce, other. Cheese and yogurt are milk.
        case when v_cfg.purpose = 'dairy'
          then (array['milk','milk','milk','meat','eggs'])[i]
          else (array['meat','meat','meat','meat','eggs'])[i]
        end
      ) returning id into v_pid;
      v_products := v_products || v_pid;
      v_prices := v_prices || (select price from public.products where id = v_pid);

      -- Six weeks of production, so the forecast has a rate to average and
      -- there is stock on hand to sell.
      insert into public.inventory_batches (product_id, produced_date, quantity, reserved, business_id)
      select v_pid, v_today - g,
             round((case when i = 3 and v_cfg.purpose = 'beef' then 1 else 8 + random() * 40 end)::numeric, 1),
             0, v_business
      from generate_series(0, 41) as g;
    end loop;

    -- ── customers ─────────────────────────────────────────────────────
    v_customers := array[]::uuid[];
    for i in 1..v_cfg.n_customers loop
      v_cust := gen_random_uuid();
      insert into public.profiles (id, first_name, last_name, email, role, has_login)
      values (
        v_cust,
        (array['Anna','Ben','Clara','David','Elena','Frank','Grace','Henry','Iris','Jonah',
               'Kate','Liam','Mara','Noah','Olive','Peter','Quinn','Rosa','Sam','Tessa'])[1 + (i % 20)],
        (array['Adler','Brandt','Cortez','Duval','Ericson','Fahey','Grant','Holm','Ibarra','Jansen'])[1 + (i % 10)],
        'demo+' || lower(replace(v_cfg.name, ' ', '')) || i || '@example.invalid',
        'buyer', false
      );
      v_customers := v_customers || v_cust;
    end loop;

    -- ── standing orders ───────────────────────────────────────────────
    --
    -- Weekly goods only. A quarter-beef share is a $950 once-a-year
    -- purchase, and putting it on a weekly subscription had Green Pastures
    -- committed to $11,000 a week — which made the cash forecast say it
    -- could never run short, from a fixture rather than from anything true.
    -- Anything priced like a bulk purchase is left to one-off orders below.
    for i in 1..v_cfg.n_schedules loop
      select id into v_pid from public.products
       where business_id = v_business and price <= 100
       order by id offset (i % (select count(*) from public.products where business_id = v_business and price <= 100))
       limit 1;

      insert into public.schedules (
        customer_id, product_id, quantity, day, start_date, business_id, note
      ) values (
        v_customers[1 + (i % v_cfg.n_customers)],
        v_pid,
        (array[1, 2, 2, 3, 4, 6])[1 + (i % 6)],
        (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[1 + (i % 6)],
        v_today - 90,
        v_business, ''
      ) returning id into v_schedule;
    end loop;

    -- ── orders ────────────────────────────────────────────────────────
    --
    -- Mostly settled, a live tail of reserved ones, and a few cancelled —
    -- because the cash forecast has to prove it ignores the cancelled ones,
    -- and a fixture without any cannot show that.
    for i in 1..v_cfg.n_orders loop
      j := 1 + (i % 5);
      v_price := v_prices[j];
      -- One at a time for anything priced like a bulk purchase. Four
      -- quarter-beefs in a single order is a fixture artefact, not a sale.
      v_qty := case when v_price > 100 then 1 else (array[1, 1, 2, 2, 3, 4])[1 + (i % 6)] end;
      v_total := round((v_qty * v_price)::numeric, 2);
      v_status := case
        when i > v_cfg.n_orders - 18 then 'reserved'
        when i % 23 = 0 then 'cancelled'
        else 'completed'
      end;
      v_day := case
        when v_status = 'reserved' then v_today + (i % 20)
        else v_today - ((i * 300) / v_cfg.n_orders)
      end;

      insert into public.orders (
        customer_id, product_id, quantity, status, reserved_date, picked_up_date,
        cancelled_date, unit_price, total_cost, amount_paid, payment_method, business_id
      ) values (
        v_customers[1 + (i % v_cfg.n_customers)],
        v_products[j], v_qty, v_status,
        v_day::timestamptz + interval '15 hours',
        case when v_status = 'completed' then v_day::timestamptz + interval '15 hours' else null end,
        case when v_status = 'cancelled' then v_day::timestamptz + interval '15 hours' else null end,
        v_price, v_total,
        case
          when v_status = 'completed' then v_total
          -- A couple of part-payments, so "still owed" is not always the
          -- whole total and the netting off gets exercised.
          when v_status = 'reserved' and i % 5 = 0 then round((v_total / 2)::numeric, 2)
          else null
        end,
        case when v_status = 'completed' then 'cash' else null end,
        v_business
      );
    end loop;

    raise notice 'Seeded % (business %, farm %)', v_cfg.name, v_business, v_farm;
  end loop;
end
$seed$;

commit;
