# Switching the Bot's WhatsApp Number

The bot's WhatsApp link lives entirely in one folder: `wa_auth/`. That folder
holds the session for the currently-linked number. To switch numbers, you
unlink the old session and scan fresh with the new number's phone.

**No code changes are needed** — the bot does not hardcode the number anywhere
for receiving or sending messages. The outreach sender (`npm run outreach`)
uses the same `wa_auth/`, so it automatically sends from whatever number is
linked.

---

## Procedure

1. **Stop the bot**
   In the terminal running it, press `Ctrl + C`.

2. **Unlink the old number** (use cmd, from the bot folder)
   ```
   cd /d "D:\Openclaw work\workspace\whatsapp-bot"
   ren wa_auth wa_auth_old
   ```
   > `ren` (rename) is safer than delete — you can roll back by renaming it
   > back. To wipe permanently instead: `rmdir /s /q wa_auth`

3. **Start the bot again** — prints a fresh QR (no saved session = QR)
   ```
   npm run whatsapp
   ```

4. **Scan the QR with the NEW number's phone**
   On the new number's WhatsApp:
   `Settings -> Linked Devices -> Link a Device -> scan the QR`

   Once connected, the bot runs on the new number. Auth re-saves to `wa_auth/`,
   so future restarts won't need a re-scan.

---

## Two things to check after switching

### 1. Admin number (`.env` -> `ADMIN_NUMBERS`)

`ADMIN_NUMBERS` controls who can run admin commands (`kb add`, `handoffs`,
`demos`, `stats`) by messaging the bot. It is the number you message **FROM**,
not the bot's own number.

- If your admin number is the same phone you're turning into the bot, you can't
  admin it from that phone anymore. Set `ADMIN_NUMBERS` to your personal phone.
- After switching, update `ADMIN_NUMBERS` to whatever number(s) will send admin
  commands. Comma-separate multiple: `ADMIN_NUMBERS=4477...,9230...`

### 2. CRM data is preserved

The CRM (`kb_store/crm.sqlite`) keeps all contacts, handoffs, demo requests,
and outreach history regardless of which number the bot runs on. Switching the
number does NOT wipe your data.

---

## Quick reference

| Step | Action |
|------|--------|
| 1 | `Ctrl + C` to stop the bot |
| 2 | `ren wa_auth wa_auth_old` (unlink old number) |
| 3 | `npm run whatsapp` -> fresh QR |
| 4 | Scan QR with the **new** number's phone |
| 5 | (If needed) update `ADMIN_NUMBERS` in `.env` |

Everything else — campaign messages, knowledge base, CRM, Calendly link —
stays the same.
