'use client';
import { useState, useEffect, useRef } from 'react';
import { startBot, restartBot, resetAuth } from '../lib/api';
import { getToken } from '../lib/auth';

const POLL_INTERVAL = 3000; // ms — poll for QR status every 3 seconds

export default function QRPanel({ botId }) {
  const [status, setStatus] = useState('LOADING'); // LOADING | WAITING | QR | CONNECTED | NOT_STARTED | LEGACY_BOT
  const [qrImg, setQrImg] = useState(null);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState('');
  const [switching, setSwitching] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const timerRef = useRef(null);
  const activeRef = useRef(true);

  async function poll() {
    if (!activeRef.current) return;
    try {
      const token = getToken() || '';
      const res = await fetch(`/api/bots/${botId}/qr-status?token=${encodeURIComponent(token)}`);
      if (!res.ok) { setStatus('NOT_STARTED'); return; }
      const data = await res.json();

      if (!activeRef.current) return;

      if (data.status === 'QR' && data.qr) {
        setQrImg(data.qr);
        setStatus('QR');
      } else if (data.status === 'CONNECTED') {
        setQrImg(null);
        setStatus('CONNECTED');
      } else if (data.status === 'NOT_STARTED') {
        setStatus('NOT_STARTED');
      } else if (data.status === 'LEGACY_BOT') {
        setStatus('LEGACY_BOT');
      } else {
        // WAITING — bot is starting up, keep polling
        setStatus('WAITING');
      }
    } catch {
      if (activeRef.current) setStatus('NOT_STARTED');
    }
    // Schedule next poll (always, except CONNECTED/NOT_STARTED/LEGACY)
    if (activeRef.current) {
      timerRef.current = setTimeout(poll, POLL_INTERVAL);
    }
  }

  function startPolling() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('LOADING');
    setMsg('');
    activeRef.current = true;
    poll();
  }

  useEffect(() => {
    activeRef.current = true;
    startPolling();
    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [botId]);

  async function handleStart() {
    setStarting(true);
    setMsg('');
    const r = await startBot(botId);
    setStarting(false);
    if (r.ok) {
      setMsg('Bot starting...');
      setTimeout(startPolling, 3000);
    } else {
      setMsg(r.error || 'Failed to start bot');
    }
  }

  async function handleRestart() {
    setStarting(true);
    setMsg('');
    const r = await restartBot(botId);
    setStarting(false);
    if (r.ok) {
      setMsg('Restarting...');
      setTimeout(startPolling, 3000);
    } else {
      setMsg(r.error || 'Failed to restart bot');
    }
  }

  async function handleSwitchNumber() {
    if (!confirm('This will unlink the current WhatsApp number and show a new QR code. The bot will briefly go offline. Continue?')) return;
    setSwitching(true);
    setMsg('');
    setShowSwitch(false);
    const r = await resetAuth(botId);
    if (r.ok) {
      setMsg('Auth cleared. Restarting bot to show new QR...');
      setTimeout(() => {
        startBot(botId).then(() => setTimeout(startPolling, 4000));
      }, 1500);
    } else {
      setMsg(r.error || 'Failed to reset auth.');
    }
    setSwitching(false);
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">QR Code / Connect WhatsApp</h2>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md">

        {(status === 'LOADING' || status === 'WAITING') && (
          <div className="text-center">
            <div className="text-4xl mb-4 animate-pulse">📲</div>
            <p className="text-yellow-400 font-semibold mb-1">
              {status === 'LOADING' ? 'Checking connection...' : 'Generating QR Code...'}
            </p>
            <p className="text-slate-500 text-sm mb-5">Polling every 3 seconds</p>
            {status === 'WAITING' && (
              <button
                disabled={starting}
                onClick={handleRestart}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2 rounded-lg text-sm transition"
              >
                {starting ? 'Restarting...' : 'Restart Bot'}
              </button>
            )}
            {msg && <p className="text-green-400 text-sm mt-3">{msg}</p>}
          </div>
        )}

        {status === 'QR' && qrImg && (
          <div className="text-center">
            <p className="text-slate-300 text-sm mb-4">
              Open WhatsApp → Linked Devices → Link a Device, then scan:
            </p>
            <img
              src={qrImg}
              alt="WhatsApp QR Code"
              className="rounded-xl mx-auto border border-slate-700"
              style={{ width: 280, height: 280 }}
            />
            <p className="text-slate-500 text-xs mt-4">QR refreshes automatically every ~20s</p>
          </div>
        )}

        {status === 'CONNECTED' && (
          <div className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-green-400 font-semibold text-lg">WhatsApp Connected</p>
            <p className="text-slate-400 text-sm mt-2 mb-5">The bot is linked and running.</p>
            {!showSwitch ? (
              <button
                onClick={() => setShowSwitch(true)}
                className="text-slate-400 hover:text-white text-sm underline underline-offset-2 transition"
              >
                Switch to a different number
              </button>
            ) : (
              <div className="bg-slate-800 border border-yellow-600/40 rounded-xl p-4 text-left">
                <p className="text-yellow-400 text-sm font-semibold mb-1">⚠️ Switch WhatsApp Number</p>
                <p className="text-slate-400 text-xs mb-3">
                  This will unlink the current number and show a new QR code. The old number will stop receiving bot messages. Make sure you have the new phone ready to scan immediately.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSwitchNumber}
                    disabled={switching}
                    className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black text-sm font-semibold px-4 py-2 rounded-lg transition"
                  >
                    {switching ? 'Switching...' : 'Yes, Switch Number'}
                  </button>
                  <button
                    onClick={() => setShowSwitch(false)}
                    className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-2 rounded-lg transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'NOT_STARTED' && (
          <div className="text-center">
            <div className="text-5xl mb-4">📱</div>
            <p className="text-slate-400 mb-2">Bot is not running</p>
            <p className="text-slate-500 text-sm mb-6">Start the bot to generate a QR code</p>
            <button
              disabled={starting}
              onClick={handleStart}
              className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition"
            >
              {starting ? 'Starting...' : 'Start Bot & Show QR'}
            </button>
            <div className="mt-4 border-t border-slate-800 pt-4">
              <button
                onClick={handleSwitchNumber}
                disabled={switching}
                className="text-slate-500 hover:text-yellow-400 text-xs underline underline-offset-2 transition"
              >
                {switching ? 'Clearing auth...' : 'Clear auth & link a new number'}
              </button>
            </div>
            {msg && <p className="text-sm mt-3 text-green-400">{msg}</p>}
          </div>
        )}

        {status === 'LEGACY_BOT' && (
          <div className="text-center">
            <div className="text-5xl mb-4">🔗</div>
            <p className="text-slate-300 font-semibold mb-2">This bot uses terminal QR linking</p>
            <p className="text-slate-500 text-sm mb-4">
              The Veyn bot was set up via SSH terminal. QR code display is only available for new bots created through this portal.
            </p>
            <div className="bg-slate-800 rounded-lg p-4 text-left">
              <p className="text-slate-400 text-xs font-mono mb-1">To re-link via terminal:</p>
              <code className="text-green-400 text-xs font-mono">
                pm2 stop veyn-bot &amp;&amp; pm2 start veyn-bot
              </code>
            </div>
          </div>
        )}

      </div>

      {status === 'QR' && (
        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4 max-w-md">
          <p className="text-slate-400 text-sm font-medium mb-2">Steps:</p>
          <ol className="text-slate-500 text-sm space-y-1 list-decimal list-inside">
            <li>Open WhatsApp on your phone</li>
            <li>Tap Menu (⋮) or Settings</li>
            <li>Tap <strong className="text-slate-400">Linked Devices</strong></li>
            <li>Tap <strong className="text-slate-400">Link a Device</strong></li>
            <li>Scan the QR code above</li>
          </ol>
        </div>
      )}
    </div>
  );
}
