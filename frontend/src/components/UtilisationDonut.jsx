import { PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#ff682c', '#e8e8e8', '#c0392b'];

export default function UtilisationDonut({ chargers }) {
  const active  = chargers.filter(c => c.status === 'active').length;
  const idle    = chargers.filter(c => c.status === 'idle').length;
  const fault   = chargers.filter(c => c.status === 'fault').length;
  const total   = chargers.length || 1;
  const usePct  = Math.round((active / total) * 100);

  const slices = [
    { name: 'Charging',  value: active },
    { name: 'Available', value: idle   },
    { name: 'Offline',   value: fault  },
  ];

  return (
    <div className="card donut-card">
      <div className="section-label">Utilisation</div>
      <div className="card-headline" style={{ marginBottom: 0 }}>Network</div>

      <div className="donut-chart-wrap">
        <PieChart width={160} height={160} aria-label={`${usePct}% of chargers in use`}>
          <Pie
            data={slices}
            cx={75}
            cy={75}
            innerRadius={50}
            outerRadius={70}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            paddingAngle={2}
            stroke="none"
          >
            {slices.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
          </Pie>
        </PieChart>

        <div className="donut-center" aria-hidden="true">
          <span className="donut-pct">{usePct}%</span>
          <span className="donut-sub">in use</span>
        </div>
      </div>

      <div className="donut-legend" aria-label="Utilisation breakdown">
        {slices.map((seg, i) => (
          <div key={seg.name} className="dl-item">
            <div className="dl-left">
              <div
                className="dl-dot"
                style={{
                  background: COLORS[i],
                  border: COLORS[i] === '#e8e8e8' ? '1px solid #828282' : 'none',
                }}
                aria-hidden="true"
              />
              {seg.name}
            </div>
            <span className="dl-val">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
