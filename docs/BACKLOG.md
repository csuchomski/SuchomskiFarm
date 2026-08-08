# Backlog

Things asked for but not built. Nothing here is in progress.

Ordering within a section is the order they were raised, not a priority —
priority is the owner's call and isn't recorded here.

## Requested 2026-08-07

### Add and edit accounts

`public.ledger_accounts` has rows and a balance page (Books → Accounts), but
no way to create one or change its name or opening balance. Today an account
comes into existence by being typed into a transaction's `account` field,
which is why the balance page has to carry an "unlisted" flag at all.

Worth knowing before building: `ledger_transactions.account` is **text, not a
foreign key**, so renaming an account does not follow its transactions. A
rename needs to either update every matching transaction in the same
statement or be refused — silently doing neither would strand the money under
the old name. The live "Venmo" row also carries `business_id` null, so
whatever is built has to decide whether an account may be shared across
businesses or whether that row should be split per business.

### Add a customer

**Editing is done** — see "Closed 2026-08-08". What's left is *adding* one.

A customer still only comes into existence by signing up through `/shop`, so
there's no way to record someone who pays cash at the gate.

Worth knowing: `profiles.id` is a foreign key to `auth.users`, so a customer
row cannot simply be inserted without an account behind it. Either this needs
an invite flow, or the schema needs a notion of a customer who has no login —
that's a design decision, not just a form. Note that the insert policy on
profiles requires `role = 'customer'` while the CHECK constraint allows only
`'buyer'` or `'farmer'`, so that policy can never succeed as written; whoever
builds this should fix or drop it rather than work around it.

### Edit milking records

`herd.production_records` can be written from Milkings but never corrected.
A gallon typed into the wrong cow, or a wrong figure, is currently permanent.

Worth knowing: a production record may already have been consumed. Once its
batch is picked up, `complete_pickup` has decremented inventory and possibly
written a `herd.meat_sales` split against the animals that supplied it.
Editing the record after that point doesn't unwind any of it. Editing needs
to either restrict itself to records whose batch is untouched, or be honest
that it changes the herd figures without changing the store's.

### Import a transactions spreadsheet from Monarch

Bulk-import a CSV exported from Monarch into `ledger_transactions`.

Worth knowing before building:

- Monarch's export columns need to be seen before anything is written; don't
  guess at them. A sample export is the first thing to ask for.
- The importer has to map Monarch's categories onto `tax_categories` for the
  business being imported into, or everything lands as unmapped and Books →
  Taxes reports it as money with nowhere to go on the schedule.
- It needs to choose a business per row, and an account — both are required
  for the row to be visible at all (`is_business_member(null)` is false).
- Re-importing an overlapping export must not duplicate. There is no natural
  key on `ledger_transactions` today, so this likely needs one (a hash of
  date + amount + payer + account, or an `external_id` column).

## Raised 2026-08-07 by the customer pickup screen

### Correcting a completed order

A customer can now close out their own pickup from `/shop` — quantity, payment
method, and an amount that follows from the product's price. That figure is
self-reported: the app takes their word for "I paid by check", the same way it
takes the farmer's word on the Orders page.

Nothing corrects it afterwards. `complete_pickup` is one-way — there is no
"un-complete", and the Orders page shows `amount_paid` without letting anyone
change it. So a customer who picks Venmo and pays cash, or confirms a pickup
they haven't actually made, leaves a wrong row that only a SQL statement can
fix.

Worth knowing before building: the same objection as "edit milking records"
applies, and harder. A completed order has already consumed batches and may
have written a `herd.meat_sales` split against the animals that supplied it.
Editing the payment fields alone is safe and probably enough; editing the
quantity is not, and should either be refused or unwind the rest.

## Carried over from earlier sessions

- **Health** — the whole module. Deliberately last; may never be built.
- **Depreciation register** — see the decision below.
- **No PR-triggered CI** — tests run locally and on deploy, but a pull
  request doesn't run them.

## Closed 2026-08-07

Four items were reviewed and are no longer open.

- **Migration 008** — was *already run*, and had been for some time. The
  migrations README said otherwise, which is exactly the failure its own
  header warns about: check the database, don't trust the table. Milk
  detection has had `type_code` to work from all along, so `findMilkProduct`
  resolves on type rather than on the name. The name-match fallback stays:
  the backfill was deliberately conservative and left one product untyped,
  and a product added without a type would otherwise be invisible to it.
- **Migration 002** — run. Two nullable columns linking `herd.cost_entries`
  and `herd.revenue_entries` to a ledger transaction. Its stated dependency
  on 001 was stale: 001 was superseded, and the cross-tenant hole it existed
  to close is handled by the business-as-tenant work instead. As of
  2026-08-08 the columns are written — see "Attributed to" below.
- **`discards` had no `business_id`** — fixed by migration 020, along with
  `discard_inventory()` inserting rows without one. That was the *third*
  instance of the same bug, after 017 (`reserve_product`) and 019
  (`complete_scheduled_pickup`). There was a fourth —
  `herd.record_production`, fixed by 021 — found by the audit query written
  at the same time rather than by reading another function body. See
  `docs/migrations/audit-business-scoping.sql`.
- **Today's "Log milking" button** — fixed, along with two more links written
  before the pages they wanted existed. "Log milking" and "No milking logged
  today" now go to `/milkings`, and "orders not picked up" goes to
  `/store/orders` rather than all three landing on Products.

## Closed 2026-08-08

- **Edit and remove a customer** — Books → Customers is clickable. Each
  customer has a page with their details, their purchase history grouped by
  day, and lifetime figures. Name, email and phone are editable; `role` is
  not, because `authenticated` holds column-level UPDATE on four columns and
  role is deliberately withheld. Removing is archive-or-delete, decided by
  whether they have orders — all three profiles here do, so archive is the
  real one. Migration 024.
- **"Attributed to"** — the column exists and writes migration 002's link. A
  transaction can be split across animals, evenly by default and editable per
  animal, and partial attribution is allowed because a bill can be part
  household. Un-attributing is a soft delete, since neither entry table has a
  DELETE policy. The on-screen callout claiming the migration hadn't been run
  is gone; it had been wrong for a fortnight.

## Decisions, not open questions

**Depreciation stays a category.** Books → Taxes puts whatever figure you
record against "Depreciation & section 179" on Schedule F line 14 and does
not compute it. Building a real register means tracking cost basis,
placed-in-service date, method, recovery period, convention, Section 179 and
bonus elections, and accumulated depreciation per asset — a subsystem, and
one where being subtly wrong is worse than not doing it, because the number
goes on a filed return. Recommendation: leave it as a category and take the
figure from whoever files for you. Revisit only if you want the app to be the
system of record for fixed assets, which is a different decision from wanting
Schedule F to add up.

## A standing note on verification

Nothing in this app has been driven through a browser by its author while
being built — there's no signed-in session available to the agent. Logic is
unit-tested, pages have render tests, database work is exercised against the
live schema with RLS applied, and layout is measured against the built
stylesheet. None of that is the same as using it. The account-default bug
fixed on 2026-08-07 was found by the owner on a phone, which is the expected
shape of what gets through.
