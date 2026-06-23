import { useState, useEffect, useRef } from 'react';
import { fetchSolarConfig, fetchSolarStatus, saveSolarConfig, setSolarManual, clearSolarLimit } from '../api';

function fmt(n, d = 1) { return (Number(n) || 0).toFixed(d); }

function StatusBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="solar-bar-wrap">
      <div className="solar-bar-labels">
        <span>{label}</span>
        <span className="solar-bar-val">{fmt(value)} kW</span>
      </div>
      <div className="solar-bar-track">
        <div className="solar-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function SolarPage({ maxKw }) {
  const MAX = maxKw || 22;

  const [cfg, setCfg]       = useState(null);
  const [status, setStatus] = useState(null);
  const [draft, setDraft]   = useState({});
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    fetchSolarConfig().then(c => { setCfg(c); setDraft(c); }).catch(() => {});
    fetchSolarStatus().then(setStatus).catch(() => {});

    pollRef.current = setInterval(() => {
      fetchSolarStatus().then(setStatus).catch(() => {});
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function handleSaveConfig() {
    setSaving(true);
    try {
      const updated = await saveSolarConfig(draft);
      setCfg(updated);
      setDraft(updated);
    } catch (_) {}
    setSaving(false);
  }

  async function handleApplyManual() {
    setApplying(true);
    try {
      const s = await setSolarManual(draft.manualKw);
      setStatus(s);
    } catch (_) {}
    setTimeout(() => setApplying(false), 1000);
  }

  async function handleClear() {
    try {
      await clearSolarLimit();
      const [c, s] = await Promise.all([fetchSolarConfig(), fetchSolarStatus()]);
      setCfg(c); setDraft(c); setStatus(s);
    } catch (_) {}
  }

  function set(key, val) { setDraft(d => ({ ...d, [key]: val })); }

  if (!cfg) return <div className="page"><div className="empty-state">Loading…</div></div>;

  const isAuto   = draft.mode === 'auto';
  const enabled  = cfg.enabled;

  return (
    <div className="page">
      <header className="app-header">
        <span className="brand">☀️ Solar</span>
        <span className={`solar-status-pill ${enabled ? 'active' : ''}`}>
          {enabled ? (isAuto ? 'Auto' : 'Manual') : 'Off'}
        </span>
      </header>

      {/* Live status */}
      {status && (
        <div className="solar-status-card">
          <StatusBar label="Solar Production" value={status.solarKw}    max={MAX} color="#f59e0b" />
          <StatusBar label="House Load"        value={cfg.houseKw || 0}  max={MAX} color="#6b7280" />
          <StatusBar label="Available for EV"  value={status.availableKw} max={MAX} color="#1e7c4a" />
          {status.error && <p className="solar-error">⚠ {status.error}</p>}
          {status.lastUpdate && (
            <p className="solar-last-update">
              Last update: {new Date(status.lastUpdate).toLocaleTimeString('en-MY')}
              {status.polling && ' · polling'}
            </p>
          )}
        </div>
      )}

      {/* Mode toggle */}
      <div className="section-title">Mode</div>
      <div className="solar-mode-row">
        <button
          className={`solar-mode-btn ${!isAuto ? 'active' : ''}`}
          onClick={() => set('mode', 'manual')}
        >Manual</button>
        <button
          className={`solar-mode-btn ${isAuto ? 'active' : ''}`}
          onClick={() => set('mode', 'auto')}
        >Auto (Inverter)</button>
      </div>

      {/* Manual controls */}
      {!isAuto && (
        <>
          <div className="section-title">Available Solar Power</div>
          <div className="solar-slider-card">
            <div className="solar-slider-labels">
              <span>0 kW</span>
              <span className="solar-slider-val">{fmt(draft.manualKw)} kW</span>
              <span>{MAX} kW</span>
            </div>
            <input
              type="range" min={0} max={MAX} step={0.5}
              value={draft.manualKw || 0}
              onChange={e => set('manualKw', Number(e.target.value))}
              className="solar-slider"
            />
            <div className="section-title" style={{ padding: '16px 0 6px' }}>House Consumption Offset</div>
            <div className="solar-input-row">
              <input
                type="number" min={0} max={MAX} step={0.1}
                value={draft.houseKw || 0}
                onChange={e => set('houseKw', Number(e.target.value))}
                className="solar-input"
              />
              <span className="solar-input-unit">kW</span>
            </div>
            <p className="solar-hint">
              EV limit = {fmt((draft.manualKw || 0) - (draft.houseKw || 0))} kW
            </p>
          </div>
          <div className="solar-actions">
            <button className="action-btn start" disabled={applying} onClick={handleApplyManual}>
              {applying ? 'Applying…' : 'Apply Limit'}
            </button>
            <button className="solar-clear-btn" onClick={handleClear}>Clear Limit</button>
          </div>
        </>
      )}

      {/* Auto controls */}
      {isAuto && (
        <>
          <div className="section-title">Inverter API</div>
          <div className="ctrl-card">
            <div className="ctrl-row">
              <span>URL</span>
              <input
                className="solar-text-input"
                placeholder="http://192.168.1.x/api/power"
                value={draft.autoUrl || ''}
                onChange={e => set('autoUrl', e.target.value)}
              />
            </div>
            <div className="ctrl-row">
              <span>JSON field</span>
              <input
                className="solar-text-input"
                placeholder="Body.Site.P_PV"
                value={draft.autoField || ''}
                onChange={e => set('autoField', e.target.value)}
              />
            </div>
            <div className="ctrl-row">
              <span>Unit</span>
              <div className="solar-unit-toggle">
                <button className={draft.autoUnit === 'W'  ? 'active' : ''} onClick={() => set('autoUnit', 'W')}>W</button>
                <button className={draft.autoUnit === 'kW' ? 'active' : ''} onClick={() => set('autoUnit', 'kW')}>kW</button>
              </div>
            </div>
            <div className="ctrl-row">
              <span>Poll every</span>
              <div className="solar-input-row">
                <input
                  type="number" min={10} max={300}
                  value={draft.autoInterval || 30}
                  onChange={e => set('autoInterval', Number(e.target.value))}
                  className="solar-input"
                />
                <span className="solar-input-unit">sec</span>
              </div>
            </div>
            <div className="ctrl-row">
              <span>House offset</span>
              <div className="solar-input-row">
                <input
                  type="number" min={0} max={MAX} step={0.1}
                  value={draft.houseKw || 0}
                  onChange={e => set('houseKw', Number(e.target.value))}
                  className="solar-input"
                />
                <span className="solar-input-unit">kW</span>
              </div>
            </div>
          </div>

          <div className="solar-actions">
            <button
              className="action-btn start"
              disabled={saving || !draft.autoUrl}
              onClick={() => { set('enabled', true); handleSaveConfig(); }}
            >
              {saving ? 'Saving…' : cfg.enabled && isAuto ? 'Update & Restart' : 'Start Auto'}
            </button>
            <button className="solar-clear-btn" onClick={handleClear}>Stop & Clear</button>
          </div>

          <div className="solar-hint-card">
            <p className="solar-hint">
              The backend polls your inverter URL and automatically sends SetChargingProfile to limit the charger to available solar power.
            </p>
            <p className="solar-hint" style={{ marginTop: 6 }}>
              <strong>Fronius:</strong> field = <code>Body.Site.P_PV</code>, unit = W<br />
              <strong>Custom:</strong> whatever field your inverter returns
            </p>
          </div>
        </>
      )}
    </div>
  );
}
