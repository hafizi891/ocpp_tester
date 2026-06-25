import { io } from 'socket.io-client';
import { API_URL } from './config';

const ORIGIN = API_URL;

export const socket = io(ORIGIN, { autoConnect: false });

async function request(path, options) {
  const res = await fetch(`${ORIGIN}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json();
}

const get = path => request(path);
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const fetchStats = () => get('/api/stats');
export const fetchChargers = () => get('/api/chargers');
export const fetchSessions = () => get('/api/sessions');
export const fetchHourly = () => get('/api/energy/hourly');
export const fetchOcppConfig = () => get('/api/ocpp/config');
export const fetchOcppArchitecture = () => get('/api/ocpp/architecture');
export const fetchOcppChargePoints = () => get('/api/ocpp/charge-points');
export const fetchOcppMessages = () => get('/api/ocpp/messages');
export const fetchOcppCommands = () => get('/api/ocpp/commands');
export const sendOcppCommand = (chargePointId, action, payload) => (
  post(`/api/ocpp/charge-points/${encodeURIComponent(chargePointId)}/commands`, { action, payload })
);

export const forceCloseSession = (id) => post(`/api/sessions/${id}/force-close`, {});

export const fetchCarProfiles  = () => get('/api/car-profiles');
export const createCarProfile  = (p) => post('/api/car-profiles', p);
export const updateCarProfile  = (id, p) => request(`/api/car-profiles/${id}`, { method: 'PUT', body: JSON.stringify(p) });
export const deleteCarProfile  = (id) => request(`/api/car-profiles/${id}`, { method: 'DELETE' });
export const applyCarProfile   = (id) => post(`/api/car-profiles/${id}/apply`, {});

export const fetchLogs = (lines = 80) => get(`/api/logs?lines=${lines}`);
export const fetchSolarConfig = () => get('/api/solar/config');
export const fetchSolarStatus = () => get('/api/solar/status');
export const saveSolarConfig  = (cfg) => post('/api/solar/config', cfg);
export const setSolarManual   = (kw)  => post('/api/solar/manual', { kw });
export const clearSolarLimit  = ()    => post('/api/solar/clear', {});
