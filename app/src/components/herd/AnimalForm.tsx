import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui";
import {
  addAttributeOption,
  createAnimal,
  fetchAttributeOptions,
  updateAnimal,
  type AnimalEdit,
  type AttributeOption,
  type AttributeOptions,
  type RealAnimal,
} from "../../lib/herd";
import "./animal-edit-form.css";

/**
 * Last-resort fallback for before migration 013 creates
 * herd.attribute_options. Once that table exists these lists are unused —
 * vocabularies belong in the database, where adding a class doesn't need a
 * deploy.
 */
const FALLBACK = {
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
  prefill,
  lockedParent,
  onSaved,
  onCancel,
}: {
  /** Omit to create a new animal. */
  animal?: RealAnimal;
  herd: RealAnimal[];
  farmId: string | null;
  /** Starting values when creating — e.g. a calf opened from its dam. */
  prefill?: Partial<AnimalEdit>;
  /** Which parent was fixed by where the form was opened from. Shown as
   * read-only rather than a picker, since changing it here would silently
   * detach the calf from the animal you started on. */
  lockedParent?: "dam" | "sire";
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
        // already uses, so a new animal matches its neighbours. A calf
        // opened from a parent is born here by definition.
        {
          ...BLANK,
          purpose: commonest(herd, "purpose"),
          origin: commonest(herd, "origin") || "born_here",
          ...prefill,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof AnimalEdit>(key: K, value: AnimalEdit[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Vocabularies come from herd.attribute_options. Until that exists, fall
  // back to what the herd already uses merged with a built-in list, so the
  // form works either side of migration 013.
  const [dbOptions, setDbOptions] = useState<AttributeOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A failure here isn't worth blocking the form for — the fallback
    // options are still usable.
    fetchAttributeOptions()
      .then((o) => !cancelled && setDbOptions(o))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const fromHerd = (key: keyof typeof FALLBACK, pick: (a: RealAnimal) => string) =>
      merge(FALLBACK[key], herd.map(pick)).map((code) => ({ code, label: code }));

    const forAttr = (key: keyof typeof FALLBACK, pick: (a: RealAnimal) => string): AttributeOption[] => {
      const fromDb = dbOptions?.[key];
      if (!fromDb || fromDb.length === 0) return fromHerd(key, pick);
      // A value already on this animal that has since been retired would
      // otherwise vanish from its own form.
      const current = (pick(animal ?? ({} as RealAnimal)) ?? "").trim();
      return current && !fromDb.some((o) => o.code === current)
        ? [...fromDb, { code: current, label: `${current} (not in list)` }]
        : fromDb;
    };

    return {
      sex: forAttr("sex", (a) => a.sex),
      class: forAttr("class", (a) => a.class),
      status: forAttr("status", (a) => a.status),
      purpose: forAttr("purpose", (a) => a.purpose),
      origin: forAttr("origin", (a) => a.origin),
    };
  }, [herd, dbOptions, animal]);

  const canAddOptions = Boolean(dbOptions && farmId);

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

        {(["sex", "class", "purpose", "origin", "status"] as const).map((attr) => (
          <ListField
            key={attr}
            label={LABELS[attr]}
            attribute={attr}
            required
            value={form[attr]}
            onChange={(v) => set(attr, v)}
            options={options[attr]}
            farmId={canAddOptions ? farmId : null}
            onOptionAdded={(added) =>
              setDbOptions((prev) => (prev ? { ...prev, [attr]: [...(prev[attr] ?? []), added] } : prev))
            }
          />
        ))}

        <Field label="Born" required>
          <input
            className="animal-form__input mono"
            type="date"
            value={form.birth_date}
            onChange={(e) => set("birth_date", e.target.value)}
            required
          />
        </Field>

        {lockedParent === "dam" ? (
          <LockedParent label="Dam" herd={herd} id={form.dam_id} />
        ) : (
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
        )}

        {lockedParent === "sire" ? (
          <LockedParent label="Sire" herd={herd} id={form.sire_id} />
        ) : (
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
        )}
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

const LABELS: Record<string, string> = {
  sex: "Sex",
  class: "Class",
  purpose: "Purpose",
  origin: "Origin",
  status: "Status",
};

/**
 * A picker over the vocabulary in the database, with an inline way to add to
 * it — so a class nobody anticipated is one form away rather than a deploy.
 * `farmId` null means the options table doesn't exist yet, in which case
 * adding is hidden rather than offered and then failing.
 */
function ListField({
  label,
  attribute,
  value,
  onChange,
  options,
  required,
  farmId,
  onOptionAdded,
}: {
  label: string;
  attribute: string;
  value: string;
  onChange: (v: string) => void;
  options: AttributeOption[];
  required?: boolean;
  farmId: string | null;
  onOptionAdded: (added: AttributeOption) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const label = draft.trim();
    if (!label || !farmId) return;
    const code = label.toLowerCase().replace(/\s+/g, "_");
    setBusy(true);
    setError(null);
    try {
      const added = await addAttributeOption(farmId, attribute, code, label);
      onOptionAdded(added);
      onChange(added.code);
      setDraft("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} required={required}>
      <select
        className="animal-form__input"
        value={value}
        onChange={(e) => (e.target.value === ADD_SENTINEL ? setAdding(true) : onChange(e.target.value))}
        required={required}
      >
        {value === "" && <option value="">Choose…</option>}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
        {farmId && <option value={ADD_SENTINEL}>+ Add {label.toLowerCase()}…</option>}
      </select>

      {adding && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            className="animal-form__input"
            autoFocus
            placeholder={`New ${label.toLowerCase()}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <Button type="button" size="sm" onClick={() => void save()} disabled={!draft.trim() || busy}>
            {busy ? "…" : "Add"}
          </Button>
        </div>
      )}
      {error && (
        <span className="mono" style={{ fontSize: 12, color: "var(--red)" }}>
          {error}
        </span>
      )}
    </Field>
  );
}

const ADD_SENTINEL = "__add__";

/** The parent this form was opened from: shown, not editable. */
function LockedParent({ label, herd, id }: { label: string; herd: RealAnimal[]; id: string | null }) {
  const parent = herd.find((a) => a.id === id);
  return (
    <Field label={label}>
      <div className="animal-form__locked">
        <span>{parent ? parent.barn_name || `Tag ${parent.ear_tag}` : "—"}</span>
        <span className="eyebrow">Fixed</span>
      </div>
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
