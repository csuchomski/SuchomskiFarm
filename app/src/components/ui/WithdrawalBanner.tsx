import type { ReactNode } from "react";
import "./withdrawal-banner.css";

/**
 * The one high-chroma element in the system — hazard yellow, reserved
 * strictly for an active withdrawal. Two shapes: `full` bleeds edge to
 * edge at the top of an animal record; `boxed` sits inside a panel like
 * the dashboard's "Needs you" list.
 */
export function WithdrawalBanner({
  eyebrow,
  title,
  facts,
  variant = "boxed",
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  facts?: ReactNode[];
  variant?: "full" | "boxed";
}) {
  return (
    <div className={`withdrawal-banner withdrawal-banner--${variant}`}>
      <div className="eyebrow withdrawal-banner__eyebrow">{eyebrow}</div>
      <div className="serif withdrawal-banner__title">{title}</div>
      {facts && (
        <div className="withdrawal-banner__facts">
          {facts.map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}
