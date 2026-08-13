import { herdSchema } from "./supabase";

/**
 * Grazing management — the types and reads. Migration 036.
 *
 * Built for an EQIP contract with NRCS CPS 528 as a scheduled practice. Two
 * rules run through the whole module and are worth stating where the types
 * are, because they are easy to break later:
 *
 * **Nothing here asserts compliance.** These records say what happened.
 * Whether it meets the standard is the conservationist's determination, not
 * a computed field. The words to use are "recorded", "due", "target",
 * "outside plan target" — never "compliant".
 *
 * **Every threshold is configured, never constant.** Recovery days, residual
 * heights, utilization, monitoring cadence: all per plan and per paddock. A
 * number hardcoded here would be this app inventing an agronomic
 * recommendation it has no business making.
 *
 * Units are canonical and named in the field: acres, inches, pounds, head,
 * days, percent, degrees, AUM.
 *
 * Derived figures are computed at read time and never stored — occupancy
 * days, animal-days, stocking density, AUM consumed, rest days since last
 * exit. They are functions of the rows and would go stale the moment one is
 * edited. Their implementations arrive with step 2, where the board that
 * shows them lives.
 */

// ─── management units ──────────────────────────────────────────────────

/** How the unit is bounded. A poly-wire subdivision and a virtual-fence unit
 * are both real management units, and neither has a fence on the map. */
export type PaddockUnitType = "permanent" | "temporary" | "virtual";

export interface Paddock {
  id: string;
  name: string;
  code: string | null;
  acresMeasured: number | null;
  acresGrazable: number | null;
  unitType: PaddockUnitType;
  /** Compass bearing the mob advances toward: 0 N, 90 E, 180 S, 270 W. Null
   * for a unit that isn't strip-grazed — it is then taken whole. */
  sweepHeadingDeg: number | null;
  /** How far across the unit along that heading. Optional: the arithmetic
   * runs on fractions and acres without it, and it exists only so the app
   * can say "the wire is 120 feet in". */
  sweepLengthFt: number | null;
  seedingDate: string | null;
  fenceType: string | null;
  /** Optional inventory: useful, not named by the 2025 standard, and kept
   * out of the main flow in the UI. */
  ecologicalSite: string | null;
  soilMapUnit: string | null;
  noxiousSpecies: string | null;
  noxiousExtent: string | null;
  sensitive: {
    riparian: boolean;
    wetland: boolean;
    habitat: boolean;
    karst: boolean;
    highErosion: boolean;
  };
  heavyUseNotes: string | null;
  /** GeoJSON as stored, unparsed — the app has no map today. */
  boundary: unknown | null;
  active: boolean;
  notes: string | null;
}

export interface PaddockForage {
  id: string;
  paddockId: string;
  species: string;
  isDominant: boolean;
  notes: string | null;
}

/**
 * Which units a water source serves, and when it has water.
 *
 * Not a second list of water sources beside `Infrastructure`. The tank is one
 * thing and lives there, on the map; this says which paddocks it waters. A
 * join rather than a column on the tank, because water on a fence line serves
 * the units on **both** sides — which is how this farm's seven points are
 * placed. One tank, two rows.
 *
 * `infrastructureId` is null for a source with no point on the map: a creek,
 * a pond, a neighbour's hydrant. Those still water a paddock and still have a
 * season.
 */
export interface PaddockWaterSource {
  id: string;
  paddockId: string;
  infrastructureId: string | null;
  sourceType: string;
  seasonalAvailability: string | null;
  notes: string | null;
}

export interface HoldingArea {
  id: string;
  name: string;
  locationNote: string | null;
  surface: string | null;
  active: boolean;
  notes: string | null;
}

// ─── infrastructure: the map layer ─────────────────────────────────────

export type InfrastructureKind =
  | "water_source"
  | "tank"
  | "pipeline"
  | "well"
  | "permanent_fence"
  | "temporary_fence"
  | "gate"
  | "lane"
  | "holding_area"
  | "shade"
  | "mineral_station"
  | "other";

/** The standard requires a map of the units *showing* supporting
 * infrastructure, so this is geometry that renders, not a list of things
 * that exist somewhere. GeoJSON: a Point for a tank, a LineString for a
 * fence or pipeline. */
/** Existing or planned. An EQIP plan map draws both and distinguishes them by
 * colour; without this a planned gate reads on the map as a gate that is
 * there. */
export type InfrastructureStatus = "existing" | "planned" | "removed";

export interface Infrastructure {
  id: string;
  /** Null when it belongs to the farm rather than one unit — a pipeline
   * crosses paddocks. */
  paddockId: string | null;
  kind: InfrastructureKind;
  name: string | null;
  geometry: unknown | null;
  status: InfrastructureStatus;
  installDate: string | null;
  condition: string | null;
  /** Fence is 382, Watering Facility 614, Pipeline 516 — the number a
   * reviewer looks for. */
  nrcsPracticeCode: string | null;
  active: boolean;
  notes: string | null;
}

/**
 * The basemap: a georeferenced static image, not a tile service.
 *
 * Chosen because this is the map the plan refers to. A tile service shows
 * whatever the imagery is today; the EQIP plan map shows the field as it was
 * when the plan was written, with its own fence lines and gates drawn on it —
 * and that is the map a conservationist already has on file.
 */
export interface MapOverlay {
  id: string;
  name: string;
  storagePath: string;
  /** WGS84 bounding box: all four, or none and `controlPoints` instead. */
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
  rotationDeg: number | null;
  /** For an image a bounding box cannot place. */
  controlPoints: unknown | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
  /** The credit and the flight date, both of which belong on an exported
   * record — a map should say where it came from and when it was flown. */
  sourceNote: string | null;
  imageryDate: string | null;
  active: boolean;
  notes: string | null;
}

// ─── the plan ──────────────────────────────────────────────────────────

/** How often monitoring is expected. Never a constant — see the header. */
export type MonitoringCadenceKind = "every_rotation" | "every_n_days" | "times_per_season";

export interface GrazingPlan {
  id: string;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  contractNumber: string | null;
  tractNumber: string | null;
  fieldIds: string | null;
  longTermGoals: string | null;
  immediateObjectives: string | null;
  benchmarkStockingRateAumPerAcre: number | null;
  monitoringCadenceKind: MonitoringCadenceKind;
  monitoringCadenceValue: number | null;
  /** Dry-matter intake as a share of body weight, for turning head and weight
   * into demand. A default any demand row may override — a number somebody
   * should be able to argue with, not a constant this app asserts. */
  defaultDmiPctBw: number | null;
  active: boolean;
  notes: string | null;
}

export type ResourceCategory = "soil" | "water" | "air" | "plants" | "animals";

export interface PlanResourceConcern {
  id: string;
  planId: string;
  category: ResourceCategory;
  concern: string;
  notes: string | null;
}

export interface PlanPaddockTarget {
  id: string;
  planId: string;
  paddockId: string;
  targetEntryHeightIn: number | null;
  targetResidualHeightIn: number | null;
  /** Kept apart on purpose: one recovery figure for the whole year is the
   * assumption that gets paddocks hurt. */
  minRecoveryDaysGrowing: number | null;
  minRecoveryDaysDormant: number | null;
  targetUtilizationPct: number | null;
  plannedGrazingNotes: string | null;
  plannedDefermentNotes: string | null;
  sensitiveAreaStrategy: string | null;
  notes: string | null;
}

export type SchedulePeriodKind = "graze" | "rest" | "deferment";

export interface PlanSchedulePeriod {
  id: string;
  planId: string;
  paddockId: string;
  kind: SchedulePeriodKind;
  startDate: string;
  endDate: string | null;
  notes: string | null;
}

export type ContingencyTrigger =
  | "drought"
  | "saturated_soil"
  | "flood"
  | "fire"
  | "insect"
  | "forage_shortfall"
  | "other";

export interface ContingencyPlan {
  id: string;
  planId: string;
  triggerType: ContingencyTrigger;
  triggerThreshold: string | null;
  plannedResponse: string | null;
  holdingAreaId: string | null;
  notes: string | null;
}

// ─── the mob ───────────────────────────────────────────────────────────

export interface GrazingGroup {
  id: string;
  name: string;
  species: string | null;
  class: string | null;
  /** Null means derive from the group's members. A figure is the override,
   * and the UI says which one it is showing. */
  headCountManual: number | null;
  avgWeightLbManual: number | null;
  active: boolean;
  notes: string | null;
}

export interface GrazingGroupMember {
  id: string;
  groupId: string;
  animalId: string;
  joinedOn: string | null;
  leftOn: string | null;
}

// ─── feed and forage balance ───────────────────────────────────────────
//
// The 2025 revision's own required deliverable, and the reason there is no
// single carrying-capacity figure anywhere in this module. Supply and demand
// are separate; the balance is derived.
//
// Both pounds of dry matter and AUM appear, which looks like two units for
// one quantity. It isn't — each field is one unit, recorded as entered.
// Converting between them needs an assumption about what an animal unit
// month is worth in dry matter, and this app inventing that number quietly
// is exactly what it must not do.

/** Where an availability figure came from. A visual estimate and a clipping
 * are not the same evidence. */
export type AvailabilityBasis =
  | "clipping"
  | "plate_meter"
  | "visual"
  | "ecological_site"
  | "extension_table"
  | "other";

export interface ForageAvailability {
  id: string;
  planId: string | null;
  paddockId: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string | null;
  lbDmPerAcre: number | null;
  aum: number | null;
  speciesMix: string | null;
  qualityNote: string | null;
  /** A projection shown as a measurement is a lie a reviewer will catch. */
  isPlanned: boolean;
  basis: AvailabilityBasis | null;
  notes: string | null;
}

export type DemandKind = "livestock" | "wildlife" | "other";

export interface ForageDemand {
  id: string;
  planId: string | null;
  /** Null means against the whole farm rather than one unit — the honest
   * shape for a wildlife estimate. */
  paddockId: string | null;
  groupId: string | null;
  kind: DemandKind;
  periodStart: string;
  periodEnd: string;
  periodLabel: string | null;
  headCount: number | null;
  animalClass: string | null;
  avgWeightLb: number | null;
  /** Overrides the plan default when set. */
  dmiPctBw: number | null;
  /** Or state the demand outright, which is how a wildlife row is entered. */
  demandLbDm: number | null;
  demandAum: number | null;
  notes: string | null;
}

export type RemovalKind = "hay" | "haylage" | "baleage" | "green_chop" | "other";

/** Hay off a unit. Two jobs: the standard requires hay production be carried
 * in the balance, and without it the rotation timeline reads a long gap as
 * rest when the forage actually left on a wagon. */
export interface ForageRemoval {
  id: string;
  paddockId: string;
  removedOn: string;
  kind: RemovalKind;
  cuttingNumber: number | null;
  yieldLb: number | null;
  yieldBasis: "weighed" | "estimated" | null;
  notes: string | null;
}

// ─── the move log ──────────────────────────────────────────────────────

export type SoilMoisture = "dry" | "moist" | "saturated";

export interface GrazingEvent {
  id: string;
  paddockId: string;
  groupId: string;
  enteredAt: string;
  /** Null while the mob is still in the paddock. */
  exitedAt: string | null;
  /** Snapshotted at the time of the move, not looked up. The group's head
   * count changes; what was in this paddock in June must not change with it. */
  headCount: number | null;
  avgWeightLb: number | null;
  forageHeightInEntry: number | null;
  residualHeightInExit: number | null;
  utilizationPct: number | null;
  soilMoisture: SoilMoisture | null;
  supplementalFeed: boolean;
  weatherNotes: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Where along the unit's sweep this strip ran, as fractions. Null on both
   * means the whole unit was taken at once — still a legitimate move, and
   * what every event written before strip grazing is. */
  sweptFrom: number | null;
  sweptTo: number | null;
  /** The ground actually grazed, when it is known. For a strip the shape is
   * derivable from the unit boundary, the heading and the fractions, so this
   * stays empty until there is a boundary to derive it from. */
  grazedShape: unknown | null;
}

// ─── monitoring ────────────────────────────────────────────────────────

export interface KeyArea {
  id: string;
  paddockId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Same spot, same direction, or the photo series is just pictures of
   * grass. */
  photoAzimuthDeg: number | null;
  description: string | null;
  active: boolean;
}

export interface MonitoringRecord {
  id: string;
  keyAreaId: string;
  planId: string | null;
  observedOn: string;
  protocol: string | null;
  residualHeightIn: number | null;
  groundCoverPct: number | null;
  litterPct: number | null;
  bareGroundPct: number | null;
  speciesComposition: string | null;
  keyPlantVigor: string | null;
  erosionObservations: string | null;
  compactionObservations: string | null;
  observer: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface GrazingPhoto {
  id: string;
  grazingEventId: string | null;
  monitoringRecordId: string | null;
  storagePath: string;
  caption: string | null;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

// ─── adaptive management ───────────────────────────────────────────────

/** The record most operations don't keep, and what Operation and Maintenance
 * is really asking for. */
export interface ManagementDecision {
  id: string;
  planId: string | null;
  decidedOn: string;
  observation: string | null;
  triggerDescription: string | null;
  decision: string | null;
  contingencyPlanId: string | null;
  monitoringRecordId: string | null;
  grazingEventId: string | null;
  outcomeFollowup: string | null;
  followedUpOn: string | null;
}

export interface SupplementalFeeding {
  id: string;
  fedOn: string;
  paddockId: string | null;
  holdingAreaId: string | null;
  feedType: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  reason: string | null;
  notes: string | null;
}

export interface SoilTest {
  id: string;
  paddockId: string;
  sampledOn: string;
  lab: string | null;
  ph: number | null;
  organicMatterPct: number | null;
  phosphorusPpm: number | null;
  potassiumPpm: number | null;
  recommendations: string | null;
  documentPath: string | null;
  notes: string | null;
}

// ─── reads ─────────────────────────────────────────────────────────────
//
// The four the paddock board and the move form need. The rest arrive with
// the steps that consume them, rather than as a wall of fetches nothing
// calls yet.

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function fetchPaddocks(farmId: string): Promise<Paddock[]> {
  const { data, error } = await herdSchema()
    .from("paddocks")
    .select(
      "id, name, code, acres_measured, acres_grazable, unit_type, sweep_heading_deg, sweep_length_ft, seeding_date, fence_type, ecological_site, soil_map_unit, noxious_species, noxious_extent, sensitive_riparian, sensitive_wetland, sensitive_habitat, sensitive_karst, sensitive_high_erosion, heavy_use_notes, boundary, active, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`herd.paddocks: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    acresMeasured: num(r.acres_measured),
    acresGrazable: num(r.acres_grazable),
    unitType: r.unit_type as PaddockUnitType,
    sweepHeadingDeg: num(r.sweep_heading_deg),
    sweepLengthFt: num(r.sweep_length_ft),
    seedingDate: (r.seeding_date as string) ?? null,
    fenceType: (r.fence_type as string) ?? null,
    ecologicalSite: (r.ecological_site as string) ?? null,
    soilMapUnit: (r.soil_map_unit as string) ?? null,
    noxiousSpecies: (r.noxious_species as string) ?? null,
    noxiousExtent: (r.noxious_extent as string) ?? null,
    sensitive: {
      riparian: Boolean(r.sensitive_riparian),
      wetland: Boolean(r.sensitive_wetland),
      habitat: Boolean(r.sensitive_habitat),
      karst: Boolean(r.sensitive_karst),
      highErosion: Boolean(r.sensitive_high_erosion),
    },
    heavyUseNotes: (r.heavy_use_notes as string) ?? null,
    boundary: r.boundary ?? null,
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  }));
}

export async function fetchGrazingGroups(farmId: string): Promise<GrazingGroup[]> {
  const { data, error } = await herdSchema()
    .from("grazing_groups")
    .select("id, name, species, class, head_count_manual, avg_weight_lb_manual, active, notes")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`herd.grazing_groups: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    species: (r.species as string) ?? null,
    class: (r.class as string) ?? null,
    headCountManual: num(r.head_count_manual),
    avgWeightLbManual: num(r.avg_weight_lb_manual),
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  }));
}

export async function fetchGrazingEvents(farmId: string): Promise<GrazingEvent[]> {
  const { data, error } = await herdSchema()
    .from("grazing_events")
    .select(
      "id, paddock_id, group_id, entered_at, exited_at, head_count, avg_weight_lb, forage_height_in_entry, residual_height_in_exit, utilization_pct, soil_moisture, supplemental_feed, weather_notes, notes, latitude, longitude, swept_from, swept_to, grazed_shape",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("entered_at", { ascending: false });
  if (error) throw new Error(`herd.grazing_events: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    paddockId: r.paddock_id as string,
    groupId: r.group_id as string,
    enteredAt: r.entered_at as string,
    exitedAt: (r.exited_at as string) ?? null,
    headCount: num(r.head_count),
    avgWeightLb: num(r.avg_weight_lb),
    forageHeightInEntry: num(r.forage_height_in_entry),
    residualHeightInExit: num(r.residual_height_in_exit),
    utilizationPct: num(r.utilization_pct),
    soilMoisture: (r.soil_moisture as SoilMoisture) ?? null,
    supplementalFeed: Boolean(r.supplemental_feed),
    weatherNotes: (r.weather_notes as string) ?? null,
    notes: (r.notes as string) ?? null,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    sweptFrom: num(r.swept_from),
    sweptTo: num(r.swept_to),
    grazedShape: r.grazed_shape ?? null,
  }));
}

/** The targets for a plan, which is where every threshold the board compares
 * against comes from. Empty is a real answer: a paddock with no target is
 * shown without one rather than against a number this app made up. */
export async function fetchPlanPaddockTargets(planId: string): Promise<PlanPaddockTarget[]> {
  const { data, error } = await herdSchema()
    .from("plan_paddock_targets")
    .select(
      "id, plan_id, paddock_id, target_entry_height_in, target_residual_height_in, min_recovery_days_growing, min_recovery_days_dormant, target_utilization_pct, planned_grazing_notes, planned_deferment_notes, sensitive_area_strategy, notes",
    )
    .eq("plan_id", planId)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.plan_paddock_targets: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: r.plan_id as string,
    paddockId: r.paddock_id as string,
    targetEntryHeightIn: num(r.target_entry_height_in),
    targetResidualHeightIn: num(r.target_residual_height_in),
    minRecoveryDaysGrowing: num(r.min_recovery_days_growing),
    minRecoveryDaysDormant: num(r.min_recovery_days_dormant),
    targetUtilizationPct: num(r.target_utilization_pct),
    plannedGrazingNotes: (r.planned_grazing_notes as string) ?? null,
    plannedDefermentNotes: (r.planned_deferment_notes as string) ?? null,
    sensitiveAreaStrategy: (r.sensitive_area_strategy as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

/** The plan in force, or null. One active plan at a time is a partial unique
 * index in the database, not a convention this file hopes for. */
export async function fetchActivePlan(farmId: string): Promise<GrazingPlan | null> {
  const { data, error } = await herdSchema()
    .from("grazing_plans")
    .select(
      "id, name, period_start, period_end, contract_number, tract_number, field_ids, long_term_goals, immediate_objectives, benchmark_stocking_rate_aum_per_acre, monitoring_cadence_kind, monitoring_cadence_value, default_dmi_pct_bw, active, notes",
    )
    .eq("farm_id", farmId)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`herd.grazing_plans: ${error.message}`);
  if (!data) return null;

  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    periodStart: (r.period_start as string) ?? null,
    periodEnd: (r.period_end as string) ?? null,
    contractNumber: (r.contract_number as string) ?? null,
    tractNumber: (r.tract_number as string) ?? null,
    fieldIds: (r.field_ids as string) ?? null,
    longTermGoals: (r.long_term_goals as string) ?? null,
    immediateObjectives: (r.immediate_objectives as string) ?? null,
    benchmarkStockingRateAumPerAcre: num(r.benchmark_stocking_rate_aum_per_acre),
    monitoringCadenceKind: r.monitoring_cadence_kind as MonitoringCadenceKind,
    monitoringCadenceValue: num(r.monitoring_cadence_value),
    defaultDmiPctBw: num(r.default_dmi_pct_bw),
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  };
}

// ─── derived figures ───────────────────────────────────────────────────
//
// None of this is stored. Occupancy, rest, density and animal units are all
// functions of the rows above, and a stored copy would go stale the moment a
// move was edited — which the brief explicitly allows.

/** An animal unit is 1,000 lb of live weight. Null when the event never
 * recorded head or weight, because zero would read as "no cattle here". */
export function animalUnits(headCount: number | null, avgWeightLb: number | null): number | null {
  if (headCount === null || avgWeightLb === null) return null;
  return (headCount * avgWeightLb) / 1000;
}

/** Whole days between two instants, floored — a mob that arrived yesterday
 * afternoon and left this morning was there "0 days", which is honest for a
 * flash graze. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000);
}

/** How long they have been, or were, in the paddock. */
export function occupancyDays(event: GrazingEvent, nowIso: string): number {
  return daysBetween(event.enteredAt, event.exitedAt ?? nowIso);
}

/** Head × days. The figure that actually drives forage removed, and the one
 * a stocking rate is built from. */
export function animalDays(event: GrazingEvent, nowIso: string): number | null {
  if (event.headCount === null) return null;
  return event.headCount * occupancyDays(event, nowIso);
}

/** Pounds of live weight per grazable acre — instantaneous stocking density,
 * not a stocking rate. Null when weight or acres are unknown rather than
 * guessed: this is the number people compare between farms. */
export function stockingDensityLbPerAcre(event: GrazingEvent, paddock: Paddock): number | null {
  const acres = paddock.acresGrazable ?? paddock.acresMeasured;
  if (acres === null || acres <= 0) return null;
  if (event.headCount === null || event.avgWeightLb === null) return null;
  return (event.headCount * event.avgWeightLb) / acres;
}

/** The mob in a paddock right now, if any. */
export function openEventFor(paddockId: string, events: GrazingEvent[]): GrazingEvent | null {
  return events.find((e) => e.paddockId === paddockId && e.exitedAt === null) ?? null;
}

/** Where a mob is right now, if anywhere. Null is a real answer — they may be
 * off pasture altogether. */
export function whereIs(groupId: string, events: GrazingEvent[]): GrazingEvent | null {
  return events.find((e) => e.groupId === groupId && e.exitedAt === null) ?? null;
}

/**
 * Days of rest a paddock has accumulated since it was last defoliated.
 *
 * "Defoliated", not "grazed", and the distinction is the whole reason
 * `removals` is here. Forage that left on a hay wagon left the paddock just as
 * bare as forage a cow ate. Counting rest from the last *grazing* would tell
 * somebody a unit mown three days ago has been resting since June, which is
 * the app confidently giving wrong advice rather than merely missing a
 * feature.
 *
 * Null has two distinct meanings and the caller has to tell them apart, so
 * they are separated rather than collapsed: `occupied` when something is in it
 * now, and `never` when nothing has ever come off it. A paddock never grazed
 * has not "rested" for the age of the record — it has no history.
 */
export function restDays(
  paddockId: string,
  events: GrazingEvent[],
  nowIso: string,
  removals: ForageRemoval[] = [],
): { state: "occupied" } | { state: "rested"; days: number; since: string } | { state: "never" } {
  if (openEventFor(paddockId, events)) return { state: "occupied" };

  const marks = events
    .filter((e) => e.paddockId === paddockId && e.exitedAt !== null)
    .map((e) => e.exitedAt!)
    .concat(
      // A cutting is a date, not an instant. End of day, so a unit cut and
      // grazed on the same day reads as grazed after cutting rather than
      // before — which is the order those two things actually happen in.
      removals.filter((r) => r.paddockId === paddockId).map((r) => `${r.removedOn}T23:59:59.999Z`),
    )
    .sort();

  const last = marks[marks.length - 1];
  if (!last) return { state: "never" };

  return { state: "rested", days: daysBetween(last, nowIso), since: last };
}

/**
 * When a paddock next comes eligible, and whether it is there yet.
 *
 * Null when there is no target — a plan with no recovery figure for this
 * paddock gets silence, not a default. This app does not invent a recovery
 * period; that is an agronomic recommendation it has no standing to make.
 */
export function nextEligible(
  rest: ReturnType<typeof restDays>,
  recoveryDays: number | null,
): { readyOn: string; met: boolean; shortBy: number } | null {
  if (recoveryDays === null || rest.state !== "rested") return null;
  const ready = new Date(rest.since);
  ready.setDate(ready.getDate() + recoveryDays);
  const readyOn = ready.toISOString().slice(0, 10);
  return { readyOn, met: rest.days >= recoveryDays, shortBy: Math.max(0, recoveryDays - rest.days) };
}

export interface BoardRow {
  paddock: Paddock;
  rest: ReturnType<typeof restDays>;
  /** The mob in it now, when there is one. */
  occupant: { event: GrazingEvent; group: GrazingGroup | null; days: number } | null;
  /** Literally the last grazing — a cutting does not go here. Rest counts a
   * cutting; this column is about cattle, and conflating the two would make
   * the date column unable to answer either question. */
  lastGrazed: string | null;
  /** The most recent cutting off this unit, when there has been one. */
  lastCut: ForageRemoval | null;
  lastResidualIn: number | null;
  eligible: ReturnType<typeof nextEligible>;
}

/**
 * The paddock board: every unit, longest-rested first, so the next paddock to
 * graze is at the top.
 *
 * Occupied units sort last rather than first. They are not candidates — the
 * question this list answers is "where do they go next".
 */
export function boardRows(input: {
  paddocks: Paddock[];
  events: GrazingEvent[];
  groups: GrazingGroup[];
  targets: PlanPaddockTarget[];
  nowIso: string;
  /** Hay off the units. Optional so the board still works before anything is
   * cut, but rest is wrong without it on a farm that makes hay. */
  removals?: ForageRemoval[];
  /** Which recovery figure applies today. The plan holds both. */
  season?: "growing" | "dormant";
}): BoardRow[] {
  const { paddocks, events, groups, targets, nowIso, removals = [], season = "growing" } = input;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const targetFor = new Map(targets.map((t) => [t.paddockId, t]));

  const rows = paddocks
    .filter((p) => p.active)
    .map((paddock): BoardRow => {
      const rest = restDays(paddock.id, events, nowIso, removals);
      const open = openEventFor(paddock.id, events);
      const target = targetFor.get(paddock.id);
      const recovery = target
        ? season === "dormant"
          ? target.minRecoveryDaysDormant
          : target.minRecoveryDaysGrowing
        : null;

      const hers = events
        .filter((e) => e.paddockId === paddock.id && e.exitedAt !== null)
        .sort((a, b) => (a.exitedAt! < b.exitedAt! ? 1 : -1));

      const cuts = removals
        .filter((r) => r.paddockId === paddock.id)
        .sort((a, b) => b.removedOn.localeCompare(a.removedOn));

      return {
        paddock,
        rest,
        occupant: open
          ? { event: open, group: groupById.get(open.groupId) ?? null, days: occupancyDays(open, nowIso) }
          : null,
        lastGrazed: hers[0]?.exitedAt ?? open?.enteredAt ?? null,
        lastCut: cuts[0] ?? null,
        lastResidualIn: hers[0]?.residualHeightInExit ?? null,
        eligible: nextEligible(rest, recovery ?? null),
      };
    });

  // Longest rest first; never-grazed above occupied but below anything with a
  // real rest figure, because "never grazed" is a candidate without a number.
  const rank = (r: BoardRow) => (r.rest.state === "occupied" ? -2 : r.rest.state === "never" ? -1 : r.rest.days);
  return rows.sort((a, b) => rank(b) - rank(a) || a.paddock.name.localeCompare(b.paddock.name));
}

/** Head in a group: the members, unless a figure was stated. */
export function groupHeadCount(group: GrazingGroup, members: GrazingGroupMember[]): number | null {
  if (group.headCountManual !== null) return group.headCountManual;
  const open = members.filter((m) => m.groupId === group.id && m.leftOn === null);
  return open.length > 0 ? open.length : null;
}

/**
 * Average weight across the group, from each member's most recent weighing.
 *
 * Null when nobody has been weighed — the move form then leaves it blank
 * rather than filling in a number nobody measured.
 */
export function groupAvgWeightLb(
  group: GrazingGroup,
  members: GrazingGroupMember[],
  latestWeightLb: Map<string, number>,
): number | null {
  if (group.avgWeightLbManual !== null) return group.avgWeightLbManual;
  const weights = members
    .filter((m) => m.groupId === group.id && m.leftOn === null)
    .map((m) => latestWeightLb.get(m.animalId))
    .filter((w): w is number => w !== undefined);
  if (weights.length === 0) return null;
  return weights.reduce((a, b) => a + b, 0) / weights.length;
}

// ─── the rest of the reads, and the writes ─────────────────────────────

export async function fetchGroupMembers(farmId: string): Promise<GrazingGroupMember[]> {
  const { data, error } = await herdSchema()
    .from("grazing_group_members")
    .select("id, group_id, animal_id, joined_on, left_on")
    .eq("farm_id", farmId)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.grazing_group_members: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    groupId: r.group_id as string,
    animalId: r.animal_id as string,
    joinedOn: (r.joined_on as string) ?? null,
    leftOn: (r.left_on as string) ?? null,
  }));
}

/**
 * Each animal's most recent weight.
 *
 * From `herd.weights`, which predates this module and is where weights
 * belong — dated rows, so a heifer's April figure stays her April figure.
 * Empty is expected until somebody weighs something.
 */
export async function fetchLatestWeights(farmId: string): Promise<Map<string, number>> {
  const { data, error } = await herdSchema()
    .from("weights")
    .select("animal_id, date, weight_lb")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw new Error(`herd.weights: ${error.message}`);

  const latest = new Map<string, number>();
  for (const r of (data ?? []) as { animal_id: string; weight_lb: number }[]) {
    // Ordered newest first, so the first one seen per animal is the latest.
    if (!latest.has(r.animal_id)) latest.set(r.animal_id, Number(r.weight_lb));
  }
  return latest;
}

export interface MoveDraft {
  paddockId: string;
  groupId: string;
  /** ISO instant. Defaults to now in the form, and is editable — which is
   * what makes logging from the house an hour later an accurate record
   * rather than an approximation. */
  at: string;
  headCount: number | null;
  avgWeightLb: number | null;
  forageHeightInEntry: number | null;
  soilMoisture: SoilMoisture | null;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  /** These describe the paddock being *left*, not the one being entered. */
  residualHeightInExit: number | null;
  utilizationPct: number | null;
  /** Where the wire went, as fractions along the unit's sweep. Null on both
   * for a unit taken whole. */
  sweptFrom: number | null;
  sweptTo: number | null;
}

/**
 * One move: they leave where they were and arrive where they are going, at
 * the same instant.
 *
 * An RPC because it is two writes that have to land together — see migration
 * 038. Doing it from here would risk a mob closed out of one paddock and in
 * none.
 */
export async function logMove(farmId: string, draft: MoveDraft): Promise<string> {
  const { data, error } = await herdSchema().rpc("log_grazing_move", {
    p_farm_id: farmId,
    p_group_id: draft.groupId,
    p_paddock_id: draft.paddockId,
    p_at: draft.at,
    p_head_count: draft.headCount,
    p_avg_weight_lb: draft.avgWeightLb,
    p_forage_height_in_entry: draft.forageHeightInEntry,
    p_soil_moisture: draft.soilMoisture,
    p_notes: draft.notes,
    p_latitude: draft.latitude,
    p_longitude: draft.longitude,
    p_residual_height_in_exit: draft.residualHeightInExit,
    p_utilization_pct: draft.utilizationPct,
    p_swept_from: draft.sweptFrom,
    p_swept_to: draft.sweptTo,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Off pasture entirely — a close with no arrival. */
export async function endGrazing(
  farmId: string,
  groupId: string,
  at: string,
  residualHeightInExit: number | null,
  utilizationPct: number | null,
): Promise<void> {
  const { error } = await herdSchema().rpc("end_grazing", {
    p_farm_id: farmId,
    p_group_id: groupId,
    p_at: at,
    p_residual_height_in_exit: residualHeightInExit,
    p_utilization_pct: utilizationPct,
  });
  if (error) throw new Error(error.message);
}

/** Fill in what the last move said, so the common case is one tap and a
 * paddock. Nothing here is a measurement — it is the previous reading, and
 * the form lets it be corrected. */
export function prefillFrom(
  last: GrazingEvent | null,
  headCount: number | null,
  avgWeightLb: number | null,
): Pick<MoveDraft, "headCount" | "avgWeightLb" | "forageHeightInEntry"> {
  return {
    headCount: headCount ?? last?.headCount ?? null,
    avgWeightLb: avgWeightLb ?? last?.avgWeightLb ?? null,
    forageHeightInEntry: null,
  };
}

// ─── strips ────────────────────────────────────────────────────────────
//
// A unit swept in one fixed direction turns the wire into a single number:
// how far along the sweep it sits. A strip is the interval between the last
// wire and this one, and everything below is arithmetic on those intervals.
//
// Two consequences worth keeping in view. The strip's acres are a *fraction*
// of the unit's acres, so all of this works with no coordinates and no map.
// And "when was this ground last grazed" is a one-dimensional interval
// query, so strips from different passes may overlap however they like —
// which is the case the old paddock-with-a-rest-clock model could not hold.

/** Which way the mob advances, in words, for a heading in degrees. */
export function sweepInWords(headingDeg: number | null): string | null {
  if (headingDeg === null) return null;
  const from = (headingDeg + 180) % 360;
  const name = (d: number) => {
    const compass = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
    return compass[Math.round(((d % 360) + 360) % 360 / 45) % 8];
  };
  return `${name(from)} to ${name(headingDeg)}`;
}

/** Is this unit strip-grazed, or taken whole? */
export const isSwept = (p: Paddock): boolean => p.sweepHeadingDeg !== null;

/** The acres a strip covers — a fraction of the unit's grazable acres. Null
 * when either the fractions or the acres are unknown, rather than guessed. */
export function stripAcres(event: GrazingEvent, paddock: Paddock): number | null {
  const acres = paddock.acresGrazable ?? paddock.acresMeasured;
  if (acres === null) return null;
  if (event.sweptFrom === null || event.sweptTo === null) return acres; // whole unit
  return (event.sweptTo - event.sweptFrom) * acres;
}

/** Feet along the sweep, when the unit's length is on file. */
export function stripWidthFt(event: GrazingEvent, paddock: Paddock): number | null {
  if (paddock.sweepLengthFt === null || event.sweptFrom === null || event.sweptTo === null) return null;
  return (event.sweptTo - event.sweptFrom) * paddock.sweepLengthFt;
}

/**
 * The strips of the pass currently under way in a unit, oldest first.
 *
 * A pass is a run of strips that advance without going back. When the wire
 * returns to the start, that is a new pass — so the run is found by walking
 * backwards from the newest strip while each one begins where the last
 * ended, and stopping at the break.
 */
export function currentPass(paddockId: string, events: GrazingEvent[]): GrazingEvent[] {
  const strips = events
    .filter((e) => e.paddockId === paddockId && e.sweptFrom !== null)
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
  if (strips.length === 0) return [];

  const run: GrazingEvent[] = [strips[strips.length - 1]];
  for (let i = strips.length - 2; i >= 0; i--) {
    // Tolerance because a wire is placed by eye and recorded to two places.
    if (strips[i].sweptTo! <= run[0].sweptFrom! + 0.001) run.unshift(strips[i]);
    else break;
  }
  return run;
}

/** How much of the unit the current pass has taken, 0–1. */
export function sweptSoFar(paddockId: string, events: GrazingEvent[]): number {
  const pass = currentPass(paddockId, events);
  return pass.length === 0 ? 0 : Math.max(...pass.map((e) => e.sweptTo ?? 0));
}

/**
 * When a position along the sweep was last grazed.
 *
 * The whole point of the redesign: ask the ground, not the unit. Intervals
 * from different passes overlap freely and it does not matter, because the
 * question is answered per position. Null means never.
 */
export function lastGrazedAt(
  paddockId: string,
  position: number,
  events: GrazingEvent[],
): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (e.paddockId !== paddockId) continue;
    const covers =
      e.sweptFrom === null || e.sweptTo === null
        ? true // a whole-unit grazing covers every position
        : position >= e.sweptFrom && position <= e.sweptTo;
    if (!covers) continue;
    const when = e.exitedAt ?? e.enteredAt;
    if (latest === null || when > latest) latest = when;
  }
  return latest;
}

/**
 * When a position was last taken down to the ground — by cattle or by a mower.
 *
 * A strip covers an interval. **A cutting covers the whole unit**, because
 * nobody mows a strip: the machine goes over the lot. So a removal beats every
 * position at once, which is why it is not simply another interval in the same
 * list.
 *
 * This, not `lastGrazedAt`, is what rest should be measured from. The two are
 * kept apart rather than merged because the board legitimately wants both —
 * "rested 12 days" and "last grazed 3 June" are different facts about the same
 * paddock, and a unit cut in between makes them differ by a month.
 */
export function lastDefoliatedAt(
  paddockId: string,
  position: number,
  events: GrazingEvent[],
  removals: ForageRemoval[] = [],
): string | null {
  let latest = lastGrazedAt(paddockId, position, events);
  for (const r of removals) {
    if (r.paddockId !== paddockId) continue;
    const when = `${r.removedOn}T23:59:59.999Z`;
    if (latest === null || when > latest) latest = when;
  }
  return latest;
}

export interface SweepBand {
  from: number;
  to: number;
  /** Null when this stretch has never been grazed or cut. */
  lastGrazed: string | null;
  restDays: number | null;
  /** True while the mob is standing on it. */
  occupied: boolean;
}

/**
 * The unit's ground, cut into bands at every wire position that has ever
 * been used in it, each band carrying its own rest.
 *
 * Bands rather than a fixed grid: the only places rest can change are where
 * a wire has been, so the boundaries come from the data instead of from an
 * arbitrary cell size. A unit grazed whole is one band.
 */
export function sweepBands(
  paddockId: string,
  events: GrazingEvent[],
  nowIso: string,
  removals: ForageRemoval[] = [],
): SweepBand[] {
  const mine = events.filter((e) => e.paddockId === paddockId);
  const cut = removals.filter((r) => r.paddockId === paddockId);

  if (mine.length === 0) {
    // A unit only ever cut is one band, evenly rested — the mower took the
    // whole thing, so there is nothing to divide it at.
    const at = lastDefoliatedAt(paddockId, 0.5, [], cut);
    return [
      {
        from: 0,
        to: 1,
        lastGrazed: at,
        restDays: at === null ? null : daysBetween(at, nowIso),
        occupied: false,
      },
    ];
  }

  const cuts = new Set<number>([0, 1]);
  for (const e of mine) {
    if (e.sweptFrom !== null) cuts.add(e.sweptFrom);
    if (e.sweptTo !== null) cuts.add(e.sweptTo);
  }
  const edges = [...cuts].sort((a, b) => a - b);

  const bands: SweepBand[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i];
    const to = edges[i + 1];
    if (to - from < 0.0005) continue;
    const mid = (from + to) / 2;

    const lastGrazed = lastDefoliatedAt(paddockId, mid, mine, cut);
    const occupied = mine.some(
      (e) =>
        e.exitedAt === null &&
        (e.sweptFrom === null || (mid >= e.sweptFrom && mid <= (e.sweptTo ?? 1))),
    );

    bands.push({
      from,
      to,
      lastGrazed,
      restDays: lastGrazed === null ? null : daysBetween(lastGrazed, nowIso),
      occupied,
    });
  }
  return bands;
}

/**
 * How ready a unit is for the next pass.
 *
 * Not the days since it was last touched. With a fixed sweep the mob
 * re-enters where it entered last time, so the ground that decides
 * readiness is the ground at the *start* of the sweep — grazed first last
 * pass, and rested longest since. Measuring from the last strip instead
 * would hold a unit back for weeks after it was already fit to graze.
 */
export function readinessDays(
  paddockId: string,
  events: GrazingEvent[],
  nowIso: string,
  removals: ForageRemoval[] = [],
): number | null {
  // A cutting resets this outright. The argument about measuring from the
  // start of the sweep is an argument about where the *cattle* re-enter; a
  // mower does not re-enter anywhere, it takes the lot, and after it has been
  // through there is no rested end to come back to.
  const at = lastDefoliatedAt(paddockId, 0.02, events, removals);
  return at === null ? null : daysBetween(at, nowIso);
}

export interface StripPlan {
  acres: number;
  /** At the plan's assumptions. Hours, because strips can be half a day. */
  hoursOfFeed: number | null;
  lbPerAcre: number | null;
  widthFt: number | null;
}

export interface ForageAssumptions {
  standingLbDmPerAcre: number;
  utilizationPct: number;
  intakePctBodyweight: number;
}

/** Which of the three figures came from the farm's own records, and which
 * are still the app's stated fallback. The UI names them, so a forecast is
 * never mistaken for one built on measurements. */
export interface AssumptionSources {
  standing: "measured" | "planned" | "default";
  utilization: "plan" | "default";
  intake: "plan" | "default";
}

/**
 * The three figures the strip readout divides by, taken from the farm's own
 * records wherever they exist.
 *
 * Before the plan editor these were constants in the page with a comment
 * saying they belonged in the plan. They now come from it: intake from the
 * plan's default, utilization from the paddock's target, and standing forage
 * from the most recent availability record covering today for that unit.
 *
 * **The fallbacks stay, and are labelled.** The alternative — showing nothing
 * until a plan is written — would take away a working tool on the first day
 * somebody opens the app, and the honest middle is to compute the forecast
 * and say plainly which figures are the farm's and which are the app's.
 */
export function assumptionsFor(input: {
  paddockId: string;
  plan: GrazingPlan | null;
  targets: PlanPaddockTarget[];
  availability: ForageAvailability[];
  todayIso: string;
  fallback: ForageAssumptions;
}): { assumptions: ForageAssumptions; sources: AssumptionSources } {
  const { paddockId, plan, targets, availability, todayIso, fallback } = input;
  const day = todayIso.slice(0, 10);

  const target = targets.find((t) => t.paddockId === paddockId) ?? null;

  // Prefer a window that covers today; failing that, the most recent one that
  // has already started. A figure measured for June says nothing useful about
  // October, but it beats a constant.
  const mine = availability
    .filter((a) => a.paddockId === paddockId && a.lbDmPerAcre !== null && a.periodStart <= day)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const covering = mine.find((a) => a.periodEnd >= day) ?? mine[0] ?? null;

  return {
    assumptions: {
      standingLbDmPerAcre: covering?.lbDmPerAcre ?? fallback.standingLbDmPerAcre,
      utilizationPct: target?.targetUtilizationPct ?? fallback.utilizationPct,
      intakePctBodyweight: plan?.defaultDmiPctBw ?? fallback.intakePctBodyweight,
    },
    sources: {
      standing: covering === null ? "default" : covering.isPlanned ? "planned" : "measured",
      utilization: target?.targetUtilizationPct === undefined || target?.targetUtilizationPct === null ? "default" : "plan",
      intake: plan?.defaultDmiPctBw == null ? "default" : "plan",
    },
  };
}

/**
 * What a strip of this width would be — the arithmetic behind sizing the
 * wire before the mob is let in.
 *
 * Every input is the farm's: standing forage, utilization and intake come
 * from the plan, head and weight from the animal records. Nothing here is a
 * constant of this app's choosing, and the result is a forecast rather than
 * a measurement.
 */
export function planStrip(input: {
  paddock: Paddock;
  from: number;
  to: number;
  headCount: number | null;
  avgWeightLb: number | null;
  assumptions: ForageAssumptions;
}): StripPlan | null {
  const { paddock, from, to, headCount, avgWeightLb, assumptions } = input;
  const unitAcres = paddock.acresGrazable ?? paddock.acresMeasured;
  if (unitAcres === null || to <= from) return null;

  const acres = (to - from) * unitAcres;
  const usablePerAcre = assumptions.standingLbDmPerAcre * (assumptions.utilizationPct / 100);
  const dailyIntake =
    headCount === null || avgWeightLb === null
      ? null
      : headCount * avgWeightLb * (assumptions.intakePctBodyweight / 100);

  return {
    acres,
    hoursOfFeed: dailyIntake === null || dailyIntake <= 0 ? null : (acres * usablePerAcre * 24) / dailyIntake,
    lbPerAcre: headCount === null || avgWeightLb === null ? null : (headCount * avgWeightLb) / acres,
    widthFt: paddock.sweepLengthFt === null ? null : (to - from) * paddock.sweepLengthFt,
  };
}

/**
 * The width that would hold them for a given number of hours — the question
 * asked backwards, which is how the wire actually gets placed.
 */
export function widthForHours(input: {
  paddock: Paddock;
  hours: number;
  headCount: number | null;
  avgWeightLb: number | null;
  assumptions: ForageAssumptions;
}): number | null {
  const { paddock, hours, headCount, avgWeightLb, assumptions } = input;
  const unitAcres = paddock.acresGrazable ?? paddock.acresMeasured;
  if (unitAcres === null || unitAcres <= 0) return null;
  if (headCount === null || avgWeightLb === null) return null;

  const usablePerAcre = assumptions.standingLbDmPerAcre * (assumptions.utilizationPct / 100);
  if (usablePerAcre <= 0) return null;

  const dailyIntake = headCount * avgWeightLb * (assumptions.intakePctBodyweight / 100);
  const acres = (dailyIntake * (hours / 24)) / usablePerAcre;
  return Math.min(1, acres / unitAcres);
}

/**
 * The map layer: fences, water, gates and the rest.
 *
 * Ordered by kind so the map draws in a stable order and the legend beside it
 * does not reshuffle between loads.
 */
export async function fetchInfrastructure(farmId: string): Promise<Infrastructure[]> {
  const { data, error } = await herdSchema()
    .from("infrastructure")
    .select(
      "id, paddock_id, kind, name, geometry, status, install_date, condition, nrcs_practice_code, active, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("kind")
    .order("name");
  if (error) throw new Error(`herd.infrastructure: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    paddockId: (r.paddock_id as string) ?? null,
    kind: r.kind as InfrastructureKind,
    name: (r.name as string) ?? null,
    geometry: r.geometry ?? null,
    status: r.status as InfrastructureStatus,
    installDate: (r.install_date as string) ?? null,
    condition: (r.condition as string) ?? null,
    nrcsPracticeCode: (r.nrcs_practice_code as string) ?? null,
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  }));
}

// ─── the plan ──────────────────────────────────────────────────────────

export async function fetchPlans(farmId: string): Promise<GrazingPlan[]> {
  const { data, error } = await herdSchema()
    .from("grazing_plans")
    .select(
      "id, name, period_start, period_end, contract_number, tract_number, field_ids, long_term_goals, immediate_objectives, benchmark_stocking_rate_aum_per_acre, monitoring_cadence_kind, monitoring_cadence_value, default_dmi_pct_bw, active, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("period_start", { ascending: false });
  if (error) throw new Error(`herd.grazing_plans: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    periodStart: (r.period_start as string) ?? null,
    periodEnd: (r.period_end as string) ?? null,
    contractNumber: (r.contract_number as string) ?? null,
    tractNumber: (r.tract_number as string) ?? null,
    fieldIds: (r.field_ids as string) ?? null,
    longTermGoals: (r.long_term_goals as string) ?? null,
    immediateObjectives: (r.immediate_objectives as string) ?? null,
    benchmarkStockingRateAumPerAcre: num(r.benchmark_stocking_rate_aum_per_acre),
    monitoringCadenceKind: r.monitoring_cadence_kind as MonitoringCadenceKind,
    monitoringCadenceValue: num(r.monitoring_cadence_value),
    defaultDmiPctBw: num(r.default_dmi_pct_bw),
    active: Boolean(r.active),
    notes: (r.notes as string) ?? null,
  }));
}

export interface PlanDraft {
  /** Null starts a new plan, which supersedes the one in force. See 042 —
   * the swap happens inside one transaction so there is never a moment with
   * two active plans or none. */
  planId: string | null;
  name: string;
  periodStart: string | null;
  periodEnd: string | null;
  contractNumber: string;
  tractNumber: string;
  fieldIds: string;
  longTermGoals: string;
  immediateObjectives: string;
  benchmarkStockingRateAumPerAcre: number | null;
  monitoringCadenceKind: MonitoringCadenceKind;
  monitoringCadenceValue: number | null;
  defaultDmiPctBw: number | null;
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

export async function savePlan(farmId: string, draft: PlanDraft): Promise<string> {
  const { data, error } = await herdSchema().rpc("save_grazing_plan", {
    p_farm_id: farmId,
    p_plan_id: draft.planId,
    p_name: draft.name,
    p_period_start: draft.periodStart,
    p_period_end: draft.periodEnd,
    p_contract_number: orNull(draft.contractNumber),
    p_tract_number: orNull(draft.tractNumber),
    p_field_ids: orNull(draft.fieldIds),
    p_long_term_goals: orNull(draft.longTermGoals),
    p_immediate_objectives: orNull(draft.immediateObjectives),
    p_benchmark_stocking_rate_aum_per_acre: draft.benchmarkStockingRateAumPerAcre,
    p_monitoring_cadence_kind: draft.monitoringCadenceKind,
    p_monitoring_cadence_value: draft.monitoringCadenceValue,
    p_default_dmi_pct_bw: draft.defaultDmiPctBw,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface TargetDraft {
  planId: string;
  paddockId: string;
  targetEntryHeightIn: number | null;
  targetResidualHeightIn: number | null;
  /** Two figures, never one: thirty days in June and thirty in September are
   * not the same rest, and a single number is the assumption that gets
   * paddocks hurt. */
  minRecoveryDaysGrowing: number | null;
  minRecoveryDaysDormant: number | null;
  targetUtilizationPct: number | null;
  plannedGrazingNotes: string;
  plannedDefermentNotes: string;
  sensitiveAreaStrategy: string;
  notes: string;
}

export async function savePaddockTarget(farmId: string, draft: TargetDraft): Promise<string> {
  const { data, error } = await herdSchema().rpc("save_paddock_target", {
    p_farm_id: farmId,
    p_plan_id: draft.planId,
    p_paddock_id: draft.paddockId,
    p_target_entry_height_in: draft.targetEntryHeightIn,
    p_target_residual_height_in: draft.targetResidualHeightIn,
    p_min_recovery_days_growing: draft.minRecoveryDaysGrowing,
    p_min_recovery_days_dormant: draft.minRecoveryDaysDormant,
    p_target_utilization_pct: draft.targetUtilizationPct,
    p_planned_grazing_notes: orNull(draft.plannedGrazingNotes),
    p_planned_deferment_notes: orNull(draft.plannedDefermentNotes),
    p_sensitive_area_strategy: orNull(draft.sensitiveAreaStrategy),
    p_notes: orNull(draft.notes),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchResourceConcerns(planId: string): Promise<PlanResourceConcern[]> {
  const { data, error } = await herdSchema()
    .from("plan_resource_concerns")
    .select("id, plan_id, category, concern, notes")
    .eq("plan_id", planId)
    .is("deleted_at", null)
    .order("category");
  if (error) throw new Error(`herd.plan_resource_concerns: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: r.plan_id as string,
    category: r.category as ResourceCategory,
    concern: r.concern as string,
    notes: (r.notes as string) ?? null,
  }));
}

export async function addResourceConcern(
  farmId: string,
  planId: string,
  category: ResourceCategory,
  concern: string,
  notes: string,
): Promise<string> {
  const { data, error } = await herdSchema()
    .from("plan_resource_concerns")
    .insert({ farm_id: farmId, plan_id: planId, category, concern: concern.trim(), notes: notes.trim() || null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function fetchContingencyPlans(planId: string): Promise<ContingencyPlan[]> {
  const { data, error } = await herdSchema()
    .from("contingency_plans")
    .select("id, plan_id, trigger_type, trigger_threshold, planned_response, holding_area_id, notes")
    .eq("plan_id", planId)
    .is("deleted_at", null)
    .order("trigger_type");
  if (error) throw new Error(`herd.contingency_plans: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: r.plan_id as string,
    triggerType: r.trigger_type as ContingencyTrigger,
    triggerThreshold: (r.trigger_threshold as string) ?? null,
    plannedResponse: (r.planned_response as string) ?? null,
    holdingAreaId: (r.holding_area_id as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export interface ContingencyDraft {
  planId: string;
  triggerType: ContingencyTrigger;
  /** What actually trips it, in the farm's own terms. A trigger with no
   * threshold is a worry rather than a plan. */
  triggerThreshold: string;
  plannedResponse: string;
  holdingAreaId: string | null;
  notes: string;
}

export async function addContingency(farmId: string, draft: ContingencyDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("contingency_plans")
    .insert({
      farm_id: farmId,
      plan_id: draft.planId,
      trigger_type: draft.triggerType,
      trigger_threshold: orNull(draft.triggerThreshold),
      planned_response: orNull(draft.plannedResponse),
      holding_area_id: draft.holdingAreaId,
      notes: draft.notes.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function fetchManagementDecisions(farmId: string): Promise<ManagementDecision[]> {
  const { data, error } = await herdSchema()
    .from("management_decisions")
    .select(
      "id, plan_id, decided_on, observation, trigger_description, decision, contingency_plan_id, monitoring_record_id, grazing_event_id, outcome_followup, followed_up_on",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("decided_on", { ascending: false });
  if (error) throw new Error(`herd.management_decisions: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: (r.plan_id as string) ?? null,
    decidedOn: r.decided_on as string,
    observation: (r.observation as string) ?? null,
    triggerDescription: (r.trigger_description as string) ?? null,
    decision: (r.decision as string) ?? null,
    contingencyPlanId: (r.contingency_plan_id as string) ?? null,
    monitoringRecordId: (r.monitoring_record_id as string) ?? null,
    grazingEventId: (r.grazing_event_id as string) ?? null,
    outcomeFollowup: (r.outcome_followup as string) ?? null,
    followedUpOn: (r.followed_up_on as string) ?? null,
  }));
}

export interface DecisionDraft {
  planId: string | null;
  decidedOn: string;
  observation: string;
  triggerDescription: string;
  decision: string;
  contingencyPlanId: string | null;
  outcomeFollowup: string;
  followedUpOn: string | null;
}

export async function recordDecision(farmId: string, draft: DecisionDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("management_decisions")
    .insert({
      farm_id: farmId,
      plan_id: draft.planId,
      decided_on: draft.decidedOn,
      observation: orNull(draft.observation),
      trigger_description: orNull(draft.triggerDescription),
      decision: orNull(draft.decision),
      contingency_plan_id: draft.contingencyPlanId,
      outcome_followup: orNull(draft.outcomeFollowup),
      followed_up_on: draft.followedUpOn,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ─── monitoring, key areas and photo points ────────────────────────────

export async function fetchKeyAreas(farmId: string): Promise<KeyArea[]> {
  const { data, error } = await herdSchema()
    .from("key_areas")
    .select("id, paddock_id, name, latitude, longitude, photo_azimuth_deg, description, active")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`herd.key_areas: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    paddockId: r.paddock_id as string,
    name: r.name as string,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    photoAzimuthDeg: num(r.photo_azimuth_deg),
    description: (r.description as string) ?? null,
    active: Boolean(r.active),
  }));
}

export interface KeyAreaDraft {
  paddockId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** Same spot, same direction, or the photo series is just pictures of
   * grass. */
  photoAzimuthDeg: number | null;
  description: string;
}

export async function createKeyArea(farmId: string, draft: KeyAreaDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("key_areas")
    .insert({
      farm_id: farmId,
      paddock_id: draft.paddockId,
      name: draft.name.trim(),
      latitude: draft.latitude,
      longitude: draft.longitude,
      photo_azimuth_deg: draft.photoAzimuthDeg,
      description: draft.description.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function fetchMonitoringRecords(farmId: string): Promise<MonitoringRecord[]> {
  const { data, error } = await herdSchema()
    .from("monitoring_records")
    .select(
      "id, key_area_id, plan_id, observed_on, protocol, residual_height_in, ground_cover_pct, litter_pct, bare_ground_pct, species_composition, key_plant_vigor, erosion_observations, compaction_observations, observer, notes, latitude, longitude",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("observed_on", { ascending: false });
  if (error) throw new Error(`herd.monitoring_records: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    keyAreaId: r.key_area_id as string,
    planId: (r.plan_id as string) ?? null,
    observedOn: r.observed_on as string,
    protocol: (r.protocol as string) ?? null,
    residualHeightIn: num(r.residual_height_in),
    groundCoverPct: num(r.ground_cover_pct),
    litterPct: num(r.litter_pct),
    bareGroundPct: num(r.bare_ground_pct),
    speciesComposition: (r.species_composition as string) ?? null,
    keyPlantVigor: (r.key_plant_vigor as string) ?? null,
    erosionObservations: (r.erosion_observations as string) ?? null,
    compactionObservations: (r.compaction_observations as string) ?? null,
    observer: (r.observer as string) ?? null,
    notes: (r.notes as string) ?? null,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
  }));
}

export interface MonitoringDraft {
  keyAreaId: string;
  planId: string | null;
  observedOn: string;
  protocol: string;
  residualHeightIn: number | null;
  groundCoverPct: number | null;
  litterPct: number | null;
  bareGroundPct: number | null;
  speciesComposition: string;
  keyPlantVigor: string;
  erosionObservations: string;
  compactionObservations: string;
  observer: string;
  notes: string;
}

export async function recordMonitoring(farmId: string, draft: MonitoringDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("monitoring_records")
    .insert({
      farm_id: farmId,
      key_area_id: draft.keyAreaId,
      plan_id: draft.planId,
      observed_on: draft.observedOn,
      protocol: draft.protocol.trim() || null,
      residual_height_in: draft.residualHeightIn,
      ground_cover_pct: draft.groundCoverPct,
      litter_pct: draft.litterPct,
      bare_ground_pct: draft.bareGroundPct,
      species_composition: draft.speciesComposition.trim() || null,
      key_plant_vigor: draft.keyPlantVigor.trim() || null,
      erosion_observations: draft.erosionObservations.trim() || null,
      compaction_observations: draft.compactionObservations.trim() || null,
      observer: draft.observer.trim() || null,
      notes: draft.notes.trim(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function fetchGrazingPhotos(farmId: string): Promise<GrazingPhoto[]> {
  const { data, error } = await herdSchema()
    .from("grazing_photos")
    .select("id, grazing_event_id, monitoring_record_id, storage_path, caption, taken_at, latitude, longitude")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("taken_at", { ascending: false });
  if (error) throw new Error(`herd.grazing_photos: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    grazingEventId: (r.grazing_event_id as string) ?? null,
    monitoringRecordId: (r.monitoring_record_id as string) ?? null,
    storagePath: r.storage_path as string,
    caption: (r.caption as string) ?? null,
    takenAt: (r.taken_at as string) ?? null,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
  }));
}

// ─── supply and demand ─────────────────────────────────────────────────

export async function fetchForageAvailability(farmId: string): Promise<ForageAvailability[]> {
  const { data, error } = await herdSchema()
    .from("forage_availability")
    .select(
      "id, plan_id, paddock_id, period_start, period_end, period_label, lb_dm_per_acre, aum, species_mix, quality_note, is_planned, basis, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("period_start");
  if (error) throw new Error(`herd.forage_availability: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: (r.plan_id as string) ?? null,
    paddockId: r.paddock_id as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    periodLabel: (r.period_label as string) ?? null,
    lbDmPerAcre: num(r.lb_dm_per_acre),
    aum: num(r.aum),
    speciesMix: (r.species_mix as string) ?? null,
    qualityNote: (r.quality_note as string) ?? null,
    isPlanned: Boolean(r.is_planned),
    basis: (r.basis as AvailabilityBasis) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export async function fetchForageDemand(farmId: string): Promise<ForageDemand[]> {
  const { data, error } = await herdSchema()
    .from("forage_demand")
    .select(
      "id, plan_id, paddock_id, group_id, kind, period_start, period_end, period_label, head_count, animal_class, avg_weight_lb, dmi_pct_bw, demand_lb_dm, demand_aum, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("period_start");
  if (error) throw new Error(`herd.forage_demand: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    planId: (r.plan_id as string) ?? null,
    paddockId: (r.paddock_id as string) ?? null,
    groupId: (r.group_id as string) ?? null,
    kind: r.kind as DemandKind,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    periodLabel: (r.period_label as string) ?? null,
    headCount: num(r.head_count),
    animalClass: (r.animal_class as string) ?? null,
    avgWeightLb: num(r.avg_weight_lb),
    dmiPctBw: num(r.dmi_pct_bw),
    demandLbDm: num(r.demand_lb_dm),
    demandAum: num(r.demand_aum),
    notes: (r.notes as string) ?? null,
  }));
}

export interface AvailabilityDraft {
  paddockId: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  lbDmPerAcre: number | null;
  aum: number | null;
  speciesMix: string;
  qualityNote: string;
  /** A projection shown as a measurement is a lie a reviewer will catch, so
   * this is asked for rather than assumed. */
  isPlanned: boolean;
  basis: AvailabilityBasis | null;
  notes: string;
}

export async function recordAvailability(farmId: string, draft: AvailabilityDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("forage_availability")
    .insert({
      farm_id: farmId,
      paddock_id: draft.paddockId,
      period_start: draft.periodStart,
      period_end: draft.periodEnd,
      period_label: draft.periodLabel.trim() || null,
      lb_dm_per_acre: draft.lbDmPerAcre,
      aum: draft.aum,
      species_mix: draft.speciesMix.trim() || null,
      quality_note: draft.qualityNote.trim() || null,
      is_planned: draft.isPlanned,
      basis: draft.basis,
      notes: draft.notes.trim(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export interface DemandDraft {
  /** Null means against the whole farm — the honest shape for wildlife. */
  paddockId: string | null;
  groupId: string | null;
  kind: DemandKind;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  headCount: number | null;
  animalClass: string;
  avgWeightLb: number | null;
  dmiPctBw: number | null;
  demandLbDm: number | null;
  demandAum: number | null;
  notes: string;
}

export async function recordDemand(farmId: string, draft: DemandDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("forage_demand")
    .insert({
      farm_id: farmId,
      paddock_id: draft.paddockId,
      group_id: draft.groupId,
      kind: draft.kind,
      period_start: draft.periodStart,
      period_end: draft.periodEnd,
      period_label: draft.periodLabel.trim() || null,
      head_count: draft.headCount,
      animal_class: draft.animalClass.trim() || null,
      avg_weight_lb: draft.avgWeightLb,
      dmi_pct_bw: draft.dmiPctBw,
      demand_lb_dm: draft.demandLbDm,
      demand_aum: draft.demandAum,
      notes: draft.notes.trim(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ─── hay off the units ─────────────────────────────────────────────────

export async function fetchForageRemovals(farmId: string): Promise<ForageRemoval[]> {
  const { data, error } = await herdSchema()
    .from("forage_removals")
    .select("id, paddock_id, removed_on, kind, cutting_number, yield_lb, yield_basis, notes")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("removed_on", { ascending: false });
  if (error) throw new Error(`herd.forage_removals: ${error.message}`);

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    paddockId: r.paddock_id as string,
    removedOn: r.removed_on as string,
    kind: r.kind as RemovalKind,
    cuttingNumber: num(r.cutting_number) === null ? null : Number(r.cutting_number),
    yieldLb: num(r.yield_lb),
    yieldBasis: (r.yield_basis as "weighed" | "estimated") ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export interface RemovalDraft {
  paddockId: string;
  removedOn: string;
  kind: RemovalKind;
  cuttingNumber: number | null;
  yieldLb: number | null;
  yieldBasis: "weighed" | "estimated" | null;
  notes: string;
}

/**
 * Record hay off a unit.
 *
 * A plain insert rather than an RPC: it is one row, and unlike a move it has
 * no second write that has to land with it. RLS on `forage_removals` is real
 * and was checked from an `authenticated` session, not from the SQL editor.
 */
export async function recordRemoval(farmId: string, draft: RemovalDraft): Promise<string> {
  const { data, error } = await herdSchema()
    .from("forage_removals")
    .insert({
      farm_id: farmId,
      paddock_id: draft.paddockId,
      removed_on: draft.removedOn,
      kind: draft.kind,
      cutting_number: draft.cuttingNumber,
      yield_lb: draft.yieldLb,
      yield_basis: draft.yieldBasis,
      notes: draft.notes.trim(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ─── the rotation, as rounds ───────────────────────────────────────────
//
// A season laid out day by day is the obvious shape and the wrong one. At
// strip-grazing resolution one stay is a fortnight of daily wire moves, and a
// chart fine enough to show a single strip is far too wide for the phone this
// is used on. Worse, it answers a question nobody asks: the grazier's question
// is "how many times have we been round", not "what happened on 14 July".
//
// So the unit of the timeline is the **round** — one trip through the farm.
// It falls straight out of the serpentine, it compresses a fortnight of
// strips into one line, and the figure it puts in front of you is the one
// that matters: how long each unit had to recover before they walked back in.

/** One unbroken stay in a unit, however many wire moves it took. */
export interface Stay {
  paddockId: string;
  enteredAt: string;
  /** Null while they are still in it. */
  exitedAt: string | null;
  /** Wire moves that made up the stay. 1 for a unit taken whole. */
  strips: number;
  days: number;
  /** Ground taken across the whole stay. Null when the unit has no acreage. */
  acres: number | null;
  /** What the unit had rested when they walked in. Null the first time
   * through, which is honest — there was no previous pass to rest from. */
  restBeforeDays: number | null;
  events: GrazingEvent[];
}

export interface Round {
  /** 1-based, in the order they happened. */
  index: number;
  startedAt: string;
  /** Null while the round is still running. */
  endedAt: string | null;
  days: number;
  stays: Stay[];
  /** Cuttings that fell in this round's window. The first round's window runs
   * back to the beginning of the record and the last one's runs to now, so
   * every cutting lands in exactly one round and none is silently dropped. */
  cuttings: ForageRemoval[];
}

/**
 * Consecutive events in the same unit, collapsed into stays.
 *
 * Under strip grazing a stay is many events — one per wire move — and treating
 * each as its own visit would report fourteen visits to a paddock the mob
 * entered once.
 *
 * Same unit is not enough on its own: they have to be **contiguous in time**
 * as well. `log_grazing_move` closes the open event at the very instant it
 * opens the next, so strips within one stay share a boundary exactly. A unit
 * grazed in June and again in August is two visits with two rests, and
 * merging those on the strength of the paddock id alone would erase the rest
 * between them — which is the figure the whole page exists to show.
 */
/** Slack on that boundary. The move function makes it exact; this absorbs a
 * hand-edited timestamp without swallowing a genuine return, which is always
 * days away rather than minutes. */
const STAY_JOIN_MS = 60 * 60 * 1000;
export function staysFrom(input: {
  events: GrazingEvent[];
  paddocks: Paddock[];
  removals?: ForageRemoval[];
  nowIso: string;
}): Stay[] {
  const { events, paddocks, removals = [], nowIso } = input;
  const byId = new Map(paddocks.map((p) => [p.id, p]));
  const ordered = [...events].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));

  const stays: Stay[] = [];
  for (const e of ordered) {
    const open = stays[stays.length - 1];
    const prev = open?.events[open.events.length - 1];
    const joins =
      open !== undefined &&
      open.paddockId === e.paddockId &&
      prev?.exitedAt != null &&
      new Date(e.enteredAt).getTime() - new Date(prev.exitedAt).getTime() <= STAY_JOIN_MS;

    if (joins) open.events.push(e);
    else stays.push({
      paddockId: e.paddockId,
      enteredAt: e.enteredAt,
      exitedAt: null,
      strips: 0,
      days: 0,
      acres: null,
      restBeforeDays: null,
      events: [e],
    });
  }

  return stays.map((s) => {
    const paddock = byId.get(s.paddockId) ?? null;
    const last = s.events[s.events.length - 1];
    const exitedAt = last.exitedAt;

    // Rest before entry: what the ground at the start of the sweep had
    // accumulated, judged only on what was known by then. Events and cuttings
    // after this entry are irrelevant to it and must not leak in — and the
    // stay's own events are excluded by id rather than by date, because an
    // open one has no exit to compare and would otherwise report itself as
    // the previous grazing and a rest of zero.
    const mine = new Set(s.events.map((e) => e.id));
    const before = events.filter((e) => !mine.has(e.id) && (e.exitedAt ?? e.enteredAt) <= s.enteredAt);
    const cutBefore = removals.filter((r) => `${r.removedOn}T23:59:59.999Z` <= s.enteredAt);
    const priorAt = lastDefoliatedAt(s.paddockId, 0.02, before, cutBefore);

    const acres = paddock
      ? s.events.reduce<number | null>((sum, e) => {
          const a = stripAcres(e, paddock);
          return sum === null || a === null ? null : sum + a;
        }, 0)
      : null;

    return {
      ...s,
      exitedAt,
      strips: s.events.length,
      days: daysBetween(s.enteredAt, exitedAt ?? nowIso),
      acres,
      restBeforeDays: priorAt === null ? null : daysBetween(priorAt, s.enteredAt),
    };
  });
}

/**
 * The stays grouped into trips through the farm.
 *
 * A round ends when the mob walks into a unit it has already been in this
 * round. That definition needs no notion of the "correct" order, so it holds
 * when a unit is skipped for wet ground or taken out of turn — which is what
 * actually happens, and what a hardcoded serpentine would get wrong.
 */
export function rotationRounds(input: {
  events: GrazingEvent[];
  paddocks: Paddock[];
  removals?: ForageRemoval[];
  nowIso: string;
}): Round[] {
  const { removals = [], nowIso } = input;
  const stays = staysFrom(input);
  if (stays.length === 0) return [];

  const grouped: Stay[][] = [];
  let current: Stay[] = [];
  let seen = new Set<string>();
  for (const s of stays) {
    if (seen.has(s.paddockId)) {
      grouped.push(current);
      current = [];
      seen = new Set();
    }
    current.push(s);
    seen.add(s.paddockId);
  }
  if (current.length > 0) grouped.push(current);

  return grouped.map((group, i) => {
    const startedAt = group[0].enteredAt;
    const endedAt = group[group.length - 1].exitedAt;
    // Open at both ends where there is no neighbouring round, so no cutting
    // falls between two windows and disappears.
    const from = i === 0 ? "" : startedAt;
    const to = i === grouped.length - 1 ? "9999" : grouped[i + 1][0].enteredAt;

    return {
      index: i + 1,
      startedAt,
      endedAt,
      days: daysBetween(startedAt, endedAt ?? nowIso),
      stays: group,
      cuttings: removals
        .filter((r) => {
          const at = `${r.removedOn}T23:59:59.999Z`;
          return at >= from && at < to;
        })
        .sort((a, b) => a.removedOn.localeCompare(b.removedOn)),
    };
  });
}
