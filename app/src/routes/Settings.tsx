import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { TabbedSections, type Section } from "../components/shell/TabbedSections";
import { useHasModule, useWorkspace } from "../lib/workspace";
import Breeds from "./Breeds";
import Ground from "./Ground";
import GrazingPlan from "./GrazingPlan";
import Mobs from "./Mobs";
import BooksAccounts from "./BooksAccounts";
import StoreSchedules from "./StoreSchedules";
import FarmAndPeople from "./FarmAndPeople";
import Payments from "./Payments";

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
 * **Mobs** came from Grazing → Records, which is the page you open to print
 * for the conservationist; a mob editor sitting in it was off-subject. It is
 * where a mob is defined — name, species, class — and where the roll is
 * worked. An animal is also given her mob on the animal form and dragged
 * between mobs on the Animals page; those two go through `setAnimalMob`,
 * this page's roll still goes through `addToGroup`/`removeFromGroup`, and
 * one write path for the two would be better than two.
 *
 * **The grazing plan** was routed and on no rail at all — reachable only by
 * typing the URL. It holds recovery targets, pounds of dry matter per
 * acre-inch and the trampling and fouling percentages, which are the figures
 * every number on the Move page divides by. Invisible was the worst place for
 * them.
 *
 * **Accounts** is the chart of accounts, set up once and posted against
 * forever; **Schedules** is a delivery pattern rather than a delivery. Both
 * were sitting among the pages their module is worked in daily.
 *
 * **Payments** is what this farm takes — cash at the gate, Venmo, Zelle,
 * whatever it decides. The list used to be one global three shared by every
 * business on the instance and editable only from the SQL editor; migration
 * 057 gave each business its own, and a decision nobody can make is not a
 * decision.
 *
 * Settings sits outside every module on purpose — a rental business has no
 * herd and will still have things to configure — so it is a top-level item
 * rather than a section of one. What is *inside* it is gated: a farm with no
 * store has nothing to say about schedules.
 */
export default function Settings() {
  const { business } = useWorkspace();
  const herd = useHasModule("herd");
  const store = useHasModule("store");
  const books = useHasModule("books");

  const sections: Section[] = [
    ...(herd
      ? [
          { id: "ground", label: "Ground", hint: "Pastures, and the paddocks on them", node: () => <Ground /> },
          { id: "mobs", label: "Mobs", hint: "The groups the herd is worked in", node: () => <Mobs /> },
          { id: "plan", label: "Grazing plan", hint: "The figures every strip is measured against", node: () => <GrazingPlan /> },
          { id: "breeds", label: "Breeds", hint: "The breeds an animal can be", node: () => <Breeds /> },
        ]
      : []),
    ...(books
      ? [{ id: "accounts", label: "Accounts", hint: "The chart the books post against", node: () => <BooksAccounts /> }]
      : []),
    ...(store
      ? [
          { id: "schedules", label: "Schedules", hint: "When the store delivers and collects", node: () => <StoreSchedules /> },
          { id: "payments", label: "Payments", hint: "What this farm takes at the gate", node: () => <Payments /> },
        ]
      : []),
    { id: "farm", label: "Farm & people", hint: "The farm's name, and who can sign in", node: () => <FarmAndPeople /> },
  ];

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Settings"} title="Settings" />
      <TabbedSections label="Settings" sections={sections} />
    </OpsShell>
  );
}
