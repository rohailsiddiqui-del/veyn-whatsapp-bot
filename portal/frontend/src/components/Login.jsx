'use client';
import { useState } from 'react';
import { login } from '../lib/api';
import { setToken } from '../lib/auth';

export default function Login({ onLogin }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await login(pw);
    setLoading(false);
    if (res.token) { setToken(res.token); onLogin(); }
    else setError('Wrong password');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center text-xl">💬</div>
          <div>
            <h1 className="text-lg font-bold text-white">Veyn Bot Portal</h1>
            <p className="text-slate-400 text-sm">Configuration Dashboard</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-green-500 transition"
              placeholder="Enter portal password"
              autoFocus
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
