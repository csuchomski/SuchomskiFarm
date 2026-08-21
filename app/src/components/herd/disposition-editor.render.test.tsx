// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Disposition } from "../../lib/dispositions";

/**
 * Recording how an animal left.
 *
 * The parts worth driving: that sale figures are offered for a live sale and
 * withheld from a processor's animal (058 credits that money back to her as
 * packaged meat, and booking it here as well counts the carcass twice), that
 * a cull can't be saved without a reason, and that the net is shown while it
 * is being typed rather than only after saving.
 */

const reasons = [
  { id: "r1", code: "LOW_PROD", label: "Low production", category: "production" },
  { id: "r2", code: "AGE", label: "Age", category: "age" },
];

type Record = typeof import("../../lib/dispositions").recordDisposition;
type Undo = typeof import("../../lib/dispositions").undoDisposition;

const recordDisposition = vi.fn<Record>(async () => "d1");
const undoDisposition = vi.fn<Undo>(async () => undefined);

vi.mock("../../lib/dispositions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dispositions")>()),
  fetchCullReasons: vi.fn(async () => reasons),
  recordDisposition: (...args: Parameters<Record>) => recordDisposition(...args),
  undoDisposition: (...args: Parameters<Undo>) => undoDisposition(...args),
}));

vi.mock("../../lib/local-time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/local-time")>()),
  todayLocal: () => "2026-08-21",
}));

const abigail = { id: "a1", birth_date: "2025-07-24" };

afterEach(() => {
  cleanup();
  recordDisposition.mockClear();
  undoDisposition.mockClear();
});

const mount = async (current: Disposition | null = null) => {
  const { DispositionEditor } = await import("./DispositionEditor");
  const onSaved = vi.fn();
  render(
    <DispositionEditor
      animal={abigail}
      farmId="farm-1"
      current={current}
      onCancel={vi.fn()}
      onSaved={onSaved}
    />,
  );
  // The reasons land in an effect; wait for one before touching the form.
  await waitFor(() => expect(screen.getByLabelText("How she left")).toBeTruthy());
  return { onSaved };
};

describe("what a sale brought", () => {
  it("works the net out while it is being typed", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Live weight, lb"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Price per cwt"), { target: { value: "135" } });
    fireEvent.change(screen.getByLabelText("Commission, $"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Hauling, $"), { target: { value: "75" } });

    // $1,620.00 gross; $1,505.00 after the barn's cut and the haul. The same
    // worked example migration 060 was rehearsed against.
    expect(screen.getByText("$1,620.00")).toBeTruthy();
    expect(screen.getByText("$1,505.00")).toBeTruthy();
    expect(screen.getByText(/Goes on her record as a live sale/)).toBeTruthy();
  });

  it("says nothing is booked when the deductions swallowed the cheque", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Gross"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Hauling, $"), { target: { value: "150" } });
    expect(screen.getByText(/nothing is booked as income/)).toBeTruthy();
  });

  it("calls it cull proceeds once she is marked a cull", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Gross"), { target: { value: "500" } });
    fireEvent.click(screen.getByLabelText("This was a cull"));
    expect(screen.getByText(/Goes on her record as cull proceeds/)).toBeTruthy();
  });

  it("is not offered at all for an animal sent to a processor", async () => {
    // Her money arrives later as packaged meat, and 058 credits it back to
    // her. A figure here as well would count the same carcass twice.
    await mount();
    expect(screen.queryByLabelText("Live weight, lb")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("How she left"), { target: { value: "processed" } });
    expect(screen.queryByLabelText("Live weight, lb")).toBeNull();
    expect(screen.getByText(/Nothing is booked as income for this one/)).toBeTruthy();
  });
});

describe("what stops it saving", () => {
  const recordButton = () => screen.getByRole("button", { name: "Record it" }) as HTMLButtonElement;

  it("wants a reason once she is marked a cull", async () => {
    await mount();
    expect(recordButton().disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("This was a cull"));
    expect(screen.getByText(/A cull needs a reason/)).toBeTruthy();
    expect(recordButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Why, mainly"), { target: { value: "r1" } });
    expect(recordButton().disabled).toBe(false);
  });

  it("won't offer the same reason twice", async () => {
    await mount();
    fireEvent.click(screen.getByLabelText("This was a cull"));
    fireEvent.change(screen.getByLabelText("Why, mainly"), { target: { value: "r1" } });
    const also = screen.getByLabelText("And also") as HTMLSelectElement;
    expect([...also.options].map((o) => o.value)).not.toContain("r1");
  });

  it("refuses a day she could not have left on", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("When she left"), { target: { value: "2026-12-25" } });
    expect(screen.getByText(/hasn't happened yet/)).toBeTruthy();
    expect(recordButton().disabled).toBe(true);
  });

  it("sends it once it is good", async () => {
    const { onSaved } = await mount();
    fireEvent.change(screen.getByLabelText("Buyer"), { target: { value: "Equity" } });
    fireEvent.change(screen.getByLabelText("Live weight, lb"), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText("Price per cwt"), { target: { value: "135" } });
    fireEvent.click(recordButton());

    await waitFor(() => expect(recordDisposition).toHaveBeenCalledTimes(1));
    expect(recordDisposition.mock.calls[0][0]).toBe("a1");
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("a departure already on file", () => {
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

  it("opens on what was recorded", async () => {
    await mount(recorded);
    expect((screen.getByLabelText("Live weight, lb") as HTMLInputElement).value).toBe("1200");
    expect((screen.getByLabelText("In your words") as HTMLInputElement).value).toBe("never bred back");
    expect(screen.getByText("$1,505.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save the change" })).toBeTruthy();
  });

  it("doesn't show 'Pick one' over a cull that has a reason on file", async () => {
    // The reasons arrive in an effect, one tick after the form is drawn. A
    // <select> whose value matches none of its options falls back to the
    // first, so for that tick the farmer saw "Pick one" over a cull that had
    // a reason — and would see it for good if the reasons failed to load.
    await mount(recorded);
    const why = screen.getByLabelText("Why, mainly") as HTMLSelectElement;
    expect(why.value).toBe("r1");
    expect(why.selectedOptions[0].textContent).not.toBe("Pick one");

    // And once they land, it is the reason's own label.
    await waitFor(() => expect((screen.getByLabelText("Why, mainly") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Low production"));
  });

  it("can be taken back, but asks first", async () => {
    // Marking the wrong cow sold should not need a SQL statement to undo,
    // and should not happen on one stray click either.
    const { onSaved } = await mount(recorded);
    fireEvent.click(screen.getByRole("button", { name: "she didn't go" }));
    expect(undoDisposition).not.toHaveBeenCalled();
    expect(screen.getByText(/Put her back on the farm/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "yes, undo it" }));
    await waitFor(() => expect(undoDisposition).toHaveBeenCalledWith("a1"));
    expect(onSaved).toHaveBeenCalled();
  });

  it("offers no undo before anything is recorded", async () => {
    await mount(null);
    expect(screen.queryByRole("button", { name: "she didn't go" })).toBeNull();
  });
});
