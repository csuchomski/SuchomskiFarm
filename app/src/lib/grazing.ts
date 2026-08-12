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

export interface PaddockWaterSource {
  id: string;
  paddockId: string;
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
 * Chosen deliberately. The farm already has an aerial from its EQIP plan, one
 * image caches whole, and it renders in a pasture with no signal — which is
 * the condition the map is needed in. A tile service trades that away for
 * zoom the map does not need.
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
  /** A virtual-fence unit is a different shape each time it is grazed. This
   * is that grazing's actual boundary, without redefining the paddock. */
  boundaryOverride: unknown | null;
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
      "id, name, code, acres_measured, acres_grazable, unit_type, seeding_date, fence_type, ecological_site, soil_map_unit, noxious_species, noxious_extent, sensitive_riparian, sensitive_wetland, sensitive_habitat, sensitive_karst, sensitive_high_erosion, heavy_use_notes, boundary, active, notes",
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
      "id, paddock_id, group_id, entered_at, exited_at, head_count, avg_weight_lb, forage_height_in_entry, residual_height_in_exit, utilization_pct, soil_moisture, supplemental_feed, weather_notes, notes, latitude, longitude, boundary_override",
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
    boundaryOverride: r.boundary_override ?? null,
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
