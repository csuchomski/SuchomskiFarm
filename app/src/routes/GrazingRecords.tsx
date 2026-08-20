import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections } from "../components/shell/TabbedSections";
import { useWorkspace } from "../lib/workspace";
import PaymentRecord from "./PaymentRecord";
import Rotation from "./Rotation";
import Grazing from "./Grazing";

/**
 * Grazing → Records. Four pages that were four places to look.
 *
 * The day's work is one page — Move — and everything else is the record it
 * leaves behind: the form for the conservationist, the rounds it came from,
 * and the ground it happened on.
 *
 * Mobs left for Settings. This is the page you open to print for the
 * conservationist, and an editor for naming groups of cattle was off-subject
 * in it — the more so now that an animal gets her mob on the animal form.
 *
 * The report is first because it is the thing this section exists to produce.
 */
export default function GrazingRecords() {
  const { business } = useWorkspace();

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Grazing"} title="Grazing records" />
      <TabbedSections
        label="Grazing records"
        sections={[
          { id: "report", label: "Report", hint: "The form, for a date range", node: () => <PaymentRecord /> },
          { id: "rounds", label: "Rounds", hint: "Trips through the farm, and hay", node: () => <Rotation /> },
          { id: "paddocks", label: "Paddocks", hint: "The ground and how it stands", node: () => <Grazing /> },
        ]}
      />
    </OpsShell>
  );
}
