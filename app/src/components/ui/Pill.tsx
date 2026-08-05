import type { ReactNode } from "react";
import "./pill.css";

export function Pill({
  children,
  variant = "outline",
}: {
  children: ReactNode;
  variant?: "outline" | "outline-green" | "withdrawal" | "neutral";
}) {
  return <span className={`pill pill--${variant}`}>{children}</span>;
}
