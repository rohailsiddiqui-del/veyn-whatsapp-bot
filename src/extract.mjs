// Content extractors: PDF, DOCX, TXT/MD, CSV, and URL (HTML).
import fs from "node:fs";
import path from "node:path";

export async function extractFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === ".pdf") {
    const pdf = (await import("pdf-parse")).default;
    const data = await pdf(buf);
    return data.text || "";
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value || "";
  }
  if (ext === ".txt" || ext === ".md") {
    return buf.toString("utf8");
  }
  if (ext === ".csv") {
    return extractCsv(buf.toString("utf8"), path.basename(filePath));
  }
  if (ext === ".doc") {
    throw new Error(".doc (old Word) not supported — save as .docx or PDF");
  }
  throw new Error("Unsupported file type: " + ext);
}

// Converts a PFY-style price CSV into natural language text chunks
function extractCsv(raw, filename) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const isPFY = lines.slice(0, 6).some(l =>
    /polyester filament|PFY|POY|DTY|FDY/i.test(l)
  );
  if (isPFY) return parsePfyCsv(lines, filename);
  return parseGenericCsv(lines, filename);
}

function parsePfyCsv(lines, filename) {
  const dataStart = lines.findIndex(l =>
    /^\s*["']?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}/.test(l)
  );
  if (dataStart === -1) return "";

  const headerLines = lines.slice(0, dataStart);
  const dataLines = lines.slice(dataStart);

  const titleLines = headerLines
    .map(l => l.replace(/^["']|["']$/g, "").trim())
    .filter(l => l && !/^[,\s]+$/.test(l));

  const intro = [
    "PFY (Polyester Filament Yarn) Price Indicators — Pakistan",
    "Source: Emerging Textiles (EmergingTextiles.com)",
    "Coverage: " + titleLines.join(" | "),
    "This data covers monthly benchmark prices for POY 150D/48f, DTY 150D/48f, and FDY 50D/24f in Pakistan.",
    "Prices are Ex-Works, taxes excluded. Values given in Pakistani Rupees (PKR/kg) and US Dollars (USD/kg).",
    "",
  ].join("\n");

  const rows = [];
  for (const line of dataLines) {
    if (/monthly|%|year|chge|@emerging/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const month = cols[0].replace(/["']/g, "").trim();
    if (!month || !/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(month)) continue;

    const poyPkr = cols[1] || "";
    const dtyPkr = cols[2] || "";
    const fdyPkr = cols[3] || "";
    const poyUsd = cols[5] || "";
    const dtyUsd = cols[6] || "";
    const fdyUsd = cols[7] || "";

    const parts = [];
    if (poyPkr) parts.push("POY 150D/48f: Rs " + poyPkr + "/kg (" + (poyUsd ? "$" + poyUsd : "") + ")");
    if (dtyPkr) parts.push("DTY 150D/48f: Rs " + dtyPkr + "/kg (" + (dtyUsd ? "$" + dtyUsd : "") + ")");
    if (fdyPkr) parts.push("FDY 50D/24f: Rs " + fdyPkr + "/kg (" + (fdyUsd ? "$" + fdyUsd : "") + ")");
    if (parts.length) rows.push(month + ": " + parts.join(" | "));
  }

  const summaryLines = dataLines.filter(l =>
    /monthly\s*\(%\)|3-month|1-year|2-year/i.test(l)
  );
  let summaryText = "";
  if (summaryLines.length) {
    summaryText = "\n\nRecent Price Changes:\n";
    for (const sl of summaryLines) {
      const cols = parseCsvLine(sl);
      const label = cols[0].replace(/["']/g, "").trim();
      const poy = cols[1] || "";
      const dty = cols[2] || "";
      const fdy = cols[3] || "";
      if (label && (poy || dty || fdy)) {
        summaryText += label + " — POY: " + poy + ", DTY: " + dty + ", FDY: " + fdy + "\n";
      }
    }
  }

  const chunkSize = 12;
  const chunks = [intro];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const block = rows.slice(i, i + chunkSize);
    const yearRange = block[0].split(":")[0].trim() + " to " + block[block.length - 1].split(":")[0].trim();
    chunks.push("PFY Pakistan Price Data (" + yearRange + "):\n" + block.join("\n"));
  }
  if (summaryText) {
    chunks.push("PFY Pakistan — Latest Price Trend Summary:\n" + summaryText.trim());
  }

  return chunks.join("\n\n===\n\n");
}

function parseGenericCsv(lines, filename) {
  if (lines.length < 2) return lines.join("\n");
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/["']/g, "").trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const pairs = headers
      .map((h, j) => h + ": " + (cols[j] || "").replace(/["']/g, "").trim())
      .filter(p => !p.endsWith(": "));
    if (pairs.length) rows.push(pairs.join(", "));
  }
  return "Data from " + filename + ":\n" + rows.join("\n");
}

function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' || c === "'") {
      inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export async function extractUrl(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });
  if (!r.ok) throw new Error("Fetch failed HTTP " + r.status);
  const html = await r.text();
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, noscript, iframe, svg, form, aside").remove();
  $("[role=navigation], [role=banner], [role=contentinfo], .nav, .menu, .footer, .header, .sidebar, .cookie, .ad").remove();
  const title = $("title").text().trim();
  let root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root.text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return (title ? title + "\n\n" : "") + text;
}
