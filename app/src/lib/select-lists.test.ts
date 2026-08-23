// Vite's `?raw`, not `node:fs`: this project's tsconfig carries `vite/client`
// types and not node's, so reading the file the node way builds under vitest
// and fails `tsc -b`, which is the gate that matters.
import source from "./grazing.ts?raw";
import { describe, expect, it } from "vitest";

/**
 * Every column a mapper reads has to be a column the query asked for.
 *
 * PostgREST returns exactly the columns named in `select`, and nothing else.
 * Read `r.some_column` that the select list left out and you get `undefined`,
 * which `num()` turns into null and the rest of the app treats as "the farm
 * has not set one" — so the app quietly falls back to its own figure and
 * every test that mocks the fetch still passes.
 *
 * That is not hypothetical. `default_utilization_pct` was added to the table,
 * to the writer, to the type and to the mapper, and left out of both select
 * lists; the whole feature was dead on the live site and green in the suite.
 * This reads the source rather than the network, so it costs nothing and
 * fails on the next one.
 *
 * It works a function at a time, because a function can run two queries and
 * map them together — `fetchGroupMembers` reads members and animal statuses
 * side by side — and a column named in either select is a column that
 * arrived.
 */

/** The source split at top-level function declarations, one entry each. */
function functions(src: string): { name: string; body: string; at: number }[] {
  const re = /^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/gm;
  const heads: { name: string; index: number }[] = [];
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    heads.push({ name: m[1], index: m.index });
  }
  return heads.map((h, i) => ({
    name: h.name,
    body: src.slice(h.index, heads[i + 1]?.index ?? src.length),
    at: src.slice(0, h.index).split("\n").length,
  }));
}

/**
 * The bare top-level column names in every `.select("…")` in a block.
 *
 * A select can name embedded resources — `paddock:paddocks(name)` — and can
 * rename. Those reach the mapper under a name of their own, so anything with
 * a colon or parentheses is left out of the check rather than guessed at.
 */
function columnsAsked(block: string): { columns: Set<string>; any: boolean; embeds: boolean } {
  const columns = new Set<string>();
  let any = false;
  let embeds = false;
  const re = /\.select\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    any = true;
    if (m[1].includes("*")) embeds = true;
    for (const raw of m[1].split(",")) {
      const c = raw.trim();
      if (c === "") continue;
      if (c.includes(":") || c.includes("(") || c.includes(")")) embeds = true;
      else columns.add(c);
    }
  }
  return { columns, any, embeds };
}

/** `r.foo`, `row.foo` — a snake_case field read off a returned row. */
function columnsRead(block: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:r|row)\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) out.add(m[1]);
  return [...out];
}

describe("grazing.ts asks for every column it reads", () => {
  const fns = functions(source);
  const querying = fns.filter((f) => {
    const asked = columnsAsked(f.body);
    // A `*` or an embedded resource makes the select list an unreliable
    // account of what arrives, so those functions are out of scope rather
    // than reported wrongly.
    return asked.any && !asked.embeds;
  });

  it("finds the queries at all, so a passing run means something", () => {
    expect(querying.length).toBeGreaterThan(10);
  });

  it("names each column in one of its own selects", () => {
    const missing: string[] = [];
    for (const fn of querying) {
      const asked = columnsAsked(fn.body);
      for (const col of columnsRead(fn.body)) {
        if (!asked.columns.has(col)) missing.push(`${fn.name} (grazing.ts:${fn.at}) reads ${col}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("asks for the utilization the plan form writes", () => {
    // The one that got away, named on its own so the failure says what broke
    // rather than pointing at a list.
    const planReaders = querying.filter((f) => columnsAsked(f.body).columns.has("default_dmi_pct_bw"));
    expect(planReaders.map((f) => f.name).sort()).toEqual(["fetchActivePlan", "fetchPlans"]);
    for (const fn of planReaders) {
      expect(columnsAsked(fn.body).columns).toContain("default_utilization_pct");
    }
  });
});
