#!/usr/bin/env node
// Standalone WhatsApp service for Veyn Assistant — PURE GEMINI.
// Connects directly to WhatsApp via Baileys (no OpenClaw, no Claude).
// Each inbound message runs the existing handle.mjs (Gemini RAG + CRM) and
// the reply is sent back as a single WhatsApp message.
//
// Run:  node src/whatsapp.mjs
// First run prints a QR code — scan it from the bot's WhatsApp phone
// (Linked Devices -> Link a Device). Auth is saved in ./wa_auth/ so later
// runs reconnect without re-scanning.
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleMessage } from "./handle.mjs";
import { requireKey } from "./config.mjs";

requireKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "wa_auth");

// Quiet logger; Baileys is chatty at info level.
const logger = pino({ level: "warn" });

// Extract plain text from the many WhatsApp message shapes.
function extractText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ""
  ).trim();
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    // We are a headless bot; never sync full history.
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\n[Veyn Assistant] Scan this QR from WhatsApp > Linked Devices:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("[Veyn Assistant] Connected to WhatsApp. Bot is live (pure Gemini).");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(
        `[Veyn Assistant] Connection closed (code ${code}).` +
          (loggedOut ? " Logged out — delete wa_auth/ and re-scan." : " Reconnecting...")
      );
      if (!loggedOut) start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        // Ignore our own outgoing messages and status broadcasts.
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) continue;

        const text = extractText(msg);
        if (!text) continue;

        const waId = jid.split("@")[0];
        const name = msg.pushName || "";

        console.log(`[in] ${waId} (${name}): ${text}`);

        // Typing indicator while we think.
        await sock.sendPresenceUpdate("composing", jid).catch(() => {});

        const reply = await handleMessage({ waId, name, text });

        await sock.sendPresenceUpdate("paused", jid).catch(() => {});
        // Single send — no splitting.
        await sock.sendMessage(jid, { text: reply });
        console.log(`[out] ${waId}: ${reply.slice(0, 80)}${reply.length > 80 ? "..." : ""}`);
      } catch (e) {
        console.error("[error] handling message:", e?.message || e);
      }
    }
  });
}

start().catch((e) => {
  console.error("[Veyn Assistant] Fatal:", e);
  process.exit(1);
});
