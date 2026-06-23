/**
 * OCPP 1.6J charger simulator — for testing without a real car/charger.
 *
 * Usage (from backend/ folder):
 *   node simulate-charger.js [charger-id] [ocpp-url]
 *
 * Examples:
 *   node simulate-charger.js
 *   node simulate-charger.js MYSIM001
 *   OCPP_URL=ws://192.168.4.1:3001/ocpp node simulate-charger.js
 *
 * Keyboard commands while running:
 *   s  — start a charging session (simulates car plug-in)
 *   e  — end the session (simulates car unplug / user stop)
 *   m  — send a MeterValues update now
 *   q  — quit
 */

const WebSocket = require('ws');
const readline  = require('readline');

const CHARGER_ID   = process.argv[2] || 'TESTSIM001';
const BASE_URL     = process.env.OCPP_URL || 'ws://localhost:3001/ocpp';
const FULL_URL     = `${BASE_URL}/${CHARGER_ID}`;
const METER_TICK_MS = 15000; // send MeterValues every 15 s during session

let ws;
let msgCounter    = 1;
let transactionId = null; // set by server in StartTransaction response
let meterWh       = 0;
let meterTimer    = null;
let pendingCalls  = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextId() { return `sim-${msgCounter++}`; }

function call(action, payload) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pendingCalls.set(id, { resolve, reject });
    const frame = JSON.stringify([2, id, action, payload]);
    ws.send(frame);
    console.log(`\x1b[36m→ [${action}]\x1b[0m`, JSON.stringify(payload));
    // timeout after 10 s
    setTimeout(() => {
      if (pendingCalls.has(id)) {
        pendingCalls.delete(id);
        reject(new Error(`${action} timed out`));
      }
    }, 10000);
  });
}

function respond(id, payload) {
  ws.send(JSON.stringify([3, id, payload]));
}

// ── Session management ────────────────────────────────────────────────────────

async function startSession(reason = 'manual') {
  if (transactionId !== null) {
    console.log('Already in a session (txId=' + transactionId + ')');
    return;
  }

  try {
    await call('StatusNotification', {
      connectorId: 1, errorCode: 'NoError', status: 'Preparing',
      timestamp: new Date().toISOString(),
    });

    const res = await call('StartTransaction', {
      connectorId: 1,
      idTag:       'GUEST',
      meterStart:  meterWh,
      timestamp:   new Date().toISOString(),
    });

    if (res.idTagInfo?.status !== 'Accepted') {
      console.log(`\x1b[31mStartTransaction rejected by server (idTag not accepted)\x1b[0m`);
      await call('StatusNotification', {
        connectorId: 1, errorCode: 'NoError', status: 'Available',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    transactionId = res.transactionId;
    console.log(`\x1b[32mSession started  txId=${transactionId}  (triggered by: ${reason})\x1b[0m`);

    await call('StatusNotification', {
      connectorId: 1, errorCode: 'NoError', status: 'Charging',
      timestamp: new Date().toISOString(),
    });

    // periodic meter ticks
    meterTimer = setInterval(() => sendMeter(), METER_TICK_MS);

  } catch (err) {
    console.error('startSession error:', err.message);
  }
}

async function stopSession(reason = 'Local') {
  if (transactionId === null) {
    console.log('No active session');
    return;
  }

  clearInterval(meterTimer);
  meterTimer = null;

  const txId = transactionId;
  transactionId = null;

  try {
    await call('StopTransaction', {
      transactionId: txId,
      meterStop:     meterWh,
      reason,
      timestamp:     new Date().toISOString(),
    });

    await call('StatusNotification', {
      connectorId: 1, errorCode: 'NoError', status: 'Available',
      timestamp: new Date().toISOString(),
    });

    console.log(`\x1b[33mSession stopped  txId=${txId}  reason=${reason}\x1b[0m`);

  } catch (err) {
    console.error('stopSession error:', err.message);
    transactionId = null; // reset anyway
  }
}

async function sendMeter() {
  if (transactionId === null) return;
  meterWh += 500; // +0.5 kWh per tick (≈ 2 kW average over 15 s)
  try {
    await call('MeterValues', {
      connectorId:   1,
      transactionId,
      meterValue: [{
        timestamp:    new Date().toISOString(),
        sampledValue: [
          { value: String(meterWh), unit: 'Wh',  measurand: 'Energy.Active.Import.Register', context: 'Sample.Periodic' },
          { value: '2000',          unit: 'W',   measurand: 'Power.Active.Import',            context: 'Sample.Periodic' },
        ],
      }],
    });
  } catch (err) {
    console.error('sendMeter error:', err.message);
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  console.log(`Connecting  ${FULL_URL}`);
  ws = new WebSocket(FULL_URL, ['ocpp1.6']);

  ws.on('open', async () => {
    console.log(`\x1b[32mConnected\x1b[0m  id=${CHARGER_ID}`);

    try {
      await call('BootNotification', {
        chargePointVendor: 'SimVendor',
        chargePointModel:  'SIM-100',
        chargePointSerialNumber: CHARGER_ID,
        firmwareVersion:   '1.0.0',
      });

      // Report connectors
      await call('StatusNotification', {
        connectorId: 0, errorCode: 'NoError', status: 'Available',
        timestamp: new Date().toISOString(),
      });
      await call('StatusNotification', {
        connectorId: 1, errorCode: 'NoError', status: 'Available',
        timestamp: new Date().toISOString(),
      });

      console.log('\n\x1b[1mReady.\x1b[0m  Press \x1b[1ms\x1b[0m = start  \x1b[1me\x1b[0m = end  \x1b[1mm\x1b[0m = meter  \x1b[1mq\x1b[0m = quit\n');
    } catch (err) {
      console.error('Boot sequence error:', err.message);
    }
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const [type, id, thirdArg, payload] = msg;

    if (type === 3) {
      // CALLRESULT — response to our call
      const pending = pendingCalls.get(id);
      if (pending) {
        pendingCalls.delete(id);
        pending.resolve(thirdArg); // thirdArg is the response payload
      }
      console.log(`\x1b[35m← [RESULT ${id}]\x1b[0m`, JSON.stringify(thirdArg));

    } else if (type === 2) {
      // CALL from server — a command
      const action = thirdArg;
      console.log(`\x1b[33m← [${action}]\x1b[0m`, JSON.stringify(payload));

      if (action === 'RemoteStartTransaction') {
        respond(id, { status: 'Accepted' });
        console.log('→ RemoteStartTransaction: Accepted');
        setTimeout(() => startSession('RemoteStart'), 500);

      } else if (action === 'RemoteStopTransaction') {
        if (payload.transactionId === transactionId) {
          respond(id, { status: 'Accepted' });
          console.log('→ RemoteStopTransaction: Accepted');
          setTimeout(() => stopSession('Remote'), 500);
        } else {
          respond(id, { status: 'Rejected' });
          console.log(
            `\x1b[31m→ RemoteStopTransaction: Rejected\x1b[0m` +
            `  (server sent txId=${payload.transactionId}, active=${transactionId})`
          );
        }

      } else if (action === 'SetChargingProfile') {
        respond(id, { status: 'Accepted' });
        const limit = payload?.csChargingProfiles?.chargingSchedule?.chargingSchedulePeriod?.[0]?.limit;
        if (limit != null) console.log(`  Charging limit set: ${limit} W`);

      } else if (action === 'ClearChargingProfile') {
        respond(id, { status: 'Accepted' });
        console.log('  Charging profile cleared');

      } else if (action === 'GetConfiguration') {
        respond(id, { configurationKey: [], unknownKey: payload?.key || [] });

      } else if (action === 'ChangeConfiguration') {
        respond(id, { status: 'Accepted' });

      } else if (action === 'Reset') {
        respond(id, { status: 'Accepted' });
        console.log(`  Reset requested (${payload?.type}) — reconnecting in 2 s`);
        setTimeout(() => { ws.close(); setTimeout(connect, 2000); }, 500);

      } else if (action === 'UnlockConnector') {
        respond(id, { status: 'Unlocked' });

      } else if (action === 'GetDiagnostics') {
        respond(id, { fileName: '' });

      } else if (action === 'TriggerMessage') {
        respond(id, { status: 'Accepted' });

      } else {
        respond(id, {});
      }

    } else if (type === 4) {
      // CALLERROR
      const pending = pendingCalls.get(id);
      if (pending) {
        pendingCalls.delete(id);
        pending.reject(new Error(`${thirdArg}: ${JSON.stringify(payload)}`));
      }
      console.log(`\x1b[31m← [CALLERROR ${id}]\x1b[0m`, thirdArg, JSON.stringify(payload));
    }
  });

  ws.on('close', () => {
    console.log('Disconnected');
    clearInterval(meterTimer);
    meterTimer = null;
    transactionId = null;
  });

  ws.on('error', err => console.error('WS error:', err.message));
}

// ── Keyboard input ────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.on('data', key => {
  if (key === 'q' || key === '') { ws?.close(); process.exit(0); }
  if (key === 's') startSession('manual');
  if (key === 'e') stopSession('Local');
  if (key === 'm') sendMeter();
});

connect();
