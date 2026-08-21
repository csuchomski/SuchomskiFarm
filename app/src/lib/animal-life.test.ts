import { describe, expect, it } from "vitest";
import { buildLife, lifeDate, monthsBetween } from "./animal-life";
import type { RealAnimal } from "./herd";
import type { RealLactation } from "./lactations";
import type { Calving } from "./repro";
import type { Breeding } from "./breedings";
import type { Disposition } from "./dispositions";

/**
 * A cow's life, in the order she lived it.
 *
 * Built against Patience's real record — born 4 Jul 2020, served three times,
 * one calf on 9 Jul 2024, lactation 1 dried off 6 Aug 2026 and lactation 3
 * fresh the same day — because the awkward parts of it are the parts worth
 * pinning: three services that led to one calf, and a lactation numbering
 * that skips 2.
 */

const animal = (over: Partial<RealAnimal> = {}): RealAnimal =>
  ({
    id: "a1", ear_tag: "0", barn_name: "Patience", sex: "female", class: "cow",
    status: "active", birth_date: "2020-07-04", purpose: "dairy", origin: "purchased",
    record_type: "herd", sire_id: null, dam_id: null, notes: null,
    ...over,
  }) as RealAnimal;

const service = (id: string, date: string, over: Partial<Breeding> = {}): Breeding =>
  ({ id, animal_id: "a1", date, service_number: 1, method: "ai", voided: false, ...over }) as Breeding;

const calving = (id: string, date: string): Calving =>
  ({ id, dam_id: "a1", date, is_twin: false }) as Calving;

const lactation = (id: string, n: number, fresh: string, dry: string | null): RealLactation =>
  ({ id, animal_id: "a1", lactation_number: n, fresh_date: fresh, dry_off_date: dry }) as RealLactation;

const build = (over: Partial<Parameters<typeof buildLife>[0]> = {}) =>
  buildLife({
    animal: animal(),
    calvings: [calving("c1", "2024-07-09")],
    lactations: [
      lactation("l1", 1, "2024-07-09", "2026-08-06"),
      lactation("l3", 3, "2026-08-06", null),
    ],
    breedings: [
      service("b1", "2023-07-01"),
      service("b2", "2023-09-26"),
      service("b3", "2026-01-07"),
    ],
    offspring: [animal({ id: "a2", ear_tag: "2", barn_name: "Vera", birth_date: "2024-07-09" })],
    today: "2026-08-21",
    ...over,
  });

describe("the order of a life", () => {
  it("runs from birth to the open end, in date order", () => {
    const titles = build().map((e) => e.title);
    expect(titles[0]).toBe("Born");
    expect(titles[titles.length - 1]).toBe("Sold or processed");
    const dated = build().filter((e) => e.date !== "");
    expect([...dated].sort((a, b) => a.date.localeCompare(b.date)).map((e) => e.key)).toEqual(
      dated.map((e) => e.key),
    );
  });

  it("says where she came from, since a bought-in cow has no calving here", () => {
    expect(build()[0].detail).toBe("Bought in");
    expect(build({ animal: animal({ origin: "born here" }) })[0].detail).toBe("On this farm");
  });
});

describe("services, grouped by the calf they led to", () => {
  it("counts the run rather than drawing a step for every straw", () => {
    // Two services before her first calf are one attempt at that calf.
    const first = build().find((e) => e.title === "First service")!;
    expect(first.date).toBe("2023-07-01");
    expect(first.detail).toBe("2 services · last 26 Sep 2023");
  });

  it("starts a new step after a calving", () => {
    const served = build().filter((e) => e.kind === "service");
    expect(served.map((e) => e.date)).toEqual(["2023-07-01", "2026-01-07"]);
    expect(served[1].title).toBe("Served");
    expect(served[1].detail).toBe("AI");
  });

  it("leaves a voided service out entirely", () => {
    const events = build({
      breedings: [service("b1", "2023-07-01"), service("b2", "2023-09-26", { voided: true })],
    });
    expect(events.find((e) => e.kind === "service")!.detail).toBe("AI");
  });
});

describe("calvings and lactations", () => {
  it("names the calf a calving produced", () => {
    const calved = build().find((e) => e.kind === "calving")!;
    expect(calved.title).toBe("First calf");
    expect(calved.detail).toBe("Vera, a heifer");
  });

  it("says so when no calf is on file for a calving", () => {
    expect(build({ offspring: [] }).find((e) => e.kind === "calving")!.detail).toBe("No calf on file");
  });

  it("keeps the lactation number the farm recorded, gaps and all", () => {
    // Her record skips lactation 2. Renumbering would be inventing history.
    expect(build().filter((e) => e.kind === "lactation").map((e) => e.title)).toEqual([
      "Lactation 1",
      "Lactation 3",
    ]);
  });

  it("gives a finished lactation its span and an open one the present tense", () => {
    const [first, second] = build().filter((e) => e.kind === "lactation");
    // 9 Jul 2024 to 6 Aug 2026 is 24 whole months and 28 days over. The
    // mockup said 25; whole months is what a span should count.
    expect(first.detail).toBe("24 months, then dried off");
    expect(first.endDate).toBe("2026-08-06");
    expect(first.current).toBe(false);
    expect(second.detail).toBe("Fresh · she is here now");
    expect(second.current).toBe(true);
  });

  it("marks nothing current once she has left the farm", () => {
    const events = build({ animal: animal({ status: "sold" }) });
    expect(events.some((e) => e.current)).toBe(false);
    expect(events[events.length - 1].title).toBe("Sold");
  });
});

describe("the end", () => {
  const gone = (over: Partial<Disposition> = {}): Disposition => ({
    id: "d1", animalId: "a1", exitChannel: "sold_live", date: "2026-08-10",
    isCull: false, cullPrimaryReasonId: null, cullSecondaryReasonId: null,
    cullNote: "", notes: "", sale: null,
    ...over,
  });

  it("draws an open step for a cow who is still here", () => {
    const last = build()[build().length - 1];
    expect(last.kind).toBe("open");
    expect(last.date).toBe("");
    expect(last.detail).toBe("Nothing recorded");
  });

  it("stops calling a lactation current once she has a departure on file", () => {
    // Her lactation row has no dry-off date, so on its own it reads as open.
    // She is not in milk; she is not here.
    const events = build({ disposition: gone() });
    expect(events.some((e) => e.current)).toBe(false);
    expect(events.find((e) => e.title === "Lactation 3")!.detail).toBe("No dry-off recorded");
  });

  it("dates her departure from the record of it, not from today", () => {
    const events = build({ animal: animal({ status: "sold" }), disposition: gone() });
    const last = events[events.length - 1];
    expect(last.title).toBe("Sold");
    expect(last.date).toBe("2026-08-10");
  });

  it("names what a cull was for, and what she cleared", () => {
    const events = build({
      animal: animal({ status: "culled" }),
      disposition: gone({
        isCull: true,
        sale: {
          buyerName: "Equity", channel: "auction_barn", saleBarn: "", lotNumber: "",
          liveWeightLb: 1200, pricePerCwtCents: 13500, grossCents: 162000,
          commissionCents: 4000, haulingCents: 7500, yardageCents: 0,
          otherDeductionsCents: 0, netCents: 150500,
        },
      }),
    });
    expect(events[events.length - 1].detail).toBe("Culled · Equity · $1,505.00 net");
  });

  it("uses the channel's own word for a processor or a death", () => {
    expect(
      build({ animal: animal({ status: "processed" }), disposition: gone({ exitChannel: "processed" }) }).at(-1)!
        .title,
    ).toBe("To a processor");
    expect(
      build({ animal: animal({ status: "died" }), disposition: gone({ exitChannel: "died_on_farm" }) }).at(-1)!
        .title,
    ).toBe("Died");
  });

  it("owns up to not knowing the day, for an animal marked gone and nothing else", () => {
    // 'died', not 'dead' — the status column has never allowed 'dead', so the
    // old check never matched and her step read as the raw lowercase word.
    // And her status carries no date: stamping today's is a guess, so the
    // step says the day isn't recorded rather than printing one.
    const last = build({ animal: animal({ status: "died" }) }).at(-1)!;
    expect(last.title).toBe("Died");
    expect(last.detail).toBe("Off the farm — the day isn't recorded");
  });
});

describe("dates", () => {
  it("reads an ISO day without going near a timezone", () => {
    expect(lifeDate("2024-07-09")).toBe("9 Jul 2024");
    expect(lifeDate("2026-01-07")).toBe("7 Jan 2026");
  });

  it("counts whole months, not part ones", () => {
    expect(monthsBetween("2024-07-09", "2026-08-06")).toBe(24);
    expect(monthsBetween("2024-07-09", "2024-08-09")).toBe(1);
    expect(monthsBetween("2024-07-09", "2024-08-08")).toBe(0);
  });
});
