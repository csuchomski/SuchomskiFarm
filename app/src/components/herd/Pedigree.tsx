import { Link } from "react-router-dom";
import { EarTag } from "../ui";
import { animalPath, buildPedigree, describeBreeding, type BreedShare, type RealAnimal } from "../../lib/herd";
import "./pedigree.css";

const GENERATION_LABELS = ["Parents", "Grandparents", "Great-grandparents"];

/**
 * Generational chart rather than two boxes: columns per generation, each
 * with twice the rows of the one before. Slots stay in place where ancestry
 * is unknown, because a chart with holes still has to line up — a missing
 * grandsire should read as a gap in a known position, not shift everything
 * below it.
 */
export function Pedigree({
  animal,
  herd,
  breeds,
  generations = 3,
}: {
  animal: RealAnimal;
  herd: RealAnimal[];
  /** Breed shares by animal id, for the label under each ancestor. */
  breeds?: Map<string, BreedShare[]>;
  generations?: number;
}) {
  const levels = buildPedigree(animal, herd, generations);
  const known = levels.flat().filter((n) => n.animal).length;

  if (known === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
        No ancestry recorded. Set a dam or sire with Edit, and their own parents will appear here.
      </p>
    );
  }

  return (
    <div className="pedigree" style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(150px, 1fr))` }}>
      {levels.map((nodes, gen) => (
        <div className="ped-col" key={gen}>
          <div className="eyebrow ped-col__head">{GENERATION_LABELS[gen] ?? `Generation ${gen + 1}`}</div>
          {nodes.map((node, i) => (
            <PedigreeCell key={`${gen}-${i}`} node={node} breeds={breeds} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PedigreeCell({
  node,
  breeds,
}: {
  node: ReturnType<typeof buildPedigree>[number][number];
  breeds?: Map<string, BreedShare[]>;
}) {
  const roleLabel = node.role === "dam" ? "Dam" : "Sire";

  if (!node.animal) {
    return (
      <div className={`ped-cell ${node.offHerd ? "" : "ped-cell--unknown"}`}>
        <div className="eyebrow ped-cell__role">{roleLabel}</div>
        <div className="serif ped-cell__name ped-cell__name--empty">
          {node.offHerd ? "Outside the herd" : "Not recorded"}
        </div>
        {node.offHerd && <div className="mono ped-cell__meta">id on file, no record</div>}
      </div>
    );
  }

  const breeding = breeds ? describeBreeding(breeds.get(node.animal.id)) : null;

  return (
    <Link to={animalPath(node.animal)} className="ped-cell ped-cell--link">
      <div className="eyebrow ped-cell__role">{roleLabel}</div>
      <div className="ped-cell__body">
        <EarTag tag={node.animal.ear_tag} accent="herd" size="sm" />
        <span className="serif ped-cell__name">{node.animal.barn_name || `Tag ${node.animal.ear_tag}`}</span>
      </div>
      {breeding && <div className="ped-cell__meta">{breeding}</div>}
    </Link>
  );
}
