export default function Header({ page, onChange, pages }) {
  return (
    <header className="header">
      <div className="logo">RSS Curator</div>
      <nav className="nav">
        {Object.entries(pages).map(([key, item]) => (
          <button
            key={key}
            className={`nav-button ${page === key ? "active" : ""}`}
            onClick={() => onChange(key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}