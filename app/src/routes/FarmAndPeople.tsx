import { useCallback, useEffect, useState } from "react";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  FARM_ROLES,
  fetchPeople,
  removePerson,
  renameFarm,
  setPersonRole,
  type FarmRole,
  type Person,
} from "../lib/farm-people";
import "./ground.css";

/**
 * Settings → Farm & people.
 *
 * The two things about a farm that had no screen anywhere. Its name was typed
 * once on the way in and could not be changed; who can sign in lived in a
 * table readable only from the SQL editor, so a farm taking on a helper had
 * no way to let them in.
 *
 * **Only an owner may change either**, which is what the policies already
 * said — so the page reads for everyone and writes for owners, and says which
 * it is doing rather than offering controls that fail.
 *
 * **You cannot demote or remove yourself.** A farm whose last owner made
 * themselves a viewer has nobody who can undo it, and the fix would be a
 * support request. The guard is here rather than in the database because it
 * is about not shooting yourself in the foot, not about tenancy.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; people: Person[] };

/**
 * Two columns, not three.
 *
 * The remove link started in a column of its own, which meant hiding it on a
 * phone the way every other row action is hidden — and removing somebody's
 * access is not a thing you can only do at a desk. It sits under what they
 * can do instead, and survives the narrow screen.
 */
const COLS = "minmax(0, 1fr) 170px";
const COLS_SM = "minmax(0, 1fr) 132px";

export default function FarmAndPeople() {
  const { business, farmId, role, userId, reload } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const isOwner = role === "owner";

  const refresh = useCallback(async () => {
    if (!business) {
      setLoad({ state: "error", message: "No business on this account." });
      return;
    }
    setName(business.name);
    setLoad({ state: "ok", people: await fetchPeople(business.id) });
  }, [business]);

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
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const people = load.state === "ok" ? load.people : EMPTY;
  const owners = people.filter((p) => p.role === "owner").length;
  const changed = business !== null && name.trim() !== business.name;

  return (
    <>
      {load.state === "loading" && <p className="gnd-quiet">Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>{load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          {error && <p className="gnd-error">{error}</p>}
          {note && <p className="gnd-note">{note}</p>}

          {!isOwner && (
            <div style={{ margin: "12px 0" }}>
              <Callout>
                You are a {role ?? "member"} on this farm, so this page reads. Changing the name or
                who has access is an owner's to do.
              </Callout>
            </div>
          )}

          {/* ── the name ─────────────────────────────────────────────── */}
          <div className="serif" style={{ fontSize: 21, margin: "14px 0 8px" }}>
            The farm
          </div>
          <div className="grz-form">
            <div className="grz-form__row">
              <label className="grz-field grz-field--wide" style={{ maxWidth: 420 }}>
                <span className="eyebrow">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="Farm name"
                  disabled={!isOwner}
                />
              </label>
            </div>
            <p className="grz-optional">
              This is the name on the rail, on the grazing record you print, and on anything the
              store shows a customer.
            </p>
            {isOwner && (
              <div className="grz-form__actions">
                <Button
                  variant="filled"
                  disabled={busy || !changed || name.trim() === ""}
                  onClick={() =>
                    void run(
                      () => renameFarm({ businessId: business!.id, farmId, name }),
                      `The farm is called ${name.trim()} now.`,
                    ).then(reload)
                  }
                >
                  {busy ? "Saving…" : "Save the name"}
                </Button>
              </div>
            )}
          </div>

          {/* ── who can sign in ──────────────────────────────────────── */}
          <div className="serif" style={{ fontSize: 21, margin: "28px 0 4px" }}>
            Who can sign in
          </div>
          <p className="gnd-quiet" style={{ padding: "0 4px 10px" }}>
            {people.length} {people.length === 1 ? "person has" : "people have"} access to this farm.
          </p>

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Person</span>
            <span>Can do</span>
          </GridRow>

          {people.map((p) => {
            const isMe = p.userId === userId;
            const lastOwner = p.role === "owner" && owners === 1;
            return (
              <GridRow key={p.userId} cols={COLS} mobileCols={COLS_SM} as="body">
                <span style={{ minWidth: 0 }}>
                  <span className="serif" style={{ fontSize: 17 }}>
                    {p.name ?? p.email ?? "Somebody with no profile yet"}
                  </span>
                  {isMe && (
                    <>
                      {" "}
                      <Pill variant="outline-green">you</Pill>
                    </>
                  )}
                  <br />
                  <span className="gnd-meta" style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                    {[p.name === null ? null : p.email, `since ${p.addedAt.slice(0, 10)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>

                <span style={{ display: "grid", gap: 6, justifyItems: "start" }}>
                  {isOwner && !isMe ? (
                    <select
                      className="kml-role"
                      value={p.role}
                      aria-label={`What ${p.name ?? p.email ?? "this person"} can do`}
                      onChange={(e) =>
                        void run(
                          () => setPersonRole(business!.id, p.userId, e.target.value as FarmRole),
                          "Access changed.",
                        )
                      }
                    >
                      {FARM_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ fontSize: 14 }}>
                      {FARM_ROLES.find((r) => r.value === p.role)?.label ?? p.role}
                    </span>
                  )}

                  {isOwner && !isMe && !lastOwner ? (
                    confirming === p.userId ? (
                      <span className="gnd-row-acts">
                        <button
                          type="button"
                          className="link-button mono gnd-danger"
                          disabled={busy}
                          aria-label={`really remove ${p.name ?? p.email ?? "this person"}`}
                          onClick={() =>
                            void run(
                              () => removePerson(business!.id, p.userId),
                              "They can no longer sign in. Everything they recorded stays.",
                            )
                          }
                        >
                          really remove
                        </button>
                        <button
                          type="button"
                          className="link-button mono"
                          onClick={() => setConfirming(null)}
                        >
                          keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link-button mono gnd-danger"
                        aria-label={`remove ${p.name ?? p.email ?? "this person"}`}
                        onClick={() => setConfirming(p.userId)}
                      >
                        remove
                      </button>
                    )
                  ) : (
                    (isMe || lastOwner) && (
                      <span
                        className="gnd-meta"
                        style={{ fontSize: 12.5, color: "var(--ink-faint)" }}
                      >
                        {isMe ? "yourself" : "the only owner"}
                      </span>
                    )
                  )}
                </span>
              </GridRow>
            );
          })}

          <div style={{ margin: "18px 0 4px" }}>
            <Callout>
              {FARM_ROLES.map((r) => `${r.label}: ${r.can}`).join(" · ")}
            </Callout>
          </div>

          <p className="grz-optional" style={{ maxWidth: "68ch" }}>
            There is no invitation yet — somebody has to have an account before they can be given
            access, and signups are closed while the subscription side is being built. Removing
            access takes nothing away from the record: the moves, milkings and weights they entered
            stay exactly as they are.
          </p>
        </>
      )}
    </>
  );
}

const EMPTY: Person[] = [];
