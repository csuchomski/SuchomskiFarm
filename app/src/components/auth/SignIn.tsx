import { useState } from "react";
import { Button } from "../ui";
import { signInWithPassword } from "../../lib/auth";
import "./sign-in.css";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
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
          Sign in
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }} role="alert">
            {error}
          </p>
        )}

        <Button variant="filled" type="submit" disabled={submitting} style={{ width: "100%", marginTop: 24 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
