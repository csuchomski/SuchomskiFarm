import { NavLink } from "react-router-dom";
import { navGroups, topLevel, type NavItem } from "./nav";
import "./rail.css";

function RailRow({ item }: { item: NavItem }) {
  const inner = (
    <>
      <span>{item.label}</span>
      {item.count !== undefined && (
        <span className={`mono rail-row__count rail-row__count--${item.countColor ?? "muted"}`}>{item.count}</span>
      )}
      {item.dot && <span className={`rail-row__dot rail-row__dot--${item.dot}`} />}
    </>
  );

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        end={item.to === "/"}
        className={({ isActive }) => `rail-row ${isActive ? "rail-row--active" : ""}`}
      >
        {inner}
      </NavLink>
    );
  }

  return <div className="rail-row rail-row--inert">{inner}</div>;
}

export function Rail() {
  return (
    <aside className="rail">
      <RailRow item={topLevel} />
      {navGroups.map((group) => (
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
