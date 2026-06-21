import { CURRENCY } from '../config';

const STATUS_LABEL = { charging: 'Charging', completed: 'Complete', fault: 'Fault' };

export default function SessionTable({ sessions }) {
  return (
    <div className="card" style={{ padding: '28px' }}>
      <div className="section-label">Recent Sessions</div>
      <table className="session-table" aria-label="Recent charging sessions">
        <thead>
          <tr>
            <th scope="col">Point</th>
            <th scope="col">User</th>
            <th scope="col">Started</th>
            <th scope="col">Energy</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <tr key={s.id}>
              <td className="td-id">{s.chargerId}</td>
              <td>{s.user}</td>
              <td>{s.startedAt}</td>
              <td>{s.energyKwh > 0 ? `${Number(s.energyKwh).toFixed(1)} kWh` : '-'}</td>
              <td>{s.amount > 0 ? `${CURRENCY} ${Number(s.amount).toFixed(2)}` : '-'}</td>
              <td>
                <span className={`stag ${s.status}`}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
