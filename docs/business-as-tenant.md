# Making the business the workspace

**Status: proposal. Nothing built, nothing run.**

## The problem

Two apps grew up separately and each invented its own idea of "who owns this
data":

- `herd.*` — every table carries `farm_id`, every RLS policy checks
  `herd.is_farm_member(farm_id)`. The tenant is a **farm**.
- `public.*` — the ledger is scoped by `business_id`. `businesses` has no
  `farm_id` at all. The tenant is a **business**, and it isn't connected to
  the farm one.

Neither is wrong; they just don't know about each other. Everything awkward
about linking the books to the herd traces back to this.

The ask — *the whole app available to one business, with the business type
deciding what the app contains* — resolves it: **business becomes the
workspace**, and a farm becomes what a business of type `farm` has.

## What that means concretely

A user signs into a business. What they see depends on its type:

| Business type | Modules |
|---|---|
| `farm` | Herd · Store · Books |
| `real_estate` | Properties · Leases · Books |
| *(anything later)* | Books, plus whatever it declares |

Books is common to every type — it's the thing all businesses have. Herd and
Properties are type-specific. Today's rail is hardcoded; it would be built
from the modules the current business declares.

## ⚠️ Assumption to confirm before any of this

This design assumes your three existing `businesses` rows are **separate
enterprises**, each of which should be its own workspace.

If instead they're what the mockup implied — *Dairy & farm store*, *Row
crops*, *Rental land*, i.e. three sets of books for **one** operation, split
for tax reasons — then business-as-tenant is the wrong shape. You'd be
logging into "Row crops" and losing the herd. In that case the right model is
three levels, not two:

```
organisation  ->  business (tax entity, has books)  ->  modules
              ->  farm (the herd lives here)
```

The rest of this document assumes two levels. **Confirm which before
building.**

## Recommended: business is the tenant, farm is an extension of it

### Cheap where it counts

The naive migration renames `farm_id` to `business_id` across ~41 `herd`
tables, rewrites every RLS policy, and breaks the standalone Herd app. Don't.

Instead, leave every `herd` table exactly as it is and change what the join
*means*, in one function:

```sql
-- herd.farms gains a 1:1 link to its business
alter table herd.farms
  add column business_id bigint unique references public.businesses(id);

-- and membership is answered by the business, not a separate farm roster
create or replace function herd.is_farm_member(fid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1
      from herd.farms f
      join public.business_members m on m.business_id = f.business_id
     where f.id = fid and m.user_id = auth.uid()
  );
$$;
```

Every existing policy keeps working, unchanged, because they all call this
function. That's the whole trick: one function is the seam, so 41 tables of
policy don't need touching.

### New tables

```sql
create table public.business_members (
  business_id bigint  not null references public.businesses(id),
  user_id     uuid    not null references auth.users(id),
  role        text    not null,
  added_at    timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.business_types (
  code   text primary key,      -- 'farm', 'real_estate'
  label  text not null,
  active boolean not null default true
);

create table public.modules (
  code  text primary key,       -- 'herd', 'store', 'books', 'properties'
  label text not null,
  sort_order integer not null default 100
);

create table public.business_type_modules (
  type_code   text not null references public.business_types(code),
  module_code text not null references public.modules(code),
  primary key (type_code, module_code)
);
```

Types and their modules are **data**, matching the decision on transaction
types: a new business type is rows, not a migration. `businesses.type` already
exists as free text and would gain an FK to `business_types`.

### Why a join table rather than `business_types.modules text[]`

The array is simpler to read and worse to query — "which businesses have
Books" becomes an array scan, and there's no referential integrity on module
names, so a typo silently disables a module. The join table costs one more
table and makes both problems impossible.

## What this does *not* solve

- **Cross-business reporting.** If you want one view across all three sets of
  books, business-as-workspace works against you — every query is scoped to
  one. That's the main argument for the three-level model above.
- **A shared customer.** Someone buying milk and renting a property is two
  unrelated records. Fine now; annoying later.
- **`farm_members` becomes redundant** once membership lives on the business.
  Keep it in place, stop reading it, drop it once the standalone Herd app is
  retired — not before.

## Sequence, if this is the direction

1. Confirm the assumption above.
2. `business_members`, backfilled from `farm_members`.
3. `business_types` / `modules` / `business_type_modules`, seeded for `farm`.
4. `herd.farms.business_id`, backfilled 1:1.
5. Swap `herd.is_farm_member` to the business-based definition. **This is the
   sharp edge** — one function, and every herd policy changes meaning at
   once. Verify against a restored backup, not production.
6. App: resolve the current business, build the rail from its modules.
7. `real_estate` type and a Properties module — only after the farm path
   works end to end.

Migration 001 (`businesses.farm_id`) is **superseded** by this: it pointed
the link the wrong way, business → farm, when the farm is the extension and
the business is the tenant.
