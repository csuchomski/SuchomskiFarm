# Backlog

Things asked for but not built. Nothing here is in progress.

Ordering within a section is the order they were raised, not a priority —
priority is the owner's call and isn't recorded here.

## Requested 2026-08-07

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

## Raised 2026-08-10 by the alerts page

### Actually sending an alert

Herd → Alerts is a page you have to open. The obvious next step is for it to
reach you — email each morning, or a push when something enters "Now".

Worth knowing before building:

- It needs a scheduler. Nothing in this app runs without a browser open;
  Supabase has `pg_cron` and Edge Functions, and picking between them is the
  first decision.
- Sending needs a provider and a from-address the farm controls. That is a
  domain and DNS records, not code.
- It needs to not repeat itself. A cow eleven days past due is the same alert
  tomorrow, and a mail every morning saying so trains you to ignore all of
  them. That means recording what has been sent, and probably a "seen" or
  "snoozed until" per alert — which is the first piece of state this feature
  would own rather than derive.
- Deriving alerts fresh on every read is what makes the page trustworthy.
  Storing them is what makes sending possible. Those pull in opposite
  directions and the design has to pick.

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
- **Add, edit and remove accounts** — Books → Accounts does all three.
  Renaming moves every transaction naming the account with it, in one
  database transaction, because `ledger_transactions.account` is text and the
  name is the only link. Removing an account with entries insists on another
  account to move them to first. An "unlisted" account — named by
  transactions with no row of its own, which is how "Cash" and "Venmo" look
  today — can be given a row from the same page. Migration 025.

  Left as it is: `ledger_accounts_name_key` is `UNIQUE (name)` globally
  rather than per business, so two businesses can't both have a "Checking".
  The existing names already carry the business ("Landmark CU - Farm",
  "Landmark CU - Realtor"), so the constraint matches how they're used; the
  form says so when a name clashes rather than the schema being changed
  underneath a text column that depends on names being unique.
- **Add a customer** — Books → Customers has a form. The design decision it
  needed: `profiles.id` was a foreign key to `auth.users`, so a customer
  couldn't exist without an account, and the app can't create one (auth.signUp
  would replace the farmer's session; the admin API needs the service_role
  key). Migration 026 drops that foreign key and records `has_login` instead,
  keeping the cascade it provided as a trigger. A customer added at the farm
  can be reserved for, sold to and edited like any other; they just can't sign
  in, and the list says so.

  It also fixed a policy that could never have worked: the insert policy on
  profiles required `role = 'customer'` while the CHECK constraint allows
  only `'buyer'` or `'farmer'`, so any insert satisfying one failed the
  other. Nothing reported it, because a policy isn't validated against the
  constraints on the table it guards — see the migrations README.
- **Gestation per breed** — due dates count forward by the dam's breed
  rather than a species average, which had been giving a Jersey (279) and a
  Brown Swiss (290) the same answer eleven days apart. `breeds.default_
  gestation_days` was already seeded for all seventeen breeds and simply
  wasn't read. Herd → Breeds shows each one and lets the farm set its own
  figure, which beats the default here only; a cross is weighted across her
  composition, and a cow with no breeds on file still falls back to the
  species setting. Migration 029 adds only the key the upsert needs.
- **Pregnancy checks and calvings** — a standing breeding on Herd →
  Breedings can be checked (palpation, ultrasound, blood, milk test, visual;
  pregnant, open, recheck, aborted), and the row then shows the result, how
  many days bred she was, and when she's due — from the farm's own
  `gestation_days_*` settings, blank rather than guessed if there's no figure
  for her purpose. Herd → Calvings records the calving and its calves; a live
  calf gets its own animal record with dam and sire filled in, and a dairy dam
  freshens, which closes her previous lactation. Migration 028.
- **Log a breeding** — Herd → Breedings. A cow or heifer, a date, and either
  an AI straw or a bull she was exposed to. Choosing a straw draws it from the
  tank and books its cost against *her*, so it reaches her margin rather than
  sitting on the tank; the bull and the straw both show on the record.
  Voiding puts the straw back and withdraws the cost. Migration 027 — which
  added no tables, because `breeding_events` had modelled all of it and never
  been written to.
- **"Attributed to"** — the column exists and writes migration 002's link. A
  transaction can be split across animals, evenly by default and editable per
  animal, and partial attribution is allowed because a bill can be part
  household. Un-attributing is a soft delete, since neither entry table has a
  DELETE policy. The on-screen callout claiming the migration hadn't been run
  is gone; it had been wrong for a fortnight.

## Closed 2026-08-10

- **Alerts** — Herd → Alerts lists everything outstanding, with the day it
  became so, banded Now / Soon / Coming up. Six breeding rules: past due with
  no calving, a service old enough to check and unchecked, a check that came
  back "recheck", a calf on file that no calving accounts for, a cow past her
  waiting period, and a calving inside three weeks. The urgent ones also lead
  the "Needs you" panel on Today, so the list is seen without going to look
  for it.

  Every rule reads the same season assembly the timeline draws, through
  `nextBreeding`, so a cow cannot be "ready to breed" on one screen and
  "carrying" on another. The thresholds are named constants in `RULES` and the
  page says what they are — they're judgement calls, not arithmetic, and they
  belong somewhere a person can find and argue with.

  **This is not notification.** There is no email, no push and no cron; it is
  a page that is right whenever you look at it. Sending mail is a different
  problem with a different failure mode, and a list you can trust is the thing
  that has to exist before anything is worth sending. See the note below.

- **Next breeding, on the Animals list** — her calving plus the farm's
  voluntary waiting period (60 days), dated, with what she's doing instead
  where that doesn't apply: carrying with a due date, bred and awaiting a
  check, open, or blank. Blank for a heifer who has never calved — breeding a
  maiden is a decision about her age and her weight, and a date invented from
  her birthday would be a recommendation the farm never made.

  Status moved into the name cell as a pill to make room. It read "active" on
  almost every row, which was the least useful column-width on the page.

- **A calf on file with no calving is called out** — a cow's record now names
  any daughter recorded as hers that no calving accounts for, says which
  service the birth date fits and by how much, and links to the calving form
  with the dam, the date, the service and the calf already filled in.

  This is the second half of the Abigail problem. Migration 031 made the fix
  *possible*; nothing made it *visible*. Everything needed to spot it was on
  file — a daughter, a birth date, a confirmed pregnancy due six days later —
  and nothing looked, so her page went on reporting Martha overdue with the
  calf standing next to her.

  It doesn't infer the tie. A calving is a statement about what happened, with
  an ease and an assistance only the farmer knows. This finds the candidate
  and says so; the form does the rest.

- **The calendar-year view is gone** — removed at the owner's request. It laid
  the same events on Jan–Dec with pregnancies clipped at the year break, which
  was correct and answered a question nobody asks about a cow. What you want
  to know is how this season compares to the last, and that is what the season
  rows are for.

- **A calving can adopt a calf already on file** — the calf row on Herd →
  Calvings offers any animal recorded as born on the calving date and not
  already attached to one. Picking her attaches her instead of creating a
  second record of the same animal, and her sex, tag and name come from her
  own record rather than being asked for again.

  Found by asking why Abigail wasn't tied to Martha's breeding cycle. She was
  — by `animals.dam_id`, the pedigree link. What she had never had is a
  *calving*, and `herd.calvings` was empty farm-wide, because she was entered
  on 2026-08-04 and Calvings didn't exist until migration 028 on the 8th. The
  timeline reads calving → `breeding_event_id` → service, so Martha's first
  season never closed and her page still said she was overdue with the calf
  standing next to her. Migration 031.

  Every animal entered before 2026-08-08 is in the same position. The form
  now fixes them one calving at a time.

- **A sire's breeds, on the Sires page** — each bull shows his composition
  and can have it set there. He had nowhere else: reference bulls are kept
  out of the Animals list on purpose, so they have no record page to open,
  and one of them has no ear tag to route to even if they did. A bull with no
  composition leaves every calf he sires with none, since inheritance needs
  both parents — so this is the field that decides whether the herd's
  genetics carry forward at all. Rows for bulls with nothing on file are
  tinted.

  `saveComposition` now calls `herd.set_breed_composition` instead of
  soft-deleting the old rows and inserting the new ones as two separate
  requests — the second is the one carrying the data and the one that can
  fail, which left an animal with no breeds at all.

- **Beef and dairy kept apart** — Animals filters to one side or the other and
  says how the herd divides; each row and each animal's identity line carries
  her purpose. Lactations is dairy-only: a beef cow is no longer counted as a
  cow missing a lactation, and her record has no lactation section at all.

  This was a real disagreement, not a cosmetic one. `herd.record_calving` has
  always opened a lactation only for `purpose in ('dairy', 'dual')`, so a beef
  cow's calving correctly created none — and the app then reported her under
  "Cows with none" in a red stat tile that could never be cleared, and offered
  a "record a freshening" button that would have opened by hand the very row
  the database declined to open. One predicate, `isMilked()` in lib/herd.ts,
  now matches the database's rule and is the only place the question is asked.

  `purpose` is the switch, not breed. A dairy-breed cow run as a beef cow is a
  beef cow; composition says what she is, purpose says what she's for.



- **Her breeding record, drawn** — built from mockup 2a of the Cow Lifecycle
  set. An animal's page now opens with "Her record, row by row": one row per
  calving, every row starting the day she calved so day 84 in one row is day
  84 in the next and the columns compare by eye. A second reading lays the
  same events on calendar years, with a pregnancy carrying across the break.
  Each service is a mark whose shape carries its result — hollow dashed for
  one that didn't take, dotted for one nobody has checked, filled for the one
  that did — and the line above everything says what is outstanding right
  now, which is the only sentence on the page about the future.

  No migration. Every figure was already in the schema and nothing read it,
  including `settings.voluntary_waiting_period_days`, seeded at 60 and never
  used until it became the shaded block at the start of a season row.

  Two decisions worth keeping: **days open is null, not zero**, for a cow with
  no calving to measure from — a zero would sort a maiden heifer to the top of
  every "best cows" ordering — and the mockup's own design system was *not*
  imported. It arrived with a gold accent ramp, Cormorant Garamond over Lora,
  shadows and radii; the layout is the mockup's and everything visual is
  Herd's, because a second design system on one screen makes that screen look
  borrowed.

## Closed 2026-08-09

- **A calf tied to the breeding that made it** — the calving form asks which
  service is behind it and defaults to the one whose due date lands nearest
  the calving, not the most recent. That matters exactly when it's hard: a cow
  served in January, returned to heat and served again three weeks later, then
  calving in October, conceived on the *first* service — and the obvious guess
  puts the wrong bull on the calf. The pick is a suggestion; touching the field
  makes it yours and changing the date won't undo it.

  A live calf then inherits half its breeds from each parent, and Herd →
  Breeds has a "Who is what" table for putting a composition on the animals
  that have none. Inheritance only happens when **both** parents have one —
  half a known composition and half of nothing isn't 50%, it's an unknown, and
  a half-filled composition is worse than an empty one because everything
  downstream divides by it. Migration 030.

## Raised 2026-08-08 by breeding records

### Carcass ultrasound

`herd.ultrasound_scans` is empty and unbuilt. It was listed here alongside
pregnancy checks by mistake: its columns are `imf_pct`, `ribeye_area_sqin`,
`backfat_in` and `rump_fat_in` — carcass ultrasound for beef seedstock
evaluation, nothing to do with whether a cow is in calf. A pregnancy
ultrasound is a `pregnancy_checks` row with `method = 'ultrasound'`, and that
is built.

Worth knowing before building: it's only worth anything to someone marketing
breeding stock on carcass merit. Two beef females and a reference bull is not
that farm yet.

### Embryo transfer

`breeding_events.method` allows `'et'`, and `herd.embryo_lots` and
`herd.embryo_transactions` exist with the same shape as the semen tables.
`record_breeding` deliberately refuses `'et'` rather than half-supporting it
— the donor dam, the embryo lot draw-down and its cost are the same problem
again and deserve their own pass.

## Decisions, not open questions

**The AI cost stays on the cow.** Asked directly: should a straw's cost move
to the calf it produced? No, and the schema already says so —
`expense_categories 'breeding'` is `basis_type 'operating'` on the Schedule F
line "Veterinary, breeding, and medicine", while `'acquisition'` is
`basis_type 'basis'` and goes on no expense line at all. Breeding is an
operating expense in the year it's paid, not a basis cost capitalised into an
animal, so moving it onto the calf puts it in the wrong column of the return.
It's also incurred before any calf exists, and most of the value in tracking
it is the services that *don't* take — those have no calf to carry them.
"What did this calf cost" stays answerable anyway: calving → breeding event →
`cost_entries.source_ref_id`, derivable through the link without moving the
money. Revisit only if the farm starts raising replacements to sell, where
capitalising the cost into the animal is a real accounting choice — and that
is a conversation with whoever files the return, not a code change.

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
