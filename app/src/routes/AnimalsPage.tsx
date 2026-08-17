import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import Animals from "./Animals";
import Genetics from "./Genetics";

/**
 * Herd → Animals: the herd, and what it is made of.
 *
 * Genetics was its own rail item listing traits and evaluations for the same
 * animals the list above it already held. It is a way of looking at the herd
 * rather than a different subject, so it is a tab on it.
 */
export default function AnimalsPage() {
  const { business } = useWorkspace();

  return (
    <OpsShell searchPlaceholder="An animal by tag or name…">
      <PageHeader eyebrow={business?.name ?? "Herd"} title="Animals" />
      <TabbedSections
        label="Animals"
        sections={[
          { id: "animals", label: "Animals", hint: "Every head on the farm", node: () => <Animals /> },
          { id: "genetics", label: "Genetics", hint: "Traits and evaluations", node: () => <Genetics /> },
        ]}
      />
    </OpsShell>
  );
}
