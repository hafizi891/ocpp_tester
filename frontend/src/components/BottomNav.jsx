export default function BottomNav({ active, onChange, connected }) {
  const tabs = [
    { id: 'home',     label: 'Home',     icon: '⚡' },
    { id: 'history',  label: 'History',  icon: '📋' },
    { id: 'profiles', label: 'Profiles', icon: '🚗' },
    { id: 'solar',    label: 'Solar',    icon: '☀️' },
    { id: 'control',  label: 'Control',  icon: '⚙️' },
  ];

  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`nav-tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="nav-icon" aria-hidden="true">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
      <span className={`nav-live-dot ${connected ? 'on' : ''}`} aria-hidden="true" />
    </nav>
  );
}
