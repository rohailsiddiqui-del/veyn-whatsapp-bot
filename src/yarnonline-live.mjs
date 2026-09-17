// Live yarn rate scraper — scrapes yarnonline.pk for real-time Pakistan spun yarn rates.
// Used to inject current yarn prices into bot answers (cotton, PC, CVC, PP, viscose, PV blends).
// No API key needed — public website. Refreshes at most once per 2 hours.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CACHE_FILE = path.join(ROOT, "kb_store", "yarnonline_cache.json");
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SOURCE_URL = "https://yarnonline.pk/index.php";

// ── Cache helpers ─────────────────────────────────────────────────────────────

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
    fs.mkdirSync(path.join(ROOT, "kb_store"), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), ...data }), "utf8");
  } catch {}
}

// ── HTML parser ───────────────────────────────────────────────────────────────

// Strip HTML tags from a string
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Parse the DataTables JSON payload embedded in the page script.
// yarnonline.pk injects all data as: $('#dataTables').DataTable({ data: [...] })
function parseRatesTable(html) {
  // The data array is embedded in a script block — extract the JSON
  // Pattern: data : [{...}, {...}, ...]
  const match = html.match(/['"#]dataTables['"]\s*\)\.DataTable\s*\(\s*\{[\s\S]*?data\s*:\s*(\[[\s\S]*?\])\s*,\s*columns/);
  if (!match) {
    // Fallback: try a broader search for the data array
    const fallback = html.match(/\.DataTable\s*\(\s*\{[\s\S]{0,100}data\s*:\s*(\[)/);
    if (!fallback) return [];
  }

  let jsonStr;
  if (match) {
    jsonStr = match[1];
  } else {
    // Extract from script block manually
    const dtIdx = html.indexOf("DataTable({");
    const dataIdx = html.indexOf("data :", dtIdx);
    if (dtIdx === -1 || dataIdx === -1) return [];
    // Find the opening bracket
    const arrStart = html.indexOf("[", dataIdx);
    if (arrStart === -1) return [];
    // Find matching closing bracket (track nesting)
    let depth = 0, i = arrStart;
    for (; i < html.length; i++) {
      if (html[i] === "[" || html[i] === "{") depth++;
      else if (html[i] === "]" || html[i] === "}") { depth--; if (depth === 0) break; }
    }
    jsonStr = html.slice(arrStart, i + 1);
  }

  let records;
  try {
    // Fix escaped forward slashes and parse
    records = JSON.parse(jsonStr.replace(/\\\//g, "/"));
  } catch {
    return [];
  }

  return records.map(r => ({
    mill:        r.mill_name || "",
    brand:       r.brand_name || "",
    yarnQuality: r.yarn_full_qaulity || r.yarn_full_quality || "",
    quality:     r.quality_name || "",
    rate:        stripTags(r.rate_lbs || ""),
    suitableFor: r.suitable_for || "",
    nature:      r.nature_name || "",
    lastUpdated: r.dated || "",
  })).filter(r => r.mill && r.yarnQuality && r.rate);
}

// Also extract sidebar widgets (KCA spot rate, IFL PSF rates, etc.)
function parseSidebarRates(html) {
  const extras = [];

  // KCA Spot Rate
  const kcaMatch = html.match(/KCA Spot Rate[\s\S]*?Rate Per md:\s*([0-9,]+)[\s\S]*?Per KG:\s*([0-9,]+)[\s\S]*?Updated:\s*([^<"]+)/i);
  if (kcaMatch) {
    extras.push(`KCA Cotton Spot Rate: Rs ${kcaMatch[1].trim()}/md | Rs ${kcaMatch[2].trim()}/kg (Updated: ${kcaMatch[3].trim()})`);
  }

  // IFL PSF Rates
  const psfSection = html.match(/IFL PSF Rates([\s\S]*?)(?:<\/article>|<article)/i);
  if (psfSection) {
    const psfRows = psfSection[1].match(/Rate Per:\s*([^|<"]+)\|?\s*Per KG:\s*([0-9]+)/gi) || [];
    if (psfRows.length) {
      extras.push("IFL PSF (Polyester Staple Fibre) Rates:");
      for (const r of psfRows.slice(0, 6)) {
        extras.push("  - " + r.replace(/Rate Per:/i, "").trim());
      }
    }
  }

  return extras;
}

// ── Fetch & parse ─────────────────────────────────────────────────────────────

async function fetchAndParse() {
  const res = await fetch(SOURCE_URL, {
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IFLBot/1.0)",
      "Accept": "text/html",
    },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();

  const rows = parseRatesTable(html);
  if (rows.length < 5) throw new Error(`Too few rows parsed (${rows.length}) — site structure may have changed`);

  const extras = parseSidebarRates(html);

  return buildPayload(rows, extras);
}

// ── Build the text payload for injection into bot context ─────────────────────

function buildPayload(rows, extras = []) {
  // Group by yarn quality for a clean summary
  const byQuality = {};
  for (const r of rows) {
    const key = r.yarnQuality.trim();
    if (!key) continue;
    if (!byQuality[key]) byQuality[key] = [];
    byQuality[key].push(r);
  }

  // Build compact rate listing: quality → lowest–highest rate range, mills
  const qualityLines = [];
  for (const [quality, entries] of Object.entries(byQuality)) {
    // Extract numeric rates (strip "Rs.", "+GST", spaces)
    const numRates = entries
      .map(e => {
        // Rate format: "Rs. 3700 + Gst" — extract the integer part only
          // Rate format: "Rs. 3700 + Gst" — extract all digit sequences, take the largest
        const nums = (e.rate.match(/\d+/g) || []).map(Number);
        const big = nums.filter(n => n >= 100); // actual rates are 1000+ range
        return big.length ? Math.max(...big) : NaN;
      })
      .filter(n => !isNaN(n) && n > 100); // sanity: rates are Rs hundreds, not decimals
    if (!numRates.length) continue;
    const lo = Math.min(...numRates);
    const hi = Math.max(...numRates);
    const mills = [...new Set(entries.map(e => e.mill))].slice(0, 3).join(", ");
    const range = lo === hi ? `Rs ${lo}/10lbs` : `Rs ${lo}–${hi}/10lbs`;
    qualityLines.push(`- ${quality}: ${range} (mills: ${mills}${entries.length > 3 ? ", ..." : ""})`);
  }

  // Build most-recent entries summary (up to 30 newest)
  const recentLines = rows.slice(0, 30).map(r =>
    `  ${r.mill} | ${r.yarnQuality} | ${r.quality} | ${r.rate} | ${r.suitableFor}`
  );

  const totalEntries = rows.length;
  const totalMills   = new Set(rows.map(r => r.mill)).size;
  const asOf = rows[0]?.lastUpdated || "recently";

  const summaryText = [
    `Live Pakistan Yarn Rates (yarnonline.pk) — ${totalEntries} listings from ${totalMills} spinning mills (as of ${asOf}):`,
    "",
    "Rate Summary by Yarn Quality (Rs per 10 lbs, + GST):",
    ...qualityLines.slice(0, 40),
  ].join("\n");

  const recentText = [
    "Most recently updated listings (Mill | Quality | Grade | Rate | Suitable For):",
    ...recentLines,
  ].join("\n");

  const extrasText = extras.length ? "\n\nAdditional Market Data:\n" + extras.join("\n") : "";

  return {
    summaryText: summaryText + extrasText,
    recentText,
    totalEntries,
    totalMills,
    asOf,
    rows,        // full dataset for detailed queries
  };
}

// ── Detailed lookup helper ────────────────────────────────────────────────────

// Find entries matching a quality string (e.g. "20S Cotton", "30 PC65:35", "CVC")
// Normalizes American/British spelling variants: fibers↔fibres, color↔colour, etc.
export function findYarnRates(rows, query) {
  // Normalize: lowercase, strip spaces, then harmonize common spelling variants
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, "")
    .replace(/fibers/g, "fibres")   // american → british (dataset uses british)
    .replace(/limited/g, "ltd");    // optional abbreviation
  const q = normalize(query);
  return rows.filter(r => {
    const combined = normalize(r.yarnQuality + r.mill + r.brand + r.nature + r.quality);
    return combined.includes(q);
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getLiveYarnRates() {
  // Try cache first
  const cached = loadCache();
  if (cached?.summaryText) return cached;

  // Fetch live
  try {
    const data = await fetchAndParse();
    saveCache(data);
    return data;
  } catch (e) {
    console.warn("[yarnonline] Fetch failed:", e.message);
    return null;
  }
}

// Well-known spinning mill names (partial match ok — lowercased)
const KNOWN_MILLS = [
  "interloop", "ibrahim fibers", "ibrahim fibres", "ibrahim fiber",
  "aa spinning", "nishat", "sapphire", "masood", "kohinoor", "gul ahmed",
  "crescent", "sitara", "blessed", "azgard", "hussain mills", "indus",
  "reliance", "soorty", "bhanero", "colony", "tata textile", "sadaqat",
  "rafiq spinning", "rafiq fibres", "fatima rafiq", "ittehad", "ejaz",
  "chaudhry", "paradise spinning", "kamal textile", "mehmood textile",
  "fanz spinning", "al nasr", "al qadir", "afzal spinning", "afzal textile",
  "standard spinning", "ghazi fabrics", "master textile",
];

// Detect if a question is about Pakistan spun yarn prices / rates
export function isYarnRateQuery(question) {
  const s = question.toLowerCase();

  // Rate/price query words — includes Roman Urdu equivalents
  const hasPriceIntent = /\b(rate|rates|price|prices|cost|how much|current|today|live|latest|market|per (kg|10 lbs|lbs|maund|md)|kitna|kya rate|rate kya|bata|batao|jany|jana|chahiye|chahye|puchna|pata|karo|kia hai|kya hai|ky hein|k hein|k rate|ka rate|ky rate|ka bhao|bhao)\b/.test(s);

  // Specific yarn count/type patterns
  const hasYarnType = /\b(\d+s?\s*(cotton|pc|cvc|pv|pp|viscose|polyester|staple|acrylic|nylon)|cotton yarn|pc yarn|cvc yarn|pv yarn|viscose yarn|spun yarn|ring spun|open end|airjet|woven yarn|knitting yarn)\b/.test(s);

  // "yarn" keyword with price intent (catches "yarn k rates", "yarn ki price", etc.)
  const hasGenericYarnPrice = /\byarn\b/.test(s) && hasPriceIntent;

  // Direct Pakistan yarn market references
  const hasYarnMarket = /\b(yarnonline|yarn market|spinning mill|textile mill|yarn rate|yarn price|cotton rate|pakistan yarn|local yarn|domestic yarn|count yarn)\b/.test(s);

  // Mill name mentioned alongside a rate/price intent
  const hasMillWithPrice = KNOWN_MILLS.some(m => s.includes(m)) && hasPriceIntent;

  // "mill k rates", "mill ki price" — any word followed by "k rate/rates/price"
  const hasMillRatePattern = /\w+\s+(k|ki|ke|ka)\s+(rate|rates|price|prices|bhao)\b/.test(s);

  return (hasYarnType && hasPriceIntent)
    || hasYarnMarket
    || hasGenericYarnPrice
    || hasMillWithPrice
    || hasMillRatePattern;
}

// Extract the mill name being asked about (if any) from the question
export function extractMillFromQuery(question) {
  const s = question.toLowerCase();
  for (const mill of KNOWN_MILLS) {
    if (s.includes(mill)) return mill;
  }
  return null;
}
