// Gemini API helpers: embeddings + generation. Supports AI Studio and Vertex AI.
import { GEMINI_API_KEY, GEMINI_BASE, CONFIG, USE_VERTEX, VERTEX_PROJECT, VERTEX_LOCATION } from "./config.mjs";
import { GoogleAuth } from "google-auth-library";

// Vertex AI auth (lazy-init, only when USE_VERTEX is true)
let _auth = null;
function getAuth() {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return _auth;
}

async function getAccessToken() {
  const client = await getAuth().getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function call(url, body, tries = 3, useBearer = false) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (useBearer) {
        headers["Authorization"] = `Bearer ${await getAccessToken()}`;
      }
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) {
        await new Promise((res) => setTimeout(res, 800 * (i + 1)));
        lastErr = new Error("HTTP " + r.status);
        lastErr.apiStatus = r.status;
        continue;
      }
      const json = await r.json();
      if (!r.ok) {
        const e = new Error(json?.error?.message || "HTTP " + r.status);
        e.apiStatus = r.status;
        throw e;
      }
      return json;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

// Build correct URL for either AI Studio or Vertex AI
function embedUrl() {
  if (USE_VERTEX) {
    return `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${CONFIG.embedModel}:predict`;
  }
  return `${GEMINI_BASE}/models/${CONFIG.embedModel}:embedContent?key=${GEMINI_API_KEY}`;
}

function genUrl() {
  if (USE_VERTEX) {
    return `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${CONFIG.genModel}:generateContent`;
  }
  return `${GEMINI_BASE}/models/${CONFIG.genModel}:generateContent?key=${GEMINI_API_KEY}`;
}

// Build embed request body (Vertex AI uses different shape for embeddings)
function embedBody(text, taskType) {
  if (USE_VERTEX) {
    return {
      instances: [{ content: text, task_type: taskType }],
      parameters: { outputDimensionality: CONFIG.embedDim },
    };
  }
  return {
    model: `models/${CONFIG.embedModel}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: CONFIG.embedDim,
  };
}

// Extract embedding values from response (different shape for Vertex AI)
function extractEmbedValues(json) {
  if (USE_VERTEX) {
    return json?.predictions?.[0]?.embeddings?.values || [];
  }
  return json.embedding.values;
}

// Pull token usage out of a Gemini response (shape: usageMetadata).
export function extractUsage(json) {
  const u = json?.usageMetadata || {};
  return {
    in: u.promptTokenCount || 0,
    out: u.candidatesTokenCount || 0,
    total: u.totalTokenCount || 0,
  };
}

// Embed a single text. Returns Float32-ish number[].
export async function embed(text, taskType = "RETRIEVAL_DOCUMENT") {
  const json = await call(embedUrl(), embedBody(text, taskType), 3, USE_VERTEX);
  return extractEmbedValues(json);
}

// Like embed() but also returns token usage for cost tracking.
export async function embedWithUsage(text, taskType = "RETRIEVAL_DOCUMENT") {
  const json = await call(embedUrl(), embedBody(text, taskType), 3, USE_VERTEX);
  return { values: extractEmbedValues(json), usage: extractUsage(json) };
}

// Embed many texts sequentially (pilot volume is low; keeps it simple + rate-safe).
export async function embedBatch(texts, taskType = "RETRIEVAL_DOCUMENT") {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(await embed(texts[i], taskType));
    if ((i + 1) % 10 === 0) process.stdout.write(`  embedded ${i + 1}/${texts.length}\r`);
  }
  if (texts.length >= 10) process.stdout.write("\n");
  return out;
}

// history = [{role: 'user'|'model', text: string}] — previous turns, oldest first
function genBody(systemPrompt, userPrompt, history = []) {
  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: userPrompt }] },
  ];
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0,  // 0 = deterministic, no fabrication from low-relevance context
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

function genText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

// Generate an answer from a prompt. Returns string.
export async function generate(systemPrompt, userPrompt, history = []) {
  const json = await call(genUrl(), genBody(systemPrompt, userPrompt, history), 3, USE_VERTEX);
  return genText(json);
}

// Like generate() but also returns token usage for cost tracking.
export async function generateWithUsage(systemPrompt, userPrompt, history = []) {
  const json = await call(genUrl(), genBody(systemPrompt, userPrompt, history), 3, USE_VERTEX);
  return { text: genText(json), usage: extractUsage(json) };
}

// Analyse an image sent by a user — OCR + visual understanding.
// Combines the image with the user's caption/question and the bot's KB context.
// Returns { reply: string, usage } — reply is the bot's final answer, empty string on failure.
//
// mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
// caption: the user's question/caption accompanying the image (may be empty)
// systemPrompt: the bot's system prompt (same one used for text answers)
// kbContext: relevant KB chunks already retrieved for this query (may be empty string)
export async function analyzeImage(buffer, { mimeType = 'image/jpeg', caption = '', systemPrompt = '', kbContext = '' } = {}) {
  const base64 = buffer.toString('base64');
  const questionPart = caption.trim()
    ? `The customer sent this image with the message: "${caption.trim()}". Please answer their question.`
    : `The customer sent this image. Describe what it shows and answer any implied question based on your knowledge base.`;

  const contextBlock = kbContext
    ? `\n\nKNOWLEDGE BASE CONTEXT (use if relevant to the image query):\n${kbContext}`
    : '';

  const body = {
    systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: `${questionPart}${contextBlock}\n\nRules: Stay factual. If the image contains text (OCR), read it accurately. If the image shows a product, article, or screenshot, reference what you actually see. Keep your reply concise — 1–3 short sentences unless more detail is needed. Do NOT fabricate information not visible in the image or present in the knowledge base.` },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
  };
  try {
    const json = await call(genUrl(), body, 2, USE_VERTEX);
    const text = genText(json).trim();
    return { reply: text, usage: extractUsage(json) };
  } catch (e) {
    return { reply: '', usage: { in: 0, out: 0, total: 0 } };
  }
}

// Transcribe a voice/audio message buffer using Gemini's native audio understanding.
// buffer: Buffer of raw audio bytes (ogg/opus from WhatsApp voice notes)
// Returns { text: string, usage } — text is the transcription, empty string on failure.
export async function transcribeAudio(buffer) {
  const base64 = buffer.toString("base64");
  // WhatsApp voice notes are always ogg/opus
  const body = {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "audio/ogg", data: base64 } },
        { text: "Transcribe this voice message exactly as spoken. Output only the transcription — no labels, no explanations, no punctuation changes. If you cannot understand it, output exactly: [unclear]" },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
  };
  try {
    const json = await call(genUrl(), body, 2, USE_VERTEX);
    const text = genText(json).trim();
    return { text: text === "[unclear]" ? "" : text, usage: extractUsage(json) };
  } catch {
    return { text: "", usage: { in: 0, out: 0, total: 0 } };
  }
}
