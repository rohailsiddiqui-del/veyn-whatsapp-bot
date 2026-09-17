// Main message handler: routes admin commands vs user queries, logs to CRM,
// returns the reply text. Called by the OpenClaw skill (via handle-message.mjs).
import { CONFIG } from "./config.mjs";
import { answer } from "./answer.mjs";
import { ingestUrl, ingestFile } from "./ingest.mjs";
import { scrapeAndIngest } from "./scraper.mjs";
import { loadStore, listSources, removeSource, saveStore } from "./store.mjs";
import { upsertContact, logMessage, reserveMessageId, queueHandoff, listHandoffs, stats, logDemoRequest, getCampaign, listDemoRequests, usageSummary, listComplaints, resolveComplaint, listQsrOrders } from "./crm.mjs";

// Admin numbers (E.164 without +). Set via env ADMIN_NUMBERS="447..,92.."
const ADMINS = (process.env.ADMIN_NUMBERS || "").split(",").map((s) => s.trim()).filter(Boolean);

function isAdmin(waId) {
  const norm = String(waId).replace(/[^0-9]/g, "");
  return ADMINS.some((a) => norm.endsWith(a.replace(/[^0-9]/g, "")));
}

async function handleAdmin(waId, text) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "kb": {
      const [sub, ...r2] = rest;
      const a2 = r2.join(" ").trim();
      if (sub === "add" && /^https?:\/\//i.test(a2)) {
        const res = await ingestUrl(a2);
        return `Added ${res.chunks} chunks from ${res.source}`;
      }
      if (sub === "scrape" && /^https?:\/\//i.test(a2)) {
        // Run scrape in background so WhatsApp doesn't time out on large sites
        scrapeAndIngest(a2, {
          maxPages: 30,
          maxDepth: 3,
          onProgress: ({ url, status, chunks }) => {
            if (status === "ok") console.log(`[kb scrape] ${url} → ${chunks} chunks`);
          },
        }).then((r) => {
          console.log(`[kb scrape] Done: ${r.ok} pages, ${r.totalChunks} chunks, ${r.errors} errors`);
        }).catch((e) => {
          console.error("[kb scrape] Failed:", e.message);
        });
        return `Scraping ${a2} in background (up to 30 pages). Check server logs for progress. KB will update as pages are ingested.`;
      }
      if (sub === "list" || !sub) {
        const src = listSources(loadStore());
        if (!src.length) return "KB is empty.";
        return "Knowledge base:\n" + src.map((s) => `- ${s.source} (${s.count})`).join("\n");
      }
      if (sub === "remove") {
        const s = loadStore();
        const n = removeSource(s, a2);
        saveStore(s);
        return `Removed ${n} chunks from ${a2}`;
      }
      return "KB commands: kb add <url> | kb scrape <url> | kb list | kb remove <source>";
    }
    case "handoffs": {
      const h = listHandoffs("open");
      if (!h.length) return "No open handoffs.";
      return `Open handoffs (${h.length}):\n` + h.slice(0, 15).map((x) => `#${x.id} ${x.name || x.wa_id}: ${x.question}`).join("\n");
    }
    case "stats": {
      const s = stats();
      return `CRM: ${s.contacts} contacts, ${s.msgs} messages, ${s.openHandoffs} open handoffs, ${s.outreachSent} outreach sent, ${s.demos} demo requests.`;
    }
    case "usage": {
      const u = usageSummary();
      const f = (n) => `$${n.toFixed(4)}`;
      const pct = u.capUsd ? Math.round((u.today.cost / u.capUsd) * 100) : 0;
      return (
        `Gemini usage:\n` +
        `Today: ${u.today.calls} calls, ${u.today.tokens} tokens, ~${f(u.today.cost)} (${pct}% of ${f(u.capUsd)} cap)\n` +
        `All-time: ${u.allTime.calls} calls, ${u.allTime.tokens} tokens, ~${f(u.allTime.cost)}`
      );
    }
    case "demos": {
      const d = listDemoRequests();
      if (!d.length) return "No demo requests yet.";
      return `Demo requests (${d.length}):\n` + d.slice(0, 15).map((x) => `- ${x.name || x.wa_id} [${x.campaign}] ${x.status}`).join("\n");
    }
    case "complaints": {
      const status = arg === "resolved" ? "resolved" : "open";
      const c = listComplaints(status);
      if (!c.length) return `No ${status} complaints.`;
      return `${status.charAt(0).toUpperCase() + status.slice(1)} complaints (${c.length}):\n` +
        c.slice(0, 15).map(x => `#${x.id} [${x.category}] ${x.name || x.wa_id}: ${x.complaint_text.substring(0, 60)}...`).join("\n");
    }
    case "resolve-complaint": {
      if (!arg) return "Usage: resolve-complaint <id>";
      resolveComplaint(Number(arg));
      return `Complaint #${arg} marked as resolved.`;
    }
    case "orders": {
      const orders = listQsrOrders(20);
      if (!orders.length) return "No orders yet.";
      return `Recent orders (${orders.length}):\n` + orders.slice(0, 15).map(o => {
        const items = (() => { try { return JSON.parse(o.items).map(i => i.name).join(", "); } catch { return "?"; } })();
        const t = new Date(o.ts).toLocaleString("en-PK", { timeZone: "Asia/Karachi", hour12: true });
        return `${o.order_ref} | ${o.name || o.wa_id} | ${o.order_type || "?"} | Rs.${o.total_amount} | ${items} | ${t}`;
      }).join("\n");
    }
    case "help":
      return "Admin commands:\nkb add <url>\nkb list\nkb remove <source>\nhandoffs\ndemos\nstats\nusage\norders\ncomplaints\ncomplaints resolved\nresolve-complaint <id>\n\nOutreach (run from terminal): npm run outreach -- autovox";
    default:
      return null; // not an admin command -> fall through to normal answer
  }
}

// Fire N8N webhook with lead details (non-blocking — failure doesn't break the reply).
async function fireLeadWebhook(waId, name, email, interest) {
  // Prefer env override, fall back to value saved in portal config.json
  const webhookUrl = CONFIG.n8nLeadWebhookUrl || process.env.N8N_LEAD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wa_id: waId,
        name: name || "",
        email,
        interest: interest || "",
        bot: CONFIG.botName,
        ts: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("[lead-webhook] failed:", e.message);
  }
}

// Main entry. msg = { waId, name, text, msgId? }
// Returns null if the message was already processed (duplicate Baileys delivery).
export async function handleMessage({ waId, name, text, msgId = null }) {
  // Persistent dedup: reject re-delivered messages across process restarts.
  if (msgId && reserveMessageId(msgId)) {
    console.log(`[dedup] skipped already-processed msgId ${msgId} for ${waId}`);
    return null;
  }

  upsertContact(waId, name);
  logMessage(waId, "in", text, null, null, msgId);

  // Admin path
  if (isAdmin(waId)) {
    const adminReply = await handleAdmin(waId, text);
    if (adminReply !== null) {
      logMessage(waId, "out", adminReply, "admin");
      return adminReply;
    }
  }

  // Normal user path -> strict RAG
  const res = await answer(text, name, waId);
  if (res.type === "forward") {
    // Rate-limit hits are transient (user can just wait), so don't clog the
    // handoff queue with them. Everything else — including cap/API failures —
    // gets queued so a human can follow up.
    if (res.reason !== "user_rate_limit") {
      queueHandoff(waId, name, text, res.reason || "unknown", res.top ?? null);
    }
  }
  if (res.type === "demo") {
    logDemoRequest(waId, name, getCampaign(waId) || "inbound", text);
  }
  if (res.type === "lead_capture") {
    // Fire N8N webhook — non-blocking
    fireLeadWebhook(waId, name, res.email, res.interest || "");
  }
  logMessage(waId, "out", res.text, res.type, res.top ?? null);
  return res.text;
}
