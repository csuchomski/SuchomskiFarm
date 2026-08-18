// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { GrazingEvent, GrazingGroup, Paddock } from "../lib/grazing";
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

let paddocks = [1, 2, 3, 4, 5].map(unit);
const events: GrazingEvent[] = [];

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
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
