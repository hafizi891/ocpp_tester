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
} from './api';
import BottomNav from './components/BottomNav';

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

function HomePage({ charger, ocppCharger, activeSession, connected, onCommand }) {
  const [busy, setBusy] = useState(false);

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

  async function handleAction() {
    if (busy) return;
    setBusy(true);
    try {
      if (isCharging) {
        const txId = activeSession?.transactionId ?? activeSession?.id ?? 0;
        await onCommand('RemoteStopTransaction', { transactionId: Number(txId) });
      } else {
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

      {isCharging && activeSession && (
        <div className="info-card">
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
        </div>
      )}

      <div className="action-section">
        <button
          className={`action-btn ${isCharging ? 'stop' : 'start'}`}
          disabled={!isOnline || busy}
          onClick={handleAction}
        >
          {busy ? 'Sending…' : isCharging ? 'Stop Charging' : 'Start Charging'}
        </button>
        {!isOnline && <p className="action-hint">Charger is offline</p>}
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

const QUICK_ACTIONS = [
  { label: 'Soft Reset',     action: 'Reset',            payload: { type: 'Soft' } },
  { label: 'Hard Reset',     action: 'Reset',            payload: { type: 'Hard' } },
  { label: 'Unlock',         action: 'UnlockConnector',  payload: { connectorId: 1 } },
  { label: 'Clear Cache',    action: 'ClearCache',       payload: {} },
  { label: 'Get Config',     action: 'GetConfiguration', payload: {} },
  { label: 'Trigger Status', action: 'TriggerMessage',   payload: { requestedMessage: 'StatusNotification' } },
];

function ControlPage({ ocppCharger, ocppConfig, ocppMessages, onCommand }) {
  const [busy, setBusy] = useState(null);

  const isOnline = ocppCharger?.connectionState === 'connected';

  async function fire(action, payload) {
    if (busy) return;
    setBusy(action);
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

      <div className="section-title">Quick Actions</div>
      <div className="quick-grid">
        {QUICK_ACTIONS.map(({ label, action, payload }) => (
          <button
            key={label}
            className="quick-btn"
            disabled={!isOnline || busy !== null}
            onClick={() => fire(action, payload)}
          >
            {busy === action ? '…' : label}
          </button>
        ))}
      </div>

      <div className="section-title">Recent Messages</div>
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

  const shared = { charger, ocppCharger, activeSession, connected, onCommand };

  return (
    <div className="app-shell">
      {tab === 'home'    && <HomePage    {...shared} />}
      {tab === 'history' && <HistoryPage sessions={sessions} />}
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
