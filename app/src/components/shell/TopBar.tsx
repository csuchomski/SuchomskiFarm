import "./topbar.css";

export function TopBar({
  searchPlaceholder = "Search everything",
  meta = "Family Farm · 41 head · Chris",
}: {
  searchPlaceholder?: string;
  meta?: string;
}) {
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
        <div className="eyebrow">{meta}</div>
      </div>
    </header>
  );
}
