import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import Breeds from "./Breeds";

/**
 * Settings: the reference data the rest of the app picks from.
 *
 * Breeds is the first of these and for now the only one. It was in the Herd
 * list, between the animals and the depreciation, which put a table edited
 * twice a year beside the pages worked every morning.
 *
 * It sits outside every module on purpose — a rental business has no herd
 * and will still have things to configure — so it is a top-level item rather
 * than a section of one.
 *
 * `TabbedSections` hides its bar while there is one section, so this reads as
 * a page today and grows a tab strip the moment a second thing moves in.
 */
export default function Settings() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Settings"} title="Settings" />
      <TabbedSections
        label="Settings"
        sections={[
          { id: "breeds", label: "Breeds", hint: "The breeds an animal can be", node: () => <Breeds /> },
        ]}
      />
    </OpsShell>
  );
}
