import { describe, expect, it } from "vitest";

/**
 * Every link into an animal's record goes through `animalPath`.
 *
 * `/animals/:tag` is resolved by `fetchAnimalByTag`. An animal also has an
 * `id`, and the two are both strings sitting on the same object one field
 * apart — so `${who.id}` type-checks, renders, routes, and lands on "No
 * animal on tag 697d7ecf-…". That is what the mob member list did, and
 * nothing caught it: the link was never clicked in a test, and fifteen other
 * call sites got it right.
 *
 * The tag has a second failure the id does not. An animal with a blank tag —
 * `record_calving` wrote them until migration 059 — interpolates to
 * `/animals/`, which is the list, so her record has no link at all. That is
 * how a bull calf called Victor became unreachable.
 *
 * One helper answers both: `animalPath` uses the tag and falls back to the
 * id. So the rule this enforces is no longer "interpolate the right field",
 * it is **don't build this path by hand**.
 *
 * This reads the source rather than mounting pages. It is not the sort of
 * thing worth mounting sixteen pages to check, and a render test would only
 * ever cover the page somebody thought to write one for — which is exactly
 * the page that had the bug.
 */

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `/animals/${…}` — capturing what goes in the hole. */
const LINK = /\/animals\/\$\{([^}]*)\}/g;

/** Where `animalPath` itself is defined, and the one place allowed to build
 *  the path from parts. */
const HOME = "lib/herd.ts";

const files = () =>
  Object.entries(sources).filter(([path]) => !path.includes(".test.") && !path.endsWith(HOME));

describe("links into an animal record", () => {
  it("go through animalPath rather than interpolating a field", () => {
    const wrong: string[] = [];
    for (const [path, src] of files()) {
      for (const [, expression] of src.matchAll(LINK)) {
        wrong.push(`${path.replace("../", "")}: /animals/\${${expression}} — call animalPath(animal)`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is reading real call sites, so an empty pass means something", () => {
    // A glob that matched nothing, or a helper nobody calls, would pass the
    // test above for ever.
    const calls = files().flatMap(([, src]) => [...src.matchAll(/animalPath\(/g)]);
    expect(calls.length).toBeGreaterThan(8);
  });

  it("has the helper where the exemption says it is", () => {
    const home = Object.entries(sources).find(([path]) => path.endsWith(HOME));
    expect(home).toBeTruthy();
    expect(home![1].includes("export const animalPath")).toBe(true);
  });
});
