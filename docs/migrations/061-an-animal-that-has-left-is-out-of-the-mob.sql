-- 061 — An animal that has left the farm is out of its mob.
--
-- Victor was recorded as processed on 2022-12-08. His status says so, his
-- record says so, and he was still in the Main mob with an open membership —
-- so the Move page counted six head, weighed him in with the rest, and sized
-- the strip to feed a bull calf that is not there.
--
-- Migration 060 set `animals.status` and stopped. Membership of a mob is a
-- different table and nothing closed it, which is the same class of mistake
-- as marking a cow sold and leaving her in the milking string.
--
-- ── Where this is fixed ─────────────────────────────────────────────────
--
-- Here, because it is a fact about the animal rather than a way of drawing a
-- page: she left the farm on a date, so she left the mob on that date, and
-- the record should say so whoever reads it.
--
-- The app is being fixed too, and not only as belt and braces. The animal
-- form can set `status` to 'sold' directly, without a disposition, and that
-- path never comes through here — so anything counting a mob has to check
-- the animals as well. One of these two alone would leave a hole.
--
-- ── Undo ────────────────────────────────────────────────────────────────
--
-- `undo_disposition` puts her back, which has to put the membership back
-- too. It reopens only the membership this closed — same animal, `left_on`
-- equal to the disposition's date — and only when she has no other open
-- membership, because `grazing_group_members_open_uniq` allows exactly one
-- and the farm may well have put her somewhere else in the meantime.

begin;

-- ── recording it ────────────────────────────────────────────────────────

create or replace function herd.record_disposition(
  p_animal_id uuid,
  p_exit_channel text,
  p_date date,
  p_is_cull boolean default false,
  p_cull_primary_reason_id uuid default null,
  p_cull_secondary_reason_id uuid default null,
  p_cull_note text default ''::text,
  p_notes text default ''::text,
  p_sale jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_name text; v_born date; v_id uuid; v_status text;
  v_gross bigint; v_net bigint;
  v_weight numeric; v_cwt bigint;
  v_commission bigint; v_hauling bigint; v_yardage bigint; v_other bigint;
begin
  select farm_id, coalesce(nullif(barn_name, ''), 'tag ' || ear_tag), birth_date
    into v_farm, v_name, v_born
    from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record that for this animal';
  end if;

  if p_exit_channel not in ('sold_live', 'processed', 'died_on_farm', 'leased_out', 'transferred') then
    raise exception 'An animal leaves by sale, a processor, death, a lease or a transfer';
  end if;
  if p_date is null then raise exception 'When did she leave?'; end if;
  if p_date < v_born then
    raise exception '% was born % — she cannot have left before that', v_name, v_born;
  end if;
  if p_date > current_date then raise exception 'That date has not happened yet'; end if;

  -- A cull is a decision with a reason behind it, and the reason is the
  -- entire analytic value of recording it as one.
  if p_is_cull and p_cull_primary_reason_id is null then
    raise exception 'A cull needs a reason';
  end if;
  if not p_is_cull and (p_cull_primary_reason_id is not null or p_cull_secondary_reason_id is not null) then
    raise exception 'A reason for culling only belongs on a cull';
  end if;
  if p_cull_primary_reason_id is not null and p_cull_primary_reason_id = p_cull_secondary_reason_id then
    raise exception 'The two reasons are the same one';
  end if;
  if p_cull_primary_reason_id is not null and not exists (
    select 1 from cull_reason_codes
     where id = p_cull_primary_reason_id and farm_id = v_farm and active and deleted_at is null
  ) then raise exception 'That is not one of this farm''s cull reasons'; end if;
  if p_cull_secondary_reason_id is not null and not exists (
    select 1 from cull_reason_codes
     where id = p_cull_secondary_reason_id and farm_id = v_farm and active and deleted_at is null
  ) then raise exception 'That is not one of this farm''s cull reasons'; end if;

  -- Money on a disposition is what the sale barn paid. A processor's animal
  -- earns later, as packaged meat, and 058 credits that back to her — booking
  -- it here as well would count the same carcass twice.
  if p_sale is not null and p_exit_channel <> 'sold_live' then
    raise exception 'Sale figures belong on an animal sold live, not one %',
      case p_exit_channel
        when 'processed' then 'sent to a processor — her money arrives as packaged meat'
        when 'died_on_farm' then 'that died on the farm'
        when 'leased_out' then 'leased out'
        else 'transferred'
      end;
  end if;

  v_status := case p_exit_channel
    when 'sold_live' then case when p_is_cull then 'culled' else 'sold' end
    when 'processed' then 'processed'
    when 'died_on_farm' then 'died'
    when 'leased_out' then 'leased_out'
    -- 'transferred' has no status of its own; the exit channel keeps the
    -- distinction that the status column cannot.
    else 'sold'
  end;

  -- One departure per animal: a second call corrects the first.
  select id into v_id from dispositions
   where animal_id = p_animal_id and deleted_at is null
   order by created_at limit 1;

  if v_id is null then
    insert into dispositions (
      animal_id, exit_channel, date, is_cull, cull_primary_reason_id,
      cull_secondary_reason_id, cull_note, notes, farm_id, created_by, updated_by
    ) values (
      p_animal_id, p_exit_channel, p_date, p_is_cull, p_cull_primary_reason_id,
      p_cull_secondary_reason_id, coalesce(p_cull_note, ''), coalesce(p_notes, ''),
      v_farm, auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update dispositions
       set exit_channel = p_exit_channel,
           date = p_date,
           is_cull = p_is_cull,
           cull_primary_reason_id = p_cull_primary_reason_id,
           cull_secondary_reason_id = p_cull_secondary_reason_id,
           cull_note = coalesce(p_cull_note, ''),
           notes = coalesce(p_notes, ''),
           updated_by = auth.uid(), updated_at = now()
     where id = v_id;
  end if;

  -- ── what the sale brought ─────────────────────────────────────────────

  -- Cleared either way: a correction that drops the sale figures, or changes
  -- the channel away from a live sale, must not leave the old ones behind.
  -- The revenue row is disposable; the sale row is not, because
  -- disposition_sale_details is UNIQUE on disposition_id and that constraint
  -- does not care about deleted_at. Soft-deleting one and inserting another
  -- collides on the second correction, so the sale row is updated in place
  -- and un-deleted rather than replaced.
  update revenue_entries
     set deleted_at = now(), updated_by = auth.uid(), updated_at = now()
   where source = 'disposition' and source_ref_id = v_id and deleted_at is null;

  if p_sale is null then
    update disposition_sale_details
       set deleted_at = now(), updated_by = auth.uid(), updated_at = now()
     where disposition_id = v_id and deleted_at is null;
  else
    -- `channel` is NOT NULL and its CHECK names four values, so there is no
    -- way to record a sale without saying how she was sold. That is the
    -- table's rule, not a choice made here; the only choice is whether it
    -- arrives as a sentence or as a constraint violation.
    if nullif(p_sale ->> 'channel', '') is null then
      raise exception 'How was she sold? Private treaty, an auction barn, online, or direct to a customer';
    end if;
    if (p_sale ->> 'channel') not in ('private_treaty', 'auction_barn', 'online', 'direct_to_consumer') then
      raise exception 'A sale goes by private treaty, an auction barn, online, or direct to a customer';
    end if;
    v_weight := (p_sale ->> 'live_weight_lb')::numeric;
    v_cwt := (p_sale ->> 'price_per_cwt_cents')::bigint;
    v_commission := coalesce((p_sale ->> 'commission_cents')::bigint, 0);
    v_hauling := coalesce((p_sale ->> 'hauling_cents')::bigint, 0);
    v_yardage := coalesce((p_sale ->> 'yardage_cents')::bigint, 0);
    v_other := coalesce((p_sale ->> 'other_deductions_cents')::bigint, 0);

    if v_weight is not null and v_weight <= 0 then
      raise exception 'A live weight has to be above zero';
    end if;
    if v_commission < 0 or v_hauling < 0 or v_yardage < 0 or v_other < 0 then
      raise exception 'A deduction cannot be negative';
    end if;

    -- Hundredweight times the price, unless the cheque says otherwise.
    v_gross := coalesce(
      (p_sale ->> 'gross_cents')::bigint,
      case when v_weight is not null and v_cwt is not null
           then round(v_weight / 100.0 * v_cwt)::bigint end
    );
    if v_gross is null then
      raise exception 'A sale needs either a gross amount or a weight and a price per hundredweight';
    end if;
    if v_gross < 0 then raise exception 'A gross amount cannot be negative'; end if;

    v_net := coalesce(
      (p_sale ->> 'net_cents')::bigint,
      v_gross - v_commission - v_hauling - v_yardage - v_other
    );

    insert into disposition_sale_details (
      disposition_id, buyer_name, channel, sale_barn, lot_number,
      live_weight_lb, price_per_cwt_cents, gross_cents, commission_cents,
      hauling_cents, yardage_cents, other_deductions_cents, net_cents,
      farm_id, created_by, updated_by
    ) values (
      v_id,
      coalesce(p_sale ->> 'buyer_name', ''),
      p_sale ->> 'channel',
      coalesce(p_sale ->> 'sale_barn', ''),
      coalesce(p_sale ->> 'lot_number', ''),
      v_weight, v_cwt, v_gross, v_commission, v_hauling, v_yardage, v_other, v_net,
      v_farm, auth.uid(), auth.uid()
    )
    on conflict (disposition_id) do update set
      buyer_name = excluded.buyer_name,
      channel = excluded.channel,
      sale_barn = excluded.sale_barn,
      lot_number = excluded.lot_number,
      live_weight_lb = excluded.live_weight_lb,
      price_per_cwt_cents = excluded.price_per_cwt_cents,
      gross_cents = excluded.gross_cents,
      commission_cents = excluded.commission_cents,
      hauling_cents = excluded.hauling_cents,
      yardage_cents = excluded.yardage_cents,
      other_deductions_cents = excluded.other_deductions_cents,
      net_cents = excluded.net_cents,
      -- Back from the dead: a sale dropped by one correction and given again
      -- by the next is the same row.
      deleted_at = null,
      updated_by = auth.uid(),
      updated_at = now();

    -- What she actually cleared, on her own page beside her milk. A sale that
    -- netted nothing after the barn took its cut is not revenue.
    if v_net > 0 then
      insert into revenue_entries (
        animal_id, date, amount_cents, category, source, source_ref_id,
        is_internal_transfer, note, farm_id, created_by, updated_by
      ) values (
        p_animal_id, p_date, v_net,
        case when p_is_cull then 'cull_proceeds' else 'live_sale' end,
        'disposition', v_id, false,
        coalesce(nullif(p_sale ->> 'buyer_name', ''), 'Sold live'),
        v_farm, auth.uid(), auth.uid()
      );
    end if;
  end if;

  update animals
     set status = v_status, updated_by = auth.uid(), updated_at = now()
   where id = p_animal_id;

  -- ── and out of the mob ────────────────────────────────────────────────
  --
  -- The whole point of 061. An open membership means the grazing module
  -- counts her, weighs her in, and sizes the next strip to feed her.
  --
  -- `greatest` because a mob is not left before it is joined: an animal
  -- entered into a mob today and recorded as processed years ago would
  -- otherwise get a left_on before her joined_on.
  update grazing_group_members
     set left_on = greatest(p_date, joined_on),
         updated_by = auth.uid(), updated_at = now()
   where animal_id = p_animal_id and left_on is null and deleted_at is null;

  return v_id;
end $function$;

-- ── taking it back ──────────────────────────────────────────────────────

create or replace function herd.undo_disposition(p_animal_id uuid)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_id uuid; v_date date;
begin
  select farm_id into v_farm from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record that for this animal';
  end if;

  select id, date into v_id, v_date from dispositions
   where animal_id = p_animal_id and deleted_at is null
   order by created_at limit 1;
  if v_id is null then raise exception 'Nothing is recorded about her leaving'; end if;

  update revenue_entries
     set deleted_at = now(), updated_by = auth.uid(), updated_at = now()
   where source = 'disposition' and source_ref_id = v_id and deleted_at is null;
  update disposition_sale_details
     set deleted_at = now(), updated_by = auth.uid(), updated_at = now()
   where disposition_id = v_id and deleted_at is null;
  update dispositions
     set deleted_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = v_id;

  update animals
     set status = 'active', updated_by = auth.uid(), updated_at = now()
   where id = p_animal_id;

  -- Back into the mob she was taken out of, but only the membership this
  -- closed and only when she is not already in one: the partial unique index
  -- allows a single open membership per animal, and the farm may have put
  -- her somewhere else since.
  if not exists (
    select 1 from grazing_group_members
     where animal_id = p_animal_id and left_on is null and deleted_at is null
  ) then
    update grazing_group_members
       set left_on = null, updated_by = auth.uid(), updated_at = now()
     where id = (
       select id from grazing_group_members
        where animal_id = p_animal_id
          and deleted_at is null
          and left_on = greatest(v_date, joined_on)
        order by updated_at desc
        limit 1
     );
  end if;
end $function$;

revoke execute on function herd.record_disposition(uuid, text, date, boolean, uuid, uuid, text, text, jsonb) from public;
revoke execute on function herd.undo_disposition(uuid) from public;
grant execute on function herd.record_disposition(uuid, text, date, boolean, uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function herd.undo_disposition(uuid) to authenticated;

-- ── the animals already on file ─────────────────────────────────────────
--
-- Victor, today. Anyone who was marked gone before this migration existed
-- keeps an open membership until something closes it, and nothing will.
-- Dated by the disposition where there is one, and by the day the status was
-- last touched where there is not — never before they joined.
update herd.grazing_group_members m
   set left_on = greatest(
         coalesce((select d.date from herd.dispositions d
                    where d.animal_id = m.animal_id and d.deleted_at is null
                    order by d.created_at limit 1),
                  a.updated_at::date),
         m.joined_on
       ),
       updated_at = now()
  from herd.animals a
 where a.id = m.animal_id
   and a.status <> 'active'
   and m.left_on is null
   and m.deleted_at is null;

commit;
