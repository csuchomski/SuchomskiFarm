/**
 * How to write about an animal on her own page. Or his.
 *
 * Every page in Herd was written about a cow, because a cow is what the farm
 * mostly has — "What she has done", "Her whole life on this farm", "She is
 * ahead by". Then a bull calf called Victor got a record and every line of it
 * was wrong about him, on a page that had his sex on the identity line two
 * inches above.
 *
 * `herd.animals.sex` is `CHECK (sex = ANY (ARRAY['female', 'male']))` — two
 * values, both always present, so this is a total function and there is no
 * unknown case to design around. If that CHECK ever grows a third value, the
 * fallback here is they/them rather than a guess.
 */

export interface Pronouns {
  /** she · he — "**she** is ahead by" */
  subject: string;
  /** her · him — "booked against **her**" */
  object: string;
  /** her · his — "**her** milk" */
  possessive: string;
  /** hers · his — "the calf is **hers**" */
  possessiveNoun: string;
  /** Capitalised, for the start of a sentence. */
  Subject: string;
  Possessive: string;
  /** Kept on the pronoun so no call site has to think about agreement. */
  is: string;
  was: string;
  has: string;
}

const SHE: Pronouns = {
  subject: "she",
  object: "her",
  possessive: "her",
  possessiveNoun: "hers",
  Subject: "She",
  Possessive: "Her",
  is: "is",
  was: "was",
  has: "has",
};

const HE: Pronouns = {
  subject: "he",
  object: "him",
  possessive: "his",
  possessiveNoun: "his",
  Subject: "He",
  Possessive: "His",
  is: "is",
  was: "was",
  has: "has",
};

const THEY: Pronouns = {
  subject: "they",
  object: "them",
  possessive: "their",
  possessiveNoun: "theirs",
  Subject: "They",
  Possessive: "Their",
  // Not "is"/"has": a third value would be a singular they, and the agreement
  // has to come with the pronoun or every call site gets it wrong.
  is: "are",
  was: "were",
  has: "have",
};

export function pronounsFor(animal: { sex: string }): Pronouns {
  if (animal.sex === "male") return HE;
  if (animal.sex === "female") return SHE;
  return THEY;
}
