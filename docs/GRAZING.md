# Grazing management (NRCS CPS 528)

An eight-step module, built one reviewable step at a time. This file is the
running record of what was decided and what is still open.

**All eight steps are built.** Migrations 036–042 are run. The module lives
under Herd:

Grazing is its own section in the rail, between Herd and Store:

| Screen | What it is for |
|---|---|
| **Move** | The morning: the wire, the graze-down, and what they ate |
| **Paddocks** | The board — where every unit stands, and its rest |
| **Mobs** | Who is on the grass, and what they weigh |
| **Rotation** | The season as rounds, and hay off a unit |
| **Pasture map** | The units drawn — and where the wire goes today |
| **Forage balance** | Supply against demand, by unit and period |
| **Monitoring** | Key areas, what was seen there, and the photo series |
| **Plan** | Every threshold the rest of the module compares against |
| **Decisions** | What changed, why, and what came of it |
| **Annual record** | All of it, in the standard's own section order |

**The section carries the `herd` module rather than one of its own.** Grazing
means nothing without livestock, so no business would want one and not the
other; a module of its own would need a `business_type_modules` row *and* a
line in this app's fallback map, either of which could be forgotten, and
forgetting either makes every page here unreachable. `moduleForPath` still
returns `"herd"` for these paths, so route gating is exactly what it was, and
a rental business still sees no Grazing at all.

The board was called "Grazing", which inside a section called Grazing said
nothing. It is **Paddocks** now, page title and all, because that is what it
lists.

Step 9 is conditional and not started: a worksheet-shaped export, only if the
Wisconsin implementation requirements prescribe one. Nothing seen so far
does.

## The strip-grazing redesign

The farm strip-grazes: a wire moved daily, sometimes twice, cutting a fresh
strip out of one of the five semi-permanent units. Widths follow the forage,
so they differ every time, and next pass the wire lands nowhere near where it
landed last pass.

**The model built in 036/038 could not hold that.** It treats a paddock as a
place with a rest clock — right for five fixed units, wrong for a strip. A
strip exists for a day, never recurs, and has no rest of its own. Making each
one a paddock row would mean two hundred rows a season, each grazed once,
each with a meaningless rest figure, and no way to compare passes.

### What made it tractable

A fact about the farm, not about software: **each unit is swept in one fixed
direction.** P1 east to west, P2 west to east, P3 east to west, P4 west to
east, P5 south to north — a serpentine that leaves the mob where the next
unit begins.

With a fixed heading the wire is a single number, and everything follows:

- **Capture is one scalar**, not a drawn polygon. A slider, or two taps.
- **The strip's acres are a fraction of the unit's**, so this works today
  with no coordinates and no map. Geometry is welcome when the KML arrives —
  it makes the map drawable — but it is no longer load-bearing.
- **Rest is a one-dimensional interval query.** Strips from different passes
  overlap however they like, and it does not matter, because the question is
  asked of a *position* rather than of a unit.

An earlier sketch proposed a 2-D grid over the farm for this. The fixed
sweep makes that unnecessary — the grid was over-engineered for what the farm
actually does.

### Decisions worth knowing

**Readiness is measured from the start of the sweep, not the last strip.**
With a fixed heading the mob re-enters where it entered last time, so the
ground that governs readiness is the ground grazed *first* — rested longest.
Measuring from the last strip would hold a unit back for weeks after it was
fit to graze. `readinessDays` does this; the board shows it.

**A unit's ground is bands, not a number.** Boundaries come from where wires
have actually been, so nothing is bucketed onto an arbitrary grid, and a unit
part-grazed shows as part-grazed.

**A move into the same unit is now normal.** 038 refused it. Under strip
grazing it is the daily job, so it is refused only when the strip fails to
advance — which is the case that means a number was mistyped.

**Sizing the strip is the feature.** Acres, feed in hours, density and width
in feet update as the wire moves, with "half a day" and "a day" as one-tap
presets computed from the plan's own figures. Feed reads in hours because a
strip can be half a day.

**The forage assumptions come from the plan.** *(Step 7 closed this; they
were constants in `Grazing.tsx` until then, with a comment saying they
belonged in the plan.)* Intake from the plan's default, utilization from the
paddock's target, standing forage from the availability record covering
today. The readout names the source of each figure inline, and anything still
falling back is labelled "this app's figure" — so a forecast is never
mistaken for a measurement, and nobody has to guess which numbers are theirs.

## What it is for

An EQIP contract with 528 as a scheduled practice. The module has to do three
things at once: work in a pasture on a phone with one hand, produce records a
district conservationist can review, and stay readable long after the
contract closes.

Built against the **June 2025 revision** (NHCP). CPS 528 does not enumerate
required record fields; its Plans and Specifications section requires, at
minimum:

- the client's goals and objectives
- a map of planned management units showing existing supporting
  infrastructure — livestock water, fence, gates
- an inventory of current and planned forage availability by unit: seasonal
  production, species, quality, availability
- current and planned livestock and/or wildlife forage demand
- a feed and forage balance by unit, accounting for distribution, wildlife
  use, quality, seasonal availability and hay production
- a grazing strategy: intensity, timing, duration, frequency
- a contingency plan for episodic events
- monitoring protocols and records

Operation and Maintenance further require documented adaptive-management
decisions, identified key areas / key plants / indicators, and that the
records get used to make changes.

Each of those has its own table in migration 036, rather than everything
being crammed into the move log. The map, the forage balance and the decision
log are first-class.

## Step 2: Log a Move and the paddock board

`Herd → Grazing`. The board lists every unit longest-rested first, so the next
paddock to graze is the top row; occupied units sort last because they are not
candidates. The line above it says where the mob is, how long it has been
there, and at what stocking density.

### Decisions worth knowing

**A move is one database call, not two.** `herd.log_grazing_move()` closes the
open event and opens the next inside one transaction. Doing it from the app
would put a network hop between the two writes, and a failure on the second
leaves the mob *nowhere* — closed out of one paddock and in none. The reverse
order cannot work either: `grazing_events_one_open_per_group` refuses the
arrival while the departure is still open. Same reasoning as `record_breeding`.

**Exit readings belong to the paddock being left.** Residual height and
utilization describe the ground you are shutting the gate on, so the function
takes them for the *outgoing* event. The form only asks for them when there is
somewhere to leave, and says which paddock it means.

**Taking them off pasture is its own verb.** `herd.end_grazing()` closes
without opening, so "where are they now" can honestly answer *nowhere on
pasture* instead of naming a paddock they are not in.

**The board warns and never blocks.** A paddock short of its recovery target
is marked in ochre — "outside plan target", never "non-compliant" — and the
move saves anyway. The plan is the farm's own, and a farmer moving cattle at
seven in the morning has reasons a form does not know.

**Rest has three states, not a number and a null.** Occupied, rested for N
days since a date, or never grazed. A paddock never grazed has no history; it
has not been resting since the beginning of the record.

**Nothing is prefilled that is a measurement.** Head count and average weight
carry over — head from the mob's membership, weight from each animal's most
recent row in `herd.weights`. Forage height never carries over: it is a
reading taken at the gate, and a stale one is worse than a blank.

**Blank rather than invented, throughout.** No weights on file means the
weight field stays empty and stocking density reads nothing, rather than the
page assuming a figure.

## Two rules that run through the whole module

**Nothing asserts compliance.** These tables record what happened; whether it
meets the standard is the conservationist's determination. The words
"compliant" and "meets 528" must not appear in the UI, in a column name, or
in a computed status. The vocabulary is *recorded*, *due*, *target*, *outside
plan target*.

**Every threshold is configured, never constant.** Recovery days, residual
heights, utilization, monitoring cadence — per plan and per paddock. A number
hardcoded in this app would be the app inventing an agronomic recommendation
it has no standing to make. A paddock with no target is shown without one,
not against a default.

## How this differs from the brief as written

The brief describes a stack this repo doesn't have. Worth stating plainly,
because the difference changes what "follow the existing conventions" means:

| The brief says | What is actually here |
|---|---|
| Dexie (IndexedDB) offline-first store, syncing to Supabase | No local store at all. Every read is a direct PostgREST call through `lib/supabase.ts`. |
| Tailwind v4 with a token remap | Plain CSS. Design tokens in `styles/tokens.css`, per-route stylesheets. |
| PWA | No manifest, no service worker. It is a normal SPA on GitHub Pages. |

The brief also says *"do not introduce new ones"*, and those two instructions
pull in opposite directions. Step 1 follows the repo, since a schema is
stack-neutral — and the offline question is now **settled: online only**,
because there is signal at the field. See "Settled: online only" below.

The design-token half of the brief is accurate: the palette, the fonts, and
hazard yellow being reserved for withdrawal are all real. Grazing warnings —
grazed before its recovery target, monitoring overdue — use **ochre**, which
`tokens.css` already designates for shortfalls.

## Step 1: what was built

Migration 036 adds twenty-five tables in the `herd` schema, grouped by the
plan element each one serves:

- **Management units** — `paddocks`, `paddock_forages`,
  `paddock_water_sources`, `holding_areas`
- **The map layer** — `infrastructure`, `map_overlays`
- **The plan** — `grazing_plans`, `plan_resource_concerns`,
  `plan_paddock_targets`, `plan_schedule_periods`, `contingency_plans`
- **The mob** — `grazing_groups`, `grazing_group_members`
- **Feed and forage balance** — `forage_availability`, `forage_demand`,
  `forage_removals`
- **The move log** — `grazing_events`
- **Monitoring** — `key_areas`, `monitoring_records`, `grazing_photos`
- **Adaptive management and its inputs** — `management_decisions`,
  `decision_paddocks`, `decision_groups`, `supplemental_feeding`,
  `soil_tests`

Types for all of it, and the four reads step 2 needs, are in
`app/src/lib/grazing.ts`.

### Decisions worth knowing

**Everything the standard does not name is nullable.** The only NOT NULLs are
identity, ownership, and the two facts a move actually is — which paddock,
and when. If the Wisconsin Implementation Requirements sheet names a field,
tightening it is one ALTER; loosening a field somebody already worked around
is not.

**One open event per mob**, as a partial unique index. This is what lets "log
a move" be a single transaction — arriving somewhere closes wherever you
were — rather than two entries a tired person does half of. Same mechanism as
`lactations_one_open_per_animal`.

**Head count and weight are snapshotted onto the event, not referenced.** The
group's composition changes; what was in that paddock in June must not change
with it.

**Recovery days are split growing/dormant.** One recovery figure across the
whole year is the assumption that gets paddocks hurt.

**The planned schedule is dated rows, not prose.** The standard asks for
grazing periods *and* rest/deferment periods, and the rotation timeline in
step 3 has to draw planned against actual.

**The forage balance replaced carrying capacity, rather than sitting beside
it.** The 2025 revision names the balance as its own deliverable, so
`plan_paddock_targets.carrying_capacity_aum` is gone: one fact in two places
is how the two end up disagreeing. Supply, demand and hay removals are three
tables and the balance is derived from them.

**Both lb DM and AUM are storable, and that is not two units for one
quantity.** Each column is one unit, recorded as entered. Converting needs an
assumption about what an animal unit month is worth in dry matter, and this
app inventing that number quietly is exactly what it must not do.

**Hay removals exist for two reasons.** The standard requires hay production
be carried in the balance — and without it the rotation timeline reads a long
gap as rest when the forage actually left on a wagon.

**A grazing event can carry its own boundary.** A virtual-fence unit is a
different shape each time it is grazed; `grazing_events.boundary_override`
records what was really grazed without redefining the paddock.

**Geometry is GeoJSON in `jsonb`, not PostGIS.** Nothing here does spatial
queries — the app reads a boundary back whole and draws it. An extension
bought for storage alone is a dependency for nothing.

**Water is one thing on the map and a relationship to units.** The tank is a
row in `infrastructure` with its geometry and practice code;
`paddock_water_sources` says which paddocks it waters and when it has water.
A join rather than a column, because a point on a fence line waters the units
on both sides — which is how this farm's seven points are placed.

**Infrastructure carries an existing/planned status.** An EQIP plan map draws
both and tells them apart by colour; without the column a planned gate reads
on the map as a gate that is there.

**The basemap is a georeferenced static image, not a tile service.** Decided
2026-08-12. The original reasoning leaned on it working without signal, and
that reason lapsed when the offline question was settled — but the decision
survives on a better one: **this is the map the plan refers to.** A tile
service shows whatever the imagery is today; the EQIP plan map shows the
field as it was when the plan was written, with the plan's own fence lines
and gates drawn on it. When a conservationist reviews the annual record, the
map in it should be the one they already have on file. A live basemap would
also be a running dependency bought for zoom this map does not need. `map_overlays` holds the image with a WGS84 bounding box and its
pixel size — enough to place a boundary on a north-up aerial — with
`rotation_deg` for one that isn't north-up and `control_points` for one a box
cannot place at all. The source credit and imagery date travel with it,
because a map in an exported record should say where it came from and when it
was flown.

**Derived, never stored:** occupancy days, animal-days, stocking density,
AUM consumed, rest days since last exit, grazing days per season, animal
units. All are functions of the rows and would go stale the moment one is
edited. Their implementations arrive with step 2.

**Nothing cascades from a plan.** Marking a plan inactive hides nothing and
deletes nothing; prior years stay queryable. There is no DELETE policy on any
of the twenty-five tables — removal is `deleted_at`, the schema-wide convention.

### Rehearsal

Applied inside a rolled-back transaction, with the write path exercised as
the farmer under a real `authenticated` role:

```
01 tables created (want 24)                24
02 rls enabled (want 24)                   24
03 policies (want 72, 0 delete)            72 total, 0 delete
04 carrying_capacity_aum gone              yes
05 paddock, mob and plan                   ok
06 event carries its own boundary          ok
07 infrastructure rows                     2
08 supply, demand and a hay cutting        ok
09 June balance, lb DM                     8668
10 availability with no figure refused     ok
11 period ending before it starts refused  ok
12 unknown unit type refused               ok
13 unknown infrastructure kind refused     ok
14 foreign farm infrastructure refused     RLS
15 second open event refused               one open per mob
```

The balance in step 09 checks out by hand: 2,400 lb DM/acre over 8 grazable
acres is 19,200, less 3,432 for four cows at 1,100 lb eating 2.6% of body
weight for 30 days, less 900 for deer, less a 6,200 lb hay cutting — 8,668.
That is the derivation the balance screen will do, exercised against the
real schema before any of it is written.

## Still needed, and what it blocks

Two things from the brief's own "before you run this", both still open:

1. **The Wisconsin 528 Implementation Requirements sheet and the grazing plan
   worksheet**, from the district conservationist.

   *Settled 2026-08-12: assume Wisconsin FOTG is on the June 2025 national
   revision.* The owner's call, and the schema is built on it. If that turns
   out to be wrong, the consequence is bounded and known — the
   carrying-capacity figure removed from `plan_paddock_targets` comes back,
   and the feed-and-forage balance is more than the state asks for rather
   than wrong.

   The IR sheet is what a state office actually holds you to and may name
   documentation items that should be required rather than optional.
   Everything is optional today, so the sheet can only tighten — but if it
   prescribes a worksheet layout, that becomes a ninth build step.

2. **The real paddock list, acreage, boundaries, and current plan targets.**
   Seed data was deliberately not written. Placeholder paddocks would be
   worse than an empty table: they are the kind of thing that survives to a
   review.

   The EQIP plan map arrived on 2026-08-12 as a static image, and it settles
   the *approach* without settling the *data*.

   **The legend, as given by the owner** — the image's own is cropped at the
   right edge:

   | On the map | Means |
   |---|---|
   | Red dashed | Perimeter fencing |
   | White dashed | Interior fencing |
   | Coloured circles | Gates |

   So the map reads as: a perimeter along County Hwy NN, three interior
   cross-fences labelled 410 ft, 372 ft and 417 ft, a north–south interior
   segment of 401 ft joining the top and bottom ones, two gates on that
   segment at the 372 ft and 417 ft junctions, and three more gates on the
   east side.

   That corrects an earlier guess in this file: the coloured pins are gates,
   **not** watering facilities.

   **No livestock water appears on this map** — no tank, no well, no
   pipeline, no water gap — although the 2025 standard names livestock water
   among the infrastructure the unit map has to show.

   *Answered 2026-08-13: there are **seven water points along the interior
   fence**.* So the water exists and is simply not on this drawing. Worth
   mentioning to the conservationist, since the map on file is missing an
   element the standard asks it to show — but it is a drawing gap, not a
   resource gap.

   *Closed 2026-08-13: the owner does not want water or gates mapped, and the
   app does not draw them.* The gap was raised twice and the answer is the
   same both times, so it stops being an open item here. What the farm shows
   a conservationist is between the farm and the conservationist; this app
   records what it is told and asserts nothing about compliance either way.

   That answer changed the schema. Water on a fence line serves the units on
   **both** sides, and `paddock_water_sources` could not say so: it listed
   sources per paddock, independently of the map. It is now the join between
   a paddock and the `infrastructure` row that is the tank — one tank, two
   rows, one per unit it waters. The alternative was two tables describing
   the same tank, which is the one-fact-in-two-places trap this project has
   now walked into three times and caught three times.

   `infrastructure.status` distinguishes existing from planned, because the
   map draws both by colour and a planned gate must not read as a gate that
   is there.

   What the image cannot give: it cannot be georeferenced without
   coordinates — a scale bar fixes distance, not position. Still needed:

   - the **KML/KMZ or shapefile** behind the map, if NRCS produced it
     digitally. That carries real coordinates, and acreage per unit can then
     be computed rather than estimated. `paddocks.boundary` takes GeoJSON
     as-is.
   - failing that, **two known points** on the image — a fence corner, a gate
     — with latitude and longitude, which is enough to fill the bounding box.
   - **acreage per unit** — see "What acreage per unit means" below.

   *All three settled 2026-08-13: the farm produced its own KML, and 040
   loaded real boundaries and measured acreage from it. The water-point
   questions below lapsed with the decision not to map water.*
   - *Naming settled 2026-08-13:* the owner has no established names, so
     **Paddock 1 through 5, numbered north to south**, codes `P1`–`P5`. The
     plan map is drawn north-up, so the numbers read down the page and a
     conservationist holding the map can follow the app without a key.
     Renaming later is one edit and breaks nothing — moves reference the
     paddock's id, not its name.

## The farm, as known so far

Recorded as the owner gives it, because seed data should be real:

| | |
|---|---|
| Management units | **Five paddocks**, which can be split further as needed |
| Water | **Seven points along the interior fence** |
| Livestock | **Five head** |
| Field | One field on County Hwy NN; perimeter fenced, four interior fences |

Acreage and boundaries are now measured rather than estimated — see below.
Still missing: plan targets. Water point and gate locations are settled as
*not wanted* — see "Water points and gates are not being mapped".

### The KML settles the boundaries

*Received 2026-08-13, loaded by 040.* A Google Earth export of the perimeter
and the four interior fences. Two things make it trustworthy rather than
merely present:

- The drawn perimeter measures **9.532 acres** against the **9.55** given from
  memory — 0.2% apart, from an independent source.
- The four fences divide that perimeter into **five regions that sum to the
  whole with nothing left over**, which is what proves the division is
  complete rather than merely plausible.

| Unit | Where | Acres | Sweep | Along |
|---|---|---|---|---|
| Paddock 1 | North band, full width | 2.003 | east to west | 533 ft |
| Paddock 2 | Upper middle, west of the vertical fence | 1.930 | west to east | 419 ft |
| Paddock 3 | Lower middle, west of the vertical fence | 1.970 | east to west | 424 ft |
| Paddock 4 | South band, full width | 2.255 | west to east | 606 ft |
| Paddock 5 | East lobe | 1.375 | south to north | 405 ft |

**The numbering was derived, then confirmed.** The five sweep headings given
in 039 fit the drawn shape exactly one way: each unit's sweep ends on the
corner where the next one begins, and Paddock 5 delivers the mob back to the
east end of Paddock 1, so the serpentine closes on itself with no dead legs.
Any other assignment leaves a handoff crossing a fence at a point with no
gate. That is strong evidence but not proof — gates are not in the KML — so
it was put to the farmer and confirmed against the ground before loading.

**Why the flat 1.91 was worse than it looked.** A strip's acreage is a
fraction of its unit's acreage, so a single figure for all five understated
the 2.255-acre south band by 15% and overstated the 1.375-acre east lobe by
39% on every strip the app has ever sized. The units differ by 64% end to
end.

It also fills `sweep_length_ft`, which had been blank: a day's strip is a wire
moved about 21 ft on the east lobe and about 8 ft on the south band, because
one is cut along its short axis and the other across its long one.

The file carries no `Point` placemarks, so the seven water points and the
gates have no geometry. That is now the settled end state rather than a gap —
see below.

### Splitting a paddock: two different things

"Can be split further as needed" has two shapes in this schema, and which one
is right depends on the rest clock rather than on the wire:

- **A split that persists and earns its own rest** — a paddock permanently
  halved with poly-wire for the season — is **its own `paddocks` row**, with
  `unit_type = 'temporary'`. It accumulates rest days of its own, gets its own
  targets, and appears on the board as a unit.
- **A strip within a single grazing** — a wire moved across a paddock over
  three days — is **one grazing event** on the parent paddock, carrying
  `swept_from`/`swept_to` and optionally `grazed_shape`. (039 renamed
  `boundary_override` to `grazed_shape`, since under strip grazing a
  per-grazing shape is the norm rather than an override of anything.)

Getting this wrong is not cosmetic. Model a moving wire as five paddocks and
each shows a full rest period it never had; model a season-long division as
one paddock and the rest clock is wrong for both halves.

### Head count and weight both derive from the animal records

*Decided 2026-08-13.* The animal records are the source of truth for how many
head there are. `head_count_manual` stays on `grazing_groups` as an override,
but it is not the intended path — the fifth animal wants adding to Herd →
Animals, and then the group is right by construction.

**Weight goes in `herd.weights`, which already exists and is empty.** Columns
`animal_id, date, weight_lb, weight_type, contemporary_group, notes`, with
RLS already in place. No new column, and the gain over a single field on the
animal is that weight is *dated*: a heifer at 900 lb in April and 1,050 in
September is two rows, and a move logged in April uses the April figure.

A group's average weight is then the mean of its members' most recent
weights, with `avg_weight_lb_manual` as the override. Both figures on a
`grazing_event` are still snapshotted at the moment of the move, so
back-filling a weight later never rewrites what was recorded at the gate.

### Which pasture an animal is in, without a second answer

*Decided 2026-08-13.* Derived, not stored: **animal → her group →
that group's open grazing event → paddock.** `grazing_group_members` carries
`joined_on` / `left_on`, so moving an animal between mobs is dated history
and "where was she in July" is answerable.

Adding a paddock field to the animal would give the question two answers that
can disagree, which is the trap this schema has now avoided three times.

To run animals in different pastures, run more than one group — a group of
one is legitimate, and is the right shape for a cow held back on her own.
With five head that will usually be one mob, and the model does not change
when it isn't.

Worth noting so nobody wires it up twice: `herd.locations` and
`herd.animal_location_history` exist and are empty. They are a general "where
is this animal" idea — barn, lot, pen — not grazing units. Paddocks must not
also be written into `locations`.

### What "acreage per unit" means, and why it is asked for

Two numbers for each of the five paddocks:

- **Measured acres** — everything inside its fences.
- **Grazable acres** — what the cattle can actually eat off. The wooded edge,
  a wet corner, a lane, a rock outcrop are inside the fence and are not
  forage.

Everything per-acre divides by the second one: stocking density in pounds of
live weight per acre, forage supply in the balance, and the AUM figures on
the annual record. A paddock carried at its measured acres reads as more
feed than it has.

From the plan map's own dimensions, the block between the 410 ft and 417 ft
cross-fences, bounded east by the 401 ft segment, is roughly
`((410 + 417) / 2) × 401 = 165,800 sq ft`, about **3.8 acres** — so the two
units inside it are about 1.9 acres each. That is arithmetic off a drawing,
offered only as a sanity check against the real figures; the three remaining
units cannot be sized without the perimeter dimensions.

### Water points and gates are not being mapped

*Decided 2026-08-13, by the owner, after the KML arrived without them.*

The question had been how to capture fourteen coordinates without typos —
typing them is error-prone and the errors are silent, since a digit wrong
puts a tank in the next county and nothing complains. The answer turned out
to be that the farm does not want them captured at all.

That is a reasonable call on a 9.5-acre field. Water sits along one interior
fence line, every unit touches it, and nobody walking this farm needs a
drawing to find a tank. Mapping water earns its keep when units are far
apart and the question "does this paddock have water" has a non-obvious
answer. Here it does not.

**The seven rows stay, without geometry.** They record that water exists and
that it serves both sides of the fence it sits on — which is the part that
feeds the forage balance and the unit board. Only the coordinates are
declined, and `infrastructure.geometry` is nullable exactly so that is
possible.

This simplifies step 4. The unit map draws boundaries and fences, both of
which now have real geometry, and needs no point-placement affordance at
all — no tap-to-place, no drag-to-correct, no "is this the right tank"
confirmation. That was the fiddliest part of the screen and it is gone.

Worth recording rather than leaving as a silent absence: a future reader
finding seven water rows with null geometry should know that is a decision,
not an unfinished import. Reversing it is cheap — the rows are there, and
locations can be filled in later from any source.

## Settled: online only, for now

**Decided 2026-08-12. There is usually cell signal at the field.**

That fact is what settles it. The brief asks for full offline capture with
background sync, and the case for it rested entirely on moves being logged
where there is no signal. There is signal, so the module is built the way the
rest of the app is built: every screen reads from Supabase when it opens.

Worth having written down, because "add offline later" is easy to say and the
shape of the work is not obvious. **A write queue on its own would not have
worked.** With no signal there are three separate failures, and the first is
the one that gets forgotten:

1. The page does not load at all. The HTML and JavaScript come from GitHub
   Pages over the network; with no bars you get the browser's error page, not
   the app.
2. If the app were already open, the move form has no paddock list, because
   that lives on the server.
3. Saving fails.

So offline would have meant a **service worker** (serving the app's own files
from the phone) and a **manifest** (so it installs to the home screen rather
than being a bookmark) *before* any question of queuing a write. That is what
the brief meant by "PWA", and this app is not one.

If signal turns out worse than expected, the path back is:

- **Field-capable** — service worker and manifest so the app boots offline,
  with paddocks, groups and recent moves cached and moves queued on the phone
  until signal returns. Days of work, bounded, and the only part of the app
  that would change is the field-facing part.
- **Full mirror** — Dexie, every table local, background sync everywhere.
  Weeks, plus a tail: once one module reads from a local mirror, every future
  feature has to decide whether it does too, or the app has two data-access
  patterns forever. Sync conflicts need rules that nothing here has today.

**Nothing in step 2 forecloses either.** The move form writes through one
function; putting a queue behind that function later does not mean rebuilding
the screen.

### The mitigation that makes online-only workable

The move form takes an **editable timestamp**, so a move made at the gate can
be recorded accurately from the house an hour later. This is not a
consolation prize — it is what the schema already allows, and it is why a
missed capture is a nuisance rather than a lost record.

### Target device

**iPhone.** Two consequences for every screen in this module: text inputs
stay at 16px or Safari zooms the page on focus (already the convention in
this repo — see `sign-in.css`), and if offline is ever revisited, install and
offline support on iOS is Safari-only and weaker than Android, so it would
want a real test in the pasture before either party believes it.

## Build order

1. **Schema + types** — built. Migration 036.
2. **Log a Move + paddock board** — built, then rebuilt for strip grazing (039).
3. **Rotation timeline + hay/forage removal entry** — built. See below.
4. **Unit map + infrastructure layer** — built. See below.
5. **Feed and forage balance** — built. See below.
6. **Monitoring + key areas + photo points** — built. Migration 041.
7. **Plan editor + contingency triggers + decision log** — built. Migration 042.
8. **Exports** — built: the annual record in the standard's section order, and
   CSV of events, forage, monitoring and decisions.
9. *(conditional)* A worksheet-shaped export, if the IR sheet prescribes one.
   **Not started** — nothing seen so far prescribes one.

## Step 3: the rotation as rounds, and hay

*Built 2026-08-13. No migration — `forage_removals` came with 036, and RLS on
it was checked from an `authenticated` session rather than the SQL editor.*

### The timeline is not a chart of days

A season laid out day by day is the obvious shape and the wrong one, for two
reasons that both point the same way.

At strip-grazing resolution **one stay is a fortnight of daily wire moves**. A
chart fine enough to show a single strip is far wider than the phone this is
read on: a 210-day season across 350 px is 1.7 px a day. Scrolling sideways
through a Gantt chart on an iPhone at the gate is not a thing anybody will do
twice.

And it answers a question nobody asks. The grazier's question is not "what
happened on 14 July" — it is **"how many times have we been round, and had
that paddock recovered when we walked back in"**.

So the unit of the timeline is the **round**: one trip through the farm. It
falls straight out of the serpentine, it compresses a fortnight of strips into
one line, and it puts the figure that matters — rest before re-entry — in a
column of its own.

A round ends **when the mob walks into a unit it has already had this round**.
That definition needs no notion of the correct order, so it survives a unit
skipped for wet ground or taken out of turn. A hardcoded serpentine would call
that a broken rotation; this calls it a round with four units in it.

### Two things a stay is, and one it is not

`staysFrom` collapses consecutive events in one unit into a stay, so fourteen
wire moves report as one visit rather than fourteen. Same unit is **not enough
on its own** — they have to be contiguous in time as well. `log_grazing_move`
closes the open event at the very instant it opens the next, so strips inside
a stay share a boundary exactly; an hour of slack absorbs a hand-edited
timestamp. A unit grazed in June and again in August is two visits with two
rests, and merging those on the paddock id alone would erase the rest between
them — which is the one figure the page exists to show.

Rest before entry is computed from what was known *by then*: the stay's own
events are excluded **by id, not by date**, because an open event has no exit
and a date-only filter sweeps it into its own history and reports a rest of
zero.

### Hay: the bug this step really fixes

`forage_removals` existed from the start and nothing read it. That was not a
missing feature, it was the app **giving wrong advice with confidence**.

Forage that left on a hay wagon left the paddock as bare as forage a cow ate.
Rest measured from the last *grazing* would tell somebody a unit mown three
days ago had been resting since June — and the board sorts by rest, so that
unit would be sitting at the top of the list recommending itself.

The fix is `lastDefoliatedAt`, which is what rest now counts from:

- **A cutting covers the whole unit**, because nobody mows a strip — the
  machine goes over the lot. So it beats every position at once and is not
  simply another interval in the same list. On the board a cut unit's bands go
  flat, which is the honest picture.
- It **resets readiness outright**. The argument for measuring from the start
  of the sweep is an argument about where the *cattle* re-enter; a mower does
  not re-enter anywhere, so after it has been through there is no rested end
  to come back to.
- A cutting is stamped at end of day, so a unit cut and grazed on the same
  date reads as grazed after cutting — the order those two things happen in.

**`lastGrazedAt` is kept, not replaced.** The board legitimately wants both:
"rested 12 days" and "last grazed 3 June" are different facts about the same
paddock, and a cutting in between makes them differ by a month. Collapsing
them would leave the date column unable to answer either question. The board
now shows `cut 1 Jul` beside the acreage, because without it the rest figure
looks wrong to anyone who remembers when the cattle were last on it.

### Where hay is entered, and why not on the board

On Rotation, not on the board. The board is for the daily act; a cutting is an
occasional one, and it belongs where the record it changes lives. Yield
carries **weighed or estimated** — a scale ticket and a guess off the back of
the wagon are not the same evidence, and the forage balance in step 5 should
not be forced to treat them alike.

Cuttings are shown against the round they fell in, since the reason to show
them at all is that they explain a rest figure that would otherwise look
wrong. The first round's window runs back to the start of the record and the
last one's runs to now, so **every cutting lands in exactly one round** and
none is silently dropped; a farm that has cut but never turned out still sees
its cuttings listed.

## Steps 4 to 8

### Step 4: the map is drawn, not photographed

There is no basemap. The boundaries and fences came from the owner's own KML
(040), water and gates are settled as not mapped, and what is left is a plan
in ink — which is what the standard asks for and what the rest of this app
already looks like.

`lib/pasture-map.ts` is deliberately planar. Over 600 ft at 42.9° N a local
equirectangular projection is accurate to well under a tenth of an acre, and
the alternative is a projection library for a field you can see across. The
one correction that matters is **cos(lat) on the east–west axis** — without
it the farm renders 27% too wide at this latitude, which is visible. Height
comes from the farm's own proportions rather than being passed in: forcing a
shape into the wrong aspect is how a map starts lying about distance.

**The strip model pays off here.** A strip was recorded as two fractions
along a fixed heading, with no coordinates at all — and because the heading
is fixed, that is enough to clip the real polygon and draw exactly the ground
the mob has had this pass. The slice is Sutherland–Hodgman against two
half-planes; no geometry library, and it is checked by area.

GeoJSON arrives from `jsonb` as `unknown` and is parsed defensively rather
than cast, so a malformed boundary costs one paddock and not the page.

**The map also logs the move**, which is the reason to open it rather than
the board. On the board the wire is a percentage; here it is a line across
the shape of your ground, at the place you are looking at. The record is
identical either way — `swept_from` and `swept_to` — but *"there, by the
corner"* is how somebody standing at a gate actually decides, and a slider
cannot ask that question.

Selecting a unit sets the wire to a day's width rather than jumping it to
wherever the selecting tap landed, which would be startling. After that a tap
or a drag anywhere in the unit moves it. One handler covers both: a tap is a
drag of length zero.

The finger becomes a fraction by the bounding rect rather than
`getScreenCTM` — the viewBox fills the element exactly, since the height is
computed from the farm's own proportions, so there is no letterboxing to
account for. A tap outside the boundary clamps to the nearest sensible place
instead of failing, because most taps at a gate are a little off. And the
wire only ever advances: a tap behind the back fence is refused rather than
recorded, the same rule `log_grazing_move` enforces in the database.

`touch-action: none` goes on the SVG **only while a unit is selected**, or
the page could not be scrolled on a phone.

### Step 5: the balance never converts pounds to AUM

They look like two units for one quantity and they are not. Turning an AUM
into pounds needs an assumption about what an animal unit eats in a month;
an app that made it quietly would put a number in a conservationist's hands
that nobody chose. Each is carried as entered, netted only against its own
kind, and a balance that cannot be struck says **"that conversion is yours
to make, not this app's"**.

Windows net **exactly** and are never apportioned. Splitting a June figure
across two half-June windows assumes growth is even through the month, which
is precisely what a grazier would dispute. Mismatched windows show as their
own lines with the gap named.

What is missing is named rather than treated as zero, and the classification
turns on whether a row was *entered*, not whether a figure came out of it —
a demand row with head but no weight is a row somebody did not finish, and
telling them nothing was recorded would send them to add a second one.

### Step 6: due, never overdue

There is no default cadence anywhere in the code. A farm with no plan gets
silence rather than a number this app invented and somebody would then have
to argue with. "Never looked at" is kept apart from "due": there is no
interval to be late against until there has been a first look.

A photo point needs a **spot and a bearing**. Without both, successive
photographs are just pictures of grass — no telling a change in the sward
from a change in where somebody stood.

Migration 041 adds the first Storage bucket this app has used, and it is
private. **Tenancy lives in the object path** because `storage.objects` has
no farm column for RLS to attach to: the first path segment is the farm id,
the policies compare it against membership, and the path is therefore
generated from the caller's own farm id rather than from a filename.

### Step 7: the plan is superseded, never rewritten

Both plan writes are RPCs because they upsert against **partial** unique
indexes, which PostgREST cannot infer for `on_conflict` — the lesson from
011. It is also the only place the one-active-plan rule can hold atomically.

A plan you can quietly rewrite is not one a reviewer can rely on, so starting
a new one stands the old one down and leaves its targets, concerns and
decisions exactly where they are.

The decision log keeps **what you saw, what it meant, and what you did** as
three fields. Collapsed into one note they become a story written afterwards,
which is what the log exists to replace.

**The strip readout now reads the plan**, closing a promise the code carried
since step 2. Intake from the plan, utilization from the paddock's target,
standing forage from the availability record — and the readout names the
source of each figure, labelling anything still falling back as "this app's
figure".

### Step 8: a missing section is information

The annual record follows CPS 528's own Plans and Specifications order, and
a section with nothing in it **says so** rather than being dropped. Silently
omitting it would leave a reader to guess whether the farm has no contingency
plan or the app forgot to print one, and those are very different things.

It prints: the `@media print` rules drop the nav and the buttons, so "save as
PDF" gives the document rather than a screenshot of an app.

The CSVs neutralise **formula injection**. These files are opened in Excel
and Sheets, where a field beginning `=`, `+`, `-`, `@` or a tab is run as a
formula — so a pasted note could execute on open. A leading apostrophe fixes
it and is stripped on display. The BOM is not decoration either: without it
Excel on Windows reads UTF-8 as the local code page and every ° and ″ in a
monitoring record turns to mojibake.

## Move: the morning, on one page

The board and the map both logged a move, one with a percentage slider and
one with a tap on a drawing. Same record either way — `swept_from` and
`swept_to` — so the farm had to remember which screen it had chosen. **Herd →
Move** is the one place now. Nothing is picked that does not have to be: the
mob, the paddock and the back line all come out of the open grazing event,
because the back line is simply where yesterday's wire ended.

Grass height sits **above** the wire, because it feeds it. A reading there,
times the plan's `lb_dm_per_acre_inch` (300 for this farm), outranks whatever
the availability table last said — a number taken on the ground this morning
beats one typed in April. Without a reading it falls back, and the assumptions
line always says which source it used.

### The back line is settable, and always was

Ordinarily it looks after itself. But a unit cut for hay, or a section left
standing, needs it moved — the farm's own example: running the mob through
Paddock 3, deciding to cut Paddock 4, and wanting the back line set to the
start of Paddock 5.

`log_grazing_move` has allowed this from the beginning; it only ever refused
going *backwards* over ground already taken. Both skips were verified against
the live database before any UI was written. So this was a UI-only change —
the app had been deriving a value the database was happy to be told.

### Weight is per animal, and added up

`herd.record_weight` writes a dated row, upserting on (animal, date) so a
correction on the day replaces rather than duplicates. The animal record grows
a Weight section; the mob's total is the **sum of the members' latest
weights**, never a head count times an average, and the page says how many are
unweighed rather than quietly totalling some of them.

`weight_type` defaults to `adhoc` — the check constraint allows
birth/weaning/yearling/sale/processing_live/adhoc, and `scale` is not among
them.

### The acreage bug the redraw exposed

`stripAcres` used to take the strip's acres as its fraction of the sweep times
the unit's acres. That assumes area spreads evenly along the sweep, which is
true of a rectangle and of nothing else. Measured against the real boundaries:

| Unit | Worst error |
|---|---|
| Paddock 1 | 24% |
| Paddock 4, last tenth | **94%** — it tapers to a corner |
| Paddocks 2, 3 | small; they are near-rectangular |

Which is why nothing looked wrong. It fed hours of feed, stock density and the
forage balance. It now measures off the drawn boundary via `drawnSliceAcres`
and falls back to the fraction only when there is no boundary or no sweep.

**The first pass fixed only half of it.** `stripAcres` answers what a recorded
strip *was*; `planStrip` answers what the one being placed *would be*. Only the
first was corrected, and the second is the number on screen while the wire is
being dragged — the more consequential of the two. Measured a day's width at a
time along each unit:

| Unit | Flat forecast against the drawn slice |
|---|---|
| Paddocks 2, 3 | ±1% through the middle |
| Paddock 1 | +58% at the start |
| Paddock 5 | −16% to +22%, end to end |
| **Paddock 4, last sixteenth** | **+1,505%** |

Sixteen times the feed, at the end that tapers. Both measure the boundary now,
and they are checked against each other rather than each being checked alone —
the two answers have to agree, because they are the same question asked before
and after.

`widthForHours` had the same assumption running backwards, and it is what
places the "half a day" and "a day" presets. A width that feeds them for a day
depends on **where along the sweep it starts** — the same tenth of Paddock 4 is
a fifth of an acre at the wide end and a twentieth at the point — so it takes a
`from` and solves geometrically. There is no closed form for the inverse of a
polygon clip, so `sweepToForAcres` bisects: slice area only grows as the wire
advances, which is all bisection needs, and twenty passes land inside a
millionth of the sweep. "A day" now reads 24.0 hours from anywhere in any unit,
and the width varies with the ground — 41 ft at the head of Paddock 4, 25 ft at
its middle.

"Half a day" is its own figure rather than half the day's width, for the same
reason: half the ground is not half the distance.

### A capped drawing has to have its gutters taken off

The farm is a tall shape, so a drawing sized by its own proportions ran 1,355
px down a 1,280 px screen and took the acres with it — you dragged the wire
and the number you were dragging it *for* was off the bottom. The map is
capped now, which means it is letterboxed, which means a touch is no longer a
plain ratio of the box.

`viewBoxPoint` takes the gutters off. Nothing about this looks wrong when it
is missed; the wire just lands somewhere other than the finger. Font sizes and
the grab handle are in viewBox units too, so the page measures the drawing and
publishes `--pm-unit` — viewBox units per screen pixel — for the stylesheet to
divide back out. Without it the paddock names came out at nine pixels on a
desktop and twenty-seven on a tablet.

Above 1,000 px the drawing and the readings sit side by side. That is not
decoration: the whole premise is dragging the wire and watching the acres
change, and on a phone `56vh` keeps both in view for the same reason.

## The graze-down replaces the utilization percentage

The farm's own words: "we can't assume the cows are eating all of the grass
available. I want to be able to set the average height in a paddock and the
height I want them to eat to."

That is the right model and it was not the one the app had. The app took a
height, turned it into pounds standing, and then discounted it by a
**utilization percentage** — a number nobody on a farm sets, measures, or
particularly believes, and which was sitting on this farm's app-supplied
default of 50% because no paddock had ever been given one. A grazier sets a
graze-down: in at eight inches, off at four. What comes off is the difference.

    usable lb DM/acre = (entry height − graze-down) × lb per acre-inch

### Utilization becomes an outcome, which is what makes it safe

Nothing downstream changed, and that is deliberate. Rather than adding a
second way to compute usable forage, `assumptionsFor` *derives* the
percentage from the two heights:

    utilization = (entry − residual) ÷ entry

Feed that back in place of the typed figure and the arithmetic already in the
app — standing × utilization — lands on exactly the expression above.
`planStrip`, `widthForHours`, `openingWire` and the forage balance are all
correct without knowing any of this exists.

The failure this shape rules out is the quiet one: applying the graze-down
**and** the percentage and halving the feed twice. There is no second path for
them to disagree on, and a test asserts the case directly — a paddock carrying
both an 8″→4″ graze-down and a 50% target still puts 1,200 lb an acre on
offer, not 600.

### Where the height comes from

Most specific first, the same order as every other configured figure in the
module:

| | |
|---|---|
| Typed on the Move screen | this move only |
| `plan_paddock_targets.target_residual_height_in` | this paddock |
| `grazing_plans.target_residual_height_in` | the farm — **new in 045** |
| Nothing set | falls back to a utilization percentage, labelled as such |

The per-paddock column has been in the schema since 038 and the Plan page has
always edited it. All five of this farm's were null, which is why nothing had
ever used it. What was missing was the farm-wide default, so the per-paddock
figure can stay an exception rather than five copies of one number.

The Move screen shows the figure standing in as the field's **placeholder**,
so the number in use is never invisible.

### A graze-down at or above the grass is ignored

Nothing to take. Left alone it would give a utilization of zero or less and a
strip of infinite width, which is the sort of arithmetic that gets a paddock
ruined. It falls back to the percentage and says so.

### What was recorded, and what was measured

The first version of this wrote the strip's *intended* utilization through
`logMove`, which was wrong twice over, and the mistake is worth keeping
written down.

`log_grazing_move` sets `residual_height_in_exit` and `utilization_pct` on the
event it **closes**, then inserts the new one. So those two arguments are
never about the strip being opened — they are about the ground the mob is
standing on and is about to leave. Sending a forecast through them filed it
against the wrong strip *and* recorded an intention as a measurement.

The test written alongside it asserted `utilizationPct === 75` and passed,
because it checked the value handed to the function without checking where the
function puts it. A test that pins an argument is not testing behaviour.

**What goes in now, and only this:** the height the mob actually took that
strip down to, typed on the next morning's move — which is exactly where the
farmer is standing to see it. `utilization_pct` is worked out from *that
strip's own* entry height, never this morning's reading of the ground ahead.
The forecast for the new strip is not recorded anywhere, because a forecast is
not a fact.

If the residual read is at or above the height they went in on, the height is
still recorded — it is what was seen — but no share of the sward is derived
from it. That is not a graze.

`forageEatenLbDm` prefers a measured residual over the percentage wherever one
exists. It appears in the events CSV as "Dry matter eaten (lb)", blank rather
than zero where the record cannot support a figure.

### The farm's own numbers, which were not actually in the database

Setting the graze-down default to 6″ turned up that the active plan
("August 2026") had **no `lb_dm_per_acre_inch` at all** — the farm's stated 300
had been built for and never stored, so every height reading was falling back
to this app's 2,400 lb/acre standing. The 300 seen in an earlier check was a
write made inside the verification transaction that then rolled back, which is
a good argument for verifying against committed state rather than the tail of
your own test.

All three are set now: 3% intake, 300 lb an acre-inch, 6″ graze-down. The farm
sets them once on the Plan page and every screen reads them from there; the
Move screen shows the graze-down as its field's placeholder so it does not
have to be typed each morning.

Nothing in the code carries a default for these. 3% is the farm's figure
stored on the plan, not a constant — the fallbacks still exist and are still
labelled "this app's figure", and they now go unused. That distinction is the
whole point of `AssumptionSources`: a farm that has said nothing should be
able to see that the app is guessing on its behalf.

Because `save_grazing_plan` writes the whole row, anything the plan editor
fails to prefill would be written back as null — losing a figure to a rename,
silently, with the app carrying on against its own fallback. A test now edits
only the name and asserts all three survive.

## The fence between Paddock 4 and Paddock 5

The owner marked the line on a screenshot: the P4/P5 boundary was in the wrong
place and should run from the junction where P3, P5 and P4 meet down to P4's
north-east corner.

**What was wrong.** 040 cut the five units out of the perimeter with straight
lines, and the line dividing P3/P5 from P4 was one horizontal at latitude
42.87722457. West of P5 that is the fence. East of P3 it is not — the real
southern boundary there runs about ten feet lower. The gap became part of
Paddock 4: a ribbon 10 ft tall and 370 ft long tucked under P5, 1,090 sq ft,
shaped like nothing anyone would fence.

**It was not cosmetic.** Paddock 4 is swept west to east, so the ribbon was its
*eastern hundred feet* — a 607 ft sweep ending in 100 ft of ten-foot ribbon.
That is the same defect that turned up when the strip arithmetic was fixed:
Paddock 4's last sixteenth measured 1,505% smaller than an even share, worse
than any other ground on the farm by a factor of thirty. **The ribbon was that
taper.** With it gone, P4's worst error falls to 43% and it reads as what it
is — a wedge, narrow at the west, widening east.

| unit | acres | sweep |
|---|---|---|
| P4 | 2.261 → 2.227 | 607 ft → 507 ft |
| P5 | 1.381 → 1.416 | 405 ft → 416 ft |

P1, P2 and P3 are untouched and the five still sum to **9.568** — the perimeter
exactly. That check is what distinguishes moving a fence between two units from
redrawing the farm.

One vertex was deleted rather than moved, and checked before deleting:
(-88.41269599, 42.87722457) sits **0.00 inches** off the straight line between
P5's north-east corner and the perimeter vertex below it. That is what a
constructed intersection looks like and what a surveyed corner does not.

### The grazing already on file had to move with it

044 could leave events alone — it shifted the perimeter by under 2.4 ft and no
unit changed length, so a fraction still meant what it meant. This one changes
both sweeps, so the same `swept_from` would silently point at different ground.

Each fraction was rescaled to keep the wire where it actually was. Distance
along the sweep axis is linear in the fraction, so the transform is exact:

    position = min_old + f_old × span_old
    f_new    = (position − min_new) ÷ span_new

P4's western origin does not move — the ribbon came off the far end — so it is
a pure rescale. P5 gains the ribbon at its southern end, so its origin moves
11.1 ft south and there is a shift as well. Seven rows, every one holding its
distance along the sweep to the foot.

### What the tests had encoded

Four tests failed on the new geometry, and three of them were asserting the
ribbon rather than the farm — "badly wrong where a unit tapers" wanted P4's
last tenth to measure under a tenth of its even share, which was true only
because that tenth was the ribbon. They now test P4's western end, where the
wedge is real: 0.70 of an even share, a 43% error, still worth measuring off
the boundary and no longer an artifact. The arithmetic was right about the old
shape; the shape was wrong.

## Mobs: who is actually on the grass

`grazing_group_members` could be read and never written. So an animal added to
Herd → Animals was not in the mob, and the farm ran for a while with five
animals on file and **four head** in every figure the module produced — strip
width, days of feed, stock density, the forage balance. The head count is not a
number anyone types; it is the length of a list nothing could edit.

Herd → Mobs is that list. Start a mob, put animals in, take them out.

**No migration.** Both tables already carry insert, select and update policies
and grants for `authenticated` — checked against the live database as a real
user in a rolled-back transaction, not from an editor running as superuser,
where every permission check passes and proves nothing. Creating a mob, adding
a member, dating a leaving and renaming all pass; another farm's is refused.

### The database does not stop an animal being in two mobs

There is no unique index on an open membership — only a check that a leaving
date is not before a joining date. Two open rows for one animal would be summed
twice by `mobWeight`: the mob reads heavier than it is, and every strip cut
from that figure comes out too wide.

So the rule lives in the app, as `joinRefusal` — a pure function rather than
something buried in the write, because a rule that cannot be tested without a
network is a rule that does not get tested. A closed membership is no obstacle:
she may have moved between mobs or been sold on and bought back, and the old
row stays, which is what keeps a head count recorded in July honest.

### Two things the page will not offer

**An AI bull.** `record_type` separates an animal that lives here from one on
file only so a pedigree can name him. Four of this farm's nine animals are
reference sires; offering them as candidates would be offering to put a straw
of semen out on grass.

**A manual head count.** `grazing_groups.head_count_manual` overrides the roll,
and this page exists so the roll is right. It is written as null every time.

### What it says when it cannot say a number

Animals on the farm and in no mob are named at the foot of the page — "nothing
counts them until they are in one" — which is the sentence that would have made
the missing fifth head visible months earlier. A mob with unweighed members
gives the total for the ones that have a weight and says how many it left out,
rather than quietly reporting a light figure.

### No delete

A mob that is finished with goes to "not running"; an animal that leaves gets a
date. Its past moves still name it, and a head count on a move from July has to
keep making sense.
