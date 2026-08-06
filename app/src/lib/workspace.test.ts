import { describe, expect, it } from "vitest";
import { missingRelation } from "./workspace";

/**
 * `missingRelation` decides whether an error is "this table doesn't exist
 * yet" — the one case the provider is allowed to swallow and fall back on.
 * Anything it wrongly matches gets absorbed into the pre-006 path, which
 * returns only the farm business, so the topbar switcher disappears with no
 * error shown anywhere. These tests exist because that already happened once.
 */
describe("missingRelation", () => {
  it("matches the un-migrated cases the fallback is for", () => {
    expect(missingRelation('relation "public.business_members" does not exist')).toBe(true);
    expect(missingRelation("Could not find the table 'public.business_members' in the schema cache")).toBe(true);
  });

  it("does not match a recursive RLS policy", () => {
    // The regression: the table is right there, the policy is broken, and
    // treating it as absent hid the failure behind a silent degrade.
    expect(
      missingRelation('infinite recursion detected in policy for relation "business_members"'),
    ).toBe(false);
  });

  it("does not match other live faults that mention a relation", () => {
    expect(missingRelation('permission denied for relation business_members')).toBe(false);
    expect(missingRelation('new row violates row-level security policy for relation "business_members"')).toBe(false);
  });

  it("does not match a plain connection failure", () => {
    expect(missingRelation("TypeError: Failed to fetch")).toBe(false);
  });
});
