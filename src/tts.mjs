// Text-to-Speech — two-tier approach:
// 1. Google Cloud TTS (high quality, requires API enabled in project)
// 2. Google Translate TTS fallback (free, no setup, slightly lower quality)
// Returns an OGG/Opus Buffer suitable for sending as a WhatsApp PTT voice note, or null on failure.
import { google } from 'googleapis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

// Reasonable cap — WhatsApp voice notes should be concise.
const MAX_CHARS = 500;

// Map our language strings to BCP-47 codes for Google TTS.
const LANG_CODE = {
  'English':     'en-US',
  'Roman Urdu':  'ur-PK',
  'Urdu':        'ur-PK',
  'Arabic':      'ar-XA',
  'French':      'fr-FR',
  'Spanish':     'es-ES',
  'German':      'de-DE',
  'Hindi':       'hi-IN',
};

// Voices per language — prefer Journey (natural) → Wavenet → Standard.
const VOICE_MAP = {
  'en-US': { name: 'en-US-Journey-F', ssmlGender: 'FEMALE' },
  'ur-PK': { name: 'ur-PK-Standard-A', ssmlGender: 'FEMALE' },
  'ar-XA': { name: 'ar-XA-Wavenet-A', ssmlGender: 'FEMALE' },
  'fr-FR': { name: 'fr-FR-Wavenet-C', ssmlGender: 'FEMALE' },
  'es-ES': { name: 'es-ES-Wavenet-C', ssmlGender: 'FEMALE' },
  'de-DE': { name: 'de-DE-Wavenet-C', ssmlGender: 'FEMALE' },
  'hi-IN': { name: 'hi-IN-Wavenet-A', ssmlGender: 'FEMALE' },
};

let _authClient = null;
async function getAccessToken() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  try {
    if (!_authClient) {
      const { google: g } = await import('googleapis');
      _authClient = new g.auth.GoogleAuth({
        keyFile: path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS),
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    }
    return await _authClient.getAccessToken();
  } catch { return null; }
}

/**
 * Convert text to a WhatsApp-ready OGG/Opus Buffer.
 * @param {string} text   - The text to speak (will be truncated if too long).
 * @param {string} [lang] - Language string from CONFIG, e.g. 'English', 'Roman Urdu'.
 * @returns {Buffer|null}  null when TTS is unavailable or fails.
 */
export async function textToVoice(text, lang = 'English') {
  // Strip markdown-like formatting and trim to max length.
  const clean = text
    .replace(/\*([^*]+)\*/g, '$1')   // *bold* → plain
    .replace(/[_~`]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);

  if (!clean) return null;

  const langCode = LANG_CODE[lang] || 'en-US';

  // Tier 1: Google Cloud TTS (high quality, needs API enabled)
  const token = await getAccessToken();
  if (token) {
    const voice = VOICE_MAP[langCode] || { name: `${langCode}-Standard-A`, ssmlGender: 'FEMALE' };
    try {
      const resp = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: clean },
          voice: { languageCode: langCode, name: voice.name, ssmlGender: voice.ssmlGender },
          audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: 1.05 },
        }),
      });
      if (resp.ok) {
        const { audioContent } = await resp.json();
        return Buffer.from(audioContent, 'base64');
      }
      const err = await resp.text();
      // API not enabled — fall through to Tier 2 (don't retry Cloud TTS)
      if (err.includes('not enabled') || err.includes('403')) _authClient = null;
    } catch {}
  }

  // Tier 2: Google Translate TTS (free, no API key, uses ffmpeg to convert mp3→ogg/opus)
  return googleTranslateTTS(clean, langCode);
}

// Map BCP-47 to Google Translate language codes.
const GT_LANG = {
  'en-US': 'en', 'en-GB': 'en',
  'ur-PK': 'ur',
  'ar-XA': 'ar',
  'fr-FR': 'fr',
  'es-ES': 'es',
  'de-DE': 'de',
  'hi-IN': 'hi',
};

// Splits text into ≤200-char chunks on sentence/word boundaries.
function chunkText(text, max = 200) {
  if (text.length <= max) return [text];
  const chunks = [];
  while (text.length > max) {
    let cut = text.lastIndexOf(' ', max);
    if (cut < 50) cut = max;
    chunks.push(text.slice(0, cut).trim());
    text = text.slice(cut).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

async function googleTranslateTTS(text, langCode) {
  const tl = GT_LANG[langCode] || 'en';
  const chunks = chunkText(text);
  const mp3Buffers = [];

  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhatsApp/1.0)' },
      });
      if (!resp.ok) throw new Error(`GT TTS ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      mp3Buffers.push(buf);
    } catch (e) {
      console.warn('[tts] GT TTS chunk failed:', e.message);
    }
  }

  if (!mp3Buffers.length) return null;
  const mp3 = Buffer.concat(mp3Buffers);

  // Convert mp3 → ogg/opus using ffmpeg (required for WhatsApp PTT waveform display)
  const id = crypto.randomBytes(6).toString('hex');
  const mp3Path = path.join(os.tmpdir(), `tts-${id}.mp3`);
  const oggPath = path.join(os.tmpdir(), `tts-${id}.ogg`);
  try {
    await writeFile(mp3Path, mp3);
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', oggPath], (err) => {
        if (err) reject(err); else resolve();
      });
    });
    const ogg = await readFile(oggPath);
    return ogg;
  } catch (e) {
    console.warn('[tts] ffmpeg conversion failed:', e.message);
    return null;
  } finally {
    unlink(mp3Path).catch(() => {});
    unlink(oggPath).catch(() => {});
  }
}
