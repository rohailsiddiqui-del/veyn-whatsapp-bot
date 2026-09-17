#!/usr/bin/env node
// Multi-bot runner. Each bot instance runs this with --bot-id <id>
// Loads config, KB, and WhatsApp auth from bots/<bot-id>/
// QR codes are broadcast via HTTP SSE on the portal API.
//
// Usage: node src/bot-runner.mjs --bot-id <id>

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import pino from "pino";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { logApiUsage } from "./crm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Parse --bot-id arg
function argval(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const BOT_ID = argval("--bot-id") || process.env.BOT_ID;
if (!BOT_ID) { console.error("ERROR: --bot-id required"); process.exit(1); }

const BOT_DIR = path.join(ROOT, "bots", BOT_ID);
const CONFIG_PATH = path.join(BOT_DIR, "config.json");
// isLegacy bots (e.g. Veyn) keep auth in root wa_auth/ — read config early to resolve this
const _earlyConfig = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; } })();
const AUTH_DIR = _earlyConfig.isLegacy
  ? path.join(ROOT, "wa_auth")
  : path.join(BOT_DIR, "wa_auth");
const KB_STORE = path.join(BOT_DIR, "kb_store", "kb.json");
const KB_INBOX = path.join(BOT_DIR, "kb_inbox");

// Ensure directories exist
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(path.join(BOT_DIR, "kb_store"), { recursive: true });
fs.mkdirSync(KB_INBOX, { recursive: true });

// Load bot config
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

// Load env from root .env
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

// Push QR/status events to the portal API (which holds SSE clients for the browser).
// This avoids needing a separate SSE server per bot and a proxy in the portal.
const PORTAL_API = process.env.PORTAL_API_URL || "http://localhost:3001";
const INTERNAL_SECRET = process.env.PORTAL_INTERNAL_SECRET || "veyn-internal-2024";

function pushToPortal(event) {
  const body = JSON.stringify({ event });
  const url = new URL(`/api/bots/${BOT_ID}/qr-push`, PORTAL_API);
  const opts = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-internal-secret": INTERNAL_SECRET,
    },
  };
  const req = http.request(opts, (res) => {
    res.resume(); // drain response
  });
  req.on("error", (e) => {
    console.error(`[${BOT_ID}] QR push failed:`, e.message);
  });
  req.write(body);
  req.end();
}

// Dynamic imports for bot logic using bot-specific paths
async function getHandleMessage() {
  // Override CONFIG paths for this bot instance
  process.env.BOT_ID = BOT_ID;
  process.env.BOT_DIR = BOT_DIR;
  process.env.BOT_KB_STORE = KB_STORE;
  process.env.BOT_KB_INBOX = KB_INBOX;
  process.env.BOT_CONFIG_PATH = CONFIG_PATH;

  const { handleMessage } = await import("./handle.mjs");
  return handleMessage;
}

// Download a WhatsApp media message (voice note, image, etc.) as a Buffer.
// Returns null on failure — caller should skip silently.
async function downloadMedia(sock, msg) {
  try {
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
    const buffer = await downloadMediaMessage(
      msg, "buffer", {},
      { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
    );
    return buffer;
  } catch (e) {
    console.error(`[media] download failed:`, e?.message);
    return null;
  }
}

// Cache Baileys WA version on disk to avoid a slow HTTP fetch on every restart
const VERSION_CACHE = path.join(ROOT, ".baileys-version.json");
async function getWaVersion() {
  try {
    const cached = JSON.parse(fs.readFileSync(VERSION_CACHE, "utf8"));
    // Re-fetch if cache is older than 24 hours
    if (Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
      return { version: cached.version };
    }
  } catch {}
  // Fetch fresh and cache it
  const result = await fetchLatestBaileysVersion();
  try { fs.writeFileSync(VERSION_CACHE, JSON.stringify({ version: result.version, ts: Date.now() })); } catch {}
  return result;
}

// Capture process start time so we can reject messages sent before this run.
// Baileys replays unacknowledged messages from prior sessions as type:"notify"
// on reconnect — these always have timestamps BEFORE the current process started.
const PROCESS_START_MS = Date.now();

let isConnected = false;
let handleMessage;
let retryCount = 0;
let qrCount = 0;          // QR attempts in current connection session
let keepaliveTimer = null; // presence keepalive interval
let activeSock = null;    // reference to current socket for outbound sends

// Deduplicate Baileys message events — the same msgId can arrive twice on reconnect.
const _processedIds = new Set();
function _isDuplicate(id) {
  if (!id || _processedIds.has(id)) return true;
  _processedIds.add(id);
  setTimeout(() => _processedIds.delete(id), 90000); // expire after 90s
  return false;
}

const MAX_QR_ATTEMPTS = 3; // stop looping QRs after this many — avoids number restriction

// --- REST API for n8n / external integrations ---
// Endpoints:
//   POST /send               { to, message }  → send WhatsApp message
//   GET  /crm/contacts       → list all contacts
//   GET  /crm/handoffs       → open handoffs
//   POST /crm/handoffs/:id/resolve → resolve a handoff
//   GET  /crm/stats          → overall stats
// All requests require header: x-internal-secret: <INTERNAL_SECRET>

// API port: env override > config apiPort > default 4001
// Each bot should have a unique apiPort in its config.json to avoid conflicts
const API_PORT = Number(process.env.BOT_API_PORT || loadConfig().apiPort || 4001);

function startApiServer() {
  const server = http.createServer(async (req, res) => {
    // Auth check
    if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const url = new URL(req.url, `http://localhost:${API_PORT}`);
    const method = req.method.toUpperCase();

    // Parse JSON body helper
    const body = () => new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => raw += c);
      req.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({}); }
      });
    });

    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    try {
      // Lazy-load crm to avoid circular imports at module level
      const crm = await import("./crm.mjs");

      // POST /send
      if (method === "POST" && url.pathname === "/send") {
        if (!isConnected || !activeSock) {
          return json(503, { error: "Bot not connected to WhatsApp" });
        }
        const { to, message } = await body();
        if (!to || !message) return json(400, { error: "to and message are required" });
        const jid = `${String(to).replace(/[^0-9]/g, "")}@s.whatsapp.net`;
        await activeSock.sendMessage(jid, { text: message });
        crm.logMessage(String(to).replace(/[^0-9]/g, ""), "out", message, "outbound_api");
        return json(200, { ok: true });
      }

      // GET /crm/contacts
      if (method === "GET" && url.pathname === "/crm/contacts") {
        const rows = crm.getDb().prepare("SELECT * FROM contacts ORDER BY last_seen DESC LIMIT 500").all();
        return json(200, rows);
      }

      // GET /crm/handoffs
      if (method === "GET" && url.pathname === "/crm/handoffs") {
        return json(200, crm.listHandoffs("open"));
      }

      // POST /crm/handoffs/:id/resolve
      const resolveMatch = url.pathname.match(/^\/crm\/handoffs\/(\d+)\/resolve$/);
      if (method === "POST" && resolveMatch) {
        crm.resolveHandoff(Number(resolveMatch[1]));
        return json(200, { ok: true });
      }

      // GET /crm/stats
      if (method === "GET" && url.pathname === "/crm/stats") {
        return json(200, crm.stats());
      }

      // POST /scrape — trigger a background website crawl + KB ingest
      // Body: { url: string, maxPages?: number, maxDepth?: number }
      if (method === "POST" && url.pathname === "/scrape") {
        const { url: scrapeUrl, maxPages = 30, maxDepth = 3 } = await body();
        if (!scrapeUrl || !/^https?:\/\//i.test(scrapeUrl)) {
          return json(400, { error: "url is required and must be a valid http(s) URL" });
        }
        // Kick off in background — returns immediately so the portal doesn't hang
        const { scrapeAndIngest } = await import("./scraper.mjs");
        scrapeAndIngest(scrapeUrl, {
          maxPages: Math.min(Number(maxPages) || 30, 100),
          maxDepth: Math.min(Number(maxDepth) || 3, 5),
          onProgress: ({ url: u, status, chunks }) => {
            if (status === "ok") console.log(`[${BOT_ID}][scrape] ${u} → ${chunks} chunks`);
          },
        }).then((r) => {
          console.log(`[${BOT_ID}][scrape] Done: ${r.ok} pages, ${r.totalChunks} chunks, ${r.errors} errors`);
        }).catch((e) => {
          console.error(`[${BOT_ID}][scrape] Failed:`, e.message);
        });
        return json(202, { ok: true, message: `Scraping ${scrapeUrl} in background (max ${maxPages} pages)` });
      }

      json(404, { error: "Not found" });
    } catch (e) {
      console.error(`[${BOT_ID}] API error:`, e.message);
      json(500, { error: e.message });
    }
  });

  server.listen(API_PORT, "127.0.0.1", () => {
    console.log(`[${BOT_ID}] REST API listening on http://127.0.0.1:${API_PORT}`);
  });
}

async function start() {
  if (!handleMessage) handleMessage = await getHandleMessage();

  const cfg = loadConfig();
  const botName = cfg.botName || BOT_ID;

  // Reset QR counter for this connection attempt
  qrCount = 0;

  // If creds already exist, push CONNECTED immediately so the portal browser tab
  // doesn't get stuck on "Checking connection..." after a restart
  const credsFile = path.join(AUTH_DIR, "creds.json");
  if (fs.existsSync(credsFile)) {
    pushToPortal("CONNECTED");
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await getWaVersion();
  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version, auth: state, logger,
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  activeSock = sock;
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      qrCount++;
      if (qrCount > MAX_QR_ATTEMPTS) {
        // Too many unscanned QRs — stop to avoid WhatsApp number restriction.
        // PM2 will NOT auto-restart (process.exit(0) = clean stop).
        // User must manually: pm2 restart <bot> and scan immediately.
        console.log(`[${botName}] QR limit reached (${MAX_QR_ATTEMPTS} attempts). Stopping to protect number.`);
        console.log(`[${botName}] Run: pm2 restart ${BOT_ID} — then scan QR within 20 seconds.`);
        pushToPortal("QR_LIMIT");
        sock.end();
        process.exit(0);
      }
      console.log(`[${botName}] QR code generated (attempt ${qrCount}/${MAX_QR_ATTEMPTS}) — scan now`);
      try {
        const dataUrl = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
        pushToPortal(dataUrl);
      } catch (e) {
        console.error(`[${botName}] QR generation error:`, e.message);
      }
    }

    if (connection === "open") {
      isConnected = true;
      retryCount = 0;
      qrCount = 0;
      pushToPortal("CONNECTED");
      console.log(`[${botName}] Connected to WhatsApp ✓`);

      // Keepalive: send presence ping every 30s to keep session warm
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(async () => {
        if (!isConnected || !activeSock) return;
        try {
          await activeSock.sendPresenceUpdate("available");
        } catch {
          // ignore — disconnect handler will reconnect
        }
      }, 30 * 1000);
    }

    if (connection === "close") {
      isConnected = false;
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[${botName}] Disconnected (code ${code}).${loggedOut ? " Logged out." : " Reconnecting..."}`);
      if (loggedOut) {
        // Clear stale auth so next PM2 restart generates a fresh QR
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
          console.log(`[${botName}] Auth cleared — rescan QR to reconnect`);
        } catch {}
        pushToPortal("NOT_STARTED");
        process.exit(0); // clean exit; PM2 will restart and show fresh QR
      } else {
        // Exponential backoff: 5s, 10s, 20s, 40s... capped at 5 minutes
        // 409 conflict gets a fixed 60s delay to let the other session clear
        const isConflict = code === 409;
        const delay = isConflict
          ? 60000
          : Math.min(5000 * Math.pow(2, retryCount), 300000);
        retryCount++;
        console.log(`[${botName}] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${retryCount})...`);
        setTimeout(() => start().catch(e => {
          console.error(`[${BOT_ID}] Fatal (reconnect):`, e);
          process.exit(1);
        }), delay);
      }
    }
  });

  // Only listen to inbound messages when mode is 'inbound' or 'both'.
  // Pure 'outbound' bots don't auto-reply — they only send.
  const botMode = cfg.mode || "inbound";
  const handleInbound = botMode === "inbound" || botMode === "both";

  sock.ev.on("messages.upsert", async ({ messages, type } = {}) => {
    if (!handleInbound) return;
    if (type !== "notify") return;
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) continue;

        // Replay guard: skip messages sent before this process started.
        // Baileys replays unacknowledged messages from prior sessions as type:"notify"
        // on reconnect — they always have timestamps BEFORE the current boot time.
        // 10s clock-skew buffer covers minor client/server time drift.
        const msgTs = Number(msg.messageTimestamp) * 1000; // Baileys gives seconds
        if (msgTs && msgTs < PROCESS_START_MS - 10_000) {
          console.log(`[${botName}][skip-replay] ${jid.split("@")[0]} msg ${msg.key.id} is ${Math.round((PROCESS_START_MS - msgTs) / 1000)}s old — skipping replay`);
          continue;
        }

        // In-memory dedup for same-process rapid duplicates (fast path).
        // Persistent dedup via DB handles cross-restart replays (in handleMessage).
        if (_isDuplicate(msg.key.id)) continue;

        const m = msg.message;
        const waId = jid.split("@")[0];
        const name = msg.pushName || "";

        // Extract text — handles plain text, extended text, image captions, and voice notes
        let text = (
          m?.conversation ||
          m?.extendedTextMessage?.text ||
          m?.imageMessage?.caption ||
          ""
        ).trim();

        // Image message — visual analysis + OCR via Gemini multimodal
        const isImage = !!(m?.imageMessage);
        if (isImage) {
          const buf = await downloadMedia(sock, msg);
          if (buf) {
            const { analyzeImage } = await import("./gemini.mjs");
            const { answer: answerFn } = await import("./answer.mjs");
            // Detect mime type from Baileys metadata (default jpeg)
            const mime = m.imageMessage?.mimetype || "image/jpeg";
            // Build system prompt and KB context the same way the text handler does
            const { CONFIG } = await import("./config.mjs");
            const { loadStore, search } = await import("./store.mjs");
            const { embedWithUsage } = await import("./gemini.mjs");
            const { logApiUsage: logUsage } = await import("./crm.mjs");

            let kbContext = "";
            try {
              if (text) {
                // Embed the caption to retrieve relevant KB chunks
                const { values: qVec, usage: eUsage } = await embedWithUsage(text, "RETRIEVAL_QUERY");
                logUsage(waId, CONFIG.embedModel, "embed", eUsage.in, eUsage.out);
                const store = loadStore();
                const hits = search(store, qVec, CONFIG.topK).filter(c => c.score >= CONFIG.minScore);
                kbContext = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n---\n\n");
              }
            } catch {}

            await sock.sendPresenceUpdate("composing", jid).catch(() => {});
            const { reply: imageReply, usage: imgUsage } = await analyzeImage(buf, {
              mimeType: mime,
              caption: text,
              kbContext,
            });
            logUsage(waId, "gemini-2.5-flash", "image_analyze", imgUsage.in, imgUsage.out);

            if (imageReply) {
              const typingMs = Math.min(3000, Math.max(800, imageReply.length * 16));
              await new Promise(r => setTimeout(r, typingMs));
              await sock.sendPresenceUpdate("paused", jid).catch(() => {});
              await sock.sendMessage(jid, { text: imageReply });
              console.log(`[${botName}][image→reply] ${waId}: ${imageReply.slice(0, 80)}...`);
            }
            continue; // image handled — skip text pipeline below
          }
        }

        // Voice note / PTT — transcribe via Gemini
        const isVoice = !!(m?.audioMessage || m?.pttMessage);
        if (!text && isVoice) {
          const { transcribeAudio } = await import("./gemini.mjs");
          const buf = await downloadMedia(sock, msg);
          if (buf) {
            const { text: transcript, usage: transcribeUsage } = await transcribeAudio(buf);
            if (transcript) {
              text = transcript;
              logApiUsage(waId, "gemini-2.5-flash", "transcribe", transcribeUsage.in, transcribeUsage.out);
              console.log(`[${botName}][voice→text] ${waId}: ${text}`);
            }
          }
        }

        if (!text) continue;

        console.log(`[${botName}][in] ${waId}: ${text}`);
        await sock.sendPresenceUpdate("composing", jid).catch(() => {});
        const reply = await handleMessage({ waId, name, text, msgId: msg.key.id });
        if (reply === null) continue; // DB-level duplicate — already replied in a prior run
        // Human-like typing delay: scaled to reply length, 1s min – 3.5s max
        const typingMs = Math.min(3500, Math.max(1000, reply.length * 18)) + Math.random() * 600;
        await new Promise(r => setTimeout(r, typingMs));
        await sock.sendPresenceUpdate("paused", jid).catch(() => {});
        await sock.sendMessage(jid, { text: reply });
        console.log(`[${botName}][out] ${waId}: ${reply.slice(0, 80)}...`);

        // Voice note — only when bot features include voice and TTS is available.
        const botFeatures = loadConfig().features || 'text';
        if (botFeatures === 'text_image_voice') {
          try {
            const { textToVoice } = await import('./tts.mjs');
            const lang = loadConfig().language || 'English';
            const audioBuffer = await textToVoice(reply, lang);
            if (audioBuffer) {
              await sock.sendPresenceUpdate("recording", jid).catch(() => {});
              await new Promise(r => setTimeout(r, 800));
              await sock.sendMessage(jid, {
                audio: audioBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,   // renders as voice note (waveform UI)
              });
              console.log(`[${botName}][voice] sent ${audioBuffer.length} bytes to ${waId}`);
            }
          } catch (e) {
            console.error(`[${botName}][voice] TTS error:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[${botName}] Error:`, e?.message);
      }
    }
  });
}

// --- Public Widget Chat Server ---
// Enabled by setting widgetPort in config.json. Listens on 0.0.0.0 (public).
// Serves GET /widget.js (the embeddable script) and POST /chat (message handler).
// No secret header required — this is intentionally public-facing.

const WIDGET_PORT = Number(loadConfig().widgetPort || 0);

// Read the widget JS source from disk once at startup
const WIDGET_JS_PATH = path.join(ROOT, "widget", "chat-widget.js");

// Simple in-memory IP rate limiter
const _ipBuckets = new Map();
const WIDGET_RATE_LIMIT = 20;       // max requests per window per IP
const WIDGET_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isWidgetRateLimited(ip) {
  const now = Date.now();
  let entry = _ipBuckets.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + WIDGET_RATE_WINDOW_MS };
  }
  entry.count++;
  _ipBuckets.set(ip, entry);
  return entry.count > WIDGET_RATE_LIMIT;
}

// Prune stale IP buckets hourly to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _ipBuckets) {
    if (now > e.reset) _ipBuckets.delete(ip);
  }
}, WIDGET_RATE_WINDOW_MS);

function startWidgetServer() {
  if (!WIDGET_PORT) return;

  const cfg = loadConfig();
  const botName = cfg.botName || BOT_ID;

  const widgetServer = http.createServer(async (req, res) => {
    // CORS — allow any origin so the widget works on any customer website
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${WIDGET_PORT}`);

    const jsonRes = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // GET /widget.js — serve the embeddable chat widget script
    if (req.method === "GET" && url.pathname === "/widget.js") {
      try {
        const src = fs.readFileSync(WIDGET_JS_PATH, "utf8");
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache",
        });
        res.end(src);
      } catch {
        res.writeHead(404);
        res.end("// widget.js not found");
      }
      return;
    }

    // POST /chat — receive a message from the web widget and return a reply
    if (req.method === "POST" && url.pathname === "/chat") {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (isWidgetRateLimited(ip)) {
        return jsonRes(429, { error: "Too many messages — please slow down." });
      }

      const rawBody = await new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      });

      const { sessionId, message, name } = rawBody;
      if (!sessionId || !message?.trim()) {
        return jsonRes(400, { error: "sessionId and message are required" });
      }

      // Use web_ prefix to distinguish widget sessions from WhatsApp numbers in the CRM
      const waId = `web_${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;

      try {
        const { handleMessage } = await import("./handle.mjs");
        const reply = await handleMessage({ waId, name: (name || "Web Visitor").slice(0, 64), text: message.trim() });
        return jsonRes(200, { reply });
      } catch (e) {
        console.error(`[${botName}][widget] Error:`, e.message);
        return jsonRes(500, { error: "Something went wrong — please try again." });
      }
    }

    jsonRes(404, { error: "Not found" });
  });

  widgetServer.listen(WIDGET_PORT, "0.0.0.0", () => {
    console.log(`[${botName}] Widget server listening on 0.0.0.0:${WIDGET_PORT}`);
    console.log(`[${botName}] Widget embed: <script src="http://<YOUR-IP>:${WIDGET_PORT}/widget.js" data-bot-url="http://<YOUR-IP>:${WIDGET_PORT}"></script>`);
  });
}

const _crashLog = path.join(ROOT, `crash-${BOT_ID}.log`);
function _logCrash(msg) {
  try {
    fs.appendFileSync(_crashLog, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}
process.on('exit', (code) => {
  _logCrash(`EXIT code=${code} pid=${process.pid}`);
  console.error(`[${BOT_ID}] Process exiting with code ${code}`);
});
process.on('SIGTERM', () => { _logCrash(`SIGTERM pid=${process.pid}`); process.exit(0); });
process.on('SIGINT',  () => { _logCrash(`SIGINT pid=${process.pid}`); process.exit(0); });
process.on('uncaughtException', (e) => {
  _logCrash(`uncaughtException: ${e.stack || e.message}`);
  console.error(`[${BOT_ID}] Uncaught exception:`, e.message, e.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  _logCrash(`unhandledRejection: ${msg}`);
  console.error(`[${BOT_ID}] Unhandled rejection:`, msg);
  process.exit(1);
});

startApiServer();
startWidgetServer();
start().catch(e => {
  console.error(`[${BOT_ID}] Fatal:`, e);
  process.exit(1);
});
