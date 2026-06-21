export default function OcppCore({
  architecture,
  chargePoints,
  messages,
  commands,
  commandActions,
  gatewayEndpoint,
  baseGatewayEndpoint,
  identitySources,
  protocol,
  onCommand,
}) {
  const connectedCount = chargePoints.filter(cp => cp.connectionState === 'connected').length;
  const pendingCount = commands.filter(command => command.status === 'pending').length;
  const selected = chargePoints[0];

  return (
    <section className="ocpp-shell" aria-label="OCPP CPMS architecture">
      <div className="ocpp-header">
        <div>
          <div className="card-eyebrow">OCPP Core</div>
          <h2 className="ocpp-title">CPMS control plane</h2>
          <p className="ocpp-sub">
            Per-charger URL {gatewayEndpoint || 'not configured'} / Base URL {baseGatewayEndpoint || 'not configured'} using {protocol || 'configured'} JSON frames.
          </p>
          <p className="ocpp-sub ocpp-sub-secondary">
            Identity sources: {(identitySources || []).join(', ') || 'not configured'}.
          </p>
        </div>
        <div className="ocpp-stats" aria-label="OCPP status summary">
          <Metric label="Connected" value={connectedCount} />
          <Metric label="Known CPs" value={chargePoints.length} />
          <Metric label="Pending" value={pendingCount} />
        </div>
      </div>

      <div className="ocpp-layout">
        <div className="card ocpp-card">
          <div className="section-label">Architecture layers</div>
          <div className="ocpp-layers">
            {architecture.map(item => (
              <div className="ocpp-layer" key={item.layer}>
                <div className="ocpp-layer-name">{item.layer}</div>
                <div className="ocpp-layer-copy">{item.responsibility}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card ocpp-card">
          <div className="section-label">Charge point registry</div>
          <div className="ocpp-cp-list">
            {chargePoints.slice(0, 8).map(cp => (
              <div className="ocpp-cp" key={cp.ocppIdentity}>
                <div>
                  <div className="ocpp-cp-id">{cp.ocppIdentity}</div>
                  <div className="ocpp-cp-meta">{cp.station} / {cp.endpoint}</div>
                </div>
                <span className={`ocpp-pill ${cp.connectionState}`}>{cp.connectionState}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card ocpp-card ocpp-controls">
          <div className="section-label">Remote commands</div>
          <div className="ocpp-target">
            <span>Target</span>
            <strong>{selected?.ocppIdentity || 'No charge point'}</strong>
          </div>
          <div className="ocpp-command-grid">
            {(commandActions || []).map(action => (
              <button
                className="ocpp-command"
                type="button"
                key={action}
                disabled={!selected}
                onClick={() => onCommand(selected.ocppIdentity, action)}
              >
                {formatAction(action)}
              </button>
            ))}
          </div>
        </div>

        <div className="card ocpp-card">
          <div className="section-label">Command queue</div>
          <div className="ocpp-table-wrap">
            <table className="ocpp-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Charge point</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {commands.slice(0, 6).map(command => (
                  <tr key={command.id}>
                    <td>{formatAction(command.action)}</td>
                    <td>{command.chargePointId}</td>
                    <td><span className={`ocpp-pill ${command.status}`}>{command.status}</span></td>
                  </tr>
                ))}
                {!commands.length && <EmptyRow cols={3} label="No operator commands yet" />}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card ocpp-card ocpp-messages-card">
        <div className="section-label">Protocol messages</div>
        <div className="ocpp-message-list">
          {messages.slice(0, 10).map(message => (
            <div className="ocpp-message" key={message.id}>
              <span className={`ocpp-direction ${message.direction}`}>{message.direction}</span>
              <span className="ocpp-message-action">{message.action}</span>
              <span className="ocpp-message-cp">{message.chargePointId}</span>
              <code>{JSON.stringify(message.payload)}</code>
            </div>
          ))}
          {!messages.length && <div className="ocpp-empty">No OCPP messages received yet.</div>}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="ocpp-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyRow({ cols, label }) {
  return (
    <tr>
      <td className="ocpp-empty-cell" colSpan={cols}>{label}</td>
    </tr>
  );
}

function formatAction(action) {
  return action.replace(/([a-z])([A-Z])/g, '$1 $2');
}

