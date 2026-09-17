// Vector store: plain JSON file. Fine for pilot volume (hundreds–few thousand chunks).
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.mjs";

export function loadStore() {
  if (!fs.existsSync(CONFIG.kbStore)) return { chunks: [] };
  try {
    return JSON.parse(fs.readFileSync(CONFIG.kbStore, "utf8"));
  } catch {
    return { chunks: [] };
  }
}

export function saveStore(store) {
  fs.mkdirSync(path.dirname(CONFIG.kbStore), { recursive: true });
  fs.writeFileSync(CONFIG.kbStore, JSON.stringify(store));
}

// Returns true if a chunk has enough meaningful text to be worth embedding.
function isUsefulChunk(text) {
  if (!text || text.length < 80) return false;
  // Count actual word characters vs total length
  const words = text.match(/[a-zA-Z\u0600-\u06FF]{3,}/g) || [];
  if (words.length < 8) return false;
  // Reject chunks that are mostly numbers, symbols, or whitespace
  const alphaRatio = (text.match(/[a-zA-Z\u0600-\u06FF]/g) || []).length / text.length;
  if (alphaRatio < 0.25) return false;
  return true;
}

// Split text into overlapping chunks on sentence/paragraph boundaries where possible.
export function chunkText(text) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const { chunkSize, chunkOverlap } = CONFIG;
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    // try to break on a paragraph or sentence boundary near the end
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastDot = slice.lastIndexOf(". ");
      const brk = lastPara > chunkSize * 0.5 ? lastPara : lastDot > chunkSize * 0.5 ? lastDot + 1 : -1;
      if (brk > 0) end = start + brk;
    }
    const piece = clean.slice(start, end).trim();
    if (isUsefulChunk(piece)) chunks.push(piece);
    start = end - chunkOverlap;
    if (start < 0) start = 0;
    if (end >= clean.length) break;
  }
  return chunks;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function search(store, queryVec, topK) {
  const scored = store.chunks.map((c) => ({ ...c, score: cosine(queryVec, c.vec) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK);
}

// Add chunks for a source. Removes prior chunks from same source first (idempotent re-ingest).
export function upsertSource(store, source, items) {
  store.chunks = store.chunks.filter((c) => c.source !== source);
  for (const it of items) store.chunks.push({ source, text: it.text, vec: it.vec });
  return store;
}

export function removeSource(store, source) {
  const before = store.chunks.length;
  store.chunks = store.chunks.filter((c) => c.source !== source);
  return before - store.chunks.length;
}

export function listSources(store) {
  const m = new Map();
  for (const c of store.chunks) m.set(c.source, (m.get(c.source) || 0) + 1);
  return [...m.entries()].map(([source, count]) => ({ source, count }));
}
