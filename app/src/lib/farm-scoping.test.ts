import herd from "./herd.ts?raw";
import repro from "./repro.ts?raw";
import genetics from "./genetics.ts?raw";
import grazing from "./grazing.ts?raw";
import dispositions from "./dispositions.ts?raw";
import sires from "./sires.ts?raw";
import animalMoney from "./animal-money.ts?raw";
import attribution from "./attribution.ts?raw";
import { describe, expect, it } from "vitest";

/**
 * A read of the herd schema must say which farm it means.
 *
 * RLS answers a different question. It decides whether this user *may* see a
 * row, and the answer is yes for every farm they belong to — so an unfiltered
 * read is correct on an account with one farm and wrong on an account with
 * two, without anything in the code changing.
 *
 * That is not hypothetical either. Seeding two demo farms turned
 * `fetchVoluntaryWaitDays` into a crash — every farm holds that settings key,
 * so `maybeSingle()` found three rows and threw — and turned `fetchAnimals`
 * into a page that listed another farm's herd with nothing to say it had.
 * The crash was the lucky one; the animals list was silently wrong.
 *
 * ── What counts as scoped ─────────────────────────────────────────────
 *
 * A `farm_id` filter, or a filter on a key that is already a farm's: an
 * animal id, a plan id, a disposition id, a group id. Those come from rows
 * that were themselves fetched under a farm, so filtering by them cannot
 * cross a farm boundary.
 *
 * Anything else is listed in EXPECTED below with the reason, so that adding
 * a new unscoped read fails here rather than on somebody's screen.
 */

const SOURCES: [string, string][] = [
  ["herd.ts", herd],
  ["repro.ts", repro],
  ["genetics.ts", genetics],
  ["grazing.ts", grazing],
  ["dispositions.ts", dispositions],
  ["sires.ts", sires],
  ["animal-money.ts", animalMoney],
  ["attribution.ts", attribution],
];

/**
 * Filters that carry a farm with them, because the id came from one.
 *
 * `id` is in here because `.eq("id", x)` is a fetch of one known row, and the
 * id was itself read under a farm. The rest are foreign keys to rows that
 * were: a lot, a plan, an animal, a ledger transaction.
 */
const SCOPED_BY = [
  "farm_id",
  "animal_id",
  "plan_id",
  "disposition_id",
  "group_id",
  "paddock_id",
  "lot_id",
  "semen_lot_id",
  "condition_id",
  "ledger_transaction_id",
];

/** `.eq("id", …)` is a fetch of one known row, and the id was read under a
 * farm. Matched on the call and not the bare word, so a `select("id")` does
 * not read as a filter. */
const BY_PRIMARY_KEY = /\.eq\("id",/;

/**
 * Reads that are deliberately farm-wide, each because it builds an id-keyed
 * lookup rather than a list somebody sees. A wider map costs a few rows and
 * changes no answer: the only ids ever looked up in it came from rows that
 * were already scoped.
 *
 * Anything added here needs that to be true of it. "It seems fine" is how
 * `fetchAnimals` stayed unscoped.
 */
const EXPECTED = new Set([
  "herd.ts:breeds", // id-keyed lookup behind breed_composition
  "animal-money.ts:expense_categories", // id → label, for entries already fetched
  "attribution.ts:expense_categories", // same
]);

/** Every `herdSchema().from("x")` read, with the chain that follows it. */
function reads(src: string): { table: string; chain: string; line: number }[] {
  const out: { table: string; chain: string; line: number }[] = [];
  const re = /herdSchema\(\)\s*\.?\s*\n?\s*\.from\("(\w+)"\)/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const after = src.slice(m.index);
    const end = after.indexOf(";");
    const chain = end > 0 ? after.slice(0, end) : after.slice(0, 900);
    // Writes carry their own scoping in the row they write.
    if (/\.(insert|upsert|update|delete)\(/.test(chain)) continue;
    out.push({ table: m[1] ?? "", chain, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("herd reads say which farm they mean", () => {
  it("finds the reads at all, so a passing run means something", () => {
    const total = SOURCES.reduce((n, [, src]) => n + reads(src).length, 0);
    expect(total).toBeGreaterThan(30);
  });

  it("scopes every read, or names it as deliberately farm-wide", () => {
    const unscoped: string[] = [];
    for (const [file, src] of SOURCES) {
      for (const r of reads(src)) {
        if (SCOPED_BY.some((key) => r.chain.includes(`"${key}"`))) continue;
        if (BY_PRIMARY_KEY.test(r.chain)) continue;
        if (EXPECTED.has(`${file}:${r.table}`)) continue;
        unscoped.push(`${file}:${r.line} reads ${r.table} without saying which farm`);
      }
    }
    expect(unscoped).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a read that no longer exists is a comment pretending
    // to be a rule. If one of these is gone, the entry should go with it.
    const live = new Set(
      SOURCES.flatMap(([file, src]) => reads(src).map((r) => `${file}:${r.table}`)),
    );
    for (const e of EXPECTED) expect(live.has(e)).toBe(true);
  });
});
