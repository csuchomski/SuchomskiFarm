# Grazing management (NRCS CPS 528)

An eight-step module, built one reviewable step at a time. This file is the
running record of what was decided and what is still open.

**Step 1 — schema and types — is built and rehearsed, not run.** See
"Before this can be run" below.

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
stack-neutral — but **offline capture is a real decision that is still
open**, and it is the one that matters most for this module. See below.

The design-token half of the brief is accurate: the palette, the fonts, and
hazard yellow being reserved for withdrawal are all real. Grazing warnings —
grazed before its recovery target, monitoring overdue — use **ochre**, which
`tokens.css` already designates for shortfalls.

## Step 1: what was built

Migration 036 adds twenty-four tables in the `herd` schema, grouped by the
plan element each one serves:

- **Management units** — `paddocks`, `paddock_forages`,
  `paddock_water_sources`, `holding_areas`
- **The map layer** — `infrastructure`
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

**Derived, never stored:** occupancy days, animal-days, stocking density,
AUM consumed, rest days since last exit, grazing days per season, animal
units. All are functions of the rows and would go stale the moment one is
edited. Their implementations arrive with step 2.

**Nothing cascades from a plan.** Marking a plan inactive hides nothing and
deletes nothing; prior years stay queryable. There is no DELETE policy on any
of the twenty-four tables — removal is `deleted_at`, the schema-wide convention.

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

## Before this can be run

Two things from the brief's own "before you run this", both still open:

1. **The Wisconsin 528 Implementation Requirements sheet and the grazing plan
   worksheet**, from the district conservationist — plus confirmation that
   the Wisconsin FOTG is on the June 2025 national revision rather than an
   older state version. This schema assumes it is. If Wisconsin is still on
   an earlier revision, the carrying-capacity figure removed from
   `plan_paddock_targets` may need to come back, and the forage balance may
   be more than the state asks for.

   The IR sheet is what a state office actually holds you to and may name
   documentation items that should be required rather than optional.
   Everything is optional today, so the sheet can only tighten — but if it
   prescribes a worksheet layout, that becomes a ninth build step.

2. **The real paddock list, acreage, boundaries, and current plan targets.**
   Seed data was deliberately not written. Placeholder paddocks would be
   worse than an empty table: they are the kind of thing that survives to a
   review. Ask the conservationist for the digital unit map already on file
   from the EQIP plan — importing it beats redrawing it, and
   `paddocks.boundary` takes GeoJSON as-is.

## Open decision: offline

The brief asks for full offline capture with background sync, and the use
case earns it — moves get logged in a pasture with no signal. This app has no
offline layer of any kind today, so that is a new dependency and a new
pattern, which the brief separately forbids.

It is a genuine fork and it is the owner's call:

- **Add it** — Dexie plus a sync queue, applied to the whole app rather than
  just grazing, or the app has two data-access patterns forever. Real work,
  and worth it if moves are logged out of signal.
- **Skip it for now** — build the module the way the rest of the app works,
  and capture moves when there is signal. Cheapest, and wrong exactly when
  the feature is most needed.
- **Narrow it** — offline for the move form only: queue moves in
  `localStorage` and flush on reconnect. A fraction of the work, covers the
  case that actually happens, and leaves the rest of the app alone.

The third is the recommendation. Nothing in step 1 forecloses any of them.

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
