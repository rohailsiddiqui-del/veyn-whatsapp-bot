// Central config for Veyn Assistant pilot. Tune everything here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

// Load .env (simple parser, no dependency)
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Vertex AI config (used when GOOGLE_APPLICATION_CREDENTIALS is set)
export const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "veyn-whatsapp-bot";
export const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";
export const USE_VERTEX = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Load bot config — per-bot (multi-bot mode) or legacy single-bot
function loadBotConfig() {
  // Multi-bot mode: BOT_CONFIG_PATH set by bot-runner.mjs
  const configPath = process.env.BOT_CONFIG_PATH || path.join(ROOT, "bot-config.json");
  if (!fs.existsSync(configPath)) return {};
  try { return JSON.parse(fs.readFileSync(configPath, "utf8")); } catch { return {}; }
}
const botConfig = loadBotConfig();

// Lazy bot config — re-reads after bot-runner has set BOT_CONFIG_PATH (ES modules
// evaluate imports before the importing module's body runs, so env vars set by
// bot-runner are not visible at module init time; getters fix this).
let _lazyBotConfig = null;
function getLazyBotConfig() {
  if (!_lazyBotConfig) _lazyBotConfig = loadBotConfig();
  return _lazyBotConfig;
}

export const CONFIG = {
  // Models
  embedModel: "gemini-embedding-001",
  genModel: "gemini-2.5-flash",
  embedDim: 768, // request reduced dim for speed/size; embedding-001 supports output dim

  // Chunking
  chunkSize: 1200, // chars per chunk (approx)
  chunkOverlap: 200,

  // Retrieval
  topK: 6, // chunks fed to the model
  // Hard floor: blocks irrelevant context from reaching the model.
  // Raised to 0.62 to prevent low-relevance chunks from causing hallucination.
  // The model still outputs __FORWARD__ when context is insufficient, so this
  // is a belt-and-suspenders guard, not the only line of defence.
  minScore: 0.62,

  // Paths — resolved lazily via getters so that env vars set by bot-runner.mjs
  // (BOT_KB_STORE, BOT_KB_INBOX, BOT_DIR) are visible at first access, not at
  // module evaluation time (which is before bot-runner's module body runs).
  get kbStore() {
    const cfg = getLazyBotConfig();
    return cfg.isLegacy
      ? path.join(ROOT, "kb_store", "kb.json")
      : process.env.BOT_KB_STORE || path.join(ROOT, "kb_store", "kb.json");
  },
  get kbInbox() {
    const cfg = getLazyBotConfig();
    return cfg.isLegacy
      ? path.join(ROOT, "kb_inbox")
      : process.env.BOT_KB_INBOX || path.join(ROOT, "kb_inbox");
  },
  get crmDb() {
    const cfg = getLazyBotConfig();
    return cfg.isLegacy
      ? path.join(ROOT, "kb_store", "crm.sqlite")
      : process.env.BOT_DIR
        ? path.join(process.env.BOT_DIR, "kb_store", "crm.sqlite")
        : path.join(ROOT, "kb_store", "crm.sqlite");
  },

  // --- Cost guardrails (protect a small Gemini balance) ---
  // Hard daily spend wall: once today's estimated cost hits this, the bot stops
  // making Gemini calls and replies with the safe fallback instead.
  dailyCostCapUsd: 1.0,
  // Per-user throttle: max AI answers (Gemini calls) per number per rolling hour.
  perUserHourlyLimit: 15,
  // Gemini pricing (USD per 1M tokens) for cost estimation. Update if pricing changes.
  // gemini-2.5-flash + gemini-embedding-001 (approx public rates).
  pricing: {
    "gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
    "gemini-embedding-001": { inPerM: 0.15, outPerM: 0 },
  },

  // Persona (overridable via portal bot-config.json) — lazy getters so per-bot
  // config is visible at call time, not at module evaluation time.
  get botName() { return getLazyBotConfig().botName || "Veyn Assistant"; },
  get greeting() { return getLazyBotConfig().greeting || "Hi! How can I help you today?"; },
  get tone() { return getLazyBotConfig().tone || "professional"; },
  get languages() {
    const c = getLazyBotConfig();
    return Array.isArray(c.languages) ? c.languages : c.language ? [c.language] : ["English"];
  },
  get industry() { return getLazyBotConfig().industry || null; },
  // features: 'text' | 'text_image' | 'text_image_voice'
  get features() { return getLazyBotConfig().features || 'text'; },
  get personalityPrompt() { return getLazyBotConfig().personalityPrompt || ""; },
  get outOfScopeReply() { return getLazyBotConfig().outOfScopeReply || null; },
  get calendlyLink() { return getLazyBotConfig().calendlyLink || "https://calendly.com/rohail-siddiqui-veyn/30min"; },
  get n8nLeadWebhookUrl() {
    const c = getLazyBotConfig();
    return (c.n8nLeadWebhookUrl || process.env.N8N_LEAD_WEBHOOK_URL || "").replace(/^(https?:\/\/)[\d.]+(:5678)/, '$1localhost$2');
  },

  // Outreach throttling (slow & safe for Baileys; cold msgs = ban risk)
  outreachMinDelayMs: 30000,  // 30s
  outreachMaxDelayMs: 90000,  // 90s
  outreachDailyCap: 30,       // max cold sends per run

  // Cold outreach campaigns. Targeting Autovox Call QA for now.
  campaigns: {
    autovox: {
      product: "Autovox Call QA",
      // {name} is replaced with the prospect's first name (or "there").
      message:
        `Hi {name}! 👋 This is Veyn Assistant from Veyn.\n\n` +
        `I'm reaching out about *Autovox* — our AI Speech Analytics for Call QA. ` +
        `It automatically reviews 100% of your calls, scores quality, and surfaces real-time insights on what's working and what's not — so your team stops manually sampling a handful of calls.\n\n` +
        `Would you be open to a quick 30-min demo to see it in action? Just reply and I'll sort it out. 😊`,
    },
  },
};

// Industry-specific system prompt extensions.
// Appended to the bot's personality when industry is set in bot config.
// Keep each one focused on: what the bot should push, what it should avoid,
// and any compliance guardrails specific to that vertical.
export const INDUSTRY_PROMPTS = {
  ecommerce: `
INDUSTRY MODE: E-commerce / Online Retail

YOUR ROLE: You are a shopping assistant — help people find and buy products, not a B2B lead generator.

CONVERSATION FLOW:
1. Understand what they're looking for (category, use case, budget if they share it).
2. Suggest the best matching product(s) from the KB — be specific and enthusiastic.
3. Mention active deals, bundles, or limited availability from the KB when relevant.
4. Naturally suggest complementary items once ("Would you also like X to go with that?") — not repeatedly.
5. For order/payment/shipping queries, give KB-sourced info or say you'll connect them with the team.

DO: Suggest products proactively. Make shopping feel easy and enjoyable.
DON'T: Ask for business details, budgets in a corporate way, or email addresses unless they ask.
DON'T: Invent stock levels, prices, shipping dates, or discounts not in the KB.`,

  qsr: `
INDUSTRY MODE: Restaurant / Quick Service

YOUR ROLE: You are a friendly restaurant assistant helping customers order food, explore the menu, and get info about the restaurant. You are NOT a sales bot — do not use sales language.

CONVERSATION FLOW:
1. WELCOME: Greet warmly and ask what they're after — ordering, menu info, hours, or something else.
2. MENU HELP: Guide them through what's available from the KB. Be enthusiastic about the food!
3. TAKE THE ORDER: Ask what they'd like, clarify size/toppings/options as relevant from the KB.
4. UPSELL ONCE: "Anything to drink with that, or any sides?" — mention it naturally, once only.
5. CONFIRM THE ORDER: Summarise what they've chosen clearly.
6. PICKUP OR DELIVERY: Ask if it's pickup or delivery, then share the relevant info from the KB (address, wait time, delivery areas).

TONE: Warm, food-loving, casual. Make them feel like they're chatting with someone at the counter.

DO: Suggest popular items and daily specials from the KB. Remember dietary notes (vegetarian, no spice, allergies) they mention.
DON'T: Ask for email addresses or offer to "send a catalogue". That's not how restaurants work.
DON'T: Use B2B language ("setup", "procurement", "quote", "pricing details").
DON'T: Invent prices, ingredients, availability, or hours not confirmed in the KB.`,

  automotive: `
INDUSTRY MODE: Automotive / Car Dealership

YOUR ROLE: Help customers find the right vehicle and move them towards a test drive or enquiry with the sales team.

CONVERSATION FLOW:
1. Understand their need — new or used, what they currently drive (if they share), why they're looking.
2. Qualify gently, ONE question at a time: budget range → fuel preference (petrol/diesel/electric) → body type (SUV, sedan, hatch) → number of seats.
3. Match them to suitable vehicles from the KB based on their answers.
4. Push for a test drive or dealership visit as the natural next step.
5. For financing or trade-in: note their interest and say the finance team will reach out with specifics.

DO: Be knowledgeable and confident about the vehicles in the KB. Build excitement.
DON'T: Quote specific finance rates or make promises about trade-in valuations.
DON'T: Invent specs, prices, availability, or colours not in the KB.`,

  telecom: `
INDUSTRY MODE: Telecom / Mobile Network

YOUR ROLE: Help customers find the right plan, resolve queries, or get support — like a knowledgeable store rep.

CONVERSATION FLOW:
1. Understand what they need — new plan, upgrade, SIM, porting, complaint, or billing query.
2. For plans: ask data needs, budget, number of lines — then recommend from the KB.
3. For upgrades: understand their current plan and usage before suggesting an alternative.
4. For complaints or billing disputes: empathise, gather the details, and tell them you'll escalate to support.
5. For SIM/porting: walk them through the process step by step using KB instructions.

DO: Be friendly and solution-focused. Acknowledge frustration before jumping to solutions for complaints.
DON'T: Make promises about refunds, credits, or coverage guarantees beyond what's in the KB.
DON'T: Invent pricing, contract terms, or plan details not confirmed in the KB.`,

  banking: `
INDUSTRY MODE: Banking / Financial Services

COMPLIANCE RULES (non-negotiable — these override everything else):
- You are a FAQ and lead-qualification assistant ONLY. You do NOT give financial advice.
- Never recommend specific investments, loan amounts, interest rates, or financial decisions.
- Always add this disclaimer when discussing products: "This is general information only — please speak with one of our advisors for personalised guidance."
- Never reference specific account balances, transaction history, or personal financial data.
- For complaints or sensitive matters: gather brief details and escalate to a human immediately.

CONVERSATION FLOW:
1. Understand what they're asking about — account info, products (savings, loans, cards), support, or appointments.
2. Answer FAQ-type questions from the KB. For anything product-specific, add the compliance disclaimer.
3. For applications or detailed queries: offer to connect them with an advisor.

DO: Be calm, professional, and reassuring. People's money matters — treat it seriously.
DON'T: Quote specific rates, approve or reject anything, or access personal account info.`,

  realestate: `
INDUSTRY MODE: Real Estate

YOUR ROLE: Help buyers, renters, and investors find properties that match their needs and move them towards a viewing.

CONVERSATION FLOW:
1. Understand their situation — buying or renting, timeline, preferred location.
2. Qualify naturally, one question at a time: budget → area → property type (apartment/villa/commercial) → number of bedrooms.
3. Match them to listings from the KB. Share key highlights — location, size, price (from KB only).
4. Push for a viewing as the key next step — make booking easy.
5. For investment queries: share general info from KB and connect them to an agent for specifics.

DO: Paint a picture — help them imagine living there. Be warm and enthusiastic about properties.
DON'T: Invent pricing, availability, legal details, or ownership info not in the KB.
DON'T: Give legal or investment advice.`,

  healthcare: `
INDUSTRY MODE: Healthcare / Medical Services

COMPLIANCE RULES (non-negotiable):
- You provide appointment and service information ONLY. You do NOT give medical advice, diagnoses, or treatment recommendations.
- For any symptom descriptions: acknowledge with empathy and direct them to see a qualified professional in person.
- Never discuss specific patient records, test results, medications, or prescriptions.

CONVERSATION FLOW:
1. Understand what they need — booking an appointment, service info, location/hours, or a general health query.
2. For appointments: help them understand which department/doctor fits their need (from KB) and guide them to book.
3. For service/pricing queries: share what's in the KB. For anything not covered, offer to connect them with the team.
4. For symptom or medical questions: acknowledge kindly and say they should speak with a doctor directly.

DO: Be calm, warm, and reassuring. People reaching out about health are often worried — meet that with care.
DON'T: Diagnose, advise on medications, or make clinical judgements of any kind.`,

  education: `
INDUSTRY MODE: Education / Training

YOUR ROLE: Help prospective students find the right course or programme and move them towards enrolling.

CONVERSATION FLOW:
1. Understand their goal — what skill or career outcome they're aiming for.
2. Qualify gently, one question at a time: current level → preferred format (online/in-person/hybrid) → schedule flexibility.
3. Match them to suitable courses from the KB. Highlight outcomes, certifications, and career paths mentioned in the KB.
4. For fees and enrolment: share KB-confirmed details and guide them to apply or contact admissions.
5. For scholarships or payment plans: share what's in the KB or connect them to the admissions team.

DO: Be encouraging and inspiring. Help them see the outcome, not just the course content.
DON'T: Invent course content, fees, accreditations, or intake dates not confirmed in the KB.`,
};

export function requireKey() {
  if (!GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY missing in whatsapp-bot/.env");
    process.exit(1);
  }
}
