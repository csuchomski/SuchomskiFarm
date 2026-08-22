import { useCallback, useEffect, useState } from "react";
import { Pill, Button, GridRow, Callout, SaveToast } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  addPaymentMethod,
  fetchAllPaymentMethods,
  renamePaymentMethod,
  setMethodActive,
  validateMethod,
  type PaymentMethodOption,
} from "../lib/payment-methods";
import "./ground.css";

/**
 * Settings → Payments: what this farm takes.
 *
 * The list was one global three — Cash, Venmo, Check — shared by every
 * business on the instance and editable only from the SQL editor. Migration
 * 057 gave each business its own; this is where a farm decides what is on it.
 *
 * **Nothing is ever deleted.** A method that has been used is referenced by
 * every order paid that way, and "how was this paid" has to keep answering
 * for the books long after the farm stops taking it. Retiring takes it off
 * the dropdown and leaves the history alone.
 *
 * **The name is editable, the code is not.** `code` is what sits in
 * `orders.payment_method`; renaming "Venmo" to "Venmo (Meghan)" changes what
 * a customer reads and leaves every order that already says Venmo intact.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; methods: PaymentMethodOption[] };

const COLS = "minmax(0, 1fr) 110px 150px";
const COLS_SM = "minmax(0, 1fr) 142px";

export default function Payments() {
  const { business, role } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const isOwner = role === "owner";

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "error", message: "No business on this account." });
      return;
    }
    setLoad({ state: "ok", methods: await fetchAllPaymentMethods(businessId) });
  }, [businessId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await what();
      await refresh();
      setNote(said);
      setAdding(false);
      setEditing(null);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const methods = load.state === "ok" ? load.methods : EMPTY;
  const onOffer = methods.filter((m) => m.active).length;
  const problem = validateMethod(draft, methods);

  return (
    <>
      {load.state === "loading" && <p className="gnd-quiet">Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>{load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          {error && <p className="gnd-error">{error}</p>}
          <SaveToast note={note} onDone={() => setNote(null)} />

          {!isOwner && (
            <div style={{ margin: "12px 0" }}>
              <Callout>
                You are a {role ?? "member"} on this farm, so this page reads. What the farm takes
                is an owner's to change.
              </Callout>
            </div>
          )}

          <p className="gnd-quiet" style={{ padding: "10px 4px" }}>
            {onOffer === 0
              ? "Nothing is on offer, so a pickup can be recorded without saying how it was paid."
              : `${onOffer} ${onOffer === 1 ? "way" : "ways"} to pay, offered when an order is collected — at the farm and in the customer's own shop.`}
          </p>

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Method</span>
            <span className="hide-sm">On the order</span>
            <span />
          </GridRow>

          {methods.map((m) => (
            <GridRow key={m.code} cols={COLS} mobileCols={COLS_SM} as="body" highlight={!m.active}>
              <span style={{ minWidth: 0 }}>
                {editing === m.code ? (
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    aria-label={`Rename ${m.label}`}
                    style={{ maxWidth: 260 }}
                  />
                ) : (
                  <>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {m.label}
                    </span>
                    {!m.active && (
                      <>
                        {" "}
                        <Pill variant="outline">retired</Pill>
                      </>
                    )}
                  </>
                )}
              </span>

              <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                {m.code}
              </span>

              <span className="gnd-row-acts">
                {isOwner &&
                  (editing === m.code ? (
                    <>
                      <button
                        type="button"
                        className="link-button mono"
                        disabled={busy || editLabel.trim() === ""}
                        onClick={() =>
                          void run(
                            () => renamePaymentMethod(businessId!, m.code, editLabel),
                            `Customers see ${editLabel.trim()} now.`,
                          )
                        }
                      >
                        save
                      </button>
                      <button
                        type="button"
                        className="link-button mono"
                        onClick={() => setEditing(null)}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="link-button mono"
                        aria-label={`rename ${m.label}`}
                        onClick={() => {
                          setEditing(m.code);
                          setEditLabel(m.label);
                        }}
                      >
                        rename
                      </button>
                      {/* Neutral, not red: red is what Ground spends on
                          `remove`, and retiring a method takes nothing away —
                          the row stays, the orders keep it, and the next
                          click puts it back. */}
                      <button
                        type="button"
                        className="link-button mono"
                        disabled={busy}
                        aria-label={m.active ? `retire ${m.label}` : `put ${m.label} back`}
                        onClick={() =>
                          void run(
                            () => setMethodActive(businessId!, m.code, !m.active),
                            m.active
                              ? `${m.label} is off the list. Orders already paid that way keep it.`
                              : `${m.label} is on the list again.`,
                          )
                        }
                      >
                        {m.active ? "retire" : "put back"}
                      </button>
                    </>
                  ))}
              </span>
            </GridRow>
          ))}

          {isOwner && (
            <div style={{ marginTop: 16 }}>
              {adding ? (
                <div className="grz-form">
                  <div className="grz-form__row">
                    <label className="grz-field grz-field--wide" style={{ maxWidth: 320 }}>
                      <span className="eyebrow">What do you call it</span>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="Payment method"
                        placeholder="Zelle"
                      />
                    </label>
                  </div>
                  <p className="grz-optional">
                    This is what a customer reads when they say how they paid. It goes on the end of
                    the list.
                  </p>
                  {draft.trim() !== "" && problem && <p className="gnd-error">{problem}</p>}
                  <div className="grz-form__actions">
                    <Button
                      variant="filled"
                      disabled={busy || problem !== null}
                      onClick={() =>
                        void run(
                          () => addPaymentMethod(businessId!, draft),
                          `${draft.trim()} is on the list.`,
                        )
                      }
                    >
                      {busy ? "Adding…" : "Add it"}
                    </Button>
                    <Button
                      onClick={() => {
                        setAdding(false);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => setAdding(true)}>Another way to pay</Button>
              )}
            </div>
          )}

          <p className="grz-optional" style={{ maxWidth: "68ch", marginTop: 18 }}>
            A method is never deleted, only retired: every order paid that way still names it, and
            the books have to keep being able to say how the money came in. What this farm takes is
            its own — another farm's list is not affected by anything here.
          </p>
        </>
      )}
    </>
  );
}

const EMPTY: PaymentMethodOption[] = [];
