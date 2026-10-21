import { NavLink } from "react-router-dom";
import { alerts, groupsForModules, settings, topLevel, type NavItem } from "./nav";
import { useWorkspace } from "../../lib/workspace";
import { useStoreAlertCount } from "../../lib/store-alerts";
import "./rail.css";

function RailRow({ item, count }: { item: NavItem; count?: { n: number; label: string } }) {
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
      {count && count.n > 0 && (
        <span className="mono rail-row__badge" aria-label={count.label}>
          {count.n}
        </span>
      )}
    </NavLink>
  );
}

export function Rail() {
  const { modules, loading, business, role } = useWorkspace();
  const groups = groupsForModules(modules);
  // What customers did in the store, waiting beside Alerts — the owner's
  // only, as the store is (071).
  const storeNews = useStoreAlertCount(business?.id ?? null, role === "owner" && modules.includes("store"));

  return (
    <aside className="rail">
      <RailRow item={topLevel} />
      {/* Beside Today rather than inside Herd: both answer "what does today
          need", which is a different question from what a subject holds. */}
      <RailRow
        item={alerts}
        count={storeNews ? { n: storeNews, label: `${storeNews} new from the farm store` } : undefined}
      />

      {loading && (
        <div className="eyebrow rail__heading" style={{ color: "var(--ink-faint)" }}>
          Loading…
        </div>
      )}

      {groups.map((group) => (
        <div key={group.heading}>
          <div className="eyebrow rail__heading rail__section">{group.heading}</div>
          {group.items.map((item) => (
            <RailRow key={item.label} item={item} />
          ))}
        </div>
      ))}

      <div className="rail__spacer" />
      {/* After the sections and before the shop link — configuration is not
          a subject you work in, so it does not belong among them. */}
      <div className="rail__detached">
        <RailRow item={settings} />
      </div>
      <NavLink to="/shop" className="rail__footer-link">
        Farm store ↗
      </NavLink>
    </aside>
  );
}
