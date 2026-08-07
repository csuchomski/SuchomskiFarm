import type { ReactNode } from "react";
import "./customer-shell.css";

/**
 * The shop's frame: a phone-width column with the three tabs under the
 * header.
 *
 * The tabs used to sit at the bottom and were inert `div`s — three labels
 * that looked like navigation and did nothing, with `activeTab` a prop
 * nobody ever changed. They're buttons now, at the top, and the page
 * switches on them.
 */

export const CUSTOMER_TABS = ["Store", "Pickup", "Account"] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

export function CustomerShell({
  children,
  activeTab,
  onTabChange,
  headerEyebrow = "Farm store",
  /** Per-tab counts, shown beside the label. Omitted keys show nothing —
   * a zero is not worth the ink. */
  counts,
}: {
  children: ReactNode;
  activeTab?: CustomerTab;
  onTabChange?: (tab: CustomerTab) => void;
  headerEyebrow?: string;
  counts?: Partial<Record<CustomerTab, number>>;
}) {
  return (
    <div className="customer-shell-page">
      <div className="customer-shell">
        <header className="customer-shell__header">
          <div className="serif" style={{ fontSize: 22, letterSpacing: "-.02em" }}>
            Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
          </div>
          <div className="eyebrow">{headerEyebrow}</div>
        </header>

        {/* Only rendered when the page is actually driving them. The
            sign-in screen uses this shell too and has nothing to switch. */}
        {activeTab && onTabChange && (
          <nav className="customer-shell__tabbar" aria-label="Shop sections">
            {CUSTOMER_TABS.map((t) => {
              const count = counts?.[t];
              return (
                <button
                  key={t}
                  type="button"
                  className={`customer-tab ${t === activeTab ? "customer-tab--active" : ""}`}
                  aria-current={t === activeTab ? "page" : undefined}
                  onClick={() => onTabChange(t)}
                >
                  <span className="eyebrow" style={{ letterSpacing: ".06em" }}>
                    {t}
                  </span>
                  {count !== undefined && count > 0 && <span className="customer-tab__count mono">{count}</span>}
                </button>
              );
            })}
          </nav>
        )}

        <div className="customer-shell__body">{children}</div>
      </div>
    </div>
  );
}
