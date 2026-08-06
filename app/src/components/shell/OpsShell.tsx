import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import "./ops-shell.css";

/**
 * The signed-in layout: topbar, nav rail, content.
 *
 * Below --bp-nav the rail can't sit beside the content — 208px of a 375px
 * screen is most of it — so it becomes an off-canvas drawer opened from the
 * topbar. The markup is the same at both sizes; only the CSS moves it, so
 * there's one nav to maintain rather than a desktop one and a mobile one
 * that drift apart.
 */
export function OpsShell({
  children,
  searchPlaceholder,
}: {
  children: ReactNode;
  searchPlaceholder?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Following a link inside the drawer must close it, or the new page is
  // rendered underneath a nav that's still covering it.
  useEffect(() => setNavOpen(false), [pathname]);

  // A drawer you can't dismiss with the key everyone reaches for is a trap.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className={`ops-shell ${navOpen ? "ops-shell--nav-open" : ""}`}>
      <TopBar searchPlaceholder={searchPlaceholder} navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} />
      <div className="ops-shell__body">
        <Rail />
        {/* Only rendered while open, so it can't swallow taps on desktop. */}
        {navOpen && (
          <button className="ops-shell__scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />
        )}
        <main className="ops-shell__main">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header__titles">
        <div className="eyebrow">{eyebrow}</div>
        <div className="serif page-header__title">{title}</div>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
