import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import SellBuy from "./SellBuy";
import MarketClasses from "./MarketClasses";

/**
 * Herd → Market.
 *
 * Two ways of asking one question. **Sell / buy** works one class at a time:
 * given a slide and an animal, how far is it worth growing them, and does
 * trading down the ladder beat keeping them. **Classes** is the comparison
 * that page cannot make, because Bud Williams' argument is about the
 * relationship *between* classes — which is a different drawing, not a
 * different subject, so it is a tab on it.
 */
export default function MarketPage() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business ? `${business.name} · market` : "Market"} title="Market" />
      <TabbedSections
        label="Market"
        sections={[
          {
            id: "sell-buy",
            label: "Sell / buy",
            hint: "When gain stops paying, and whether to trade down the ladder",
            node: () => <SellBuy />,
          },
          {
            id: "classes",
            label: "Classes",
            hint: "One class of cattle against another, over time",
            node: () => <MarketClasses />,
          },
        ]}
      />
    </OpsShell>
  );
}
