import { useState } from "react";
import { CustomerShell } from "../shell/CustomerShell";
import { signInWithPassword } from "../../lib/auth";
import { signUpCustomer } from "../../lib/customer";
import "./sign-in.css";

/**
 * Sign-in and sign-up for the storefront. Separate from the staff SignIn
 * because a customer's first visit is a sign-up, and because it lives inside
 * the customer shell rather than the ops one.
 */
export function CustomerAuth() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "in") {
        await signInWithPassword(email, password);
      } else {
        const { needsConfirmation } = await signUpCustomer({ email, password, firstName, lastName, phone });
        if (needsConfirmation) {
          setNotice("Check your email to confirm the account, then sign in.");
          setMode("in");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell activeTab="Account">
      <div style={{ padding: "24px 16px" }}>
        <div className="serif" style={{ fontSize: 34, marginBottom: 4 }}>
          {mode === "in" ? "Welcome back" : "Set up an account"}
        </div>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", marginBottom: 24 }} className="text-wrap-pretty">
          {mode === "in"
            ? "Sign in to reserve what you want and see your pickups."
            : "So we know who's collecting, and can let you know when something's ready."}
        </p>

        <form onSubmit={submit}>
          {mode === "up" && (
            <>
              <Field label="First name" value={firstName} onChange={setFirstName} required autoComplete="given-name" />
              <Field label="Last name" value={lastName} onChange={setLastName} required autoComplete="family-name" />
              <Field label="Phone" value={phone} onChange={setPhone} type="tel" autoComplete="tel" />
            </>
          )}
          <Field label="Email" value={email} onChange={setEmail} type="email" required autoComplete="email" />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            required
            autoComplete={mode === "in" ? "current-password" : "new-password"}
          />

          {error && (
            <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p style={{ color: "var(--herd-green)", fontSize: 13, marginTop: 12 }} role="status">
              {notice}
            </p>
          )}

          <button className="shop-reserve-btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 24 }}>
            {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "in" ? "up" : "in"));
            setError(null);
            setNotice(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--herd-green)",
            fontSize: 13,
            marginTop: 16,
            padding: 0,
          }}
        >
          {mode === "in" ? "First time here? Set up an account →" : "Already have an account? Sign in →"}
        </button>
      </div>
    </CustomerShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  const id = `f-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="eyebrow" htmlFor={id} style={{ display: "block", marginBottom: 6 }}>
        {label}
      </label>
      <input
        id={id}
        className="sign-in-field"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
      />
    </div>
  );
}
