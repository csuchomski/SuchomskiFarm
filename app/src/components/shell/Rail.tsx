import { NavLink } from "react-router-dom";
import { groupsForModules, topLevel, type NavItem } from "./nav";
import { useWorkspace } from "../../lib/workspace";
import "./rail.css";

function RailRow({ item }: { item: NavItem }) {
  if (!item.to) {
    return (
      <div className="rail-row rail-row--inert" title="Not built yet">
        <span>{item.label}</span>
      </div>
    );
  }
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) => `rail-row ${isActive ? "rail-row--active" : ""}`}
    >
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Rail() {
  const { modules, loading } = useWorkspace();
  const groups = groupsForModules(modules);

  return (
    <aside className="rail">
      <RailRow item={topLevel} />

      {loading && (
        <div className="eyebrow rail__heading" style={{ color: "var(--ink-faint)" }}>
          Loading…
        </div>
      )}

      {groups.map((group) => (
        <div key={group.heading}>
          <div className="eyebrow rail__heading">{group.heading}</div>
          {group.items.map((item) => (
            <RailRow key={item.label} item={item} />
          ))}
        </div>
      ))}

      <div className="rail__spacer" />
      <NavLink to="/shop" className="rail__footer-link">
        Farm store ↗
      </NavLink>
    </aside>
  );
}
