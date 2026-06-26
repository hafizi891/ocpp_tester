'use strict';

// SQLite version — all functions accept a leading _db param for API compatibility
// with server.js call sites, but use the module-level db directly.
const db = require('./pool');

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
    transactionId: row.transaction_id != null ? Number(row.transaction_id) : null,
    idTag:         row.id_tag         ?? null,
    connectorId:   row.connector_id   != null ? Number(row.connector_id) : 1,
    meterStart:    row.meter_start     != null ? Number(row.meter_start)  : 0,
    meterStop:     row.meter_stop      != null ? Number(row.meter_stop)   : null,
    stopReason:    row.stop_reason    ?? null,
  };
}

function rowToCommand(row) {
  return {
    id:            row.id,
    ocppMessageId: row.ocpp_message_id,
    chargePointId: row.charge_point_id,
    action:        row.action,
    payload:       row.payload  ? JSON.parse(row.payload)  : {},
    status:        row.status,
    createdAt:     row.created_at,
    sentAt:        row.sent_at,
    responseAt:    row.response_at,
    response:      row.response ? JSON.parse(row.response) : null,
  };
}

function rowToMessage(row) {
  return {
    id:            row.id,
    ts:            row.ts,
    chargePointId: row.charge_point_id,
    direction:     row.direction,
    action:        row.action,
    payload:       row.payload ? JSON.parse(row.payload) : {},
  };
}

function rowToIdTag(row) {
  return {
    idTag:       row.id_tag,
    status:      row.status,
    expiryDate:  row.expiry_date   ?? null,
    parentIdTag: row.parent_id_tag ?? null,
    note:        row.note          ?? '',
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function rowToCarProfile(row) {
  return {
    id:       row.id,
    name:     row.name,
    maxKw:    Number(row.max_kw),
    phases:   Number(row.phases),
    color:    row.color,
    schedule: row.schedule
      ? (typeof row.schedule === 'string' ? JSON.parse(row.schedule) : row.schedule)
      : { type: 'always' },
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

function loadInitialState(_db) {
  const chargers     = db.prepare('SELECT * FROM chargers ORDER BY id').all().map(rowToCharger);
  const sessions     = db.prepare('SELECT * FROM sessions ORDER BY id').all().map(rowToSession);
  const hourlyEnergy = db.prepare('SELECT kwh FROM hourly_energy ORDER BY hour').all().map(r => Number(r.kwh));
  return Promise.resolve({ chargers, sessions, hourlyEnergy });
}

function loadRecentMessages(_db, limit) {
  const rows = db.prepare('SELECT * FROM ocpp_messages ORDER BY ts DESC LIMIT ?').all(limit);
  return Promise.resolve(rows.map(rowToMessage).reverse());
}

function loadRecentCommands(_db, limit) {
  const rows = db.prepare('SELECT * FROM ocpp_commands ORDER BY created_at DESC LIMIT ?').all(limit);
  return Promise.resolve(rows.map(rowToCommand).reverse());
}

// ── Chargers ──────────────────────────────────────────────────────────────

function upsertCharger(_db, c) {
  db.prepare(`
    INSERT INTO chargers (id, station, status, kw, max_kw, ocpp_identity)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      station       = excluded.station,
      status        = excluded.status,
      kw            = excluded.kw,
      max_kw        = excluded.max_kw,
      ocpp_identity = excluded.ocpp_identity,
      updated_at    = datetime('now')
  `).run(c.id, c.station, c.status, c.kw, c.maxKw, c.ocppIdentity);
  return Promise.resolve();
}

function updateChargerStatus(_db, id, status) {
  db.prepare(`UPDATE chargers SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return Promise.resolve();
}

function updateChargerKw(_db, id, kw) {
  db.prepare(`UPDATE chargers SET kw = ?, updated_at = datetime('now') WHERE id = ?`).run(kw, id);
  return Promise.resolve();
}

function bulkUpdateChargerKw(_db, ids, kws) {
  if (!ids.length) return Promise.resolve();
  const stmt = db.prepare(`UPDATE chargers SET kw = ?, updated_at = datetime('now') WHERE id = ?`);
  db.exec('BEGIN');
  try {
    ids.forEach((id, i) => stmt.run(kws[i], id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return Promise.resolve();
}

// ── Sessions ──────────────────────────────────────────────────────────────

function insertSession(_db, s) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO sessions
      (charger_id, user_name, started_at, energy_kwh, amount, status,
       transaction_id, id_tag, connector_id, meter_start)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    s.chargerId, s.user || '', s.startedAt || '', s.energyKwh ?? 0, s.amount ?? 0,
    s.status || 'charging', s.transactionId ?? null, s.idTag ?? null,
    s.connectorId ?? 1, s.meterStart ?? 0,
  );
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(lastInsertRowid);
  return Promise.resolve(rowToSession(row));
}

function updateSessionOnStop(_db, id, fields) {
  db.prepare(`
    UPDATE sessions
    SET status = ?, energy_kwh = ?, amount = ?, meter_stop = ?, stop_reason = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(fields.status, fields.energyKwh, fields.amount,
         fields.meterStop ?? null, fields.stopReason ?? null, id);
  return Promise.resolve();
}

function incrementChargingSessionEnergy(_db, energyDelta, amountDelta) {
  db.prepare(`
    UPDATE sessions
    SET energy_kwh = ROUND(energy_kwh + ?, 3),
        amount     = ROUND(amount     + ?, 3),
        updated_at = datetime('now')
    WHERE status = 'charging'
  `).run(energyDelta, amountDelta);
  return Promise.resolve();
}

function updateSessionEnergy(_db, id, energyKwh) {
  db.prepare(`UPDATE sessions SET energy_kwh = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(energyKwh, id);
  return Promise.resolve();
}

function updateSessionStatus(_db, id, status) {
  db.prepare(`UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return Promise.resolve();
}

// ── ID tags ───────────────────────────────────────────────────────────────

function getIdTagInfo(_db, idTag) {
  if (!idTag) return Promise.resolve(null);
  const row = db.prepare('SELECT * FROM id_tags WHERE id_tag = ?').get(idTag);
  if (!row) return Promise.resolve(null);
  if (row.expiry_date && new Date(row.expiry_date) < new Date()) {
    return Promise.resolve({ status: 'Expired', expiryDate: row.expiry_date });
  }
  const info = { status: row.status };
  if (row.expiry_date)   info.expiryDate  = row.expiry_date;
  if (row.parent_id_tag) info.parentIdTag = row.parent_id_tag;
  return Promise.resolve(info);
}

function listIdTags(_db) {
  return Promise.resolve(db.prepare('SELECT * FROM id_tags ORDER BY id_tag').all().map(rowToIdTag));
}

function upsertIdTag(_db, tag) {
  db.prepare(`
    INSERT INTO id_tags (id_tag, status, expiry_date, parent_id_tag, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id_tag) DO UPDATE SET
      status        = excluded.status,
      expiry_date   = excluded.expiry_date,
      parent_id_tag = excluded.parent_id_tag,
      note          = excluded.note,
      updated_at    = datetime('now')
  `).run(tag.idTag, tag.status || 'Accepted', tag.expiryDate ?? null,
         tag.parentIdTag ?? null, tag.note ?? null);
  return Promise.resolve();
}

function deleteIdTag(_db, idTag) {
  db.prepare('DELETE FROM id_tags WHERE id_tag = ?').run(idTag);
  return Promise.resolve();
}

// ── Reservations ──────────────────────────────────────────────────────────

function upsertReservation(_db, r) {
  db.prepare(`
    INSERT INTO reservations (reservation_id, charger_id, connector_id, id_tag, expiry_date, status)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(reservation_id) DO UPDATE SET
      status      = excluded.status,
      expiry_date = excluded.expiry_date
  `).run(r.reservationId, r.chargerId, r.connectorId ?? 1,
         r.idTag, r.expiryDate, r.status ?? 'active');
  return Promise.resolve();
}

function cancelReservation(_db, reservationId) {
  db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE reservation_id = ?`).run(reservationId);
  return Promise.resolve();
}

// ── OCPP event log ────────────────────────────────────────────────────────

function logOcppEvent(_db, chargerId, eventType, status, payload) {
  db.prepare(`
    INSERT INTO ocpp_event_log (charger_id, event_type, status, payload)
    VALUES (?, ?, ?, ?)
  `).run(chargerId, eventType, status, JSON.stringify(payload ?? {}));
  return Promise.resolve();
}

// ── Charging profiles ─────────────────────────────────────────────────────

function upsertChargingProfile(_db, chargerId, connectorId, profile) {
  const cp = profile.csChargingProfiles || profile;
  db.prepare(`
    INSERT INTO charging_profiles
      (charger_id, connector_id, charging_profile_id, stack_level,
       charging_profile_purpose, charging_profile_kind, recurrency_kind,
       valid_from, valid_to, schedule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(charger_id, connector_id, charging_profile_id) DO UPDATE SET
      stack_level              = excluded.stack_level,
      charging_profile_purpose = excluded.charging_profile_purpose,
      charging_profile_kind    = excluded.charging_profile_kind,
      recurrency_kind          = excluded.recurrency_kind,
      valid_from               = excluded.valid_from,
      valid_to                 = excluded.valid_to,
      schedule                 = excluded.schedule,
      created_at               = datetime('now')
  `).run(
    chargerId, connectorId ?? 0, cp.chargingProfileId, cp.stackLevel ?? 0,
    cp.chargingProfilePurpose, cp.chargingProfileKind,
    cp.recurrencyKind ?? null, cp.validFrom ?? null, cp.validTo ?? null,
    JSON.stringify(cp.chargingSchedule ?? {}),
  );
  return Promise.resolve();
}

function clearChargingProfiles(_db, chargerId, { id, connectorId, purpose, stackLevel } = {}) {
  let q = 'DELETE FROM charging_profiles WHERE charger_id = ?';
  const params = [chargerId];
  if (connectorId != null) { params.push(connectorId); q += ' AND connector_id = ?'; }
  if (id          != null) { params.push(id);          q += ' AND charging_profile_id = ?'; }
  if (purpose     != null) { params.push(purpose);     q += ' AND charging_profile_purpose = ?'; }
  if (stackLevel  != null) { params.push(stackLevel);  q += ' AND stack_level = ?'; }
  db.prepare(q).run(...params);
  return Promise.resolve();
}

// ── Car profiles ──────────────────────────────────────────────────────────

function listCarProfiles(_db) {
  return Promise.resolve(db.prepare('SELECT * FROM car_profiles ORDER BY id').all().map(rowToCarProfile));
}

function insertCarProfile(_db, p) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO car_profiles (name, max_kw, phases, color, schedule)
    VALUES (?, ?, ?, ?, ?)
  `).run(p.name, p.maxKw, p.phases ?? 3, p.color ?? '#6366f1',
         JSON.stringify(p.schedule ?? { type: 'always' }));
  const row = db.prepare('SELECT * FROM car_profiles WHERE id = ?').get(lastInsertRowid);
  return Promise.resolve(rowToCarProfile(row));
}

function updateCarProfile(_db, id, p) {
  db.prepare(`
    UPDATE car_profiles
    SET name = ?, max_kw = ?, phases = ?, color = ?, schedule = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(p.name, p.maxKw, p.phases ?? 3, p.color ?? '#6366f1',
         JSON.stringify(p.schedule ?? { type: 'always' }), id);
  const row = db.prepare('SELECT * FROM car_profiles WHERE id = ?').get(id);
  return Promise.resolve(row ? rowToCarProfile(row) : null);
}

function deleteCarProfile(_db, id) {
  db.prepare('DELETE FROM car_profiles WHERE id = ?').run(id);
  return Promise.resolve();
}

function getCarProfile(_db, id) {
  const row = db.prepare('SELECT * FROM car_profiles WHERE id = ?').get(Number(id));
  return Promise.resolve(row ? rowToCarProfile(row) : null);
}

// ── OCPP commands ─────────────────────────────────────────────────────────

function insertOcppCommand(_db, cmd) {
  db.prepare(`
    INSERT INTO ocpp_commands
      (id, ocpp_message_id, charge_point_id, action, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cmd.id, cmd.ocppMessageId, cmd.chargePointId, cmd.action,
         JSON.stringify(cmd.payload), cmd.status, cmd.createdAt);
  return Promise.resolve();
}

function markOcppCommandSent(_db, id, sentAt) {
  db.prepare(`UPDATE ocpp_commands SET status = 'sent', sent_at = ? WHERE id = ?`).run(sentAt, id);
  return Promise.resolve();
}

function markOcppCommandResult(_db, id, status, responseAt, response) {
  db.prepare(`
    UPDATE ocpp_commands SET status = ?, response_at = ?, response = ? WHERE id = ?
  `).run(status, responseAt, JSON.stringify(response ?? null), id);
  return Promise.resolve();
}

// ── OCPP messages ─────────────────────────────────────────────────────────

function insertOcppMessage(_db, msg) {
  db.prepare(`
    INSERT OR IGNORE INTO ocpp_messages
      (id, ts, charge_point_id, direction, action, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.ts, msg.chargePointId, msg.direction, msg.action,
         JSON.stringify(msg.payload));
  return Promise.resolve();
}

// ── Retention ─────────────────────────────────────────────────────────────

function parseRetentionMs(str) {
  const match = String(str || '7d').match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) throw new Error(`Invalid MSG_DB_RETENTION: "${str}". Use e.g. 7d, 24h, 30m.`);
  const n = Number(match[1]);
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * units[match[2].toLowerCase()];
}

function pruneOldMessages(_db, retentionMs) {
  const secs = Math.floor(retentionMs / 1000);
  db.prepare(`DELETE FROM ocpp_messages WHERE created_at < datetime('now', ?)`)
    .run(`-${secs} seconds`);
  return Promise.resolve();
}

module.exports = {
  // bootstrap
  loadInitialState, loadRecentMessages, loadRecentCommands,
  // chargers
  upsertCharger, updateChargerStatus, updateChargerKw, bulkUpdateChargerKw,
  // sessions
  insertSession, updateSessionOnStop, incrementChargingSessionEnergy, updateSessionEnergy, updateSessionStatus,
  // id tags
  getIdTagInfo, listIdTags, upsertIdTag, deleteIdTag,
  // reservations
  upsertReservation, cancelReservation,
  // event log
  logOcppEvent,
  // charging profiles (OCPP)
  upsertChargingProfile, clearChargingProfiles,
  // car profiles
  listCarProfiles, insertCarProfile, updateCarProfile, deleteCarProfile, getCarProfile,
  // commands
  insertOcppCommand, markOcppCommandSent, markOcppCommandResult,
  // messages
  insertOcppMessage,
  // retention
  parseRetentionMs, pruneOldMessages,
};
