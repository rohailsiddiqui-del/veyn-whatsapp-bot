'use client';
import { useState, useEffect } from 'react';
import { getConfig, saveConfig } from '../lib/api';

export default function PersonalityPanel() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { getConfig().then(setForm); }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const r = await saveConfig(form);
    setSaving(false);
    setMsg(r.ok ? 'Saved. Restart the bot to apply changes.' : 'Save failed.');
  }

  if (!form) return <div className="text-slate-400">Loading...</div>;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Personality Settings</h2>
      <form onSubmit={handleSave} className="space-y-5 max-w-2xl">
        <Field label="Bot Name" value={form.botName} onChange={v => set('botName', v)} placeholder="e.g. Veyn Assistant" />
        <Field label="Greeting Message" value={form.greeting} onChange={v => set('greeting', v)} placeholder="Hi! How can I help you today?" />
        <div>
          <label className="block text-sm text-slate-400 mb-1">Tone</label>
          <select
            value={form.tone}
            onChange={e => set('tone', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="formal">Formal</option>
          </select>
        </div>
        <Field label="Language" value={form.language} onChange={v => set('language', v)} placeholder="English" />
        <Field label="Out-of-Scope Reply" value={form.outOfScopeReply} onChange={v => set('outOfScopeReply', v)} placeholder="That's outside what I can help with..." textarea />
        <Field label="Calendly / Booking Link" value={form.calendlyLink} onChange={v => set('calendlyLink', v)} placeholder="https://calendly.com/..." />
        <Field label="Admin WhatsApp Number" value={form.adminNumber} onChange={v => set('adminNumber', v)} placeholder="+447788847047" />

        <div className="pt-2">
          <button type="submit" disabled={saving} className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
        {msg && <p className={`text-sm ${msg.includes('Restart') ? 'text-yellow-400' : 'text-red-400'}`}>{msg}</p>}
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      {textarea ? (
        <textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
        />
      )}
    </div>
  );
}
