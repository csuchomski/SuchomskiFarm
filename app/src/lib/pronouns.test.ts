import { describe, expect, it } from "vitest";
import { pronounsFor } from "./pronouns";

/**
 * Every page in Herd was written about a cow. Victor is a bull calf, and his
 * record called him "she" on a page that showed `male` two inches above.
 */

describe("pronounsFor", () => {
  it("writes about a bull as he", () => {
    const p = pronounsFor({ sex: "male" });
    expect(`What ${p.subject} ${p.has} done`).toBe("What he has done");
    expect(`booked against ${p.object}`).toBe("booked against him");
    expect(`${p.Possessive} whole life on this farm`).toBe("His whole life on this farm");
    expect(`${p.Subject} ${p.is} ahead by`).toBe("He is ahead by");
    expect(`${p.Subject} ${p.was} born`).toBe("He was born");
  });

  it("writes about a cow as she", () => {
    const p = pronounsFor({ sex: "female" });
    expect(`What ${p.subject} ${p.has} done`).toBe("What she has done");
    expect(`booked against ${p.object}`).toBe("booked against her");
    expect(`${p.Possessive} whole life on this farm`).toBe("Her whole life on this farm");
    expect(`${p.Subject} ${p.is} ahead by`).toBe("She is ahead by");
  });

  it("falls back to they, with the agreement that goes with it", () => {
    // herd.animals is CHECK (sex = ANY (ARRAY['female', 'male'])), so this is
    // unreachable today. If that CHECK ever grows a value, the page should
    // read oddly rather than call an animal the wrong thing — and the verb
    // has to come with the pronoun or the sentence breaks.
    const p = pronounsFor({ sex: "" });
    expect(`What ${p.subject} ${p.has} done`).toBe("What they have done");
    expect(`${p.Subject} ${p.is} ahead by`).toBe("They are ahead by");
    expect(`${p.Subject} ${p.was} born`).toBe("They were born");
  });
});
