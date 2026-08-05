import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import "./ops-shell.css";

export function OpsShell({
  children,
  searchPlaceholder,
}: {
  children: ReactNode;
  searchPlaceholder?: string;
}) {
  return (
    <div className="ops-shell">
      <TopBar searchPlaceholder={searchPlaceholder} />
      <div className="ops-shell__body">
        <Rail />
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
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <div className="serif page-header__title">{title}</div>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
