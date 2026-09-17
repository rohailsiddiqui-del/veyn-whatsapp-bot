// Website scraper: BFS-crawls all internal pages of a site and ingests them into the KB.
// Reuses the existing extractUrl + ingestText pipeline — no new dependencies.
//
// Usage (programmatic):
//   import { scrapeAndIngest } from './scraper.mjs';
//   const result = await scrapeAndIngest('https://example.com', { maxPages: 30 });
//
// Usage (CLI):
//   node src/cli.mjs scrape https://example.com [--max-pages 30] [--max-depth 3]

import { extractUrl } from "./extract.mjs";
import { ingestText } from "./ingest.mjs";

const DEFAULT_MAX_PAGES = 30;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_DELAY_MS  = 600;   // polite delay between requests

// Params that add no content value and would create duplicate URLs
const TRACKING_PARAMS = [
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "fbclid","gclid","msclkid","ref","source","_ga",
];

// File extensions to skip (binary, non-text assets)
const SKIP_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|pdf|docx|zip|gz|tar|woff|woff2|ttf|eot|css|js|xml|json|rss|atom)(\?|$)/i;

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!u.protocol.startsWith("http")) return null;
    if (SKIP_EXTENSIONS.test(u.pathname)) return null;
    u.hash = "";
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    // Remove trailing slash for deduplication (except root "/")
    const normalized = u.href.replace(/\/+$/, "") || u.origin;
    return normalized;
  } catch {
    return null;
  }
}

// Extract all same-domain links from an HTML page.
// Uses cheerio — already a dependency via extract.mjs.
async function extractLinks(html, base) {
  const { load } = await import("cheerio");
  const $ = load(html);
  const baseOrigin = new URL(base).origin;
  const links = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const norm = normalizeUrl(href, base);
    if (norm && new URL(norm).origin === baseOrigin) {
      links.add(norm);
    }
  });
  return [...links];
}

// Fetch raw HTML (needed separately so we can both extract text AND parse links).
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BotKBScraper/1.0; +https://github.com)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error(`Non-HTML content-type: ${ct.split(";")[0]}`);
  return res.text();
}

/**
 * Crawl a website and ingest all discovered pages into the KB.
 *
 * @param {string} rootUrl  - Starting URL (e.g. "https://example.com")
 * @param {object} options
 * @param {number} [options.maxPages=30]   - Hard cap on pages to scrape
 * @param {number} [options.maxDepth=3]    - BFS depth limit
 * @param {number} [options.delayMs=600]   - Polite delay between requests (ms)
 * @param {function} [options.onProgress]  - Called after each page: ({ url, depth, status, chunks })
 * @returns {{ ok: number, skipped: number, errors: number, totalChunks: number, pages: object[] }}
 */
export async function scrapeAndIngest(rootUrl, options = {}) {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const delayMs  = options.delayMs  ?? DEFAULT_DELAY_MS;
  const onProgress = options.onProgress || null;

  // Normalise the root URL
  const root = normalizeUrl(rootUrl, rootUrl);
  if (!root) throw new Error(`Invalid URL: ${rootUrl}`);

  const visited = new Set();
  const queue   = [{ url: root, depth: 0 }];
  const results = [];

  let ok = 0, skipped = 0, errors = 0, totalChunks = 0;

  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    let status = "ok", chunks = 0, error = null;

    try {
      // Fetch HTML and extract text + links in one pass
      const html = await fetchHtml(url);
      const links = depth < maxDepth ? await extractLinks(html, url) : [];

      // Queue new links (respecting maxPages)
      for (const link of links) {
        if (!visited.has(link) && !queue.some((q) => q.url === link)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }

      // Extract clean text using the existing cheerio extractor
      const text = await extractUrl(url);

      // Ingest into KB — source key is the URL itself
      const result = await ingestText(url, text);
      chunks = result.chunks;
      totalChunks += chunks;
      ok++;
    } catch (e) {
      error = e.message;
      if (e.message.startsWith("Skipped")) {
        status = "skipped";
        skipped++;
      } else {
        status = "error";
        errors++;
      }
    }

    const entry = { url, depth, status, chunks, error };
    results.push(entry);

    if (onProgress) onProgress(entry);

    // Polite delay
    if (queue.length > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { ok, skipped, errors, totalChunks, pages: results };
}
