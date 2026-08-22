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

## Requested 2026-08-10

Six asks, recorded as given. Five are built — see "Closed 2026-08-10" below.
What is left open is the tax half of depreciation, beef depreciation, and
pasture moves.

### Beef depreciation, from a management perspective

The other side of the herd. The dairy model shipped deliberately excluding
beef cows — every assumption in it is a dairy figure — and the page says so
rather than leaving a silent gap. This is the ask to give the beef side its
own.

The shape of the arithmetic is the same:

```
(replacement cost of a bred heifer − cull value) ÷ productive lifetime
```

**Four things make it a different model, not the same one with new numbers:**

1. **The lifetime is much longer.** A beef cow commonly stays for 5–6 calves,
   often 8–10 years, against 3.5 lactations on the dairy side. Running the
   beef herd through the dairy default would roughly double her annual charge.
   This alone is why it needs its own assumptions rather than sharing.

2. **The per-unit denominator isn't hundredweight of milk.** Beef sells a
   weaned calf, so the figures that change decisions are per cow exposed, per
   weaned calf, and per hundredweight of weaned calf. The dairy page's $/cwt
   column has no meaning here and should not be reused with a different label.

3. **Weaning percentage belongs in the denominator, and is the thing most
   likely to be left out.** A cow that doesn't wean a calf still depreciates,
   so cost per weaned calf is the annual charge divided by the weaning rate —
   at 90%, a $200 charge is $222 a weaned calf. This is the beef analogue of
   the dairy sensitivity to yield, and it moves the number by more than most
   people expect.

4. **Raised replacements aren't priced, they're developed.** A raised beef
   heifer's replacement cost is what it cost to carry her from weaning to her
   first calf, not what a bred heifer sells for. Same arithmetic, different
   input, and the farm has to say which one it means — the two can differ by
   several hundred dollars and the answer changes whether raising or buying
   looks better, which is one of the decisions this figure exists to inform.

A refinement worth naming rather than building first: a cow that **dies** has
no salvage, so a rigorous version nets expected death loss out of the cull
value rather than assuming every cow leaves through the sale barn.

#### What the code already does

More than half of it. `carryingValueCents` and `enteredProduction` in
`lib/depreciation.ts` are already beef-ready: her clock starts at the earlier
of her first freshening and her first calving, and a beef cow has calvings
and no lactations, so the decline curve and the cull-value floor need no
change at all.

What's missing is narrow:

- A second set of assumptions. The current settings keys — `replacement_cost_
  cents`, `cull_value_cents`, `productive_lifetime_lactations` — are
  unsuffixed and implicitly dairy. The schema already has the pattern to
  follow in `gestation_days_beef` / `gestation_days_dairy`, so this is a
  migration that *moves* the existing values to a suffixed key as well as
  adding the beef ones, not one that only adds.
- Lifting `purpose in ('dairy','dual')` in `herd.mark_herd_values` and
  `isHerdInventory`, so the roll picks the assumptions by her purpose instead
  of skipping her.
- A page, or a second section on the existing one. Worth deciding rather than
  defaulting: the two herds share an arithmetic and share no denominator.

#### What would sharpen it, when the data arrives

- `herd.disposition_sale_details` carries `live_weight_lb`,
  `price_per_cwt_cents` and `net_cents` — realised cull values. Empty today,
  but once cows start leaving, the assumed cull value can be replaced by what
  they actually brought, which is the single biggest improvement available.
- `herd.weights` has a `weight_type` and no rows. Weaning weights are what a
  per-hundredweight-of-calf figure needs.
- `herd.calving_outcomes` (2 rows) gives calves born and how they turned out,
  which is the numerator of a weaning rate that could be measured rather than
  assumed.

Scale, for context when this is built: two beef females on file, Martha and
Abigail.

### Depreciation per cow — the tax half

**The management half is built. See "Closed 2026-08-10" below and migration
035.** What is left here is the 4562 side, which stays open on purpose.

The spec, as given, is kept below in full: the two computations share a table
and nothing else, and the reasoning for the built half lives here.

#### Management: economic herd depreciation — BUILT

Herd depreciation is a real cash-equivalent cost whether or not the IRS lets
you deduct it, and on most dairies it is the largest unrecognised cost of
production:

```
(replacement cost of a springing heifer − cull value) ÷ productive lifetime
```

At $2,200 in and $900 out over 3.5 lactations that is **$371/cow/year** —
about **$1.86/cwt** on a Jersey at 20,000 lb. Leave it out of cost-per-cwt and
the margin looks better than it is, which drives bad calls on culling
aggressiveness, on raising versus buying replacements, and on whether a third
lactation is worth chasing.

Worth building in as a sensitivity rather than a constant: the per-cwt figure
moves with yield, not just with the spread. The same $371 is $1.86/cwt at
20,000 lb and $2.32/cwt at 16,000 lb, so the page should divide by *her*
production rather than a herd assumption wherever the record supports it.

Practically, and separately from the 4562: run economic herd depreciation in
the accrual-adjusted statements, usually via a **raised-breeding-stock
inventory value that is marked and rolled each year**. Lenders want this one
too.

What that needs from the schema: a per-animal value with a date and a reason
(marked, purchased, appraised), so a year's roll is a new row rather than an
overwrite — the history is the point. `herd.cost_entries.is_basis` already
carries what a purchased animal cost.

#### Tax: purchased animals only, on the 4562

Depreciation only exists where there is basis. A heifer raised on a cash-basis
Schedule F had her feed, vet, breeding and labour deducted as incurred, so
**her basis is zero and there is nothing to depreciate**.

- Purchased cows only: **5-year MACRS**, 7-year ADS.
- Placed in service **when she enters the milking string**, not when she was
  bought as a bred heifer.
- Section 179 and 100% bonus are both available.
- **§1245 recapture** when she is culled.
- A raised cow held 24+ months sells as **§1231 gain with zero basis**, which
  is usually the better outcome anyway.

The raised-versus-purchased basis question gets fiddly if the farm ever buys
bred heifers and resells them; confirm the specifics with the CPA before that
path is coded.

**Still open on the tax side**, and deliberately: a register needs a
placed-in-service date per purchased animal, an election per animal for §179
and bonus, accumulated depreciation carried year to year, and recapture at
culling. None of it is hard; all of it is wrong in ways nobody notices until a
return is filed. The recommendation stands — take line 14 from whoever files —
and the first question for the CPA is the raised-versus-purchased basis case
if the farm ever buys bred heifers and resells them.

#### What this changes about the decision below

"Depreciation stays a category" was decided against building a tax fixed-asset
register, and that part stands: line 14 still takes a figure from whoever
files. The management computation was never what that decision was about — it
is built, and it needed not a single one of MACRS, convention or recapture to
be right.

### Pasture moves

**Built.** It became the whole CPS 528 grazing module — migrations 036–042,
nine screens under Herd. See `docs/GRAZING.md`. Left here rather than deleted
because the entry is where the trail starts.

## Requested 2026-08-13, after seeing the shipped move flow

### Redo logging a move: one page, and a back line you can set

**Built 2026-08-13** as Herd → Move, along with the four answers below.
Migrations 043 and 044 are run. See "Move: the morning, on one page" in
`docs/GRAZING.md`. Kept here because the reasoning is the trail.

The ask, close to verbatim:

> I want logging a move to be redone so everything is on one page. I want to
> be able to tell you my starting point (the back line) and then set the new
> line every day (the line placed the move before then becomes the back
> line). There may be times that I cut hay and skip a section of a paddock or
> a paddock entirely in which case I'd need to be able to set a new back line
> again so include that functionality. Using the map, the amount of pasture
> should automatically be calculated.

Raised against the prototype at
`https://claude.ai/code/artifact/0ec1a04d-55b0-4d82-89b9-a5569ab4c177`, which
already showed this: map and readout side by side on one screen, the wire
dragged on the drawing, and the back fence as its own drawn line.

**Why it did not get built that way.** The prototype was drawn before any
geometry existed — no KML yet — so step 2 shipped the wire as a percentage on
the board, which was the only thing that could work at the time. Its own idea
03 said "the map screen, brought forward… it becomes the primary way to log a
move rather than a nice extra", and when the KML did arrive (040) the map was
built as step 4 beside the board instead of replacing it. Idea 05, "the back
fence deserves its own record", was never built at all. The build order got
followed and the prototype got treated as an illustration.

#### What is actually missing

**`swept_from` is derived, never settable.** Today the app reads it off the
previous open event's `swept_to`. That is right for the ordinary case and
has no answer for the ones raised here — starting a pass part-way in, skipping
a section, or coming back after hay. The column already exists and takes any
value; it is the UI and `log_grazing_move` that assume continuity. The
function refuses `p_swept_from` behind the last `swept_to`, which is the
right default and must become overridable rather than absolute.

**Skipped ground needs no new model, and that is worth knowing.** Rest is
already asked of a *position*, not a unit, so ground the wire jumped over is
simply ground with no covering interval this pass and dates from whenever it
was last covered. Nothing to add. The only new thing is being able to say the
jump happened.

**A partial hay cutting has nowhere to go.** `forage_removals` is whole-unit:
paddock, date, yield. "I cut the east third" cannot be recorded, and it is
one of the two cases named in the ask. This wants `swept_from`/`swept_to` on
`forage_removals` too, at which point `lastDefoliatedAt` stops treating a
cutting as covering every position and starts treating it as an interval like
any other — a genuine simplification, since the special case disappears.

#### The acreage is wrong today, and not slightly

This is the part of the ask that is a correctness fix rather than a
convenience. `stripAcres` computes `(to - from) × unit acres`, which assumes a
unit's area is spread evenly along its sweep. That is exact for a rectangle
and wrong for anything else. Measured against the drawn boundaries from 040:

| Unit | first 10% | middle 10% | last 10% |
|---|---|---|---|
| Paddock 1 | −24% | +10% | −14% |
| Paddock 2 | −5% | +0.5% | +0.5% |
| Paddock 3 | +0.5% | +0.5% | −5% |
| Paddock 4 | −16% | **+30%** | **−94%** |
| Paddock 5 | +18% | 0% | −18% |

Paddock 4's last tenth is 0.014 acres of ground being reported as 0.225 — it
tapers to a corner, and the arithmetic cannot see that. Paddocks 2 and 3 are
near enough rectangles to be fine, which is why nothing looked wrong.

It propagates: hours of feed, lb/acre density and the forage balance all
divide by that acreage, so a strip that holds them ninety minutes can read as
a day.

**The fix is already written.** `sweepSlice` returns the real polygon and the
shoelace area of it is the honest figure; `pasture-map.test.ts` already
computes exactly that to check the slicing. It needs lifting out of the test
into `lib/`, and `stripAcres` needs to use it whenever a boundary exists and
fall back to the fraction only when one does not.

#### Shape of the work

One page replacing two. The board's move form and the map's wire placement
are the same act done twice, and the readout — acres, feed, density, width —
is identical on both. Keep the gate readings (forage height, residual out,
soil) on the same page rather than losing them; they were the reason the
board's form existed.

#### Answered: the back line is a position on the whole serpentine

Asked whether setting a back line is its own dated act or a field on the next
move. The answer reframes it, and is worth quoting:

> The scenario I want to handle where I'm running the cows through paddock 2
> but I decide to cut paddock 4 for hay. After working our way through paddock
> 3, I might want to skip paddock 4 in which case I'd want to set the backline
> to the start of paddock 5.

**"The start of paddock 5" is a back line position.** So the back line is not
a fraction within one unit — it is a point on the farm's single continuous
path, P1 → P2 → P3 → P4 → P5 → P1. Skipping a unit is advancing the back line
past the whole of it.

That settles the dating question by dissolving it. A skipped unit is not
grazed at all, so nothing about its rest changes when you decide to skip it —
its clock keeps running from its last defoliation, and the hay cutting resets
it when it happens. **The back line is a field on the next move, not a
separately dated act.** The move already carries the date, and that date is
the only one that means anything.

#### The morning, as described

Given the same day, and the thing to build against:

> When I go out in the morning, I'm going to move the cows. I want to track
> the height of the pasture grass where I'm moving them to, you'll already
> have the weight of all the cows and how much we're anticipating they eat
> each day. Given that information, I'll drag the wire line forward and see
> live acres, days of feed, and lb/acre. This will help me decide how much to
> give them plus log my move. I want the UX to be seemless, efficient, and
> easy. the back line will be the wire line i moved forward yesterday. I
> don't need to pick the paddock, it should already know. Once I'm done with
> a paddock, I should be able to move to the next paddock and the backline
> should automatically move to the start of that paddock with the wire line
> defaulting away from the backline so I can see it and drag it. If I cut
> hay, i want that recorded so I know when it was and how much rest there's
> been. given that I might have cut a paddock for hay, i want the option to
> skip paddocks.

Read as a checklist, most of it is arrangement rather than new machinery:

- **Opens on the current paddock, no picking.** The mob's open event already
  says where they are; the page should start there. Picking a unit becomes
  the exception — "next paddock" or "skip" — not the first step.
- **The back line is yesterday's wire**, already true in the data and already
  what `swept_from` derives. What changes is that it becomes visible and
  overridable rather than invisible and fixed.
- **The wire defaults away from the back line.** A concrete requirement worth
  keeping: at the start of a unit the two coincide, and a wire sitting on the
  back line cannot be seen or grabbed. It needs to open at a day's width —
  which is also the useful default — so there is something to drag.
- **Days of feed, not hours.** The readout currently says `36h` under a day
  and a half. The word used is days; `formatFeed` should follow.
- **Head and weight without asking.** Per-animal weights live in
  `herd.weights`, which is still empty, and intake comes from the plan. Both
  need to exist before this reads as effortless rather than blank — see the
  head-count defect below.

#### Grass height is the one genuinely new thing

"Track the height of the pasture grass where I'm moving them to" is a
measurement the module already has a column for —
`grazing_events.forage_height_in_entry` — but it is currently *recorded and
never used*. The ask is for it to **drive** the figures: height taken at the
gate this morning is what should set standing forage for today's strip.

That needs a conversion the app does not have and must not invent: **pounds
of dry matter per acre-inch**. It varies with sward, season and density, it
is exactly the kind of agronomic number this module has refused to hardcode
everywhere else, and it belongs in the plan beside `default_dmi_pct_bw`.

Worth asking rather than assuming: whether the reading is a plate-meter
figure, a stick, or an eye; and whether the farm already has a lb/acre-inch
figure it trusts, or wants one from Extension. Until it has one, the honest
behaviour is what the readout does today — fall back to the availability
record and say the figure is not theirs.

Note also the ordering this implies. Height is taken **before** the move, of
the ground about to be opened, so on the one page it belongs above the wire,
feeding it — not in an "everything below is optional" section after it, which
is where the board's form puts it.

#### Answers, given 2026-08-13 — these are settled

**1. A weight field on the animal.** Asked for so weights can be entered on
the animal itself, and *summed across the herd* to give the total weight on
pasture.

This crosses an earlier decision in `GRAZING.md`, which chose `herd.weights`
— dated rows — over "a single field on the animal", so that a heifer's April
figure stays her April figure. Both wants are real, and the resolution is not
to pick: **a weight field on the Animals form that writes a dated row to
`herd.weights`.** It reads as one field and keeps the history, and nothing
downstream changes.

Note the summing is already how it works. `groupAvgWeightLb` averages each
member's most recent weighing, so head × average *is* the sum of actual
weights, and varying sizes are already handled. `herd.weights` being empty is
the whole of the problem; there is no arithmetic to fix, only a way in.

Total weight on pasture is worth showing outright, though — it is the figure
behind stock density and nowhere on screen today.

**2. Standing forage: 300 lb of dry matter per acre-inch.** The farm's
figure, so it goes in the plan rather than the code — a new
`grazing_plans.lb_dm_per_acre_inch` beside `default_dmi_pct_bw`, editable on
the Plan page like everything else there. This morning's height reading ×
300 × grazable acres is then the standing forage for today's strip, and the
readout can finally say the figure is theirs rather than the app's.

Worth stating what this does to the existing chain: it makes
`forage_availability` the fallback rather than the source, since a height
taken this morning beats a figure recorded for the month.

**3. Rotation order: P1, P2, P3, P4, P5.** A `paddocks.rotation_order`
carrying 1–5. It is what lets "the next paddock" and "the start of Paddock 5"
be things the app can name, and it wraps — after P5 comes P1.

**4. The one-page move — yes.** Build it as described above.

**5. The acreage fix and the new KML together — yes.** One pass, so the
figures move under the farm once.

#### The database already does this — checked, not assumed

Both skips were tested against the live farm inside a rolled-back
transaction, as an `authenticated` user:

| | |
|---|---|
| Jump the back line forward inside a unit (skip a section) | **accepted** |
| Move on to another unit, leaving one part grazed (skip a unit) | **accepted** |
| Put the wire back over ground just grazed | still refused |

`log_grazing_move` only ever refused going *backwards*
(`p_swept_from < v_open.swept_to`), and never constrained `swept_from` at all
on a move to a different unit. So the skip mechanics need **no migration**.
What is missing is only that the app never lets `swept_from` be anything but
the derived value.

That makes this materially smaller than it first read.

#### What genuinely is missing

**The rotation order is not stored anywhere.** "Set the back line to the start
of Paddock 5" needs the app to know P5 follows P4 follows P3. The serpentine
is confirmed and is implicit in the sweep headings, but nothing records the
sequence — `rotationRounds` infers order from what happened, which is the
wrong direction for this. Wants a `paddocks.rotation_order`, and it is the
one schema change the skip needs.

**Nothing can say a unit is shut up for hay.** After skipping Paddock 4 its
rest keeps climbing and the board sorts it to the top as the best next
choice — exactly the wrong advice, and the reason the skip happened. The
schema already anticipated this and it was never used:
`plan_schedule_periods.kind` includes `'deferment'`, and
`plan_paddock_targets.planned_deferment_notes` exists. Deferring a unit
should take it off the board's list and say why.

**A partial hay cutting still has nowhere to go** — see above. Skipping a
*section* to cut it is the case that needs `swept_from`/`swept_to` on
`forage_removals`.

### An updated KML is waiting, not loaded — **loaded 2026-08-13, migration 044**

`docs/suchomski-farm-2026-08-13b.kml`, sent the same day. Loaded with the
acreage fix in one pass, as argued below. The five units re-cut to 2.021,
1.932, 1.972, 2.261 and 1.381 acres — 9.568 in total, which is the perimeter
exactly.

What changed, so nobody has to work it out later: **only the perimeter**. All
four interior fence paths are byte-identical. Eight of the twelve perimeter
vertices moved, none by more than 2.4 ft, and the enclosed area goes from
**9.532 to 9.568 acres** — about 1,560 sq ft, a third of a percent. It reads
as a redraw tidying the boundary rather than a change of fact.

Small as it is, it should not be applied on its own. Reloading the perimeter
re-cuts all five units, and the acreage fix above changes how a strip's acres
are computed from those units — so both want doing together, once, rather
than moving the numbers under the farm twice in a week. There are also real
grazing events on file now, and their recorded `swept_from`/`swept_to`
fractions are interpreted against whatever the boundary is; changing it
silently re-prices ground already grazed.

### The map's move records the wrong head count

Found while checking the above: the farm has started logging real moves, and
the ones logged from the map carry **4 head and no weight**, while the ones
logged from the board carry the 5 head and 900 lb that were typed in.

The board's form prefills head and weight from the animal records and lets
them be corrected. The map's move takes the derived figures and offers no way
to change them — and there are four animals on file against five head
actually running, so every map-logged move understates the mob.

With no weight it also produces no feed figure at all, which is half the
reason to size a strip.

Smallest honest fix is to carry head and weight onto the one-page move above,
prefilled and editable, as the board already does. Adding the fifth animal to
Herd → Animals fixes the count at its source and is worth doing either way.

**Half fixed 2026-08-13.** Weight is no longer derived from a guess: each
animal carries dated weighings, and the mob's total is the sum of the
members' latest, shown in the page's own header. **Still open:** the head
count. There are four animals on file against five running, so every derived
figure is a fifth light until the fifth animal is added. Move has no override
for head count — it reads the roll — which is the right shape, but it makes
the missing animal the thing to fix.

## Opened 2026-08-14, building the graze-down

- ~~Nothing asks how yesterday's strip actually came off.~~ **Built
  2026-08-14.** One field at the top of the move, because looking at what they
  left is the first thing you do. It writes `residual_height_in_exit` on the
  strip being closed, with the share of the sward worked out from that strip's
  own entry height.
- **A paddock's entry-height target is only a fallback.** `P5` carries 6″ and
  the rest are null. Used when no height is taken that morning, which is the
  right precedence, but it means a stale target can quietly drive a forecast.
  Worth showing more loudly when that is what is happening.

## Opened 2026-08-13, building Move

- ~~The fifth animal.~~ **Unblocked 2026-08-14.** Mercy is on file; the reason
  she was not counted is that `grazing_group_members` had no write path at all.
  Herd → Mobs now has one. The row itself is the farm's to add, because
  `joined_on` is a fact this app does not know.
- **Deferring a unit shut up for hay.** Skipping Paddock 4 works, but its rest
  keeps climbing afterwards and the board sorts it to the top as the best next
  choice — the exact opposite of the intent. `plan_schedule_periods.kind`
  already has `'deferment'` and `plan_paddock_targets.planned_deferment_notes`
  already exists; neither is used.
- **A partial hay cutting has nowhere to go.** `forage_removals` records the
  unit, not which part of it, so cutting a section leaves the rest of the unit
  looking cut. Wants `swept_from`/`swept_to` on the removal.
- **The flat fallback is still the old fraction.** Correct wherever a boundary
  exists, which is everywhere on this farm. Worth knowing it is there before a
  unit is added without one — `stripAcres`, `planStrip` and `widthForHours` all
  fall back to it.

## Requested 2026-08-21

### What a purchased animal cost to buy

An animal bought in has a price, and there is nowhere to type it. Eight of the
twelve animals on file are `origin = 'purchased'` and one of them has a figure
recorded anywhere — put there by hand, in SQL, not by the app.

Her record already has the place to *show* it. What she has cost and earned
reports basis beside the net rather than inside it — "Cost to buy … not an
expense, so not in the net" — because netting a $700 purchase against a
season's milk would say she lost money in the year she was bought and never
again. That line reads `herd.cost_entries` where `is_basis` is true. So the
display end is built and the entry end is missing.

Worth knowing before building:

- **`herd.animals.purchase_price_cents` exists and is inert.** A nullable
  bigint that no page reads, no page writes, and no database function
  mentions. It is not the mechanism the money section uses. Either make it the
  source of truth or drop it, but do not leave a second home for the same
  number — that is what the weight tile was just untangled from.
- **The ledger is the mechanism that already works.** `cost_entries.source`
  allows `'acquisition'`, `expense_categories` has an `acquisition` category
  at `basis_type = 'basis'`, and the one real row on file uses exactly that
  shape. A row per purchased animal, `source = 'acquisition'`, `is_basis`
  true, is the smallest thing that lights up the display that is already
  there.
- **`is_basis` is never set true by the app, and that is a bug on its own.**
  The column defaults to false and `attribute()` inserts without it. So
  attributing an acquisition-category transaction to an animal today books
  her purchase price as an operating cost and subtracts it from her milk —
  the precise arithmetic the money section was designed to avoid. Setting
  `is_basis` from the category's `basis_type` (at insert, or in a trigger, so
  both paths get it) is part of this work, not a separate item.
- **A cost entry needs a date and a farm, and neither is on the animal.**
  There is no `acquired_on` column on `herd.animals`, so the form has to ask
  when she was bought or default it to something defensible. `farm_id` comes
  from the animal.
- The field belongs on `AnimalForm`, which already has an `origin` select with
  `'purchased'` in it, so it can appear when that is what was chosen. It is
  also wanted for animals already on file — eight of them — so editing has to
  reach it too, not just creation.

### ~~An animal with no ear tag has no record page~~ Built 2026-08-21

Victor's record would not open because `/animals/:tag` resolves an animal by
ear tag and his was the empty string, so his link came out as `/animals/`.
Traced to `herd.record_calving`, which took the calf's tag as given and
inserted whatever it got — his row and the calving that made him share a
`created_at` to the microsecond — while the calving forms on Calvings and
Breedings never asked for one.

What was built:

- **Migration 059.** `record_calving` refuses a live calf with a blank tag, a
  tag another animal on that farm already wears, or twins sharing one, all in
  the pre-flight loop so nothing is half-written. Plus a partial unique index
  on `(farm_id, ear_tag)` — per farm, because Martha is tag 1 here and Rocky
  Ridge has its own tag 1, and that has to keep working.
- **`validateCalving` asks for the tag** in both forms. Its `herd` argument is
  required rather than optional on purpose: a validator that skips a check
  when a caller forgets an argument is the hole being closed.
- **`animalPath`** replaces every hand-built `/animals/${…}`, using the tag
  and falling back to the id. That is what makes an already-blank row
  reachable, so Victor can be opened and given a number in the app rather
  than in SQL. The source-reading guard in `animal-links.test.ts` now enforces
  the helper instead of the field, and widening its glob to `.ts` immediately
  turned up a call site in `lib/alerts.ts` the old `.tsx`-only version missed.

Corrected while building: the duplicate half was overstated here. RLS scopes
`herd.animals` to `is_farm_member(farm_id)` and nobody belongs to two farms,
so `.maybeSingle()` was never seeing both tag-1 rows — Martha opened fine. The
duplicate was legal in the schema, not broken in the app. The index closes it
anyway.

Still the farm's to do: Victor has no tag until somebody gives him one, and
the row called "test" on Rocky Ridge looks like it was never meant to stay.

## Raised 2026-08-21 by recording a departure

### The processing and death records

Migration 060 fills in `herd.dispositions` and `herd.disposition_sale_details`
— how she left, when, whether it was a cull and what it was for, and what a
live sale brought. Two detail tables were deliberately left for later, and the
owner chose that split knowing what was in them.

`herd.disposition_processing_details` is the larger of the two and is really a
beef-processing module rather than a few more fields: processor and address,
inspection type, dropoff, kill and pickup dates, hanging weight, days hung,
quality and yield grade, ribeye area, backfat, a cut sheet document, packaged
weight, processing cost, dressing percentage, cutting yield, cost per packaged
pound. Twenty-odd columns, most of which arrive weeks after the animal does.

`herd.disposition_death_details` is small — suspected and confirmed cause,
necropsy performed, findings, a document, disposal method — and is the more
likely of the two to be wanted first.

Worth knowing before building:

- **The processing record arrives in instalments.** Dropoff is known on the
  day, kill and hanging weight a few days later, packaged weight and cost at
  pickup. A form that demands all of it at once will be filled in wrong or not
  at all; this wants the same "record it, correct it later" shape 060 already
  has.
- **`record_disposition` refuses sale figures on a processed animal** because
  migration 058 credits packaged meat back to her when it sells through the
  store. The processing *cost* is a different thing and belongs in
  `cost_entries` against her, not as negative revenue.
- **Cause of death is where a herd-health picture would start**, and Health is
  the module that was deliberately left last. Worth deciding whether this
  small table is part of a disposition or the first piece of that.

### ~~One test fails about once in five full runs, and nobody knows which~~ Found 2026-08-21

`animal-money.render.test.tsx`, and it was never a logic bug. Its `mount`
helper waits for the page's loaded-sentinel with `findByText`, which allows
1000ms by default. `AnimalRecord` waits on a chain of reads before it draws
anything, and with the whole suite running across workers that page
occasionally hadn't got past "Loading…" inside the budget. Given a 5s timeout.

It was caught the moment the output of the failing run was kept instead of
being thrown away — the failure text said the page was still showing
"Loading…", which is the whole answer. Two earlier sightings were lost to
rerunning the suite to look for the name, which starts a fresh run.

**Worth carrying forward:** `npx vitest run > run.log 2>&1`, then read the
log. And any other `findBy*` on a page with a serial chain of reads is the
same accident waiting to happen; the ones in this suite have not been audited.

### ~~The word "she", on an animal who isn't~~ Built 2026-08-21

Victor is a bull calf and his record called him "she" throughout, on a page
that showed `male` two inches above the copy. He also had a milk chart.

`herd.animals.sex` is `CHECK (sex = ANY (ARRAY['female', 'male']))` — two
values, both always present — so `lib/pronouns.ts` is a total function, with
the verb agreement carried on the pronoun so no call site has to think about
it. Threaded through the record page, the money section and the disposition
editor, including their aria-labels. Left alone where the animal is female by
construction: calvings and breedings are about dams, the herd roll covers the
milking string, and the milk section only renders for an animal that gives
milk. Made neutral rather than gendered where no particular animal is in hand
— the mob controls on Animals and Mobs, which apply to steers and bulls too.

The milk chart was a separate bug underneath the same complaint. `isMilked`
was answering two different questions with one predicate: the Animals page
asked "is this animal on the dairy side" for its chips and counts, and the
record page asked "does this animal give milk". `record_calving` copies the
dam's purpose to her calf, so every bull born on the dairy string carries
`purpose = 'dairy'`. Split into `isDairy` (the enterprise — Victor still
counts, because that is where he is kept and fed) and `givesMilk` (dairy,
female, past calfhood).

Two more of the same family turned up while looking:

- `animal-life.ts` compared origin against `"born here"` — with a space, and
  not one of the four values the column allows — so it never matched and every
  home-bred animal's first step read "Bought in". Victor was born on this farm
  in 2022 and his record said he was bought. The test covering it used the
  same invented value, so it passed on a vocabulary nothing has ever had.
- "His services, seasons and due dates are on Breedings" was shown on a bull.
  Only females are bred.

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

- **Economic herd depreciation** — Herd → Depreciation books the largest cost
  of production nobody books. `(replacement − cull) ÷ productive lifetime`,
  with the arithmetic on the page rather than only its answer: at the farm's
  figures, **$371.43 a cow a year and $1.86/cwt at 20,000 lb**.

  Per-cwt divides by *her* milk where there is a year of it and by the farm's
  expected yield where there isn't, and every row says which it used. The
  threshold matters more than it looks: a cow with one week of records would
  give a $/cwt in the hundreds — arithmetically correct and completely
  misleading — so below 90 days it falls back rather than computing.

  **Carrying value declines with time in production, not lactations counted.**
  A cow one day fresh has not lost a year's value, and counting the lactation
  she is standing in would say she had. It floors at cull value, which is what
  makes it a value rather than a straight line to zero — she is worth her cull
  cheque on the day she leaves. Her clock starts at the earlier of her first
  freshening and her first calving, because this herd was entered by hand and
  has each without the other.

  The roll writes dated rows, never a field it overwrites: the history is the
  artifact the accrual-adjusted statements and the lender want, and her record
  shows it with the movement between marks. A hand-entered figure — an
  appraisal, a sale — outranks the roll and is left alone by it.

  **Beef cows are deliberately absent.** Every assumption is a dairy figure —
  a springing heifer, a cull cow, a lifetime in lactations — so marking a beef
  cow with them would invent a number rather than measure one. She can still
  be valued by hand, and the page says so instead of leaving a silent gap.

  Migration 035. Nothing here knows about MACRS, conventions, §179 or §1245
  recapture, and the page says outright that it is not the 4562.

- **Costs and revenue on an animal's page** — her record now carries four
  figures and the rows behind them: revenue, what it costs to run her, the net
  of those two, and — kept apart — what she cost to buy.

  Basis is the one real decision. `cost_entries.is_basis` marks an acquisition
  price, whose category is `basis_type = 'basis'` and goes on no Schedule F
  expense line at all; everything else is money spent on her this year.
  Netting Martha's $700 purchase against her season would say she had a
  terrible year in the year she was bought and a fine one every year after,
  which is an artifact of the arithmetic rather than a fact about the cow. So
  the net is revenue minus operating cost, and what she cost to buy sits
  beside it behind a rule.

  Internal transfers are excluded from every total. Nothing writes one yet —
  `source = 'dam_carryforward'` is what the flag is for — but a total that
  silently double-counts the day something does is worse than one built for it.

  The page says the totals are what was *attributed*, not the whole of every
  bill she appears on, because attribution is deliberately partial: a feed
  bill can be four fifths herd.

- **A bull's record goes back to Sires** — the back link added the same
  morning always said Animals, which from a bull is wrong twice: he is opened
  from Sires, and a catalogue bull is deliberately kept off the Animals list,
  so it pointed at a page he does not appear on. `isSire` is exported from
  `lib/sires.ts` — the same predicate that builds that list — so the way back
  cannot drift from where he is listed. The eyebrow follows it.

- **A way back to Animals from a record** — there genuinely wasn't one. The
  "← back to Animals" link existed only in the loading and not-found states;
  a loaded record offered the wordmark, which routes there but doesn't look
  like a link. An animal's page sits outside `OpsShell`, so it has no nav rail
  to fall back on.

  On a phone the eyebrow beside it now hides rather than truncates. Ellipsis
  kept "Herd · Animals ·" and dropped the name — the only part worth reading —
  and with a back link next to it the trail was duplication twice over.

- **Animals, divided by breed type** — beef and dairy are sections with their
  own headings and counts rather than a filter that shows one side at a time.
  The chips still work; picking one drops the headings, since a single heading
  over a single list labels what the chip just said.

  Read as beef-vs-dairy, not Jersey-vs-Angus: `breeds.species_type` is
  literally the breed's type and `purpose` is the farm's decision about how
  she is run. The grouping predicate is `isMilked`, the same one the chips,
  the counts and the lactation pages use, so a dual-purpose cow appears under
  Dairy on every screen — and her row still reads "dual". Grouping by actual
  breed is a different cut and still open; a cross belongs to two breeds at
  once, which needs an answer first.

- **Catalogue bulls are out of "Profit per head"** — and out of "Head". It was
  a query, not a display: `fetchDashboardData` selected animals without
  `record_type` and filtered on nothing but `farm_id`, so the four AI bulls
  the farm buys straws from were counted as livestock and sat in a ranking of
  which animals earn, where they structurally cannot — a straw is a cost
  against the cow it was used on.

  `herdOnly()` is now generic over the row rather than tied to `RealAnimal`,
  because Today reads a narrower set of columns and still needs that exact
  predicate. One definition, so a catalogue bull can't be livestock on one
  screen and not on another.

  A *resident* bull would still appear, and should: he is an animal the farm
  owns, with real costs. "No sires" and "no reference animals" are different
  rules, and this farm has no resident bulls.

- **A sire's purpose follows his breeds** — asked for directly: *"I don't want
  to maintain a breeds purpose in two places."* Right, and the duplication was
  a day old. `breeds.species_type` and `animals.purpose` already use the same
  three words, so for a bull it derives: all breeds agreeing gives that word,
  breeds that disagree give 'dual'. `set_breed_composition` keeps it in step,
  and the migration backfilled every bull already on file — which moved
  Sunnybrook Patriot and Valor from 'dairy' to 'beef'.

  Females are deliberately excluded. A cow's purpose is a decision about how
  she is run, not a summary of what she is; deriving hers would overwrite that
  decision every time a breed was corrected. Migration 033.

  The species-mismatch warning stays, but only for females — for a bull the
  two facts are now one and there is nothing left to disagree.

- **Attach a service to a calving after the fact** — *"why does vera not show
  her sire."* Because her calving was recorded at 12:21 and Patience's two
  Overalls services were logged at 14:19 and 14:26. `record_calving` takes the
  service by name or falls back to her most recent one *before* the calving;
  at 12:21 there wasn't one, so the link stayed null and the calf got no sire.
  Nothing reached back for the services that arrived later.

  Her record now says so and offers the service the dates fit — 2023-09-26 by
  Overalls, eight days off a Jersey's 279, where the other Overalls service is
  95 days off and not a gestation. Attaching sets the sire on the calving's
  live calves and gives them the breeds they should have inherited.
  Migration 034.

- **Edit a sire** — Herd → Sires has an "edit" beside "change breeds" on each
  bull: name, tag, registration, birth date, purpose and notes. The form is
  read fresh from his row rather than filled from the list, because
  `registration_number` is not among the columns `fetchAnimals` selects — a
  form built from the list would show it blank and write that blank back over
  a real number.

  Purpose is editable here and nowhere else for a reference bull:
  `createReferenceSire` hard-codes `'dairy'` because the column is NOT NULL
  and this herd buys dairy semen. That is a default, not a fact about him, and
  it is the gestation fallback for any calf of his with no breeds on file.

  Sex, class and `record_type` are deliberately not editable. Turning a
  catalogue bull into a resident one would put him in the herd's counts — a
  different decision from fixing a typo, and not one to make by accident.

- **A breed whose species disagrees with the animal** — the breed editor now
  says so. Found because both "Sunnybrook" AI bulls, recorded as dairy, are on
  file as 100% Belted Galloway, a beef breed, and nothing had said a word.
  Those breeds feed every calf's inherited composition and every due date
  computed from it.

  It is a note, not a refusal: a Jersey run as a beef cow is real, and so is a
  terminal beef sire over a dairy herd. Ochre rather than red, and saving is
  still allowed.

- **Breedings is Animals → season → services** — the page was one flat list of
  every service on the farm, which answers "what did we do lately" and nothing
  about any one cow. It is now a cow per row with where she is in her cycle,
  opening to her drawn record and then her seasons, each holding the services
  that were trying for the same calf.

  The drawn timeline moved here from the animal record, where it was a click
  away from all of this. `ReproTimeline` is presentational now — it used to
  fetch its own ten tables, which was right alone on an animal's page and
  wrong the moment this page wanted one per cow.

- **A pregnant check can record the calving with it** — tick "she has since
  calved from this service" and name the calf, either new or already on file.
  Only on a pregnant result, because the other three say she isn't in calf.

  It is deliberately two writes rather than one function. A check is a fact
  and a calving is a fact, and either is worth keeping without the other —
  unlike the halves of an AI service, which are meaningless apart. If the
  calving fails the message says the check landed, so the retry is obvious.

- **Recording a calving that predates a lactation already on file** — the
  error was `lactations_dry_after_fresh`, reported while tying Vera's 2024
  birth to Patience, whose only lactation freshened in 2026. Migration 032.

  Worth keeping: this was three bugs behind one assumption — that the calving
  being recorded is the most recent thing that happened to her. Fixing only
  the reported error would have hit "two open lactations" next, and then a
  2024 lactation numbered after a 2026 one. The untied-calf prompt shipped
  hours earlier is what made historical calvings a normal thing to do, so
  every animal entered before Calvings existed would have hit this.

  A lactation closed because a later freshening bounds it now says so in
  `termination_reason`, and the animal record shows that text. A derived
  dry-off date that looks like a recorded one is the kind of quiet wrong
  answer that is worse than a blank.

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

*Superseded in part, 2026-08-10.* The owner's spec above splits this in two,
and the split is the correction: what was recorded here as one subject is a
tax computation **and** a management one, and only the first was ever in
scope. The recommendation stands for the tax side — line 14 takes a figure
from whoever files, and MACRS, conventions and §1245 recapture stay out of
this app until a CPA has been asked.

Economic herd depreciation is a different animal and the one to build:
`(replacement cost − cull value) ÷ productive lifetime`, which needs none of
the above and is, on a dairy, the largest cost of production nobody books.
Leaving it out is not conservative — it makes the margin read better than it
is. See "Depreciation per cow" above.

## A standing note on verification

Nothing in this app has been driven through a browser by its author while
being built — there's no signed-in session available to the agent. Logic is
unit-tested, pages have render tests, database work is exercised against the
live schema with RLS applied, and layout is measured against the built
stylesheet. None of that is the same as using it. The account-default bug
fixed on 2026-08-07 was found by the owner on a phone, which is the expected
shape of what gets through.
