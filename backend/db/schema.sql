-- CPMS PostgreSQL schema — idempotent, safe to run multiple times

-- ── Chargers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chargers (
  id            TEXT          PRIMARY KEY,
  station       TEXT          NOT NULL DEFAULT 'Discovered',
  status        TEXT          NOT NULL DEFAULT 'idle'
                              CHECK (status IN ('idle', 'active', 'fault')),
  kw            NUMERIC(8,3)  NOT NULL DEFAULT 0,
  max_kw        NUMERIC(8,3)  NOT NULL DEFAULT 22,
  ocpp_identity TEXT          NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chargers_ocpp_identity
  ON chargers(ocpp_identity) WHERE ocpp_identity <> '';

-- ── Sessions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              BIGSERIAL     PRIMARY KEY,
  charger_id      TEXT          NOT NULL,
  user_name       TEXT          NOT NULL DEFAULT '',
  started_at      TEXT          NOT NULL DEFAULT '',
  energy_kwh      NUMERIC(12,3) NOT NULL DEFAULT 0,
  amount          NUMERIC(12,3) NOT NULL DEFAULT 0,
  status          TEXT          NOT NULL DEFAULT 'charging'
                  CHECK (status IN ('charging', 'completed', 'fault')),
  transaction_id  BIGINT,
  id_tag          TEXT,
  connector_id    SMALLINT      NOT NULL DEFAULT 1,
  meter_start     BIGINT        NOT NULL DEFAULT 0,
  meter_stop      BIGINT,
  stop_reason     TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_charger_id     ON sessions(charger_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status         ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_transaction_id ON sessions(transaction_id) WHERE transaction_id IS NOT NULL;

-- Idempotent column additions for existing deployments
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS transaction_id BIGINT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id_tag         TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS connector_id   SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meter_start    BIGINT   NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meter_stop     BIGINT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS stop_reason    TEXT;

-- ── Hourly energy ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hourly_energy (
  hour        SMALLINT      PRIMARY KEY CHECK (hour >= 0 AND hour <= 23),
  kwh         NUMERIC(10,3) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO hourly_energy (hour, kwh)
SELECT s, 0 FROM generate_series(0, 23) AS s
ON CONFLICT DO NOTHING;

-- ── RFID / ID tags ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS id_tags (
  id_tag          TEXT        PRIMARY KEY,
  status          TEXT        NOT NULL DEFAULT 'Accepted'
                              CHECK (status IN ('Accepted','Blocked','Expired','Invalid','ConcurrentTx')),
  expiry_date     TIMESTAMPTZ,
  parent_id_tag   TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Reservations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id              SERIAL      PRIMARY KEY,
  reservation_id  INT         NOT NULL UNIQUE,
  charger_id      TEXT        NOT NULL,
  connector_id    SMALLINT    NOT NULL DEFAULT 1,
  id_tag          TEXT        NOT NULL,
  expiry_date     TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','used','cancelled','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_charger ON reservations(charger_id, status);

-- ── OCPP event log (firmware & diagnostics status) ─────────────────────────
CREATE TABLE IF NOT EXISTS ocpp_event_log (
  id          BIGSERIAL   PRIMARY KEY,
  charger_id  TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  status      TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_log_charger_ts ON ocpp_event_log(charger_id, ts DESC);

-- ── Charging profiles (smart charging) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS charging_profiles (
  id                       SERIAL      PRIMARY KEY,
  charger_id               TEXT        NOT NULL,
  connector_id             SMALLINT    NOT NULL DEFAULT 0,
  charging_profile_id      INT         NOT NULL,
  stack_level              INT         NOT NULL DEFAULT 0,
  charging_profile_purpose TEXT        NOT NULL,
  charging_profile_kind    TEXT        NOT NULL,
  recurrency_kind          TEXT,
  valid_from               TIMESTAMPTZ,
  valid_to                 TIMESTAMPTZ,
  schedule                 JSONB       NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(charger_id, connector_id, charging_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_charging_profiles_charger ON charging_profiles(charger_id, connector_id);

-- ── OCPP commands ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocpp_commands (
  id              TEXT        PRIMARY KEY,
  ocpp_message_id TEXT        NOT NULL,
  charge_point_id TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','accepted','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  response_at     TIMESTAMPTZ,
  response        JSONB
);

CREATE INDEX IF NOT EXISTS idx_commands_cp_status   ON ocpp_commands(charge_point_id, status);
CREATE INDEX IF NOT EXISTS idx_commands_ocpp_msg_id ON ocpp_commands(ocpp_message_id);

-- ── Car charging profiles (named presets per vehicle) ────────────────────
CREATE TABLE IF NOT EXISTS car_profiles (
  id         SERIAL       PRIMARY KEY,
  name       TEXT         NOT NULL,
  max_kw     NUMERIC(8,2) NOT NULL,
  phases     SMALLINT     NOT NULL DEFAULT 3 CHECK (phases IN (1, 3)),
  color      TEXT         NOT NULL DEFAULT '#6366f1',
  schedule   JSONB        NOT NULL DEFAULT '{"type":"always"}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE car_profiles ADD COLUMN IF NOT EXISTS schedule JSONB NOT NULL DEFAULT '{"type":"always"}';

-- ── OCPP messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocpp_messages (
  id              TEXT        PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  charge_point_id TEXT        NOT NULL,
  direction       TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_ts      ON ocpp_messages(ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_created ON ocpp_messages(created_at);
