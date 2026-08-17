import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import Sires from "./Sires";
import Breedings from "./Breedings";
import Calvings from "./Calvings";

/**
 * Herd → Breeding: the bull, the service, and what arrived.
 *
 * One chain across three pages — you pick a sire, you record the breeding,
 * and months later you record the calving — so following it meant three rail
 * items. The tabs are in that order.
 */
export default function BreedingPage() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Herd"} title="Breeding" />
      <TabbedSections
        label="Breeding"
        sections={[
          { id: "sires", label: "Sires", hint: "The bulls and the straws", node: () => <Sires /> },
          { id: "breedings", label: "Breedings", hint: "Services and what came of them", node: () => <Breedings /> },
          { id: "calvings", label: "Calvings", hint: "What arrived, and how it went", node: () => <Calvings /> },
        ]}
      />
    </OpsShell>
  );
}
