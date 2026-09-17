// Live PFY price fetcher — fetches latest data from Emerging Textiles endpoint.
// Used to inject current-month prices into bot answers, on top of the KB (historical).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Cache: avoid hammering the API. Refresh at most once per hour.
const CACHE_FILE = path.join(ROOT, "kb_store", "pfy_live_cache.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (Date.now() - c.ts < CACHE_TTL_MS) return c;
    }
  } catch {}
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), ...data }), "utf8");
  } catch {}
}

// Parse a CSV line handling quoted fields
function parseLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (const c of line) {
    if (c === '"' || c === "'") { inQ = !inQ; }
    else if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

// Fetch CSV from endpoint and extract latest + recent rows
async function fetchFromEndpoint(apiUrl) {
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  return parseLatestFromCsv(text);
}

// Read from local CSV file as fallback
function readFromLocalFile() {
  const kbInbox = path.join(ROOT, "kb_inbox");
  if (!fs.existsSync(kbInbox)) return null;
  const files = fs.readdirSync(kbInbox).filter(f => /\.csv$/i.test(f));
  if (!files.length) return null;
  // prefer PFY-named file
  const pfy = files.find(f => /PFY/i.test(f)) || files[0];
  const text = fs.readFileSync(path.join(kbInbox, pfy), "utf8");
  return parseLatestFromCsv(text);
}

function parseLatestFromCsv(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find first data row (month + year pattern)
  const dataStart = lines.findIndex(l =>
    /^\s*["']?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}/.test(l)
  );
  if (dataStart === -1) return null;

  const dataLines = lines.slice(dataStart).filter(l =>
    /^\s*["']?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}/.test(l)
  );

  if (!dataLines.length) return null;

  // Parse each row: cols → month, POY_PKR, DTY_PKR, FDY_PKR, _, POY_USD, DTY_USD, FDY_USD
  const parsed = dataLines.map(line => {
    const cols = parseLine(line);
    return {
      month: cols[0]?.replace(/["']/g, "").trim() || "",
      poyPkr: cols[1] || "",
      dtyPkr: cols[2] || "",
      fdyPkr: cols[3] || "",
      poyUsd: cols[5] || "",
      dtyUsd: cols[6] || "",
      fdyUsd: cols[7] || "",
    };
  }).filter(r => r.month);

  if (!parsed.length) return null;

  const latest = parsed[parsed.length - 1];
  const prev   = parsed.length > 1 ? parsed[parsed.length - 2] : null;
  const recent = parsed.slice(-6); // last 6 months

  // Build change indicators
  function change(curr, prev) {
    const c = parseFloat(curr), p = parseFloat(prev);
    if (isNaN(c) || isNaN(p) || p === 0) return "";
    const pct = ((c - p) / p * 100).toFixed(1);
    return pct > 0 ? " (+" + pct + "% MoM)" : " (" + pct + "% MoM)";
  }

  const latestText = [
    "Latest PFY Pakistan Prices — " + latest.month + " (current month, live data):",
    "- POY 150D/48f: Rs " + latest.poyPkr + "/kg ($" + latest.poyUsd + ")" + (prev ? change(latest.poyPkr, prev.poyPkr) : ""),
    "- DTY 150D/48f: Rs " + latest.dtyPkr + "/kg ($" + latest.dtyUsd + ")" + (prev ? change(latest.dtyPkr, prev.dtyPkr) : ""),
    "- FDY 50D/24f:  Rs " + latest.fdyPkr + "/kg ($" + latest.fdyUsd + ")" + (prev ? change(latest.fdyPkr, prev.fdyPkr) : ""),
  ].join("\n");

  const recentText = "Recent 6-month trend:\n" + recent.map(r =>
    r.month + ": POY Rs " + r.poyPkr + " | DTY Rs " + r.dtyPkr + " | FDY Rs " + r.fdyPkr
  ).join("\n");

  return { latest, latestText, recentText, asOf: latest.month };
}

// Main export: get live price data (cache → endpoint → local file fallback)
export async function getLivePfyPrices(apiUrl = "") {
  // Try cache first
  const cached = loadCache();
  if (cached?.latestText) return cached;

  // Try live endpoint if URL provided
  if (apiUrl) {
    try {
      const data = await fetchFromEndpoint(apiUrl);
      if (data) { saveCache(data); return data; }
    } catch (e) {
      console.warn("[pfy-live] Endpoint fetch failed:", e.message, "— falling back to local file");
    }
  }

  // Fall back to local CSV file in kb_inbox
  const local = readFromLocalFile();
  if (local) { saveCache(local); return local; }

  return null;
}

// Detect if a user question is asking about PFY / yarn prices
export function isPriceQuery(question) {
  const s = question.toLowerCase();
  return /\b(pfy|poy|dty|fdy|polyester filament|yarn price|rate|current price|latest price|today.?s price|price today|current rate|market rate|market price|how much|price list|price kya|rate kya|price bata|rate bata|kitna hai|kya rate|kya price)\b/.test(s) &&
    /\b(pfy|poy|dty|fdy|polyester|yarn|filament|fiber|fibre|textile)\b/.test(s) ||
    /\b(pfy|poy|dty|fdy)\b/.test(s); // bare acronym is always a price query
}
