'use client';
import { useState, useEffect, useRef } from 'react';
import { getToken } from '../lib/auth';

const API = (path) => path;

async function apiFetch(path, opts = {}) {
  const res = await fetch(API(path), {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-portal-token': getToken() || '', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...data };
}

export default function CampaignsPanel({ botId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null); // campaign id being viewed
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadCampaigns(); }, [botId]);

  async function loadCampaigns() {
    setLoading(true);
    const r = await apiFetch(`/api/bots/${botId}/campaigns`);
    setCampaigns(r.campaigns || []);
    setLoading(false);
  }

  if (selected) {
    const camp = campaigns.find(c => c.id === selected);
    return (
      <CampaignDetail
        botId={botId}
        campaign={camp}
        onBack={() => { setSelected(null); loadCampaigns(); }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Campaigns</h2>
          <p className="text-slate-500 text-sm mt-1">Send outbound messages — text, images, or follow-ups — to a list of contacts.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-green-500 hover:bg-green-400 text-white font-semibold px-4 py-2 rounded-lg transition text-sm"
        >
          + New Campaign
        </button>
      </div>

      {creating && (
        <CreateCampaignForm
          botId={botId}
          onCreated={(id) => { setCreating(false); loadCampaigns(); setSelected(id); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <div className="text-slate-400">Loading...</div>
      ) : campaigns.length === 0 && !creating ? (
        <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl">
          <div className="text-4xl mb-3">📤</div>
          <p className="text-slate-400">No campaigns yet</p>
          <p className="text-slate-600 text-sm mt-1">Create your first campaign to start sending outbound messages</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div
              key={c.id}
              onClick={() => setSelected(c.id)}
              className="bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl p-5 cursor-pointer transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-white">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-slate-500 text-sm line-clamp-1">{c.message}</p>
                </div>
                <div className="text-right text-xs text-slate-500 shrink-0 ml-4">
                  <div>{c.totalContacts || 0} contacts</div>
                  <div className="text-green-400">{c.sentCount || 0} sent</div>
                  <div className="text-slate-600 mt-1">{new Date(c.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create campaign form ──────────────────────────────
function CreateCampaignForm({ botId, onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('text'); // 'text' | 'image'
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  function handleImagePick(e) {
    const f = e.target.files[0];
    if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(f);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Campaign name is required.'); return; }
    if (!message.trim()) { setErr('Message is required.'); return; }
    if (type === 'image' && !imageFile) { setErr('Please select an image.'); return; }
    setSaving(true);
    setErr('');

    let imageData = null;
    if (type === 'image' && imageFile) {
      imageData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result); // base64 data URL
        reader.readAsDataURL(imageFile);
      });
    }

    const r = await apiFetch(`/api/bots/${botId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), message: message.trim(), type, imageData }),
    });
    setSaving(false);
    if (r.ok) { onCreated(r.campaign.id); }
    else { setErr(r.error || 'Failed to create campaign.'); }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 mb-6">
      <h3 className="font-semibold text-white mb-4">New Campaign</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Campaign Name</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. June Promo Blast"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500"
          />
        </div>

        {/* Message type toggle */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">Message Type</label>
          <div className="flex gap-2">
            {[{ id: 'text', label: '💬 Text' }, { id: 'image', label: '🖼️ Image + Caption' }].map(t => (
              <button
                key={t.id} type="button" onClick={() => setType(t.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                  type === t.id ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Image picker */}
        {type === 'image' && (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Image</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-700 rounded-xl p-4 text-center cursor-pointer hover:border-slate-500 transition"
            >
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="max-h-32 mx-auto rounded-lg object-contain" />
              ) : (
                <div className="text-slate-500 text-sm">Click to select image (JPG, PNG, WebP)</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
          </div>
        )}

        {/* Message / caption */}
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            {type === 'image' ? 'Caption' : 'Message'}
            <span className="text-slate-600 ml-2 font-normal">Use {'{name}'} for personalisation</span>
          </label>
          <textarea
            rows={4} value={message} onChange={e => setMessage(e.target.value)}
            placeholder={`Hi {name}! 👋 We have an exciting offer for you...`}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 resize-none"
          />
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition text-sm">
            {saving ? 'Creating...' : 'Create Campaign'}
          </button>
          <button type="button" onClick={onCancel} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-lg transition text-sm">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Campaign detail view ──────────────────────────────
function CampaignDetail({ botId, campaign, onBack }) {
  const [contacts, setContacts] = useState([]);
  const [manualNum, setManualNum] = useState('');
  const [manualName, setManualName] = useState('');
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendLog, setSendLog] = useState('');
  const [csvErr, setCsvErr] = useState('');
  const [addErr, setAddErr] = useState('');
  const csvRef = useRef();
  const logRef = useRef();

  useEffect(() => { loadContacts(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [sendLog]);

  async function loadContacts() {
    const r = await apiFetch(`/api/bots/${botId}/campaigns/${campaign.id}/contacts`);
    setContacts(r.contacts || []);
  }

  async function handleAddManual(e) {
    e.preventDefault();
    if (!manualNum.trim()) { setAddErr('Number is required.'); return; }
    setAdding(true); setAddErr('');
    const r = await apiFetch(`/api/bots/${botId}/campaigns/${campaign.id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ contacts: [{ number: manualNum.trim(), name: manualName.trim() }] }),
    });
    setAdding(false);
    if (r.ok) { setManualNum(''); setManualName(''); loadContacts(); }
    else { setAddErr(r.error || 'Failed to add contact.'); }
  }

  async function handleCsvUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCsvErr('');
    const text = await file.text();
    const parsed = [];
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const [num, ...rest] = s.split(',');
      const number = num.replace(/[^0-9]/g, '');
      if (number.length < 7) continue;
      parsed.push({ number, name: rest.join(',').trim() });
    }
    if (!parsed.length) { setCsvErr('No valid contacts found in CSV.'); return; }
    const r = await apiFetch(`/api/bots/${botId}/campaigns/${campaign.id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ contacts: parsed }),
    });
    if (r.ok) { loadContacts(); }
    else { setCsvErr(r.error || 'Upload failed.'); }
    e.target.value = '';
  }

  async function handleSendNow() {
    if (!confirm(`Send this campaign to ${contacts.length} contacts? This will send real WhatsApp messages.`)) return;
    setSending(true);
    setSendLog('Starting campaign send...\n');

    try {
      const res = await fetch(`/api/bots/${botId}/campaigns/${campaign.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-portal-token': getToken() || '' },
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const msg = line.slice(6).trim();
            if (msg === '__DONE__') { setSendLog(p => p + '\n✓ Campaign complete.\n'); setSending(false); loadContacts(); }
            else if (msg === '__ERROR__') { setSendLog(p => p + '\n✗ Campaign ended with errors.\n'); setSending(false); loadContacts(); }
            else if (msg) { setSendLog(p => p + msg + '\n'); }
          }
        }
      }
    } catch (e) {
      setSendLog(p => p + `\n✗ Error: ${e.message}\n`);
      setSending(false);
    }
  }

  async function handleDeleteContact(contactId) {
    await apiFetch(`/api/bots/${botId}/campaigns/${campaign.id}/contacts/${contactId}`, { method: 'DELETE' });
    loadContacts();
  }

  const pending = contacts.filter(c => c.status === 'pending').length;
  const sent = contacts.filter(c => c.status === 'sent').length;
  const failed = contacts.filter(c => c.status === 'failed').length;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition mb-6">
        ← Back to Campaigns
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold text-white">{campaign.name}</h2>
            <StatusBadge status={campaign.status} />
          </div>
          <p className="text-slate-500 text-sm">{campaign.type === 'image' ? '🖼️ Image + caption' : '💬 Text message'}</p>
        </div>
        <button
          onClick={handleSendNow}
          disabled={sending || pending === 0}
          className="bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white font-semibold px-5 py-2.5 rounded-lg transition text-sm flex items-center gap-2"
        >
          {sending ? '⏳ Sending...' : `📤 Send Now (${pending} pending)`}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Pending', value: pending, color: 'text-slate-300' },
          { label: 'Sent', value: sent, color: 'text-green-400' },
          { label: 'Failed', value: failed, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-slate-500 text-xs mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Message preview */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <p className="text-xs text-slate-500 mb-2">Message preview</p>
        {campaign.imagePath && (
          <div className="mb-2 text-xs text-slate-400">🖼️ Image attached</div>
        )}
        <p className="text-slate-300 text-sm whitespace-pre-wrap">{campaign.message}</p>
      </div>

      {/* Send log */}
      {sendLog && (
        <div ref={logRef} className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-6 h-40 overflow-y-auto">
          <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono">{sendLog}</pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add contacts */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Add Contacts</h3>

          {/* Manual entry */}
          <form onSubmit={handleAddManual} className="space-y-2 mb-4">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text" value={manualNum} onChange={e => setManualNum(e.target.value)}
                placeholder="Number (e.g. 923001234567)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
              <input
                type="text" value={manualName} onChange={e => setManualName(e.target.value)}
                placeholder="Name (optional)"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
              />
            </div>
            {addErr && <p className="text-red-400 text-xs">{addErr}</p>}
            <button type="submit" disabled={adding} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
              {adding ? 'Adding...' : '+ Add'}
            </button>
          </form>

          {/* CSV upload */}
          <div className="border-t border-slate-800 pt-4">
            <p className="text-xs text-slate-500 mb-2">Or import from CSV (number,name — one per line)</p>
            <button
              type="button" onClick={() => csvRef.current?.click()}
              className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              📄 Import CSV
            </button>
            <input ref={csvRef} type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
            {csvErr && <p className="text-red-400 text-xs mt-2">{csvErr}</p>}
          </div>
        </div>

        {/* Contact list */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="font-semibold text-white text-sm mb-4">Contacts ({contacts.length})</h3>
          {contacts.length === 0 ? (
            <p className="text-slate-500 text-sm">No contacts yet. Add some on the left.</p>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {contacts.map(c => (
                <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-800 group">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'sent' ? 'bg-green-500' : c.status === 'failed' ? 'bg-red-500' : 'bg-slate-500'}`} />
                    <div>
                      <span className="text-sm text-white">{c.name || c.number}</span>
                      {c.name && <span className="text-xs text-slate-500 ml-1">{c.number}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 capitalize">{c.status}</span>
                    {c.status === 'pending' && (
                      <button
                        onClick={() => handleDeleteContact(c.id)}
                        className="text-slate-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition"
                      >✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft: 'bg-slate-700 text-slate-300',
    sending: 'bg-yellow-500/20 text-yellow-400',
    done: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] || map.draft}`}>
      {status || 'draft'}
    </span>
  );
}
