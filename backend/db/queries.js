'use strict';

// ── Row mappers (DB snake_case → JS camelCase) ────────────────────────────

function rowToCharger(row) {
  return {
    id:           row.id,
    station:      row.station,
    status:       row.status,
    kw:           Number(row.kw),
    maxKw:        Number(row.max_kw),
    ocppIdentity: row.ocpp_identity,
  };
}

function rowToSession(row) {
  return {
    id:            Number(row.id),
    chargerId:     row.charger_id,
    user:          row.user_name,
    startedAt:     row.started_at,
    energyKwh:     Number(row.energy_kwh),
    amount:        Number(row.amount),
    status:        row.status,
    transactionId: row.transaction_id ? Number(row.transaction_id) : null,
    idTag:         row.id_tag   ?? null,
    connectorId:   row.connector_id != null ? Number(row.connector_id) : 1,
    meterStart:    row.meter_start  != null ? Number(row.meter_start)  : 0,
    meterStop:     row.meter_stop   != null ? Number(row.meter_stop)   : null,
    stopReason:    row.stop_reason  ?? null,
  };
}

function rowToCommand(row) {
  return {
    id:             row.id,
    ocppMessageId:  row.ocpp_message_id,
    chargePointId:  row.charge_point_id,
    action:         row.action,
    payload:        row.payload,
    status:         row.status,
    createdAt:      row.created_at,
    sentAt:         row.sent_at,
    responseAt:     row.response_at,
    response:       row.response,
  };
}

function rowToMessage(row) {
  return {
    id:            row.id,
    ts:            row.ts,
    chargePointId: row.charge_point_id,
    direction:     row.direction,
    action:        row.action,
    payload:       row.payload,
  };
}

function rowToIdTag(row) {
  return {
    idTag:        row.id_tag,
    status:       row.status,
    expiryDate:   row.expiry_date  ?? null,
    parentIdTag:  row.parent_id_tag ?? null,
    note:         row.note ?? '',
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function loadInitialState(pool) {
  const [chargerRes, sessionRes, hourlyRes] = await Promise.all([
    pool.query('SELECT * FROM chargers ORDER BY id'),
    pool.query('SELECT * FROM sessions ORDER BY id'),
    pool.query('SELECT kwh FROM hourly_energy ORDER BY hour'),
  ]);
  return {
    chargers:     chargerRes.rows.map(rowToCharger),
    sessions:     sessionRes.rows.map(rowToSession),
    hourlyEnergy: hourlyRes.rows.map(r => Number(r.kwh)),
  };
}

async function loadRecentMessages(pool, limit) {
  const { rows } = await pool.query(
    'SELECT * FROM ocpp_messages ORDER BY ts DESC LIMIT $1',
    [limit]
  );
  return rows.map(rowToMessage).reverse();
}

async function loadRecentCommands(pool, limit) {
  const { rows } = await pool.query(
    'SELECT * FROM ocpp_commands ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows.map(rowToCommand).reverse();
}

// ── Chargers ──────────────────────────────────────────────────────────────

async function upsertCharger(pool, c) {
  await pool.query(
    `INSERT INTO chargers (id, station, status, kw, max_kw, ocpp_identity)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       station       = EXCLUDED.station,
       status        = EXCLUDED.status,
       kw            = EXCLUDED.kw,
       max_kw        = EXCLUDED.max_kw,
       ocpp_identity = EXCLUDED.ocpp_identity,
       updated_at    = NOW()`,
    [c.id, c.station, c.status, c.kw, c.maxKw, c.ocppIdentity]
  );
}

async function updateChargerStatus(pool, id, status) {
  await pool.query(
    'UPDATE chargers SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );
}

async function updateChargerKw(pool, id, kw) {
  await pool.query(
    'UPDATE chargers SET kw = $1, updated_at = NOW() WHERE id = $2',
    [kw, id]
  );
}

async function bulkUpdateChargerKw(pool, ids, kws) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE chargers AS c
     SET kw = v.kw, updated_at = NOW()
     FROM (SELECT unnest($1::text[]) AS id, unnest($2::numeric[]) AS kw) AS v
     WHERE c.id = v.id`,
    [ids, kws]
  );
}

// ── Sessions ──────────────────────────────────────────────────────────────

async function insertSession(pool, s) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO sessions
       (charger_id, user_name, started_at, energy_kwh, amount, status,
        transaction_id, id_tag, connector_id, meter_start)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [s.chargerId, s.user || '', s.startedAt || '', s.energyKwh ?? 0, s.amount ?? 0,
     s.status || 'charging', s.transactionId ?? null, s.idTag ?? null,
     s.connectorId ?? 1, s.meterStart ?? 0]
  );
  return rowToSession(row);
}

async function updateSessionOnStop(pool, id, fields) {
  await pool.query(
    `UPDATE sessions
     SET status     = $2,
         energy_kwh = $3,
         amount     = $4,
         meter_stop  = $5,
         stop_reason = $6,
         updated_at  = NOW()
     WHERE id = $1`,
    [id, fields.status, fields.energyKwh, fields.amount,
     fields.meterStop ?? null, fields.stopReason ?? null]
  );
}

async function incrementChargingSessionEnergy(pool, energyDelta, amountDelta) {
  await pool.query(
    `UPDATE sessions
     SET energy_kwh = ROUND(energy_kwh + $1::numeric, 3),
         amount     = ROUND(amount     + $2::numeric, 3),
         updated_at = NOW()
     WHERE status = 'charging'`,
    [energyDelta, amountDelta]
  );
}

async function updateSessionStatus(pool, id, status) {
  await pool.query(
    'UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  );
}

// ── ID tags ───────────────────────────────────────────────────────────────

async function getIdTagInfo(pool, idTag) {
  if (!idTag) return null;
  const { rows } = await pool.query(
    'SELECT * FROM id_tags WHERE id_tag = $1',
    [idTag]
  );
  if (!rows.length) return null;

  const tag = rows[0];
  if (tag.expiry_date && new Date(tag.expiry_date) < new Date()) {
    return { status: 'Expired', expiryDate: tag.expiry_date };
  }

  const info = { status: tag.status };
  if (tag.expiry_date)    info.expiryDate   = tag.expiry_date;
  if (tag.parent_id_tag)  info.parentIdTag  = tag.parent_id_tag;
  return info;
}

async function listIdTags(pool) {
  const { rows } = await pool.query('SELECT * FROM id_tags ORDER BY id_tag');
  return rows.map(rowToIdTag);
}

async function upsertIdTag(pool, tag) {
  await pool.query(
    `INSERT INTO id_tags (id_tag, status, expiry_date, parent_id_tag, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id_tag) DO UPDATE SET
       status        = EXCLUDED.status,
       expiry_date   = EXCLUDED.expiry_date,
       parent_id_tag = EXCLUDED.parent_id_tag,
       note          = EXCLUDED.note,
       updated_at    = NOW()`,
    [tag.idTag, tag.status || 'Accepted', tag.expiryDate ?? null,
     tag.parentIdTag ?? null, tag.note ?? null]
  );
}

async function deleteIdTag(pool, idTag) {
  await pool.query('DELETE FROM id_tags WHERE id_tag = $1', [idTag]);
}

// ── Reservations ──────────────────────────────────────────────────────────

async function upsertReservation(pool, r) {
  await pool.query(
    `INSERT INTO reservations (reservation_id, charger_id, connector_id, id_tag, expiry_date, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (reservation_id) DO UPDATE SET
       status      = EXCLUDED.status,
       expiry_date = EXCLUDED.expiry_date`,
    [r.reservationId, r.chargerId, r.connectorId ?? 1, r.idTag, r.expiryDate, r.status ?? 'active']
  );
}

async function cancelReservation(pool, reservationId) {
  await pool.query(
    `UPDATE reservations SET status = 'cancelled' WHERE reservation_id = $1`,
    [reservationId]
  );
}

// ── OCPP event log ────────────────────────────────────────────────────────

async function logOcppEvent(pool, chargerId, eventType, status, payload) {
  await pool.query(
    `INSERT INTO ocpp_event_log (charger_id, event_type, status, payload)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [chargerId, eventType, status, JSON.stringify(payload ?? {})]
  );
}

// ── Charging profiles ─────────────────────────────────────────────────────

async function upsertChargingProfile(pool, chargerId, connectorId, profile) {
  const cp = profile.csChargingProfiles || profile;
  await pool.query(
    `INSERT INTO charging_profiles
       (charger_id, connector_id, charging_profile_id, stack_level,
        charging_profile_purpose, charging_profile_kind, recurrency_kind,
        valid_from, valid_to, schedule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (charger_id, connector_id, charging_profile_id) DO UPDATE SET
       stack_level              = EXCLUDED.stack_level,
       charging_profile_purpose = EXCLUDED.charging_profile_purpose,
       charging_profile_kind    = EXCLUDED.charging_profile_kind,
       recurrency_kind          = EXCLUDED.recurrency_kind,
       valid_from               = EXCLUDED.valid_from,
       valid_to                 = EXCLUDED.valid_to,
       schedule                 = EXCLUDED.schedule,
       created_at               = NOW()`,
    [chargerId, connectorId ?? 0, cp.chargingProfileId, cp.stackLevel ?? 0,
     cp.chargingProfilePurpose, cp.chargingProfileKind,
     cp.recurrencyKind ?? null, cp.validFrom ?? null, cp.validTo ?? null,
     JSON.stringify(cp.chargingSchedule ?? {})]
  );
}

async function clearChargingProfiles(pool, chargerId, { id, connectorId, purpose, stackLevel } = {}) {
  let q = 'DELETE FROM charging_profiles WHERE charger_id = $1';
  const params = [chargerId];
  if (connectorId != null) { params.push(connectorId); q += ` AND connector_id = $${params.length}`; }
  if (id          != null) { params.push(id);          q += ` AND charging_profile_id = $${params.length}`; }
  if (purpose     != null) { params.push(purpose);     q += ` AND charging_profile_purpose = $${params.length}`; }
  if (stackLevel  != null) { params.push(stackLevel);  q += ` AND stack_level = $${params.length}`; }
  await pool.query(q, params);
}

// ── OCPP commands ─────────────────────────────────────────────────────────

async function insertOcppCommand(pool, cmd) {
  await pool.query(
    `INSERT INTO ocpp_commands
       (id, ocpp_message_id, charge_point_id, action, payload, status, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::timestamptz)`,
    [cmd.id, cmd.ocppMessageId, cmd.chargePointId, cmd.action,
     JSON.stringify(cmd.payload), cmd.status, cmd.createdAt]
  );
}

async function markOcppCommandSent(pool, id, sentAt) {
  await pool.query(
    `UPDATE ocpp_commands SET status = 'sent', sent_at = $2::timestamptz WHERE id = $1`,
    [id, sentAt]
  );
}

async function markOcppCommandResult(pool, id, status, responseAt, response) {
  await pool.query(
    `UPDATE ocpp_commands
     SET status = $2, response_at = $3::timestamptz, response = $4::jsonb
     WHERE id = $1`,
    [id, status, responseAt, JSON.stringify(response ?? null)]
  );
}

// ── OCPP messages ─────────────────────────────────────────────────────────

async function insertOcppMessage(pool, msg) {
  await pool.query(
    `INSERT INTO ocpp_messages (id, ts, charge_point_id, direction, action, payload)
     VALUES ($1,$2::timestamptz,$3,$4,$5,$6::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [msg.id, msg.ts, msg.chargePointId, msg.direction, msg.action, JSON.stringify(msg.payload)]
  );
}

// ── Retention ─────────────────────────────────────────────────────────────

function parseRetentionMs(str) {
  const match = String(str || '7d').match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) throw new Error(`Invalid MSG_DB_RETENTION: "${str}". Use e.g. 7d, 24h, 30m.`);
  const n = Number(match[1]);
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * units[match[2].toLowerCase()];
}

async function pruneOldMessages(pool, retentionMs) {
  return pool.query(
    `DELETE FROM ocpp_messages WHERE created_at < NOW() - ($1 || ' milliseconds')::interval`,
    [retentionMs]
  );
}

module.exports = {
  // bootstrap
  loadInitialState, loadRecentMessages, loadRecentCommands,
  // chargers
  upsertCharger, updateChargerStatus, updateChargerKw, bulkUpdateChargerKw,
  // sessions
  insertSession, updateSessionOnStop, incrementChargingSessionEnergy, updateSessionStatus,
  // id tags
  getIdTagInfo, listIdTags, upsertIdTag, deleteIdTag,
  // reservations
  upsertReservation, cancelReservation,
  // event log
  logOcppEvent,
  // charging profiles
  upsertChargingProfile, clearChargingProfiles,
  // commands
  insertOcppCommand, markOcppCommandSent, markOcppCommandResult,
  // messages
  insertOcppMessage,
  // retention
  parseRetentionMs, pruneOldMessages,
};
