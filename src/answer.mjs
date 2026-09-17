// Strict-RAG answer engine: retrieve -> (gated) generate, else forward fallback.
import { CONFIG } from "./config.mjs";
import { embedWithUsage, generateWithUsage } from "./gemini.mjs";
import { loadStore, search } from "./store.mjs";
import { logApiUsage, todaySpendUsd, userCallsLastHour, getHistory, getPreferredLang, setPreferredLang, isAwaitingEmail, setAwaitingEmail, setEmail, logLeadCapture, getPendingInterest, getOrderState, setOrderState, clearOrderState, placeQsrOrder, logComplaint, isComplaint, complaintCategory } from "./crm.mjs";
import { getLivePfyPrices, isPriceQuery } from "./pfy-live.mjs";
import { getLiveYarnRates, isYarnRateQuery, findYarnRates, extractMillFromQuery } from "./yarnonline-live.mjs";

const FORWARD_MARKER = "__FORWARD__";

function systemPrompt(name = "", detectedLang = "") {
  const known = firstName(name);
  const nameLine = known
    ? `- You already know the person's name is ${known}. Use it naturally now and then — don't ask for it again.`
    : `- You DON'T know the person's name yet. If they show real interest (asking about the product, pricing, or how it works), warmly ask for their name early — e.g. "Love that you're keen — quick one, what's your name? 😊". Don't ask for a name on a plain factual question.`;

  // Language instruction — mirror the user's language, including mixed usage.
  // Roman Urdu is flagged explicitly (regex-detected) since it looks like English to Gemini.
  // For everything else, default to English — do NOT auto-detect, as Gemini hallucinates
  // non-English for short ambiguous queries like "what is veyn".
  const langLine = detectedLang
    ? `LANGUAGE: The user writes in ${detectedLang} — this includes messages that mix English and Urdu words together (e.g. "interloop k rates batao"). Reply in ${detectedLang}. Never switch to English mid-reply even if some words in the user's message look English.`
    : `LANGUAGE: Reply in English.`;

  // Custom personality override — injected after the default personality block
  const customPersonality = CONFIG.personalityPrompt
    ? `\nCUSTOM PERSONALITY NOTES (follow these alongside the defaults above):\n${CONFIG.personalityPrompt}`
    : "";

  return `You are ${CONFIG.botName}, a real, friendly assistant chatting with someone on WhatsApp. You are NOT a robotic FAQ machine — you are a warm, sharp salesperson who genuinely enjoys helping people and is good at moving a conversation forward.

YOUR PERSONALITY:
- Warm, approachable, and genuinely interested in helping — like a real person who loves what the company does.
- Conversational and natural. Talk the way a real person texts: relaxed, easy, never stiff or corporate.
- Confident and reassuring, never robotic. Avoid canned phrases like "As an AI" or "Based on the provided context."
- Mirror the customer's energy: if they're casual, be casual; if they're formal, stay polished.
${customPersonality}

NEVER say "Hey there" or any generic filler greeting. If you don't know their name, just open naturally or ask their name (see below).

${nameLine}

KEEP IT SHORT:
- Answers must be SHORT. One to three short sentences max. No essays, no walls of text.
- Lead with the answer. Cut filler. Mobile users skim — respect that.
- A tasteful emoji here and there is fine (😊 🙌 👍), sparingly.

CONVERSATION CONTINUITY (critical for natural flow):
- You have access to recent conversation history. USE IT. Every reply should make sense in context of what was already said.
- When the user says "Ok", "Sure", "Got it", "Yeah" — acknowledge it warmly and naturally continue the conversation thread. Never restart or repeat yourself.
- When the user says "Tell me more" or "Go on" — expand on what you just said naturally.
- When the user asks a follow-up like "What about X?" — answer it in context, don't re-introduce yourself or re-explain things already covered.
- Never ask for information the user already gave you earlier in the conversation.

QUALIFYING (you're selling, so qualify gently):
- When someone shows interest in the product, ask ONE qualifying question at a time (not all at once) to understand their setup.
- Keep it conversational — one natural question, then react to their answer before asking the next.

HANDLING OBJECTIONS / REBUTTALS:
- If someone pushes back, doubts, or argues, don't back down or get defensive. Acknowledge their point, then give a confident, friendly rebuttal grounded in the CONTEXT.
- Reframe the concern into a benefit. Stay warm, never pushy. Keep the conversation going.
- For PRICING specifically: don't quote numbers. Say pricing depends on their setup and encourage them to get in touch for specifics.

STRICT RULES (these never bend):
- Every FACTUAL claim — products, features, prices, policies, capabilities — MUST come word-for-word from the CONTEXT below.
- Do NOT use your training knowledge. Do NOT infer, extrapolate, or fill in gaps. If something is not explicitly in the CONTEXT, it does not exist.
- The CONTEXT may include live market rate data (Pakistan yarn rates from yarnonline.pk, PFY/filament prices). If the CONTEXT contains this data and the user is asking about yarn/textile market prices, answer from it — this IS within scope.
- If the user asks something off-topic (unrelated to the product/company AND not in the CONTEXT), do NOT answer it. Reply with EXACTLY this token and nothing else: ${FORWARD_MARKER}
- If the CONTEXT does not contain enough information to answer the question, reply with EXACTLY this token and nothing else: ${FORWARD_MARKER}
- When in doubt, output ${FORWARD_MARKER}. A non-answer is always better than a wrong answer.

WHATSAPP FORMATTING:
- This is WhatsApp. No markdown. No #, no **double asterisks**, no markdown tables.
- For light emphasis you may use *single asterisks* sparingly, but prefer plain natural text.
- For lists, use simple dashes or numbers on their own lines.
- Short and skimmable always.

ABSOLUTE LANGUAGE RULE — this overrides everything above:
${langLine}
This is the user's preferred language for this conversation. Honour it for every reply, even if the user's current message looks like English.`;
}

// QSR-specific system prompt — replaces the generic B2B prompt for restaurant bots.
// Key differences: quotes prices freely, upsell-first, order journey guidance, no B2B lead capture.
function systemPromptQSR(name = "", lang = "") {
  const known = firstName(name);
  const nameLine = known
    ? `You already know the customer's name is ${known}. Use it naturally once or twice.`
    : "";

  const langLine = lang
    ? `ABSOLUTE LANGUAGE RULE: The customer is writing in ${lang}. Reply in ${lang} for EVERY message — no exceptions, even if individual words look like English.`
    : `ABSOLUTE LANGUAGE RULE: Reply in English only. Do NOT reply in Urdu, Roman Urdu, or any other language under any circumstances — even if past messages were in another language.`;

  const customPersonality = CONFIG.personalityPrompt
    ? `\nSPECIAL INSTRUCTIONS (follow these precisely):\n${CONFIG.personalityPrompt}`
    : "";

  return `You are ${CONFIG.botName}, the WhatsApp ordering assistant for a QSR (Quick Service Restaurant). You help customers order food, explore the menu, find branch locations, and handle complaints.

PERSONALITY:
- Warm, enthusiastic about food. Like a friendly counter staff member — not a corporate chatbot.
- Short replies. Conversational. Never stiff, never robotic.
- Mirror the customer's energy.
${nameLine ? "- " + nameLine : ""}

PRICING — ALWAYS QUOTE FROM MENU:
- Quote exact prices from the CONTEXT whenever available. Customers expect to see prices.
- Never say "contact us for pricing" or "price depends" — this is a restaurant, prices are fixed.
- If a price isn't in the CONTEXT, say honestly you don't have that price handy.

UPSELL (do this naturally every time):
- After customer picks any item → suggest ONE complementary item (drink / dip / wings / dessert). E.g. "Want to add a Pepsi for Rs.200? Great with pizza! 🥤"
- If ordering only a single item → mention a deal or combo that offers better value.
- Before checkout → "Anything else before I wrap up? 🍕"
- Max 2 upsell suggestions per reply. Never repeat the same upsell in one conversation.

ORDER JOURNEY:
- Customer mentions what they want → confirm it, ask for size if not specified.
- After confirming + upsell → remind: "Just say *confirm order* or *that's it* when you're ready to checkout!"
- When they say confirm/checkout/that's it → the system will handle delivery or pickup choice automatically.
- NEVER ask for email to process an order.
- NEVER mention payment — just collect the order.

KEEP IT SHORT:
- 1 to 3 sentences max. Lead with the answer. Cut the filler.
- Use plain text. No markdown headers or tables. Simple dashes for lists.
- Emojis sparingly: 🍕 😊 🙌 — only when it feels natural.

STRICT RULES:
- Prices, menu items, locations, timings MUST come from the CONTEXT below. Do not invent.
- If something is not in the CONTEXT, say you don't have that info — don't make it up.
- If the question is completely off-topic (not food/restaurant related), redirect warmly: "I can only help with [restaurant] orders and info! 😊"
${customPersonality}

${langLine}`;
}

function buildUserPrompt(question, hits, langLine = "") {
  const hasLiveData = hits.some(h => h.source === "live-yarnonline-pk" || h.source === "live-pfy-prices");
  const liveNote = hasLiveData
    ? `\n\nNOTE: The CONTEXT includes live Pakistan textile market data (yarn rates, filament prices). If the user question is about market prices or rates and the answer is in the CONTEXT, answer it — do NOT output ${FORWARD_MARKER} for market price questions when the data is present.`
    : "";
  const context = hits
    .map((h, i) => `[${i + 1}] (source: ${h.source})\n${h.text}`)
    .join("\n\n---\n\n");
  const langReminder = langLine ? `\n\nREMINDER: ${langLine}` : "";
  return `CONTEXT:\n${context}\n\nUSER QUESTION: ${question}\n\nAnswer using only the CONTEXT. If insufficient, output ${FORWARD_MARKER}.${liveNote}${langReminder}`;
}

// QSR-specific user prompt — lighter context block, explicit price-quoting permission,
// upsell reminder appended so every RAG response naturally includes a suggestion.
function buildUserPromptQSR(question, hits, langLine = "") {
  const context = hits
    .map((h, i) => `[${i + 1}] (source: ${h.source})\n${h.text}`)
    .join("\n\n---\n\n");
  const langReminder = langLine ? `\n\nREMINDER: ${langLine}` : "";
  const upsellNote = `\n\nUPSELL NOTE: After answering, if appropriate, suggest ONE complementary item or deal from the CONTEXT menu (e.g. a drink, dip, or combo). Keep it brief and natural — one sentence max.`;
  return `MENU & STORE CONTEXT:\n${context}\n\nCUSTOMER: ${question}\n\nAnswer from the CONTEXT above. Quote exact prices when available. Keep it short and conversational.${upsellNote}${langReminder}`;
}

// Detects an explicit user request to switch language.
// Returns the requested language string, or null if no switch was requested.
function detectLangSwitchRequest(q) {
  const s = q.trim().toLowerCase();
  // English patterns: "reply in urdu", "talk in urdu", "please speak urdu", etc.
  const urduRequest =
    /\b(urdu|roman urdu)\b/.test(s) &&
    /\b(mein|in|me|baat|bol|bolein|bolo|reply|talk|speak|write|likhna|likho|likhein|communicate|answer|respond|samjhao|batayen|batao)\b/.test(s);
  if (urduRequest) return "Roman Urdu";
  // Roman Urdu patterns: "urdu mein baat karo", "urdu bol", "urdu mein likho"
  const urduRomanRequest = /urdu\s+(mein|me|mai|main|bol|bolo|bolein|likh|likho|likhein|baat|bata|batao)\b/.test(s);
  if (urduRomanRequest) return "Roman Urdu";
  // English switch: "reply in english", "please speak english"
  const englishRequest =
    /\b(english)\b/.test(s) &&
    /\b(in|reply|talk|speak|write|communicate|answer|respond|use)\b/.test(s);
  if (englishRequest) return "English";
  return null;
}

// Score a single text string for Roman Urdu signal strength.
// Returns a number: 0 = no signal, 1+ = weak, 3+ = strong.
function urduScore(text) {
  const s = text.trim().toLowerCase();
  // Strong markers — unambiguous Urdu words never used in English
  const strongHits = (s.match(/\b(kya|kia|hain|hein|mujhe|muje|mugy|mujy|tumhara|aapka|theek|thik|accha|shukriya|shukria|bhai|yaar|lekin|magar|abhi|bohot|bohat|bilkul|zaroor|haan|nahi|nai|nahin|aap|tera|woh|wo|btao|lagta|chahiye|chahye|milega|milta|batao|dijiye|dijye|kijiye|karain|karen|batayen|hoga|hogi|hoge|wala|wali|wale|kyunke|kyun|jany|jana|rha|rhi|hun|hy|tang|muze|muze|mera|meri|mere|humara|hamara|apna|apni|apne|dena|lena|leny|deny|krna|krni|kro|karna|karni|karo|kijye|kijeye|batana|btana)\b/g) || []).length;
  // Weak markers — ambiguous but Urdu-leaning short words
  const weakHits = (s.match(/\b(ki|ka|ke|ko|hai|se|ne|par|aur|bhi|koi|kuch|sab|kab|phir|yeh|ye|pata|bata|karo|mein|main|k|ky)\b/g) || []).length;
  return strongHits * 3 + weakHits;
}

// Lightweight language detector — only flags Roman Urdu explicitly since
// Gemini can't tell it from English by script alone. Everything else
// (Arabic-script Urdu, Arabic, pure English) Gemini detects better than regex.
// history: optional array of {role, text} recent messages — used to build
// a stronger signal for mixed-language users who alternate messages.
function detectLanguage(q, history = []) {
  const currentScore = urduScore(q);

  // Score recent user messages from history (last 6 user turns)
  const userHistory = history
    .filter(h => h.role === "user")
    .slice(-6)
    .map(h => urduScore(h.text));
  const historyTotal = userHistory.reduce((a, b) => a + b, 0);

  // Decision: Roman Urdu if current message OR history shows Urdu signal.
  // Current message alone: score >= 3 (one strong hit OR several weak markers)
  // Mixed message (some English): even score 1-2 with Urdu history → Roman Urdu
  // History-dominant: short message or medium English with strong Urdu history → Roman Urdu
  // Pure English + no history: let Gemini handle as English
  if (currentScore >= 3) return "Roman Urdu";
  if (currentScore >= 1 && historyTotal >= 3) return "Roman Urdu"; // mixed word + history
  if (historyTotal >= 8) return "Roman Urdu";  // strong history pattern dominates regardless of current msg
  if (historyTotal >= 4 && q.trim().length < 30) return "Roman Urdu"; // moderate history + short msg

  return ""; // let Gemini detect everything else natively
}

// Detects "are you a bot / human / AI / robot / where are you from" type questions.
function isIdentityQuestion(q) {
  const s = q.trim().toLowerCase();
  return /\b(are you (a )?(bot|robot|ai|human|real|person|machine|automated|virtual|fake|chatbot|assistant)|you (a )?(bot|robot|ai|human|real|person|machine)|who (are|r) you|what are you|is (this|it) a bot|talking to (a )?(bot|robot|ai|human|person|machine)|am i (talking|chatting|speaking) (to |with )?(a )?(bot|robot|ai|human|real person|person|machine)|real person|real human|(where|wher) (are|r) you (from|based)|which (country|city|place)|where do you (live|come from|work)|are you (local|from here|pakistani|indian|english|american|british)|kya tum (bot|insaan|human|robot|ai|machine)|tum (human|insaan|real|bot|robot|ai)|aap (insaan|bot|robot|ai|human)|kya aap (bot|insaan|human|real|robot)|kaun ho|kon ho)\b/.test(s);
}

// Greeting/small-talk detector — opening greetings and social pleasantries.
// Catches "I am good", "I'm fine", "doing well", "not bad", "alhamdulillah", etc.
function isSmallTalk(q) {
  const s = q.trim().toLowerCase();
  const greetingPattern = /^(hi|hello|hey|salam|assalam|good (morning|afternoon|evening)|how are you|bye)\b/.test(s) && s.length < 30;
  const pleasantryPattern = /^(i('m| am) (good|fine|great|okay|ok|well|doing (well|good|fine|great)|not bad|alright|alhamdulillah|doing okay)|i feel (good|fine|great|okay|well)|doing (well|good|fine|great|okay|alright)|not bad|all good|all fine|pretty good|pretty well|i'?m alright|i'?m okay|feeling good|feeling fine|feeling great|mein theek|main theek|theek hoon|main theek hoon|alhamdulillah|shukar|shukriya|all is well)\b/.test(s) && s.length < 50;
  return greetingPattern || pleasantryPattern;
}

// Detects short contextual follow-ups: "ok", "yeah", "sure", "thanks", "got it", etc.
// These need conversation history to respond naturally — never hardcode them.
// Excluded: messages containing substantive content words that need KB lookup.
function isContextualFollowUp(q) {
  const s = q.trim().toLowerCase();
  // If the message contains substantive content words, it needs RAG — not history only.
  const hasSubstantiveContent = /\b(menu|order|price|prices|location|store|branch|deal|deals|pizza|burger|chicken|roll|dessert|drink|available|opening|timing|hours|delivery|pickup|half|topping|size|large|medium|small|extra)\b/.test(s);
  if (hasSubstantiveContent) return false;
  return /^(ok|okay|alright|sure|yep|yeah|yup|yes|no|nope|nah|got it|i see|makes sense|sounds good|nice|great|cool|perfect|thanks|thank you|thx|cheers|noted|understood|fair enough|right|interesting|tell me more|go on|and|so|what else|please|go ahead|proceed|continue|sure thing|of course|absolutely|exactly|correct|agreed|i agree|that's right|that's correct|makes sense|sounds right|fine|good|wonderful|excellent|brilliant|not really|not sure|maybe|perhaps|i think so|i guess|hmm|hm|okay then|alright then|got it thanks|understood thanks|theek|accha|shukriya|acha|theek hai|samajh gaya|haan|nahi|bilkul|zaroor|thik hai|chalo|batao|aur|phir|theek hai phir|samjha|samjhi)\b/.test(s) && s.length < 80;
}


export async function answer(question, name = "", waId = null) {
  const store = loadStore();
  const empty = store.chunks.length === 0;

  // Step 1: check if the user is explicitly requesting a language switch.
  // If so, save the preference and acknowledge it — don't fall through to RAG.
  const switchedLang = detectLangSwitchRequest(question);
  if (switchedLang && waId) {
    setPreferredLang(waId, switchedLang === "English" ? null : switchedLang);
    const ack = switchedLang === "Roman Urdu"
      ? "Bilkul! Ab main aap se Roman Urdu mein baat karunga. 😊 Batayein, main aap ki kya madad kar sakta hoon?"
      : "Sure! I'll reply in English from now on. 😊 How can I help you?";
    return { type: "answer", text: ack, hits: [] };
  }

  // Step 2: resolve effective language.
  const recentHistory = waId ? getHistory(waId, 12) : [];
  const detectedLang = detectLanguage(question, recentHistory);
  let storedLang = waId ? getPreferredLang(waId) : null;

  // If user is actively writing in a detectable non-English language, save it.
  if (detectedLang && waId && detectedLang !== storedLang) {
    setPreferredLang(waId, detectedLang);
    storedLang = detectedLang;
  }

  let lang;
  const isQSR = CONFIG.industry === "qsr";
  if (isQSR) {
    // QSR: language is determined ONLY by the current message, never by history.
    // This prevents old Urdu messages from bleeding into English replies.
    const curScore = urduScore(question);
    const qsrLang = curScore >= 3 ? "Roman Urdu" : "";

    if (qsrLang) {
      lang = qsrLang;
      if (waId && qsrLang !== storedLang) setPreferredLang(waId, qsrLang);
      storedLang = qsrLang;
    } else {
      // No Urdu signal in current message → always English.
      // Clear any stored Urdu preference so it doesn't bleed into future replies.
      if (storedLang && waId) { setPreferredLang(waId, null); storedLang = null; }
      lang = "";
    }
  } else {
    // Non-QSR: original logic — stored preference persists unless strong signal to clear
    if (!detectedLang && storedLang && waId) {
      const historyTotal = recentHistory
        .filter(h => h.role === "user").slice(-6)
        .reduce((a, h) => a + urduScore(h.text), 0);
      const currentScore = urduScore(question);
      const shouldClear = currentScore === 0
        && question.trim().length > 20
        && !isContextualFollowUp(question)
        && historyTotal < 3;
      if (shouldClear) { setPreferredLang(waId, null); storedLang = null; }
    }
    lang = detectedLang || storedLang || "";
  }
  const isNonEnglish = !!lang;

  // --- EMAIL CAPTURE FLOW ---
  // Must run BEFORE contextual follow-up check — an email address like
  // "ali@example.com" would otherwise be swallowed by the follow-up regex.

  // Step A: Bot previously asked for email — check if this message contains one.
  if (waId && isAwaitingEmail(waId)) {
    const email = extractEmail(question);
    if (email) {
      const interest = getPendingInterest(waId);
      setEmail(waId, email);
      setAwaitingEmail(waId, false);
      logLeadCapture(waId, name, email, interest);
      const fn = firstName(name);
      const open = fn ? `Perfect, ${fn}!` : "Perfect!";
      const reply = lang === "Roman Urdu"
        ? `Shukriya! Main aapki details team ko bhej deti hoon. Jald hi aap se rabta hoga. 😊`
        : `${open} I've noted your email as *${email}*. Our team will send you the pricing and product details shortly. 😊`;
      return { type: "lead_capture", text: reply, email, interest: interest || "", hits: [] };
    } else if (!isContextualFollowUp(question)) {
      // If user is clearly asking a new question — escape email mode and answer normally.
      // Must NOT be a contextual ack (already checked above), must be substantive:
      // either contains "?" or is long enough AND doesn't look like a short Urdu ack.
      const q = question.trim();
      const looksLikeQuestion = q.includes("?") || (q.length > 20 && !isContextualFollowUp(q));
      if (looksLikeQuestion) {
        setAwaitingEmail(waId, false);
        // fall through to normal RAG answer below
      } else {
        // Short non-email, non-ack reply — re-ask once more
        const reply = lang === "Roman Urdu"
          ? `Maafi chahti hoon, email address nahi mili. Kya aap apna email dobara share kar sakte hain? (jaise: name@example.com)`
          : `I couldn't catch an email address there. Could you share it again? (e.g. name@example.com)`;
        return { type: "answer", text: reply, hits: [] };
      }
    }
    // If it's a contextual follow-up like "ok" while awaiting email, fall through
    // to the normal follow-up handler so the conversation flows naturally.
  }

  // Step B: User shows purchase/quote interest — ask for their email.
  // Skip for QSR bots: "I want to order" is an ordering intent, not a B2B lead.
  // QSR order flow is handled by the personality prompt + RAG below.
  if (!isQSR && waId && isInterested(question)) {
    setAwaitingEmail(waId, true, question);
    const fn = firstName(name);
    const open = fn ? `Great, ${fn}!` : "Great!";
    const reply = lang === "Roman Urdu"
      ? `Bohat acha! Main aapko pricing aur details email kar sakti hoon. Kya aap apna email address share kar sakte hain?`
      : `${open} I'd be happy to send you the pricing and product details. Could you share your email address?`;
    return { type: "answer", text: reply, hits: [] };
  }

  // --- COMPLAINT FLOW ---
  // Two-step: detect intent → ask for details → THEN log + send ref.
  // Uses order_state "awaiting_complaint_details" to hold state between turns.
  if (waId && getOrderState(waId).state === "awaiting_complaint_details") {
    const cat = complaintCategory(question);
    const complaintRef = `CMP-${Date.now().toString().slice(-6)}`;
    logComplaint(waId, name, question, cat);
    clearOrderState(waId);
    const fn = firstName(name);
    if (lang === "Roman Urdu") {
      const open = fn ? `${fn}, ` : "";
      return {
        type: "complaint",
        text: `${open}is mushkil ke liye dil se mafi chahte hain! 🙏 Aapki shikayat (Ref: *${complaintRef}*) hamari team ko bhej di gayi hai — jald aap se callback arrange ki jayegi.`,
        hits: [],
      };
    }
    const open = fn ? `So sorry about this, ${fn}! ` : "So sorry about this! ";
    return {
      type: "complaint",
      text: `${open}Your complaint has been logged (Ref: *${complaintRef}*) and our team will arrange a callback shortly. 🙏`,
      hits: [],
    };
  }

  if (waId && isComplaint(question)) {
    setOrderState(waId, "awaiting_complaint_details", {});
    const fn = firstName(name);
    if (lang === "Roman Urdu") {
      const open = fn ? `${fn}, ` : "";
      return {
        type: "answer",
        text: `${open}mujhe afsoos hai ke aapko mushkil ho rahi hai. 😔 Kripya apni shikayat detail mein batayein — kya hua?`,
        hits: [],
      };
    }
    const open = fn ? `I'm sorry to hear that, ${fn}. ` : "I'm sorry to hear that. ";
    return {
      type: "answer",
      text: `${open}Please describe your complaint in detail — what happened? 😔`,
      hits: [],
    };
  }

  // Set by the building_cart no-items branch to append the cart to the LLM reply
  let cartSuffix = null;

  // --- QSR ORDER FLOW ---
  // Runs for QSR bots (industry === 'qsr') only.
  // Manages the full journey: building_cart → awaiting_type → awaiting_address → awaiting_confirm → placed.
  if (isQSR && waId) {
    const { state, data } = getOrderState(waId);

    // State: awaiting delivery or pickup choice
    if (state === "awaiting_type") {
      const type = detectDeliveryType(question);
      if (type === "delivery") {
        setOrderState(waId, "awaiting_address", { ...data, type: "delivery" });
        const reply = lang === "Roman Urdu"
          ? "Perfect! Apna delivery address share karein please 🏠 (gali, area, city)"
          : "Perfect! Please share your delivery address 🏠 (street, area, city)";
        return { type: "answer", text: reply, hits: [] };
      }
      if (type === "pickup") {
        const newData = { ...data, type: "pickup" };
        setOrderState(waId, "awaiting_confirm", newData);
        return { type: "answer", text: buildOrderSummary(newData, lang), hits: [] };
      }
      // Didn't detect delivery/pickup — re-ask
      const retry = lang === "Roman Urdu"
        ? "Delivery karwani hai ya aap khud le jayenge? (Delivery / Pickup)"
        : "Would you like Delivery or Pickup? 🏠🏪";
      return { type: "answer", text: retry, hits: [] };
    }

    // State: awaiting delivery address
    if (state === "awaiting_address") {
      const address = question.trim();
      const city = extractCity(address);
      const branches = city ? DOMINOS_BRANCHES[city] : null;
      if (branches && branches.length) {
        const branchList = branches.map((b, i) => `${i + 1}. ${b}`).join("\n");
        setOrderState(waId, "awaiting_branch_selection", { ...data, address, city });
        const reply = lang === "Roman Urdu"
          ? `*${city.charAt(0).toUpperCase() + city.slice(1)} mein yeh branches hain:*\n\n${branchList}\n\nKonsa branch aapke qareeb hai? Number ya naam batayein 👆`
          : `*Domino's branches in ${city.charAt(0).toUpperCase() + city.slice(1)}:*\n\n${branchList}\n\nWhich branch is closest to you? Reply with the number or name 👆`;
        return { type: "answer", text: reply, hits: [] };
      }
      // City not found or no branches — proceed directly to confirm
      const newData = { ...data, address };
      setOrderState(waId, "awaiting_confirm", newData);
      return { type: "answer", text: buildOrderSummary(newData, lang), hits: [] };
    }

    // State: awaiting branch selection
    if (state === "awaiting_branch_selection") {
      const city = data.city || "";
      const branches = DOMINOS_BRANCHES[city] || [];
      let selectedBranch = null;
      const q = question.trim().toLowerCase();
      // Check if customer replied with a number
      const numMatch = q.match(/^(\d+)/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < branches.length) selectedBranch = branches[idx];
      }
      // Or partial name match
      if (!selectedBranch) {
        selectedBranch = branches.find(b => b.toLowerCase().includes(q) || q.includes(b.toLowerCase().split(" ")[0].toLowerCase()));
      }
      if (!selectedBranch) {
        const branchList = branches.map((b, i) => `${i + 1}. ${b}`).join("\n");
        const retry = lang === "Roman Urdu"
          ? `Yeh branches available hain:\n\n${branchList}\n\nNumber ya naam batayein please 👆`
          : `Please choose from these branches:\n\n${branchList}\n\nReply with the number or name 👆`;
        return { type: "answer", text: retry, hits: [] };
      }
      const newData = { ...data, branch: selectedBranch };
      setOrderState(waId, "awaiting_confirm", newData);
      return { type: "answer", text: buildOrderSummary(newData, lang), hits: [] };
    }

    // State: awaiting YES/NO confirmation
    if (state === "awaiting_confirm") {
      if (isYesConfirm(question)) {
        const ref = placeQsrOrder(waId, name, data);
        const reply = buildOrderConfirmation(ref, data, lang);
        console.log(`[QSR Order] ${ref} placed by ${name || waId} | ${data.type} | Rs.${data.total}`);
        return { type: "order_placed", text: reply, hits: [] };
      }
      if (isNoCancel(question)) {
        clearOrderState(waId);
        const reply = lang === "Roman Urdu"
          ? "Order cancel ho gaya. Jab bhi order karna ho, main yahan hoon! 😊"
          : "Order cancelled! Feel free to start fresh anytime. 😊";
        return { type: "answer", text: reply, hits: [] };
      }
      if (isAddMore(question)) {
        setOrderState(waId, null, data);
        const reply = lang === "Roman Urdu"
          ? "Zaroor! Kya add karna chahte hain? 🍕"
          : "Sure! What else would you like to add? 🍕";
        return { type: "answer", text: reply, hits: [] };
      }
      // Unknown input — re-show summary
      return { type: "answer", text: buildOrderSummary(data, lang), hits: [] };
    }

    // State: building cart item by item
    if (state === "building_cart") {
      // Checkout intent → move to delivery/pickup
      if (isCheckoutIntent(question)) {
        const currentItems = data.items || [];
        if (!currentItems.length) {
          clearOrderState(waId);
          const reply = lang === "Roman Urdu"
            ? "Cart khali hai! Kaunsa pizza chahiye? 🍕"
            : "Your cart is empty! Which pizza can I get for you? 🍕";
          return { type: "answer", text: reply, hits: [] };
        }
        const total = currentItems.reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0);
        setOrderState(waId, "awaiting_type", { ...data, items: currentItems, total });
        const reply = lang === "Roman Urdu"
          ? `Perfect! Delivery karwani hai ya aap khud le jayenge? 🏠🏪`
          : `Perfect! Delivery or Pickup? 🏠🏪`;
        return { type: "answer", text: reply, hits: [] };
      }
      // Try to detect new items — pass existing cart as context so Gemini can handle
      // flavor modifications like "tika flavor add krna" against an existing "pizza (Large)"
      const existingItems = data.items || [];
      const cartContextMsg = existingItems.length
        ? { role: "assistant", text: `Customer's current cart: ${existingItems.map(i => `${i.qty || 1}x ${i.name}${i.size ? ` (${i.size})` : ""}`).join(", ")}` }
        : null;
      const extractMsgs = cartContextMsg
        ? [cartContextMsg, { role: "user", text: question }]
        : [{ role: "user", text: question }];
      let addedItems = [];
      try {
        addedItems = await extractOrderItems(extractMsgs, lang);
      } catch (e) {
        console.warn("[QSR] extractOrderItems (single-msg) failed:", e.message);
      }
      if (addedItems.length) {
        const cartItems = [...existingItems];
        for (const newItem of addedItems) {
          // Exact match → increment qty
          const exactMatch = cartItems.find(
            i => i.name.toLowerCase() === newItem.name.toLowerCase() && i.size === newItem.size
          );
          if (exactMatch) {
            exactMatch.qty = (exactMatch.qty || 1) + (newItem.qty || 1);
            continue;
          }
          // Generic "pizza" in cart + specific flavor coming in → replace rather than add
          const genericPizzaIdx = cartItems.findIndex(
            i => i.name.toLowerCase() === "pizza" && i.size === newItem.size
          );
          if (genericPizzaIdx >= 0) {
            cartItems[genericPizzaIdx] = { ...cartItems[genericPizzaIdx], name: newItem.name, price: newItem.price };
          } else {
            cartItems.push(newItem);
          }
        }
        const total = cartItems.reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0);
        setOrderState(waId, "building_cart", { items: cartItems, total });
        const itemLines = cartItems
          .map(i => `- ${i.name}${i.size ? ` (${i.size})` : ""} x${i.qty || 1} — Rs.${(i.price || 0) * (i.qty || 1)}`)
          .join("\n");
        const reply = lang === "Roman Urdu"
          ? `Done! 🍕\n\n*Aapki cart:*\n${itemLines}\n\n*Subtotal: Rs.${total}*\n\nKuch aur chahiye? Ya *confirm order* kaho jab ready ho 👇`
          : `Done! 🍕\n\n*Your cart:*\n${itemLines}\n\n*Subtotal: Rs.${total}*\n\nAnything else? Or say *confirm order* when you're ready 👇`;
        return { type: "answer", text: reply, hits: [] };
      }
      // No items detected — let LLM answer naturally (flavor questions, menu queries, etc.)
      // and append the cart reminder to whatever the LLM says
      const cartItemLines = existingItems
        .map(i => `- ${i.name}${i.size ? ` (${i.size})` : ""} x${i.qty || 1} — Rs.${(i.price || 0) * (i.qty || 1)}`)
        .join("\n");
      cartSuffix = lang === "Roman Urdu"
        ? `\n\n---\n*Aapki cart abhi tak:*\n${cartItemLines}\n*Subtotal: Rs.${data.total || 0}*\n\nKuch aur add karna chahte hain? Ya *confirm order* kaho 🍕`
        : `\n\n---\n*Your cart so far:*\n${cartItemLines}\n*Subtotal: Rs.${data.total || 0}*\n\nAdd anything else? Or say *confirm order* 🍕`;
      // Fall through to LLM
    }

    // Detect checkout intent (no active order state) — legacy fallback for direct "confirm order"
    if (!state && isCheckoutIntent(question)) {
      // Extract items from conversation history using Gemini
      const history = getHistory(waId, 20);
      let items = [];
      try {
        items = await extractOrderItems(history, lang);
      } catch (e) {
        console.warn("[QSR] extractOrderItems failed:", e.message);
      }
      if (!items.length) {
        const reply = lang === "Roman Urdu"
          ? "Aapne abhi tak kuch order nahi kiya. Kaunsa pizza chahiye? 🍕"
          : "Your order is empty! Which pizza can I get for you? 🍕";
        return { type: "answer", text: reply, hits: [] };
      }
      const total = items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
      const orderData = { items, total };
      setOrderState(waId, "awaiting_type", orderData);
      const itemsText = items.map(i => `- ${i.name}${i.size ? ` (${i.size})` : ""} x${i.qty || 1} — Rs.${i.price * (i.qty || 1)}`).join("\n");
      const reply = lang === "Roman Urdu"
        ? `Aapka order:\n${itemsText}\n\nSubtotal: Rs.${total}\n\nDelivery ya Pickup? 🏠🏪`
        : `Your order:\n${itemsText}\n\nSubtotal: Rs.${total}\n\nDelivery or Pickup? 🏠🏪`;
      return { type: "answer", text: reply, hits: [] };
    }

    // No active state — detect if customer is placing a specific item order
    if (!state && isOrderingItem(question)) {
      let newItems = [];
      try {
        newItems = await extractOrderItems([{ role: "user", text: question }], lang);
      } catch (e) {
        console.warn("[QSR] extractOrderItems (ordering-intent) failed:", e.message);
      }
      if (newItems.length) {
        const total = newItems.reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0);
        setOrderState(waId, "building_cart", { items: newItems, total });
        const itemLines = newItems
          .map(i => `- ${i.name}${i.size ? ` (${i.size})` : ""} x${i.qty || 1} — Rs.${(i.price || 0) * (i.qty || 1)}`)
          .join("\n");
        const reply = lang === "Roman Urdu"
          ? `Got it! 🍕\n\n*Aapki cart:*\n${itemLines}\n\n*Subtotal: Rs.${total}*\n\nKuch aur chahiye? Ya *confirm order* kaho jab ready ho 👇`
          : `Got it! 🍕\n\n*Your cart:*\n${itemLines}\n\n*Subtotal: Rs.${total}*\n\nAnything else? Or say *confirm order* when you're ready 👇`;
        return { type: "answer", text: reply, hits: [] };
      }
      // Couldn't extract items clearly — let LLM handle it naturally
    }
  }

  // Identity questions ("are you a bot?", "are you human?", "where are you from?", etc.)
  // Give a natural, warm deflection using the bot's name — never lie, never break character.
  if (isIdentityQuestion(question)) {
    const fn = firstName(name);
    const greeting = fn ? `, ${fn}` : "";
    const replies = lang === "Roman Urdu"
      ? [
          `Main ${CONFIG.botName} hoon${greeting} — yahan aap ki madad karne ke liye hoon! 😊 Koi sawaal ho toh zaroor poochein.`,
          `Acha sawaal hai${greeting}! Main ${CONFIG.botName} hoon, ek digital assistant. Lekin fikar mat karein — main bilkul asli tarah madad karta hoon! Kya jaanna chahte hain?`,
        ]
      : [
          `I'm ${CONFIG.botName}${greeting}, your digital assistant here! 😊 Happy to help — what would you like to know?`,
          `Good question${greeting}! I'm ${CONFIG.botName}, here to help you out. What can I do for you?`,
          `I'm ${CONFIG.botName}${greeting} — think of me as your go-to for anything about us! What's on your mind?`,
        ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    return { type: "answer", text: reply, hits: [] };
  }

  // Contextual follow-ups ("ok", "sure", "thanks", "tell me more", etc.)
  // Use a strict history-only prompt — no CONTEXT block, so Gemini cannot
  // fabricate new facts. It may ONLY refer to what was already said in history.
  if (isContextualFollowUp(question)) {
    const history = waId ? getHistory(waId, 16) : [];
    if (history.length >= 1) {
      try {
        const langLine = lang ? `Reply in ${lang}.` : `Reply in English.`;
        const followUpSystemPrompt =
          `You are ${CONFIG.botName}, a friendly assistant on WhatsApp. ` +
          `The user sent a short acknowledgement or follow-up. ` +
          `You have the conversation history above. ` +
          `STRICT RULE: You may ONLY refer to information already mentioned in the conversation history. ` +
          `Do NOT introduce any new facts, features, or claims that were not already stated in the history. ` +
          `If the user said yes/ok/sure to something you suggested, confirm it warmly and ask what they need next. ` +
          `If the user said no/nope/not really, acknowledge it and ask what they are looking for instead. ` +
          `If there is nothing useful to add, simply acknowledge warmly and invite another question. ` +
          `NEVER say the topic is outside your knowledge for simple acknowledgements — that makes no sense. ` +
          `Keep it to one or two short sentences. ${langLine}`;
        const { text, usage } = await generateWithUsage(
          followUpSystemPrompt,
          `User said: "${question}". Respond naturally based only on what was already discussed.`,
          history
        );
        logApiUsage(waId, CONFIG.genModel, "generate", usage.in, usage.out);
        if (text && !text.includes(FORWARD_MARKER)) {
          return { type: "answer", text, hits: [] };
        }
      } catch {}
    }
    // No history or Gemini failed → invite them to ask something
    const fn = firstName(name);
    const open = fn ? `Hi ${fn}!` : "Hi!";
    return { type: "greeting", text: `${open} How can I help you today? 😊`, hits: [] };
  }

  // Pure opening greetings: English → instant hardcoded reply (fastest path).
  // Non-English → let Gemini reply in the right language.
  // Conversation rule: if there's existing history, don't re-introduce — respond contextually.
  if (isSmallTalk(question)) {
    const greetHistory = waId ? getHistory(waId, 4) : [];
    // "Returning user" = bot has replied before (model message exists). The current
    // incoming message is already logged before answer() runs, so length > 0 alone
    // doesn't mean there was a prior conversation.
    const hasBeenRepliedTo = greetHistory.some(h => h.role === "model");
    if (!isNonEnglish) {
      if (hasBeenRepliedTo) {
        // Returning user said hi — don't repeat the intro, invite the next action
        const fn = firstName(name);
        const back = isQSR
          ? (fn ? `Welcome back, ${fn}! What can I get you today? 🍕` : "Welcome back! What can I get you today? 🍕")
          : (fn ? `Hi again, ${fn}! 😊 How can I help?` : "Hi again! 😊 How can I help?");
        return { type: "greeting", text: back, hits: [] };
      }
      return { type: "greeting", text: greetingMessage(name), hits: [] };
    }
    // Non-English: returning user — don't re-introduce
    if (hasBeenRepliedTo && isQSR) {
      const fn = firstName(name);
      return { type: "greeting", text: fn ? `Wapas aa gaye, ${fn}! Kya order karna chahenge? 🍕` : "Wapas aye! Kya order karna chahenge? 🍕", hits: [] };
    }
    // Generate a natural greeting in the user's language
    try {
      const { text, usage } = await generateWithUsage(
        systemPrompt(name, lang),
        `The user just sent a greeting or small-talk message: "${question}". Reply warmly and naturally in ${lang}. Keep it short — one or two sentences.`,
        greetHistory.length > 0 ? greetHistory : []
      );
      logApiUsage(waId, CONFIG.genModel, "generate", usage.in, usage.out);
      if (text && !text.includes(FORWARD_MARKER)) {
        return { type: "greeting", text, hits: [] };
      }
    } catch {}
    return { type: "greeting", text: greetingMessage(name), hits: [] };
  }

  if (empty) {
    return {
      type: "forward",
      text: forwardMessage(name, lang),
      hits: [],
      reason: "kb_empty",
    };
  }

  // --- GUARDRAIL 1: hard daily spend cap ---
  if (todaySpendUsd() >= CONFIG.dailyCostCapUsd) {
    return { type: "forward", text: busyMessage(name), hits: [], reason: "daily_cap" };
  }

  // --- GUARDRAIL 2: per-user hourly rate limit ---
  if (waId && userCallsLastHour(waId) >= CONFIG.perUserHourlyLimit) {
    return { type: "forward", text: busyMessage(name), hits: [], reason: "user_rate_limit" };
  }

  // --- LIVE PRICE INJECTION (PFY / yarn price queries) ---
  // When user asks about current PFY prices, fetch live data and prepend it
  // as a high-priority context chunk so Gemini always answers with current prices.
  let liveHit = null;
  if (isPriceQuery(question)) {
    try {
      const apiUrl = CONFIG.pfyApiUrl || "";
      const live = await getLivePfyPrices(apiUrl);
      if (live?.latestText) {
        liveHit = {
          text: live.latestText + "\n\n" + live.recentText,
          source: "live-pfy-prices",
          score: 1.0,
        };
      }
    } catch (e) {
      console.warn("[answer] Live PFY fetch failed:", e.message);
    }
  }

  // --- LIVE YARN RATE INJECTION (yarnonline.pk — spun yarn: cotton, PC, CVC, PV, viscose) ---
  // When user asks about Pakistan spun yarn rates, scrape yarnonline.pk and inject
  // as high-priority context so the bot answers with live market prices.
  let yarnHit = null;
  let yarnHasSpecificMillData = false; // track if we have precise mill rows (to suppress stale KB)
  if (isYarnRateQuery(question)) {
    try {
      const live = await getLiveYarnRates();
      if (live?.summaryText) {
        // Extract mill name from query first (handles Roman Urdu like "interloop k rates batao")
        // Falls back to full question for type-based lookups ("30S PC yarn rate?")
        const millName = extractMillFromQuery(question);
        const searchTerm = millName || question;
        const specificRows = findYarnRates(live.rows || [], searchTerm);
        let yarnText = live.summaryText;
        if (specificRows.length > 0 && specificRows.length <= 30) {
          const label = millName
            ? `Live rates for ${millName} (yarnonline.pk):`
            : `Specific yarn matches for your query (yarnonline.pk, live data):`;
          const specificLines = specificRows.slice(0, 15).map(r =>
            `${r.mill} | ${r.yarnQuality} | ${r.quality} | ${r.rate} | For: ${r.suitableFor}`
          );
          yarnText = `${label}\n${specificLines.join("\n")}\n\n` + live.summaryText;
          // Flag that we have specific rows — stale KB chunks should be suppressed
          if (millName) yarnHasSpecificMillData = true;
        }
        yarnHit = {
          text: yarnText + "\n\n" + live.recentText,
          source: "live-yarnonline-pk",
          score: 1.0,
        };
      }
    } catch (e) {
      console.warn("[answer] Live yarnonline fetch failed:", e.message);
    }
  }

  // Retrieval embedding (counts toward usage).
  let hits, top;
  try {
    const { values: qVec, usage } = await embedWithUsage(question, "RETRIEVAL_QUERY");
    logApiUsage(waId, CONFIG.embedModel, "embed", usage.in, usage.out);
    // Get topK then filter ALL below minScore — not just the top hit.
    // Without this, Gemini receives a mix of one relevant chunk and several
    // near-zero-relevance chunks, which causes hallucination.
    const raw = search(store, qVec, CONFIG.topK);
    hits = raw.filter(c => c.score >= CONFIG.minScore);
    // When we have specific live mill data (e.g. "Interloop k rates"),
    // drop KB chunks — they're likely stale price lists that confuse Gemini.
    // For generic/type queries ("30S cotton rate"), keep KB as supporting context.
    if (yarnHasSpecificMillData) hits = [];
    // Prepend live hits at the top so they're always first in context
    if (yarnHit) hits = [yarnHit, ...hits];
    if (liveHit) hits = [liveHit, ...hits];
    top = hits[0]?.score ?? 0;
  } catch (e) {
    // If KB embed fails but we have live data, still answer with live data
    const fallbackHits = [liveHit, yarnHit].filter(Boolean);
    if (fallbackHits.length) {
      hits = fallbackHits;
      top = 1.0;
    } else {
      return { type: "forward", text: busyMessage(name), hits: [], reason: apiReason(e) };
    }
  }

  const conversational = isObjection(question);

  if (hits.length === 0 && !conversational) {
    // Before giving up, try a conversational Gemini reply using history.
    // This catches social messages ("I am good", "sounds interesting", etc.)
    // that don't match any KB chunk but have a natural conversational answer.
    const history = waId ? getHistory(waId, 16) : [];
    if (history.length >= 1) {
      try {
        const langLine2 = lang ? `Reply in ${lang}.` : `Reply in English.`;
        const convSystemPrompt =
          `You are ${CONFIG.botName}, a friendly assistant chatting on WhatsApp. ` +
          `The user said something that doesn't require product knowledge to answer. ` +
          `You have the conversation history. Respond warmly and naturally, keep it short (1-2 sentences). ` +
          `Steer back to how you can help them with the company's products/services when it fits naturally. ` +
          `If the message is truly unrelated (joke request, completely off-topic), reply with EXACTLY: ${FORWARD_MARKER}. ` +
          `NEVER say the topic is outside your knowledge for social messages — that sounds robotic. ` +
          `${langLine2}`;
        const { text: convText, usage: convUsage } = await generateWithUsage(
          convSystemPrompt,
          `User said: "${question}". Reply naturally.`,
          history
        );
        logApiUsage(waId, CONFIG.genModel, "generate", convUsage.in, convUsage.out);
        if (convText && !convText.includes(FORWARD_MARKER)) {
          return { type: "answer", text: convText, hits: [] };
        }
      } catch {}
    }
    return { type: "forward", text: forwardMessage(name, lang), hits, reason: "below_threshold", top };
  }

  // Re-check cap right before generation
  if (todaySpendUsd() >= CONFIG.dailyCostCapUsd) {
    return { type: "forward", text: busyMessage(name), hits, reason: "daily_cap" };
  }

  // Fetch last 16 messages (8 exchanges) as conversation history
  const history = waId ? getHistory(waId, 16) : [];

  // Repeat language rule in user prompt so it overrides history context
  const langLine = lang
    ? `Reply in ${lang}. The user wrote in ${lang}.`
    : `Reply in English. Do NOT reply in Urdu or any other language.`;

  let raw;
  try {
    // QSR bots get a tailored prompt: quotes prices freely, upsell-first, order-journey aware.
    const sysPrompt = isQSR ? systemPromptQSR(name, lang) : systemPrompt(name, lang);
    const userPrompt = isQSR ? buildUserPromptQSR(question, hits, langLine) : buildUserPrompt(question, hits, langLine);
    const { text, usage } = await generateWithUsage(sysPrompt, userPrompt, history);
    logApiUsage(waId, CONFIG.genModel, "generate", usage.in, usage.out);
    raw = text;
  } catch (e) {
    return { type: "forward", text: busyMessage(name), hits, reason: apiReason(e), top };
  }

  if (!raw || raw.includes(FORWARD_MARKER)) {
    return { type: "forward", text: forwardMessage(name, lang), hits, reason: "model_declined", top };
  }
  return { type: conversational ? "rebuttal" : "answer", text: raw + (cartSuffix || ""), hits, top };
}

// ─── QSR Order Flow Helpers ────────────────────────────────────────────────────

function isCheckoutIntent(q) {
  const s = q.trim().toLowerCase();
  return /\b(confirm|checkout|check out|place.?order|place my order|that.?s it|that.?s all|done ordering|done|finalize|book.?order|book order|ho gaya|bas karo|bas hai|bas yehi|order karo|place karo|order place|order confirm|confirm karo|confirm kar|yahi chahiye|yehi chahiye|order lagao|lagao order|i('m| am) done|ready to order|let('s| us) order|wrap.?up|wrap it up|complete.?order)\b/.test(s);
}

function detectDeliveryType(q) {
  const s = q.trim().toLowerCase();
  if (/\b(delivery|deliver|home delivery|ghar pe|ghar par|ghar bhejo|deliver karo|deliver kar|ghar tak|deliver karein|home pe|mujhe deliver)\b/.test(s)) return "delivery";
  if (/\b(pickup|pick.?up|takeaway|take.?away|khud le|le jao|store pe|branch se|store se|aa ke lena|aa kar|main aata|main aa|self collect)\b/.test(s)) return "pickup";
  return null;
}

function isYesConfirm(q) {
  const s = q.trim().toLowerCase();
  return /^(yes|y|yep|yeah|yup|confirm|confirmed|ok|okay|haan|ha|han|bilkul|zaroor|theek|correct|right|place it|place the order|go ahead|do it|order kar do|order karo|order de do|lagao|proceed)\b/.test(s) && s.length < 40;
}

function isNoCancel(q) {
  const s = q.trim().toLowerCase();
  return /^(no|nope|nah|cancel|nevermind|never mind|stop|nahi|na|mat|band karo|cancel karo|chhodo|choro|raho rehne do)\b/.test(s) && s.length < 40;
}

function isAddMore(q) {
  const s = q.trim().toLowerCase();
  return /\b(add|more|aur|ek aur|kuch aur|bhi chahiye|also|additionally|plus|extra item|add item|add karo|aur le lena|kuch add)\b/.test(s) && s.length < 60;
}

function isOrderingItem(q) {
  const s = q.trim().toLowerCase();
  const hasOrderVerb = /\b(i want|i('d| would) like|give me|get me|order|add|chahiye|lena|dena|le lena|mujhe|mere liye|add karo|lagao|de do|bhejo|ek|do|teen|1|2|3|4|5)\b/.test(s);
  const hasMenuItem = /\b(pizza|roll|wings|chicken|burger|dessert|drink|pepsi|brownie|garlic|bread|dip|combo|meal|deal|margherita|pepperoni|bar[- ]?b[- ]?q|bbq|tikka|supreme|veggie|mozzarella|zinger|crispy|loaded|domino|medium|large|extra large|xl|small|regular|family)\b/.test(s);
  return hasOrderVerb && hasMenuItem;
}

const DOMINOS_BRANCHES = {
  karachi: ["SMCHS", "Clifton", "Gulshan-e-Iqbal", "Zamzama (DHA 5)", "DHA Phase 6 (Bukhari Commercial)", "DHA Phase 6 (Shahbaz Commercial)", "DHA Phase 8", "Saddar", "North Nazimabad", "Malir Cantt", "Gulistan-e-Johar", "Garden (Nishtar Road)", "MACHS (M.A. Society)", "Commercial Avenue DHA 7"],
  lahore: ["DHA Phase 1", "DHA Phase 5", "DHA Phase 6", "DHA Phase 8", "Gulshan-e-Ravi", "MM Alam (Gulberg III)", "Model Town", "Johar Town", "Bahria Town", "Valencia Town", "Allama Iqbal Town", "Cavalry Ground", "Saddar Cantt", "Mall Road (Mozang)", "Lake City", "Central Park"],
  islamabad: ["F-7 Markaz", "F-10 Markaz", "E-11", "G-11 Markaz", "G-13", "G-15", "DHA Phase 2", "PWD", "Gulberg Greens"],
  rawalpindi: ["Saddar", "Chaklala Scheme 3", "Bahria Town Phase 4", "Bahria Phase 7", "Commercial Market"],
  faisalabad: ["Civil Lines", "Kohinoor City", "Canal Road"],
  multan: ["Gulgasht Colony", "Multan Cantt", "Avenza Avenue"],
  peshawar: ["University Road", "Hayatabad Phase 2"],
  hyderabad: ["Autobahn (Latifabad)", "Qasim Chowk"],
  gujranwala: ["GT Road Mall", "Sixteenth Avenue Mall"],
  sialkot: ["Central Mall (Cantt)", "Shahab Pura Road"],
  bahawalpur: ["5th Avenue Mall"],
  sargodha: ["Club Road"],
  jhelum: ["Jaffar Mall"],
  mardan: ["Sheikh Maltoon Town"],
  "rahim yar khan": ["Ittihad Garden"],
  sahiwal: ["College Road"],
  sheikhupura: ["Al Kareem Avenue"],
  gujrat: ["Mall of Gujrat"],
  "mandi bahauddin": ["Mandi Bahauddin"],
  "wah cantt": ["Wah Cantt"],
  okara: ["Okara"],
  kharian: ["Kharian"],
  chakwal: ["PAF Base"],
};

function extractCity(address) {
  const s = address.toLowerCase();
  // Longest match first to avoid "raw" matching "rawalpindi" before "rahim yar khan"
  const cities = Object.keys(DOMINOS_BRANCHES).sort((a, b) => b.length - a.length);
  return cities.find(c => s.includes(c)) || null;
}

function buildOrderSummary(data, lang = "") {
  const items = (data.items || []);
  const itemLines = items.map(i =>
    `- ${i.name}${i.size ? ` (${i.size})` : ""} x${i.qty || 1} — Rs.${(i.price || 0) * (i.qty || 1)}`
  ).join("\n");
  const total = data.total || items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  const branchLine = data.branch ? (lang === "Roman Urdu" ? `Branch: ${data.branch}` : `Branch: ${data.branch}`) : "";
  const typeLabel = data.type === "delivery"
    ? (lang === "Roman Urdu" ? `Delivery → ${data.address || "address pending"}${branchLine ? `\n${branchLine}` : ""}` : `Delivery → ${data.address || "address pending"}${branchLine ? `\n${branchLine}` : ""}`)
    : data.type === "pickup"
    ? (lang === "Roman Urdu" ? `Pickup${branchLine ? ` — ${data.branch}` : " (store se)"}` : `Pickup${branchLine ? ` — ${data.branch}` : " (from store)"}`)
    : "";

  if (lang === "Roman Urdu") {
    return `*Order Summary:*\n${itemLines}\n${typeLabel ? `\n${typeLabel}` : ""}\n\n*Total: Rs.${total}*\n\nOrder confirm karna hai? Reply karein *YES* ya *NO* 👇`;
  }
  return `*Order Summary:*\n${itemLines}\n${typeLabel ? `\n${typeLabel}` : ""}\n\n*Total: Rs.${total}*\n\nReply *YES* to confirm or *NO* to cancel 👇`;
}

function buildOrderConfirmation(ref, data, lang = "") {
  const total = data.total || 0;
  const branchLine = data.branch ? `\nBranch: ${data.branch}` : "";
  const typeText = data.type === "delivery"
    ? (lang === "Roman Urdu" ? `Delivery: ${data.address}${branchLine}` : `Delivery to: ${data.address}${branchLine}`)
    : (lang === "Roman Urdu" ? `Pickup${branchLine}` : `Pickup from store${branchLine}`);
  if (lang === "Roman Urdu") {
    return `*Order place ho gaya!* 🎉\n\nOrder Ref: *${ref}*\n${typeText}\nTotal: *Rs.${total}*\n\nHumari team jald aap se contact karegi. Shukriya Domino's choose karne ka! 🍕`;
  }
  return `*Order placed!* 🎉\n\nOrder Ref: *${ref}*\n${typeText}\nTotal: *Rs.${total}*\n\nOur team will confirm shortly. Thank you for choosing Domino's! 🍕`;
}

// Uses Gemini to extract ordered items from conversation history.
// Returns [{name, size, price, qty}] or [] if nothing clear.
async function extractOrderItems(history, lang = "") {
  const historyText = history
    .filter(h => h.text && h.text.length > 2)
    .map(h => `${h.role === "user" ? "Customer" : "Bot"}: ${h.text}`)
    .join("\n");

  const extractPrompt = `You are an order extraction system for Domino's Pakistan.

Read the conversation below and extract the food items the customer has decided to order.
For each item, determine: name, size (Small/Medium/Large/Extra Large or null if not specified), price in Rs (from your knowledge of Domino's Pakistan menu), quantity.

Return ONLY valid JSON, no explanation:
{"items": [{"name": "item name", "size": "Large", "price": 1700, "qty": 1}]}

If no clear order was decided, return: {"items": []}

Use these Domino's Pakistan prices (approximate if unsure):
- Regular pizzas Medium ~Rs.1350, Large ~Rs.1800, XL ~Rs.2650
- Super Loaded pizzas Large ~Rs.2000, XL ~Rs.2900
- Pizza Rolls ~Rs.450-550 each
- Chicken Wings 6pc ~Rs.450
- Pepsi/drinks ~Rs.200
- Dips ~Rs.200

Conversation:
${historyText}`;

  const { text, usage } = await generateWithUsage(extractPrompt, "Extract the order as JSON.", []);
  // Parse JSON from response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  return (parsed.items || []).filter(i => i.name && i.price > 0);
}

// ─── End QSR Order Flow ────────────────────────────────────────────────────────

// Detects genuine purchase/quote interest — not casual curiosity.
function isInterested(q) {
  const s = q.trim().toLowerCase();
  return (
    /\b(interested|want to (buy|order|purchase|place an order|get a quote)|send (me|us) (details|pricing|catalogue|brochure|price list|specs)|i('d| would) like to (order|buy|know the price|get pricing|get a quote)|looking to (buy|order|source|procure)|need (pricing|a quote|details|specs)|can you send|please send|email me|send it (to|on) my email|share (the|your) (catalogue|brochure|price|pricing|details))\b/.test(s)
  );
}

// Extracts email address from a message. Returns null if none found.
function extractEmail(q) {
  const match = q.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

// Label API failures for CRM logging.
function apiReason(e) {
  if (e?.apiStatus === 429) return "api_429";
  if (e?.apiStatus >= 500) return "api_5xx";
  return "api_error";
}

// Objection / pushback / pricing detector. These are conversational turns where
// we want a confident rebuttal, not a "forward to team" dead-end.
// Generic — not anchored to any specific product name so it works for any bot.
function isObjection(q) {
  const s = q.trim().toLowerCase();
  return (
    // Clear pricing objections
    /\b(too expensive|costs? too much|out of budget|can'?t afford|not worth the (price|cost|money))\b/.test(s) ||
    // Pricing questions anchored to product/service context words
    /\b(pricing|price|how much|what'?s the cost)\b.*\b(product|plan|package|subscription|service|solution|system|software|tool)\b/.test(s) ||
    /\b(product|plan|package|subscription|service|solution|system|software|tool)\b.*\b(pricing|price|how much|cost)\b/.test(s) ||
    // Direct product pushback
    /\b(won'?t work|doesn'?t work|not convinced|not worth|waste of (time|money))\b.*\b(this|it|your)\b/.test(s) ||
    /\b(already (have|use|using)|we use|we have)\b.*\b(qa|quality|tool|system|solution|software|service)\b/.test(s) ||
    // Why should we / what makes you different
    /\b(why (should|would) (i|we)|what makes (you|your|this)|how (are you|is (this|it)) different|better than (you|yours|this))\b/.test(s)
  );
}

// Pick a random item — adds natural variation so the bot doesn't say the
// exact same sentence every time (which is what makes bots feel robotic).
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Friendly first-name only, for a personal touch.
function firstName(name) {
  if (!name) return "";
  return String(name).trim().split(/\s+/)[0];
}

export function greetingMessage(name = "") {
  const fn = firstName(name);
  const bot = CONFIG.botName;
  if (fn) {
    const lines = [
      `Hi ${fn}! 👋 I'm ${bot}. What can I help you with today? 😊`,
      `Hi ${fn}! Lovely to hear from you — I'm ${bot}. How can I help?`,
      `Hi ${fn}! I'm ${bot}. Happy to help — what's on your mind?`,
    ];
    return pick(lines);
  }
  const lines = [
    `Hi! 👋 I'm ${bot} — who do I have the pleasure of chatting with? 😊`,
    `Hi! I'm ${bot}. Happy to help — what's your name?`,
    `Hi! 👋 ${bot} here. What's your name, and what can I help you with today?`,
  ];
  return pick(lines);
}

export function forwardMessage(name = "", lang = "") {
  const fn = firstName(name);
  // Roman Urdu variant — apologise and redirect in same language
  if (lang === "Roman Urdu") {
    const open = fn ? `${fn},` : "";
    const lines = [
      `${open} Maafi chahta hoon, yeh mere knowledge mein nahi hai. Koi aur cheez mein madad kar sakta hoon? 😊`.trim(),
      `${open} Sorry, is topic par mujhe koi information nahi. Kuch aur poochhna chahein? 😊`.trim(),
      `${open} Yeh meri field se bahar hai, is liye main jawab dene se qasir hoon. Koi aur sawal ho toh zaroor poochein! 😊`.trim(),
    ];
    return pick(lines);
  }
  // Use the bot-specific out-of-scope reply from config if set (English only)
  if (CONFIG.outOfScopeReply) return CONFIG.outOfScopeReply;
  const open = fn ? `Hey ${fn},` : "Hey,";
  const lines = [
    `${open} sorry, that's outside what I can help with. Is there anything else I can do for you? 😊`,
    `${open} apologies — I don't have information on that one. Anything else I can help with?`,
    `${open} sorry, that's not something I have details on. Feel free to ask me anything else! 😊`,
  ];
  return pick(lines);
}

// Used when we deliberately skip the AI call (daily cap, per-user limit, or an
// API failure like a 429). Reassuring, never reveals the technical reason, and
// avoids dead silence — the customer always gets a human-sounding reply.
export function busyMessage(name = "") {
  const fn = firstName(name);
  const open = fn ? `Thanks, ${fn}!` : "Thanks for your patience!";
  const lines = [
    `${open} Let me check on that properly and get right back to you. 😊`,
    `${open} I want to give you an accurate answer on this — let me confirm with the team and come back to you shortly.`,
    `${open} Give me a little bit on that one and I'll follow up with the right details soon. 🙌`,
  ];
  return pick(lines);
}
