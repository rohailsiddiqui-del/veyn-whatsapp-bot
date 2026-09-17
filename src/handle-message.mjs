#!/usr/bin/env node
// Entry point for the OpenClaw skill. Reads sender + text from args/env and
// prints ONLY the reply text to stdout (the agent relays it to WhatsApp).
//
// Usage:
//   node src/handle-message.mjs --wa "<waId>" --name "<name>" --text "<message>"
// or via env: VEYN_WA, VEYN_NAME, VEYN_TEXT
import { handleMessage } from "./handle.mjs";
import { requireKey } from "./config.mjs";

function argval(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

requireKey();

const waId = argval("--wa") || process.env.VEYN_WA || "unknown";
const name = argval("--name") || process.env.VEYN_NAME || "";
const text = argval("--text") || process.env.VEYN_TEXT || "";

if (!text) {
  console.error("No message text provided.");
  process.exit(1);
}

handleMessage({ waId, name, text })
  .then((reply) => {
    process.stdout.write(reply);
  })
  .catch((e) => {
    // On error, return a safe forward-style message rather than crashing the bot.
    process.stdout.write(
      "Thanks for your message! I'm having a brief technical hiccup — I've noted your query and our team will follow up shortly."
    );
    console.error("handle error:", e.message);
  });
