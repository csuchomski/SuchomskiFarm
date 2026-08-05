import { useFarm } from "../../lib/farm";
import { signOut } from "../../lib/auth";
import "./topbar.css";

export function TopBar({ searchPlaceholder = "Search everything" }: { searchPlaceholder?: string }) {
  const { role, loading } = useFarm();

  return (
    <header className="topbar">
      <div className="serif topbar__wordmark">
        Suchomski<span className="topbar__dot">.</span>
      </div>
      <div className="topbar__right">
        <div className="topbar__search">
          <span className="mono topbar__search-icon">⌕</span>
          <span className="topbar__search-placeholder">{searchPlaceholder}</span>
        </div>
        <div className="eyebrow">{loading ? "…" : `Suchomski Family Farm · ${role ?? "no role"}`}</div>
        <button className="topbar__signout eyebrow" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}
