'use client';
import { useState } from 'react';
import BotStatusPanel from './BotStatusPanel';
import BotPersonalityPanel from './BotPersonalityPanel';
import BotKBPanel from './BotKBPanel';
import QRPanel from './QRPanel';
import IntegrationsPanel from './IntegrationsPanel';
import CampaignsPanel from './CampaignsPanel';
import CostPanel from './CostPanel';
import TestChatPanel from './TestChatPanel';

const TABS = [
  { id: 'status', icon: '📊', label: 'Status' },
  { id: 'qr', icon: '📱', label: 'QR / Connect' },
  { id: 'personality', icon: '🎭', label: 'Personality' },
  { id: 'knowledge-base', icon: '📚', label: 'Knowledge Base' },
  { id: 'test-chat', icon: '🧪', label: 'Test Chat' },
  { id: 'campaigns', icon: '📤', label: 'Campaigns' },
  { id: 'integrations', icon: '🔗', label: 'Integrations' },
  { id: 'cost', icon: '💰', label: 'Cost' },
];

export default function BotDetail({ botId, botName, onBack, onLogout }) {
  const [tab, setTab] = useState('status');

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-5 border-b border-slate-800">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition mb-3"
          >
            ← All Bots
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-sm">💬</div>
            <div>
              <span className="font-bold text-white text-sm block truncate max-w-[140px]">{botName}</span>
              <span className="text-slate-500 text-xs">Bot Management</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {TABS.map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                tab === item.id
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
          >
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {tab === 'status' && <BotStatusPanel botId={botId} />}
        {tab === 'qr' && <QRPanel botId={botId} />}
        {tab === 'personality' && <BotPersonalityPanel botId={botId} />}
        {tab === 'knowledge-base' && <BotKBPanel botId={botId} />}
        {tab === 'test-chat' && <TestChatPanel botId={botId} botName={botName} />}
        {tab === 'campaigns' && <CampaignsPanel botId={botId} />}
        {tab === 'integrations' && <IntegrationsPanel botId={botId} />}
        {tab === 'cost' && <CostPanel botId={botId} />}
      </main>
    </div>
  );
}
