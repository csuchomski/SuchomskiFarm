-- 027 — Logging a breeding: the event, the straw, and the cost.
--
-- STATUS: RUN, 2026-08-08. Verified as the farmer in a rolled-back
-- transaction, so RLS applied:
--   AI on Martha -> service #1, method ai, sire Dutton taken from the lot,
--     semen_type sexed_female copied across
--   the tank went 5 -> 4 and the ledger reads "5 purchase, -1 service"
--   a $20.00 cost entry landed on Martha under the breeding category with
--     source 'breeding', and breeding_events.cost_entry_id points at it
--   a second AI on the same cow numbered itself #2
--   natural service on Abigail -> a sire, no lot, no cost entry
--   voiding the second: the straw came back (4) and the cost was withdrawn,
--     and the next service number fell back to #2
--   a male animal, AI with no lot, natural with no bull, and method 'et'
--     were each refused by name
-- Depends on: nothing new. Every table this touches already exists.
--
-- ── What's already here ───────────────────────────────────────────────
--
-- herd.breeding_events has been sitting empty since it was created, and it
-- already models exactly what was asked for:
--
--   method            check (method in ('ai', 'natural', 'et'))
--   sire_id           -> animals        the bull, herd or reference
--   semen_lot_id      -> semen_lots     the straw, when it's AI
--   naab_code_snapshot, semen_type      copied at the time, so the record
--                                       still reads right if the lot changes
--   cost_entry_id     -> cost_entries   the cost link
--
-- and herd.semen_transactions carries `breeding_event_id` plus a reason
-- vocabulary containing 'service' and 'service_void'. The straw count is not
-- a column anybody writes: recount_semen_lot() re-derives straws_remaining
-- from the sum of the ledger on every change, so consuming a straw means
-- inserting a −1 transaction and letting the trigger follow.
--
-- So this migration adds no tables. It adds the two functions that make the
-- writes happen together.
--
-- ── Why a function ────────────────────────────────────────────────────
--
-- Recording an AI breeding is four writes:
--
--   1. the breeding_events row
--   2. a semen_transactions row of −1, which fires the recount
--   3. a cost_entries row against the cow
--   4. breeding_events.cost_entry_id pointing at it
--
-- Any two of them apart is wrong in a way nobody would notice: a straw gone
-- from the tank with no breeding to show for it, or a breeding on the record
-- that never cost anything. Four round trips from a phone in a barn is four
-- chances to stop halfway.
--
-- ── Where the cost lands ──────────────────────────────────────────────
--
-- On the cow, not the bull. cost_entries.animal_id is the female — she is
-- the one whose margin has to carry what it cost to get her bred, and the
-- per-animal cost report already sums that column. The bull is on the
-- breeding record; the money is on her.
--
-- The amount defaults to the lot's cost_per_straw_cents and can be overridden
-- at entry, which is how a technician fee or a natural-service fee gets
-- recorded. Zero means no cost entry at all rather than a $0.00 one.

begin;

create or replace function herd.record_breeding(
  p_animal_id uuid,
  p_date date,
  p_method text,
  p_sire_id uuid default null,
  p_semen_lot_id uuid default null,
  p_technician text default '',
  p_notes text default '',
  p_cost_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_sex text; v_name text;
  v_lot record; v_sire uuid; v_naab text; v_type text;
  v_cost bigint; v_category uuid; v_entry uuid; v_id uuid;
  v_service integer; v_last_calving date;
begin
  if p_method not in ('ai', 'natural') then
    raise exception 'A breeding is either ai or natural';
  end if;

  select farm_id, sex, coalesce(nullif(barn_name, ''), ear_tag)
    into v_farm, v_sex, v_name
    from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record a breeding for that animal';
  end if;
  if v_sex <> 'female' then
    raise exception '% is not a female', v_name;
  end if;

  if p_method = 'ai' then
    if p_semen_lot_id is null then raise exception 'Which straw was used?'; end if;

    -- `for update` so two people breeding from the same cane can't both pass
    -- the count check on the last straw.
    select * into v_lot from semen_lots
     where id = p_semen_lot_id and farm_id = v_farm for update;
    if not found then raise exception 'That semen lot is not on this farm'; end if;
    if not v_lot.active then raise exception 'That lot is marked inactive'; end if;
    if v_lot.straws_remaining < 1 then
      raise exception 'No straws left in that lot';
    end if;

    -- Taken from the lot rather than the form: the straw decides which bull
    -- this was, and a mismatch between the two would be unresolvable later.
    v_sire := v_lot.sire_id;
    v_naab := v_lot.naab_code;
    v_type := v_lot.unit_type;
    v_cost := coalesce(p_cost_cents, v_lot.cost_per_straw_cents);
  else
    if p_sire_id is null then raise exception 'Which bull was she exposed to?'; end if;
    if not exists (select 1 from animals where id = p_sire_id and sex = 'male' and deleted_at is null) then
      raise exception 'That sire is not a bull on file';
    end if;
    v_sire := p_sire_id;
    v_naab := '';
    v_type := '';
    v_cost := coalesce(p_cost_cents, 0);
  end if;

  -- Service number counts from her last calving, which is what the term
  -- means — not every breeding she has ever had.
  select max(date) into v_last_calving from calvings where dam_id = p_animal_id;
  select count(*) + 1 into v_service
    from breeding_events
   where animal_id = p_animal_id
     and not voided
     and deleted_at is null
     and (v_last_calving is null or date > v_last_calving);

  insert into breeding_events (
    animal_id, date, service_number, method, technician, sire_id, semen_lot_id,
    semen_type, naab_code_snapshot, notes, farm_id, created_by, updated_by
  ) values (
    p_animal_id, p_date, v_service, p_method, coalesce(p_technician, ''), v_sire,
    case when p_method = 'ai' then p_semen_lot_id else null end,
    v_type, v_naab, coalesce(p_notes, ''), v_farm, auth.uid(), auth.uid()
  ) returning id into v_id;

  -- The straw leaves the tank. straws_remaining is not touched here — the
  -- recount trigger derives it from this ledger.
  if p_method = 'ai' then
    insert into semen_transactions (semen_lot_id, date, delta, reason, breeding_event_id, note, farm_id, created_by, updated_by)
    values (p_semen_lot_id, p_date, -1, 'service', v_id, 'Bred ' || v_name, v_farm, auth.uid(), auth.uid());
  end if;

  if v_cost > 0 then
    select id into v_category from expense_categories
     where farm_id = v_farm and code = 'breeding' and deleted_at is null limit 1;
    if v_category is null then
      raise exception 'No "breeding" expense category on this farm';
    end if;

    insert into cost_entries (
      farm_id, animal_id, date, amount_cents, category_id, source, source_ref_id, note, created_by, updated_by
    ) values (
      v_farm, p_animal_id, p_date, v_cost, v_category, 'breeding', v_id,
      case when p_method = 'ai' then 'AI service' else 'Natural service' end,
      auth.uid(), auth.uid()
    ) returning id into v_entry;

    update breeding_events set cost_entry_id = v_entry where id = v_id;
  end if;

  return v_id;
end $function$;

comment on function herd.record_breeding(uuid, date, text, uuid, uuid, text, text, bigint) is
  'Log a breeding. For AI this also draws the straw from the tank and books '
  'its cost against the cow, in one transaction — a straw gone with no '
  'breeding behind it is the failure this exists to prevent.';

-- ── Undoing one ───────────────────────────────────────────────────────
--
-- Without this a mistyped breeding consumes a straw permanently. The schema
-- already anticipated it: breeding_events.voided and the 'service_void'
-- reason both exist for exactly this.

create or replace function herd.void_breeding(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare v record;
begin
  select * into v from breeding_events where id = p_id and deleted_at is null;
  if not found then raise exception 'Breeding not found'; end if;
  if not can_write_farm(v.farm_id) then
    raise exception 'Not allowed to change that breeding';
  end if;
  if v.voided then return; end if;

  update breeding_events
     set voided = true, void_reason = coalesce(p_reason, ''), updated_by = auth.uid(), updated_at = now()
   where id = p_id;

  -- The straw goes back. A separate +1 rather than deleting the −1, so the
  -- ledger still shows what happened.
  if v.semen_lot_id is not null then
    insert into semen_transactions (semen_lot_id, date, delta, reason, breeding_event_id, note, farm_id, created_by, updated_by)
    values (v.semen_lot_id, current_date, 1, 'service_void', p_id, coalesce(p_reason, ''), v.farm_id, auth.uid(), auth.uid());
  end if;

  -- And the cost stops counting against her. Soft, because cost_entries has
  -- no delete policy and because a withdrawn cost is a fact worth keeping.
  if v.cost_entry_id is not null then
    update cost_entries set deleted_at = now(), updated_by = auth.uid() where id = v.cost_entry_id;
  end if;
end $function$;

comment on function herd.void_breeding(uuid, text) is
  'Void a breeding: the straw returns to the tank as a service_void and the '
  'cost entry is withdrawn. The event stays, marked voided.';

grant execute on function herd.record_breeding(uuid, date, text, uuid, uuid, text, text, bigint) to authenticated;
grant execute on function herd.void_breeding(uuid, text) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'herd' and p.proname in ('record_breeding', 'void_breeding');
--     -- exactly two rows, no overloads
--
-- And with RLS applied, inside a transaction you roll back:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select herd.record_breeding('<a cow>', current_date, 'ai', null, '<a lot>');
--   select straws_remaining from herd.semen_lots where id = '<a lot>';  -- one fewer
--   select amount_cents, animal_id from herd.cost_entries where source = 'breeding';
--   select herd.void_breeding('<the id>', 'wrong cow');
--   select straws_remaining from herd.semen_lots where id = '<a lot>';  -- back
--
-- Rollback:
--   drop function if exists herd.record_breeding(uuid, date, text, uuid, uuid, text, text, bigint);
--   drop function if exists herd.void_breeding(uuid, text);
