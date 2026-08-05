import type { ReactNode } from "react";
import "./callout.css";

export function Callout({
  children,
  tone = "herd",
}: {
  children: ReactNode;
  tone?: "herd" | "dashed";
}) {
  return <div className={`callout callout--${tone}`}>{children}</div>;
}
