import { describe, expect, it } from "vitest";
import { allGroups, groupsForModules, moduleForPath } from "./nav";

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

describe("moduleForPath", () => {
  it("maps a built route to the module that owns it", () => {
    expect(moduleForPath("/animals")).toBe("herd");
    expect(moduleForPath("/store/products")).toBe("store");
    expect(moduleForPath("/books/transactions")).toBe("books");
  });

  it("gates a record page the same as its index", () => {
    expect(moduleForPath("/animals/1103")).toBe("herd");
  });

  it("leaves home ungated, so every business type has somewhere to land", () => {
    expect(moduleForPath("/")).toBeNull();
  });

  it("leaves an unknown path ungated rather than guessing a module", () => {
    // Gating on a guess would make a typo'd URL redirect instead of 404,
    // which hides the mistake.
    expect(moduleForPath("/nope")).toBeNull();
  });

  it("doesn't match a path that merely shares a prefix", () => {
    expect(moduleForPath("/animalsomething")).toBeNull();
  });

  it("gates every built nav item, so no link can outlive its module", () => {
    for (const group of allGroups) {
      for (const item of group.items) {
        if (!item.to) continue;
        expect(moduleForPath(item.to)).toBe(group.module);
      }
    }
  });
});
