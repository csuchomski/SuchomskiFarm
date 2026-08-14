// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  GrazingPhoto,
  GrazingPlan,
  KeyArea,
  KeyAreaDraft,
  MonitoringDraft,
  MonitoringRecord,
  Paddock,
} from "../lib/grazing";

/**
 * Herd → Monitoring.
 *
 * The rules under test: "due" and never "overdue"; no cadence without a plan;
 * and a photo point missing its spot or its bearing says so.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store", "books"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const paddock = (n: number): Paddock => ({
  id: `p${n}`, name: `Paddock ${n}`, code: `P${n}`,
  acresMeasured: 1.97, acresGrazable: 1.97,
  unitType: "permanent", sweepHeadingDeg: 270, sweepLengthFt: 424, rotationOrder: null,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
});

const paddocks = [paddock(1), paddock(3)];
const areas: KeyArea[] = [];
const records: MonitoringRecord[] = [];
const photos: GrazingPhoto[] = [];
let plan: GrazingPlan | null = null;

const savedArea = vi.fn(async (_f: string, _d: KeyAreaDraft) => "k-new");
const savedRecord = vi.fn(async (_f: string, _d: MonitoringDraft) => "m-new");
const uploaded = vi.fn(async () => ({ id: "ph1", storagePath: "farm-1/m-new/x.jpg" }));

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchKeyAreas: vi.fn(async () => areas),
    fetchMonitoringRecords: vi.fn(async () => records),
    fetchGrazingPhotos: vi.fn(async () => photos),
    fetchActivePlan: vi.fn(async () => plan),
    fetchGrazingEvents: vi.fn(async () => []),
    createKeyArea: savedArea,
    recordMonitoring: savedRecord,
  };
});

vi.mock("../lib/grazing-photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing-photos")>();
  return {
    ...actual,
    uploadMonitoringPhoto: uploaded,
    signedPhotoUrls: vi.fn(async () => new Map([["farm-1/m1/a.jpg", "https://signed.example/a.jpg"]])),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  areas.length = 0;
  records.length = 0;
  photos.length = 0;
  plan = null;
  savedArea.mockClear();
  savedRecord.mockClear();
  uploaded.mockClear();
});

const mount = async () => {
  const { default: Monitoring } = await import("./Monitoring");
  render(<MemoryRouter><Monitoring /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

const area = (over: Partial<KeyArea> = {}): KeyArea => ({
  id: "k1", paddockId: "p3", name: "Gate corner",
  latitude: 42.8778, longitude: -88.414, photoAzimuthDeg: 270,
  description: null, active: true, ...over,
});

const record = (over: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  id: "m1", keyAreaId: "k1", planId: null, observedOn: "2026-07-01",
  protocol: null, residualHeightIn: 4,
  groundCoverPct: null, litterPct: null, bareGroundPct: null,
  speciesComposition: null, keyPlantVigor: null,
  erosionObservations: null, compactionObservations: null,
  observer: null, notes: null, latitude: null, longitude: null, ...over,
});

const withPlan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026", periodStart: "2026-04-01", periodEnd: "2026-10-31",
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 30,
  defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null, active: true, notes: null, ...over,
});

describe("what the page claims", () => {
  it("asks for a key area first, and says what one is", async () => {
    await mount();
    expect(screen.getByText(/A key area is the spot you judge a paddock by/)).toBeTruthy();
  });

  it("says nothing about how often without a plan", async () => {
    areas.push(area());
    records.push(record());
    await mount();
    expect(screen.getByText(/an agronomic recommendation it has no standing to make/)).toBeTruthy();
    expect(screen.queryByText(/due/)).toBeNull();
  });

  it("says 'due' with the plan's own cadence, never 'overdue'", async () => {
    plan = withPlan();
    areas.push(area());
    records.push(record());
    await mount();
    expect(screen.getByText(/due · 43 days/)).toBeTruthy();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/compliant/i)).toBeNull();
    expect(screen.getByText(/every 30 days/)).toBeTruthy();
  });

  it("says how long it has been when it is not due yet", async () => {
    plan = withPlan();
    areas.push(area());
    records.push(record({ observedOn: "2026-08-05" }));
    await mount();
    expect(screen.getByText("8 days ago")).toBeTruthy();
  });

  it("says 'never looked at' rather than treating it as late", async () => {
    plan = withPlan();
    areas.push(area());
    await mount();
    expect(screen.getByText("never looked at")).toBeTruthy();
  });
});

describe("photo points", () => {
  it("says which half is missing", async () => {
    areas.push(area({ photoAzimuthDeg: null }));
    await mount();
    expect(screen.getByText(/Photo point has no bearing/)).toBeTruthy();
    expect(screen.getByText(/shows the walking, not the grass/)).toBeTruthy();
  });

  it("says nothing when the point is complete", async () => {
    areas.push(area());
    await mount();
    expect(screen.queryByText(/Photo point has/)).toBeNull();
  });

  it("shows a photo through a signed link rather than a public one", async () => {
    areas.push(area());
    records.push(record());
    photos.push({
      id: "ph1", grazingEventId: null, monitoringRecordId: "m1",
      storagePath: "farm-1/m1/a.jpg", caption: null,
      takenAt: "2026-07-01T12:00:00.000Z", latitude: null, longitude: null,
    });
    await mount();
    await waitFor(() => {
      const img = document.querySelector("img.mon-shot") as HTMLImageElement | null;
      expect(img?.src).toBe("https://signed.example/a.jpg");
    });
  });
});

describe("recording", () => {
  it("adds a key area with its spot and bearing", async () => {
    await mount();
    fireEvent.click(screen.getByText("Add a key area"));
    fireEvent.change(screen.getByLabelText("In which paddock"), { target: { value: "p3" } });
    fireEvent.change(screen.getByLabelText("Call it"), { target: { value: "Gate corner" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "42.8778" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-88.414" } });
    fireEvent.change(screen.getByLabelText("Camera bearing"), { target: { value: "270" } });
    fireEvent.click(screen.getByText("Add it"));

    await waitFor(() => expect(savedArea).toHaveBeenCalledTimes(1));
    expect(savedArea.mock.calls[0][1]).toMatchObject({
      paddockId: "p3", name: "Gate corner",
      latitude: 42.8778, longitude: -88.414, photoAzimuthDeg: 270,
    });
  });

  it("will not add a key area without a paddock and a name", async () => {
    await mount();
    fireEvent.click(screen.getByText("Add a key area"));
    fireEvent.click(screen.getByText("Add it"));
    expect(savedArea).not.toHaveBeenCalled();
  });

  it("records a look, leaving untouched figures null", async () => {
    areas.push(area());
    await mount();
    fireEvent.click(screen.getByText("Record a look"));
    fireEvent.change(screen.getByLabelText("Which key area"), { target: { value: "k1" } });
    fireEvent.change(screen.getByLabelText("Residual, in"), { target: { value: "4.5" } });
    fireEvent.change(screen.getByLabelText("Ground cover, %"), { target: { value: "80" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(savedRecord).toHaveBeenCalledTimes(1));
    expect(savedRecord.mock.calls[0][1]).toMatchObject({
      keyAreaId: "k1", residualHeightIn: 4.5, groundCoverPct: 80,
      litterPct: null, bareGroundPct: null,
    });
  });

  it("shows a cover total that does not add to 100 rather than refusing it", async () => {
    areas.push(area());
    records.push(record({ groundCoverPct: 80, litterPct: 12, bareGroundPct: 5 }));
    await mount();
    expect(screen.getByText(/97% accounted for/)).toBeTruthy();
  });

  it("turns away a file that is not an image, before anything is saved", async () => {
    areas.push(area());
    await mount();
    fireEvent.click(screen.getByText("Record a look"));
    const input = screen.getByLabelText("Photo") as HTMLInputElement;
    const bad = new File(["x"], "notes.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [bad] });
    fireEvent.change(input);
    expect(screen.getByText(/not an image this app takes/)).toBeTruthy();
  });

  it("keeps the reading when the photo fails to go up", async () => {
    // The observation is what somebody walked out to make; a failed upload
    // should cost the picture and not the reading.
    uploaded.mockRejectedValueOnce(new Error("network"));
    areas.push(area());
    await mount();
    fireEvent.click(screen.getByText("Record a look"));
    fireEvent.change(screen.getByLabelText("Which key area"), { target: { value: "k1" } });
    const input = screen.getByLabelText("Photo") as HTMLInputElement;
    const good = new File(["x"], "p.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [good] });
    fireEvent.change(input);
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(savedRecord).toHaveBeenCalledTimes(1));
    await screen.findByText(/The reading was saved, but the photo was not/);
  });
});
