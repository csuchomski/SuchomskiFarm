import { describe, expect, it } from "vitest";
import {
  draftFrom,
  emptyDisposition,
  hasSale,
  saleFigures,
  validateDisposition,
  type Disposition,
  type DispositionDraft,
} from "./dispositions";

const TODAY = "2026-08-21";
const abigail = { birth_date: "2026-07-24", sex: "female" };
const base = (over: Partial<DispositionDraft> = {}): DispositionDraft => ({
  ...emptyDisposition(TODAY),
  date: "2026-08-01",
  ...over,
});

describe("what the sale barn's arithmetic makes of it", () => {
  it("is hundredweight times the price, less every deduction", () => {
    // The same worked example migration 060 was rehearsed against: 1,200 lb
    // at $135/cwt is $1,620.00 gross; $40 commission and $75 hauling leave
    // $1,505.00. The database computed 162000 and 150500 for this input, and
    // these numbers are here so the preview can't drift away from it.
    const figures = saleFigures(
      base({ liveWeightLb: "1200", pricePerCwt: "135", commission: "40", hauling: "75" }),
    );
    expect(figures.grossCents).toBe(162000);
    expect(figures.netCents).toBe(150500);
  });

  it("takes a typed gross over the weight, because the cheque wins", () => {
    const figures = saleFigures(base({ liveWeightLb: "1200", pricePerCwt: "135", gross: "1600" }));
    expect(figures.grossCents).toBe(160000);
  });

  it("is blank with nothing to work from, rather than a confident zero", () => {
    expect(saleFigures(base({ buyerName: "Equity" }))).toEqual({ grossCents: null, netCents: null });
    // A weight with no price is not half an answer.
    expect(saleFigures(base({ liveWeightLb: "1200" })).grossCents).toBeNull();
  });

  it("goes negative when the deductions swallowed the cheque, and says so", () => {
    // Not clamped: a haul that cost more than she brought is a real outcome
    // and the farmer should see it. The database posts no revenue for it.
    expect(saleFigures(base({ gross: "100", hauling: "150" })).netCents).toBe(-5000);
  });
});

describe("whether there is a sale at all", () => {
  it("is false for an untouched form, so an empty block isn't sent as zeroes", () => {
    expect(hasSale(base())).toBe(false);
  });

  it("is true once any figure or name is given", () => {
    expect(hasSale(base({ buyerName: "Equity" }))).toBe(true);
    expect(hasSale(base({ liveWeightLb: "1200" }))).toBe(true);
  });
});

describe("what stops it being saved", () => {
  it("accepts a plain live sale", () => {
    expect(validateDisposition(base(), abigail, TODAY)).toBeNull();
  });

  it("wants a date that could have happened", () => {
    expect(validateDisposition(base({ date: "" }), abigail, TODAY)).toMatch(/When did she leave/);
    expect(validateDisposition(base({ date: "2026-12-01" }), abigail, TODAY)).toMatch(/hasn't happened yet/);
    expect(validateDisposition(base({ date: "2026-07-01" }), abigail, TODAY)).toMatch(/born 2026-07-24/);
  });

  it("wants a reason for a cull, which is the point of recording one", () => {
    expect(validateDisposition(base({ isCull: true }), abigail, TODAY)).toMatch(/A cull needs a reason/);
    expect(
      validateDisposition(base({ isCull: true, cullPrimaryReasonId: "r1" }), abigail, TODAY),
    ).toBeNull();
  });

  it("won't take the same reason twice", () => {
    expect(
      validateDisposition(
        base({ isCull: true, cullPrimaryReasonId: "r1", cullSecondaryReasonId: "r1" }),
        abigail,
        TODAY,
      ),
    ).toMatch(/the same one/i);
  });

  it("keeps sale money off an animal that went to a processor", () => {
    // Her money arrives later as packaged meat, which migration 058 already
    // credits back to her. Booking it here too counts the carcass twice.
    const draft = base({ exitChannel: "processed", liveWeightLb: "1200", pricePerCwt: "135" });
    expect(validateDisposition(draft, abigail, TODAY)).toMatch(/packaged meat/);
  });

  it("lets a processor's animal be recorded with no money at all", () => {
    expect(validateDisposition(base({ exitChannel: "processed" }), abigail, TODAY)).toBeNull();
    expect(validateDisposition(base({ exitChannel: "died_on_farm" }), abigail, TODAY)).toBeNull();
  });

  it("wants figures once a sale is being described", () => {
    expect(validateDisposition(base({ buyerName: "Equity" }), abigail, TODAY)).toMatch(
      /gross amount, or a weight and a price/,
    );
  });

  it("refuses a weight or a deduction that isn't a sensible number", () => {
    expect(validateDisposition(base({ liveWeightLb: "0", gross: "100" }), abigail, TODAY)).toMatch(
      /above zero/,
    );
    expect(validateDisposition(base({ gross: "100", hauling: "-5" }), abigail, TODAY)).toMatch(
      /can't be negative/,
    );
    expect(validateDisposition(base({ gross: "100", yardage: "lots" }), abigail, TODAY)).toMatch(
      /has to be a number/,
    );
  });
});

describe("editing a departure already recorded", () => {
  const recorded: Disposition = {
    id: "d1",
    animalId: "a1",
    exitChannel: "sold_live",
    date: "2026-08-01",
    isCull: true,
    cullPrimaryReasonId: "r1",
    cullSecondaryReasonId: null,
    cullNote: "never bred back",
    notes: "",
    sale: {
      buyerName: "Equity",
      channel: "auction_barn",
      saleBarn: "",
      lotNumber: "",
      liveWeightLb: 1200,
      pricePerCwtCents: 13500,
      grossCents: 162000,
      commissionCents: 4000,
      haulingCents: 7500,
      yardageCents: 0,
      otherDeductionsCents: 0,
      netCents: 150500,
    },
  };

  it("comes back as the figures that were typed, in dollars", () => {
    const draft = draftFrom(recorded, TODAY);
    expect(draft.liveWeightLb).toBe("1200");
    expect(draft.pricePerCwt).toBe("135");
    expect(draft.commission).toBe("40");
    expect(draft.hauling).toBe("75");
    expect(draft.cullNote).toBe("never bred back");
    expect(draft.isCull).toBe(true);
  });

  it("leaves gross blank when it followed from the weight and the price", () => {
    // Otherwise re-saving pins a derived figure as though it were the cheque,
    // and editing the weight afterwards would stop changing the total.
    expect(draftFrom(recorded, TODAY).gross).toBe("");
    expect(saleFigures(draftFrom(recorded, TODAY)).netCents).toBe(150500);
  });

  it("keeps a gross that was the only figure given", () => {
    const flat = { ...recorded, sale: { ...recorded.sale!, liveWeightLb: null, pricePerCwtCents: null } };
    expect(draftFrom(flat, TODAY).gross).toBe("1620");
  });

  it("round-trips back into something that validates", () => {
    expect(validateDisposition(draftFrom(recorded, TODAY), abigail, TODAY)).toBeNull();
  });
});
