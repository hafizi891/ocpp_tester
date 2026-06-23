'use strict';

require('dotenv').config();

const express             = require('express');
const http                = require('http');
const fs                  = require('fs');
const path                = require('path');

// ── RPi ACT LED indicator ─────────────────────────────────────────────────
const LED_PATH    = '/sys/class/leds/ACT/brightness';
const LED_TRIGGER = '/sys/class/leds/ACT/trigger';
function setLed(on) {
  try {
    fs.writeFileSync(LED_TRIGGER, 'none');
    fs.writeFileSync(LED_PATH, on ? '1' : '0');
  } catch (_) {}  // silently ignored on non-RPi
}
const { Server }          = require('socket.io');
const { WebSocketServer } = require('ws');
const cors                = require('cors');

const pool    = require('./db/pool');
const queries = require('./db/queries');
const solar   = require('./solar');

// ── Configuration ─────────────────────────────────────────────────────────
const FRONTEND_ORIGIN         = process.env.FRONTEND_ORIGIN         || 'http://localhost:5173';
const PORT                    = Number(process.env.PORT              || 3001);
const MSG_HISTORY_LIMIT       = Number(process.env.MSG_HISTORY_LIMIT       || 80);
const CMD_BUFFER_LIMIT        = Number(process.env.CMD_BUFFER_LIMIT        || 120);
const MSG_BUFFER_LIMIT        = Number(process.env.MSG_BUFFER_LIMIT        || 200);
const DEFAULT_CHARGER_MAX_KW  = Number(process.env.DEFAULT_CHARGER_MAX_KW  || 22);
const OCPP_HEARTBEAT_INTERVAL = Number(process.env.OCPP_HEARTBEAT_INTERVAL || 30);
const TARIFF_PER_KWH          = Number(process.env.TARIFF_PER_KWH          || 0);
const OCPP_OPEN_AUTH          = process.env.OCPP_OPEN_AUTH !== 'false'; // true = accept unknown tags
const MSG_DB_RETENTION        = process.env.MSG_DB_RETENTION               || '7d';
// ─────────────────────────────────────────────────────────────────────────

const app        = express();
const server     = http.createServer(app);
const io         = new Server(server, {
  cors: { origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'] },
});
const ocppServer = new WebSocketServer({ noServer: true });

// ── Static operator config ────────────────────────────────────────────────
const DATA_DIR         = path.join(__dirname, 'data');
const OCPP_CONFIG_FILE = path.join(DATA_DIR, 'ocpp-config.json');

function loadOcppConfig() {
  try {
    return JSON.parse(fs.readFileSync(OCPP_CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
  } catch {
    return { commandPayloads: {}, protocol: 'ocpp1.6' };
  }
}

const ocppConfig = loadOcppConfig();

// ── In-memory cache (write-through to PostgreSQL) ─────────────────────────
let chargers     = [];
let sessions     = [];
let hourlyEnergy = new Array(24).fill(0);
let ocppMessages = [];
let ocppCommands = [];
const ocppConnections = new Map();

// ── Express middleware ────────────────────────────────────────────────────
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

// ── REST API — chargers & sessions ────────────────────────────────────────
app.get('/api/chargers',        (_req, res) => res.json(chargers));
app.get('/api/sessions',        (_req, res) => res.json(sessions));
app.get('/api/energy/hourly',   (_req, res) => res.json(hourlyPayload()));

app.post('/api/sessions/:id/force-close', async (req, res) => {
  const sid     = isNaN(req.params.id) ? req.params.id : Number(req.params.id);
  const session = sessions.find(s => s.id === sid);
  if (!session)                     return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'charging') return res.status(400).json({ error: 'Session not active' });
  try {
    session.status    = 'completed';
    session.stopReason = 'Local';
    await queries.updateSessionOnStop(pool, session.id, {
      status: 'completed', energyKwh: session.energyKwh,
      amount: session.amount, meterStop: null, stopReason: 'Local',
    });
    const charger = findCharger(session.chargerId);
    if (charger) {
      charger.status = 'idle';
      charger.kw     = 0;
      await Promise.all([
        queries.updateChargerStatus(pool, charger.id, 'idle'),
        queries.updateChargerKw(pool, charger.id, 0),
      ]);
    }
    io.emit('sessions:update', sessions);
    io.emit('chargers:update', chargers);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (_req, res) => {
  const active  = chargers.filter(c => c.status === 'active').length;
  const totalKw = sessions.reduce((s, x) => s + x.energyKwh, 0);
  const totalRv = sessions.reduce((s, x) => s + x.amount, 0);
  res.json({
    activeSessions:  sessions.filter(s => s.status === 'charging').length,
    totalKwhToday:   +totalKw.toFixed(1),
    revenueToday:    +totalRv.toFixed(2),
    availabilityPct: chargers.length ? Math.round((active / chargers.length) * 100) : 0,
    offlineCount:    chargers.filter(c => c.status !== 'active').length,
  });
});

// ── REST API — ID tags ────────────────────────────────────────────────────
app.get('/api/id-tags', async (_req, res) => {
  try { res.json(await queries.listIdTags(pool)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/id-tags', async (req, res) => {
  const { idTag, status, expiryDate, parentIdTag, note } = req.body || {};
  if (!idTag) return res.status(400).json({ error: 'idTag is required' });
  try {
    await queries.upsertIdTag(pool, { idTag, status, expiryDate, parentIdTag, note });
    res.status(201).json({ idTag });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/id-tags/:id', async (req, res) => {
  try {
    await queries.upsertIdTag(pool, { idTag: req.params.id, ...req.body });
    res.json({ idTag: req.params.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/id-tags/:id', async (req, res) => {
  try {
    await queries.deleteIdTag(pool, req.params.id);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── REST API — OCPP ───────────────────────────────────────────────────────
app.get('/api/ocpp/config', (_req, res) => {
  res.json({
    protocol:                process.env.OCPP_PROTOCOL || ocppConfig.protocol,
    gatewayEndpointTemplate: process.env.OCPP_WS_ENDPOINT      || ocppConfig.gatewayEndpointTemplate || '',
    baseGatewayEndpoint:     process.env.OCPP_BASE_WS_ENDPOINT || ocppConfig.baseGatewayEndpoint     || '',
    identitySources:         ['path', 'query', 'basicAuthUsername', 'x-charge-point-id', 'bootNotificationSerial'],
    commandActions:          Object.keys(ocppConfig.commandPayloads || {}),
  });
});

app.get('/api/ocpp/architecture', (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ocpp-architecture.json'), 'utf8')));
  } catch { res.json([]); }
});

app.get('/api/ocpp/charge-points', (_req, res) => res.json(chargers.map(toOcppChargePoint)));
app.get('/api/ocpp/messages',      (_req, res) => res.json(ocppMessages.slice(-MSG_HISTORY_LIMIT).reverse()));
app.get('/api/ocpp/commands',      (_req, res) => res.json(ocppCommands.slice(-MSG_HISTORY_LIMIT).reverse()));

// ── System logs ───────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const lines = Math.min(200, parseInt(req.query.lines) || 80);
  const os    = require('os');
  const home  = process.env.HOME || os.homedir();
  const logFile = `${home}/.pm2/logs/backend-out.log`;
  const errFile = `${home}/.pm2/logs/backend-error.log`;
  const { execSync } = require('child_process');
  try {
    const out = execSync(`tail -n ${lines} "${logFile}" 2>/dev/null || echo ''`).toString();
    const err = execSync(`tail -n 20 "${errFile}" 2>/dev/null || echo ''`).toString();
    res.json({ out: out.trim(), err: err.trim() });
  } catch (_) {
    res.json({ out: '', err: 'Log file not found' });
  }
});

// ── Solar power management ────────────────────────────────────────────────
app.get ('/api/solar/config', (_req, res) => res.json(solar.getConfig()));
app.post('/api/solar/config', (req, res)  => res.json(solar.updateConfig(req.body)));
app.get ('/api/solar/status', (_req, res) => res.json(solar.getStatus()));
app.post('/api/solar/manual', (req, res)  => res.json(solar.setManual(req.body?.kw)));
app.post('/api/solar/clear',  (_req, res) => { solar.clearLimit(); res.json({ ok: true }); });

app.post('/api/ocpp/charge-points/:id/commands', async (req, res) => {
  const charger = findCharger(req.params.id);
  if (!charger) return res.status(404).json({ error: 'Unknown charge point' });

  const action = req.body?.action || Object.keys(ocppConfig.commandPayloads || {})[0];
  if (!action) return res.status(400).json({ error: 'No OCPP command actions configured' });

  const payload = req.body?.payload || defaultCommandPayload(action);
  const command = createOcppCommand(charger.ocppIdentity, action, payload);
  deliverCommand(command);

  return res.status(202).json(command);
});

// ── Socket.IO ─────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`Client connected ${socket.id}`);
  socket.emit('chargers:update', chargers);
  socket.emit('sessions:update', sessions);
  socket.emit('ocpp:chargePoints:update', chargers.map(toOcppChargePoint));
  socket.emit('ocpp:messages:update', ocppMessages.slice(-MSG_HISTORY_LIMIT).reverse());
  socket.emit('ocpp:commands:update', ocppCommands.slice(-MSG_HISTORY_LIMIT).reverse());
  socket.on('disconnect', () => console.log(`Client disconnected ${socket.id}`));
});

// ── OCPP WebSocket ────────────────────────────────────────────────────────
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (!isOcppPath(url.pathname)) { socket.destroy(); return; }
  const requestedIdentity = resolveOcppIdentityFromRequest(request, url);
  ocppServer.handleUpgrade(request, socket, head, ws => {
    ocppServer.emit('connection', ws, request, requestedIdentity);
  });
});

ocppServer.on('connection', async (ws, request, requestedIdentity) => {
  const initialIdentity   = requestedIdentity || createAnonymousIdentity();
  ws.cpmsIdentity         = initialIdentity;
  ws.cpmsIdentitySource   = requestedIdentity ? 'connection' : 'anonymous';
  await registerOcppConnection(initialIdentity, ws, { anonymous: !requestedIdentity });

  ws.on('message', raw => {
    handleOcppMessage(ws.cpmsIdentity, ws, raw)
      .catch(err => console.error(`OCPP [${ws.cpmsIdentity}]:`, err.message));
  });
  ws.on('close', () => markOcppDisconnected(ws.cpmsIdentity));
  ws.on('error', err => logOcppMessage(ws.cpmsIdentity, 'error', 'WebSocketError', { message: err.message }));
});

// ── Startup ───────────────────────────────────────────────────────────────
async function main() {
  const initial = await queries.loadInitialState(pool);
  chargers     = initial.chargers;
  sessions     = initial.sessions;
  hourlyEnergy = initial.hourlyEnergy;

  const [recentMessages, recentCommands] = await Promise.all([
    queries.loadRecentMessages(pool, MSG_BUFFER_LIMIT),
    queries.loadRecentCommands(pool, CMD_BUFFER_LIMIT),
  ]);
  ocppMessages = recentMessages;
  ocppCommands = recentCommands;

  solar.init((availableKw) => {
    const charger = chargers[0];
    if (!charger) return;
    if (availableKw === null) {
      const cmd = createOcppCommand(charger.ocppIdentity, 'ClearChargingProfile', { id: 1, connectorId: 1 });
      deliverCommand(cmd);
    } else {
      const limitW = Math.round(availableKw * 1000);
      const cmd = createOcppCommand(charger.ocppIdentity, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: {
          chargingProfileId:     1,
          stackLevel:            0,
          chargingProfilePurpose:'TxDefaultProfile',
          chargingProfileKind:   'Relative',
          chargingSchedule: {
            chargingRateUnit:        'W',
            chargingSchedulePeriod:  [{ startPeriod: 0, limit: limitW }],
          },
        },
      });
      deliverCommand(cmd);
    }
  });

  server.listen(PORT, () => {
    const maskedDb = (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':****@');
    console.log(`\nCPMS backend  -> http://localhost:${PORT}`);
    console.log(`OCPP endpoint -> ${process.env.OCPP_WS_ENDPOINT || '(set OCPP_WS_ENDPOINT)'}`);
    console.log(`Database      -> ${maskedDb || '(missing DATABASE_URL)'}`);
    console.log(`Open auth     -> ${OCPP_OPEN_AUTH ? 'ON (all RFID accepted)' : 'OFF (whitelist only)'}\n`);
  });

  const retentionMs = queries.parseRetentionMs(MSG_DB_RETENTION);
  setInterval(async () => {
    try {
      const result = await queries.pruneOldMessages(pool, retentionMs);
      if (result.rowCount > 0) console.log(`Pruned ${result.rowCount} expired OCPP message(s).`);
    } catch (err) {
      console.error('Message prune error:', err.message);
    }
  }, 60 * 60 * 1000);
}

main().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});

// ── OCPP message routing ──────────────────────────────────────────────────

async function handleOcppMessage(ocppIdentity, ws, raw) {
  let frame;
  try {
    frame = JSON.parse(raw.toString());
  } catch {
    logOcppMessage(ocppIdentity, 'inbound', 'InvalidJson', { raw: raw.toString() });
    return;
  }

  if (!Array.isArray(frame)) {
    logOcppMessage(ocppIdentity, 'inbound', 'InvalidFrame', { frame });
    return;
  }

  const [messageTypeId, uniqueId, actionOrPayload, payloadOrError] = frame;

  if (messageTypeId === 2) {
    await handleOcppCall(ocppIdentity, ws, uniqueId, actionOrPayload, payloadOrError || {});
    return;
  }

  if (messageTypeId === 3 || messageTypeId === 4) {
    handleOcppCommandResult(ocppIdentity, uniqueId, messageTypeId, actionOrPayload, payloadOrError);
    return;
  }

  logOcppMessage(ocppIdentity, 'inbound', 'UnsupportedMessageType', { frame });
}

async function handleOcppCall(ocppIdentity, ws, uniqueId, action, payload) {
  // Resolve identity from BootNotification if still anonymous
  if (action === 'BootNotification' && isAnonymousIdentity(ocppIdentity)) {
    const inferred = inferIdentityFromBootNotification(payload);
    ocppIdentity = migrateOcppIdentity(ws, ocppIdentity, inferred);
    if (!isAnonymousIdentity(ocppIdentity)) {
      if (!findCharger(ocppIdentity)) await addDiscoveredCharger(ocppIdentity);
      flushPendingCommands(ocppIdentity);
    }
  }

  const now  = new Date().toISOString();
  const conn = ocppConnections.get(ocppIdentity);
  if (conn) {
    conn.lastSeen    = now;
    conn.lastMessage = action;
    conn.anonymous   = isAnonymousIdentity(ocppIdentity);
    if (action === 'BootNotification') conn.lastBoot = now;
  }

  logOcppMessage(ocppIdentity, 'inbound', action, payload);

  const charger = findCharger(ocppIdentity);

  // Apply domain state changes (status, meter, diagnostics, firmware)
  if (charger) await applyOcppDomainEvent(charger, action, payload);

  // Build and send response (may include async DB work for auth/transactions)
  const response = await buildOcppResponse(action, payload, ocppIdentity, charger);
  ws.send(JSON.stringify([3, uniqueId, response]));
  logOcppMessage(ocppIdentity, 'outbound', `${action}.conf`, response);
  publishOcppState();
}

// ── OCPP response builder (async — handles all 10 inbound message types) ──

async function buildOcppResponse(action, payload, ocppIdentity, charger) {
  const now = new Date().toISOString();
  switch (action) {

    case 'BootNotification':
      return { status: 'Accepted', currentTime: now, interval: OCPP_HEARTBEAT_INTERVAL };

    case 'Heartbeat':
      return { currentTime: now };

    case 'Authorize': {
      const idTagInfo = await resolveIdTagInfo(payload.idTag);
      return { idTagInfo };
    }

    case 'StartTransaction':
      return handleStartTransaction(payload, ocppIdentity, charger);

    case 'StopTransaction':
      await handleStopTransaction(payload);
      return {};

    case 'StatusNotification':
    case 'MeterValues':
      return {};

    case 'DataTransfer':
      return { status: 'Accepted' };

    case 'DiagnosticsStatusNotification':
    case 'FirmwareStatusNotification':
      return {};

    default:
      return {};
  }
}

// ── OCPP domain events ────────────────────────────────────────────────────

async function applyOcppDomainEvent(charger, action, payload) {
  if (action === 'StatusNotification') {
    const raw    = String(payload.status || '').toLowerCase();
    const status = raw.includes('fault') ? 'fault' : raw.includes('charging') ? 'active' : 'idle';
    charger.status = status;
    await queries.updateChargerStatus(pool, charger.id, status);
  }

  if (action === 'MeterValues') {
    const samples = payload.meterValue?.[0]?.sampledValue || [];
    // Prefer Power.Active.Import (W), fall back to Current.Import L1 × Voltage L1-N
    const powerSv   = samples.find(s => s.measurand === 'Power.Active.Import');
    const currentSv = samples.find(s => s.measurand === 'Current.Import' && (!s.phase || s.phase === 'L1'));
    const voltageSv = samples.find(s => s.measurand === 'Voltage' && (!s.phase || s.phase === 'L1-N'));

    let kw = null;
    if (powerSv) {
      kw = Number(powerSv.value) / 1000;
    } else if (currentSv && voltageSv) {
      kw = (Number(currentSv.value) * Number(voltageSv.value)) / 1000;
    }

    if (kw !== null && !Number.isNaN(kw)) {
      kw = Math.min(charger.maxKw, Math.max(0, Math.round(kw * 10) / 10));
      charger.kw = kw;
      await queries.updateChargerKw(pool, charger.id, kw);
    }
  }

  if (action === 'DiagnosticsStatusNotification') {
    queries.logOcppEvent(pool, charger.id, 'diagnostics_status', payload.status, payload)
      .catch(err => console.error('logOcppEvent:', err.message));
  }

  if (action === 'FirmwareStatusNotification') {
    queries.logOcppEvent(pool, charger.id, 'firmware_status', payload.status, payload)
      .catch(err => console.error('logOcppEvent:', err.message));
  }
}

// ── StartTransaction ──────────────────────────────────────────────────────

async function handleStartTransaction(payload, ocppIdentity, charger) {
  const { connectorId = 1, idTag, meterStart = 0 } = payload;
  // Keep within 32-bit signed int range — some charger firmware (xMiles etc.) truncates larger values
  const transactionId = Date.now() & 0x7FFFFFFF;
  const idTagInfo     = await resolveIdTagInfo(idTag);

  if (idTagInfo.status === 'Accepted' && charger) {
    try {
      const startedAt = new Date().toISOString();

      const newSession = await queries.insertSession(pool, {
        chargerId: charger.id,
        user:      idTag || 'Unknown',
        startedAt,
        energyKwh: 0,
        amount:    0,
        status:    'charging',
        transactionId,
        idTag,
        connectorId,
        meterStart,
      });

      sessions  = [...sessions, newSession];
      charger.status = 'active';
      charger.kw     = 0;
      await queries.updateChargerStatus(pool, charger.id, 'active');

      io.emit('sessions:update', sessions);
    } catch (err) {
      console.error('StartTransaction DB error:', err.message);
    }
  }

  return { transactionId, idTagInfo };
}

// ── StopTransaction ───────────────────────────────────────────────────────

async function handleStopTransaction(payload) {
  const { transactionId, meterStop, reason = 'Local' } = payload;

  const session = sessions.find(s => s.transactionId === transactionId);
  if (!session) {
    console.warn(`StopTransaction: no session for transactionId ${transactionId}`);
    return;
  }

  const energyKwh = (meterStop != null && session.meterStart != null)
    ? +((meterStop - session.meterStart) / 1000).toFixed(3)
    : session.energyKwh;

  const amount = TARIFF_PER_KWH > 0
    ? +(energyKwh * TARIFF_PER_KWH).toFixed(3)
    : session.amount;

  try {
    session.status     = 'completed';
    session.energyKwh  = energyKwh;
    session.amount     = amount;
    session.meterStop  = meterStop ?? null;
    session.stopReason = reason;

    await queries.updateSessionOnStop(pool, session.id, {
      status: 'completed', energyKwh, amount,
      meterStop: meterStop ?? null, stopReason: reason,
    });

    const charger = findCharger(session.chargerId);
    if (charger) {
      charger.status = 'idle';
      charger.kw     = 0;
      await Promise.all([
        queries.updateChargerStatus(pool, charger.id, 'idle'),
        queries.updateChargerKw(pool, charger.id, 0),
      ]);
    }

    io.emit('sessions:update', sessions);
  } catch (err) {
    console.error('StopTransaction DB error:', err.message);
  }
}

// ── ID tag authorization ──────────────────────────────────────────────────

async function resolveIdTagInfo(idTag) {
  if (!idTag) return { status: 'Invalid' };
  try {
    const info = await queries.getIdTagInfo(pool, idTag);
    if (info) return info;
    return OCPP_OPEN_AUTH ? { status: 'Accepted' } : { status: 'Invalid' };
  } catch (err) {
    console.error('resolveIdTagInfo:', err.message);
    return { status: 'Accepted' }; // fail open — never block charging on DB error
  }
}

// ── OCPP connection management ────────────────────────────────────────────

async function registerOcppConnection(ocppIdentity, ws, options = {}) {
  if (!options.anonymous) {
    const existing = findCharger(ocppIdentity);
    if (!existing) {
      await addDiscoveredCharger(ocppIdentity);
    } else if (existing.status !== 'fault') {
      existing.status = 'idle';
      await queries.updateChargerStatus(pool, existing.id, 'idle');
    }
  }

  ocppConnections.set(ocppIdentity, {
    ws,
    state:          'connected',
    protocol:       ws.protocol || ocppConfig.protocol || 'ocpp1.6',
    identitySource: ws.cpmsIdentitySource || 'connection',
    anonymous:      Boolean(options.anonymous),
    lastSeen:       new Date().toISOString(),
    lastBoot:       null,
    lastMessage:    'WebSocketConnect',
  });

  logOcppMessage(ocppIdentity, 'system', 'WebSocketConnect', {
    protocol:       ws.protocol || ocppConfig.protocol || 'ocpp1.6',
    identitySource: ws.cpmsIdentitySource || 'connection',
  });

  publishOcppState();
  setLed(true);
  if (!options.anonymous) flushPendingCommands(ocppIdentity);
}

function markOcppDisconnected(ocppIdentity) {
  const conn = ocppConnections.get(ocppIdentity);
  if (conn) {
    ocppConnections.set(ocppIdentity, { ...conn, ws: null, state: 'disconnected', lastMessage: 'WebSocketClose' });
  }
  logOcppMessage(ocppIdentity, 'system', 'WebSocketClose', {});
  publishOcppState();
  const anyConnected = [...ocppConnections.values()].some(c => c.state === 'connected');
  setLed(anyConnected);
}

async function addDiscoveredCharger(ocppIdentity) {
  const charger = { id: ocppIdentity, station: 'Discovered', status: 'idle',
                    kw: 0, maxKw: DEFAULT_CHARGER_MAX_KW, ocppIdentity };
  chargers = [...chargers, charger];
  await queries.upsertCharger(pool, charger);
  return charger;
}

// ── OCPP command send / result ────────────────────────────────────────────

function createOcppCommand(chargePointId, action, payload) {
  const command = {
    id:            `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ocppMessageId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    chargePointId, action, payload,
    status:    'pending',
    createdAt: new Date().toISOString(),
    sentAt:    null, responseAt: null, response: null,
  };
  ocppCommands = [...ocppCommands, command].slice(-CMD_BUFFER_LIMIT);
  queries.insertOcppCommand(pool, command)
    .catch(err => console.error('insertOcppCommand:', err.message));
  publishOcppState();
  return command;
}

function deliverCommand(command) {
  const conn = ocppConnections.get(command.chargePointId);
  if (!conn?.ws || conn.ws.readyState !== 1) return;
  conn.ws.send(JSON.stringify([2, command.ocppMessageId, command.action, command.payload]));
  command.status = 'sent';
  command.sentAt = new Date().toISOString();
  queries.markOcppCommandSent(pool, command.id, command.sentAt)
    .catch(err => console.error('markOcppCommandSent:', err.message));
  logOcppMessage(command.chargePointId, 'outbound', command.action, command.payload);
  publishOcppState();
}

function flushPendingCommands(ocppIdentity) {
  ocppCommands
    .filter(c => c.chargePointId === ocppIdentity && c.status === 'pending')
    .forEach(deliverCommand);
}

function handleOcppCommandResult(ocppIdentity, uniqueId, messageTypeId, payload, errorDetails) {
  const command = ocppCommands.find(c => c.ocppMessageId === uniqueId);
  if (!command) {
    logOcppMessage(ocppIdentity, 'inbound',
      messageTypeId === 3 ? 'CALLRESULT' : 'CALLERROR',
      { uniqueId, payload, errorDetails });
    return;
  }

  command.status     = messageTypeId === 3 ? 'accepted' : 'failed';
  command.responseAt = new Date().toISOString();
  command.response   = messageTypeId === 3 ? payload : errorDetails;

  // Handle command-specific side effects
  handleCommandResultSideEffects(command, ocppIdentity).catch(() => {});

  queries.markOcppCommandResult(pool, command.id, command.status, command.responseAt, command.response)
    .catch(err => console.error('markOcppCommandResult:', err.message));

  logOcppMessage(ocppIdentity, 'inbound',
    `${command.action}.${messageTypeId === 3 ? 'conf' : 'error'}`,
    command.response);
  publishOcppState();
}

async function handleCommandResultSideEffects(command, ocppIdentity) {
  if (command.status !== 'accepted') return;
  const charger = findCharger(ocppIdentity);

  if (command.action === 'ReserveNow' && command.response?.status === 'Accepted') {
    await queries.upsertReservation(pool, {
      reservationId: command.payload.reservationId,
      chargerId:     command.chargePointId,
      connectorId:   command.payload.connectorId,
      idTag:         command.payload.idTag,
      expiryDate:    command.payload.expiryDate,
      status:        'active',
    }).catch(err => console.error('upsertReservation:', err.message));
  }

  if (command.action === 'CancelReservation') {
    await queries.cancelReservation(pool, command.payload.reservationId)
      .catch(err => console.error('cancelReservation:', err.message));
  }

  if (command.action === 'SetChargingProfile' && command.response?.status === 'Accepted' && charger) {
    await queries.upsertChargingProfile(pool, charger.id, command.payload.connectorId, command.payload.csChargingProfiles)
      .catch(err => console.error('upsertChargingProfile:', err.message));
  }

  if (command.action === 'ClearChargingProfile' && command.response?.status === 'Accepted' && charger) {
    const p = command.payload;
    await queries.clearChargingProfiles(pool, charger.id, {
      id:          p.id,
      connectorId: p.connectorId,
      purpose:     p.chargingProfilePurpose,
      stackLevel:  p.stackLevel,
    }).catch(err => console.error('clearChargingProfiles:', err.message));
  }
}

// ── Utility ───────────────────────────────────────────────────────────────

function hourlyPayload() {
  return hourlyEnergy.map((kwh, i) => ({
    hour:  i,
    label: i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`,
    kwh,
  }));
}

function isOcppPath(pathname) {
  return pathname === '/ocpp' || pathname.startsWith('/ocpp/');
}

function resolveOcppIdentityFromRequest(request, url) {
  const pathId   = decodeURIComponent(url.pathname.replace(/^\/ocpp\/?/, '').replace(/^\/+/, '')).trim();
  const queryId  = url.searchParams.get('chargePointId') || url.searchParams.get('chargerId') || url.searchParams.get('id');
  const headerId = request.headers['x-charge-point-id'];
  const authId   = parseBasicAuthUsername(request.headers.authorization);
  return firstText(pathId, queryId, headerId, authId);
}

function parseBasicAuthUsername(authorization) {
  if (!authorization?.startsWith('Basic ')) return '';
  try {
    return Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':')[0] || '';
  } catch { return ''; }
}

function firstText(...values) {
  return values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
}

function createAnonymousIdentity() {
  return `anonymous-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isAnonymousIdentity(identity) {
  return String(identity || '').startsWith('anonymous-');
}

function inferIdentityFromBootNotification(payload) {
  return firstText(
    payload.chargePointSerialNumber,
    payload.chargeBoxSerialNumber,
    payload.meterSerialNumber,
    payload.iccid,
    payload.imsi
  );
}

function findCharger(idOrIdentity) {
  return chargers.find(c => c.id === idOrIdentity || c.ocppIdentity === idOrIdentity);
}

function toOcppChargePoint(charger) {
  const conn = ocppConnections.get(charger.ocppIdentity);
  return {
    ...charger,
    protocol:        conn?.protocol    || ocppConfig.protocol || process.env.OCPP_PROTOCOL || 'ocpp1.6',
    connectionState: conn?.state       || 'configured',
    lastSeen:        conn?.lastSeen    || null,
    lastBoot:        conn?.lastBoot    || null,
    lastMessage:     conn?.lastMessage || null,
    endpoint:        `/ocpp/${charger.ocppIdentity}`,
    baseEndpoint:    '/ocpp',
    identitySource:  conn?.identitySource || null,
    pendingCommands: ocppCommands.filter(c => c.chargePointId === charger.ocppIdentity && c.status === 'pending').length,
  };
}

function defaultCommandPayload(action) {
  return structuredClone(ocppConfig.commandPayloads?.[action] || {});
}

function migrateOcppIdentity(ws, oldIdentity, newIdentity) {
  if (!newIdentity || oldIdentity === newIdentity || !isAnonymousIdentity(oldIdentity)) return oldIdentity;
  const previous = ocppConnections.get(oldIdentity);
  if (previous) ocppConnections.delete(oldIdentity);
  ws.cpmsIdentity       = newIdentity;
  ws.cpmsIdentitySource = 'bootNotificationSerial';
  ocppConnections.set(newIdentity, {
    ...(previous || {}), ws,
    state: 'connected', anonymous: false,
    identitySource: 'bootNotificationSerial', lastMessage: 'IdentityResolved',
  });
  logOcppMessage(newIdentity, 'system', 'IdentityResolved',
    { previousIdentity: oldIdentity, source: 'bootNotificationSerial' });
  return newIdentity;
}

function logOcppMessage(chargePointId, direction, action, payload) {
  const msg = {
    id:  `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ts:  new Date().toISOString(),
    chargePointId, direction, action, payload,
  };
  ocppMessages = [...ocppMessages, msg].slice(-MSG_BUFFER_LIMIT);
  queries.insertOcppMessage(pool, msg)
    .catch(err => console.error('insertOcppMessage:', err.message));
}

function publishOcppState() {
  io.emit('chargers:update', chargers);
  io.emit('ocpp:chargePoints:update', chargers.map(toOcppChargePoint));
  io.emit('ocpp:messages:update', ocppMessages.slice(-MSG_HISTORY_LIMIT).reverse());
  io.emit('ocpp:commands:update', ocppCommands.slice(-MSG_HISTORY_LIMIT).reverse());
}
