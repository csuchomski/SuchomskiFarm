-- 050 — the product list is not everybody's business
--
-- STATUS: run 2026-08-17
--
-- Two policies read, in full:
--
--     "anyone signed in reads products"   on public.products           using (true)
--     "anyone signed in reads batches"    on public.inventory_batches  using (true)
--
-- They exist because the customer shop has to show a catalogue, and a
-- customer is a member of nothing — `is_business_member(business_id)` is
-- false for them, so without something permissive the shop is empty.
--
-- With one business on the database that is harmless. With two it is a
-- breach: every signed-in user can read every business's product list,
-- prices, quantity on hand and quantity reserved. A farm keeping herd
-- records and selling nothing would have its inventory readable by every
-- other account on the system.
--
-- The fix is to say what the permissive policy was reaching for but could
-- not express: **a shop is readable because it is a shop.** A business that
-- has the store module is running a storefront, and its catalogue and
-- availability are public by the nature of the thing. A business without it
-- is not selling to anybody and its rows go back behind membership.
--
-- That distinction only became sayable in 049, which put modules on the
-- business rather than on its type.
--
-- Deliberately not done here: hiding columns. `inventory_batches` carries
-- `herd_animal_id`, so a customer of a storefront can see which animal a
-- batch came from. Column privileges are granted to a role rather than to a
-- policy, so restricting it would take it away from the farmer too; it wants
-- a view, and it is a smaller thing than what this migration closes.

-- ── products ──────────────────────────────────────────────────────────────

drop policy if exists "anyone signed in reads products" on public.products;

create policy products_read on public.products
  for select using (
    public.is_business_member(business_id)
    or public.business_has_module(business_id, 'store')
  );

-- ── what is on hand ───────────────────────────────────────────────────────

drop policy if exists "anyone signed in reads batches" on public.inventory_batches;

create policy inventory_batches_read on public.inventory_batches
  for select using (
    public.is_business_member(business_id)
    or public.business_has_module(business_id, 'store')
  );

-- ── a lookup table anyone could rewrite ───────────────────────────────────
--
-- `transaction_types_write` is `for all using (true) with check (true)` on a
-- table with no business_id: the ledger's list of transaction kinds, shared
-- by every business on the database. Any signed-in account could rename or
-- delete a type out from under everyone else's books.
--
-- Nothing in the app writes to it — every reference is a select — so the
-- policy is removed rather than narrowed. Seeding new types is a migration's
-- job, and migrations do not go through RLS.
drop policy if exists transaction_types_write on public.transaction_types;
