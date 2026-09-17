'use client';
import { useState, useEffect } from 'react';
import { getBot, updateBot, restartBot } from '../lib/api';

const TONES = ['professional', 'friendly', 'casual', 'formal'];

const INDUSTRIES = [
  { id: 'qsr',        icon: '🍽️', label: 'Restaurant / QSR' },
  { id: 'ecommerce',  icon: '🛒', label: 'E-commerce' },
  { id: 'retail',     icon: '🏪', label: 'Retail / Shop' },
  { id: 'automotive', icon: '🚗', label: 'Automotive' },
  { id: 'telecom',    icon: '📡', label: 'Telecom' },
  { id: 'realestate', icon: '🏠', label: 'Real Estate' },
  { id: 'healthcare', icon: '🏥', label: 'Healthcare' },
  { id: 'education',  icon: '🎓', label: 'Education' },
  { id: 'banking',    icon: '🏦', label: 'Banking / Finance' },
  { id: 'custom',     icon: '✏️', label: 'Custom / Other' },
];

const FEATURE_TIERS = [
  { id: 'text',             icon: '💬', label: 'Text only',             desc: 'Text replies only' },
  { id: 'text_image',       icon: '🖼️', label: 'Text + Image',          desc: 'Text and images from KB' },
  { id: 'text_image_voice', icon: '🎙️', label: 'Text + Image + Voice',  desc: 'Full media — includes voice notes' },
];

const PERSONALITY_EXAMPLES = [
  {
    label: 'Sales (default)',
    value: '',
  },
  {
    label: 'Luxury / Premium',
    value: `- Speak with understated confidence. Never be pushy — let the quality speak.
- Use refined, polished language. Avoid slang.
- Address customers as valued guests, not leads.
- Example: "We'd be delighted to arrange a private consultation at your convenience."`,
  },
  {
    label: 'Tech / SaaS',
    value: `- Be crisp, direct, and knowledgeable. Skip the fluff.
- Lead with value metrics (time saved, ROI, efficiency).
- Speak their language: integrations, APIs, workflows, scalability.
- Example: "It hooks into your existing stack in under an hour — no dev work needed."`,
  },
  {
    label: 'Real Estate',
    value: `- Warm and trustworthy — buying/selling is emotional, not just transactional.
- Ask about timeline, budget range, and must-haves early.
- Paint pictures: neighborhood, lifestyle, investment potential.
- Example: "This one ticks a lot of boxes — when would be a good time to walk through it?"`,
  },
  {
    label: 'E-commerce / Retail',
    value: `- Upbeat, helpful, and fast. Customers want answers, not conversation.
- Lead with product benefits, availability, and delivery times.
- Proactively upsell related items when relevant.
- Example: "That's back in stock! Want me to check if the bundle deal is still running?"`,
  },
  {
    label: 'Healthcare / Clinic',
    value: `- Calm, empathetic, and clear. Never alarming.
- Keep medical language simple. Patients don't want jargon.
- Always recommend speaking to a doctor for specific advice.
- Example: "That's a great question — our team can walk you through the options at your next visit."`,
  },
];

export default function BotPersonalityPanel({ botId }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showExamples, setShowExamples] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    getBot(botId).then(data => {
      // Normalise: if legacy config has `language` string, convert to array
      if (data && !Array.isArray(data.languages)) {
        data.languages = data.language ? [data.language] : ['English'];
      }
      setForm(data);
    });
  }, [botId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function applyExample(example) {
    set('personalityPrompt', example.value);
    setShowExamples(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const payload = { ...form, language: (form.languages || ['English'])[0] };
    const r = await updateBot(botId, payload);
    setSaving(false);
    setMsg(r.ok ? 'Saved. Click "Save & Restart" to apply changes live.' : r.error || 'Save failed.');
  }

  async function handleSaveAndRestart(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const payload = { ...form, language: (form.languages || ['English'])[0] };
    const saveResult = await updateBot(botId, payload);
    if (!saveResult.ok) {
      setSaving(false);
      setMsg(saveResult.error || 'Save failed.');
      return;
    }
    setSaving(false);
    setRestarting(true);
    setMsg('Saved — restarting bot…');
    const restartResult = await restartBot(botId);
    setRestarting(false);
    setMsg(restartResult.ok ? '✓ Bot restarted — all changes are now live.' : `Saved but restart failed: ${restartResult.error || 'unknown error'}`);
  }

  if (!form) return <div className="text-slate-400">Loading...</div>;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Personality & Settings</h2>
      <form onSubmit={handleSave} className="space-y-6 max-w-2xl">

        {/* Bot Identity */}
        <Section title="🤖 Bot Identity">
          <Field label="Bot Name" value={form.botName} onChange={v => set('botName', v)} placeholder="e.g. Support Bot" />
          <Field label="Phone Label (for your reference)" value={form.phoneLabel} onChange={v => set('phoneLabel', v)} placeholder="e.g. +92 300 1234567" />

          {/* Bot Mode */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">Bot Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'inbound', icon: '📥', label: 'Inbound', desc: 'Replies to incoming messages only' },
                { id: 'outbound', icon: '📤', label: 'Outbound', desc: 'Sends campaigns only — no auto-replies' },
                { id: 'both', icon: '↔️', label: 'Both', desc: 'Sends campaigns + replies to messages' },
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => set('mode', m.id)}
                  className={`rounded-xl p-3 text-left border transition ${
                    (form.mode || 'inbound') === m.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  }`}
                >
                  <div className="text-lg mb-1">{m.icon}</div>
                  <div className="text-sm font-semibold text-white">{m.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-tight">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Industry */}
        <Section title="🏭 Industry Template">
          <p className="text-xs text-slate-500 -mt-1">
            Changing industry re-applies the conversation mode (ordering flow, lead qualify, compliance rules, etc.).
            Greeting and out-of-scope reply below are not auto-updated — edit those manually if needed.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {INDUSTRIES.map(ind => (
              <button
                key={ind.id}
                type="button"
                onClick={() => set('industry', ind.id)}
                className={`rounded-xl p-3 text-left border transition ${
                  (form.industry || 'custom') === ind.id
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="text-lg mb-1">{ind.icon}</div>
                <div className="text-xs font-semibold text-white leading-tight">{ind.label}</div>
              </button>
            ))}
          </div>
        </Section>

        {/* Capabilities */}
        <Section title="⚡ Bot Capabilities">
          <p className="text-xs text-slate-500 -mt-1">
            Controls what media types the bot sends alongside text replies.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {FEATURE_TIERS.map(tier => (
              <button
                key={tier.id}
                type="button"
                onClick={() => set('features', tier.id)}
                className={`rounded-xl p-4 text-left border transition ${
                  (form.features || 'text') === tier.id
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="text-2xl mb-2">{tier.icon}</div>
                <div className="text-sm font-semibold text-white">{tier.label}</div>
                <div className="text-xs text-slate-400 mt-1 leading-snug">{tier.desc}</div>
              </button>
            ))}
          </div>
        </Section>

        {/* Language & Tone */}
        <Section title="🌍 Language & Tone">
          <div className="flex items-start gap-4 bg-slate-800 rounded-lg px-4 py-3">
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-1.5 bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-semibold px-3 py-1 rounded-full">
                ✦ Automatic
              </span>
            </div>
            <p className="text-slate-400 text-sm">
              Language is fully automatic. The bot detects what language the user writes in — English, Urdu, Arabic, French, Spanish, or any other — and replies in that same language using Gemini. No configuration needed.
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Tone</label>
            <select
              value={form.tone || 'professional'}
              onChange={e => set('tone', e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
            >
              {TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
        </Section>

        {/* Personality Prompt */}
        <Section title="🎭 Personality Prompt">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-slate-400">
                Custom personality instructions for the bot (optional — adds to the default behaviour)
              </label>
              <button
                type="button"
                onClick={() => setShowExamples(v => !v)}
                className="text-xs text-green-400 hover:text-green-300 transition shrink-0 ml-4"
              >
                {showExamples ? 'Hide examples' : 'Load example ↓'}
              </button>
            </div>

            {/* Example templates */}
            {showExamples && (
              <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 mb-3 space-y-1">
                {PERSONALITY_EXAMPLES.map(ex => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => applyExample(ex)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition"
                  >
                    {ex.label}
                    {ex.value === '' && <span className="ml-2 text-slate-500 text-xs">(clear / use default)</span>}
                  </button>
                ))}
              </div>
            )}

            <textarea
              rows={6}
              value={form.personalityPrompt || ''}
              onChange={e => set('personalityPrompt', e.target.value)}
              placeholder={`Describe how your bot should behave. Examples:\n\n- Speak like a knowledgeable real estate agent. Focus on neighborhood lifestyle and investment value.\n- Always ask for the client's budget range early in the conversation.\n- Never discuss competitors. Politely redirect to our offerings.`}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-green-500 resize-none font-mono placeholder-slate-600"
            />
            <p className="text-slate-600 text-xs mt-1">These notes are injected directly into the AI prompt. Be specific — the more precise, the better the behaviour.</p>
          </div>
        </Section>

        {/* Conversation */}
        <Section title="💬 Conversation">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Greeting Message</label>
            <textarea
              rows={3}
              value={form.greeting || ''}
              onChange={e => set('greeting', e.target.value)}
              placeholder="Hi! I'm your assistant. How can I help you today?"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Out-of-Scope Reply</label>
            <textarea
              rows={2}
              value={form.outOfScopeReply || ''}
              onChange={e => set('outOfScopeReply', e.target.value)}
              placeholder="That's outside what I can help with. Would you like to speak to our team?"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500 resize-none"
            />
          </div>
          <Field label="Calendly / Booking Link (optional)" value={form.calendlyLink} onChange={v => set('calendlyLink', v)} placeholder="https://calendly.com/your-link" />
        </Section>

        {/* Admin & Limits */}
        <Section title="⚙️ Admin & Limits">
          <Field label="Admin WhatsApp Number (E.164 without +)" value={form.adminNumber} onChange={v => set('adminNumber', v)} placeholder="447788847047" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Daily Cost Cap (USD)</label>
              <input
                type="number" step="0.1" min="0.1"
                value={form.dailyCostCapUsd || 1}
                onChange={e => set('dailyCostCapUsd', parseFloat(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Messages / User / Hour</label>
              <input
                type="number" min="1"
                value={form.perUserHourlyLimit || 15}
                onChange={e => set('perUserHourlyLimit', parseInt(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
              />
            </div>
          </div>
        </Section>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="submit"
            disabled={saving || restarting}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
          >
            {saving ? 'Saving…' : 'Save Only'}
          </button>
          <button
            type="button"
            disabled={saving || restarting}
            onClick={handleSaveAndRestart}
            className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition flex items-center gap-2"
          >
            {restarting ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Restarting…
              </>
            ) : (
              '↻ Save & Restart'
            )}
          </button>
          <p className="text-xs text-slate-500">"Save & Restart" applies all changes to the live bot instantly.</p>
        </div>
        {msg && (
          <p className={`text-sm font-medium ${
            msg.includes('✓') ? 'text-green-400' :
            msg.includes('failed') || msg.includes('Failed') ? 'text-red-400' :
            'text-yellow-400'
          }`}>
            {msg}
          </p>
        )}
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
      />
    </div>
  );
}
