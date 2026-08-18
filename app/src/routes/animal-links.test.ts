import { describe, expect, it } from "vitest";

/**
 * Every link into an animal's record carries its ear tag.
 *
 * `/animals/:tag` is resolved by `fetchAnimalByTag`, which is
 * `.eq("ear_tag", tag)`. An animal also has an `id`, and the two are both
 * strings sitting on the same object one field apart — so `${who.id}` type-
 * checks, renders, routes, and lands on "No animal on tag
 * 697d7ecf-a7c1-4a7d-8f9a-f60566aa3870". That is what the mob member list
 * did, and nothing caught it: the link was never clicked in a test, and
 * fifteen other call sites got it right.
 *
 * This reads the source instead. It is not the sort of thing worth mounting
 * sixteen pages to check, and a render test would only ever cover the page
 * somebody thought to write one for — which is exactly the page that had the
 * bug.
 */

const sources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** `to={`/animals/${…}`}` — capturing what goes in the hole. */
const LINK = /\/animals\/\$\{([^}]*)\}/g;

describe("links into an animal record", () => {
  it("interpolate the ear tag, never the id", () => {
    const wrong: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.includes(".test.")) continue;
      for (const [, expression] of src.matchAll(LINK)) {
        if (!expression.includes("ear_tag")) {
          wrong.push(`${path.replace("../", "")}: /animals/\${${expression}}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is reading real call sites, so an empty pass means something", () => {
    // A regex that matched nothing would pass the test above for ever.
    const found = Object.values(sources).flatMap((src) => [...src.matchAll(LINK)]);
    expect(found.length).toBeGreaterThan(8);
  });
});
