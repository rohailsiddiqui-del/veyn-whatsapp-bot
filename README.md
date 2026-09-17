# Veyn WhatsApp Bot — Multi-Client AI Bot Platform

Multi-tenant WhatsApp bot platform with RAG-based knowledge retrieval, order management, and complaint handling. Running 24/7 on GCP for multiple enterprise clients.

## What it does

- **Multi-bot architecture** — run multiple client bots from a single deployment
- **RAG knowledge base** — each bot has its own chunked knowledge base for accurate answers
- **QSR order flow** — full cart-building, delivery/pickup selection, branch picker, order confirmation
- **Complaint handling** — 2-step complaint logging with unique reference numbers (CMP-XXXXXX)
- **AI-powered** — Gemini 2.5 Flash with context-aware responses per industry vertical

## Live Clients

| Client | Industry | Features |
|--------|----------|----------|
| Dominos Pakistan | QSR / Fast Food | Order taking, cart, 23 cities + 88 branches, complaint flow |
| Digital Chotu | General | RAG Q&A, outreach |
| Veyn | B2B SaaS | Lead qualification |

## Order Flow

1. Customer mentions item → AI detects intent → builds cart turn-by-turn
2. Cart loop: add items, modify flavors, upsell → "Anything else?"
3. Customer confirms → Delivery or Pickup?
4. Delivery → ask address → extract city → show numbered branch list → customer picks
5. Order summary (items + address + branch) → YES to confirm
6. Order number generated (DOM-XXXXX) + confirmation message

## Tech Stack

| Component | Tech |
|-----------|------|
| WhatsApp | Baileys (multi-device) |
| AI | Gemini 2.5 Flash (Google Vertex AI) |
| Knowledge Base | In-memory RAG with cosine similarity |
| Database | SQLite (per-bot) |
| Runtime | Node.js (ESM) |
| Process Manager | PM2 (GCP Compute Engine) |
| Bot Portal | Express + HTML frontend for QR management |

## Architecture

```
whatsapp-bot/
├── src/
│   ├── answer.mjs        # Core QA + QSR order/complaint logic
│   ├── bot-runner.mjs    # Multi-bot orchestrator
│   ├── gemini.mjs        # LLM integration
│   ├── crm.mjs           # Order/complaint DB operations
│   ├── ingest.mjs        # Knowledge base ingestion
│   └── whatsapp.mjs      # Baileys WA connection
├── bots/
│   └── {bot-id}/
│       ├── config.json   # Per-bot settings (industry, features, phone)
│       └── kb_store/     # Chunked knowledge base (gitignored)
├── portal/               # Web UI for QR scanning + bot management
└── widget/               # Embeddable chat widget
```

## Key Design Decisions

- **`PROCESS_START_MS` guard** — skips messages older than 10s on restart to prevent Baileys replay
- **Industry verticals** — `qsr`, `b2b`, `general` with different prompt templates in `answer.mjs`
- **Cart state machine** — `building_cart` state managed per-phone with `getOrderState`/`setOrderState`
- **Outbound silence** — `mode: outbound` in config silences a bot without stopping it
