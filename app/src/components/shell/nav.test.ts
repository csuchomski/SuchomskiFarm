import { describe, expect, it } from "vitest";
import { allGroups, groupsForModules } from "./nav";

const headings = (modules: string[]) => groupsForModules(modules).map((g) => g.heading);

describe("groupsForModules", () => {
  it("gives a farm business Herd, Store and Books", () => {
    expect(headings(["books", "herd", "store"])).toEqual(["Herd", "Store", "Books"]);
  });

  it("gives a rental business Properties and Leases, and no Herd", () => {
    const rental = headings(["books", "properties", "leases"]);
    expect(rental).toEqual(["Properties", "Leases", "Books"]);
    expect(rental).not.toContain("Herd");
  });

  it("gives a business with only books exactly that", () => {
    expect(headings(["books"])).toEqual(["Books"]);
  });

  it("shows nothing rather than everything when modules are unknown", () => {
    // The failure mode that matters: an empty module list must not fall
    // through to showing another business type's data.
    expect(headings([])).toEqual([]);
  });

  it("ignores module codes it doesn't have a group for", () => {
    expect(headings(["books", "not_a_real_module"])).toEqual(["Books"]);
  });

  it("keeps a stable order regardless of how the modules are ordered", () => {
    expect(headings(["store", "books", "herd"])).toEqual(headings(["herd", "store", "books"]));
  });

  it("every group declares a module, so none can be unreachable", () => {
    for (const group of allGroups) {
      expect(group.module).toBeTruthy();
      expect(groupsForModules([group.module])).toContain(group);
    }
  });
});
