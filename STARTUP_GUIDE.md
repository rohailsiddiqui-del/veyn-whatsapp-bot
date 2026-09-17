# Veyn Assistant WhatsApp Bot — Startup Guide

Complete guide to running the bot from scratch. The bot is **pure Gemini** —
it connects directly to WhatsApp via Baileys and answers from your knowledge
base. No OpenClaw, no Claude in the message loop.

---

## ⚠️ GOLDEN RULE — always `cd` into the bot folder first

Every terminal you open starts in your home folder (`C:\Users\Rohail Siddiqui\`).
npm commands ONLY work from the bot folder. So **before any `npm` command**, run:

```
cd /d "D:\Openclaw work\workspace\whatsapp-bot"
```

If you skip this you'll see:
```
npm error code ENOENT
npm error Could not read package.json: ... 'C:\Users\Rohail Siddiqui\package.json'
```
That just means you're in the wrong folder — `cd` in (command above) and retry.

> Sanity check after `cd`: type `dir package.json`. If it lists the file,
> you're in the right place.

---

## 0. Prerequisites (one-time)

- **Node.js** installed (v22+ — uses built-in SQLite). Check: `node -v`
- **Gemini API key** — already set in `whatsapp-bot/.env` as `GEMINI_API_KEY`
- A **WhatsApp number** dedicated to the bot (a phone with WhatsApp installed)

> **Use Command Prompt (cmd), not PowerShell.** PowerShell blocks npm scripts
> by default ("running scripts is disabled"). If you must use PowerShell, run
> once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

---

## 1. Install dependencies (first time only)

Open Command Prompt and run:

```
cd /d "D:\Openclaw work\workspace\whatsapp-bot"
npm install
```

This installs Baileys, Gemini helpers, PDF/DOCX parsers, etc. Only needed once
(or after pulling new code).

---

## 2. Load the knowledge base

The bot answers ONLY from what's in its knowledge base. Load content before
going live.

**Option A — bulk load from the inbox folder**
1. Drop PDFs / DOCX / TXT / MD files into `kb_inbox/`
2. Ingest everything in the folder:
   ```
   npm run ingest
   ```
   (or `npm run ingest -- inbox`)

**Option B — ingest one specific file**
```
npm run ingest -- "kb_inbox/Your File.docx"
```

**Option C — ingest a website URL**
```
npm run ingest -- "https://veyn.ai/products/autovox-ai-speech-analytics/"
```

**Check what's loaded:**
```
npm run kb list
```

**Remove a source / wipe everything:**
```
npm run kb remove "Veyn Profile (1).pdf"
npm run kb clear
```

> You can also add URLs live from WhatsApp later (admin only) — see section 6.

**Test the KB before going live (no WhatsApp needed):**
```
npm run ask -- "How does Autovox work for call QA?"
```
This shows the answer type (ANSWER / FORWARD / GREETING / DEMO), the retrieval
score, and which chunks were used.

---

## 3. Start the bot (link WhatsApp)

```
npm run whatsapp
```

**First run:** it prints a QR code in the terminal. On the bot's phone:
`WhatsApp -> Settings -> Linked Devices -> Link a Device -> scan the QR`

When linked you'll see:
```
[Veyn Assistant] Connected to WhatsApp. Bot is live (pure Gemini).
```

**Later runs:** auth is saved in `wa_auth/`, so it reconnects automatically —
no re-scan needed. Just run `npm run whatsapp` again.

**Keep the terminal open.** The bot runs only while this process is alive.
Closing the window = bot offline.

**Test it:** message the bot's number from any other phone. You should get a
warm Veyn Assistant reply.

---

## 4. What the bot does automatically

Every inbound message is handled like this:

- **Greeting** ("hi", "hello", "thanks") -> instant warm reply (no LLM, fast)
- **Demo / booking intent** ("interested", "book a demo", "set up a call")
  -> shares the Calendly link and logs a demo request
- **Real question** -> searches the KB; if it has the answer, replies grounded
  in your content, in the Veyn Assistant persona
- **Unknown / not in KB** -> "I'll forward this to our team" + logs it to the
  handoff queue

Everything (contacts, messages, handoffs, demos) is logged to the CRM at
`kb_store/crm.sqlite`.

---

## 5. Cold outreach (Autovox campaign)

Sends the Autovox Call QA cold message to a list of numbers, throttled for
safety. Replies are handled by the running bot (section 3).

**Step 1 — add targets** to `outreach_targets.csv` (one per line):
```
923001234567,Ahmed Khan
447700900123,Sarah
```
(Number = full international, digits or with `+`. Name optional. `#` = comment.)

**Step 2 — make sure the bot is running** (`npm run whatsapp` in another window)
so replies get answered.

**Step 3 — run outreach** in a separate Command Prompt:
```
cd /d "D:\Openclaw work\workspace\whatsapp-bot"
npm run outreach -- autovox
```
Optional custom target file:
```
npm run outreach -- autovox mylist.csv
```

**Safety built in:** 30–90s random gap between sends, daily cap of 30, skips
numbers already contacted, and checks each number is on WhatsApp first.

> Cold outreach on an unofficial WhatsApp link carries a real ban risk. Start
> with a SMALL test batch (3–5 numbers you know). For high volume, the official
> WhatsApp Business API is the ban-safe path.

---

## 6. Admin commands (from WhatsApp)

Message the bot from an admin number (set in `.env` -> `ADMIN_NUMBERS`) to
manage it without touching the server:

| Command | What it does |
|---------|--------------|
| `kb add <url>` | Ingest a website URL live |
| `kb list` | List knowledge base sources |
| `kb remove <source>` | Remove a source |
| `handoffs` | Show open forwarded questions |
| `demos` | Show demo requests |
| `stats` | CRM summary (contacts, messages, handoffs, outreach, demos) |
| `help` | List admin commands |

To change who has admin access, edit `ADMIN_NUMBERS` in `.env`
(comma-separated, e.g. `ADMIN_NUMBERS=4477...,9230...`).

---

## 7. Common operations

**Restart after a code/config/KB change:**
Stop with `Ctrl + C`, then `npm run whatsapp` again. The KB is loaded fresh at
startup, so always restart after ingesting new content.

**Switch the bot's WhatsApp number:**
See `SWITCH_NUMBER.md` in this folder.

**Stop the bot:** `Ctrl + C` in its terminal.

---

## 8. Troubleshooting

**`npm error code ENOENT ... package.json` (in C:\Users\...)**
You ran npm from the wrong folder. `cd /d "D:\Openclaw work\workspace\whatsapp-bot"`
first, then retry. (See the Golden Rule at the top.)

**`npm ... cannot be loaded because running scripts is disabled` (PowerShell)**
Use Command Prompt (cmd) instead, OR run once in PowerShell:
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

**QR code expired before I scanned it**
Just stop (`Ctrl + C`) and run `npm run whatsapp` again for a fresh QR.

**Bot replies stopped / went offline**
The terminal running `npm run whatsapp` was closed. Reopen cmd, `cd` in, run
`npm run whatsapp` again (no re-scan — auth is saved).

**Answers are cut off / half messages**
The KB wasn't reloaded, or the bot is on old code. Stop and restart the bot so
it loads fresh.

**Bot forwards a question it should know**
The content isn't in the KB, or chunks scored too low. Ingest more detail on
that topic (`npm run ingest`) and restart.

---

## 9. Quick reference

```
npm install                                  # first-time setup
npm run ingest                               # load everything in kb_inbox/
npm run ingest -- "kb_inbox/file.docx"       # load one file
npm run ingest -- "https://..."              # load a URL
npm run kb list                              # show KB sources
npm run ask -- "question"                    # test the KB
npm run whatsapp                             # start the bot (QR first time)
npm run outreach -- autovox                  # run the Autovox cold campaign
```

---

## Folder map

```
whatsapp-bot/
  .env                  GEMINI_API_KEY + ADMIN_NUMBERS
  outreach_targets.csv  cold outreach number list
  kb_inbox/             drop PDFs/DOCX/TXT here to ingest
  kb_store/
    kb.json             the vector knowledge base
    crm.sqlite          contacts, messages, handoffs, demos, outreach
  wa_auth/              saved WhatsApp link (auto-created after QR scan)
  src/
    whatsapp.mjs        the running bot (inbound handler)
    outreach.mjs        cold outreach sender
    handle.mjs          message router (admin vs user, CRM logging)
    answer.mjs          strict-RAG engine + persona + demo/greeting logic
    gemini.mjs          Gemini embed + generate
    store.mjs           vector store + chunking + search
    crm.mjs             SQLite CRM
    ingest.mjs          PDF/DOCX/URL ingestion
    config.mjs          all tunables (persona, throttling, campaigns, link)
    cli.mjs             ingest/ask/list CLI
```
