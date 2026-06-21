import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-val">{payload[0].value} kWh</div>
    </div>
  );
}

export default function EnergyChart({ data, totalKwh }) {
  const currentHour = new Date().getHours();
  const nowLabel    = data[currentHour]?.label ?? '';

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 0 }}>
        <div>
          <div className="card-eyebrow">Energy Delivery</div>
          <div className="card-headline">{Number(totalKwh).toFixed(0)} kWh today</div>
        </div>
        <div className="card-meta" style={{ paddingTop: 2 }}>
          {new Date().toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })} · Hourly
        </div>
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="grad-orange" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ff682c" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#ff682c" stopOpacity={0}    />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#e8e8e8" strokeDasharray="0" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#828282', fontFamily: 'inherit' }}
            tickLine={false}
            axisLine={false}
            interval={3}
          />

          <YAxis
            tick={{ fontSize: 10, fill: '#828282', fontFamily: 'inherit' }}
            tickLine={false}
            axisLine={false}
            width={34}
          />

          <Tooltip content={<ChartTooltip />} />

          {nowLabel && (
            <ReferenceLine
              x={nowLabel}
              stroke="rgba(255,104,44,0.55)"
              strokeDasharray="3 3"
              label={{ value: 'now', fill: '#ff682c', fontSize: 10, position: 'top', fontFamily: 'inherit' }}
            />
          )}

          <Area
            type="monotone"
            dataKey="kwh"
            stroke="#202020"
            strokeWidth={1.5}
            fill="url(#grad-orange)"
            dot={false}
            activeDot={{ r: 4, fill: '#ff682c', stroke: 'none' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
