import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import Breeds from "./Breeds";
import Ground from "./Ground";

/**
 * Settings: how this farm is set up, as against what happened on it today.
 *
 * **Ground** is the land — pastures, and the paddocks on them. It is here
 * rather than under Grazing because it is the shape of the place: written
 * when a farm is first set up, and changed when a field is rented or a fence
 * moves. Grazing → Paddocks still shows the same units as a board, sorted by
 * which one is ready; that page reads, this one writes.
 *
 * **Breeds** is the vocabulary an animal is described in, and the gestation
 * each breed carries on this farm.
 *
 * Settings sits outside every module on purpose — a rental business has no
 * herd and will still have things to configure — so it is a top-level item
 * rather than a section of one.
 */
export default function Settings() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Settings"} title="Settings" />
      <TabbedSections
        label="Settings"
        sections={[
          { id: "ground", label: "Ground", hint: "Pastures, and the paddocks on them", node: () => <Ground /> },
          { id: "breeds", label: "Breeds", hint: "The breeds an animal can be", node: () => <Breeds /> },
        ]}
      />
    </OpsShell>
  );
}
