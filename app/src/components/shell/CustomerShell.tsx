import type { ReactNode } from "react";
import "./customer-shell.css";

const tabs = ["Store", "Pickups", "Account"] as const;

export function CustomerShell({
  children,
  activeTab = "Store",
  headerEyebrow = "Farm store",
}: {
  children: ReactNode;
  activeTab?: (typeof tabs)[number];
  headerEyebrow?: string;
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

        <div className="customer-shell__body">{children}</div>

        <nav className="customer-shell__tabbar">
          {tabs.map((t) => (
            <div key={t} className={`customer-tab ${t === activeTab ? "customer-tab--active" : ""}`}>
              <span className="eyebrow" style={{ letterSpacing: ".06em" }}>
                {t}
              </span>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
