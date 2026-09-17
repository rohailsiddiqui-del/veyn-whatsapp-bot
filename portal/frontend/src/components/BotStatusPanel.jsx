'use client';
import { useState, useEffect } from 'react';
import { getBot, startBot, stopBot, restartBot, resetAuth } from '../lib/api';

export default function BotStatusPanel({ botId }) {
  const [bot, setBot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function refresh() {
    const data = await getBot(botId);
    setBot(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [botId]);

  async function action(label, fn) {
    setBusy(label);
    setMsg('');
    const r = await fn();
    setBusy('');
    setMsg(r.ok ? `${label} successful.` : r.error || 'Failed');
    refresh();
  }

  if (loading) return <div className="text-slate-400">Loading...</div>;
  if (!bot?.id) return <div className="text-red-400">Bot not found.</div>;

  const pm2 = bot.pm2Status || {};
  const status = pm2.status || 'stopped';
  const isOnline = status === 'online';

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Bot Status</h2>

      {/* Status card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6 flex items-center gap-6">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl ${isOnline ? 'bg-green-500/20' : 'bg-slate-700/50'}`}>
          {isOnline ? '✅' : '⭕'}
        </div>
        <div>
          <p className="text-2xl font-bold text-white capitalize">{status}</p>
          <p className="text-slate-400 text-sm">{bot.botName} · {bot.phoneLabel || 'No phone label'}</p>
          {pm2.uptime && (
            <p className="text-slate-500 text-xs mt-1">
              Uptime: {Math.round((Date.now() - pm2.uptime) / 60000)} min · Restarts: {pm2.restarts || 0}
            </p>
          )}
          {pm2.pid && <p className="text-slate-600 text-xs">PID: {pm2.pid}</p>}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Controls</h3>
        <div className="flex flex-wrap gap-3">
          {!isOnline && (
            <button
              disabled={!!busy}
              onClick={() => action('Start', () => startBot(botId))}
              className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
            >
              {busy === 'Start' ? 'Starting...' : 'Start'}
            </button>
          )}
          {isOnline && (
            <>
              <button
                disabled={!!busy}
                onClick={() => action('Restart', () => restartBot(botId))}
                className="bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {busy === 'Restart' ? 'Restarting...' : 'Restart'}
              </button>
              <button
                disabled={!!busy}
                onClick={() => action('Stop', () => stopBot(botId))}
                className="bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
              >
                {busy === 'Stop' ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}
        </div>
        {msg && (
          <p className={`text-sm mt-3 ${msg.includes('successful') ? 'text-green-400' : 'text-red-400'}`}>
            {msg}
          </p>
        )}
      </div>

      {/* Danger zone */}
      <div className="bg-slate-900 border border-red-900/40 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-red-400 mb-2">Danger Zone</h3>
        <p className="text-slate-400 text-sm mb-4">
          Reset WhatsApp auth if the bot shows logged out. The bot will need to be re-linked by scanning a new QR code.
        </p>
        <button
          disabled={!!busy}
          onClick={() => {
            if (!confirm('Reset WhatsApp auth? The bot will disconnect and need a new QR scan.')) return;
            action('Reset Auth', () => resetAuth(botId));
          }}
          className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {busy === 'Reset Auth' ? 'Resetting...' : 'Reset WhatsApp Auth'}
        </button>
      </div>
    </div>
  );
}
