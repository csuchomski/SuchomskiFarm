import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Inventory from "./routes/Inventory";
import AnimalProfile from "./routes/AnimalProfile";
import AnimalForm from "./routes/AnimalForm";
import Settings from "./routes/Settings";
import { FarmSetup, SignIn } from "./routes/Auth";
import { invalidate, useSession } from "./lib/session";
import { useHerdIndex } from "./lib/hooks";

/**
 * The app is installable, so the shell loads from cache with no connection —
 * but the records live on the server. Rather than let every query fail with a
 * network error, say so plainly.
 */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      invalidate();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function OfflineBar() {
  return (
    <div
      role="status"
      style={{
        background: "var(--ink)",
        color: "var(--paper)",
        padding: "10px 16px",
        fontSize: "var(--t-small)"
      }}
    >
      <strong>No connection.</strong> Records are stored on the server, so nothing
      will load or save until you are back in range.
    </div>
  );
}

const nav = [
  { to: "/", label: "Animals", end: true },
  { to: "/new", label: "Add animal", end: false },
  { to: "/settings", label: "Settings", end: false }
];

export default function App() {
  const { loading, session, farmId, farmName } = useSession();

  if (loading) {
    return (
      <div className="app">
        <header className="topbar">
          <span className="wordmark">
            Herd<span>.</span>
          </span>
        </header>
        <main className="main">
          <div className="page">
            <p className="muted">Opening records…</p>
          </div>
        </main>
      </div>
    );
  }

  if (!session) return <SignIn />;
  if (!farmId) return <FarmSetup />;

  return <Shell farmName={farmName} />;
}

function Shell({ farmName }: { farmName: string }) {
  const index = useHerdIndex();
  const online = useOnline();
  const headcount = index.animals.filter(
    (a) => a.recordType === "herd" && a.status === "active"
  ).length;

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="wordmark">
          Herd<span>.</span>
        </NavLink>
        <div className="topbar-meta">
          {index.loading ? "Opening records" : `${farmName} · ${headcount} head`}
        </div>
      </header>

      {!online && <OfflineBar />}

      <div className="shell">
        <aside className="rail">
          <div className="rail-group">Records</div>
          <nav>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="main">
          {index.error && (
            <div className="page" style={{ paddingBottom: 0 }}>
              <p className="error small" role="alert">
                {index.error}
              </p>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Inventory />} />
            <Route path="/new" element={<AnimalForm />} />
            <Route path="/animal/:id" element={<AnimalProfile />} />
            <Route path="/animal/:id/edit" element={<AnimalForm />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      <nav className="tabbar">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
