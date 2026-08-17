import { useState } from "react";
import { Button } from "../ui";
import { signInWithPassword } from "../../lib/auth";
import { signUpFarmer } from "../../lib/onboarding";
import "./sign-in.css";

/**
 * The way in, for somebody who has an account and for somebody who does not.
 *
 * One card with two modes rather than two screens: the difference between
 * them is a single field and a verb, and a separate page would mean a person
 * who mistyped their password has to find their way back.
 *
 * Signing up does not make a farm. It makes an account — the farm comes
 * after, on its own screen, because with email confirmation on there is no
 * session yet and nothing can be written as this person until they have
 * followed the link.
 */
export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const joining = mode === "up";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNote(null);
    setSubmitting(true);
    try {
      if (joining) {
        const { needsConfirmation } = await signUpFarmer(email, password);
        if (needsConfirmation) {
          setNote(`Check ${email} for a link to confirm the address, then sign in.`);
          setMode("in");
        }
        // With confirmations off the session arrives on its own and the app
        // takes over — there is nothing to say.
      } else {
        await signInWithPassword(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : joining ? "Sign-up failed." : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sign-in-page">
      <form className="sign-in-card" onSubmit={handleSubmit}>
        <div className="serif" style={{ fontSize: 27, marginBottom: 4 }}>
          Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
        </div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>
          {joining ? "Start a farm" : "Sign in"}
        </div>

        <label className="eyebrow" htmlFor="email" style={{ display: "block", marginBottom: 6 }}>
          Email
        </label>
        <input
          id="email"
          className="sign-in-field"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="eyebrow" htmlFor="password" style={{ display: "block", margin: "16px 0 6px" }}>
          Password
        </label>
        <input
          id="password"
          className="sign-in-field"
          type="password"
          autoComplete={joining ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={joining ? 8 : undefined}
        />
        {joining && (
          <p style={{ fontSize: 12.5, color: "var(--ink-muted)", marginTop: 6 }}>Eight characters or more.</p>
        )}

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }} role="alert">
            {error}
          </p>
        )}
        {note && (
          <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 12 }} role="status">
            {note}
          </p>
        )}

        <Button variant="filled" type="submit" disabled={submitting} style={{ width: "100%", marginTop: 24 }}>
          {submitting ? (joining ? "Creating…" : "Signing in…") : joining ? "Create an account" : "Sign in"}
        </Button>

        <button
          type="button"
          className="sign-in-switch"
          onClick={() => {
            setMode(joining ? "in" : "up");
            setError(null);
            setNote(null);
          }}
        >
          {joining ? "I already have an account" : "Start a farm instead"}
        </button>
      </form>
    </div>
  );
}
