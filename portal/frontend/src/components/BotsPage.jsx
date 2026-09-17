'use client';
import { useState, useEffect, useCallback } from 'react';
import { listBots, createBot, deleteBot } from '../lib/api';
import BotDetail from './BotDetail';

const INDUSTRIES = [
  {
    id: 'qsr',
    label: 'Restaurant / QSR',
    icon: '🍽️',
    description: 'Menu, ordering, pickup & delivery, daily specials',
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    icon: '🛒',
    description: 'Online store — product queries, order help, promotions',
  },
  {
    id: 'retail',
    label: 'Retail / Shop',
    icon: '🏪',
    description: 'Physical or hybrid store — products, hours, availability',
  },
  {
    id: 'automotive',
    label: 'Automotive',
    icon: '🚗',
    description: 'Car dealership — vehicle queries, test drives, financing',
  },
  {
    id: 'telecom',
    label: 'Telecom',
    icon: '📡',
    description: 'SIM, plans, data packages, billing support',
  },
  {
    id: 'realestate',
    label: 'Real Estate',
    icon: '🏠',
    description: 'Property inquiries, lead qualification, viewings',
  },
  {
    id: 'healthcare',
    label: 'Healthcare / Clinic',
    icon: '🏥',
    description: 'Appointment booking, clinic info, services',
  },
  {
    id: 'education',
    label: 'Education',
    icon: '🎓',
    description: 'Admissions, courses, fees, student queries',
  },
  {
    id: 'banking',
    label: 'Banking / Finance',
    icon: '🏦',
    description: 'FAQ, product info, lead qualification — compliance-safe',
  },
  {
    id: 'custom',
    label: 'Custom / Other',
    icon: '✏️',
    description: 'Start blank — write your own personality',
  },
];

const FEATURE_TIERS = [
  {
    id: 'text',
    icon: '💬',
    label: 'Text',
    description: 'Replies with text messages only',
    badge: 'Text',
  },
  {
    id: 'text_image',
    icon: '🖼️',
    label: 'Text + Image',
    description: 'Sends text and product/menu images from the knowledge base',
    badge: 'Text · Image',
  },
  {
    id: 'text_image_voice',
    icon: '🎙️',
    label: 'Text + Image + Voice',
    description: 'Full media — text, images, and voice note replies',
    badge: 'Text · Image · Voice',
  },
];

export default function BotsPage({ onLogout }) {
  const [bots, setBots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState(null);
  const [selectedFeatures, setSelectedFeatures] = useState('text');
  const [createErr, setCreateErr] = useState('');

  const refresh = useCallback(async () => {
    const data = await listBots();
    setBots(data.bots || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (!selectedIndustry) { setCreateErr('Please select an industry template.'); return; }
    setCreateErr('');
    setCreateSaving(true);
    try {
      const r = await createBot({ botName: newName.trim(), industry: selectedIndustry, features: selectedFeatures });
      if (r.ok) {
        setNewName('');
        setSelectedIndustry(null);
        setSelectedFeatures('text');
        setCreating(false);
        await refresh();
        setSelected(r.bot.id);
      } else {
        setCreateErr(r.error || 'Failed to create bot');
      }
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleDelete(botId, botName) {
    if (!confirm(`Delete bot "${botName}"? This cannot be undone.`)) return;
    await deleteBot(botId);
    if (selected === botId) setSelected(null);
    refresh();
  }

  function statusColor(status) {
    if (status === 'online') return 'bg-green-500';
    if (status === 'stopping' || status === 'launching') return 'bg-yellow-500';
    return 'bg-slate-600';
  }

  function industryIcon(industryId) {
    return INDUSTRIES.find(i => i.id === industryId)?.icon || '💬';
  }

  if (selected) {
    const bot = bots.find(b => b.id === selected);
    return (
      <BotDetail
        botId={selected}
        botName={bot?.botName || selected}
        onBack={() => { setSelected(null); refresh(); }}
        onLogout={onLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-sm">💬</div>
          <span className="font-bold text-white">Bot Portal</span>
        </div>
        <button onClick={onLogout} className="text-slate-400 hover:text-red-400 text-sm transition">
          Logout
        </button>
      </header>

      <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Your Bots</h1>
            <p className="text-slate-400 text-sm mt-1">{bots.length} bot{bots.length !== 1 ? 's' : ''} configured</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="bg-green-500 hover:bg-green-400 text-white font-semibold px-5 py-2.5 rounded-lg transition flex items-center gap-2"
          >
            <span>+</span> New Bot
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-semibold text-white">Create New Bot</h2>
                <p className="text-slate-500 text-xs mt-0.5">Set up your bot in 3 steps. Everything can be edited later.</p>
              </div>
              {/* Step indicator */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className={selectedIndustry ? 'text-green-400 font-medium' : 'text-slate-400'}>1 Industry</span>
                <span>·</span>
                <span className="text-slate-400">2 Features</span>
                <span>·</span>
                <span className="text-slate-400">3 Name</span>
              </div>
            </div>

            {/* Step 1: Industry */}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Step 1 — Industry</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
              {INDUSTRIES.map(ind => (
                <button
                  key={ind.id}
                  type="button"
                  onClick={() => setSelectedIndustry(ind.id)}
                  className={`rounded-xl p-3 text-left border transition ${
                    selectedIndustry === ind.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  }`}
                >
                  <div className="text-xl mb-1">{ind.icon}</div>
                  <div className="text-xs font-semibold text-white leading-tight">{ind.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5 leading-tight hidden sm:block">{ind.description}</div>
                </button>
              ))}
            </div>

            {/* Step 2: Features / Capabilities */}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Step 2 — Bot Capabilities</p>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {FEATURE_TIERS.map(tier => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setSelectedFeatures(tier.id)}
                  className={`rounded-xl p-4 text-left border transition ${
                    selectedFeatures === tier.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  }`}
                >
                  <div className="text-2xl mb-2">{tier.icon}</div>
                  <div className="text-sm font-semibold text-white">{tier.label}</div>
                  <div className="text-xs text-slate-400 mt-1 leading-snug">{tier.description}</div>
                  {selectedFeatures === tier.id && (
                    <div className="mt-2 inline-block text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Selected</div>
                  )}
                </button>
              ))}
            </div>

            {/* Step 3: Bot Name */}
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Step 3 — Bot Name</p>
            <form onSubmit={handleCreate} className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. New Yorker Pizza Bot"
                  autoFocus
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500"
                />
              </div>
              <button
                type="submit"
                disabled={createSaving}
                className="bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-lg transition min-w-[110px]"
              >
                {createSaving ? 'Starting…' : 'Create Bot'}
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={() => { setCreating(false); setNewName(''); setSelectedIndustry(null); setSelectedFeatures('text'); setCreateErr(''); }}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white px-5 py-2.5 rounded-lg transition"
              >
                Cancel
              </button>
            </form>
            {createErr && <p className="text-red-400 text-sm mt-2">{createErr}</p>}
          </div>
        )}

        {/* Bot grid */}
        {loading ? (
          <div className="text-slate-400 text-center py-16">Loading...</div>
        ) : bots.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">💬</div>
            <p className="text-slate-400 mb-2">No bots yet</p>
            <p className="text-slate-500 text-sm">Create your first bot to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map(bot => {
              const pm2 = bot.pm2Status || {};
              const status = pm2.status || 'stopped';
              return (
                <div
                  key={bot.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-600 transition cursor-pointer group"
                  onClick={() => setSelected(bot.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${statusColor(status)}`} />
                      <span className="text-sm text-slate-400 capitalize">{status}</span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(bot.id, bot.botName); }}
                      className="text-slate-600 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                      title="Delete bot"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{industryIcon(bot.industry)}</span>
                    <h3 className="font-semibold text-white">{bot.botName || bot.id}</h3>
                  </div>
                  <p className="text-slate-500 text-xs">{bot.phoneLabel || 'No phone label'}</p>
                  {pm2.uptime && (
                    <p className="text-slate-600 text-xs mt-2">
                      Up {Math.round((Date.now() - pm2.uptime) / 60000)}m
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {INDUSTRIES.find(i => i.id === bot.industry)?.label || bot.industry || 'Custom'}
                      </span>
                      {bot.features && bot.features !== 'text' && (
                        <span className="text-xs bg-slate-800 border border-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                          {FEATURE_TIERS.find(f => f.id === bot.features)?.badge || bot.features}
                        </span>
                      )}
                    </div>
                    <span className="text-green-400 text-xs group-hover:text-green-300 transition">
                      Manage →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
