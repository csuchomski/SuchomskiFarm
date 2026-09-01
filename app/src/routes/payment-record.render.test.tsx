// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { GrazingEvent, GrazingGroup, GrazingRound, Paddock, Pasture, Property } from "../lib/grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "../lib/__fixtures__/farm-geometry";

/**
 * Grazing → the grazing record (the NRCS 528 payment record form).
 *
 * The conservationist's form, filled from the moves. What matters is that the
 * table and the drawing agree — the number in a row is the number on the
 * ground it describes — and that a gap in the record shows as a gap.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const unit = (n: number): Paddock => {
  const name = `Paddock ${n}`;
  return {
    id: `p${n}`, name, code: `P${n}`,
    acresMeasured: REAL_ACRES[name], acresGrazable: REAL_ACRES[name],
    pastureId: null,
    unitType: "permanent",
    sweepHeadingDeg: REAL_SWEEP[name].headingDeg,
    sweepLengthFt: REAL_SWEEP[name].lengthFt,
    rotationOrder: n,
    seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
    noxiousSpecies: null, noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null, boundary: REAL_BOUNDARIES[name], active: true, notes: null,
  };
};

const mob: GrazingGroup = {
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
};

const ev = (over: Partial<GrazingEvent> & { id: string; paddockId: string; enteredAt: string }): GrazingEvent => ({
  groupId: "mob", exitedAt: null, headCount: 5, avgWeightLb: 1000,
  forageHeightInEntry: 9, residualHeightInExit: 4, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.2, grazedShape: null,
  ...over,
});

const pasture = (id: string, name: string, propertyId: string | null = null): Pasture => ({
  id, name, code: id.toUpperCase(), acres: null, notes: null, active: true, propertyId, boundary: null,
});

const property = (id: string, name: string): Property => ({
  id, name, code: null, acres: null, tenure: "owned", leaseEnds: null, notes: null, active: true,
});

let paddocks = [1, 2, 3, 4, 5].map(unit);
let pastures: Pasture[] = [];
let properties: Property[] = [];
let rounds: GrazingRound[] = [];
const events: GrazingEvent[] = [];

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPastures: vi.fn(async () => pastures),
    fetchProperties: vi.fn(async () => properties),
    fetchRounds: vi.fn(async () => rounds),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchGrazingGroups: vi.fn(async () => [mob]),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  paddocks = [1, 2, 3, 4, 5].map(unit);
  pastures = [];
  properties = [];
  rounds = [];
  events.length = 0;
});

const mount = async () => {
  const { default: PaymentRecord } = await import("./PaymentRecord");
  render(<MemoryRouter><PaymentRecord /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const svg = () => document.querySelector("svg.pm-svg");

/** The points back out of a path drawn by `pathFor` — "M x y L x y … Z". */
const ringOf = (d: string): [number, number][] =>
  d.replace(/[MLZ]/g, " ").trim().split(/[\s,]+/).map(Number)
    .reduce<[number, number][]>((acc, n, i, all) => {
      if (i % 2 === 0) acc.push([n, all[i + 1]]);
      return acc;
    }, []);

/** Ray casting: is the point inside the polygon? */
const encloses = (ring: [number, number][], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const bodyRows = () => [...document.querySelectorAll(".pr-table tbody tr")];
const cellsOf = (tr: Element) => [...tr.querySelectorAll("td")].map((td) => td.textContent);

/** Two strips out of Paddock 4 in the window, one out of it before. */
const someGrazing = () => {
  events.push(
    ev({ id: "old", paddockId: "p4", enteredAt: "2026-07-01T12:00:00.000Z",
         exitedAt: "2026-07-02T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.1 }),
    ev({ id: "a", paddockId: "p4", enteredAt: "2026-08-13T12:00:00.000Z",
         exitedAt: "2026-08-14T12:00:00.000Z", sweptFrom: 0.1, sweptTo: 0.25,
         forageHeightInEntry: 12, residualHeightInExit: 5, headCount: 5 }),
    ev({ id: "b", paddockId: "p3", enteredAt: "2026-08-15T12:00:00.000Z",
         exitedAt: null, sweptFrom: 0, sweptTo: 0.2,
         forageHeightInEntry: null, residualHeightInExit: null, headCount: 4 }),
  );
};

describe("the form, filled", () => {
  it("carries the columns the conservationist's form asks for", async () => {
    someGrazing();
    await mount();
    const heads = [...document.querySelectorAll(".pr-table thead th")].map((th) => th.textContent);
    const joined = heads.join(" | ");
    for (const want of ["Pasture or", "Acres", "Livestock", "Type", "Number", "Date In", "Date Out"]) {
      expect(joined).toContain(want);
    }
    expect(joined.match(/Forage Height/g)).toHaveLength(2);
  });

  it("puts a row in for each strip grazed in the range, and none for the rest", async () => {
    someGrazing();
    await mount();
    expect(bodyRows()).toHaveLength(2);
    expect(document.querySelector(".pr-table")!.textContent).not.toContain("P4-1");
  });

  it("fills a row from the move", async () => {
    someGrazing();
    await mount();
    const first = cellsOf(bodyRows()[0]).join(" | ");
    expect(first).toContain("P4-2");
    expect(first).toContain("Cattle, mixed");
    expect(first).toContain("5");
    expect(first).toContain("12");
  });

  it("leaves a blank where nothing was recorded rather than a nought", async () => {
    someGrazing();
    await mount();
    const second = cellsOf(bodyRows()[1]);
    // Forage height in, date out and height out are all empty on that strip.
    expect(second[5]).toBe("");
    expect(second[6]).toBe("");
    expect(second[7]).toBe("");
  });

  it("totals the acres it could measure", async () => {
    someGrazing();
    await mount();
    const foot = document.querySelector(".pr-table tfoot")!.textContent!;
    expect(foot).toContain("2 strips");
  });

  it("names what the record does not say", async () => {
    someGrazing();
    await mount();
    const said = screen.getByText(/What the record does not say/).textContent!;
    expect(said).toContain("1 without a forage height going in");
    expect(said).toContain("1 still open");
  });

  it("never says anything about compliance", async () => {
    someGrazing();
    await mount();
    expect(document.body.textContent).not.toMatch(/complian|meets 528/i);
  });
});

describe("the range", () => {
  it("opens on this month so far", async () => {
    someGrazing();
    await mount();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-08-01");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-08-20");
  });

  it("pulls a different set when the range moves", async () => {
    someGrazing();
    await mount();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
    expect(bodyRows()).toHaveLength(3);
    expect(document.querySelector(".pr-table")!.textContent).toContain("P4-1");
  });

  it("says so when nothing was grazed in the range", async () => {
    someGrazing();
    await mount();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });
    expect(screen.getByText(/No grazing recorded in this range/)).toBeTruthy();
  });

  it("refuses a range that ends before it starts, rather than showing nothing quietly", async () => {
    someGrazing();
    await mount();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-01" } });
    expect(screen.getByText(/end of the range is before its start/)).toBeTruthy();
  });
});

describe("the map beside the table", () => {
  it("draws the farm and the strips from the range", async () => {
    someGrazing();
    await mount();
    expect(svg()).toBeTruthy();
    // Five paddocks plus the two strips in range.
    expect(svg()!.querySelectorAll("path")).toHaveLength(7);
  });

  it("labels every strip with the number in its row", async () => {
    someGrazing();
    await mount();
    const onMap = [...svg()!.querySelectorAll("text.pr-strip-label")].map((t) => t.textContent);
    const inTable = bodyRows().map((tr) => cellsOf(tr)[0]);
    expect(onMap.slice().sort()).toEqual(inTable.slice().sort());
  });

  it("does not draw a strip that fell outside the range", async () => {
    someGrazing();
    await mount();
    const onMap = [...svg()!.querySelectorAll("text.pr-strip-label")].map((t) => t.textContent);
    expect(onMap).not.toContain("P4-1");
  });

  it("names the paddocks that were not grazed, and lets the strips name the rest", async () => {
    // Every strip label already starts with its paddock's code, so drawing the
    // code again on grazed ground puts it squarely on top of the labels that
    // matter — which is exactly what it did the first time round.
    someGrazing();
    await mount();
    const codes = [...svg()!.querySelectorAll("text.pr-unit-label")].map((t) => t.textContent);
    expect(codes).toEqual(["P1", "P2", "P5"]);
    const strips = [...svg()!.querySelectorAll("text.pr-strip-label")].map((t) => t.textContent);
    expect(strips.every((n) => /^P[0-9]+-[0-9]+$/.test(n ?? ""))).toBe(true);
  });

  it("steps every other label down, so two thin neighbours do not overprint", async () => {
    events.push(
      ev({ id: "n1", paddockId: "p2", enteredAt: "2026-08-16T12:00:00.000Z",
           exitedAt: "2026-08-16T18:00:00.000Z", sweptFrom: 0.5, sweptTo: 0.53 }),
      ev({ id: "n2", paddockId: "p2", enteredAt: "2026-08-17T12:00:00.000Z",
           exitedAt: "2026-08-17T18:00:00.000Z", sweptFrom: 0.53, sweptTo: 0.56 }),
    );
    await mount();
    const ys = [...svg()!.querySelectorAll("text.pr-strip-label")]
      .filter((t) => (t.textContent ?? "").startsWith("P2-"))
      .map((t) => Number(t.getAttribute("y")));
    expect(ys).toHaveLength(2);
    expect(ys[0]).not.toBe(ys[1]);
  });

  it("puts every number on the ground it names", async () => {
    // The whole point of the drawing is that a row's number can be found on the
    // map, so a label nudged off its own strip breaks the key silently — it
    // looks fine unless you ask which polygon the point actually lands in.
    // These two slices of Paddock 5 are one of the cases where the stagger,
    // left unchecked, put the number on the neighbour: swept over the real
    // boundaries, 196 of 1205 slices did.
    someGrazing();
    events.push(
      ev({ id: "c1", paddockId: "p5", enteredAt: "2026-08-16T12:00:00.000Z",
           exitedAt: "2026-08-16T18:00:00.000Z", sweptFrom: 0, sweptTo: 0.02 }),
      ev({ id: "c2", paddockId: "p5", enteredAt: "2026-08-17T12:00:00.000Z",
           exitedAt: "2026-08-17T18:00:00.000Z", sweptFrom: 0.02, sweptTo: 0.03 }),
    );
    await mount();
    const strips = [...svg()!.querySelectorAll("path")]
      .filter((p) => p.getAttribute("fill") === "#a9bd9a")
      .map((p) => ringOf(p.getAttribute("d")!));
    const labels = [...svg()!.querySelectorAll("text.pr-strip-label")];
    expect(labels).toHaveLength(strips.length);
    labels.forEach((t, i) => {
      const x = Number(t.getAttribute("x"));
      const y = Number(t.getAttribute("y"));
      expect(`${t.textContent}: ${encloses(strips[i], x, y)}`).toBe(`${t.textContent}: true`);
    });
  });

  it("leaves the drawing out when no paddock has a boundary", async () => {
    someGrazing();
    paddocks = paddocks.map((p) => ({ ...p, boundary: null }));
    await mount();
    expect(svg()).toBeNull();
    // The table is the record; the map is the illustration.
    expect(bodyRows()).toHaveLength(2);
  });
});

describe("narrowing the record to one pasture", () => {
  /**
   * Green Pastures runs 46 paddocks over six pastures. A record of the whole
   * farm is the right default and often not the document you want — the
   * conservationist asks about the ground under one plan, or one lease.
   *
   * The picker is hidden on paper, so what matters most here is that the
   * printout says which ground it covers.
   */
  const onPastures = () => {
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    // P1–P3 north, P4–P5 creek.
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
  };

  const pick = (value: string) =>
    fireEvent.change(screen.getByLabelText("Ground"), { target: { value } });

  it("offers no picker on a farm whose paddocks carry no pasture", async () => {
    // Which is every farm before 052, and the shape of most farms since.
    someGrazing();
    await mount();
    expect(screen.queryByLabelText("Ground")).toBeNull();
  });

  it("offers no picker when all the ground is on one pasture", async () => {
    // A control with one answer is not a control.
    someGrazing();
    pastures = [pasture("north", "North Pasture")];
    paddocks = paddocks.map((p) => ({ ...p, pastureId: "north" }));
    await mount();
    expect(screen.queryByLabelText("Ground")).toBeNull();
  });

  it("opens on the whole farm", async () => {
    onPastures();
    someGrazing();
    await mount();
    expect((screen.getByLabelText("Ground") as HTMLSelectElement).value).toBe("");
    expect(bodyRows()).toHaveLength(2);
  });

  it("drops the strips taken off other ground", async () => {
    onPastures();
    someGrazing();
    await mount();
    // The two strips in the window are on P4 (creek) and P3 (north).
    pick("north");
    expect(bodyRows().map((r) => cellsOf(r)[0])).toEqual(["P3-1"]);
    pick("creek");
    expect(bodyRows().map((r) => cellsOf(r)[0])).toEqual(["P4-2"]);
    // Nothing here about what the box itself displays: `fireEvent.change`
    // sets the DOM value, so it reads back the same whether the select is
    // controlled or not. The rows moving is the evidence that it is.
  });

  // No test here that filtering leaves strip numbers alone: a paddock sits on
  // one pasture, so this filter takes all of a paddock's strips or none, and
  // such a test could not fail. The numbering that does need pinning is
  // against the *range* filter, which "puts a row in for each strip grazed in
  // the range" already does.

  it("says on the page which ground the record covers", async () => {
    // The picker is hidden on paper. A printout headed only by its dates,
    // silently covering one pasture out of six, is a worse document than one
    // with no filter at all.
    onPastures();
    someGrazing();
    await mount();
    expect(screen.getByText(/Grazing records for/).textContent).toContain("the whole farm");
    pick("creek");
    expect(screen.getByText(/Grazing records for/).textContent).toContain("Creek Pasture");
  });

  it("retotals the acres over the ground that is left", async () => {
    onPastures();
    someGrazing();
    await mount();
    const whole = document.querySelector(".pr-table tfoot")!.textContent!;
    pick("creek");
    const part = document.querySelector(".pr-table tfoot")!.textContent!;
    expect([whole.includes("2 strips"), part.includes("1 strip")]).toEqual([true, true]);
    expect(part).not.toBe(whole);
  });

  it("draws that pasture's ground and no more", async () => {
    // Fitting the map to all 46 paddocks while the table shows eight is the
    // same postage-stamp problem the Move page had.
    onPastures();
    someGrazing();
    await mount();
    const outlines = () =>
      [...svg()!.querySelectorAll("path")].filter((p) => p.getAttribute("fill") === "var(--paper-tint)");
    expect(outlines()).toHaveLength(5);
    pick("creek");
    expect(outlines()).toHaveLength(2);
  });

  it("says which ground was quiet, rather than that nothing happened", async () => {
    onPastures();
    events.push(
      ev({ id: "a", paddockId: "p4", enteredAt: "2026-08-13T12:00:00.000Z",
           exitedAt: "2026-08-14T12:00:00.000Z" }),
    );
    await mount();
    pick("north");
    expect(screen.getByText("No grazing recorded on North Pasture in this range.")).toBeTruthy();
  });

  it("groups the pastures under the places they are on", async () => {
    // Six pastures across three leases read as three short lists rather than
    // one long one.
    properties = [property("home", "Home Farm"), property("voll", "The Vollmer Lease")];
    pastures = [
      pasture("north", "North Pasture", "home"),
      pasture("creek", "Creek Pasture", "voll"),
    ];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
    someGrazing();
    await mount();
    const groups = [...screen.getByLabelText("Ground").querySelectorAll("optgroup")];
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(["Home Farm", "The Vollmer Lease"]);
  });

  it("leaves ungrouped the pastures nobody has placed", async () => {
    // A farm part way through naming its places must not lose the rest of
    // its ground out of the picker.
    properties = [property("home", "Home Farm")];
    pastures = [pasture("north", "North Pasture", "home"), pasture("creek", "Creek Pasture")];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
    someGrazing();
    await mount();
    const picker = screen.getByLabelText("Ground");
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent!.split(" ·")[0]))
      .toEqual(["The whole farm", "North Pasture", "Creek Pasture"]);
  });
});

describe("reporting on a round rather than a month", () => {
  /**
   * The month was never the unit the farm works in. A trip through a pasture
   * is, and it straddles the turn of a month as often as not — this fixture
   * is deliberately one: into P4 on 28 July, out of P3 on 3 August.
   *
   * Both filters stay, because both questions are real: "what did we do in
   * August" for the return, "how did that round go" for the grazing.
   */
  const round = (id: string, over: Partial<GrazingRound> = {}): GrazingRound => ({
    id, groupId: "mob", pastureId: "north",
    startedAt: "2026-07-01T00:00:00.000Z", name: null, notes: null, derived: false, ...over,
  });

  /** A round that runs over the turn of the month. */
  const acrossTheMonth = () => {
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
    rounds = [
      round("r1", { startedAt: "2026-07-01T00:00:00.000Z" }),
      round("r2", { startedAt: "2026-07-25T00:00:00.000Z" }),
    ];
    events.push(
      // r1, all in July.
      ev({ id: "j1", paddockId: "p1", enteredAt: "2026-07-02T12:00:00.000Z",
           exitedAt: "2026-07-04T12:00:00.000Z" }),
      // r2, over the turn of the month — this is the whole point.
      ev({ id: "x1", paddockId: "p2", enteredAt: "2026-07-28T12:00:00.000Z",
           exitedAt: "2026-07-30T12:00:00.000Z" }),
      ev({ id: "x2", paddockId: "p3", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: "2026-08-03T12:00:00.000Z" }),
    );
  };

  const pickRound = (value: string) =>
    fireEvent.change(screen.getByLabelText("Round"), { target: { value } });

  it("offers no round picker on a farm that has started none", async () => {
    someGrazing();
    await mount();
    expect(screen.queryByLabelText("Round")).toBeNull();
  });

  it("offers no round that has nothing grazed under it yet", async () => {
    // One started this morning before the mob was moved is not a report.
    pastures = [pasture("north", "North Pasture")];
    paddocks = paddocks.map((p) => ({ ...p, pastureId: "north" }));
    rounds = [round("empty", { startedAt: "2026-08-19T00:00:00.000Z" })];
    await mount();
    expect(screen.queryByLabelText("Round")).toBeNull();
  });

  it("opens on the round you are in, not on a month", async () => {
    // The report is of the grazing, and the grazing is a round. A month is
    // an accident of the calendar that a round straddles as often as not.
    acrossTheMonth();
    await mount();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("r2");
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("takes the whole round, both sides of the month it straddles", async () => {
    // The month view of August shows one of these two strips. The round shows
    // both, which is the thing that could not be asked for before.
    acrossTheMonth();
    await mount();
    expect(bodyRows().map((r) => cellsOf(r)[0])).toEqual(["P2-1", "P3-1"]);
    pickRound("");
    expect(bodyRows()).toHaveLength(1);
  });

  it("leaves out the round before it", async () => {
    acrossTheMonth();
    await mount();
    pickRound("r1");
    expect(bodyRows().map((r) => cellsOf(r)[0])).toEqual(["P1-1"]);
  });

  it("puts the dates away while a round is chosen", async () => {
    // Two date boxes that no longer move the report are a lie about what the
    // page is showing.
    acrossTheMonth();
    await mount();
    pickRound("r2");
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.queryByLabelText("To")).toBeNull();
  });

  it("names the round and its real dates on the page", async () => {
    // The picker is hidden on paper, so this line is the only thing telling a
    // reviewer what the sheet in their hand covers.
    acrossTheMonth();
    await mount();
    pickRound("r2");
    const said = screen.getByText(/Grazing records for/).textContent!;
    expect(said).toContain("Main mob · North Pasture · Round 2");
    expect(said).toContain("Jul 28, 2026");
    expect(said).toContain("Aug 3, 2026");
  });

  it("uses the name the farm gave the round", async () => {
    acrossTheMonth();
    rounds = rounds.map((r) => (r.id === "r2" ? { ...r, name: "After the hay" } : r));
    await mount();
    pickRound("r2");
    expect(screen.getByText(/Grazing records for/).textContent).toContain("After the hay");
  });

  it("says when a round's start was guessed rather than recorded", async () => {
    // 066 backfilled the history. Presenting a guess about last season as a
    // record is worse than saying it is a guess.
    acrossTheMonth();
    rounds = rounds.map((r) => ({ ...r, derived: true }));
    await mount();
    pickRound("r2");
    expect(screen.getByText(/worked out from the moves, not recorded at the time/)).toBeTruthy();
  });

  it("says nothing about guesswork on a round the farm started itself", async () => {
    acrossTheMonth();
    await mount();
    pickRound("r2");
    expect(screen.queryByText(/worked out from the moves/)).toBeNull();
  });

  it("offers only the rounds on the ground the report is scoped to", async () => {
    acrossTheMonth();
    rounds = [...rounds, round("creek1", { pastureId: "creek", startedAt: "2026-07-01T00:00:00.000Z" })];
    events.push(ev({ id: "c1", paddockId: "p4", enteredAt: "2026-07-05T12:00:00.000Z",
                     exitedAt: "2026-07-07T12:00:00.000Z" }));
    await mount();
    // The mob and the ground are the group heading now; the option under it
    // only says which round and when.
    const scopes = () =>
      [...screen.getByLabelText("Round").querySelectorAll("optgroup")]
        .map((g) => g.getAttribute("label"));
    expect(scopes().some((t) => t?.includes("Creek"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Ground"), { target: { value: "north" } });
    expect(scopes().some((t) => t?.includes("Creek"))).toBe(false);
  });

  it("draws only the round's own ground, not the whole farm", async () => {
    // Without this the table is one pasture's worth and the map beside it
    // draws two — two answers to "what is this a record of" on one sheet.
    acrossTheMonth();
    await mount();
    const outlines = () =>
      [...svg()!.querySelectorAll("path")].filter((p) => p.getAttribute("fill") === "var(--paper-tint)");
    // Opens on r2, which is North's three paddocks.
    expect(outlines()).toHaveLength(3);
    pickRound("");
    expect(outlines()).toHaveLength(5);
  });

  it("prefers a round the mob has not come out of", async () => {
    // "The round you are in" is the one still running, even when another was
    // walked into more recently and finished.
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
    rounds = [
      round("running", { pastureId: "north", startedAt: "2026-07-01T00:00:00.000Z" }),
      round("finished", { pastureId: "creek", startedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    events.push(
      ev({ id: "open", paddockId: "p1", enteredAt: "2026-08-10T12:00:00.000Z", exitedAt: null }),
      ev({ id: "shut", paddockId: "p4", enteredAt: "2026-08-15T12:00:00.000Z",
           exitedAt: "2026-08-17T12:00:00.000Z" }),
    );
    await mount();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("running");
  });

  it("takes the most recently walked into when several are running", async () => {
    // Four mobs out at once is the ordinary state of a big farm, so the rule
    // has to say which — not leave it to whatever order the rows arrived in.
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
    rounds = [
      round("older", { pastureId: "north", startedAt: "2026-07-01T00:00:00.000Z" }),
      round("newer", { pastureId: "creek", startedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    events.push(
      ev({ id: "a", paddockId: "p1", enteredAt: "2026-08-10T12:00:00.000Z", exitedAt: null }),
      ev({ id: "b", paddockId: "p4", enteredAt: "2026-08-14T12:00:00.000Z", exitedAt: null }),
    );
    await mount();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("newer");
  });

  it("falls back to the last round grazed when nothing is running", async () => {
    acrossTheMonth();
    await mount();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("r2");
  });

  it("opens on the date range on a farm that has grazed no round", async () => {
    // Nothing to default to, and a blank report would be worse than the month.
    someGrazing();
    await mount();
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(bodyRows()).toHaveLength(2);
  });

  it("stays on the date range once it has been asked for", async () => {
    // The default must not keep reasserting itself over a deliberate choice.
    acrossTheMonth();
    await mount();
    pickRound("");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("");
  });

  it("re-defaults to the round you are in on the ground just picked", async () => {
    // Narrowing Ground can take the chosen round off the list, and a picker
    // showing a round it no longer offers is a page lying about itself.
    acrossTheMonth();
    rounds = [...rounds, round("creek1", { pastureId: "creek", startedAt: "2026-07-01T00:00:00.000Z" })];
    events.push(ev({ id: "c1", paddockId: "p4", enteredAt: "2026-07-05T12:00:00.000Z",
                     exitedAt: "2026-07-07T12:00:00.000Z" }));
    await mount();
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("r2");
    fireEvent.change(screen.getByLabelText("Ground"), { target: { value: "creek" } });
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("creek1");
  });

  it("re-defaults even after a round was picked by hand", async () => {
    // The case the default alone does not cover: a deliberate choice has to
    // be let go of when the ground it was on stops being on offer, or the
    // picker sits blank while the table is still filtered by it.
    acrossTheMonth();
    rounds = [...rounds, round("creek1", { pastureId: "creek", startedAt: "2026-07-01T00:00:00.000Z" })];
    events.push(ev({ id: "c1", paddockId: "p4", enteredAt: "2026-07-05T12:00:00.000Z",
                     exitedAt: "2026-07-07T12:00:00.000Z" }));
    await mount();
    pickRound("r1");
    fireEvent.change(screen.getByLabelText("Ground"), { target: { value: "creek" } });
    expect((screen.getByLabelText("Round") as HTMLSelectElement).value).toBe("creek1");
    expect(bodyRows().map((r) => cellsOf(r)[0])).toEqual(["P4-1"]);
  });

  it("goes back to the date range when the round is cleared", async () => {
    acrossTheMonth();
    await mount();
    pickRound("");
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(bodyRows()).toHaveLength(1);
  });
});
