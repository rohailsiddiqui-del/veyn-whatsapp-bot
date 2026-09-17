// Ingestion: extract -> chunk -> embed -> upsert into store.
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.mjs";
import { extractFile, extractUrl } from "./extract.mjs";
import { embedBatch } from "./gemini.mjs";
import { loadStore, saveStore, chunkText, upsertSource } from "./store.mjs";

// Minimum raw text length to consider a source worth processing.
// Anything shorter is likely an image-only PDF or empty document.
const MIN_RAW_CHARS = 200;

export async function ingestText(source, rawText) {
  // File-level check: reject sources with too little raw text
  if (!rawText || rawText.trim().length < MIN_RAW_CHARS) {
    throw new Error(`Skipped "${source}" — too little text extracted (likely image-only or empty). Add a text-based version instead.`);
  }
  const chunks = chunkText(rawText);
  if (!chunks.length) {
    throw new Error(`Skipped "${source}" — no useful content found after filtering (content may be mostly images, numbers, or symbols).`);
  }
  const vecs = await embedBatch(chunks, "RETRIEVAL_DOCUMENT");
  const items = chunks.map((text, i) => ({ text, vec: vecs[i] }));
  const store = loadStore();
  upsertSource(store, source, items);
  saveStore(store);
  return { source, chunks: items.length };
}

export async function ingestFile(filePath) {
  const text = await extractFile(filePath);
  const source = path.basename(filePath);
  return ingestText(source, text);
}

export async function ingestUrl(url) {
  const text = await extractUrl(url);
  return ingestText(url, text);
}

// Recursively collect all supported files under a directory.
function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (/\.(pdf|docx|txt|md|csv)$/i.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

// Scan kb_inbox/ recursively and ingest everything supported.
export async function ingestInbox() {
  const dir = CONFIG.kbInbox;
  if (!fs.existsSync(dir)) return [];
  const files = collectFiles(dir);
  const results = [];
  for (const full of files) {
    const f = path.basename(full);
    try {
      const res = await ingestFile(full);
      results.push({ ...res, ok: true });
      console.log(`  + ${f}: ${res.chunks} chunks`);
    } catch (e) {
      results.push({ source: f, ok: false, error: e.message });
      console.log(`  ! ${f}: ${e.message}`);
    }
  }
  return results;
}
