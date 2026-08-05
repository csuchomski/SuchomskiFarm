import { useMemo, useState } from "react";
import { Button } from "../ui";
import { createAnimal, updateAnimal, type AnimalEdit, type RealAnimal } from "../../lib/herd";
import "./animal-edit-form.css";

/**
 * Suggestions only, and merged with whatever the herd already uses — so a
 * value someone entered that isn't in this list still shows up as an option
 * rather than looking like a mistake. Offered as datalists rather than
 * selects for the same reason: an unrecognised value on an existing record
 * stays editable instead of being replaced by whichever option came first.
 */
const SUGGESTED = {
  sex: ["female", "male"],
  class: ["calf", "heifer", "cow", "bull", "steer"],
  status: ["active", "sold", "dead", "culled"],
  purpose: ["dairy", "beef", "dual"],
  origin: ["born_here", "purchased"],
};

const BLANK: AnimalEdit = {
  barn_name: "",
  ear_tag: "",
  sex: "female",
  class: "calf",
  status: "active",
  birth_date: new Date().toISOString().slice(0, 10),
  notes: "",
  dam_id: null,
  sire_id: null,
  purpose: "",
  origin: "",
};

export function AnimalForm({
  animal,
  herd,
  farmId,
  onSaved,
  onCancel,
}: {
  /** Omit to create a new animal. */
  animal?: RealAnimal;
  herd: RealAnimal[];
  farmId: string | null;
  onSaved: (saved: RealAnimal, wasCreated: boolean) => void;
  onCancel: () => void;
}) {
  const creating = !animal;

  const [form, setForm] = useState<AnimalEdit>(() =>
    animal
      ? {
          barn_name: animal.barn_name ?? "",
          ear_tag: animal.ear_tag,
          sex: animal.sex,
          class: animal.class,
          status: animal.status,
          birth_date: animal.birth_date,
          notes: animal.notes ?? "",
          dam_id: animal.dam_id,
          sire_id: animal.sire_id,
          purpose: animal.purpose ?? "",
          origin: animal.origin ?? "",
        }
      : // Default the required-but-unguessable fields to what the herd
        // already uses, so a new animal matches its neighbours.
        { ...BLANK, purpose: commonest(herd, "purpose"), origin: commonest(herd, "origin") },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AnimalEdit>(key: K, value: AnimalEdit[K]) => setForm((f) => ({ ...f, [key]: value }));

  const options = useMemo(
    () => ({
      sex: merge(SUGGESTED.sex, herd.map((a) => a.sex)),
      class: merge(SUGGESTED.class, herd.map((a) => a.class)),
      status: merge(SUGGESTED.status, herd.map((a) => a.status)),
      purpose: merge(SUGGESTED.purpose, herd.map((a) => a.purpose)),
      origin: merge(SUGGESTED.origin, herd.map((a) => a.origin)),
    }),
    [herd],
  );

  const candidates = herd.filter((a) => a.id !== animal?.id);
  const dams = candidates.filter((a) => a.sex !== "male");
  const sires = candidates.filter((a) => a.sex !== "female");

  const tagTaken =
    form.ear_tag.trim() !== "" &&
    herd.some((a) => a.id !== animal?.id && a.ear_tag.trim() === form.ear_tag.trim());

  const missingFarm = creating && !farmId;
  const canSave =
    form.ear_tag.trim() !== "" &&
    form.birth_date !== "" &&
    form.sex.trim() !== "" &&
    form.class.trim() !== "" &&
    form.purpose.trim() !== "" &&
    form.origin.trim() !== "" &&
    !tagTaken &&
    !missingFarm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const patch: AnimalEdit = {
      ...form,
      barn_name: form.barn_name.trim(),
      ear_tag: form.ear_tag.trim(),
      notes: form.notes.trim(),
      purpose: form.purpose.trim(),
      origin: form.origin.trim(),
    };
    try {
      const saved = animal ? await updateAnimal(animal.id, patch) : await createAnimal(farmId!, patch);
      onSaved(saved, creating);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="animal-form" onSubmit={submit}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {creating ? "New animal" : `Editing ${animal.barn_name || `tag ${animal.ear_tag}`}`}
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
          {tagTaken && (
            <span style={{ fontSize: 13, color: "var(--red)" }}>Tag {form.ear_tag.trim()} is already in use.</span>
          )}
        </Field>

        <ListField label="Sex" required value={form.sex} onChange={(v) => set("sex", v)} options={options.sex} />
        <ListField label="Class" required value={form.class} onChange={(v) => set("class", v)} options={options.class} />
        <ListField
          label="Purpose"
          required
          value={form.purpose}
          onChange={(v) => set("purpose", v)}
          options={options.purpose}
        />
        <ListField
          label="Origin"
          required
          value={form.origin}
          onChange={(v) => set("origin", v)}
          options={options.origin}
        />
        <ListField
          label="Status"
          required
          value={form.status}
          onChange={(v) => set("status", v)}
          options={options.status}
        />

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
                {a.barn_name || `Tag ${a.ear_tag}`}
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
                {a.barn_name || `Tag ${a.ear_tag}`}
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

      {missingFarm && (
        <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>
          No farm resolved for this business, so there's nothing to attach the animal to.
        </p>
      )}

      {error && (
        <p className="mono" style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }} role="alert">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button variant="filled" type="submit" disabled={!canSave || saving}>
          {saving ? "Saving…" : creating ? "Add animal" : "Save changes"}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
        {creating
          ? "Tag colour, tattoo, registry number and the rest take their database defaults — fill them in elsewhere if you need them."
          : "Only these fields are written. Tattoos, registry numbers, genotypes and the rest of the record are left untouched."}
      </p>
    </form>
  );
}

/** Most-used value in the herd, so a new animal defaults to whatever is
 * normal here rather than to a guess. */
export function commonest(herd: RealAnimal[], key: "purpose" | "origin"): string {
  const counts = new Map<string, number>();
  for (const a of herd) {
    const v = (a[key] ?? "").trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
}

export function merge(suggested: string[], actual: string[]): string[] {
  return [...new Set([...suggested, ...actual.map((v) => (v ?? "").trim()).filter(Boolean)])];
}

function ListField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  const id = `list-${label.toLowerCase()}`;
  return (
    <Field label={label} required={required}>
      <input
        className="animal-form__input"
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </Field>
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
