'use strict';

/**
 * Cloud Bridge — publishes RPi OCPP events to an MQTT broker and
 * subscribes to commands from the cloud operator dashboard.
 *
 * Environment variables (.env):
 *   MQTT_URL       = mqtts://xxxx.emqx.cloud:8883   (required to enable)
 *   MQTT_USERNAME  = your-mqtt-username
 *   MQTT_PASSWORD  = your-mqtt-password
 *   MQTT_SITE_ID   = SITE001   (unique ID for this RPi / location)
 *
 * Topics published (RPi → Cloud):
 *   cpms/{siteId}/status           retain — online/offline (LWT)
 *   cpms/{siteId}/charger/status   retain — charger state + kW
 *   cpms/{siteId}/session/started  — new session
 *   cpms/{siteId}/session/stopped  — session ended
 *   cpms/{siteId}/meter            — live kW + phase readings
 *   cpms/{siteId}/boot             — charger BootNotification info
 *   cpms/{siteId}/fault            — charger fault/error
 *
 * Topics subscribed (Cloud → RPi):
 *   cpms/{siteId}/cmd/start        — RemoteStartTransaction
 *   cpms/{siteId}/cmd/stop         — RemoteStopTransaction
 *   cpms/{siteId}/cmd/profile      — SetChargingProfile payload
 *   cpms/{siteId}/cmd/clear        — ClearChargingProfile
 *   cpms/{siteId}/cmd/reset        — Reset (Soft/Hard)
 */

const mqtt = require('mqtt');

const SITE_ID       = process.env.MQTT_SITE_ID    || 'SITE001';
const MQTT_URL      = process.env.MQTT_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;

const topic = (path) => `cpms/${SITE_ID}/${path}`;

let client          = null;
let commandHandler  = null; // (action, payload) => void
let enabled         = false;

// ── Init ──────────────────────────────────────────────────────────────────────

function init(onCommand) {
  if (!MQTT_URL) {
    console.log('[cloud-bridge] MQTT_URL not set — cloud sync disabled');
    return;
  }

  enabled        = true;
  commandHandler = onCommand;

  client = mqtt.connect(MQTT_URL, {
    username:        MQTT_USERNAME,
    password:        MQTT_PASSWORD,
    clientId:        `cpms-${SITE_ID}-${Math.random().toString(16).slice(2, 8)}`,
    clean:           false,          // persistent session — broker queues QoS1 msgs while offline
    reconnectPeriod: 5000,
    connectTimeout:  15000,
    // Last Will: broker publishes this automatically if RPi disconnects ungracefully
    will: {
      topic:   topic('status'),
      payload: JSON.stringify({ online: false, siteId: SITE_ID }),
      qos:     1,
      retain:  true,
    },
  });

  client.on('connect', () => {
    console.log(`[cloud-bridge] Connected  site=${SITE_ID}`);

    // Announce online
    pub('status', { online: true, siteId: SITE_ID }, { retain: true });

    // Subscribe to cloud commands
    const subs = [
      topic('cmd/start'),
      topic('cmd/stop'),
      topic('cmd/profile'),
      topic('cmd/clear'),
      topic('cmd/reset'),
    ];
    client.subscribe(subs, { qos: 1 }, (err) => {
      if (err) console.error('[cloud-bridge] Subscribe error:', err.message);
    });
  });

  client.on('message', (t, buf) => {
    try {
      const payload = JSON.parse(buf.toString());
      handleIncoming(t, payload);
    } catch (e) {
      console.error('[cloud-bridge] Bad message on', t, e.message);
    }
  });

  client.on('reconnect',   () => console.log('[cloud-bridge] Reconnecting…'));
  client.on('offline',     () => console.log('[cloud-bridge] Offline'));
  client.on('error', (err) => console.error('[cloud-bridge] Error:', err.message));
}

// ── Internal publish ──────────────────────────────────────────────────────────

function pub(path, payload, opts = {}) {
  if (!client?.connected) return;
  client.publish(topic(path), JSON.stringify(payload), { qos: 1, ...opts }, (err) => {
    if (err) console.error('[cloud-bridge] Publish error:', err.message);
  });
}

// ── Handle incoming cloud commands ────────────────────────────────────────────

function handleIncoming(t, payload) {
  if (!commandHandler) return;
  const cmd = t.split('/').pop(); // last segment: start | stop | profile | clear | reset
  console.log(`[cloud-bridge] ← cmd:${cmd}`, payload);

  const actionMap = {
    start:   ['RemoteStartTransaction', payload],
    stop:    ['RemoteStopTransaction',  payload],
    profile: ['SetChargingProfile',     payload],
    clear:   ['ClearChargingProfile',   payload ?? {}],
    reset:   ['Reset',                  payload ?? { type: 'Soft' }],
  };

  const entry = actionMap[cmd];
  if (entry) commandHandler(...entry);
  else console.warn('[cloud-bridge] Unknown command:', cmd);
}

// ── Public event publishers ───────────────────────────────────────────────────

function publishChargerStatus(charger, connectionState) {
  if (!enabled) return;
  pub('charger/status', {
    siteId:          SITE_ID,
    chargerId:       charger.id,
    station:         charger.station,
    status:          charger.status,   // idle | active | fault
    kw:              charger.kw,
    maxKw:           charger.maxKw,
    connectionState,                   // connected | disconnected
    ts:              new Date().toISOString(),
  }, { retain: true });
}

function publishSessionStarted(session) {
  if (!enabled) return;
  pub('session/started', {
    siteId:        SITE_ID,
    sessionId:     session.id,
    transactionId: session.transactionId,
    idTag:         session.idTag,
    connectorId:   session.connectorId,
    startedAt:     session.startedAt,
    ts:            new Date().toISOString(),
  });
}

function publishSessionStopped(session) {
  if (!enabled) return;
  pub('session/stopped', {
    siteId:        SITE_ID,
    sessionId:     session.id,
    transactionId: session.transactionId,
    energyKwh:     session.energyKwh,
    amount:        session.amount,
    stopReason:    session.stopReason,
    startedAt:     session.startedAt,
    ts:            new Date().toISOString(),
  });
}

function publishMeter(chargerId, meter) {
  if (!enabled) return;
  pub('meter', {
    siteId: SITE_ID,
    chargerId,
    ...meter,
    ts: new Date().toISOString(),
  });
}

function publishBoot(ocppIdentity, bootPayload) {
  if (!enabled) return;
  pub('boot', {
    siteId:       SITE_ID,
    ocppIdentity,
    vendor:       bootPayload.chargePointVendor,
    model:        bootPayload.chargePointModel,
    firmware:     bootPayload.firmwareVersion,
    serial:       bootPayload.chargePointSerialNumber,
    ts:           new Date().toISOString(),
  });
}

function publishFault(chargerId, errorCode, info) {
  if (!enabled) return;
  pub('fault', {
    siteId: SITE_ID,
    chargerId,
    errorCode,
    info,
    ts: new Date().toISOString(),
  });
}

module.exports = {
  init,
  publishChargerStatus,
  publishSessionStarted,
  publishSessionStopped,
  publishMeter,
  publishBoot,
  publishFault,
};
