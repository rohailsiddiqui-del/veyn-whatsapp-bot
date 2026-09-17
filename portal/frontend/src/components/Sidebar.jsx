'use client';

const ITEMS = [
  { id: 'status', icon: '📊', label: 'Bot Status' },
  { id: 'personality', icon: '🎭', label: 'Personality' },
  { id: 'knowledge-base', icon: '📚', label: 'Knowledge Base' },
  { id: 'integrations', icon: '🔗', label: 'Integrations' },
];

export default function Sidebar({ tab, setTab, onLogout }) {
  return (
    <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-sm">💬</div>
          <span className="font-bold text-white text-sm">Veyn Portal</span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {ITEMS.map(item => (
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
  );
}
