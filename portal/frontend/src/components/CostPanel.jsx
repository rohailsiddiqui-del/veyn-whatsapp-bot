'use client';
import { useState, useEffect, useCallback } from 'react';
import { getToken } from '../lib/auth';

const API = '/api';
const token = () => getToken() || '';

// Human-readable labels for each usage kind
const KIND_LABELS = {
  generate: 'Text reply',
  embed:    'KB search',
  transcribe: 'Voice transcription',
};

const KIND_ICONS = {
  generate:   '💬',
  embed:      '🔍',
  transcribe: '🎙️',
};

function fmt(n, decimals = 6) {
  if (!n) return '0';
  return Number(n).toFixed(decimals).replace(/\.?0+$/, '');
}

function fmtCost(usd) {
  if (!usd || usd === 0) return '$0.000000';
  return '$' + Number(usd).toFixed(6);
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export default function CostPanel({ botId }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (d) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/bots/${botId}/cost?days=${d}`, {
        headers: { 'x-portal-token': token() },
      });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => { load(days); }, [days, load]);

  const totals = data?.totals || {};
  const rows = data?.rows || [];

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">API Cost</h2>
          <p className="text-slate-400 text-sm mt-1">Gemini token usage and estimated USD cost</p>
        </div>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2"
        >
          <option value={1}>Today</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-slate-400 text-sm py-8 text-center">Loading...</div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400 text-xs mb-1">Total cost</div>
              <div className="text-2xl font-bold text-green-400">{fmtCost(totals.cost_usd)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400 text-xs mb-1">Total tokens</div>
              <div className="text-2xl font-bold text-white">{fmtTokens(totals.total_tokens)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-slate-400 text-xs mb-1">API calls</div>
              <div className="text-2xl font-bold text-white">{totals.calls || 0}</div>
            </div>
          </div>

          {/* Breakdown table */}
          {rows.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">
              No usage recorded in this period.
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-5 py-3 text-slate-400 font-medium">Type</th>
                    <th className="text-right px-5 py-3 text-slate-400 font-medium">Calls</th>
                    <th className="text-right px-5 py-3 text-slate-400 font-medium">In tokens</th>
                    <th className="text-right px-5 py-3 text-slate-400 font-medium">Out tokens</th>
                    <th className="text-right px-5 py-3 text-slate-400 font-medium">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.kind} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white">
                        <span className="mr-2">{KIND_ICONS[row.kind] || '🔧'}</span>
                        {KIND_LABELS[row.kind] || row.kind}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-300">{row.calls}</td>
                      <td className="px-5 py-3 text-right text-slate-300">{fmtTokens(row.in_tokens)}</td>
                      <td className="px-5 py-3 text-right text-slate-300">{fmtTokens(row.out_tokens)}</td>
                      <td className="px-5 py-3 text-right font-mono text-green-400">{fmtCost(row.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800/40">
                    <td className="px-5 py-3 text-white font-semibold">Total</td>
                    <td className="px-5 py-3 text-right text-white font-semibold">{totals.calls || 0}</td>
                    <td className="px-5 py-3 text-right text-white font-semibold">{fmtTokens(totals.in_tokens)}</td>
                    <td className="px-5 py-3 text-right text-white font-semibold">{fmtTokens(totals.out_tokens)}</td>
                    <td className="px-5 py-3 text-right font-mono font-bold text-green-400">{fmtCost(totals.cost_usd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-slate-600 text-xs mt-4">
            Pricing: gemini-2.5-flash $0.30/M in · $2.50/M out · gemini-embedding-001 $0.15/M in
          </p>
        </>
      )}
    </div>
  );
}
