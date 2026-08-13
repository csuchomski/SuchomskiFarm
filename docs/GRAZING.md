# Grazing management (NRCS CPS 528)

An eight-step module, built one reviewable step at a time. This file is the
running record of what was decided and what is still open.

**Step 1 is done.** Migrations 036 (schema) and 037 (this farm's seed) are
run. Twenty-five tables live with RLS on every one; five paddocks at 9.55
grazable acres, seven water points, the plan map's fences, and one mob
holding every animal on file.

Step 2 — Log a Move and the paddock board — is next and not started.

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
   - for the seven water points: **existing or planned**, whether they are
     tanks off a pipeline or something else, and whether each really does
     serve both sides of the fence it sits on.
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
| Field | One field on County Hwy NN; perimeter fenced, interior fences at 410 / 372 / 417 ft with a 401 ft segment joining them |

Still missing: acreage per unit, coordinates, paddock names, plan targets.

### Splitting a paddock: two different things

"Can be split further as needed" has two shapes in this schema, and which one
is right depends on the rest clock rather than on the wire:

- **A split that persists and earns its own rest** — a paddock permanently
  halved with poly-wire for the season — is **its own `paddocks` row**, with
  `unit_type = 'temporary'`. It accumulates rest days of its own, gets its own
  targets, and appears on the board as a unit.
- **A strip within a single grazing** — a wire moved across a paddock over
  three days — is **one grazing event** on the parent paddock, optionally
  carrying `boundary_override` to record the shape actually grazed.

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

### Entering water point locations

*Decided 2026-08-13: not by hand, and not yet.*

Typing fourteen decimal coordinates is error-prone and the errors are silent
— a digit wrong puts a tank in the next county and nothing complains. Step 4
builds the unit map over the georeferenced aerial, and tapping a point on
that image is both easier and self-checking: a mis-tap is visible
immediately.

So the seven points are recorded now **without geometry** — name, kind, which
paddocks each serves, existing or planned. `infrastructure.geometry` is
nullable exactly so this is possible. The locations get filled in on the map
screen when it exists, or arrive with the KML if NRCS has one.

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

1. **Schema + types** — built, rehearsed, awaiting the paddock list.
2. Log a Move + paddock board.
3. Rotation timeline + hay/forage removal entry.
4. Unit map + infrastructure layer.
5. Feed and forage balance.
6. Monitoring + key areas + photo points.
7. Plan editor + contingency triggers + decision log.
8. Exports — annual grazing record in the standard's own section order, and
   CSV of raw events, forage records and monitoring.
9. *(conditional)* A worksheet-shaped export, if the IR sheet prescribes one.
