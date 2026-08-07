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

### Add and edit customers

Books → Customers lists profiles and what they've bought, but a customer only
exists by signing up through `/shop`. There's no way to add someone who pays
cash at the gate, or to fix a name — three of the current profiles have a
blank `first_name`, which is why the list falls back to email.

Worth knowing: `profiles.id` is a foreign key to `auth.users`, so a customer
row cannot simply be inserted without an account behind it. Either this needs
an invite flow, or the schema needs a notion of a customer who has no login —
that's a design decision, not just a form.

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

## Carried over from earlier sessions

- **Health** — the whole module. Deliberately last; may never be built.
- **Depreciation register** — depreciation is currently a plain expense
  category you type a figure into. A real register (basis, in-service date,
  method, recovery period, accumulated depreciation) is a separate build, and
  would let Books → Taxes compute line 14 rather than take it on trust.
- **Migrations 008 and 002** — never run. 008 populates `products.type_code`,
  which milk detection currently falls back to name-matching for. 002 links
  books to per-animal costs.
- **`herd.discards` has no `business_id`** — migration 010 scoped the rest of
  the store and missed it, so discards are filtered app-side by product
  instead of server-side. Works, but it's the one table in the store that
  isn't scoped by the database.
- **Today's "Log milking" button** routes to `/store/products` rather than
  `/milkings`.
- **No PR-triggered CI** — tests run locally and on deploy, but a pull
  request doesn't run them.

## A standing note on verification

Nothing in this app has been driven through a browser by its author while
being built — there's no signed-in session available to the agent. Logic is
unit-tested, pages have render tests, database work is exercised against the
live schema with RLS applied, and layout is measured against the built
stylesheet. None of that is the same as using it. The account-default bug
fixed on 2026-08-07 was found by the owner on a phone, which is the expected
shape of what gets through.
