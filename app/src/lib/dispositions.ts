import { herdSchema } from "./supabase";

/**
 * How an animal left the farm.
 *
 * `herd.animals.status` has always allowed 'sold', 'culled', 'processed',
 * 'died' and 'leased_out', and the animal form has always let you pick one.
 * That was the whole of it: *that* she was gone, never when, why or for how
 * much. `herd.dispositions` and its detail tables were there from the start
 * and empty — see migration 060, which is where the rules live.
 *
 * **The database is the authority on the arithmetic.** `saleFigures` here
 * computes the same gross and net for the form to show while it is being
 * typed, and `dispositions.test.ts` pins it to the same worked example the
 * migration was rehearsed against, so the preview and the stored figure
 * cannot drift apart quietly.
 */

/** How she left. The five the `exit_channel` CHECK allows. */
export const EXIT_CHANNELS = [
  { code: "sold_live", label: "Sold live", hint: "Through a barn, or straight to a buyer" },
  { code: "processed", label: "To a processor", hint: "Her money arrives later, as packaged meat" },
  { code: "died_on_farm", label: "Died on the farm", hint: "" },
  { code: "leased_out", label: "Leased out", hint: "Off the farm, still yours" },
  { code: "transferred", label: "Transferred", hint: "To another farm or another owner" },
] as const;

/** How a live sale was made. The four the `channel` CHECK allows — and it is
 *  NOT NULL, so a sale cannot be recorded without one. */
export const SALE_CHANNELS = [
  { code: "auction_barn", label: "Auction barn" },
  { code: "private_treaty", label: "Private treaty" },
  { code: "direct_to_consumer", label: "Direct to a customer" },
  { code: "online", label: "Online" },
] as const;

/** Only a live sale carries money here. A processor's animal earns later as
 *  packaged meat, which migration 058 already credits back to her; booking it
 *  twice is the failure this prevents. */
export const carriesSale = (exitChannel: string): boolean => exitChannel === "sold_live";

export interface CullReason {
  id: string;
  code: string;
  label: string;
  category: string;
}

export interface SaleDetails {
  buyerName: string;
  channel: string;
  saleBarn: string;
  lotNumber: string;
  liveWeightLb: number | null;
  pricePerCwtCents: number | null;
  grossCents: number;
  commissionCents: number;
  haulingCents: number;
  yardageCents: number;
  otherDeductionsCents: number;
  netCents: number;
}

export interface Disposition {
  id: string;
  animalId: string;
  exitChannel: string;
  date: string;
  isCull: boolean;
  cullPrimaryReasonId: string | null;
  cullSecondaryReasonId: string | null;
  cullNote: string;
  notes: string;
  sale: SaleDetails | null;
}

/** What the form holds. Money is typed in dollars, because that is what is on
 *  the cheque; it is converted on the way out. */
export interface DispositionDraft {
  exitChannel: string;
  date: string;
  isCull: boolean;
  cullPrimaryReasonId: string;
  cullSecondaryReasonId: string;
  cullNote: string;
  notes: string;
  /** Sale fields, all as typed. Empty means not given. */
  buyerName: string;
  saleChannel: string;
  saleBarn: string;
  lotNumber: string;
  liveWeightLb: string;
  pricePerCwt: string;
  gross: string;
  commission: string;
  hauling: string;
  yardage: string;
  otherDeductions: string;
}

export const emptyDisposition = (today: string): DispositionDraft => ({
  exitChannel: "sold_live",
  date: today,
  isCull: false,
  cullPrimaryReasonId: "",
  cullSecondaryReasonId: "",
  cullNote: "",
  notes: "",
  buyerName: "",
  saleChannel: "auction_barn",
  saleBarn: "",
  lotNumber: "",
  liveWeightLb: "",
  pricePerCwt: "",
  gross: "",
  commission: "",
  hauling: "",
  yardage: "",
  otherDeductions: "",
});

// ─── money ─────────────────────────────────────────────────────────────

const cents = (dollars: string): number | null => {
  const t = dollars.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * What the sale barn's arithmetic makes of it.
 *
 * Gross is hundredweight times the price per hundredweight — 1,200 lb at
 * $135/cwt is 12 × 135 — unless a gross was typed, in which case the cheque
 * wins. Net is gross less every deduction.
 *
 * Returns nulls when there is nothing to work from, so the form can show
 * blanks rather than a confident zero.
 */
export function saleFigures(draft: DispositionDraft): { grossCents: number | null; netCents: number | null } {
  const typed = cents(draft.gross);
  const weight = num(draft.liveWeightLb);
  const cwt = cents(draft.pricePerCwt);
  const grossCents = typed ?? (weight !== null && cwt !== null ? Math.round((weight / 100) * cwt) : null);
  if (grossCents === null) return { grossCents: null, netCents: null };
  const deductions =
    (cents(draft.commission) ?? 0) +
    (cents(draft.hauling) ?? 0) +
    (cents(draft.yardage) ?? 0) +
    (cents(draft.otherDeductions) ?? 0);
  return { grossCents, netCents: grossCents - deductions };
}

/** Whether any sale figure has been given at all. An empty sale block is sent
 *  as nothing rather than as a row of zeroes. */
export const hasSale = (draft: DispositionDraft): boolean =>
  [draft.buyerName, draft.saleBarn, draft.lotNumber, draft.liveWeightLb, draft.pricePerCwt, draft.gross,
   draft.commission, draft.hauling, draft.yardage, draft.otherDeductions].some((v) => v.trim() !== "");

// ─── validation ────────────────────────────────────────────────────────

/**
 * Why this can't be saved yet, in a sentence, or null.
 *
 * Every rule here is also in `herd.record_disposition`; this is so it arrives
 * as English before the round trip rather than as a plpgsql exception after.
 */
export function validateDisposition(
  draft: DispositionDraft,
  animal: { birth_date: string },
  today: string,
): string | null {
  if (!EXIT_CHANNELS.some((c) => c.code === draft.exitChannel)) return "How did she leave?";
  if (draft.date === "") return "When did she leave?";
  if (draft.date < animal.birth_date) return `She was born ${animal.birth_date} — she can't have left before that.`;
  if (draft.date > today) return "That date hasn't happened yet.";

  if (draft.isCull && draft.cullPrimaryReasonId === "") return "A cull needs a reason.";
  if (draft.cullSecondaryReasonId !== "" && draft.cullSecondaryReasonId === draft.cullPrimaryReasonId) {
    return "The two reasons are the same one.";
  }

  if (!hasSale(draft)) return null;
  if (!carriesSale(draft.exitChannel)) {
    return draft.exitChannel === "processed"
      ? "Sale figures belong on an animal sold live. A processor's animal earns later, as packaged meat."
      : "Sale figures belong on an animal sold live.";
  }
  if (!SALE_CHANNELS.some((c) => c.code === draft.saleChannel)) return "How was she sold?";

  const weight = num(draft.liveWeightLb);
  if (draft.liveWeightLb.trim() !== "" && (weight === null || weight <= 0)) {
    return "A live weight has to be a number above zero.";
  }
  for (const [field, label] of [
    [draft.commission, "commission"],
    [draft.hauling, "hauling"],
    [draft.yardage, "yardage"],
    [draft.otherDeductions, "other deductions"],
  ] as const) {
    const v = cents(field);
    if (field.trim() !== "" && v === null) return `The ${label} has to be a number.`;
    if (v !== null && v < 0) return `The ${label} can't be negative.`;
  }

  const { grossCents } = saleFigures(draft);
  if (grossCents === null) return "A sale needs either a gross amount, or a weight and a price per hundredweight.";
  if (grossCents < 0) return "A gross amount can't be negative.";
  return null;
}

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchCullReasons(farmId: string): Promise<CullReason[]> {
  const { data, error } = await herdSchema()
    .from("cull_reason_codes")
    .select("id, code, label, category, sort_order")
    .eq("farm_id", farmId)
    .eq("active", true)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) throw new Error(`herd.cull_reason_codes: ${error.message}`);
  return ((data ?? []) as (CullReason & { sort_order: number })[]).map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    category: r.category,
  }));
}

/** Her departure, if one is recorded. One per animal — 060 corrects rather
 *  than adds — so this reads the single row. */
export async function fetchDisposition(animalId: string): Promise<Disposition | null> {
  const { data, error } = await herdSchema()
    .from("dispositions")
    .select(
      "id, animal_id, exit_channel, date, is_cull, cull_primary_reason_id, cull_secondary_reason_id, cull_note, notes",
    )
    .eq("animal_id", animalId)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`herd.dispositions: ${error.message}`);
  if (!data) return null;

  const row = data as {
    id: string;
    animal_id: string;
    exit_channel: string;
    date: string;
    is_cull: boolean;
    cull_primary_reason_id: string | null;
    cull_secondary_reason_id: string | null;
    cull_note: string | null;
    notes: string | null;
  };

  const sale = await herdSchema()
    .from("disposition_sale_details")
    .select(
      "buyer_name, channel, sale_barn, lot_number, live_weight_lb, price_per_cwt_cents, gross_cents, commission_cents, hauling_cents, yardage_cents, other_deductions_cents, net_cents",
    )
    .eq("disposition_id", row.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sale.error) throw new Error(`herd.disposition_sale_details: ${sale.error.message}`);

  const s = sale.data as null | {
    buyer_name: string | null;
    channel: string;
    sale_barn: string | null;
    lot_number: string | null;
    live_weight_lb: number | null;
    price_per_cwt_cents: number | null;
    gross_cents: number | null;
    commission_cents: number | null;
    hauling_cents: number | null;
    yardage_cents: number | null;
    other_deductions_cents: number | null;
    net_cents: number | null;
  };

  return {
    id: row.id,
    animalId: row.animal_id,
    exitChannel: row.exit_channel,
    date: row.date,
    isCull: row.is_cull,
    cullPrimaryReasonId: row.cull_primary_reason_id,
    cullSecondaryReasonId: row.cull_secondary_reason_id,
    cullNote: row.cull_note ?? "",
    notes: row.notes ?? "",
    sale: s
      ? {
          buyerName: s.buyer_name ?? "",
          channel: s.channel,
          saleBarn: s.sale_barn ?? "",
          lotNumber: s.lot_number ?? "",
          liveWeightLb: s.live_weight_lb === null ? null : Number(s.live_weight_lb),
          pricePerCwtCents: s.price_per_cwt_cents === null ? null : Number(s.price_per_cwt_cents),
          grossCents: Number(s.gross_cents ?? 0),
          commissionCents: Number(s.commission_cents ?? 0),
          haulingCents: Number(s.hauling_cents ?? 0),
          yardageCents: Number(s.yardage_cents ?? 0),
          otherDeductionsCents: Number(s.other_deductions_cents ?? 0),
          netCents: Number(s.net_cents ?? 0),
        }
      : null,
  };
}

/** A recorded departure, back into the form that edits it. */
export function draftFrom(d: Disposition, today: string): DispositionDraft {
  const dollars = (c: number | null): string => (c === null || c === 0 ? "" : String(c / 100));
  return {
    ...emptyDisposition(today),
    exitChannel: d.exitChannel,
    date: d.date,
    isCull: d.isCull,
    cullPrimaryReasonId: d.cullPrimaryReasonId ?? "",
    cullSecondaryReasonId: d.cullSecondaryReasonId ?? "",
    cullNote: d.cullNote,
    notes: d.notes,
    ...(d.sale
      ? {
          buyerName: d.sale.buyerName,
          saleChannel: d.sale.channel,
          saleBarn: d.sale.saleBarn,
          lotNumber: d.sale.lotNumber,
          liveWeightLb: d.sale.liveWeightLb === null ? "" : String(d.sale.liveWeightLb),
          pricePerCwt: dollars(d.sale.pricePerCwtCents),
          // Gross is left blank when it follows from the weight and the price,
          // so re-saving doesn't quietly pin a figure that was derived.
          gross:
            d.sale.liveWeightLb !== null && d.sale.pricePerCwtCents !== null ? "" : dollars(d.sale.grossCents),
          commission: dollars(d.sale.commissionCents),
          hauling: dollars(d.sale.haulingCents),
          yardage: dollars(d.sale.yardageCents),
          otherDeductions: dollars(d.sale.otherDeductionsCents),
        }
      : {}),
  };
}

// ─── writes ────────────────────────────────────────────────────────────

export async function recordDisposition(animalId: string, draft: DispositionDraft): Promise<string> {
  const sale =
    carriesSale(draft.exitChannel) && hasSale(draft)
      ? {
          buyer_name: draft.buyerName.trim(),
          channel: draft.saleChannel,
          sale_barn: draft.saleBarn.trim(),
          lot_number: draft.lotNumber.trim(),
          live_weight_lb: num(draft.liveWeightLb),
          price_per_cwt_cents: cents(draft.pricePerCwt),
          // Sent only when typed. Left out, the database does the sum, which
          // keeps one authority over the arithmetic.
          gross_cents: cents(draft.gross),
          commission_cents: cents(draft.commission) ?? 0,
          hauling_cents: cents(draft.hauling) ?? 0,
          yardage_cents: cents(draft.yardage) ?? 0,
          other_deductions_cents: cents(draft.otherDeductions) ?? 0,
        }
      : null;

  const { data, error } = await herdSchema().rpc("record_disposition", {
    p_animal_id: animalId,
    p_exit_channel: draft.exitChannel,
    p_date: draft.date,
    p_is_cull: draft.isCull,
    p_cull_primary_reason_id: draft.isCull && draft.cullPrimaryReasonId !== "" ? draft.cullPrimaryReasonId : null,
    p_cull_secondary_reason_id:
      draft.isCull && draft.cullSecondaryReasonId !== "" ? draft.cullSecondaryReasonId : null,
    p_cull_note: draft.cullNote.trim(),
    p_notes: draft.notes.trim(),
    p_sale: sale,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** She didn't go, or the wrong animal was marked. Undoes the sale, the
 *  revenue it posted, the record itself, and puts her back to active. */
export async function undoDisposition(animalId: string): Promise<void> {
  const { error } = await herdSchema().rpc("undo_disposition", { p_animal_id: animalId });
  if (error) throw new Error(error.message);
}
