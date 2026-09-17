#!/usr/bin/env node
// CLI for Veyn Assistant KB: ingest + ask + manage. Used for testing and by the
// OpenClaw skill later.
//
// Usage: node src/cli.mjs --bot-id <id> ingest [inbox|<file>|<url>]
//        node src/cli.mjs --bot-id <id> ask "question"
// Without --bot-id falls back to legacy root kb_store/ paths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Resolve --bot-id before importing config so env vars are set in time
function argval(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const BOT_ID = argval("--bot-id");
if (BOT_ID) {
  const BOT_DIR = path.join(ROOT, "bots", BOT_ID);
  process.env.BOT_ID = BOT_ID;
  process.env.BOT_DIR = BOT_DIR;
  process.env.BOT_KB_STORE = path.join(BOT_DIR, "kb_store", "kb.json");
  process.env.BOT_KB_INBOX = path.join(BOT_DIR, "kb_inbox");
  process.env.BOT_CONFIG_PATH = path.join(BOT_DIR, "config.json");
  // Ensure dirs exist
  fs.mkdirSync(path.join(BOT_DIR, "kb_store"), { recursive: true });
  fs.mkdirSync(path.join(BOT_DIR, "kb_inbox"), { recursive: true });
}

import { requireKey, CONFIG } from "./config.mjs";
import { ingestFile, ingestUrl, ingestInbox } from "./ingest.mjs";
import { answer } from "./answer.mjs";
import { loadStore, saveStore, listSources, removeSource } from "./store.mjs";
import { scrapeAndIngest } from "./scraper.mjs";

// Strip --bot-id <value> from argv before parsing cmd/args
const filteredArgv = process.argv.filter((a, i, arr) =>
  a !== "--bot-id" && arr[i - 1] !== "--bot-id"
);
const [, , cmd, ...rest] = filteredArgv;
const arg = rest.join(" ").trim();

function out(obj) {
  // JSON when --json flag present (for skill integration), else human text.
  if (process.env.VEYN_JSON === "1") console.log(JSON.stringify(obj));
}

async function main() {
  switch (cmd) {
    case "ingest": {
      requireKey();
      if (!arg || arg === "inbox") {
        console.log("Ingesting kb_inbox/ ...");
        const r = await ingestInbox();
        console.log(`Done. ${r.filter((x) => x.ok).length} ingested, ${r.filter((x) => !x.ok).length} failed.`);
      } else if (/^https?:\/\//i.test(arg)) {
        console.log("Ingesting URL:", arg);
        const r = await ingestUrl(arg);
        console.log(`Done. ${r.chunks} chunks from ${r.source}`);
      } else {
        console.log("Ingesting file:", arg);
        const r = await ingestFile(arg);
        console.log(`Done. ${r.chunks} chunks from ${r.source}`);
      }
      break;
    }
    case "ask": {
      requireKey();
      if (!arg) return console.log("Usage: npm run ask -- \"your question\"");
      const res = await answer(arg);
      console.log("\n[" + res.type.toUpperCase() + (res.top ? ` top=${res.top.toFixed(3)}` : "") + "]");
      console.log(res.text);
      if (res.hits?.length) {
        console.log("\n-- retrieved --");
        res.hits.forEach((h) => console.log(`  ${h.score.toFixed(3)}  ${h.source}  "${h.text.slice(0, 60)}..."`));
      }
      out(res);
      break;
    }
    case "list": {
      const s = loadStore();
      const src = listSources(s);
      if (!src.length) return console.log("KB is empty.");
      console.log("Knowledge base sources:");
      src.forEach((x) => console.log(`  - ${x.source} (${x.count} chunks)`));
      console.log(`Total: ${s.chunks.length} chunks`);
      break;
    }
    case "remove": {
      if (!arg) return console.log("Usage: kb remove <source>");
      const s = loadStore();
      const n = removeSource(s, arg);
      saveStore(s);
      console.log(`Removed ${n} chunks from ${arg}`);
      break;
    }
    case "scrape": {
      requireKey();
      if (!arg || !/^https?:\/\//i.test(arg)) {
        return console.log("Usage: node src/cli.mjs scrape <url> [--max-pages N] [--max-depth N]");
      }
      const maxPages = Number(argval("--max-pages") || 30);
      const maxDepth = Number(argval("--max-depth") || 3);
      console.log(`Scraping ${arg} (max ${maxPages} pages, depth ${maxDepth})...`);
      const result = await scrapeAndIngest(arg, {
        maxPages,
        maxDepth,
        onProgress: ({ url, depth, status, chunks, error }) => {
          const icon = status === "ok" ? "+" : status === "skipped" ? "-" : "!";
          const suffix = status === "ok" ? `${chunks} chunks` : (error || status);
          console.log(`  [${icon}] [d${depth}] ${url.slice(0, 80)} — ${suffix}`);
        },
      });
      console.log(`\nDone. ${result.ok} pages → ${result.totalChunks} chunks | skipped: ${result.skipped} | errors: ${result.errors}`);
      break;
    }
    case "clear": {
      saveStore({ chunks: [] });
      console.log("KB cleared.");
      break;
    }
    default:
      console.log(`Veyn Assistant KB CLI
Usage:
  node src/cli.mjs ingest [inbox|<file>|<url>]   ingest content
  node src/cli.mjs scrape <url>                   crawl & ingest entire website
  node src/cli.mjs ask "question"               query the KB
  node src/cli.mjs list                          list sources
  node src/cli.mjs remove <source>               remove a source
  node src/cli.mjs clear                          wipe KB
Config: model=${CONFIG.genModel}, minScore=${CONFIG.minScore}`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
