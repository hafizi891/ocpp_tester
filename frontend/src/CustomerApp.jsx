import { useState, useEffect, useRef } from 'react';
import { CURRENCY } from './config';
import {
  socket,
  fetchChargers,
  fetchSessions,
  fetchOcppChargePoints,
  fetchOcppCommands,
  sendOcppCommand,
} from './api';

function formatDuration(startedAt) {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmt(n, dec = 2) {
  return (Number(n) || 0).toFixed(dec);
}

export default function CustomerApp() {
  const [charger, setCharger]         = useState(null);
  const [sessions, setSessions]       = useState([]);
  const [ocppCharger, setOcppCharger] = useState(null);
  const [ocppCommands, setOcppCommands] = useState([]);
  const [connected, setConnected]     = useState(false);
  const [busy, setBusy]               = useState(false);
  const [feedback, setFeedback]       = useState(null);
  const [tick, setTick]               = useState(0);
  const pendingCmdId                  = useRef(null);

  // Live clock for duration
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const hideSplash = () => {
      const el = document.getElementById('splash');
      if (!el) return;
      el.classList.add('fade');
      setTimeout(() => el.remove(), 420);
    };

    Promise.allSettled([
      fetchChargers().then(cs => setCharger(cs[0])),
      fetchSessions().then(setSessions),
      fetchOcppChargePoints().then(pts => setOcppCharger(pts[0])),
      fetchOcppCommands().then(setOcppCommands),
    ]).finally(hideSplash);

    setTimeout(hideSplash, 3000);

    socket.connect();
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('chargers:update',          cs  => setCharger(cs[0]));
    socket.on('sessions:update',          setSessions);
    socket.on('ocpp:chargePoints:update', pts => setOcppCharger(pts[0]));
    socket.on('ocpp:commands:update',     setOcppCommands);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chargers:update');
      socket.off('sessions:update');
      socket.off('ocpp:chargePoints:update');
      socket.off('ocpp:commands:update');
      socket.disconnect();
    };
  }, []);

  const isCharging   = charger?.status === 'active';
  const isOnline     = ocppCharger?.connectionState === 'connected';
  const activeSession = sessions.find(s => s.status === 'charging');

  // Watch command response
  useEffect(() => {
    if (!pendingCmdId.current) return;
    const cmd = ocppCommands.find(c => c.id === pendingCmdId.current);
    if (!cmd || cmd.status === 'pending' || cmd.status === 'sent') return;

    if (cmd.status === 'accepted') {
      if (cmd.response?.status === 'Accepted') {
        setFeedback({ type: 'info', text: 'Accepted — starting your session…' });
      } else {
        setFeedback({ type: 'error', text: 'Could not start charging. Please try again.' });
        pendingCmdId.current = null;
        setTimeout(() => setFeedback(null), 5000);
      }
    } else if (cmd.status === 'failed') {
      setFeedback({ type: 'error', text: 'No response from charger. Please try again.' });
      pendingCmdId.current = null;
      setTimeout(() => setFeedback(null), 5000);
    }
  }, [ocppCommands]);

  // Confirm charging started
  useEffect(() => {
    if (!pendingCmdId.current) return;
    if (isCharging) {
      setFeedback({ type: 'success', text: 'Charging started!' });
      pendingCmdId.current = null;
      setTimeout(() => setFeedback(null), 4000);
    }
  }, [isCharging]);

  async function handleAction() {
    if (busy || !ocppCharger?.ocppIdentity) return;
    setBusy(true);
    try {
      if (isCharging) {
        const txId = activeSession?.transactionId ?? activeSession?.id ?? 0;
        await sendOcppCommand(ocppCharger.ocppIdentity, 'RemoteStopTransaction', {
          transactionId: Number(txId),
        });
        setFeedback({ type: 'info', text: 'Stopping your session…' });
        setTimeout(() => setFeedback(null), 5000);
      } else {
        setFeedback({ type: 'info', text: 'Connecting to charger…' });
        const cmd = await sendOcppCommand(ocppCharger.ocppIdentity, 'RemoteStartTransaction', {
          idTag: 'GUEST', connectorId: 1,
        });
        if (cmd?.id) {
          pendingCmdId.current = cmd.id;
          setFeedback({ type: 'info', text: 'Waiting for charger response…' });
        }
      }
    } catch (_) {
      setFeedback({ type: 'error', text: 'Connection error. Please try again.' });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  }

  const statusLabel = isCharging ? 'Charging'
    : !isOnline     ? 'Unavailable'
    : 'Available';

  const statusColor = isCharging ? '#ff682c'
    : !isOnline     ? '#9ca3af'
    : '#1e7c4a';

  return (
    <div className="cu-shell">

      {/* Header */}
      <div className="cu-header">
        <span className="cu-brand">⚡ EV Charger</span>
        <span className="cu-station">{charger?.station || ocppCharger?.station || ''}</span>
      </div>

      {/* Status ring */}
      <div className="cu-center">
        <div className="cu-ring" style={{ borderColor: statusColor }}>
          <div className="cu-ring-inner">
            {isCharging ? (
              <>
                <span className="cu-kw">{fmt(charger?.kw, 1)}</span>
                <span className="cu-kw-unit">kW</span>
              </>
            ) : (
              <span className="cu-status-icon">
                {!isOnline ? '⚠' : '⚡'}
              </span>
            )}
          </div>
        </div>

        <span className="cu-status-label" style={{ color: statusColor }}>
          {statusLabel}
        </span>

        {isCharging && charger?.maxKw > 0 && (
          <div className="cu-kw-bar-wrap">
            <div
              className="cu-kw-bar-fill"
              style={{
                width: `${Math.min(100, ((charger.kw || 0) / charger.maxKw) * 100)}%`,
                background: statusColor,
              }}
            />
          </div>
        )}
      </div>

      {/* Session info */}
      {isCharging && activeSession && (
        <div className="cu-session-card">
          <div className="cu-session-row">
            <span className="cu-session-label">Duration</span>
            <span className="cu-session-value">{formatDuration(activeSession.startedAt)}</span>
          </div>
          <div className="cu-session-row">
            <span className="cu-session-label">Energy</span>
            <span className="cu-session-value">{fmt(activeSession.energyKwh, 2)} kWh</span>
          </div>
          {Number(activeSession.amount) > 0 && (
            <div className="cu-session-row">
              <span className="cu-session-label">Amount</span>
              <span className="cu-session-value">{CURRENCY} {fmt(activeSession.amount)}</span>
            </div>
          )}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`cu-feedback cu-feedback--${feedback.type}`}>
          {feedback.type === 'success' && '✓ '}
          {feedback.type === 'error'   && '✕ '}
          {feedback.type === 'info'    && '· '}
          {feedback.text}
        </div>
      )}

      {/* Action button */}
      <div className="cu-action">
        {!isOnline ? (
          <div className="cu-unavailable">
            Charger is currently unavailable.<br />Please contact the site operator.
          </div>
        ) : (
          <button
            className={`cu-btn ${isCharging ? 'cu-btn--stop' : 'cu-btn--start'}`}
            disabled={busy}
            onClick={handleAction}
          >
            {busy ? 'Please wait…' : isCharging ? 'Stop Charging' : 'Start Charging'}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="cu-footer">
        <span className={`cu-live-dot ${connected ? 'on' : ''}`} />
        {connected ? 'Live' : 'Reconnecting…'}
      </div>
    </div>
  );
}
