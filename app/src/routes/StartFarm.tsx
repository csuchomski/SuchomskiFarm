import { useState } from "react";
import { Button, Callout } from "../components/ui";
import { createFarm } from "../lib/onboarding";
import { signOut } from "../lib/auth";
import "./start-farm.css";

/**
 * The screen a new account lands on.
 *
 * What used to be here was a sentence — "You're signed in, but you're not a
 * member of any business yet" — which is true and completely useless. It is
 * the point at which somebody who has just paid discovers the app was built
 * for one farm.
 *
 * One field. A farm needs a name and nothing else; paddocks, animals and the
 * figures the grazing module runs on are all things you set once you are
 * inside, and asking for them here would be a form standing between a person
 * and the thing they came for.
 *
 * Deliberately outside `OpsShell`. Rendered inside it, the top bar announced
 * "NO BUSINESS" and the hamburger opened a nav rail with nothing in it —
 * the app's furniture wrapped around somebody who is not in the app yet, and
 * it reads as broken rather than as a beginning.
 */
export default function StartFarm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await createFarm(name);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="start-farm-page">
      <div className="start-farm">
        <p className="eyebrow">Welcome</p>
        <h1 className="serif start-farm__title">Name your farm</h1>
        <p className="start-farm__lede">
          This is the only thing needed to get going. Everything else — the paddocks, the herd, what
          an acre-inch of your grass weighs — is set from inside, once there is somewhere to put it.
        </p>

        <label className="start-farm__field">
          <span className="eyebrow">Farm name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hilltop Farm"
            aria-label="Farm name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() !== "" && !busy) start();
            }}
          />
        </label>

        {error !== null && (
          <div style={{ marginTop: 16 }}>
            <Callout>{error}</Callout>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <Button variant="filled" disabled={busy || name.trim() === ""} onClick={start}>
            {busy ? "Setting it up…" : "Start the farm"}
          </Button>
        </div>

        <p className="start-farm__foot">
          You can change the name later. If you were meant to join a farm somebody else keeps, ask
          them to add you rather than starting one here.
        </p>

        <button type="button" className="start-farm__out" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
