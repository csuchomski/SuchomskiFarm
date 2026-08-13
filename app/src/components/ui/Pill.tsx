import type { ReactNode } from "react";
import "./pill.css";

export function Pill({
  children,
  variant = "outline",
}: {
  children: ReactNode;
  variant?: "outline" | "outline-green" | "outline-ochre" | "withdrawal" | "neutral";
}) {
  return <span className={`pill pill--${variant}`}>{children}</span>;
}
