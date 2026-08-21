-- 060 — An animal can leave the farm, and it is written down.
--
-- `herd.animals.status` has allowed 'sold', 'culled', 'processed', 'died' and
-- 'leased_out' from the beginning, and the animal form has always let you
-- pick one. That is the whole of what the app could record: *that* she was
-- gone. Not when, not why, not for how much.
--
-- Meanwhile `herd.dispositions` has been sitting there with an exit channel,
-- a date, a cull flag and two cull-reason slots; `herd.cull_reason_codes` has
-- fourteen seeded reasons per farm; `herd.disposition_sale_details` has
-- buyer, weight, price per hundredweight and every deduction a sale barn
-- takes. All three empty, no function, no app code. So her timeline's "Sold
-- or processed" slot could only ever read "Nothing recorded", and the herd
-- roll had no realised cull value to learn from.
--
-- ── One animal leaves once ──────────────────────────────────────────────
--
-- Recording a disposition twice is a correction, not a second departure, so
-- this updates the existing row rather than adding another. That is the
-- opposite of the pattern in `complete_pickup` and `record_calving`, and
-- deliberately: those record events that really can happen twice.
--
-- `undo_disposition` is here for the same reason. Marking the wrong cow sold
-- should not need a SQL statement to fix — the backlog already carries two
-- entries about one-way writes and this is not going to be the third.
--
-- ── The money ───────────────────────────────────────────────────────────
--
-- A live sale posts to `herd.revenue_entries` against the animal, so it lands
-- in what she earned on her own page, next to her milk. `category` is
-- 'cull_proceeds' when she was culled and 'live_sale' when she was not —
-- both already in the column's CHECK, and both already labelled by the app.
--
-- **Only `sold_live` posts revenue.** An animal that goes to a processor is
-- not income when she leaves; the money arrives later as packaged meat sold
-- through the store, and migration 058 already attributes that back to her.
-- Posting here as well would count it twice.
--
-- The arithmetic is the sale barn's: gross is hundredweight times the price
-- per hundredweight, and net is gross less commission, hauling, yardage and
-- whatever else was taken off the cheque. Either figure may be given
-- explicitly instead — a cheque stub is more authoritative than a
-- reconstruction — and what is given is kept.

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
    v_weight := (p_sale ->> 'live_weight_lb')::numeric;
    v_cwt := (p_sale ->> 'price_per_cwt_cents')::bigint;
    v_commission := coalesce((p_sale ->> 'commission_cents')::bigint, 0);
    v_hauling := coalesce((p_sale ->> 'hauling_cents')::bigint, 0);
    v_yardage := coalesce((p_sale ->> 'yardage_cents')::bigint, 0);
    v_other := coalesce((p_sale ->> 'other_deductions_cents')::bigint, 0);

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

  return v_id;
end $function$;

-- ── taking it back ──────────────────────────────────────────────────────
--
-- She did not go, or the wrong cow was marked. Everything the recording did,
-- undone: the sale row, the revenue it posted, the disposition itself, and
-- her status back to active.

create or replace function herd.undo_disposition(p_animal_id uuid)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_id uuid;
begin
  select farm_id into v_farm from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record that for this animal';
  end if;

  select id into v_id from dispositions
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
end $function$;

grant execute on function herd.record_disposition(uuid, text, date, boolean, uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function herd.undo_disposition(uuid) to authenticated;

-- anon has no business ending an animal's life on the books. The policies
-- already stop it — can_write_farm is false without a uid — but the grant is
-- what an audit reads.
--
-- **From PUBLIC, not from anon.** Postgres grants EXECUTE to PUBLIC on every
-- new function, and revoking from anon leaves that untouched: anon keeps the
-- privilege through PUBLIC and the ACL still reads `=X/postgres`. The newer
-- functions on this schema — `record_weight`, `set_animal_mob` — have no
-- PUBLIC grant, and this follows them.
revoke execute on function herd.record_disposition(uuid, text, date, boolean, uuid, uuid, text, text, jsonb) from public;
revoke execute on function herd.undo_disposition(uuid) from public;
grant execute on function herd.record_disposition(uuid, text, date, boolean, uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function herd.undo_disposition(uuid) to authenticated;

commit;
