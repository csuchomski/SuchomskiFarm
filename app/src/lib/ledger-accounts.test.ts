import { describe, expect, it } from "vitest";
import { validateAccount } from "./ledger-accounts";

const taken = ["Venmo", "Landmark CU - Farm", "5553 N Lyd Check"];

describe("validateAccount", () => {
  const draft = (name: string, openingBalance = "100") => ({ name, openingBalance });

  it("accepts a new name", () => {
    expect(validateAccount({ draft: draft("Farm Savings"), takenNames: taken })).toBeNull();
  });

  it("wants a name", () => {
    expect(validateAccount({ draft: draft("   "), takenNames: taken })).toMatch(/needs a name/);
  });

  it("refuses a name another business already uses", () => {
    // ledger_accounts_name_key is UNIQUE (name) globally, not per business —
    // so the clash has to be checked against every business's accounts, and
    // the message has to say why it's a clash at all.
    const problem = validateAccount({ draft: draft("Venmo"), takenNames: taken });
    expect(problem).toMatch(/already an account called Venmo/);
    expect(problem).toMatch(/unique across every business/);
  });

  it("catches a clash that differs only in case or spacing", () => {
    expect(validateAccount({ draft: draft("  venmo "), takenNames: taken })).toMatch(/already an account/);
  });

  it("lets an account keep its own name while its balance changes", () => {
    expect(validateAccount({ draft: draft("Venmo", "50"), takenNames: taken, currentName: "Venmo" })).toBeNull();
  });

  it("still refuses renaming onto someone else's name", () => {
    expect(
      validateAccount({ draft: draft("Landmark CU - Farm"), takenNames: taken, currentName: "Venmo" }),
    ).toMatch(/already an account/);
  });

  it("treats a blank opening balance as fine — it defaults to zero", () => {
    expect(validateAccount({ draft: draft("Farm Savings", ""), takenNames: taken })).toBeNull();
  });

  it("accepts a negative opening balance, which a credit card has", () => {
    expect(validateAccount({ draft: draft("Farm Card", "-240.19"), takenNames: taken })).toBeNull();
  });

  it("refuses an opening balance that isn't a number", () => {
    expect(validateAccount({ draft: draft("Farm Savings", "lots"), takenNames: taken })).toMatch(/has to be a number/);
  });
});
