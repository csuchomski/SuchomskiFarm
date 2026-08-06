import { OpsShell } from "../components/shell/OpsShell";
import { useWorkspace } from "../lib/workspace";
import Today from "./Today";
import Overview from "./Overview";

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
  const { modules, loading, error, business } = useWorkspace();

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

  if (!business) {
    return (
      <OpsShell>
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "24px 8px" }}>
          You're signed in, but you're not a member of any business yet.
        </p>
      </OpsShell>
    );
  }

  return modules.includes("herd") ? <Today /> : <Overview />;
}
