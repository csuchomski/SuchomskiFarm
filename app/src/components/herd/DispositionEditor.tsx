import { useEffect, useState } from "react";
import { Button } from "../ui";
import { formatMoney } from "../../lib/sires";
import { todayLocal } from "../../lib/local-time";
import {
  EXIT_CHANNELS,
  SALE_CHANNELS,
  carriesSale,
  draftFrom,
  emptyDisposition,
  fetchCullReasons,
  hasSale,
  recordDisposition,
  saleFigures,
  undoDisposition,
  validateDisposition,
  type CullReason,
  type Disposition,
  type DispositionDraft,
} from "../../lib/dispositions";
import "./disposition-editor.css";

/**
 * Recording how an animal left the farm.
 *
 * Her status could always be set to 'sold' or 'died' on the edit form, and
 * that was all: no day, no reason, no money. This writes the record that was
 * always meant to hold those — see migration 060 — and sets her status as a
 * consequence rather than as the thing being typed.
 *
 * **The sale block only appears for an animal sold live.** One sent to a
 * processor earns later, as packaged meat sold through the store, and
 * migration 058 credits that back to her; a figure typed here as well would
 * count the same carcass twice.
 *
 * **Net is shown while it is being typed**, because a gross of $1,620 reads
 * as the answer right up until the barn's commission and the hauling come
 * off it.
 */
export function DispositionEditor({
  animal,
  farmId,
  current,
  onCancel,
  onSaved,
}: {
  animal: { id: string; birth_date: string };
  farmId: string | null;
  /** What is already recorded, when this is an edit rather than a first. */
  current: Disposition | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const today = todayLocal();
  const [draft, setDraft] = useState<DispositionDraft>(() =>
    current ? draftFrom(current, today) : emptyDisposition(today),
  );
  // null while they are still coming. The difference matters: an empty list
  // and a list that hasn't arrived look identical in a <select>, and one of
  // them would show "Pick one" over a cull that has a reason on file.
  const [reasons, setReasons] = useState<CullReason[] | null>(null);
  const [reasonsFailed, setReasonsFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUndo, setConfirmingUndo] = useState(false);

  useEffect(() => {
    if (!farmId) {
      setReasons([]);
      return;
    }
    let cancelled = false;
    fetchCullReasons(farmId)
      .then((r) => !cancelled && setReasons(r))
      // A farm whose reasons won't load can still record that she went; it
      // just can't say why, which beats refusing to save anything. It says so
      // rather than showing an empty list as though there were none.
      .catch(() => {
        if (cancelled) return;
        setReasons([]);
        setReasonsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId]);

  const set = <K extends keyof DispositionDraft>(key: K, value: DispositionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const problem = validateDisposition(draft, animal, today);
  const loaded = reasons ?? [];
  /** A reason already on file, before the list it belongs to has arrived. The
   *  select would otherwise fall back to its first option and show "Pick one"
   *  over a cull that has a reason. */
  const standIn = (id: string) =>
    id !== "" && !loaded.some((r) => r.id === id) ? (
      <option value={id}>{reasons === null ? "Loading…" : "The reason on file"}</option>
    ) : null;
  const showSale = carriesSale(draft.exitChannel);
  const { grossCents, netCents } = saleFigures(draft);
  const channel = EXIT_CHANNELS.find((c) => c.code === draft.exitChannel);

  const save = async () => {
    if (problem) return;
    setSaving(true);
    setError(null);
    try {
      await recordDisposition(animal.id, draft);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    setSaving(true);
    setError(null);
    try {
      await undoDisposition(animal.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animal-form disposition-editor">
      <div className="animal-form__grid">
        <label className="animal-form__field">
          <span className="eyebrow">How she left</span>
          <select
            className="animal-form__input"
            value={draft.exitChannel}
            aria-label="How she left"
            onChange={(e) => set("exitChannel", e.target.value)}
          >
            {EXIT_CHANNELS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          {channel?.hint && <span className="disposition-editor__hint">{channel.hint}</span>}
        </label>

        <label className="animal-form__field">
          <span className="eyebrow">When</span>
          <input
            className="animal-form__input mono"
            type="date"
            value={draft.date}
            aria-label="When she left"
            onChange={(e) => set("date", e.target.value)}
          />
        </label>
      </div>

      {/* A cull is a decision about the animal, not a way of leaving — she
          can be culled through a barn or a processor alike — so it is a
          question of its own rather than a sixth channel. */}
      <div className="disposition-editor__cull">
        <label className="disposition-editor__check">
          <input
            type="checkbox"
            checked={draft.isCull}
            aria-label="This was a cull"
            onChange={(e) => {
              const on = e.target.checked;
              setDraft((d) => ({
                ...d,
                isCull: on,
                // Reasons belong only on a cull; the database refuses them
                // otherwise, so clearing them here keeps the form honest.
                cullPrimaryReasonId: on ? d.cullPrimaryReasonId : "",
                cullSecondaryReasonId: on ? d.cullSecondaryReasonId : "",
                cullNote: on ? d.cullNote : "",
              }));
            }}
          />
          <span>This was a cull</span>
        </label>

        {draft.isCull && reasonsFailed && (
          <p className="disposition-editor__problem">
            Couldn't load this farm's cull reasons. She can still be recorded as culled without one.
          </p>
        )}

        {draft.isCull && (
          <div className="animal-form__grid">
            <label className="animal-form__field">
              <span className="eyebrow">Why, mainly</span>
              <select
                className="animal-form__input"
                value={draft.cullPrimaryReasonId}
                aria-label="Why, mainly"
                onChange={(e) => set("cullPrimaryReasonId", e.target.value)}
              >
                <option value="">Pick one</option>
                {standIn(draft.cullPrimaryReasonId)}
                {loaded.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">And also</span>
              <select
                className="animal-form__input"
                value={draft.cullSecondaryReasonId}
                aria-label="And also"
                onChange={(e) => set("cullSecondaryReasonId", e.target.value)}
              >
                <option value="">Nothing else</option>
                {standIn(draft.cullSecondaryReasonId)}
                {loaded
                  .filter((r) => r.id !== draft.cullPrimaryReasonId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">In your words</span>
              <input
                className="animal-form__input"
                value={draft.cullNote}
                aria-label="In your words"
                onChange={(e) => set("cullNote", e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {showSale && (
        <div className="disposition-editor__sale">
          <div className="eyebrow disposition-editor__head">What the sale brought</div>

          <div className="animal-form__grid">
            <label className="animal-form__field">
              <span className="eyebrow">Buyer</span>
              <input
                className="animal-form__input"
                value={draft.buyerName}
                aria-label="Buyer"
                onChange={(e) => set("buyerName", e.target.value)}
              />
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">Sold how</span>
              <select
                className="animal-form__input"
                value={draft.saleChannel}
                aria-label="Sold how"
                onChange={(e) => set("saleChannel", e.target.value)}
              >
                {SALE_CHANNELS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">Sale barn</span>
              <input
                className="animal-form__input"
                value={draft.saleBarn}
                aria-label="Sale barn"
                onChange={(e) => set("saleBarn", e.target.value)}
              />
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">Lot</span>
              <input
                className="animal-form__input mono"
                value={draft.lotNumber}
                aria-label="Lot"
                onChange={(e) => set("lotNumber", e.target.value)}
              />
            </label>
          </div>

          <div className="animal-form__grid">
            <label className="animal-form__field">
              <span className="eyebrow">Live weight, lb</span>
              <input
                className="animal-form__input mono"
                inputMode="decimal"
                value={draft.liveWeightLb}
                aria-label="Live weight, lb"
                onChange={(e) => set("liveWeightLb", e.target.value)}
              />
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">Price per cwt, $</span>
              <input
                className="animal-form__input mono"
                inputMode="decimal"
                value={draft.pricePerCwt}
                aria-label="Price per cwt"
                onChange={(e) => set("pricePerCwt", e.target.value)}
              />
            </label>

            <label className="animal-form__field">
              <span className="eyebrow">Gross, $</span>
              <input
                className="animal-form__input mono"
                inputMode="decimal"
                value={draft.gross}
                aria-label="Gross"
                placeholder={
                  grossCents !== null && draft.gross.trim() === "" ? String(grossCents / 100) : ""
                }
                onChange={(e) => set("gross", e.target.value)}
              />
              <span className="disposition-editor__hint">
                Leave it blank and it follows from the weight and the price
              </span>
            </label>
          </div>

          <div className="animal-form__grid">
            {(
              [
                ["commission", "Commission, $"],
                ["hauling", "Hauling, $"],
                ["yardage", "Yardage, $"],
                ["otherDeductions", "Other off the cheque, $"],
              ] as const
            ).map(([key, label]) => (
              <label className="animal-form__field" key={key}>
                <span className="eyebrow">{label}</span>
                <input
                  className="animal-form__input mono"
                  inputMode="decimal"
                  value={draft[key]}
                  aria-label={label}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
          </div>

          {hasSale(draft) && grossCents !== null && (
            <div className="disposition-editor__figures">
              <span className="eyebrow">Gross</span>
              <span className="mono">{formatMoney(grossCents)}</span>
              <span className="eyebrow">She cleared</span>
              <span
                className="serif mono disposition-editor__net"
                style={{ color: (netCents ?? 0) < 0 ? "var(--red)" : "var(--ink)" }}
              >
                {formatMoney(netCents ?? 0)}
              </span>
              {(netCents ?? 0) <= 0 ? (
                <span className="disposition-editor__hint">
                  Nothing left after the deductions, so nothing is booked as income
                </span>
              ) : (
                <span className="disposition-editor__hint">
                  Goes on her record as {draft.isCull ? "cull proceeds" : "a live sale"}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <label className="animal-form__field" style={{ marginTop: 16 }}>
        <span className="eyebrow">Anything else</span>
        <input
          className="animal-form__input"
          value={draft.notes}
          aria-label="Anything else"
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      {error && <p className="disposition-editor__error">{error}</p>}

      <div className="disposition-editor__acts">
        <Button variant="filled" size="sm" disabled={saving || problem !== null} onClick={() => void save()}>
          {saving ? "Saving…" : current ? "Save the change" : "Record it"}
        </Button>
        <button type="button" className="link-button mono" onClick={onCancel}>
          cancel
        </button>

        {/* Only offered once something is on file: this undoes a record, it
            does not put an animal back that never left. */}
        {current &&
          (confirmingUndo ? (
            <span className="disposition-editor__undo">
              <span>Put her back on the farm, and drop what was recorded?</span>
              <button type="button" className="link-button mono" disabled={saving} onClick={() => void undo()}>
                yes, undo it
              </button>
              <button type="button" className="link-button mono" onClick={() => setConfirmingUndo(false)}>
                no
              </button>
            </span>
          ) : (
            <button type="button" className="link-button mono" onClick={() => setConfirmingUndo(true)}>
              she didn't go
            </button>
          ))}

        <span className={problem ? "disposition-editor__problem" : "disposition-editor__hint"}>
          {problem ?? (showSale ? "" : "Nothing is booked as income for this one.")}
        </span>
      </div>
    </div>
  );
}
