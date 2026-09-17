#!/usr/bin/env node
// Cold outreach sender for Veyn Assistant.
// Connects to WhatsApp via Baileys (reusing the saved auth in ../wa_auth/),
// reads a target list, and sends the campaign message to each number with
// slow-and-safe throttling. Every send is logged to the CRM and the contact
// is tagged with the campaign so their replies route on-topic.
//
// Usage:
//   node src/outreach.mjs <campaign> [targetsFile]
//   npm run outreach -- autovox
//   npm run outreach -- autovox targets.csv
//
// Targets file (one per line):  number,Name   e.g.
//   923001234567,Ahmed Khan
//   447700900123,Sarah
// Lines starting with # are ignored. Name is optional.
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, requireKey } from "./config.mjs";
import { upsertContact, setCampaign, logOutreach, alreadyContacted } from "./crm.mjs";

requireKey();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Support --bot-id flag so outreach uses the correct per-bot auth folder.
// Falls back to legacy root wa_auth/ for the Veyn bot (isLegacy=true).
function argval(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const BOT_ID = argval("--bot-id") || process.env.BOT_ID || "veyn";
const BOT_DIR = path.join(ROOT, "bots", BOT_ID);
const botConfig = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(BOT_DIR, "config.json"), "utf8")); } catch { return {}; }
})();
const AUTH_DIR = botConfig.isLegacy
  ? path.join(ROOT, "wa_auth")
  : path.join(BOT_DIR, "wa_auth");

const logger = pino({ level: "warn" });

function firstName(name) {
  if (!name) return "there";
  return String(name).trim().split(/\s+/)[0] || "there";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randDelay() {
  const { outreachMinDelayMs: lo, outreachMaxDelayMs: hi } = CONFIG;
  return Math.floor(lo + Math.random() * (hi - lo));
}

// Normalise a number to digits only (E.164 without +).
function normNumber(raw) {
  return String(raw).replace(/[^0-9]/g, "");
}

function parseTargets(file) {
  if (!fs.existsSync(file)) {
    console.error(`Targets file not found: ${file}`);
    process.exit(1);
  }
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [num, ...nameParts] = s.split(",");
    const number = normNumber(num);
    if (number.length < 7) continue; // skip junk
    out.push({ number, name: nameParts.join(",").trim() });
  }
  return out;
}

async function main() {
  const campaignKey = (process.argv[2] || "").trim();
  const targetsArg = (process.argv[3] || "").trim();

  if (!campaignKey || !CONFIG.campaigns[campaignKey]) {
    console.error(
      `Usage: node src/outreach.mjs <campaign> [targetsFile]\n` +
        `Available campaigns: ${Object.keys(CONFIG.campaigns).join(", ") || "(none)"}`
    );
    process.exit(1);
  }

  const campaign = CONFIG.campaigns[campaignKey];
  const targetsFile = targetsArg
    ? path.resolve(ROOT, targetsArg)
    : path.join(ROOT, "outreach_targets.csv");

  const targets = parseTargets(targetsFile);
  if (!targets.length) {
    console.error(`No valid targets in ${targetsFile}`);
    process.exit(1);
  }

  console.log(
    `[outreach] Campaign "${campaignKey}" (${campaign.product}) — ${targets.length} target(s) from ${targetsFile}`
  );
  console.log(
    `[outreach] Throttle: ${CONFIG.outreachMinDelayMs / 1000}-${CONFIG.outreachMaxDelayMs / 1000}s between sends, daily cap ${CONFIG.outreachDailyCap}.`
  );

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger, syncFullHistory: false });
  sock.ev.on("creds.update", saveCreds);

  // Wait for connection to open before sending.
  await new Promise((resolve, reject) => {
    sock.ev.on("connection.update", (u) => {
      if (u.connection === "open") resolve();
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        reject(new Error(`Connection closed before sending (code ${code}). Is the bot linked? Run npm run whatsapp once to link.`));
      }
    });
  });

  console.log("[outreach] Connected. Starting sends...\n");

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    if (sent >= CONFIG.outreachDailyCap) {
      console.log(`[outreach] Daily cap (${CONFIG.outreachDailyCap}) reached. Stopping.`);
      break;
    }

    // Skip if already contacted for this campaign (no double cold-sends).
    if (alreadyContacted(t.number, campaignKey)) {
      console.log(`[skip] ${t.number} — already contacted for ${campaignKey}`);
      skipped++;
      continue;
    }

    const jid = `${t.number}@s.whatsapp.net`;
    const body = campaign.message.replace(/\{name\}/g, firstName(t.name));

    try {
      // Verify the number is actually on WhatsApp before sending.
      const [check] = await sock.onWhatsApp(t.number).catch(() => []);
      if (!check?.exists) {
        console.log(`[fail] ${t.number} — not on WhatsApp`);
        upsertContact(t.number, t.name);
        logOutreach(t.number, t.name, campaignKey, "failed", "not_on_whatsapp");
        failed++;
        continue;
      }

      await sock.sendMessage(jid, { text: body });

      // CRM: record contact, tag campaign, log the send.
      upsertContact(t.number, t.name);
      setCampaign(t.number, campaignKey);
      logOutreach(t.number, t.name, campaignKey, "sent");
      sent++;
      console.log(`[sent ${sent}] ${t.number} (${t.name || "—"})`);
    } catch (e) {
      logOutreach(t.number, t.name, campaignKey, "failed", e?.message || "send_error");
      failed++;
      console.error(`[fail] ${t.number} — ${e?.message || e}`);
    }

    // Throttle between sends (skip after the last one).
    if (sent < CONFIG.outreachDailyCap) {
      const d = randDelay();
      console.log(`       waiting ${Math.round(d / 1000)}s...`);
      await sleep(d);
    }
  }

  console.log(`\n[outreach] Done. Sent: ${sent}, skipped: ${skipped}, failed: ${failed}.`);
  console.log("[outreach] Replies will be handled by the running bot (npm run whatsapp).");
  process.exit(0);
}

main().catch((e) => {
  console.error("[outreach] Fatal:", e?.message || e);
  process.exit(1);
});
