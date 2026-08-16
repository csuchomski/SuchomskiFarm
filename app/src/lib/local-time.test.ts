import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput } from "./local-time";

/**
 * The clock on the wall, not the clock in the database.
 *
 * If these two disagree, every correction quietly shifts the move by the
 * offset — and drags the boundary behind it, so the paddock before it grows
 * or shrinks by the same amount. Nothing on screen would say so.
 */

describe("an instant, in the form", () => {
  it("shows the local time, not UTC", () => {
    // Built from local parts, so this holds in whatever zone the tests run in.
    const local = new Date(2026, 7, 14, 7, 30);
    expect(toLocalInput(local.toISOString())).toBe("2026-08-14T07:30");
  });

  it("pads every part, because the input will not take 2026-8-4T7:05", () => {
    expect(toLocalInput(new Date(2026, 7, 4, 7, 5).toISOString())).toBe("2026-08-04T07:05");
  });

  it("comes back the same instant it went in", () => {
    const iso = new Date(2026, 10, 2, 16, 45).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it("survives a date the browser cannot parse rather than inventing one", () => {
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("2026-13-45T99:99")).toBeNull();
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("   ")).toBeNull();
  });

  it("round-trips across the turn of a year, where the naive maths goes wrong", () => {
    const iso = new Date(2026, 11, 31, 23, 30).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });
});
