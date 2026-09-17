'use client';
import { useState, useEffect } from 'react';
import { getBotStatus, restartBot } from '../lib/api';

export default function StatusPanel() {
  const [status, setStatus] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    const s = await getBotStatus();
    setStatus(s);
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  async function handleRestart() {
    setRestarting(true);
    setMsg('');
    const r = await restartBot();
    setRestarting(false);
    setMsg(r.ok ? 'Bot restarted successfully.' : `Error: ${r.error}`);
    setTimeout(load, 3000);
  }

  const isOnline = status?.status === 'online';
  const uptime = status?.uptime ? Math.floor((Date.now() - status.uptime) / 1000 / 60) : null;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Bot Status</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-2">Status</p>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className={`font-bold text-lg ${isOnline ? 'text-green-400' : 'text-red-400'}`}>
              {status ? (isOnline ? 'Online' : 'Offline') : 'Checking...'}
            </span>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-2">Uptime</p>
          <p className="font-bold text-lg text-white">{uptime !== null ? `${uptime} min` : '—'}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-2">Restarts</p>
          <p className="font-bold text-lg text-white">{status?.restarts ?? '—'}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={handleRestart}
          disabled={restarting}
          className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {restarting ? 'Restarting...' : '🔄 Restart Bot'}
        </button>
        <button
          onClick={load}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-lg transition"
        >
          Refresh
        </button>
      </div>
      {msg && <p className={`mt-4 text-sm ${msg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}
    </div>
  );
}
