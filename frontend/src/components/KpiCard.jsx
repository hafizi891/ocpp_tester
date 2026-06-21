export default function KpiCard({ label, value, unit, delta, deltaDir = 'neutral', accentDim = false, compact = false }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${compact ? ' kpi-value--sm' : ''}`}>
        {value}
        {unit && <span className="kpi-unit"> {unit}</span>}
      </div>
      {delta && <div className={`kpi-delta ${deltaDir}`}>{delta}</div>}
      <div className={`kpi-bar${accentDim ? ' dim' : ''}`} aria-hidden="true" />
    </div>
  );
}
