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
