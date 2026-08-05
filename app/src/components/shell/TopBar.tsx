import { useWorkspace } from "../../lib/workspace";
import { signOut } from "../../lib/auth";
import "./topbar.css";

export function TopBar({ searchPlaceholder = "Search everything" }: { searchPlaceholder?: string }) {
  const { businesses, business, role, loading, setBusinessId } = useWorkspace();

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

        {loading ? (
          <span className="eyebrow">…</span>
        ) : businesses.length > 1 ? (
          <select
            className="topbar__business"
            value={business?.id ?? ""}
            onChange={(e) => setBusinessId(Number(e.target.value))}
            aria-label="Business"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="eyebrow">{business?.name ?? "No business"}</span>
        )}

        {role && <span className="eyebrow">{role}</span>}

        <button className="topbar__signout eyebrow" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}
