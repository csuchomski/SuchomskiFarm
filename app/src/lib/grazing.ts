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
 * Days of rest a paddock has accumulated since the mob last left it.
 *
 * Null has two distinct meanings and the caller has to tell them apart, so
 * they are separated here rather than collapsed: `occupied` when something is
 * in it now, and null when it has never been grazed at all. A paddock never
 * grazed has not "rested" for the age of the record — it has no history.
 */
export function restDays(
  paddockId: string,
  events: GrazingEvent[],
  nowIso: string,
): { state: "occupied" } | { state: "rested"; days: number; since: string } | { state: "never" } {
  if (openEventFor(paddockId, events)) return { state: "occupied" };

  const exits = events
    .filter((e) => e.paddockId === paddockId && e.exitedAt !== null)
    .map((e) => e.exitedAt!)
    .sort();
  const last = exits[exits.length - 1];
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
  lastGrazed: string | null;
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
  /** Which recovery figure applies today. The plan holds both. */
  season?: "growing" | "dormant";
}): BoardRow[] {
  const { paddocks, events, groups, targets, nowIso, season = "growing" } = input;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const targetFor = new Map(targets.map((t) => [t.paddockId, t]));

  const rows = paddocks
    .filter((p) => p.active)
    .map((paddock): BoardRow => {
      const rest = restDays(paddock.id, events, nowIso);
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

      return {
        paddock,
        rest,
        occupant: open
          ? { event: open, group: groupById.get(open.groupId) ?? null, days: occupancyDays(open, nowIso) }
          : null,
        lastGrazed: hers[0]?.exitedAt ?? open?.enteredAt ?? null,
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

export interface SweepBand {
  from: number;
  to: number;
  /** Null when this stretch has never been grazed. */
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
): SweepBand[] {
  const mine = events.filter((e) => e.paddockId === paddockId);
  if (mine.length === 0) return [{ from: 0, to: 1, lastGrazed: null, restDays: null, occupied: false }];

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

    const lastGrazed = lastGrazedAt(paddockId, mid, mine);
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
): number | null {
  const at = lastGrazedAt(paddockId, 0.02, events);
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
