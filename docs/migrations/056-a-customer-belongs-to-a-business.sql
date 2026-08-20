-- 056 — A customer belongs to a business.
--
-- Reported as a leak between entities: dhpropertymgmtmke@gmail.com, who owns
-- business 13 and has never bought anything from business 5, was listed on
-- business 5's Customers page. He was, and so was every other profile in the
-- database.
--
-- The cause is one policy:
--
--   "read own profile or farmer reads all"  using ((auth.uid() = id) OR is_farmer())
--
-- `is_farmer()` asks whether *this account* has role 'farmer'. It does not
-- ask which farm. So the moment a second farm existed, every farmer could
-- read every profile on the instance — names, emails, phone numbers — and
-- the Customers page, which selects `profiles` with no filter at all, simply
-- showed them. It ran correctly for as long as there was one farm, which is
-- the most dangerous kind of wrong.
--
-- It leaked both ways. Business 5 saw business 13's owner; business 13's
-- owner could read business 5's three customers, and `farmer updates any
-- profile` let him edit them.
--
-- ── What a customer of a business actually is ────────────────────────────
--
-- `profiles` has no business_id and should not have one: a customer can buy
-- from two farms and is one person. The link is what passed between them —
-- an order, or a standing order. Plus the walk-in a farmer types in at the
-- gate, who has neither yet, which is what the new table is for.
--
-- So: customers of B = orders for B ∪ schedules for B ∪ business_customers
-- for B. Derived rather than maintained, because a write path that forgets
-- to record the link would drop a paying customer off the list silently. The
-- table carries only what nothing else can say.
--
-- ── What this does not do ────────────────────────────────────────────────
--
-- `payment_methods` and `tax_categories` are still writable by any farmer
-- (`is_farmer()` again). They hold no personal data and are shared reference
-- tables, so this is a different question — whether they are global or
-- per-business — and not one to answer inside a leak fix.

begin;

-- ── the link nothing else can express ────────────────────────────────────

create table if not exists public.business_customers (
  business_id bigint not null references public.businesses (id) on delete cascade,
  customer_id uuid   not null references public.profiles (id)   on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (business_id, customer_id)
);

create index if not exists business_customers_customer_idx
  on public.business_customers (customer_id);

alter table public.business_customers enable row level security;

drop policy if exists business_customers_select on public.business_customers;
create policy business_customers_select
  on public.business_customers for select to authenticated
  using (business_id in (select public.current_user_business_ids()));

drop policy if exists business_customers_write on public.business_customers;
create policy business_customers_write
  on public.business_customers for all to authenticated
  using (business_id in (select public.current_user_business_ids()))
  with check (business_id in (select public.current_user_business_ids()));

grant select, insert, delete on public.business_customers to authenticated;

-- Everyone who has already bought or subscribed. A gate customer with no
-- order yet would be missed by this, and there are none on file — but if one
-- existed she would go on being visible to her own farm anyway, because the
-- union below reads this table *and* the orders.
insert into public.business_customers (business_id, customer_id)
select distinct o.business_id, o.customer_id
  from public.orders o
 where o.business_id is not null and o.customer_id is not null
union
select distinct s.business_id, s.customer_id
  from public.schedules s
 where s.business_id is not null and s.customer_id is not null
on conflict do nothing;

-- ── who I may see ────────────────────────────────────────────────────────

/**
 * The customers of one business, for the page that lists them.
 *
 * Returns nothing at all when the caller is not a member of that business,
 * rather than raising: this answers "who are my customers", and a stranger's
 * correct answer is "none of them".
 */
create or replace function public.customer_ids_of(p_business_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.customer_id
    from public.business_customers c
   where c.business_id = p_business_id
     and p_business_id in (select public.current_user_business_ids())
  union
  select o.customer_id
    from public.orders o
   where o.business_id = p_business_id
     and o.customer_id is not null
     and p_business_id in (select public.current_user_business_ids())
  union
  select s.customer_id
    from public.schedules s
   where s.business_id = p_business_id
     and s.customer_id is not null
     and p_business_id in (select public.current_user_business_ids());
$$;

/** The same union across every business I belong to. What the policy reads. */
create or replace function public.current_user_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.customer_id
    from public.business_customers c
   where c.business_id in (select public.current_user_business_ids())
  union
  select o.customer_id
    from public.orders o
   where o.business_id in (select public.current_user_business_ids())
     and o.customer_id is not null
  union
  select s.customer_id
    from public.schedules s
   where s.business_id in (select public.current_user_business_ids())
     and s.customer_id is not null;
$$;

/**
 * The people I work with — every member of every business I belong to.
 *
 * Settings → Farm & people reads this. It was riding on "farmer reads all",
 * which is exactly the grant being taken away, so it needs saying properly.
 */
create or replace function public.current_user_colleague_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select m.user_id
    from public.business_members m
   where m.business_id in (select public.current_user_business_ids());
$$;

grant execute on function public.customer_ids_of(bigint) to authenticated;
grant execute on function public.current_user_customer_ids() to authenticated;
grant execute on function public.current_user_colleague_ids() to authenticated;

-- ── the policies ─────────────────────────────────────────────────────────

drop policy if exists "read own profile or farmer reads all" on public.profiles;
create policy "read own profile, my colleagues, and my own customers"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or id in (select public.current_user_colleague_ids())
    or id in (select public.current_user_customer_ids())
  );

-- The column grants from migration 024 still decide *what* may be written
-- here — email, first_name, last_name, phone, archived_at, and never role.
-- This decides whose.
drop policy if exists "farmer updates any profile" on public.profiles;
create policy "farmer updates their own customer"
  on public.profiles for update to authenticated
  using (is_farmer() and id in (select public.current_user_customer_ids()))
  with check (is_farmer() and id in (select public.current_user_customer_ids()));

-- ── the two functions that took a farmer at their word ───────────────────

-- Both had `if not is_farmer()` and nothing else, so any farmer could add a
-- customer to everyone's list, or delete another farm's order-less customer.
-- CREATE OR REPLACE only replaces an exact signature, so the old ones go.
drop function if exists public.add_customer(text, text, text, text);
drop function if exists public.delete_customer(uuid);

create or replace function public.add_customer(
  p_business_id bigint,
  p_first_name  text default '',
  p_last_name   text default '',
  p_email       text default '',
  p_phone       text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_email text; v_first text; v_last text;
begin
  if p_business_id is null
     or p_business_id not in (select public.current_user_business_ids()) then
    raise exception 'That is not your business';
  end if;

  v_first := btrim(coalesce(p_first_name, ''));
  v_last  := btrim(coalesce(p_last_name, ''));
  v_email := lower(btrim(coalesce(p_email, '')));

  -- A gate customer may genuinely have no email — the column is NOT NULL, so
  -- it takes '' rather than null. What can't happen is having neither an
  -- email nor a name, because then nothing on a pickup list identifies them.
  if v_first = '' and v_last = '' and v_email = '' then
    raise exception 'Give them a name or an email';
  end if;

  -- Scoped to this business's own customers. Globally it both refused a name
  -- another farm happened to hold and confirmed, to anyone who asked, that
  -- an address was on the instance somewhere.
  if v_email <> '' and exists (
    select 1 from profiles p
     where lower(p.email) = v_email
       and p.id in (select public.customer_ids_of(p_business_id))
  ) then
    raise exception 'There is already a customer with the email %', v_email;
  end if;

  -- The id is generated here rather than accepted from the caller: it is a
  -- primary key that used to be an account's id, and letting a client choose
  -- it would let them aim at one.
  v_id := gen_random_uuid();

  insert into profiles (id, first_name, last_name, email, phone, role, has_login)
  values (v_id, v_first, v_last, v_email,
          nullif(btrim(coalesce(p_phone, '')), ''), 'buyer', false);

  insert into public.business_customers (business_id, customer_id)
  values (p_business_id, v_id)
  on conflict do nothing;

  return v_id;
end $$;

/**
 * Take a customer off this business.
 *
 * Three outcomes, and the difference matters once two farms can know the
 * same person: an order on this business means archive instead, another
 * business knowing them means unlink and leave the person alone, and nobody
 * else knowing them means the profile goes as it always did.
 */
create or replace function public.delete_customer(p_id uuid, p_business_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_orders integer; v_who text; v_elsewhere boolean;
begin
  if p_business_id is null
     or p_business_id not in (select public.current_user_business_ids()) then
    raise exception 'That is not your business';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot delete your own account from here';
  end if;
  if p_id not in (select public.customer_ids_of(p_business_id)) then
    raise exception 'That is not one of your customers';
  end if;

  select coalesce(
           nullif(btrim(first_name || ' ' || last_name), ''),
           nullif(btrim(email), ''),
           'That customer')
    into v_who
    from profiles where id = p_id;
  if v_who is null then raise exception 'No such customer'; end if;

  select count(*) into v_orders
    from orders where customer_id = p_id and business_id = p_business_id;
  if v_orders > 0 then
    raise exception '% has % order(s) on file — archive them instead, so the books keep their history',
      v_who, v_orders;
  end if;

  delete from public.business_customers
   where business_id = p_business_id and customer_id = p_id;

  select exists (
    select 1 from public.business_customers where customer_id = p_id
    union all
    select 1 from orders where customer_id = p_id
    union all
    select 1 from schedules where customer_id = p_id
  ) into v_elsewhere;

  -- Known to somebody else: they keep their customer, and their account.
  if v_elsewhere then return; end if;

  delete from profiles where id = p_id;
end $$;

grant execute on function public.add_customer(bigint, text, text, text, text) to authenticated;
grant execute on function public.delete_customer(uuid, bigint) to authenticated;

commit;
