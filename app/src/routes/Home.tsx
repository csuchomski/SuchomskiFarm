import { OpsShell } from "../components/shell/OpsShell";
import { useWorkspace } from "../lib/workspace";
import Today from "./Today";
import Overview from "./Overview";
import StartFarm from "./StartFarm";

/**
 * One route, two homes. `/` stays a single path so the rail's Today link and
 * any bookmark keep working across a business switch — the page underneath
 * changes, the URL doesn't.
 *
 * Keyed on the `herd` module rather than `type === "farm"`, because modules
 * are what the rest of the app gates on. A farm that somehow lost its herd
 * module should get the same screen as anything else without one.
 */
export default function Home() {
  const { modules, loading, error, business, reload } = useWorkspace();

  if (loading) {
    return (
      <OpsShell>
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "24px 8px" }}>Loading…</p>
      </OpsShell>
    );
  }

  if (error) {
    return (
      <OpsShell>
        <p style={{ fontSize: 14, color: "var(--red)", padding: "24px 8px" }}>Couldn't load your workspace: {error}</p>
      </OpsShell>
    );
  }

  // A member of nothing is almost always somebody who has just made an
  // account, so this is where a farm gets started rather than where the app
  // tells them there is nothing here. `reload` rather than a redirect: the
  // workspace is what changed, and it has to be asked again before any route
  // renders anything useful.
  if (!business) return <StartFarm onCreated={reload} />;

  return modules.includes("herd") ? <Today /> : <Overview />;
}
