import { useState, useEffect } from 'react';
import { CURRENCY, STATUS_OK, STATUS_RECONNECTING } from './config';
import {
  socket,
  fetchChargers,
  fetchSessions,
  fetchHourly,
  fetchOcppConfig,
  fetchOcppArchitecture,
  fetchOcppChargePoints,
  fetchOcppMessages,
  fetchOcppCommands,
  sendOcppCommand,
} from './api';
import Nav from './components/Nav';
import KpiCard from './components/KpiCard';
import EnergyChart from './components/EnergyChart';
import ChargerGrid from './components/ChargerGrid';
import SessionTable from './components/SessionTable';
import UtilisationDonut from './components/UtilisationDonut';
import OcppCore from './components/OcppCore';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [connected, setConnected] = useState(false);
  const [chargers, setChargers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [ocppConfig, setOcppConfig] = useState({ commandActions: [], protocol: '', gatewayEndpointTemplate: '', baseGatewayEndpoint: '', identitySources: [] });
  const [ocppArchitecture, setOcppArchitecture] = useState([]);
  const [ocppChargePoints, setOcppChargePoints] = useState([]);
  const [ocppMessages, setOcppMessages] = useState([]);
  const [ocppCommands, setOcppCommands] = useState([]);

  useEffect(() => {
    Promise.all([
      fetchChargers(),
      fetchSessions(),
      fetchHourly(),
      fetchOcppConfig(),
      fetchOcppArchitecture(),
      fetchOcppChargePoints(),
      fetchOcppMessages(),
      fetchOcppCommands(),
    ])
      .then(([c, s, h, ocppCfg, architecture, chargePoints, messages, commands]) => {
        setChargers(c);
        setSessions(s);
        setHourly(h);
        setOcppConfig(ocppCfg);
        setOcppArchitecture(architecture);
        setOcppChargePoints(chargePoints);
        setOcppMessages(messages);
        setOcppCommands(commands);
      })
      .catch(console.error);

    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('chargers:update', setChargers);
    socket.on('sessions:update', setSessions);
    socket.on('ocpp:chargePoints:update', setOcppChargePoints);
    socket.on('ocpp:messages:update', setOcppMessages);
    socket.on('ocpp:commands:update', setOcppCommands);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chargers:update');
      socket.off('sessions:update');
      socket.off('ocpp:chargePoints:update');
      socket.off('ocpp:messages:update');
      socket.off('ocpp:commands:update');
      socket.disconnect();
    };
  }, []);

  const metrics = getMetrics(chargers, sessions, hourly);

  async function handleOcppCommand(chargePointId, action) {
    try {
      const command = await sendOcppCommand(chargePointId, action);
      setOcppCommands(current => [command, ...current]);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <>
      <Nav connected={connected} activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="page">
        <PageHeader
          activeTab={activeTab}
          connected={connected}
          chargerCount={chargers.length}
          stationCount={metrics.stationCount}
          protocol={ocppConfig.protocol}
        />

        {activeTab === 'overview' && (
          <OverviewView
            chargers={chargers}
            sessions={sessions}
            hourly={hourly}
            metrics={metrics}
          />
        )}

        {activeTab === 'stations' && (
          <StationsView chargers={chargers} metrics={metrics} />
        )}

        {activeTab === 'sessions' && (
          <SessionsView sessions={sessions} metrics={metrics} />
        )}

        {activeTab === 'reports' && (
          <ReportsView chargers={chargers} sessions={sessions} hourly={hourly} metrics={metrics} />
        )}

        {activeTab === 'management' && (
          <ManagementView
            architecture={ocppArchitecture}
            chargePoints={ocppChargePoints}
            messages={ocppMessages}
            commands={ocppCommands}
            commandActions={ocppConfig.commandActions}
            gatewayEndpoint={ocppConfig.gatewayEndpointTemplate}
            baseGatewayEndpoint={ocppConfig.baseGatewayEndpoint}
            identitySources={ocppConfig.identitySources}
            protocol={ocppConfig.protocol}
            onCommand={handleOcppCommand}
          />
        )}
      </main>
    </>
  );
}

function PageHeader({ activeTab, connected, chargerCount, stationCount, protocol }) {
  const copy = {
    overview: ['Network Overview / Live Operations', 'Charge network,\nlive.', `${chargerCount} charge points / ${stationCount} stations / ${protocol || 'OCPP'} control plane`],
    stations: ['Station Operations / Connector Health', 'Stations and\ncharge points.', `${stationCount} stations / ${chargerCount} configured charge points`],
    sessions: ['Charging Sessions / Transactions', 'Sessions and\nrevenue.', 'Live charging, completed transactions, and fault records'],
    reports: ['Reports / Energy and Revenue', 'Operational\nreports.', 'Energy, revenue, availability, and utilisation summaries'],
    management: ['Management / OCPP Control Plane', 'CPMS\nmanagement.', `${protocol || 'OCPP'} gateway, remote commands, and protocol messages`],
  }[activeTab];

  return (
    <header className="page-header">
      <div>
        <div className="page-eyebrow">{copy[0]}</div>
        <h1 className="page-title">{copy[1].split('\n').map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h1>
        <p className="page-sub">{copy[2]}</p>
      </div>
      <div className="header-right">
        <span className="sync-badge">
          <span className="sync-dot" />
          {connected ? STATUS_OK : STATUS_RECONNECTING}
        </span>
        <button className="btn-outline" type="button">Export report</button>
      </div>
    </header>
  );
}

function OverviewView({ chargers, sessions, hourly, metrics }) {
  return (
    <>
      <KpiRow metrics={metrics} sessions={sessions} hourly={hourly} />
      <div className="main-grid">
        <EnergyChart data={hourly} totalKwh={metrics.totalKwh} />
        <ChargerGrid chargers={chargers} />
      </div>
      <div className="bottom-grid">
        <SessionTable sessions={sessions} />
        <UtilisationDonut chargers={chargers} />
      </div>
    </>
  );
}

function StationsView({ chargers, metrics }) {
  const stations = groupByStation(chargers);
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Stations" value={stations.length} delta={`${chargers.length} charge points`} deltaDir="neutral" />
        <KpiCard label="Charging" value={metrics.activeChargers} delta="points currently active" deltaDir="neutral" />
        <KpiCard label="Available" value={metrics.idleChargers} delta="points ready for use" deltaDir="neutral" />
        <KpiCard label="Faults" value={metrics.faultChargers} delta="points needing action" deltaDir={metrics.faultChargers ? 'down' : 'neutral'} accentDim />
      </div>
      <div className="station-page-grid">
        <ChargerGrid chargers={chargers} />
        <div className="card station-list-card">
          <div className="section-label">Stations</div>
          <div className="station-list">
            {stations.map(station => (
              <div className="station-row" key={station.name}>
                <div>
                  <div className="station-row-name">{station.name}</div>
                  <div className="station-row-meta">{station.total} charge points / {station.active} charging / {station.fault} fault</div>
                </div>
                <span className={`ocpp-pill ${station.fault ? 'failed' : 'accepted'}`}>{station.fault ? 'attention' : 'healthy'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function SessionsView({ sessions, metrics }) {
  const completed = sessions.filter(s => s.status === 'completed').length;
  const faults = sessions.filter(s => s.status === 'fault').length;
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Charging" value={metrics.activeSessions} delta="active sessions" deltaDir="neutral" />
        <KpiCard label="Completed" value={completed} delta="finished sessions" deltaDir="neutral" />
        <KpiCard label="Revenue" value={`${CURRENCY} ${metrics.totalRevenue.toFixed(2)}`} delta={`${sessions.length} total records`} deltaDir="neutral" compact />
        <KpiCard label="Fault Records" value={faults} delta="session exceptions" deltaDir={faults ? 'down' : 'neutral'} accentDim />
      </div>
      <SessionTable sessions={sessions} />
    </>
  );
}

function ReportsView({ chargers, sessions, hourly, metrics }) {
  const averageSessionKwh = sessions.length ? metrics.totalKwh / sessions.length : 0;
  return (
    <>
      <div className="kpi-row">
        <KpiCard label="Energy" value={metrics.totalKwh.toFixed(1)} unit="kWh" delta={`${hourly.length} hourly samples`} deltaDir="neutral" />
        <KpiCard label="Revenue" value={`${CURRENCY} ${metrics.totalRevenue.toFixed(2)}`} delta="today to date" deltaDir="neutral" compact />
        <KpiCard label="Avg Session" value={averageSessionKwh.toFixed(1)} unit="kWh" delta={`${sessions.length} sessions`} deltaDir="neutral" />
        <KpiCard label="Availability" value={metrics.availabilityPct} unit="%" delta={`${metrics.offlineCount} offline`} deltaDir="neutral" accentDim />
      </div>
      <div className="report-grid">
        <EnergyChart data={hourly} totalKwh={metrics.totalKwh} />
        <div className="card report-card">
          <div className="section-label">Report summary</div>
          <table className="summary-table">
            <tbody>
              <SummaryRow label="Configured charge points" value={chargers.length} />
              <SummaryRow label="Active charge points" value={metrics.activeChargers} />
              <SummaryRow label="Idle charge points" value={metrics.idleChargers} />
              <SummaryRow label="Faulted charge points" value={metrics.faultChargers} />
              <SummaryRow label="Charging sessions" value={metrics.activeSessions} />
              <SummaryRow label="Revenue today" value={`${CURRENCY} ${metrics.totalRevenue.toFixed(2)}`} />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ManagementView(props) {
  return <OcppCore {...props} />;
}

function KpiRow({ metrics, sessions, hourly }) {
  return (
    <div className="kpi-row">
      <KpiCard label="Active Sessions" value={metrics.activeSessions} delta={`${sessions.length} total sessions`} deltaDir="neutral" />
      <KpiCard label="Energy Today" value={metrics.totalKwh.toFixed(1)} unit="kWh" delta={`${hourly.length} hourly samples`} deltaDir="neutral" />
      <KpiCard label="Revenue Today" value={`${CURRENCY} ${metrics.totalRevenue.toFixed(2)}`} delta={`${metrics.activeSessions} sessions charging`} deltaDir="neutral" compact />
      <KpiCard label="Network Availability" value={metrics.availabilityPct} unit="%" delta={`${metrics.offlineCount} points currently offline`} deltaDir="neutral" accentDim />
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{value}</td>
    </tr>
  );
}

function getMetrics(chargers, sessions, hourly) {
  const activeSessions = sessions.filter(s => s.status === 'charging').length;
  const totalKwh = sessions.reduce((acc, s) => acc + Number(s.energyKwh || 0), 0);
  const totalRevenue = sessions.reduce((acc, s) => acc + Number(s.amount || 0), 0);
  const activeChargers = chargers.filter(c => c.status === 'active').length;
  const idleChargers = chargers.filter(c => c.status === 'idle').length;
  const faultChargers = chargers.filter(c => c.status === 'fault').length;
  const availabilityPct = chargers.length ? Math.round((activeChargers / chargers.length) * 100) : 0;
  const offlineCount = chargers.filter(c => c.status !== 'active').length;
  const stationCount = new Set(chargers.map(c => c.station)).size;
  return {
    activeSessions,
    totalKwh,
    totalRevenue,
    activeChargers,
    idleChargers,
    faultChargers,
    availabilityPct,
    offlineCount,
    stationCount,
    hourlyCount: hourly.length,
  };
}

function groupByStation(chargers) {
  const groups = new Map();
  chargers.forEach(charger => {
    const current = groups.get(charger.station) || { name: charger.station, total: 0, active: 0, idle: 0, fault: 0 };
    current.total += 1;
    if (charger.status === 'active') current.active += 1;
    if (charger.status === 'idle') current.idle += 1;
    if (charger.status === 'fault') current.fault += 1;
    groups.set(charger.station, current);
  });
  return Array.from(groups.values());
}

