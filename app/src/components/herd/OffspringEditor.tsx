import { useState } from "react";
import { Button } from "../ui";
import { setParent, type RealAnimal } from "../../lib/herd";

/**
 * Recording a calf from the parent's record. The alternative is opening the
 * calf and setting its dam, which is backwards from how you'd think about
 * it standing in the barn.
 */
export function OffspringEditor({
  parent,
  herd,
  onChanged,
  onClose,
}: {
  parent: RealAnimal;
  herd: RealAnimal[];
  onChanged: (child: RealAnimal) => void;
  onClose: () => void;
}) {
  const role: "dam" | "sire" = parent.sex === "male" ? "sire" : "dam";
  const [childId, setChildId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An animal can't be its own parent, can't be its own ancestor, and
  // shouldn't be offered if it already has this parent recorded.
  const alreadyLinked = (a: RealAnimal) => (role === "dam" ? a.dam_id : a.sire_id) === parent.id;
  const candidates = herd
    .filter((a) => a.id !== parent.id && !alreadyLinked(a) && !isAncestorOf(parent, a, herd))
    .sort((a, b) => b.birth_date.localeCompare(a.birth_date));

  const link = async () => {
    if (!childId) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await setParent(childId, role, parent.id));
      setChildId("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="offspring-editor">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Record an existing animal as {role === "dam" ? "out of" : "by"} {parent.barn_name || `tag ${parent.ear_tag}`}
      </div>

      {candidates.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
          Nothing eligible — every other animal is already linked, or is an ancestor of this one.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="animal-form__input"
            style={{ flex: 1, minWidth: 200 }}
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
            aria-label="Animal to link"
          >
            <option value="">Choose an animal…</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.barn_name || `Tag ${a.ear_tag}`} · {a.class} · born {a.birth_date}
              </option>
            ))}
          </select>
          <Button variant="filled" onClick={() => void link()} disabled={!childId || busy}>
            {busy ? "Linking…" : "Link"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      )}

      {error && (
        <p className="mono" style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Would making `candidate` a child of `parent` create a loop? Walks up the
 * parent's own ancestry looking for the candidate. Without this you can set
 * a cow as her own grandmother, and the pedigree chart then recurses until
 * it hits its generation cap — wrong data that renders as plausible.
 */
export function isAncestorOf(parent: RealAnimal, candidate: RealAnimal, herd: RealAnimal[]): boolean {
  const byId = new Map(herd.map((a) => [a.id, a]));
  const seen = new Set<string>();
  let frontier = [parent];

  while (frontier.length > 0) {
    const next: RealAnimal[] = [];
    for (const node of frontier) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (node.id === candidate.id) return true;
      for (const id of [node.dam_id, node.sire_id]) {
        const found = id ? byId.get(id) : null;
        if (found) next.push(found);
      }
    }
    frontier = next;
  }
  return false;
}
