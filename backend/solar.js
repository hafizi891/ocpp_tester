'use strict';

const http  = require('http');
const https = require('https');

const DEFAULTS = {
  mode:         'manual',
  manualKw:     0,
  autoUrl:      '',
  autoField:    'power',
  autoUnit:     'W',
  autoInterval: 30,
  houseKw:      0,
  enabled:      false,
};

let cfg       = { ...DEFAULTS };
let status    = { solarKw: 0, availableKw: 0, lastUpdate: null, error: null, polling: false };
let pollTimer = null;
let onApply   = null;

function getConfig() { return { ...cfg }; }
function getStatus() { return { ...status }; }

function init(applyFn) { onApply = applyFn; }

function updateConfig(partial) {
  cfg = { ...cfg, ...partial };
  if (cfg.mode === 'auto' && cfg.enabled && cfg.autoUrl) {
    startPolling();
  } else {
    stopPolling();
    if (cfg.mode === 'manual' && cfg.enabled) apply(cfg.manualKw);
  }
  return getConfig();
}

function setManual(kw) {
  cfg.manualKw = Number(kw) || 0;
  if (cfg.mode === 'manual' && cfg.enabled) apply(cfg.manualKw);
  return getStatus();
}

function clearLimit() {
  cfg.enabled = false;
  stopPolling();
  status = { ...status, solarKw: 0, availableKw: 0 };
  if (onApply) onApply(null);
}

function apply(solarKw) {
  const available = Math.max(0, solarKw - (cfg.houseKw || 0));
  status = {
    solarKw,
    availableKw: available,
    lastUpdate:  new Date().toISOString(),
    error:       null,
    polling:     cfg.mode === 'auto' && Boolean(pollTimer),
  };
  if (onApply) onApply(available);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 8000 }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from inverter')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Inverter request timeout')); });
  });
}

async function poll() {
  if (!cfg.autoUrl) return;
  try {
    const data  = await fetchJson(cfg.autoUrl);
    const parts = (cfg.autoField || 'power').split('.');
    let value   = data;
    for (const p of parts) value = value?.[p];
    let kw = Number(value) || 0;
    if (cfg.autoUnit === 'W') kw = kw / 1000;
    apply(kw);
  } catch (err) {
    status = { ...status, error: err.message, lastUpdate: new Date().toISOString() };
  }
}

function startPolling() {
  stopPolling();
  status.polling = true;
  poll();
  pollTimer = setInterval(poll, Math.max(10, cfg.autoInterval || 30) * 1000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  status.polling = false;
}

module.exports = { getConfig, getStatus, init, updateConfig, setManual, clearLimit };
