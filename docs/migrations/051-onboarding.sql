-- 051 — a second farm can start on its own
--
-- STATUS: run 2026-08-17
--
-- A new account signs in and lands on "You're signed in, but you're not a
-- member of any business yet", and there it stops. Everything that made this
-- farm exist — the business row, the membership, the herd farm, the link
-- between them — was done by hand. That is the difference between an app one
-- person uses and something a second person can be sold.
--
-- Getting started is four inserts across two schemas, and none of them can
-- be done from the client:
--
--   * `business_members` may only be written by somebody who already owns
--     the business, which nobody does when the business does not exist yet.
--   * `herd.farms` and `herd.farm_members` have a bootstrap path, but it
--     runs on `farms.created_by` and knows nothing about businesses.
--
-- And they have to land together. A business with no membership is invisible
-- to the person who just made it; a membership with no farm is a workspace
-- with nowhere to put an animal. So it is one function, for the same reason
-- `log_grazing_move` is one.
--
-- ── the reason the rest of this migration exists ──────────────────────────
--
-- Four policies were written as `profiles.role = 'farmer'`:
--
--     businesses, ledger_accounts, ledger_assets, ledger_transactions
--
-- That is a *global* role, not a membership. It reads "this person is a
-- farmer", not "this person is a farmer *here*" — so every account holding
-- it has full read and write over every business row and over the entire
-- general ledger of every business on the database. Books, assets,
-- transactions: all of it, for everyone.
--
-- With one farmer that is invisible. This migration's whole purpose is to
-- make a second one, which is what turns it from a latent hole into a live
-- one, so it cannot ship without this. Each becomes membership-scoped:
-- reading needs membership, writing needs ownership.

-- ── the business itself ───────────────────────────────────────────────────

drop policy if exists "farmer full access - businesses" on public.businesses;

create policy businesses_select on public.businesses
  for select using (id in (select public.current_user_business_ids()));

-- No insert policy: a business comes into being through `create_farm` below,
-- which is the only way to get one with a membership attached. No delete
-- policy either — that is not a thing a client does to a tenant.
create policy businesses_update on public.businesses
  for update
  using (id in (select public.current_user_owned_business_ids()))
  with check (id in (select public.current_user_owned_business_ids()));

-- ── the books ─────────────────────────────────────────────────────────────

drop policy if exists "farmer full access - ledger_accounts" on public.ledger_accounts;
create policy ledger_accounts_read on public.ledger_accounts
  for select using (public.is_business_member(business_id));
create policy ledger_accounts_write on public.ledger_accounts
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists "farmer full access - ledger_assets" on public.ledger_assets;
create policy ledger_assets_read on public.ledger_assets
  for select using (public.is_business_member(business_id));
create policy ledger_assets_write on public.ledger_assets
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists "farmer full access - ledger_transactions" on public.ledger_transactions;
create policy ledger_transactions_read on public.ledger_transactions
  for select using (public.is_business_member(business_id));
create policy ledger_transactions_write on public.ledger_transactions
  for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ── a farm could not be created at all ────────────────────────────────────
--
-- Found by trying to onboard somebody, which is the only way it could have
-- been found: inserting into `herd.farms` fires `farms_seed`, whose function
-- pins `search_path = public` and then calls `herd.seed_farm`, which has no
-- search_path of its own and so inherits that one. `seed_farm` names
-- `uuid_generate_v5` unqualified 127 times, and that function lives in
-- `extensions`.
--
-- So every insert into `herd.farms` fails with "function
-- uuid_generate_v5(uuid, unknown) does not exist", and has done for as long
-- as the trigger has existed. This farm predates it, which is why nothing
-- ever looked wrong. A caller's search_path cannot rescue it — the trigger
-- overrides the caller — so it is fixed where it is broken, on both.

alter function herd.seed_farm_on_insert() set search_path = public, herd, extensions;
alter function herd.seed_farm(uuid)       set search_path = public, herd, extensions;

-- ── you may become a farmer by having a farm ──────────────────────────────
--
-- `prevent_role_self_change` refuses any change to `profiles.role` unless
-- the person making it is already a farmer. That is the right instinct — a
-- buyer must not promote themselves — but it is also a closed loop: the
-- first thing a new owner needs is the role, and nobody can give it to them.
--
-- The role still matters after the policies above: `profiles` and
-- `payment_methods` gate on it, so a new owner running a shop cannot see
-- their own customers without it.
--
-- So the guard gains one exception, and it is deliberately not "the caller
-- is a trusted function" — it is a fact on the ground. You may set yourself
-- to farmer when you belong to a farm business, and the only way to come by
-- that membership is `create_farm`, which mints it a line before it asks for
-- the role. Everything else the guard refused, it still refuses.
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and not public.is_farmer()
     and not (
       new.id = auth.uid()
       and new.role = 'farmer'
       and exists (
         select 1 from public.business_members m
          join public.businesses b on b.id = m.business_id
         where m.user_id = new.id and b.type = 'farm'
       )
     )
  then
    raise exception 'Only a farmer can change roles';
  end if;
  return new;
end;
$$;

-- ── starting a farm ───────────────────────────────────────────────────────

create or replace function public.create_farm(
  p_business_name text,
  p_farm_name     text default null
)
returns bigint
language plpgsql
security definer
-- `extensions` is not decoration: inserting a farm fires `farms_seed`, which
-- seeds the new farm's reference data using `uuid_generate_v5`, and that
-- lives in `extensions`. A search_path without it makes the whole bootstrap
-- fail on a function-does-not-exist deep inside a trigger.
set search_path = public, herd, extensions
as $$
declare
  v_uid      uuid := auth.uid();
  v_business bigint;
  v_farm     uuid;
  v_name     text := btrim(coalesce(p_business_name, ''));
  v_farmname text := btrim(coalesce(p_farm_name, ''));
begin
  if v_uid is null then
    raise exception 'You have to be signed in to start a farm.';
  end if;

  if v_name = '' then
    raise exception 'Your farm needs a name.';
  end if;

  -- One farm each, for now. Not a law of nature — the schema holds as many
  -- as you like — but the alternative is a signup that quietly makes a
  -- second empty farm every time somebody double-taps the button, and there
  -- is no screen for merging them back.
  if exists (
    select 1 from public.business_members m
     join public.businesses b on b.id = m.business_id
    where m.user_id = v_uid and b.type = 'farm'
  ) then
    raise exception 'You already have a farm. Ask its owner to add you to another.';
  end if;

  insert into public.businesses (name, type) values (v_name, 'farm')
  returning id into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business, v_uid, 'owner');

  -- What a farm starts with. The type map is still the right source for
  -- that; 049 only moved where the answer is *kept*.
  insert into public.business_modules (business_id, module_code)
  select v_business, m.module_code
    from public.business_type_modules m
   where m.type_code = 'farm'
  on conflict do nothing;

  insert into herd.farms (name, created_by, business_id)
  values (coalesce(nullif(v_farmname, ''), v_name), v_uid, v_business)
  returning id into v_farm;

  insert into herd.farm_members (farm_id, user_id, role)
  values (v_farm, v_uid, 'owner');

  -- `on_auth_user_created` already makes a profile, with role 'buyer' —
  -- right for someone who came in through the shop, wrong for someone
  -- starting a farm. Upgrading it here rather than leaving it to a trigger
  -- means the account is usable the moment this returns.
  insert into public.profiles (id, email, role)
  select v_uid, u.email, 'farmer' from auth.users u where u.id = v_uid
  on conflict (id) do update set role = 'farmer'
   where public.profiles.role is distinct from 'farmer';

  return v_business;
end;
$$;

revoke all on function public.create_farm(text, text) from public;
grant execute on function public.create_farm(text, text) to authenticated;

comment on function public.create_farm(text, text) is
  'Bootstraps a farm for the signed-in user: business, membership, modules, herd farm and farm membership, in one transaction.';
