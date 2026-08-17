import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import Milkings from "./Milkings";
import Lactations from "./Lactations";

/**
 * Herd → Milking: what came out of them, and the lactations it belongs to.
 *
 * A milking is an event and a lactation is the arc it sits on — one is the
 * day and the other is the season, and they were two rail items for the same
 * subject.
 */
export default function MilkingPage() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Herd"} title="Milking" />
      <TabbedSections
        label="Milking"
        sections={[
          { id: "milkings", label: "Milkings", hint: "What was taken, and when", node: () => <Milkings /> },
          { id: "lactations", label: "Lactations", hint: "The arc each cow is on", node: () => <Lactations /> },
        ]}
      />
    </OpsShell>
  );
}
