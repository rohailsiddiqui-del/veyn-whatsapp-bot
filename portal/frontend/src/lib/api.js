import { getToken } from './auth';

const BASE = '/api';

function headers() {
  return { 'Content-Type': 'application/json', 'x-portal-token': getToken() || '' };
}

export async function login(password) {
  const r = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  return r.json();
}

// ── Bots ──────────────────────────────────────────────────────────────────────

export async function listBots() {
  const r = await fetch(`${BASE}/bots`, { headers: headers() });
  return r.json();
}

export async function createBot(data) {
  const r = await fetch(`${BASE}/bots`, { method: 'POST', headers: headers(), body: JSON.stringify(data) });
  return r.json();
}

export async function getBot(botId) {
  const r = await fetch(`${BASE}/bots/${botId}`, { headers: headers() });
  return r.json();
}

export async function updateBot(botId, data) {
  const r = await fetch(`${BASE}/bots/${botId}`, { method: 'PUT', headers: headers(), body: JSON.stringify(data) });
  return r.json();
}

export async function deleteBot(botId) {
  const r = await fetch(`${BASE}/bots/${botId}`, { method: 'DELETE', headers: headers() });
  return r.json();
}

// ── Bot Controls ───────────────────────────────────────────────────────────────

export async function startBot(botId) {
  const r = await fetch(`${BASE}/bots/${botId}/start`, { method: 'POST', headers: headers() });
  return r.json();
}

export async function stopBot(botId) {
  const r = await fetch(`${BASE}/bots/${botId}/stop`, { method: 'POST', headers: headers() });
  return r.json();
}

export async function restartBot(botId) {
  const r = await fetch(`${BASE}/bots/${botId}/restart`, { method: 'POST', headers: headers() });
  return r.json();
}

export async function resetAuth(botId) {
  const r = await fetch(`${BASE}/bots/${botId}/reset-auth`, { method: 'POST', headers: headers() });
  return r.json();
}

// ── KB ─────────────────────────────────────────────────────────────────────────

export async function getKBSources(botId) {
  const r = await fetch(`${BASE}/bots/${botId}/kb/sources`, { headers: headers() });
  return r.json();
}

export async function uploadKBFiles(botId, files) {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const r = await fetch(`${BASE}/bots/${botId}/kb/upload`, {
    method: 'POST',
    headers: { 'x-portal-token': getToken() || '' },
    body: form,
  });
  return r.json();
}

export async function deleteSource(botId, name) {
  const r = await fetch(`${BASE}/bots/${botId}/kb/source/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  return r.json();
}

export async function chatBot(botId, message, sessionId) {
  const r = await fetch(`${BASE}/bots/${botId}/chat`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message, sessionId }),
  });
  return r.json();
}
