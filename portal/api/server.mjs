import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_ROOT = path.resolve(__dirname, '../../');
const BOTS_DIR = path.join(BOT_ROOT, 'bots');

// Load .env from BOT_ROOT so PM2 picks up PORTAL_PASSWORD and PORTAL_INTERNAL_SECRET
(function loadEnv() {
  const envPath = path.join(BOT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();

const PASSWORD = process.env.PORTAL_PASSWORD || 'veyn2024';
// Shared secret bot-runner uses to push QR/status to portal (no open port needed)
const INTERNAL_SECRET = process.env.PORTAL_INTERNAL_SECRET || 'veyn-internal-2024';

if (!process.env.PORTAL_PASSWORD) {
  console.warn('[SECURITY] PORTAL_PASSWORD not set — using insecure default. Set this in .env!');
}
if (!process.env.PORTAL_INTERNAL_SECRET) {
  console.warn('[SECURITY] PORTAL_INTERNAL_SECRET not set — using insecure default. Set this in .env!');
}

// ── Session store (token → expiry) ────────────────────
// Tokens are random 32-byte hex strings, not the password itself.
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours
const sessions = new Map(); // token → expiresAt

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

// ── Login brute-force rate limiter ─────────────────────
const loginAttempts = new Map(); // ip → { count, resetAt }
const LOGIN_MAX = 5;
const LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutes

function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW });
    return true;
  }
  return entry.count < LOGIN_MAX;
}

function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip);
  if (entry) entry.count++;
}

function clearLoginRate(ip) {
  loginAttempts.delete(ip);
}

fs.mkdirSync(BOTS_DIR, { recursive: true });


function qrStatePath(botId) {
  return path.join(BOTS_DIR, botId, 'qr-state.json');
}

function saveQrState(botId, event) {
  try {
    fs.mkdirSync(path.join(BOTS_DIR, botId), { recursive: true });
    // Persist everything — QR images too, with a short TTL so a fresh browser tab gets it
    fs.writeFileSync(qrStatePath(botId), JSON.stringify({ event, ts: Date.now() }));
  } catch {}
}

function loadQrState(botId) {
  try {
    const raw = JSON.parse(fs.readFileSync(qrStatePath(botId), 'utf8'));
    const isImage = raw.event?.startsWith('data:image');
    // QR images valid for 25s (Baileys rotates every ~20s), status strings 5 minutes
    const ttl = isImage ? 25 * 1000 : 5 * 60 * 1000;
    if (Date.now() - raw.ts > ttl) return null;
    return raw.event;
  } catch { return null; }
}

function deriveQrState(botId) {
  // Called when no cached state: check PM2 + auth files to determine real state
  const pm2 = getBotPm2Status(botId);
  if (pm2.status === 'stopped' || pm2.status === 'errored') return 'NOT_STARTED';
  // If online and auth files exist → connected
  const authDir = path.join(BOTS_DIR, botId, 'wa_auth');
  const hasCreds = fs.existsSync(path.join(authDir, 'creds.json'));
  if (pm2.status === 'online' && hasCreds) return 'CONNECTED';
  // Online but no creds yet — QR is being generated, return null (wait for push)
  return null;
}

const app = express();

// Allow the configured portal origin (or same-origin only if unset).
// credentials:true is required for cross-origin cookie auth.
const PORTAL_ORIGIN = process.env.PORTAL_ORIGIN || false;
app.use(cors({ origin: PORTAL_ORIGIN, credentials: true }));

app.use(cookieParser());
app.use(express.json({ limit: '4mb' })); // QR data URLs are ~3KB base64

// ── Auth ──────────────────────────────────────────────
function auth(req, res, next) {
  // Primary: HttpOnly session cookie. Fallback: x-portal-token header for
  // scripts/tooling that can't use cookies (internal API use).
  const token = req.cookies?.session || req.headers['x-portal-token'];
  if (!validateSession(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkLoginRate(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const { password } = req.body;
  if (password !== PASSWORD) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  clearLoginRate(ip);
  const token = createSession();
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: SESSION_TTL,
  });
  // Also return token for API scripts that use x-portal-token header
  res.json({ ok: true, token });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies?.session || req.headers['x-portal-token'];
  if (token) destroySession(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

// ── Logs endpoint ─────────────────────────────────────
app.get('/api/bots/:id/logs', auth, (req, res) => {
  const pm2Name = getPm2Name(req.params.id);
  const lines = parseInt(req.query.lines) || 50;
  try {
    const out = execSync(`pm2 logs ${pm2Name} --lines ${lines} --nostream --raw 2>&1`, { timeout: 8000 }).toString();
    res.json({ logs: out });
  } catch (e) {
    res.json({ logs: e.stdout?.toString() || e.message });
  }
});

// ── Debug endpoint (internal only) ────────────────────
app.get('/api/bots/:id/debug', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);
  const pm2 = getBotPm2Status(id);
  const authDir = path.join(BOTS_DIR, id, 'wa_auth');
  const hasCreds = fs.existsSync(path.join(authDir, 'creds.json'));
  const qrState = loadQrState(id);
  const pm2Name = getPm2Name(id);
  res.json({
    botId: id,
    pm2Name,
    pm2Status: pm2,
    hasCreds,
    authDir,
    qrStatePath: qrStatePath(id),
    qrStateOnDisk: qrState,
    derived: deriveQrState(id),
    cfg: { id: cfg.id, botName: cfg.botName, isLegacy: cfg.isLegacy, pmName: cfg.pmName },
  });
});

// ── Bot Registry ──────────────────────────────────────
function listBots() {
  if (!fs.existsSync(BOTS_DIR)) return [];
  return fs.readdirSync(BOTS_DIR)
    .filter(d => fs.statSync(path.join(BOTS_DIR, d)).isDirectory())
    .map(id => ({ id, ...loadBotConfig(id) }));
}

function loadBotConfig(botId) {
  const p = path.join(BOTS_DIR, botId, 'config.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function normalizeWebhookUrl(url) {
  if (!url) return url;
  // Replace server's own external IP with localhost so webhooks always work internally
  return url.replace(/^(https?:\/\/)[\d.]+(:5678)/, '$1localhost$2');
}

function saveBotConfig(botId, cfg) {
  const dir = path.join(BOTS_DIR, botId);
  fs.mkdirSync(path.join(dir, 'kb_store'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'kb_inbox'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'wa_auth'), { recursive: true });
  if (cfg.n8nLeadWebhookUrl) cfg.n8nLeadWebhookUrl = normalizeWebhookUrl(cfg.n8nLeadWebhookUrl);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
}

function getPm2Name(botId) {
  // Allow config to override PM2 process name (used for bots not started via bot-runner, e.g. legacy veyn-bot)
  const cfg = loadBotConfig(botId);
  return cfg.pmName || `bot-${botId}`;
}

function getBotPm2Status(botId) {
  try {
    const out = execSync('pm2 jlist', { timeout: 5000 }).toString();
    const list = JSON.parse(out);
    const proc = list.find(p => p.name === getPm2Name(botId));
    if (!proc) return { status: 'stopped', uptime: null, restarts: 0 };
    return {
      status: proc.pm2_env?.status || 'unknown',
      uptime: proc.pm2_env?.pm_uptime || null,
      restarts: proc.pm2_env?.restart_time || 0,
      pid: proc.pid,
    };
  } catch { return { status: 'stopped', uptime: null, restarts: 0 }; }
}

function assignQrPort(botId) {
  const bots = listBots();
  const existing = bots.find(b => b.id === botId);
  if (existing?.qrPort) return existing.qrPort;
  const used = new Set(bots.map(b => b.qrPort).filter(Boolean));
  let port = 4000;
  while (used.has(port)) port++;
  return port;
}

function assignApiPort(botId) {
  const bots = listBots();
  const existing = bots.find(b => b.id === botId);
  if (existing?.apiPort) return existing.apiPort;
  const used = new Set(bots.map(b => b.apiPort).filter(Boolean));
  let port = 4001;
  while (used.has(port)) port++;
  return port;
}

function assignWidgetPort(botId) {
  const bots = listBots();
  const existing = bots.find(b => b.id === botId);
  if (existing?.widgetPort) return existing.widgetPort;
  const used = new Set(bots.map(b => b.widgetPort).filter(Boolean));
  let port = 4101;
  while (used.has(port)) port++;
  return port;
}

// Per-industry default settings applied at bot creation time.
const INDUSTRY_DEFAULTS = {
  qsr: {
    greeting: `Hi! Welcome to {name}! 🍽️ Looking to order, check our menu, or need info about us?`,
    tone: 'friendly',
    outOfScopeReply: `That's outside what I can help with here. Give us a call or visit us!`,
  },
  food: {
    greeting: `Hi! Welcome to {name}! 🍽️ Looking to order, check our menu, or need info about us?`,
    tone: 'friendly',
    outOfScopeReply: `That's outside what I can help with here. Give us a call or visit us!`,
  },
  ecommerce: {
    greeting: `Hi! Welcome to {name}! 🛒 Looking for something specific or need help with an order?`,
    tone: 'friendly',
    outOfScopeReply: `That's outside what I can help with. Visit our website or contact support!`,
  },
  retail: {
    greeting: `Hi! Welcome to {name}! Looking for something? I'm here to help. 😊`,
    tone: 'friendly',
    outOfScopeReply: `That's a bit outside my area. Feel free to call us or pop in!`,
  },
  automotive: {
    greeting: `Hi! Welcome to {name}. 🚗 Looking for a new vehicle, or have questions about our range?`,
    tone: 'professional',
    outOfScopeReply: `That's outside what I can help with. Please contact our dealership directly.`,
  },
  telecom: {
    greeting: `Hi! I'm the {name} assistant. 📡 Need help with a plan, billing, or your SIM?`,
    tone: 'professional',
    outOfScopeReply: `That's outside what I can assist with. Please contact our support team directly.`,
  },
  banking: {
    greeting: `Hello! Welcome to {name}. How can I assist you today?`,
    tone: 'professional',
    outOfScopeReply: `That's outside what I can assist with. Please speak with one of our advisors directly.`,
  },
  realestate: {
    greeting: `Hi! I'm the {name} assistant. 🏠 Are you looking to buy, rent, or find out more about a property?`,
    tone: 'professional',
    outOfScopeReply: `That's outside what I can help with. Please contact our agency directly.`,
  },
  healthcare: {
    greeting: `Hello! Welcome to {name}. How can we help you today?`,
    tone: 'professional',
    outOfScopeReply: `That's outside what I can help with. Please contact the clinic directly or book an appointment.`,
  },
  education: {
    greeting: `Hi! Welcome to {name}. 🎓 Interested in our courses or need help with admissions?`,
    tone: 'friendly',
    outOfScopeReply: `That's outside what I can help with. Please contact our admissions team directly.`,
  },
};

// ── Bot CRUD ──────────────────────────────────────────
app.get('/api/bots', auth, (req, res) => {
  const bots = listBots().map(b => ({ ...b, pm2Status: getBotPm2Status(b.id) }));
  res.json({ bots });
});

app.post('/api/bots', auth, (req, res) => {
  const { botName, phoneLabel, greeting, tone, language, outOfScopeReply, calendlyLink, adminNumber,
          dailyCostCapUsd, perUserHourlyLimit, industry, personalityPrompt, features } = req.body;
  if (!botName) return res.status(400).json({ error: 'botName required' });

  const id = botName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
  const qrPort  = assignQrPort(id);
  const apiPort = assignApiPort(id);
  const widgetPort = assignWidgetPort(id);

  // Apply per-industry defaults, then allow explicit overrides from the request body.
  const ind = INDUSTRY_DEFAULTS[industry] || {};
  const resolvedGreeting    = greeting    || (ind.greeting    || `Hi! I'm ${botName}. How can I help you?`).replace(/{name}/g, botName);
  const resolvedTone        = tone        || ind.tone        || 'professional';
  const resolvedOutOfScope  = outOfScopeReply || ind.outOfScopeReply || "That's outside what I can help with. Would you like to speak to our team?";

  // features: 'text' | 'text_image' | 'text_image_voice'
  const resolvedFeatures = ['text', 'text_image', 'text_image_voice'].includes(features) ? features : 'text';

  const cfg = {
    id, botName,
    phoneLabel: phoneLabel || '',
    greeting: resolvedGreeting,
    tone: resolvedTone,
    language: language || 'English',
    outOfScopeReply: resolvedOutOfScope,
    calendlyLink: calendlyLink || '',
    adminNumber: adminNumber || '',
    dailyCostCapUsd: dailyCostCapUsd || 1.0,
    perUserHourlyLimit: perUserHourlyLimit || 15,
    qrPort, apiPort, widgetPort,
    features: resolvedFeatures,
    ...(industry ? { industry } : {}),
    ...(personalityPrompt ? { personalityPrompt } : {}),
    createdAt: new Date().toISOString(),
  };

  saveBotConfig(id, cfg);

  // Auto-start the bot process so it's immediately usable.
  try {
    const botDir = path.join(BOTS_DIR, id);
    const runner = path.join(BOT_ROOT, 'src', 'bot-runner.mjs');
    const pm2Name = `bot-${id}`;
    try { execSync(`pm2 delete ${pm2Name}`, { timeout: 5000 }); } catch {}
    execSync(`pm2 start ${runner} --name ${pm2Name} -- --bot-id ${id}`, {
      cwd: BOT_ROOT,
      env: {
        ...process.env,
        BOT_ID: id,
        BOT_DIR: botDir,
        BOT_CONFIG_PATH: path.join(botDir, 'config.json'),
        BOT_KB_STORE: path.join(botDir, 'kb_store', 'kb.json'),
        BOT_KB_INBOX: path.join(botDir, 'kb_inbox'),
      },
      timeout: 10000,
    });
    execSync('pm2 save', { timeout: 5000 });
  } catch (e) {
    console.error('[create-bot] PM2 auto-start failed:', e.message);
    // Non-fatal — bot config is saved, user can start manually from Status tab
  }

  res.json({ ok: true, bot: cfg });
});

app.get('/api/bots/:id', auth, (req, res) => {
  const cfg = loadBotConfig(req.params.id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  res.json({ ...cfg, pm2Status: getBotPm2Status(req.params.id) });
});

app.put('/api/bots/:id', auth, (req, res) => {
  const current = loadBotConfig(req.params.id);
  if (!current.id) return res.status(404).json({ error: 'Bot not found' });
  const updated = { ...current, ...req.body, id: req.params.id };
  saveBotConfig(req.params.id, updated);
  res.json({ ok: true, bot: updated });
});

app.delete('/api/bots/:id', auth, (req, res) => {
  try { execSync(`pm2 delete ${getPm2Name(req.params.id)}`, { timeout: 5000 }); } catch {}
  fs.rmSync(path.join(BOTS_DIR, req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

// ── Bot Controls ──────────────────────────────────────
app.post('/api/bots/:id/start', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });

  const pm2Name = getPm2Name(id);

  // Legacy bots (e.g. veyn-bot) are managed externally — just restart the existing PM2 process
  if (cfg.isLegacy) {
    try {
      execSync(`pm2 restart ${pm2Name}`, { timeout: 10000 });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }

  const botDir = path.join(BOTS_DIR, id);
  const runner = path.join(BOT_ROOT, 'src', 'bot-runner.mjs');

  try {
    try { execSync(`pm2 delete ${pm2Name}`, { timeout: 5000 }); } catch {}
    // --restart-delay 30000: 30s gap between restarts prevents rapid-fire PM2
    //   max-restarts exhaustion when the bot exits cleanly on QR_LIMIT/logout.
    // --max-restarts 5: keeps the process in a detectable errored state rather
    //   than silently dead after 15 rapid restarts.
    execSync(`pm2 start ${runner} --name ${pm2Name} --restart-delay 30000 --max-restarts 5 -- --bot-id ${id}`, {
      cwd: BOT_ROOT,
      env: {
        ...process.env,
        BOT_ID: id,
        BOT_DIR: botDir,
        BOT_CONFIG_PATH: path.join(botDir, 'config.json'),
        BOT_KB_STORE: path.join(botDir, 'kb_store', 'kb.json'),
        BOT_KB_INBOX: path.join(botDir, 'kb_inbox'),
      },
      timeout: 10000,
    });
    execSync('pm2 save', { timeout: 5000 });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bots/:id/stop', auth, (req, res) => {
  try { execSync(`pm2 stop ${getPm2Name(req.params.id)}`, { timeout: 5000 }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bots/:id/restart', auth, (req, res) => {
  try { execSync(`pm2 restart ${getPm2Name(req.params.id)}`, { timeout: 10000 }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bots/:id/reset-auth', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);
  // Legacy bots store auth in the root auth_info_baileys directory
  const authDir = cfg.isLegacy
    ? path.join(BOT_ROOT, 'auth_info_baileys')
    : path.join(BOTS_DIR, id, 'wa_auth');
  try { execSync(`pm2 stop ${getPm2Name(id)}`, { timeout: 5000 }); } catch {}
  fs.rmSync(authDir, { recursive: true, force: true });
  fs.mkdirSync(authDir, { recursive: true });
  res.json({ ok: true });
});

// ── QR Code — push model (bot-runner → portal disk → browser polls) ─
// Internal: bot-runner POSTs here to save QR/status to disk
app.post('/api/bots/:id/qr-push', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== INTERNAL_SECRET) return res.status(401).end();

  const { event } = req.body; // 'data:image/...' | 'CONNECTED' | 'NOT_STARTED'
  if (!event) return res.status(400).end();

  saveQrState(req.params.id, event);
  res.json({ ok: true });
});

// Browser polls this every 3s — returns current QR state from disk
app.get('/api/bots/:id/qr-status', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);

  // Legacy bots: derive from PM2 status only
  if (cfg.isLegacy) {
    const pm2 = getBotPm2Status(id);
    return res.json({ status: pm2.status === 'online' ? 'CONNECTED' : 'LEGACY_BOT' });
  }

  // Try disk state first, then derive from PM2 + auth files
  const diskState = loadQrState(id);
  if (diskState) {
    const isImage = diskState.startsWith('data:image');
    return res.json({ status: isImage ? 'QR' : diskState, qr: isImage ? diskState : null });
  }

  const derived = deriveQrState(id);
  if (derived) return res.json({ status: derived });

  // Bot is online but no QR yet — still initialising
  const pm2 = getBotPm2Status(id);
  if (pm2.status === 'online') return res.json({ status: 'WAITING' });

  return res.json({ status: 'NOT_STARTED' });
});

// Keep SSE endpoint alive for backward compat but redirect browsers to polling
app.get('/api/bots/:id/qr-stream', auth, (req, res) => {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current state immediately, then close — browser will switch to polling
  const cfg = loadBotConfig(id);
  if (cfg.isLegacy) {
    const pm2 = getBotPm2Status(id);
    res.write(`data: ${pm2.status === 'online' ? 'CONNECTED' : 'LEGACY_BOT'}\n\n`);
    res.end();
    return;
  }
  const diskState = loadQrState(id);
  if (diskState) { res.write(`data: ${diskState}\n\n`); res.end(); return; }
  const derived = deriveQrState(id);
  if (derived) { res.write(`data: ${derived}\n\n`); res.end(); return; }
  // No state yet — close so browser falls back to polling
  res.write(': no-state\n\n');
  res.end();
});

// ── KB Management (per bot) ───────────────────────────
function getBotKbInboxPath(botId) {
  const cfg = loadBotConfig(botId);
  return cfg.isLegacy
    ? path.join(BOT_ROOT, 'kb_inbox')
    : path.join(BOTS_DIR, botId, 'kb_inbox');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const inbox = getBotKbInboxPath(req.params.id);
    fs.mkdirSync(inbox, { recursive: true });
    cb(null, inbox);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/bots/:id/kb/upload', auth, upload.array('files'), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });
  res.json({ ok: true, files: req.files.map(f => f.originalname) });
});

// EventSource only supports GET — ingest must be GET
app.get('/api/bots/:id/kb/ingest', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);
  const botDir = cfg.isLegacy ? BOT_ROOT : path.join(BOTS_DIR, id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const proc = exec('node src/cli.mjs ingest', {
    cwd: BOT_ROOT,
    env: {
      ...process.env,
      BOT_ID: id,
      BOT_DIR: botDir,
      BOT_CONFIG_PATH: cfg.isLegacy ? path.join(BOT_ROOT, 'bot-config.json') : path.join(botDir, 'config.json'),
      BOT_KB_STORE: cfg.isLegacy ? path.join(BOT_ROOT, 'kb_store', 'kb.json') : path.join(botDir, 'kb_store', 'kb.json'),
      BOT_KB_INBOX: cfg.isLegacy ? path.join(BOT_ROOT, 'kb_inbox') : path.join(botDir, 'kb_inbox'),
    },
  });
  proc.stdout.on('data', d => res.write(`data: ${d.trim()}\n\n`));
  proc.stderr.on('data', d => res.write(`data: ${d.trim()}\n\n`));
  proc.on('close', () => { res.write('data: __DONE__\n\n'); res.end(); });
});

function getBotKbStorePath(botId) {
  const cfg = loadBotConfig(botId);
  return cfg.isLegacy
    ? path.join(BOT_ROOT, 'kb_store', 'kb.json')
    : path.join(BOTS_DIR, botId, 'kb_store', 'kb.json');
}

app.get('/api/bots/:id/kb/sources', auth, (req, res) => {
  const storePath = getBotKbStorePath(req.params.id);
  if (!fs.existsSync(storePath)) return res.json({ sources: [], totalChunks: 0 });
  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const map = new Map();
    for (const c of data.chunks || []) map.set(c.source, (map.get(c.source) || 0) + 1);
    res.json({ sources: [...map.entries()].map(([source, chunks]) => ({ source, chunks })), totalChunks: data.chunks?.length || 0 });
  } catch { res.json({ sources: [], totalChunks: 0 }); }
});

app.delete('/api/bots/:id/kb/source/:name', auth, (req, res) => {
  const storePath = getBotKbStorePath(req.params.id);
  if (!fs.existsSync(storePath)) return res.json({ ok: true });
  const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const before = data.chunks.length;
  data.chunks = data.chunks.filter(c => c.source !== req.params.name);
  fs.writeFileSync(storePath, JSON.stringify(data));
  res.json({ ok: true, removed: before - data.chunks.length });
});

// ── KB — ingest URL (scrape website and add to KB) ────
app.post('/api/bots/:id/kb/ingest-url', auth, (req, res) => {
  const { id } = req.params;
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Valid URL required' });

  const cfg = loadBotConfig(id);
  // Bug fix: validate bot exists before starting SSE stream
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });

  const botDir = cfg.isLegacy ? BOT_ROOT : path.join(BOTS_DIR, id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const script = `
    import { ingestUrl } from './src/ingest.mjs';
    try {
      const r = await ingestUrl(${JSON.stringify(url)});
      process.stdout.write('Added ' + r.chunks + ' chunks from ' + r.source + '\\n');
    } catch(e) {
      process.stderr.write('Error: ' + e.message + '\\n');
      process.exit(1);
    }
  `;

  const proc = exec('node --input-type=module', {
    cwd: BOT_ROOT,
    timeout: 60000, // Bug fix: kill child process after 60s to avoid hanging connections
    env: {
      ...process.env,
      BOT_ID: id,
      BOT_DIR: botDir,
      BOT_CONFIG_PATH: cfg.isLegacy ? path.join(BOT_ROOT, 'bot-config.json') : path.join(botDir, 'config.json'),
      BOT_KB_STORE: cfg.isLegacy ? path.join(BOT_ROOT, 'kb_store', 'kb.json') : path.join(botDir, 'kb_store', 'kb.json'),
      BOT_KB_INBOX: cfg.isLegacy ? path.join(BOT_ROOT, 'kb_inbox') : path.join(botDir, 'kb_inbox'),
    },
  });

  proc.stdin.write(script);
  proc.stdin.end();
  proc.stdout.on('data', d => res.write(`data: ${d.trim()}\n\n`));
  proc.stderr.on('data', d => res.write(`data: ${d.trim()}\n\n`));
  proc.on('close', code => {
    res.write(`data: ${code === 0 ? '__DONE__' : '__ERROR__'}\n\n`);
    res.end();
  });
});

// ── Campaigns ─────────────────────────────────────────
// Campaign data lives in bots/<id>/campaigns/<campaign-id>/
// Each campaign has: meta.json (name, message, type, status) + contacts.json

function campDir(botId, campId) { return path.join(BOTS_DIR, botId, 'campaigns', campId); }

function listCampaignsForBot(botId) {
  const dir = path.join(BOTS_DIR, botId, 'campaigns');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(id => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8'));
      const contacts = JSON.parse(fs.readFileSync(path.join(dir, id, 'contacts.json'), 'utf8') || '[]');
      return { ...meta, totalContacts: contacts.length, sentCount: contacts.filter(c => c.status === 'sent').length };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function loadCampaignMeta(botId, campId) {
  try { return JSON.parse(fs.readFileSync(path.join(campDir(botId, campId), 'meta.json'), 'utf8')); } catch { return null; }
}

function loadCampaignContacts(botId, campId) {
  try { return JSON.parse(fs.readFileSync(path.join(campDir(botId, campId), 'contacts.json'), 'utf8')); } catch { return []; }
}

function saveCampaignContacts(botId, campId, contacts) {
  fs.writeFileSync(path.join(campDir(botId, campId), 'contacts.json'), JSON.stringify(contacts, null, 2));
}

function saveCampaignMeta(botId, campId, meta) {
  fs.writeFileSync(path.join(campDir(botId, campId), 'meta.json'), JSON.stringify(meta, null, 2));
}

// GET /api/bots/:id/campaigns
app.get('/api/bots/:id/campaigns', auth, (req, res) => {
  const cfg = loadBotConfig(req.params.id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  res.json({ campaigns: listCampaignsForBot(req.params.id) });
});

// POST /api/bots/:id/campaigns — create campaign
app.post('/api/bots/:id/campaigns', auth, (req, res) => {
  const { id } = req.params;
  const cfg = loadBotConfig(id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  const { name, message, type, imageData } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });

  const campId = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') + '-' + Date.now();
  const dir = campDir(id, campId);
  fs.mkdirSync(dir, { recursive: true });

  let imagePath = null;
  if (type === 'image' && imageData) {
    // Save base64 image to disk
    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const ext = imageData.match(/^data:image\/(\w+)/)?.[1] || 'jpg';
    imagePath = path.join(dir, `image.${ext}`);
    fs.writeFileSync(imagePath, Buffer.from(base64, 'base64'));
    imagePath = path.relative(BOT_ROOT, imagePath); // store relative path
  }

  const meta = { id: campId, name, message, type: type || 'text', imagePath, status: 'draft', createdAt: new Date().toISOString() };
  saveCampaignMeta(id, campId, meta);
  fs.writeFileSync(path.join(dir, 'contacts.json'), '[]');
  res.json({ ok: true, campaign: meta });
});

// GET /api/bots/:id/campaigns/:campId/contacts
app.get('/api/bots/:id/campaigns/:campId/contacts', auth, (req, res) => {
  const { id, campId } = req.params;
  const cfg = loadBotConfig(id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  res.json({ contacts: loadCampaignContacts(id, campId) });
});

// POST /api/bots/:id/campaigns/:campId/contacts — add contacts (manual or CSV import)
app.post('/api/bots/:id/campaigns/:campId/contacts', auth, (req, res) => {
  const { id, campId } = req.params;
  const cfg = loadBotConfig(id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  const meta = loadCampaignMeta(id, campId);
  if (!meta) return res.status(404).json({ error: 'Campaign not found' });

  const { contacts: incoming } = req.body;
  if (!Array.isArray(incoming) || !incoming.length) return res.status(400).json({ error: 'contacts array required' });

  const existing = loadCampaignContacts(id, campId);
  const existingNums = new Set(existing.map(c => c.number));

  const added = [];
  for (const c of incoming) {
    const number = String(c.number || '').replace(/[^0-9]/g, '');
    if (number.length < 7 || existingNums.has(number)) continue;
    const contact = { id: `${number}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, number, name: c.name || '', status: 'pending', addedAt: new Date().toISOString() };
    existing.push(contact);
    existingNums.add(number);
    added.push(contact);
  }
  saveCampaignContacts(id, campId, existing);
  res.json({ ok: true, added: added.length });
});

// DELETE /api/bots/:id/campaigns/:campId/contacts/:contactId
app.delete('/api/bots/:id/campaigns/:campId/contacts/:contactId', auth, (req, res) => {
  const { id, campId, contactId } = req.params;
  const contacts = loadCampaignContacts(id, campId).filter(c => c.id !== contactId);
  saveCampaignContacts(id, campId, contacts);
  res.json({ ok: true });
});

// POST /api/bots/:id/campaigns/:campId/send — SSE stream, sends pending contacts via bot REST API
app.post('/api/bots/:id/campaigns/:campId/send', auth, async (req, res) => {
  const { id, campId } = req.params;
  const cfg = loadBotConfig(id);
  if (!cfg.id) return res.status(404).json({ error: 'Bot not found' });
  const meta = loadCampaignMeta(id, campId);
  if (!meta) return res.status(404).json({ error: 'Campaign not found' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => res.write(`data: ${msg}\n\n`);

  const contacts = loadCampaignContacts(id, campId);
  const pending = contacts.filter(c => c.status === 'pending');

  if (!pending.length) { send('No pending contacts.'); send('__DONE__'); res.end(); return; }

  // Update campaign status to sending
  saveCampaignMeta(id, campId, { ...meta, status: 'sending' });

  const apiPort = cfg.apiPort || 4001;
  const INTERNAL_SECRET = process.env.PORTAL_INTERNAL_SECRET || 'veyn-internal-2024';
  const minDelay = (cfg.outreachMinDelayMs || 30000);
  const maxDelay = (cfg.outreachMaxDelayMs || 90000);
  const dailyCap = cfg.outreachDailyCap || 30;

  let sent = 0; let failed = 0;

  for (const contact of pending) {
    if (sent >= dailyCap) { send(`Daily cap (${dailyCap}) reached. Stopping.`); break; }

    const body = meta.message.replace(/\{name\}/g, contact.name?.split(' ')[0] || 'there');

    try {
      // Call the bot's own REST API to send the message (bot handles the WA connection)
      const payload = JSON.stringify({ to: contact.number, message: body });
      const botRes = await new Promise((resolve, reject) => {
        const req2 = http.request({
          hostname: '127.0.0.1', port: apiPort, path: '/send', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-internal-secret': INTERNAL_SECRET },
        }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
        req2.on('error', reject);
        req2.write(payload);
        req2.end();
      });

      if (botRes.status === 200) {
        contacts.find(c => c.id === contact.id).status = 'sent';
        contacts.find(c => c.id === contact.id).sentAt = new Date().toISOString();
        sent++;
        send(`[sent ${sent}] ${contact.number} (${contact.name || '—'})`);
      } else {
        throw new Error(`Bot API returned ${botRes.status}: ${botRes.body}`);
      }
    } catch (e) {
      contacts.find(c => c.id === contact.id).status = 'failed';
      contacts.find(c => c.id === contact.id).failReason = e.message;
      failed++;
      send(`[failed] ${contact.number} — ${e.message}`);
    }

    saveCampaignContacts(id, campId, contacts);

    // Throttle between sends
    if (sent + failed < pending.length) {
      const delay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
      send(`       waiting ${Math.round(delay / 1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const allDone = contacts.every(c => c.status !== 'pending');
  saveCampaignMeta(id, campId, { ...meta, status: allDone ? 'done' : 'draft' });
  send(`Done. Sent: ${sent}, Failed: ${failed}.`);
  send('__DONE__');
  res.end();
});

// ── Cost stats ────────────────────────────────────────
// GET /api/bots/:id/cost?days=7
// Returns per-kind token + cost breakdown for the last N days (default 7).
app.get('/api/bots/:id/cost', auth, async (req, res) => {
  const botId = req.params.id;
  const days = Math.min(parseInt(req.query.days) || 7, 90);
  const cfg = loadBotConfig(botId);
  const dbPath = cfg?.isLegacy
    ? path.join(BOT_ROOT, 'kb_store', 'crm.sqlite')
    : path.join(BOTS_DIR, botId, 'kb_store', 'crm.sqlite');
  if (!fs.existsSync(dbPath)) return res.json({ rows: [], totals: {} });
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readonly: true });
    const since = Date.now() - days * 86400 * 1000;
    const rows = db.prepare(`
      SELECT kind,
             SUM(in_tokens)  AS in_tokens,
             SUM(out_tokens) AS out_tokens,
             SUM(total_tokens) AS total_tokens,
             ROUND(SUM(cost_usd), 6) AS cost_usd,
             COUNT(*)        AS calls
      FROM api_usage
      WHERE ts >= ?
      GROUP BY kind
      ORDER BY cost_usd DESC
    `).all(since);
    const totals = db.prepare(`
      SELECT SUM(in_tokens) AS in_tokens,
             SUM(out_tokens) AS out_tokens,
             SUM(total_tokens) AS total_tokens,
             ROUND(SUM(cost_usd), 6) AS cost_usd,
             COUNT(*) AS calls
      FROM api_usage WHERE ts >= ?
    `).get(since);
    db.close();
    res.json({ rows, totals, days });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Test webhook ──────────────────────────────────────
// Fires a sample payload to the configured N8N lead webhook so the user can
// verify the URL is correct without waiting for a real lead.
app.post('/api/test-webhook', auth, async (req, res) => {
  const { url, botId } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wa_id: 'test_000000000',
        name: 'Test Lead',
        email: 'test@example.com',
        interest: 'I want to buy / send me pricing',
        bot: botId || 'portal-test',
        ts: new Date().toISOString(),
        _test: true,
      }),
    });
    const text = await r.text().catch(() => '');
    res.json({ ok: true, status: r.status, body: text.slice(0, 200) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Test Chat (portal playground) ──────────────────────
// Proxies a chat message to the bot's widget server internally.
// This way the portal can test any bot without exposing widgetPort publicly.
app.post('/api/bots/:id/chat', auth, async (req, res) => {
  const botId = req.params.id;
  const { message, sessionId } = req.body;
  if (!message?.trim() || !sessionId) {
    return res.status(400).json({ error: 'message and sessionId are required' });
  }
  const cfg = loadBotConfig(botId);
  if (!cfg) return res.status(404).json({ error: 'Bot not found' });
  const widgetPort = cfg.widgetPort;
  if (!widgetPort) {
    return res.status(503).json({ error: 'This bot has no widgetPort configured. Add "widgetPort": <port> to its config.json and restart it.' });
  }
  try {
    const r = await fetch(`http://localhost:${widgetPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: `portal_${sessionId}`, message: message.trim(), name: 'Portal Tester' }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 502).json(data);
  } catch (e) {
    const offline = e.code === 'ECONNREFUSED' || e.name === 'TimeoutError';
    res.status(502).json({
      error: offline
        ? `Bot widget server is not running on port ${widgetPort}. Make sure the bot is started in PM2.`
        : e.message,
    });
  }
});

// ── Start ──────────────────────────────────────────────
const PORT = process.env.PORTAL_API_PORT || 3001;
app.listen(PORT, () => console.log(`Portal API running on port ${PORT}`));
