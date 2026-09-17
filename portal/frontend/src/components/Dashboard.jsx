'use client';
import { useState } from 'react';
import Sidebar from './Sidebar';
import StatusPanel from './StatusPanel';
import PersonalityPanel from './PersonalityPanel';
import KnowledgeBasePanel from './KnowledgeBasePanel';
import IntegrationsPanel from './IntegrationsPanel';

const TABS = ['status', 'personality', 'knowledge-base', 'integrations'];

export default function Dashboard({ onLogout }) {
  const [tab, setTab] = useState('status');

  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar tab={tab} setTab={setTab} onLogout={onLogout} />
      <main className="flex-1 p-8 overflow-auto">
        {tab === 'status' && <StatusPanel />}
        {tab === 'personality' && <PersonalityPanel />}
        {tab === 'knowledge-base' && <KnowledgeBasePanel />}
        {tab === 'integrations' && <IntegrationsPanel />}
      </main>
    </div>
  );
}
