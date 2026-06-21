# CPMS — Charge Point Management System

EV charger management system built on **OCPP 1.6** (WebSocket JSON). Real-time dashboard with full inbound/outbound OCPP command support backed by PostgreSQL.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Socket.IO client |
| Backend | Node.js + Express + Socket.IO + ws |
| Protocol | OCPP 1.6 (WebSocket JSON) |
| Database | PostgreSQL 16 |

---

## Quick Start (Local)

### Prerequisites
- Node.js 18+
- Docker Desktop (for PostgreSQL)

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/cpms.git
cd cpms

# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` — minimum required:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cpms
DB_USER=cpms_user
DB_PASSWORD=cpms_pass

PORT=3001
FRONTEND_ORIGIN=http://localhost:5173

OCPP_HEARTBEAT_INTERVAL=30
TARIFF_PER_KWH=0.33
OCPP_OPEN_AUTH=true
DEFAULT_CHARGER_MAX_KW=22
```

### 3. Start PostgreSQL

```bash
docker compose up -d
```

### 4. Run database migration

```bash
cd backend
npm run migrate
```

This creates all tables: `chargers`, `sessions`, `id_tags`, `reservations`, `ocpp_commands`, `ocpp_messages`, `ocpp_event_log`, `charging_profiles`, `hourly_energy`.

### 5. Start backend

```bash
cd backend
npm start
# or for dev with auto-reload:
npm run dev
```

### 6. Start frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Testing OCPP Connection

Use any OCPP 1.6 simulator or a real charger. The CPMS listens at:

```
ws://localhost:3001/ocpp/{chargePointId}
```

### With OCPP Simulator (Node.js)

```bash
npm install -g ocpp-charger-simulator
# or use: https://github.com/SimonKinds/ocpp-simulator
```

### Manual WebSocket test (wscat)

```bash
npm install -g wscat
wscat -c ws://localhost:3001/ocpp/TEST-001 -s ocpp1.6
```

Send a BootNotification:
```json
[2,"001","BootNotification",{"chargePointModel":"TestModel","chargePointVendor":"TestVendor","chargePointSerialNumber":"TEST-001"}]
```

Expected response:
```json
[3,"001",{"status":"Accepted","currentTime":"...","interval":30}]
```

Send a Heartbeat:
```json
[2,"002","Heartbeat",{}]
```

Send StatusNotification (connector available):
```json
[2,"003","StatusNotification",{"connectorId":1,"errorCode":"NoError","status":"Available"}]
```

Start a charging session:
```json
[2,"004","StartTransaction",{"connectorId":1,"idTag":"RFID-001","meterStart":0,"timestamp":"2024-01-01T00:00:00Z"}]
```

Stop a charging session (use transactionId from StartTransaction response):
```json
[2,"005","StopTransaction",{"transactionId":1234567890,"meterStop":5000,"timestamp":"2024-01-01T01:00:00Z","reason":"Local"}]
```

---

## Supported OCPP 1.6 Messages

### Inbound (Charger → CPMS)

| Action | Description |
|---|---|
| BootNotification | Charger registration + identity resolution |
| Heartbeat | Keep-alive |
| Authorize | RFID card authorization |
| StartTransaction | Begin charging session |
| StopTransaction | End charging session, calculates kWh + cost |
| StatusNotification | Connector status updates |
| MeterValues | Live power/energy readings |
| DataTransfer | Vendor-specific data |
| DiagnosticsStatusNotification | Diagnostics upload status |
| FirmwareStatusNotification | Firmware update status |

### Outbound (CPMS → Charger) — via dashboard

RemoteStartTransaction, RemoteStopTransaction, Reset, UnlockConnector, ChangeAvailability, ChangeConfiguration, GetConfiguration, ClearCache, DataTransfer, TriggerMessage, GetDiagnostics, UpdateFirmware, GetLocalListVersion, SendLocalList, ReserveNow, CancelReservation, SetChargingProfile, ClearChargingProfile, GetCompositeSchedule

---

## OCPP Identity Resolution

The CPMS resolves charger identity from (in priority order):

1. URL path — `ws://host/ocpp/CHARGER-001`
2. Query param — `ws://host/ocpp?chargePointId=CHARGER-001`
3. HTTP header — `X-Charge-Point-Id: CHARGER-001`
4. Basic Auth username — `Authorization: Basic base64(CHARGER-001:password)`
5. BootNotification serial — `chargePointSerialNumber` field

---

## Environment Variables

See [`backend/.env.example`](backend/.env.example) for the full list.

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `cpms` | Database name |
| `DB_USER` | — | Database user |
| `DB_PASSWORD` | — | Database password |
| `PORT` | `3001` | Backend HTTP port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allowed origin |
| `TARIFF_PER_KWH` | `0` | Billing rate (cost per kWh) |
| `OCPP_OPEN_AUTH` | `true` | Accept unknown RFID cards |
| `DEFAULT_CHARGER_MAX_KW` | `22` | Max kW for new chargers |
| `OCPP_HEARTBEAT_INTERVAL` | `30` | Heartbeat interval (seconds) |
| `MSG_DB_RETENTION` | `7d` | OCPP message log retention |

---

## Project Structure

```
cpms/
├── backend/
│   ├── server.js           # Main server — OCPP + REST + Socket.IO
│   ├── .env.example        # Environment variable template
│   ├── db/
│   │   ├── schema.sql      # PostgreSQL schema (idempotent)
│   │   ├── queries.js      # All DB query functions
│   │   ├── pool.js         # PostgreSQL connection pool
│   │   ├── migrate.js      # Run schema.sql
│   │   └── seed.js         # Optional: seed from JSON
│   └── data/
│       ├── ocpp-config.json     # OCPP command payloads
│       └── ocpp-architecture.json
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── config.js
│       └── components/
├── docker-compose.yml      # PostgreSQL via Docker
└── README.md
```

---

## License

MIT
