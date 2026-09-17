'use client';
import { useState, useEffect } from 'react';
import { getBot, updateBot } from '../lib/api';
import { getToken } from '../lib/auth';

// ─── Integration card definitions ───────────────────────────────────────────
// status: 'active' | 'coming_soon'
const INTEGRATION_DEFS = [
  {
    id: 'n8n',
    icon: '⚡',
    label: 'N8N / Zapier / Make Webhook',
    description: 'Fire a webhook when a lead shares their email. Works with N8N, Zapier, Make, or any system that accepts POST requests.',
    status: 'active',
  },
  {
    id: 'telegram_alerts',
    icon: '🔔',
    label: 'Telegram Alerts',
    description: 'Get a Telegram message every time a new lead is captured.',
    status: 'active',
  },
  {
    id: 'google_sheets',
    icon: '📊',
    label: 'Google Sheets',
    description: 'Automatically log every captured lead to a Google Sheet row.',
    status: 'coming_soon',
  },
  {
    id: 'shopify',
    icon: '🛍️',
    label: 'Shopify',
    description: 'Let the bot look up real-time product stock and order status from your Shopify store.',
    status: 'coming_soon',
  },
  {
    id: 'woocommerce',
    icon: '🛒',
    label: 'WooCommerce',
    description: 'Connect your WordPress/WooCommerce store for product and order queries.',
    status: 'coming_soon',
  },
  {
    id: 'pos',
    icon: '🖥️',
    label: 'POS / ERP Webhook',
    description: 'Trigger your POS or ERP system via webhook on specific bot events.',
    status: 'coming_soon',
  },
];

export default function IntegrationsPanel({ botId }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [openCard, setOpenCard] = useState('n8n'); // which card is expanded

  useEffect(() => { getBot(botId).then(setForm); }, [botId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    setTestResult(null);
    const r = await updateBot(botId, form);
    setSaving(false);
    setMsg(r.ok ? '✓ Saved. Restart the bot to apply.' : 'Save failed.');
  }

  async function handleTestWebhook() {
    const url = form?.n8nLeadWebhookUrl;
    if (!url) { setTestResult({ ok: false, msg: 'No webhook URL set.' }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch('/api/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-portal-token': getToken() || '' },
        body: JSON.stringify({ url, botId }),
      });
      const data = await r.json();
      setTestResult({ ok: r.ok, msg: r.ok ? `Fired. Response status: ${data.status ?? 'ok'}` : (data.error || 'Test failed.') });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  }

  if (!form) return <div className="text-slate-400">Loading...</div>;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Integrations</h2>
      <p className="text-slate-500 text-sm mb-6">Connect your bot to external tools and platforms.</p>

      <form onSubmit={handleSave} className="space-y-3 max-w-2xl">

        {INTEGRATION_DEFS.map(def => (
          <IntegrationCard
            key={def.id}
            def={def}
            isOpen={openCard === def.id}
            onToggle={() => setOpenCard(openCard === def.id ? null : def.id)}
          >
            {/* ── N8N Webhook card body ── */}
            {def.id === 'n8n' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Webhook URL</label>
                  <input
                    type="url"
                    value={form.n8nLeadWebhookUrl || ''}
                    onChange={e => set('n8nLeadWebhookUrl', e.target.value)}
                    placeholder="https://your-n8n.com/webhook/..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div className="bg-slate-800 rounded-lg px-4 py-3 text-xs text-slate-400 font-mono">
                  <p className="text-slate-500 mb-1">Payload sent on lead capture:</p>
                  {`{ wa_id, name, email, interest, bot, ts }`}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestWebhook}
                    disabled={testing || !form.n8nLeadWebhookUrl}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
                  >
                    {testing ? 'Sending...' : 'Test Webhook'}
                  </button>
                  {testResult && (
                    <span className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                      {testResult.msg}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Telegram alerts card body ── */}
            {def.id === 'telegram_alerts' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Telegram Chat ID or Bot Username</label>
                  <input
                    type="text"
                    value={form.telegramAlertNumber || ''}
                    onChange={e => set('telegramAlertNumber', e.target.value)}
                    placeholder="@yourbotname or numeric chat ID"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <p className="text-xs text-slate-500">You'll receive a Telegram alert each time a lead's email is captured.</p>
              </div>
            )}
          </IntegrationCard>
        ))}

        {/* Cost & Rate Limits — separate section, not an integration card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mt-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">💰 Cost & Rate Limits</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Daily Cost Cap (USD)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={form.dailyCostCapUsd || 1}
                onChange={e => set('dailyCostCapUsd', parseFloat(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Messages / User / Hour</label>
              <input
                type="number"
                min="1"
                value={form.perUserHourlyLimit || 15}
                onChange={e => set('perUserHourlyLimit', parseInt(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {msg && (
            <span className={`ml-4 text-sm ${msg.startsWith('✓') ? 'text-yellow-400' : 'text-red-400'}`}>
              {msg}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Reusable integration card shell ────────────────────────────────────────
function IntegrationCard({ def, isOpen, onToggle, children }) {
  const isComingSoon = def.status === 'coming_soon';

  return (
    <div className={`bg-slate-900 border rounded-xl transition ${isComingSoon ? 'border-slate-800 opacity-60' : 'border-slate-800 hover:border-slate-700'}`}>
      <button
        type="button"
        onClick={isComingSoon ? undefined : onToggle}
        className={`w-full flex items-center justify-between px-5 py-4 text-left ${isComingSoon ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{def.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{def.label}</span>
              {isComingSoon && (
                <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Coming Soon</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{def.description}</p>
          </div>
        </div>
        {!isComingSoon && (
          <span className="text-slate-500 text-sm ml-4 flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
        )}
      </button>

      {/* Expandable body */}
      {!isComingSoon && isOpen && (
        <div className="px-5 pb-5 border-t border-slate-800 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
