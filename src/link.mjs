#!/usr/bin/env node
// One-off WhatsApp linking helper for Veyn Assistant.
// Connects with the same wa_auth/ the bot uses, saves the pairing QR as a PNG
// (qr.png in the project root) so it can be scanned from an image, and exits
// once the link is established. Run:  node src/link.mjs
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "wa_auth");
const QR_PNG = path.join(__dirname, "..", "qr.png");

const logger = pino({ level: "silent" });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      await QRCode.toFile(QR_PNG, qr, { width: 512, margin: 2 });
      console.log(`[link] QR saved to ${QR_PNG} — scan it from WhatsApp > Linked Devices.`);
    }
    if (connection === "open") {
      console.log("[link] Linked successfully. Auth saved. You can close this.");
      // Give creds a moment to persist, then exit so the bot can take over.
      setTimeout(() => process.exit(0), 1500);
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("[link] Logged out. Delete wa_auth/ and retry.");
        process.exit(1);
      }
      // While waiting for the scan WhatsApp may cycle the connection; keep going.
      start();
    }
  });
}

start().catch((e) => {
  console.error("[link] Fatal:", e?.message || e);
  process.exit(1);
});
