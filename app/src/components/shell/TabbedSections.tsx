import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import "./tabbed-sections.css";

/**
 * Several pages under one heading.
 *
 * Folding pages together is how this app got from twenty-odd rail items to a
 * handful, and the shape is always the same: a strip of tabs, the open one
 * mounted and the rest not, and the choice carried in the address so a link
 * can point at one. This is that shape, once, rather than in every page that
 * wants it.
 *
 * **Only the open tab is rendered**, which is why `node` is a thunk. Passing
 * the elements directly would construct all of them on every render, and the
 * folded pages each fetch on mount — opening Animals would go and get the
 * genetics as well.
 *
 * The tab bar disappears when there is only one section. A page that will
 * grow more later should not look unfinished today.
 */

export interface Section {
  id: string;
  label: string;
  /** A line under the bar saying what this tab is for. */
  hint: string;
  node: () => ReactNode;
}

export function TabbedSections({ sections, label }: { sections: Section[]; label: string }) {
  const [params, setParams] = useSearchParams();

  const raw = params.get("tab");
  const current = sections.find((s) => s.id === raw) ?? sections[0];

  // Replace rather than push: moving between tabs is looking around one page,
  // and it should not take four presses of Back to leave it.
  const open = (id: string) =>
    setParams(id === sections[0].id ? {} : { tab: id }, { replace: true });

  return (
    <>
      {sections.length > 1 && (
        <div className="gr-tabs" role="tablist" aria-label={label}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current.id}
              className={`gr-tab ${s.id === current.id ? "gr-tab--on" : ""}`}
              onClick={() => open(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="gr-hint">{current.hint}</p>

      <div className="gr-panel" role="tabpanel">
        {current.node()}
      </div>
    </>
  );
}
