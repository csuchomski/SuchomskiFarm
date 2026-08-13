-- 036 — grazing management (NRCS CPS 528)
--
-- STATUS: not run — rehearsed under RLS, awaiting review and the real
--         paddock list. See docs/GRAZING.md.
--
-- Step 1 of the grazing module: the tables and nothing else. No UI, no seed
-- data — the paddocks have to be the farm's real ones, not placeholders.
--
-- What this is for: an EQIP contract with 528 as a scheduled practice.
--
-- Written against the **June 2025 revision** (NHCP). The standard does not
-- enumerate required record fields; its Plans and Specifications section
-- requires, at minimum:
--
--   * the client's goals and objectives
--   * a map of planned grazing management units showing existing supporting
--     infrastructure — livestock water, fence, gates
--   * an inventory of current and planned forage availability by management
--     unit: seasonal production, species, quality, availability
--   * current and planned livestock and/or wildlife forage demand
--   * a feed and forage balance by management unit, aligning demand with
--     availability and accounting for distribution, wildlife use, quality,
--     seasonal availability and hay production
--   * a grazing strategy: intensity, timing, duration, frequency
--   * a contingency plan for episodic events
--   * monitoring protocols and records
--
-- Operation and Maintenance additionally require documented adaptive-
-- management decisions, identified key areas / key plants / indicators, and
-- that the records actually get used to make changes.
--
-- Every one of those has a durable home here, not just the move log. The map,
-- the forage balance and the decision log are first-class — the tables below
-- are grouped in that order.
--
-- Two things the 2025 revision changed about an earlier draft of this file:
--
--   * **The forage balance replaces a single carrying-capacity figure.**
--     Supply and demand are modelled separately (`forage_availability`,
--     `forage_demand`, `forage_removals`) and the balance is derived. The
--     `carrying_capacity_aum` column that used to sit on a paddock target is
--     gone rather than kept beside it: one fact in two places is how the two
--     end up disagreeing.
--   * **Sensitive areas, ecological site and heavy-use notes are no longer
--     named by the standard.** They stay — they are useful — but they are
--     optional inventory and belong out of the way in the UI.
--
-- Two rules this schema holds to:
--
--   * Nothing here asserts compliance. These tables record what happened;
--     whether it meets the standard is the conservationist's call. No column
--     is named or valued 'compliant'.
--
--   * Everything the standard does not name is nullable. The only NOT NULLs
--     are identity, ownership, and the two facts a move is (which paddock,
--     when). If the Wisconsin Implementation Requirements sheet names a
--     field, tightening it later is one ALTER.
--
-- Canonical units, carried in the column names: acres, inches, pounds,
-- head, days, percent, degrees, AUM. Nothing is stored in two units.
--
-- Derived and deliberately not stored: days of occupancy, animal-days,
-- stocking density, AUM consumed, days of rest since last exit, grazing days
-- per season, animal units. All of them are functions of the rows below and
-- would go stale the moment one is edited.

-- ── management units ───────────────────────────────────────────────────

create table if not exists herd.paddocks (
  id                  uuid primary key default gen_random_uuid(),
  farm_id             uuid not null references herd.farms(id),
  name                text not null,
  code                text,
  acres_measured      numeric,
  acres_grazable      numeric,
  -- How the unit is bounded. A poly-wire subdivision and a virtual-fence unit
  -- are both real management units, and neither has a fence you could point
  -- at on the infrastructure map — so the type has to be recorded rather than
  -- inferred from whether a fence exists.
  unit_type           text not null default 'permanent',
  seeding_date        date,
  fence_type          text,
  -- ── optional inventory ───────────────────────────────────────────────
  -- Useful, and no longer named by the 2025 standard. Nullable, and the UI
  -- keeps them out of the way rather than in the main flow.
  ecological_site     text,
  soil_map_unit       text,
  noxious_species     text,
  noxious_extent      text,
  -- Sensitive areas drive site-specific strategy, so they are flags rather
  -- than free text — they have to be filterable.
  sensitive_riparian      boolean not null default false,
  sensitive_wetland       boolean not null default false,
  sensitive_habitat       boolean not null default false,
  sensitive_karst         boolean not null default false,
  sensitive_high_erosion  boolean not null default false,
  heavy_use_notes     text,
  -- GeoJSON, unparsed. The app has no mapping today; this is a place to keep
  -- a boundary that arrives from elsewhere without inventing a geometry type.
  boundary            jsonb,
  active              boolean not null default true,
  notes               text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint paddocks_acres_nonneg check (
    (acres_measured is null or acres_measured >= 0) and
    (acres_grazable is null or acres_grazable >= 0)
  ),
  constraint paddocks_grazable_within_measured check (
    acres_measured is null or acres_grazable is null or acres_grazable <= acres_measured
  ),
  constraint paddocks_unit_type check (
    unit_type in ('permanent', 'temporary', 'virtual')
  )
);

create unique index if not exists paddocks_farm_name_uniq
  on herd.paddocks (farm_id, lower(name)) where deleted_at is null;

-- Forage species is many-per-paddock and changes with a reseeding, so it is
-- rows rather than a text column somebody has to parse a comma out of.
create table if not exists herd.paddock_forages (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  species    text not null,
  is_dominant boolean not null default false,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

create table if not exists herd.holding_areas (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  name       text not null,
  location_note text,
  surface    text,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

-- ── infrastructure: the map layer ──────────────────────────────────────
--
-- The standard requires a map of the management units *showing existing
-- supporting infrastructure* — water, fence, gates. So this has to be real
-- geometry that renders, not a list of things that exist somewhere.
--
-- Geometry is GeoJSON in jsonb: a Point for a tank or gate, a LineString for
-- a fence, pipeline or lane. No PostGIS — nothing here does spatial queries,
-- and adding an extension for storage the app only ever reads back whole
-- would be a dependency bought for nothing.

create table if not exists herd.infrastructure (
  id       uuid primary key default gen_random_uuid(),
  farm_id  uuid not null references herd.farms(id),
  -- Optional: a pipeline crosses paddocks, a tank serves two. Null means it
  -- belongs to the farm rather than to one unit.
  paddock_id uuid references herd.paddocks(id),
  kind     text not null,
  name     text,
  geometry jsonb,
  -- Existing or planned. The standard asks the map to show *existing*
  -- supporting infrastructure, while an EQIP plan map draws both — the farm's
  -- own map distinguishes them by colour and the schema has to keep that
  -- apart, or a planned gate reads on the map as a gate that is there.
  status   text not null default 'existing',
  install_date date,
  condition    text,
  -- Where the item is itself an NRCS practice — Fence is 382, Watering
  -- Facility 614, Pipeline 516 — so the map can carry the practice number a
  -- reviewer is looking for.
  nrcs_practice_code text,
  active   boolean not null default true,
  notes    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint infrastructure_kind check (
    kind in (
      'water_source', 'tank', 'pipeline', 'well',
      'permanent_fence', 'temporary_fence', 'gate', 'lane',
      'holding_area', 'shade', 'mineral_station', 'other'
    )
  ),
  constraint infrastructure_status check (
    status in ('existing', 'planned', 'removed')
  )
);

create index if not exists infrastructure_farm_kind_idx
  on herd.infrastructure (farm_id, kind) where deleted_at is null;

-- Which units a water source serves, and when it has water.
--
-- Deliberately *not* a second list of water sources beside `infrastructure`.
-- The tank is one thing and lives there, on the map, with its geometry and
-- its practice code; this table says which paddocks it waters. Two tables
-- describing the same tank would be one fact in two places, and they would
-- disagree the first time one was edited.
--
-- It is a join rather than a column on `infrastructure` because water on a
-- fence line serves the units on **both** sides — which is exactly how this
-- farm's seven points are placed. One tank, two rows.
--
-- `infrastructure_id` is nullable for a source with no point on the map: a
-- creek, a pond, a neighbour's hydrant. Those still water a paddock and still
-- have a season.
create table if not exists herd.paddock_water_sources (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  infrastructure_id uuid references herd.infrastructure(id),
  source_type text not null,
  -- Seasonal availability is the point of recording water at all: a paddock
  -- with a summer-dry creek is a different paddock in August.
  seasonal_availability text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

-- One mapped source can water many paddocks and one paddock can have many
-- sources, but the same pairing twice is a duplicate.
create unique index if not exists paddock_water_sources_pair_uniq
  on herd.paddock_water_sources (paddock_id, infrastructure_id)
  where deleted_at is null and infrastructure_id is not null;

-- ── the basemap ────────────────────────────────────────────────────────
--
-- The unit map is drawn over a **georeferenced static image** rather than a
-- live tile service. Chosen deliberately: the farm already has an aerial
-- from its EQIP plan, one image is a few hundred kilobytes that can be
-- cached whole, and it renders in a pasture with no signal — which is the
-- condition the map is actually needed in. A tile service is the opposite
-- trade: better zoom, useless off-grid, and a running dependency.
--
-- Georeferencing is a bounding box in WGS84 plus the image's pixel size,
-- which is all a north-up aerial needs to place a boundary on it. An image
-- that isn't north-up carries `rotation_deg`; one that is genuinely skewed
-- carries `control_points` instead, and the app reads that when it is there.
--
-- Attribution travels with the image. The source aerial carries a "Google"
-- credit and an imagery date, and both belong on an exported record — a map
-- in an annual grazing record should say where it came from and when it was
-- flown.

create table if not exists herd.map_overlays (
  id       uuid primary key default gen_random_uuid(),
  farm_id  uuid not null references herd.farms(id),
  name     text not null,
  storage_path text not null,
  -- WGS84 bounding box. All four or none.
  north numeric,
  south numeric,
  east  numeric,
  west  numeric,
  rotation_deg numeric,
  -- For an image that a bounding box cannot place. GeoJSON control points,
  -- pixel to lat/long.
  control_points jsonb,
  image_width_px  integer,
  image_height_px integer,
  -- "EQIP plan map, Google imagery 2024" — the credit and the flight date.
  source_note text,
  imagery_date date,
  active   boolean not null default true,
  notes    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint map_overlays_bbox_complete check (
    (north is null and south is null and east is null and west is null)
    or (north is not null and south is not null and east is not null and west is not null)
  ),
  constraint map_overlays_bbox_ordered check (
    north is null or (north > south and east > west)
  ),
  constraint map_overlays_placeable check (
    north is not null or control_points is not null
  ),
  constraint map_overlays_pixels_positive check (
    (image_width_px is null or image_width_px > 0) and
    (image_height_px is null or image_height_px > 0)
  )
);

-- ── the plan ───────────────────────────────────────────────────────────

create table if not exists herd.grazing_plans (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references herd.farms(id),
  name          text not null,
  period_start  date,
  period_end    date,
  contract_number text,
  tract_number    text,
  field_ids       text,
  long_term_goals      text,
  immediate_objectives text,
  benchmark_stocking_rate_aum_per_acre numeric,
  -- Monitoring cadence is per plan and never hardcoded in the app. 'kind'
  -- says how to read 'value': every_n_days -> days, times_per_season ->
  -- a count, every_rotation -> value unused.
  monitoring_cadence_kind  text not null default 'every_n_days',
  monitoring_cadence_value numeric,
  -- Dry-matter intake as a share of body weight, used to turn head and weight
  -- into forage demand. A plan-level default that any demand row may override,
  -- because it is a number somebody should be able to argue with — not a
  -- constant this app asserts.
  default_dmi_pct_bw numeric,
  active        boolean not null default false,
  notes         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint grazing_plans_period_order check (
    period_start is null or period_end is null or period_end >= period_start
  ),
  constraint grazing_plans_cadence_kind check (
    monitoring_cadence_kind in ('every_rotation', 'every_n_days', 'times_per_season')
  )
);

-- One active plan at a time. Prior years stay, and stay readable: nothing
-- cascades from a plan, and marking it inactive hides nothing.
create unique index if not exists grazing_plans_one_active
  on herd.grazing_plans (farm_id) where active and deleted_at is null;

create table if not exists herd.plan_resource_concerns (
  id       uuid primary key default gen_random_uuid(),
  farm_id  uuid not null references herd.farms(id),
  plan_id  uuid not null references herd.grazing_plans(id),
  -- The standard's five resource categories.
  category text not null,
  concern  text not null,
  notes    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint plan_resource_concerns_category check (
    category in ('soil', 'water', 'air', 'plants', 'animals')
  )
);

create table if not exists herd.plan_paddock_targets (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  plan_id    uuid not null references herd.grazing_plans(id),
  paddock_id uuid not null references herd.paddocks(id),
  target_entry_height_in     numeric,
  target_residual_height_in  numeric,
  -- Growing and dormant season kept apart on purpose: one recovery figure
  -- across the whole year is the assumption that gets paddocks hurt.
  min_recovery_days_growing  integer,
  min_recovery_days_dormant  integer,
  target_utilization_pct     numeric,
  -- No carrying_capacity_aum here. The 2025 revision replaces that single
  -- figure with the feed and forage balance below, and keeping both would be
  -- one fact in two places waiting to disagree.
  planned_grazing_notes      text,
  planned_deferment_notes    text,
  sensitive_area_strategy    text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint plan_paddock_targets_heights_nonneg check (
    (target_entry_height_in is null or target_entry_height_in >= 0) and
    (target_residual_height_in is null or target_residual_height_in >= 0)
  ),
  constraint plan_paddock_targets_recovery_nonneg check (
    (min_recovery_days_growing is null or min_recovery_days_growing >= 0) and
    (min_recovery_days_dormant is null or min_recovery_days_dormant >= 0)
  ),
  constraint plan_paddock_targets_utilization_range check (
    target_utilization_pct is null or (target_utilization_pct >= 0 and target_utilization_pct <= 100)
  )
);

create unique index if not exists plan_paddock_targets_uniq
  on herd.plan_paddock_targets (plan_id, paddock_id) where deleted_at is null;

-- The planned schedule, as dated rows rather than prose, because the
-- standard asks for grazing periods *and* rest/deferment periods and the
-- rotation timeline has to draw planned against actual.
create table if not exists herd.plan_schedule_periods (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  plan_id    uuid not null references herd.grazing_plans(id),
  paddock_id uuid not null references herd.paddocks(id),
  kind       text not null,
  start_date date not null,
  end_date   date,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint plan_schedule_periods_kind check (kind in ('graze', 'rest', 'deferment')),
  constraint plan_schedule_periods_order check (end_date is null or end_date >= start_date)
);

create table if not exists herd.contingency_plans (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references herd.farms(id),
  plan_id      uuid not null references herd.grazing_plans(id),
  trigger_type text not null,
  -- The ecological trigger or threshold that fires it. Free text because a
  -- threshold is "below 3 inches residual by 15 June", not a number.
  trigger_threshold text,
  planned_response  text,
  holding_area_id   uuid references herd.holding_areas(id),
  notes        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint contingency_plans_trigger_type check (
    trigger_type in ('drought', 'saturated_soil', 'flood', 'fire', 'insect', 'forage_shortfall', 'other')
  )
);

-- ── the mob ────────────────────────────────────────────────────────────

create table if not exists herd.grazing_groups (
  id      uuid primary key default gen_random_uuid(),
  farm_id uuid not null references herd.farms(id),
  name    text not null,
  species text,
  class   text,
  -- Null means "derive it from the members below". A figure here is the
  -- manual override, and the app says which one it is using.
  head_count_manual   integer,
  avg_weight_lb_manual numeric,
  active  boolean not null default true,
  notes   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint grazing_groups_head_nonneg check (head_count_manual is null or head_count_manual >= 0),
  constraint grazing_groups_weight_nonneg check (avg_weight_lb_manual is null or avg_weight_lb_manual >= 0)
);

create table if not exists herd.grazing_group_members (
  id        uuid primary key default gen_random_uuid(),
  farm_id   uuid not null references herd.farms(id),
  group_id  uuid not null references herd.grazing_groups(id),
  animal_id uuid not null references herd.animals(id),
  joined_on date,
  left_on   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint grazing_group_members_order check (left_on is null or joined_on is null or left_on >= joined_on)
);

create unique index if not exists grazing_group_members_open_uniq
  on herd.grazing_group_members (group_id, animal_id)
  where left_on is null and deleted_at is null;

-- ── feed and forage balance ────────────────────────────────────────────
--
-- Its own required deliverable in the 2025 revision, and the reason the old
-- single carrying-capacity number is gone. Supply and demand are separate
-- tables; the balance — availability, less demand, less what was hauled off
-- as hay — is derived per unit per period and never stored.
--
-- Periods are a date range rather than a month number, so the same tables
-- carry a monthly step, a seasonal step, or the irregular one a plan actually
-- uses. The label is what the farm calls it.
--
-- On units: the header of this file says one canonical unit per quantity, and
-- these tables look like they break it by offering both pounds of dry matter
-- and AUM. They don't — each *column* is one unit, and both are recorded as
-- entered. Converting between them needs an assumption about what an animal
-- unit month is worth in dry matter, and this app inventing that number
-- quietly is exactly what it must not do. Whichever the farm entered is what
-- gets shown.

create table if not exists herd.forage_availability (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  plan_id    uuid references herd.grazing_plans(id),
  paddock_id uuid not null references herd.paddocks(id),
  period_start date not null,
  period_end   date not null,
  period_label text,
  lb_dm_per_acre numeric,
  aum            numeric,
  species_mix    text,
  quality_note   text,
  -- Current inventory or planned/projected: the standard asks for both, and
  -- a projection shown as a measurement is a lie a reviewer will catch.
  is_planned  boolean not null default false,
  -- Where the number came from. A visual estimate and a clipping are not the
  -- same evidence, and the balance should say which it is built on.
  basis       text,
  notes       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint forage_availability_period_order check (period_end >= period_start),
  constraint forage_availability_has_a_figure check (
    lb_dm_per_acre is not null or aum is not null
  ),
  constraint forage_availability_nonneg check (
    (lb_dm_per_acre is null or lb_dm_per_acre >= 0) and (aum is null or aum >= 0)
  ),
  constraint forage_availability_basis check (
    basis is null or basis in (
      'clipping', 'plate_meter', 'visual', 'ecological_site', 'extension_table', 'other'
    )
  )
);

create index if not exists forage_availability_paddock_period_idx
  on herd.forage_availability (paddock_id, period_start) where deleted_at is null;

create table if not exists herd.forage_demand (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  plan_id    uuid references herd.grazing_plans(id),
  -- Null paddock means the demand is against the whole farm rather than one
  -- unit — which is the honest shape for a wildlife estimate.
  paddock_id uuid references herd.paddocks(id),
  group_id   uuid references herd.grazing_groups(id),
  -- Wildlife use has to be accounted for under the standard, so it is a row
  -- type here rather than a footnote somebody remembers to subtract.
  kind       text not null default 'livestock',
  period_start date not null,
  period_end   date not null,
  period_label text,
  head_count    integer,
  animal_class  text,
  avg_weight_lb numeric,
  -- Overrides the plan's default when set.
  dmi_pct_bw    numeric,
  -- Or state the demand outright, which is how a wildlife row gets entered.
  demand_lb_dm  numeric,
  demand_aum    numeric,
  notes         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint forage_demand_period_order check (period_end >= period_start),
  constraint forage_demand_kind check (kind in ('livestock', 'wildlife', 'other')),
  constraint forage_demand_nonneg check (
    (head_count is null or head_count >= 0) and
    (avg_weight_lb is null or avg_weight_lb >= 0) and
    (dmi_pct_bw is null or dmi_pct_bw >= 0) and
    (demand_lb_dm is null or demand_lb_dm >= 0) and
    (demand_aum is null or demand_aum >= 0)
  )
);

create index if not exists forage_demand_period_idx
  on herd.forage_demand (farm_id, period_start) where deleted_at is null;

-- Hay and haylage off a management unit. Two jobs: the standard requires hay
-- production be carried in the balance, and without it the rotation timeline
-- reads a long gap as rest when the forage actually left on a wagon.
create table if not exists herd.forage_removals (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  removed_on date not null,
  kind       text not null default 'hay',
  cutting_number integer,
  yield_lb   numeric,
  -- Weighed or estimated. Same reasoning as the availability basis.
  yield_basis text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint forage_removals_kind check (kind in ('hay', 'haylage', 'baleage', 'green_chop', 'other')),
  constraint forage_removals_basis check (yield_basis is null or yield_basis in ('weighed', 'estimated')),
  constraint forage_removals_nonneg check (
    (yield_lb is null or yield_lb >= 0) and (cutting_number is null or cutting_number > 0)
  )
);

create index if not exists forage_removals_paddock_date_idx
  on herd.forage_removals (paddock_id, removed_on desc) where deleted_at is null;

-- ── the move log ───────────────────────────────────────────────────────

create table if not exists herd.grazing_events (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  group_id   uuid not null references herd.grazing_groups(id),
  entered_at timestamptz not null,
  exited_at  timestamptz,
  -- Snapshotted, not referenced. The group's head count changes; what was in
  -- this paddock in June must not change with it.
  head_count       integer,
  avg_weight_lb    numeric,
  forage_height_in_entry   numeric,
  residual_height_in_exit  numeric,
  utilization_pct  numeric,
  soil_moisture    text,
  supplemental_feed boolean not null default false,
  weather_notes    text,
  notes            text,
  latitude         numeric,
  longitude        numeric,
  -- A virtual-fence unit is a different shape each time it is grazed. This
  -- carries that grazing's actual boundary without redefining the paddock,
  -- so the map can draw what was really grazed and the paddock keeps meaning
  -- one thing across the season.
  boundary_override jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint grazing_events_order check (exited_at is null or exited_at >= entered_at),
  constraint grazing_events_soil_moisture check (
    soil_moisture is null or soil_moisture in ('dry', 'moist', 'saturated')
  ),
  constraint grazing_events_utilization_range check (
    utilization_pct is null or (utilization_pct >= 0 and utilization_pct <= 100)
  ),
  constraint grazing_events_heights_nonneg check (
    (forage_height_in_entry is null or forage_height_in_entry >= 0) and
    (residual_height_in_exit is null or residual_height_in_exit >= 0)
  )
);

-- A mob is in one place at a time. This is what lets "log a move" be one
-- transaction — the destination closes whatever is open — rather than two
-- entries a tired person does half of.
create unique index if not exists grazing_events_one_open_per_group
  on herd.grazing_events (group_id)
  where exited_at is null and deleted_at is null;

create index if not exists grazing_events_paddock_time_idx
  on herd.grazing_events (paddock_id, entered_at desc) where deleted_at is null;

-- ── monitoring ─────────────────────────────────────────────────────────

create table if not exists herd.key_areas (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  name       text not null,
  latitude   numeric,
  longitude  numeric,
  -- The azimuth is what makes a photo series comparable year over year: same
  -- spot, same direction, or the photos are just pictures of grass.
  photo_azimuth_deg numeric,
  description text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint key_areas_azimuth_range check (
    photo_azimuth_deg is null or (photo_azimuth_deg >= 0 and photo_azimuth_deg < 360)
  )
);

create table if not exists herd.monitoring_records (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references herd.farms(id),
  key_area_id uuid not null references herd.key_areas(id),
  plan_id     uuid references herd.grazing_plans(id),
  observed_on date not null,
  protocol    text,
  residual_height_in    numeric,
  ground_cover_pct      numeric,
  litter_pct            numeric,
  bare_ground_pct       numeric,
  species_composition   text,
  key_plant_vigor       text,
  erosion_observations  text,
  compaction_observations text,
  observer    text,
  notes       text,
  latitude    numeric,
  longitude   numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint monitoring_records_pct_range check (
    (ground_cover_pct is null or (ground_cover_pct >= 0 and ground_cover_pct <= 100)) and
    (litter_pct is null or (litter_pct >= 0 and litter_pct <= 100)) and
    (bare_ground_pct is null or (bare_ground_pct >= 0 and bare_ground_pct <= 100))
  ),
  constraint monitoring_records_height_nonneg check (
    residual_height_in is null or residual_height_in >= 0
  )
);

create index if not exists monitoring_records_key_area_date_idx
  on herd.monitoring_records (key_area_id, observed_on desc) where deleted_at is null;

-- Photos hang off either a move or a monitoring record, never both and never
-- neither. One table rather than two so the upload queue has one shape.
create table if not exists herd.grazing_photos (
  id      uuid primary key default gen_random_uuid(),
  farm_id uuid not null references herd.farms(id),
  grazing_event_id     uuid references herd.grazing_events(id),
  monitoring_record_id uuid references herd.monitoring_records(id),
  storage_path text not null,
  caption   text,
  taken_at  timestamptz,
  latitude  numeric,
  longitude numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint grazing_photos_one_parent check (
    (grazing_event_id is not null)::int + (monitoring_record_id is not null)::int = 1
  )
);

-- ── adaptive management, and the inputs it reasons about ───────────────

-- The record most operations don't keep, and the one Operation and
-- Maintenance is really asking for: what was seen, what it tripped, what was
-- decided, and what happened next.
create table if not exists herd.management_decisions (
  id      uuid primary key default gen_random_uuid(),
  farm_id uuid not null references herd.farms(id),
  plan_id uuid references herd.grazing_plans(id),
  decided_on date not null,
  observation text,
  trigger_description text,
  decision text,
  -- Where it came from, when it came from something. All optional: a decision
  -- made standing in the gateway is still a decision.
  contingency_plan_id  uuid references herd.contingency_plans(id),
  monitoring_record_id uuid references herd.monitoring_records(id),
  grazing_event_id     uuid references herd.grazing_events(id),
  outcome_followup text,
  followed_up_on   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

create table if not exists herd.decision_paddocks (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references herd.farms(id),
  decision_id uuid not null references herd.management_decisions(id),
  paddock_id  uuid not null references herd.paddocks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

create table if not exists herd.decision_groups (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references herd.farms(id),
  decision_id uuid not null references herd.management_decisions(id),
  group_id    uuid not null references herd.grazing_groups(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1
);

create table if not exists herd.supplemental_feeding (
  id      uuid primary key default gen_random_uuid(),
  farm_id uuid not null references herd.farms(id),
  fed_on  date not null,
  paddock_id      uuid references herd.paddocks(id),
  holding_area_id uuid references herd.holding_areas(id),
  feed_type text,
  quantity  numeric,
  quantity_unit text,
  -- Feed brought onto a paddock imports nutrients and can import weed seed.
  -- That is why this table exists at all, so the reason is worth recording.
  reason    text,
  notes     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint supplemental_feeding_quantity_nonneg check (quantity is null or quantity >= 0)
);

create table if not exists herd.soil_tests (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  paddock_id uuid not null references herd.paddocks(id),
  sampled_on date not null,
  lab        text,
  ph         numeric,
  organic_matter_pct numeric,
  phosphorus_ppm     numeric,
  potassium_ppm      numeric,
  recommendations    text,
  document_path      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev integer not null default 1,
  constraint soil_tests_ph_range check (ph is null or (ph >= 0 and ph <= 14))
);

-- ── row level security ─────────────────────────────────────────────────
--
-- The same three policies every other table in this schema carries: read as
-- a farm member, write as an editor, and no DELETE policy anywhere — removal
-- is deleted_at. Applied in a loop rather than written out nineteen times,
-- because nineteen hand-typed copies is nineteen chances to typo one of them
-- and not notice. The rehearsal counts them afterwards.

do $$
declare
  t text;
  tables text[] := array[
    'paddocks', 'paddock_forages', 'paddock_water_sources', 'holding_areas',
    'infrastructure', 'map_overlays',
    'grazing_plans', 'plan_resource_concerns', 'plan_paddock_targets',
    'plan_schedule_periods', 'contingency_plans',
    'forage_availability', 'forage_demand', 'forage_removals',
    'grazing_groups', 'grazing_group_members', 'grazing_events',
    'key_areas', 'monitoring_records', 'grazing_photos',
    'management_decisions', 'decision_paddocks', 'decision_groups',
    'supplemental_feeding', 'soil_tests'
  ];
begin
  foreach t in array tables loop
    execute format('alter table herd.%I enable row level security', t);

    execute format('drop policy if exists %I on herd.%I', t || '_select', t);
    execute format(
      'create policy %I on herd.%I for select using (herd.is_farm_member(farm_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on herd.%I', t || '_insert', t);
    execute format(
      'create policy %I on herd.%I for insert with check (herd.can_write_farm(farm_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on herd.%I', t || '_update', t);
    execute format(
      'create policy %I on herd.%I for update using (herd.can_write_farm(farm_id)) with check (herd.can_write_farm(farm_id))',
      t || '_update', t);

    execute format('grant select, insert, update on herd.%I to authenticated, anon', t);
  end loop;
end $$;
