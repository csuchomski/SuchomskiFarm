import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
 *
 * **A nested shell renders its children and nothing else.** Several pages were
 * folded into others — the forage balance into the plan, monitoring and
 * decisions into the record — and each was a whole page with its own shell.
 * Rather than restructure four components so their bodies could be lifted out,
 * the shell notices it is already inside one and steps aside. A page stays a
 * page; it just does not get a second rail and topbar when it is a section.
 */
const ShellDepth = createContext(0);
export function OpsShell({
  children,
  searchPlaceholder,
}: {
  children: ReactNode;
  searchPlaceholder?: string;
}) {
  const depth = useContext(ShellDepth);
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

  // Hooks above run either way, so this cannot change their order.
  if (depth > 0) return <ShellDepth value={depth + 1}>{children}</ShellDepth>;

  return (
    <ShellDepth value={1}>
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
    </ShellDepth>
  );
}

/**
 * A page's title — or, inside a page it has been folded into, that section's
 * heading. The eyebrow is dropped there: it names the business, which the
 * page above has already said once.
 */
export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  // Depth 1 is the page's own header. Deeper means this page has been folded
  // into another one, and its title is that page's section heading.
  const depth = useContext(ShellDepth);

  if (depth > 1) {
    return (
      <div className="section__head page-header--section">
        <h2 className="serif page-header__section-title">{title}</h2>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    );
  }

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
