import { useState, useEffect } from 'react';
import { CURRENCY } from './config';
import {
  socket,
  fetchChargers,
  fetchSessions,
  fetchOcppConfig,
  fetchOcppChargePoints,
  fetchOcppMessages,
  sendOcppCommand,
  fetchLogs,
  forceCloseSession,
} from './api';
import BottomNav from './components/BottomNav';
import SolarPage from './components/SolarPage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startedAt) {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sessionDuration(startedAt, stoppedAt) {
  if (!startedAt) return '—';
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-MY', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-MY', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmt(n, dec = 2) {
  return (Number(n) || 0).toFixed(dec);
}

// ── Home Page ─────────────────────────────────────────────────────────────────

function HomePage({ charger, ocppCharger, activeSession, connected, onCommand, onForceClose }) {
  const [busy, setBusy] = useState(false);
  const [stopSent, setStopSent] = useState(false);

  const isCharging = charger?.status === 'active';
  const isFault    = charger?.status === 'fault';
  const isOnline   = ocppCharger?.connectionState === 'connected';

  const statusLabel = isCharging ? 'Charging'
    : isFault  ? 'Fault'
    : isOnline ? 'Available'
    : 'Offline';

  const statusClass = isCharging ? 'charging'
    : isFault  ? 'fault'
    : isOnline ? 'available'
    : 'offline';

  // Stuck session: DB shows charging but charger is not active
  const stuckSession = activeSession && !isCharging;

  async function handleAction() {
    if (busy) return;
    setBusy(true);
    try {
      if (isCharging) {
        const txId = activeSession?.transactionId ?? activeSession?.id ?? 0;
        await onCommand('RemoteStopTransaction', { transactionId: Number(txId) });
        setStopSent(true); // show force-close hint after sending stop
      } else {
        setStopSent(false);
        await onCommand('RemoteStartTransaction', { idTag: 'GUEST', connectorId: 1 });
      }
    } catch (_) {
      // command queued even on error
    } finally {
      setTimeout(() => setBusy(false), 2000);
    }
  }

  const noCharger = !charger && !ocppCharger;

  if (noCharger) {
    return (
      <div className="page home-page">
        <header className="app-header">
          <span className="brand">⚡ CPMS</span>
          <span className={`hdr-dot ${connected ? 'live' : ''}`} title={connected ? 'Connected' : 'Reconnecting'} />
        </header>
        <div className="no-charger-state">
          <div className="no-charger-icon">⚡</div>
          <p className="no-charger-title">No charger connected</p>
          <p className="no-charger-hint">
            Point your EV charger's OCPP URL to this server.<br />
            It will appear here once it connects.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page home-page">
      <header className="app-header">
        <span className="brand">⚡ CPMS</span>
        <span className={`hdr-dot ${connected ? 'live' : ''}`} title={connected ? 'Connected' : 'Reconnecting'} />
      </header>

      <div className="status-section">
        {charger?.station && (
          <p className="station-name">{charger.station}</p>
        )}
        <div className={`status-ring ${statusClass}`}>
          <div className="ring-inner">
            <span className="ring-kw">{fmt(charger?.kw, 1)}</span>
            <span className="ring-unit">kW</span>
          </div>
        </div>
        <span className={`status-badge ${statusClass}`}>{statusLabel}</span>
        {charger?.maxKw > 0 && (
          <div className="kw-bar-wrap">
            <div
              className="kw-bar-fill"
              style={{ width: `${Math.min(100, ((charger.kw || 0) / charger.maxKw) * 100).toFixed(1)}%` }}
            />
            <span className="kw-bar-label">Max {fmt(charger.maxKw, 0)} kW</span>
          </div>
        )}
        {(charger?.id || ocppCharger?.ocppIdentity) && (
          <span className="charger-id-label">
            {charger?.id || ocppCharger?.ocppIdentity}
          </span>
        )}
      </div>

      {(isCharging || stuckSession) && activeSession && (
        <div className="info-card">
          {stuckSession && (
            <p className="info-warn">Session stuck — charger may have stopped locally</p>
          )}
          {(activeSession.user || activeSession.idTag) && (
            <div className="info-row">
              <span className="info-label">User</span>
              <span className="info-value">{activeSession.user || activeSession.idTag}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">Duration</span>
            <span className="info-value">{formatDuration(activeSession.startedAt)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Energy</span>
            <span className="info-value">{fmt(activeSession.energyKwh)} kWh</span>
          </div>
          <div className="info-row">
            <span className="info-label">Amount</span>
            <span className="info-value">{CURRENCY} {fmt(activeSession.amount)}</span>
          </div>
          {(activeSession.meterStart != null) && (
            <div className="info-row">
              <span className="info-label">Meter</span>
              <span className="info-value">{activeSession.meterStart} → {activeSession.meterStop ?? '…'} Wh</span>
            </div>
          )}
          {activeSession.transactionId != null && (
            <div className="info-row">
              <span className="info-label">Tx ID</span>
              <span className="info-value info-mono">{activeSession.transactionId}</span>
            </div>
          )}
        </div>
      )}

      <div className="action-section">
        {stuckSession ? (
          <button className="action-btn stop" onClick={() => onForceClose(activeSession.id)}>
            Force Close Session
          </button>
        ) : (
          <button
            className={`action-btn ${isCharging ? 'stop' : 'start'}`}
            disabled={!isOnline || busy}
            onClick={handleAction}
          >
            {busy ? 'Sending…' : isCharging ? 'Stop Charging' : 'Start Charging'}
          </button>
        )}
        {isCharging && stopSent && (
          <p className="action-hint">
            Stop sent. If charger still shows charging,{' '}
            <button className="link-btn" onClick={() => onForceClose(activeSession?.id)}>force close</button>
          </p>
        )}
        {!isOnline && !stuckSession && <p className="action-hint">Charger is offline</p>}
      </div>
    </div>
  );
}

// ── History Page ──────────────────────────────────────────────────────────────

function HistoryPage({ sessions }) {
  const past = sessions
    .filter(s => s.status !== 'charging')
    .slice(0, 50);

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">Session History</span>
      </header>

      <div className="session-list">
        {past.length === 0 ? (
          <div className="empty-state">No sessions yet</div>
        ) : past.map(s => (
          <div key={s.id} className="session-card">
            <div className="sc-top">
              <span className="sc-date">{formatDate(s.startedAt)}</span>
              <span className={`sc-status ${s.status}`}>{s.status}</span>
            </div>
            <div className="sc-bottom">
              <span className="sc-kwh">{fmt(s.energyKwh)} kWh</span>
              <span className="sc-amount">{CURRENCY} {fmt(s.amount)}</span>
            </div>
            <div className="sc-meta">
              {(s.user || s.idTag) && <span>{s.user || s.idTag}</span>}
              <span>{sessionDuration(s.startedAt, s.stoppedAt)}</span>
              {s.stopReason && s.stopReason !== 'Local' && (
                <span className="sc-stop-reason">{s.stopReason}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Control Page ──────────────────────────────────────────────────────────────

const ACTION_GROUPS = [
  {
    title: 'Reset & Cache',
    actions: [
      { label: 'Soft Reset',  action: 'Reset',      payload: { type: 'Soft' } },
      { label: 'Hard Reset',  action: 'Reset',      payload: { type: 'Hard' } },
      { label: 'Clear Cache', action: 'ClearCache', payload: {} },
    ],
  },
  {
    title: 'Connector',
    actions: [
      { label: 'Unlock',       action: 'UnlockConnector',      payload: { connectorId: 1 } },
      { label: 'Set Operative',   action: 'ChangeAvailability', payload: { connectorId: 1, type: 'Operative' } },
      { label: 'Set Inoperative', action: 'ChangeAvailability', payload: { connectorId: 1, type: 'Inoperative' } },
    ],
  },
  {
    title: 'Trigger Message',
    actions: [
      { label: 'Status',       action: 'TriggerMessage', payload: { requestedMessage: 'StatusNotification' } },
      { label: 'Heartbeat',    action: 'TriggerMessage', payload: { requestedMessage: 'Heartbeat' } },
      { label: 'Boot Notify',  action: 'TriggerMessage', payload: { requestedMessage: 'BootNotification' } },
      { label: 'Meter Values', action: 'TriggerMessage', payload: { requestedMessage: 'MeterValues', connectorId: 1 } },
    ],
  },
  {
    title: 'Configuration',
    actions: [
      { label: 'Get Config',        action: 'GetConfiguration', payload: {} },
      { label: 'Get Local List',    action: 'GetLocalListVersion', payload: {} },
      { label: 'Clear Charging Profile', action: 'ClearChargingProfile', payload: {} },
      { label: 'Get Schedule',      action: 'GetCompositeSchedule', payload: { connectorId: 1, duration: 3600 } },
    ],
  },
];

function ControlPage({ ocppCharger, ocppConfig, ocppMessages, onCommand }) {
  const [busy, setBusy]   = useState(null);
  const [logs, setLogs]   = useState({ out: '', err: '' });
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (!showLogs) return;
    fetchLogs().then(setLogs).catch(() => {});
    const t = setInterval(() => fetchLogs().then(setLogs).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [showLogs]);

  const isOnline = ocppCharger?.connectionState === 'connected';

  async function fire(key, action, payload) {
    if (busy) return;
    setBusy(key);
    try { await onCommand(action, payload); } catch (_) {}
    finally { setTimeout(() => setBusy(null), 1500); }
  }

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">Control</span>
      </header>

      <div className="ctrl-card">
        <div className="ctrl-row">
          <span>Charger</span>
          <strong className="mono">{ocppCharger?.ocppIdentity || '—'}</strong>
        </div>
        <div className="ctrl-row">
          <span>Station</span>
          <strong>{ocppCharger?.station || '—'}</strong>
        </div>
        <div className="ctrl-row">
          <span>Protocol</span>
          <strong>{ocppConfig?.protocol || 'OCPP 1.6'}</strong>
        </div>
        <div className="ctrl-row">
          <span>Max Power</span>
          <strong>{ocppCharger?.maxKw ? `${fmt(ocppCharger.maxKw, 0)} kW` : '—'}</strong>
        </div>
        <div className="ctrl-row">
          <span>Status</span>
          <span className={`status-badge ${isOnline ? 'available' : 'offline'}`}>
            {isOnline ? 'Connected' : 'Offline'}
          </span>
        </div>
        {ocppCharger?.lastSeen && (
          <div className="ctrl-row">
            <span>Last Seen</span>
            <strong>{formatDate(ocppCharger.lastSeen)}</strong>
          </div>
        )}
        {ocppCharger?.lastBoot && (
          <div className="ctrl-row">
            <span>Last Boot</span>
            <strong>{formatDate(ocppCharger.lastBoot)}</strong>
          </div>
        )}
        {ocppCharger?.pendingCommands > 0 && (
          <div className="ctrl-row">
            <span>Pending Cmds</span>
            <strong className="pending-count">{ocppCharger.pendingCommands}</strong>
          </div>
        )}
      </div>

      {ACTION_GROUPS.map(group => (
        <div key={group.title}>
          <div className="section-title">{group.title}</div>
          <div className="quick-grid">
            {group.actions.map(({ label, action, payload }) => {
              const key = `${action}:${label}`;
              return (
                <button
                  key={key}
                  className="quick-btn"
                  disabled={!isOnline || busy !== null}
                  onClick={() => fire(key, action, payload)}
                >
                  {busy === key ? '…' : label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Last response */}
      {ocppMessages.find(m => m.direction === 'inbound') && (() => {
        const last = ocppMessages.find(m => m.direction === 'inbound');
        return (
          <div>
            <div className="section-title">Last Response</div>
            <div className="response-card">
              <div className="response-header">
                <span className="response-action">{last.action}</span>
                <span className="msg-ts mono">{formatTime(last.ts)}</span>
              </div>
              <pre className="response-payload">
                {JSON.stringify(last.payload, null, 2)}
              </pre>
            </div>
          </div>
        );
      })()}

      <div className="section-title">Message Log</div>
      <div className="msg-list">
        {ocppMessages.length === 0 ? (
          <div className="empty-state">No messages yet</div>
        ) : ocppMessages.slice(0, 20).map(m => (
          <div key={m.id} className={`msg-item dir-${m.direction}`}>
            <span className="msg-arrow">
              {m.direction === 'inbound' ? '↓' : m.direction === 'outbound' ? '↑' : '·'}
            </span>
            <span className="msg-action">{m.action}</span>
            <span className="msg-ts mono">{formatTime(m.ts)}</span>
          </div>
        ))}
      </div>

      <div className="section-title">
        System Logs
        <button className="log-toggle-btn" onClick={() => setShowLogs(v => !v)}>
          {showLogs ? 'Hide' : 'Show'}
        </button>
      </div>
      {showLogs && (
        <div className="log-box">
          {logs.err && <pre className="log-err">{logs.err}</pre>}
          <pre className="log-out">{logs.out || '(no output yet)'}</pre>
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]                           = useState('home');
  const [connected, setConnected]               = useState(false);
  const [chargers, setChargers]                 = useState([]);
  const [sessions, setSessions]                 = useState([]);
  const [ocppChargePoints, setOcppChargePoints] = useState([]);
  const [ocppMessages, setOcppMessages]         = useState([]);
  const [ocppConfig, setOcppConfig]             = useState({});

  useEffect(() => {
    const hideSplash = () => {
      const el = document.getElementById('splash');
      if (!el) return;
      el.classList.add('fade');
      setTimeout(() => el.remove(), 420);
    };

    Promise.allSettled([
      fetchChargers().then(setChargers),
      fetchSessions().then(setSessions),
      fetchOcppConfig().then(setOcppConfig),
      fetchOcppChargePoints().then(setOcppChargePoints),
      fetchOcppMessages().then(setOcppMessages),
    ]).finally(hideSplash);

    const splashTimer = setTimeout(hideSplash, 3000);

    socket.connect();
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('chargers:update',          setChargers);
    socket.on('sessions:update',          setSessions);
    socket.on('ocpp:chargePoints:update', setOcppChargePoints);
    socket.on('ocpp:messages:update',     setOcppMessages);

    return () => {
      clearTimeout(splashTimer);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chargers:update');
      socket.off('sessions:update');
      socket.off('ocpp:chargePoints:update');
      socket.off('ocpp:messages:update');
      socket.disconnect();
    };
  }, []);

  const charger       = chargers[0];
  const ocppCharger   = ocppChargePoints[0];
  const activeSession = sessions.find(s => s.status === 'charging');

  async function onCommand(action, payload = {}) {
    if (!ocppCharger?.ocppIdentity) return;
    return sendOcppCommand(ocppCharger.ocppIdentity, action, payload);
  }

  async function onForceClose(sessionId) {
    try {
      await forceCloseSession(sessionId);
    } catch (err) {
      console.error('force-close failed:', err);
    }
  }

  const shared = { charger, ocppCharger, activeSession, connected, onCommand, onForceClose };

  return (
    <div className="app-shell">
      {tab === 'home'    && <HomePage    {...shared} />}
      {tab === 'history' && <HistoryPage sessions={sessions} />}
      {tab === 'solar'   && <SolarPage   maxKw={charger?.maxKw || ocppCharger?.maxKw} />}
      {tab === 'control' && (
        <ControlPage
          ocppCharger={ocppCharger}
          ocppConfig={ocppConfig}
          ocppMessages={ocppMessages}
          onCommand={onCommand}
        />
      )}
      <BottomNav active={tab} onChange={setTab} connected={connected} />
    </div>
  );
}
