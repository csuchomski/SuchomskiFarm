// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pasture } from "../../lib/grazing";

/**
 * The review screen between a drawn file and the farm's ground.
 *
 * Its whole job is to be overrulable. The parser's guess at which shape is a
 * pasture and which are paddocks is *containment* and nothing more, and there
 * are plenty of files it will read the wrong way round — a paddock drawn
 * larger than the perimeter it sits in, a neighbouring field in the same
 * file. So what these pin is that the guess is visible, that every part of it
 * can be changed, and that what is sent is what is on the screen at the end
 * rather than what the file said at the start.
 */

const FARM = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Suchomski Farm</name>
<Placemark><name>Farm perimeter</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-88.41415662,42.87671229 -88.41269056,42.87719684 -88.41299683,42.87876087
-88.41489766,42.87874084 -88.41495831,42.87686518 -88.41415662,42.87671229
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Untitled Polygon</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-88.41335974,42.87778163 -88.41335974,42.87833348 -88.41491083,42.87833348
-88.41492868,42.87778163 -88.41335974,42.87778163
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Interior fence</name><LineString><coordinates>
-88.41335974,42.87833348 -88.41490975,42.87833348
</coordinates></LineString></Placemark>
</Document></kml>`;

const importGround = vi.fn<(farmId: string, payload: unknown) => Promise<{ pastureId: string; paddocks: number }>>(
  async () => ({ pastureId: "new", paddocks: 1 }),
);

vi.mock("../../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/grazing")>();
  return { ...actual, importGround };
});

const pastures: Pasture[] = [
  { id: "home", name: "Home place", code: null, acres: 62.5, notes: null, active: true, boundary: null },
];

const onImported = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  importGround.mockClear();
  importGround.mockResolvedValue({ pastureId: "new", paddocks: 1 });
  onImported.mockClear();
  onCancel.mockClear();
});

afterEach(cleanup);

/** A File whose `.text()` resolves — jsdom's File has no text() of its own. */
const fileOf = (name: string, body: string): File => {
  const f = new File([body], name, { type: "application/vnd.google-earth.kml+xml" });
  Object.defineProperty(f, "text", { value: async () => body });
  return f;
};

const mount = async () => {
  const { KmlImport } = await import("./KmlImport");
  render(
    <KmlImport farmId="farm-1" pastures={pastures} onImported={onImported} onCancel={onCancel} />,
  );
};

const drop = async (body: string, name = "farm.kml") => {
  const input = screen.getByLabelText("KML file");
  fireEvent.change(input, { target: { files: [fileOf(name, body)] } });
  await waitFor(() => expect(screen.queryByLabelText("KML file")).toBeNull());
};

const row = (shapeName: string) =>
  screen.getByLabelText(`Name for ${shapeName}`).closest(".grid-row") as HTMLElement;

const payload = () => importGround.mock.calls[0][1] as {
  pasture: { id: string | null; name: string; acres: number | null; boundary: unknown };
  paddocks: { name: string; acresMeasured: number | null; rotationOrder: number | null; boundary: unknown }[];
};

describe("picking a file", () => {
  it("says what it will do before asking for one", async () => {
    await mount();
    expect(screen.getByText(/drawn this place in Google Earth/)).toBeTruthy();
    expect(screen.getByLabelText("KML file")).toBeTruthy();
  });

  it("promises the file stays put, because that is a real question about a map of your home", async () => {
    await mount();
    expect(screen.getByText(/stays on this device/)).toBeTruthy();
  });

  it("names the .kmz mistake rather than failing obscurely", async () => {
    await mount();
    const input = screen.getByLabelText("KML file");
    fireEvent.change(input, { target: { files: [fileOf("farm.kmz", "PK\x03\x04 zipped")] } });
    await waitFor(() => expect(screen.getByText(/kmz/i)).toBeTruthy());
    // and it stays on the picker, so another file can be chosen
    expect(screen.getByLabelText("KML file")).toBeTruthy();
  });
});

describe("the review", () => {
  it("shows every shape with what it measures", async () => {
    await mount();
    await drop(FARM);
    expect(within(row("Farm perimeter")).getByText(/ac$/)).toBeTruthy();
    expect(row("Interior fence").textContent).toContain("ft");
  });

  it("proposes the containment it found, and says why", async () => {
    await mount();
    await drop(FARM);
    expect((screen.getByLabelText("What Farm perimeter is") as HTMLSelectElement).value).toBe("pasture");
    expect((screen.getByLabelText("What Untitled Polygon is") as HTMLSelectElement).value).toBe("paddock");
    expect((screen.getByLabelText("What Interior fence is") as HTMLSelectElement).value).toBe("skip");
    expect(row("Untitled Polygon").textContent).toContain("inside Farm perimeter");
  });

  it("lets a name be fixed in place, since KML names are rarely paddock names", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("Name for Untitled Polygon"), {
      target: { value: "Paddock 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().paddocks[0].name).toBe("Paddock 2");
  });

  it("lets the guess be overruled", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("What Untitled Polygon is"), { target: { value: "skip" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().paddocks).toHaveLength(0);
  });

  it("keeps only one pasture when a second shape is promoted to it", async () => {
    // Two pastures in one payload is not a thing the import can express, and
    // the last one picked is the one meant.
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("What Untitled Polygon is"), { target: { value: "pasture" } });
    expect((screen.getByLabelText("What Farm perimeter is") as HTMLSelectElement).value).toBe("paddock");
    expect((screen.getByLabelText("What Untitled Polygon is") as HTMLSelectElement).value).toBe("pasture");
  });

  it("takes the rotation numbers typed on the review", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("Number in the round for Untitled Polygon"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().paddocks[0].rotationOrder).toBe(3);
  });

  it("sends the name typed for the pasture, not the one the file used", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("Call the pasture"), { target: { value: "The home forty" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().pasture.name).toBe("The home forty");
    expect(payload().pasture.id).toBeNull();
  });

  it("carries the geometry through to what is sent", async () => {
    await mount();
    await drop(FARM);
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().pasture.boundary).toMatchObject({ type: "Polygon" });
    expect(payload().paddocks[0].boundary).toMatchObject({ type: "Polygon" });
    expect(payload().paddocks[0].acresMeasured).toBeCloseTo(1.932, 2);
  });

  it("adds to land already on file when one is picked", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("Put these on"), { target: { value: "home" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(importGround).toHaveBeenCalled());
    expect(payload().pasture.id).toBe("home");
  });

  it("tallies what is about to be written", async () => {
    await mount();
    await drop(FARM);
    expect(screen.getByText(/paddock, 1.93 acres between them/)).toBeTruthy();
  });
});

describe("when it will not go", () => {
  it("says so rather than sending an import with no pasture", async () => {
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("What Farm perimeter is"), { target: { value: "skip" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(screen.getByText(/Pick which shape is the pasture/)).toBeTruthy());
    expect(importGround).not.toHaveBeenCalled();
  });

  it("carries the server's refusal back rather than reporting success", async () => {
    importGround.mockRejectedValueOnce(
      new Error("This farm already has a paddock called Paddock 2. Nothing was imported."),
    );
    await mount();
    await drop(FARM);
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(screen.getByText(/Nothing was imported/)).toBeTruthy());
    expect(onImported).not.toHaveBeenCalled();
    // and the review is still there, so the clashing name can be fixed
    expect(screen.getByLabelText("Name for Untitled Polygon")).toBeTruthy();
  });

  it("reports what landed when it works", async () => {
    importGround.mockResolvedValueOnce({ pastureId: "new", paddocks: 1 });
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("Call the pasture"), { target: { value: "Home place" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this ground" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("Home place imported with 1 paddock."));
  });
});

describe("names that repeat", () => {
  it("says so while the names are still on screen, not after Import is pressed", async () => {
    // Google Earth names everything "Untitled Polygon". A file of five fields
    // routinely arrives with five identical names, and both the payload check
    // and the server refuse it — but only after a round trip nobody is
    // watching.
    await mount();
    await drop(FARM);
    fireEvent.change(screen.getByLabelText("What Farm perimeter is"), { target: { value: "paddock" } });
    fireEvent.change(screen.getByLabelText("Name for Farm perimeter"), {
      target: { value: "Untitled Polygon" },
    });
    // Reported as spelled, not lowercased — the app must not look like it is
    // renaming things behind the farmer.
    expect(screen.getByText(/both called "Untitled Polygon"/)).toBeTruthy();
  });

  it("says nothing while every name is its own", async () => {
    await mount();
    await drop(FARM);
    expect(screen.queryByText(/give them different names/)).toBeNull();
  });
});
