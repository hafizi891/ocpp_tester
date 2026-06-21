const LINKS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stations', label: 'Stations' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'reports', label: 'Reports' },
  { id: 'management', label: 'Management' },
];

export default function Nav({ connected, activeTab, onTabChange }) {
  return (
    <nav className="nav-wrap" aria-label="Primary navigation">
      <div className="nav-pill">
        <span className="nav-brand">
          ventri<span className="nav-brand-orange">o</span>loc
        </span>
        <div className="nav-links" role="tablist" aria-label="CPMS sections">
          {LINKS.map(link => (
            <button
              key={link.id}
              type="button"
              role="tab"
              aria-selected={activeTab === link.id}
              className={`nav-link${activeTab === link.id ? ' is-active' : ''}`}
              onClick={() => onTabChange(link.id)}
            >
              {link.label}
            </button>
          ))}
        </div>
        <span className={`nav-live${connected ? '' : ' disconnected'}`} aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
    </nav>
  );
}
