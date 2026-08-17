import { useSearchParams } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { useWorkspace } from "../lib/workspace";
import PaymentRecord from "./PaymentRecord";
import Rotation from "./Rotation";
import Grazing from "./Grazing";
import Mobs from "./Mobs";
import "./grazing-records.css";

/**
 * Grazing → Records. Four pages that were four places to look.
 *
 * The day's work is one page — Move — and everything else is the record it
 * leaves behind: the form for the conservationist, the rounds it came from,
 * the ground it happened on, and the mob it happened to. Those were separate
 * items in the rail, which meant four things to scan past to get to the one
 * that gets printed.
 *
 * Tabs rather than one long page. Each of these is substantial on its own —
 * the report alone is a map and a table — and stacked they would be a
 * scroll rather than a page. Only the open one is mounted, so opening this
 * page fetches what the report needs and nothing else.
 *
 * The report is first because it is the thing this section exists to produce.
 *
 * Each tab is the page it always was, rendered inside this one. `OpsShell`
 * notices it is already inside a shell and steps aside, and `PageHeader`
 * turns into a section heading — the mechanism that folded ten pages into
 * six, used again.
 */

type TabId = "report" | "rounds" | "paddocks" | "mobs";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "report", label: "Report", hint: "The form, for a date range" },
  { id: "rounds", label: "Rounds", hint: "Trips through the farm, and hay" },
  { id: "paddocks", label: "Paddocks", hint: "The ground and how it stands" },
  { id: "mobs", label: "Mobs", hint: "Who is on the grass" },
];

const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

export default function GrazingRecords() {
  const { business } = useWorkspace();
  const [params, setParams] = useSearchParams();

  const raw = params.get("tab");
  const tab: TabId = isTab(raw) ? raw : "report";

  // Replace rather than push: flipping between tabs is looking around one
  // page, and it should not take four presses of Back to leave it.
  const open = (id: TabId) => setParams(id === "report" ? {} : { tab: id }, { replace: true });

  return (
    <OpsShell>
      <PageHeader eyebrow={business?.name ?? "Grazing"} title="Grazing records" />

      <div className="gr-tabs" role="tablist" aria-label="Grazing records">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={`gr-tab ${t.id === tab ? "gr-tab--on" : ""}`}
            onClick={() => open(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="gr-hint">{TABS.find((t) => t.id === tab)!.hint}</p>

      <div className="gr-panel" role="tabpanel">
        {tab === "report" && <PaymentRecord />}
        {tab === "rounds" && <Rotation />}
        {tab === "paddocks" && <Grazing />}
        {tab === "mobs" && <Mobs />}
      </div>
    </OpsShell>
  );
}
