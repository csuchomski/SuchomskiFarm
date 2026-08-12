# Grazing management (NRCS CPS 528)

A six-step module, built one reviewable step at a time. This file is the
running record of what was decided and what is still open.

**Step 1 — schema and types — is built and rehearsed, not run.** See
"Before this can be run" below.

## What it is for

An EQIP contract with 528 as a scheduled practice. The module has to do three
things at once: work in a pasture on a phone with one hand, produce records a
district conservationist can review, and stay readable long after the
contract closes.

CPS 528 does not enumerate required record fields. What it requires is a
Grazing Management Plan containing goals and objectives, a resource
inventory, a forage inventory with carrying capacity, a grazing schedule
identifying grazing and rest/deferment periods, contingency preparations for
episodic events, and a monitoring strategy with protocols and records.
Operation and Maintenance further require that adaptive-management decisions
be documented and that the records get used to make changes.

Each of those has its own table in migration 036, rather than everything
being crammed into the move log.

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

Migration 036 adds twenty tables in the `herd` schema, grouped by the plan
element each one serves:

- **Management units** — `paddocks`, `paddock_forages`,
  `paddock_water_sources`, `holding_areas`
- **The plan** — `grazing_plans`, `plan_resource_concerns`,
  `plan_paddock_targets`, `plan_schedule_periods`, `contingency_plans`
- **The mob** — `grazing_groups`, `grazing_group_members`
- **The move log** — `grazing_events`
- **Monitoring** — `key_areas`, `monitoring_records`, `grazing_photos`
- **Adaptive management and its inputs** — `management_decisions`,
  `decision_paddocks`, `decision_groups`, `supplemental_feeding`,
  `soil_tests`

Types and the four reads step 2 needs are in `app/src/lib/grazing.ts`.

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

**Derived, never stored:** occupancy days, animal-days, stocking density,
AUM consumed, rest days since last exit, grazing days per season, animal
units. All are functions of the rows and would go stale the moment one is
edited. Their implementations arrive with step 2.

**Nothing cascades from a plan.** Marking a plan inactive hides nothing and
deletes nothing; prior years stay queryable. There is no DELETE policy on any
of the twenty tables — removal is `deleted_at`, the schema-wide convention.

### Rehearsal

Applied inside a rolled-back transaction, with the write path exercised as
the farmer under a real `authenticated` role:

```
1  tables created                     20
2  rls enabled on all                 20
3  policies (want 60, 0 delete)       60 total, 0 delete
4  paddocks and a move recorded       ok
5  moved to the next paddock          ok
6  second open event refused          one open event per mob
7  exit before entry refused          ok
8  foreign farm insert refused        RLS
9  orphan photo refused               ok
10 two active plans refused           one at a time
11 utilization 140% refused           ok
12 rest days on North since exit      0
```

## Before this can be run

Two things from the brief's own "before you run this", both still open:

1. **The Wisconsin 528 Implementation Requirements sheet and the grazing plan
   worksheet**, from the district conservationist. The IR sheet is what a
   state office actually holds you to and may name specific documentation
   items that should be required fields rather than optional ones. Everything
   is optional today, so the sheet can only tighten — but if it prescribes a
   worksheet layout, that becomes a seventh build step: an export reproducing
   that exact layout.

2. **The real paddock list, acreage, and current plan targets.** Seed data
   was deliberately not written. Placeholder paddocks would be worse than an
   empty table: they are the kind of thing that survives to a review.

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
3. Rotation timeline.
4. Monitoring + key areas + photo points.
5. Plan editor + contingency triggers + decision log.
6. Exports — annual grazing record, and CSV of raw events and monitoring.
7. *(conditional)* A worksheet-shaped export, if the IR sheet prescribes one.
