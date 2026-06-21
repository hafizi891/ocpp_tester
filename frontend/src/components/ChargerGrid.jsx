export default function ChargerGrid({ chargers }) {
  const stationNames = Array.from(new Set(chargers.map(c => c.station).filter(Boolean)));
  const stationLabel = stationNames.length === 0
    ? 'No stations configured'
    : stationNames.length === 1
      ? stationNames[0]
      : 'All stations';

  return (
    <div className="card station-card">
      <div className="card-eyebrow">Charge Points</div>
      <div className="card-headline" style={{ marginBottom: 14 }}>{stationLabel}</div>

      <div className="charger-grid" role="list" aria-label="Charger status">
        {chargers.map(c => {
          const pct = c.maxKw > 0 ? (c.kw / c.maxKw) * 100 : 0;
          const isActive = c.status === 'active';
          const isFault = c.status === 'fault';
          const statusLabel = isActive ? 'Charging' : isFault ? 'Fault' : 'Available';

          return (
            <div
              key={c.id}
              role="listitem"
              aria-label={`${c.id} - ${statusLabel}`}
              className={`cp-item${isActive ? ' is-active' : isFault ? ' is-fault' : ''}`}
            >
              <div className="cp-top">
                <span className="cp-id">{c.id}</span>
                <span className={`cp-dot ${c.status}`} aria-hidden="true" />
              </div>
              <div className="cp-status">{statusLabel}</div>
              <div className="cp-kw">{c.kw > 0 ? `${c.kw} kW` : '-'}</div>
              <div className="cp-bar-track" aria-hidden="true">
                <div className="cp-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="station-legend" aria-label="Status legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'var(--status-ok)' }} aria-hidden="true" />
          Charging
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'var(--chalk)', border: '1px solid var(--slate)' }} aria-hidden="true" />
          Available
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'var(--status-fault)' }} aria-hidden="true" />
          Fault
        </div>
      </div>
    </div>
  );
}
