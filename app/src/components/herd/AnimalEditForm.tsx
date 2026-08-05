import { useState } from "react";
import { Button } from "../ui";
import { updateAnimal, type AnimalEdit, type RealAnimal } from "../../lib/herd";
import "./animal-edit-form.css";

/**
 * Values seen in the live data. Offered as a datalist rather than a select,
 * so an unrecognised value already on a record stays editable instead of
 * being silently replaced by whichever option happened to be first.
 */
const CLASSES = ["calf", "heifer", "cow", "bull", "steer"];
const SEXES = ["female", "male"];
const STATUSES = ["active", "sold", "dead", "culled"];

export function AnimalEditForm({
  animal,
  herd,
  onSaved,
  onCancel,
}: {
  animal: RealAnimal;
  herd: RealAnimal[];
  onSaved: (updated: RealAnimal) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AnimalEdit>({
    barn_name: animal.barn_name ?? "",
    ear_tag: animal.ear_tag,
    sex: animal.sex,
    class: animal.class,
    status: animal.status,
    birth_date: animal.birth_date,
    notes: animal.notes ?? "",
    dam_id: animal.dam_id,
    sire_id: animal.sire_id,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AnimalEdit>(key: K, value: AnimalEdit[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // An animal can't be its own parent, and the herd is small enough to list.
  const candidates = herd.filter((a) => a.id !== animal.id);
  const dams = candidates.filter((a) => a.sex !== "male");
  const sires = candidates.filter((a) => a.sex !== "female");

  const canSave = form.ear_tag.trim() !== "" && form.birth_date !== "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAnimal(animal.id, {
        ...form,
        barn_name: form.barn_name.trim(),
        ear_tag: form.ear_tag.trim(),
        notes: form.notes.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="animal-form" onSubmit={submit}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Editing {animal.barn_name ?? `tag ${animal.ear_tag}`}
      </div>

      <div className="animal-form__grid">
        <Field label="Name">
          <input
            className="animal-form__input"
            value={form.barn_name}
            onChange={(e) => set("barn_name", e.target.value)}
            placeholder="Barn name"
          />
        </Field>

        <Field label="Ear tag" required>
          <input
            className="animal-form__input mono"
            value={form.ear_tag}
            onChange={(e) => set("ear_tag", e.target.value)}
            required
          />
        </Field>

        <Field label="Sex">
          <input className="animal-form__input" list="sexes" value={form.sex} onChange={(e) => set("sex", e.target.value)} />
          <datalist id="sexes">
            {SEXES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Class">
          <input
            className="animal-form__input"
            list="classes"
            value={form.class}
            onChange={(e) => set("class", e.target.value)}
          />
          <datalist id="classes">
            {CLASSES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field label="Status">
          <input
            className="animal-form__input"
            list="statuses"
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          />
          <datalist id="statuses">
            {STATUSES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Born" required>
          <input
            className="animal-form__input mono"
            type="date"
            value={form.birth_date}
            onChange={(e) => set("birth_date", e.target.value)}
            required
          />
        </Field>

        <Field label="Dam">
          <select
            className="animal-form__input"
            value={form.dam_id ?? ""}
            onChange={(e) => set("dam_id", e.target.value || null)}
          >
            <option value="">Not recorded</option>
            {dams.map((a) => (
              <option key={a.id} value={a.id}>
                {a.barn_name ?? `Tag ${a.ear_tag}`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sire">
          <select
            className="animal-form__input"
            value={form.sire_id ?? ""}
            onChange={(e) => set("sire_id", e.target.value || null)}
          >
            <option value="">Not recorded</option>
            {sires.map((a) => (
              <option key={a.id} value={a.id}>
                {a.barn_name ?? `Tag ${a.ear_tag}`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label="Notes">
          <textarea
            className="animal-form__input animal-form__textarea"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
          />
        </Field>
      </div>

      {error && (
        <p className="mono" style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }} role="alert">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button variant="filled" type="submit" disabled={!canSave || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
        Only these fields are written. Tattoos, registry numbers, genotypes and the rest of the record are left
        untouched.
      </p>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="animal-form__field">
      <span className="eyebrow">
        {label}
        {required && <span style={{ color: "var(--red)" }}> *</span>}
      </span>
      {children}
    </label>
  );
}
