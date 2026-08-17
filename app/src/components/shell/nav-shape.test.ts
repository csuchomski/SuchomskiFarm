import { describe, expect, it } from "vitest";
import { allGroups, alerts, settings, topLevel } from "./nav";
import appSource from "../../App.tsx?raw";

/**
 * What the rail lists.
 *
 * `nav.test.ts` covers which *groups* a business sees, which is about module
 * gating. Nothing covered the items inside them — so eleven Herd entries
 * became three and every test still passed. These pin the shape.
 *
 * The other half is that folding a page away must not unroute it. Everything
 * that left the rail is still reachable by link, and the route table is read
 * to prove it rather than taken on trust.
 */

const group = (heading: string) => allGroups.find((g) => g.heading === heading)!;
const labels = (heading: string) => group(heading).items.map((i) => i.label);

describe("the Herd section", () => {
  it("is three subjects, not eleven views of them", () => {
    expect(labels("Herd")).toEqual(["Animals", "Milking", "Breeding"]);
  });

  it("no longer lists the pages that folded into those three", () => {
    const gone = ["Genetics", "Lactations", "Milkings", "Sires", "Breedings", "Calvings"];
    for (const g of gone) expect(labels("Herd")).not.toContain(g);
  });

  it("drops Health, which was a label with no page behind it", () => {
    expect(labels("Herd")).not.toContain("Health");
    // And nothing else in the rail promises a page it cannot open.
    for (const grp of allGroups) {
      for (const item of grp.items) {
        if (item.to === undefined) continue;
        expect(item.to.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("what left Herd rather than folding into it", () => {
  it("puts Alerts beside Today, both being about what today needs", () => {
    expect(alerts.to).toBe("/alerts");
    expect(topLevel.to).toBe("/");
    for (const g of allGroups) expect(g.items.map((i) => i.label)).not.toContain("Alerts");
  });

  it("puts Depreciation under Books, where the tax work is", () => {
    expect(labels("Books")).toContain("Depreciation");
    expect(labels("Herd")).not.toContain("Depreciation");
  });

  it("puts Breeds behind Settings, which belongs to no module", () => {
    expect(settings.to).toBe("/settings");
    for (const g of allGroups) expect(g.items.map((i) => i.label)).not.toContain("Breeds");
    // Settings is deliberately not a group: a business with no herd still
    // has things to configure, so it cannot hang off a module.
    expect(allGroups.map((g) => g.heading)).not.toContain("Settings");
  });
});

describe("hidden is not deleted", () => {
  it("still routes every page that came off the rail", () => {
    for (const path of [
      "/genetics", "/lactations", "/milkings", "/sires", "/breedings",
      "/calvings", "/breeds", "/alerts", "/depreciation",
    ]) {
      expect(appSource).toContain(`path="${path}"`);
    }
  });

  it("routes the pages the rail now points at", () => {
    for (const path of ["/animals", "/milking", "/breeding", "/settings"]) {
      expect(appSource).toContain(`path="${path}"`);
    }
  });

  it("keeps the animal record on its own route, under the folded list", () => {
    // /animals is now a tabbed page; /animals/:tag must still open one animal.
    expect(appSource).toContain('path="/animals/:tag"');
  });

  it("points every rail item at a route that exists", () => {
    const items = [topLevel, alerts, settings, ...allGroups.flatMap((g) => g.items)];
    for (const item of items) {
      if (item.to === undefined || item.to === "/") continue;
      // Query strings are the tab, not part of the route.
      const path = item.to.split("?")[0];
      expect(`${item.label} → ${appSource.includes(`path="${path}"`)}`).toBe(`${item.label} → true`);
    }
  });
});
