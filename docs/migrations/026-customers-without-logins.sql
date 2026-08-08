-- 026 — A customer who pays cash at the gate, and a policy that could never
--       have worked.
--
-- STATUS: RUN, 2026-08-08. Verified in a rolled-back transaction as the
-- farmer and then as a buyer, so RLS applied throughout:
--   added a walk-in: role buyer, has_login false, email '' accepted
--   reserved an order for them — the point of the whole thing
--   edited their phone through the ordinary profiles update
--   deleting them once they had an order -> refused
--   no name and no email -> refused
--   an email another customer already has -> refused
--   a walk-in with no orders -> deleted cleanly
--   a buyer calling add_customer -> refused
--   policy now reads role = 'buyer'; profiles_id_fkey gone
-- The rehearsal also caught delete_customer's message starting blank for a
-- customer with no email, fixed below.
-- Depends on: 009 (profiles policies), 024 (customer admin).
--
-- ── Part one: the dead policy ─────────────────────────────────────────
--
-- public.profiles carries:
--
--   policy   "insert own profile as customer"
--            with check (auth.uid() = id and role = 'customer')
--
--   constraint profiles_role_check
--            check (role in ('buyer', 'farmer'))
--
-- The policy demands a role the constraint forbids, so it can never pass —
-- any insert satisfying one fails the other. It has been unreachable since
-- it was written.
--
-- Nothing broke because nothing uses it: `on_auth_user_created` calls
-- `handle_new_user()`, which is security definer and creates the profile
-- with role 'buyer' before any policy is consulted. The client-side insert
-- in signUpCustomer is a fallback for the trigger not firing, and it sends
-- 'buyer' too — so on the one path this policy exists to allow, it would
-- have refused.
--
-- 'buyer' is the right value: it is what the column defaults to, what the
-- trigger writes, and what all three live rows carry.
--
-- ── Part two: a customer with no login ────────────────────────────────
--
-- Adding someone who buys eggs at the gate means a profiles row, because
-- orders.customer_id and schedules.customer_id both reference it. But:
--
--   profiles_id_fkey  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
--
-- so today a profile cannot exist without an account behind it, and creating
-- an account from the app is not possible: auth.signUp would replace the
-- farmer's own session, and the admin API needs the service_role key, which
-- must never be in the frontend.
--
-- So the foreign key goes. That is the decision this migration makes, and
-- it is worth being plain about what it costs: nothing stops a profiles row
-- existing for an id that is not a user. That is precisely the point — those
-- rows are the walk-in customers — but it means "has a profile" no longer
-- implies "can sign in". `has_login` records which is which rather than
-- leaving it to be guessed.
--
-- The cascade the FK provided is kept as a trigger, so deleting an account
-- still removes its profile. The guarantee moves; it isn't dropped.

begin;

-- ── the policy ────────────────────────────────────────────────────────

drop policy if exists "insert own profile as customer" on public.profiles;

create policy "insert own profile as customer"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id and role = 'buyer');

-- ── customers with no account ─────────────────────────────────────────

alter table public.profiles
  add column if not exists has_login boolean not null default true;

comment on column public.profiles.has_login is
  'False for a customer added at the farm, who has no auth.users row and '
  'cannot sign in. True for anyone who signed up through the shop — which '
  'is the default, so handle_new_user() needs no change.';

-- SELECT and INSERT on profiles are table-level grants, so they cover a new
-- column; only UPDATE is granted per column here, and nothing updates this
-- one. Checked rather than assumed — see the note on 024 in the README.

alter table public.profiles drop constraint if exists profiles_id_fkey;

-- What the foreign key was doing besides refusing walk-ins. Deleting an
-- account still takes its profile with it.
create or replace function public.delete_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.profiles where id = old.id;
  return old;
end $function$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.delete_profile_for_user();

-- ── adding one ────────────────────────────────────────────────────────

create or replace function public.add_customer(
  p_first_name text default '',
  p_last_name text default '',
  p_email text default '',
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_email text; v_first text; v_last text;
begin
  if not is_farmer() then
    raise exception 'Only a farmer can add a customer';
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

  if v_email <> '' and exists (select 1 from profiles where lower(email) = v_email) then
    raise exception 'There is already a customer with the email %', v_email;
  end if;

  -- The id is generated here rather than accepted from the caller: it is a
  -- primary key that used to be an account's id, and letting a client choose
  -- it would let them aim at one.
  v_id := gen_random_uuid();

  insert into profiles (id, first_name, last_name, email, phone, role, has_login)
  values (v_id, v_first, v_last, v_email,
          nullif(btrim(coalesce(p_phone, '')), ''), 'buyer', false);

  return v_id;
end $function$;

comment on function public.add_customer(text, text, text, text) is
  'Create a customer with no login — someone who buys at the farm. Their '
  'profile carries has_login false and no auth.users row exists for them.';

grant execute on function public.add_customer(text, text, text, text) to authenticated;

-- ── 024's message, now that a customer can have no email ──────────────
--
-- delete_customer names the customer it's refusing to remove, and named them
-- by email — which every profile had when 024 was written. A walk-in may not,
-- and the rehearsal of this migration produced:
--
--   "  has 1 order(s) on file — archive them instead"
--
-- Same fallback order as customerName() in the app: a name, then the email,
-- then something rather than nothing.

create or replace function public.delete_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_orders integer; v_who text;
begin
  if not is_farmer() then
    raise exception 'Only a farmer can remove a customer';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot delete your own account from here';
  end if;

  select coalesce(
           nullif(btrim(first_name || ' ' || last_name), ''),
           nullif(btrim(email), ''),
           'That customer')
    into v_who
    from profiles where id = p_id;
  if v_who is null then raise exception 'No such customer'; end if;

  select count(*) into v_orders from orders where customer_id = p_id;
  if v_orders > 0 then
    raise exception '% has % order(s) on file — archive them instead, so the books keep their history',
      v_who, v_orders;
  end if;

  delete from profiles where id = p_id;
end $function$;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select count(*) filter (where has_login) as with_login,
--          count(*) filter (where not has_login) as without
--     from public.profiles;                         -- 3 / 0 before any are added
--
--   select conname from pg_constraint where conrelid = 'public.profiles'::regclass;
--                                                    -- profiles_id_fkey gone
--
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy
--    where polrelid = 'public.profiles'::regclass and polname = 'insert own profile as customer';
--                                                    -- ... role = 'buyer'
--
-- And with RLS applied, since that is the caller that matters:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select public.add_customer('Gate', 'Buyer', '', '555-0123');   -- returns a uuid
--   select public.add_customer('', '', '');                        -- refused
--   select public.reserve_product(1, 1, '<that uuid>');            -- an order for them
--
--   set local request.jwt.claims = '{"sub":"<a buyer>","role":"authenticated"}';
--   select public.add_customer('Sneaky', '', 'x@y.z');             -- refused
--
-- Rollback:
--   drop function if exists public.add_customer(text, text, text, text);
--   drop trigger if exists on_auth_user_deleted on auth.users;
--   drop function if exists public.delete_profile_for_user();
--   delete from public.profiles where not has_login;   -- or they break the FK
--   alter table public.profiles
--     add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
--   alter table public.profiles drop column if exists has_login;
--   -- and restore the policy's role = 'customer', which never worked anyway.
