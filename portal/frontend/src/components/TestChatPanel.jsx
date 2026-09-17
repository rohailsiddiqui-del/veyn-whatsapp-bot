'use client';
import { useState, useRef, useEffect } from 'react';
import { chatBot } from '../lib/api';

// Stable session ID for this browser tab (survives re-renders, resets on page reload)
function makeSessionId() {
  return 's' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function TestChatPanel({ botId, botName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sessionId = useRef(makeSessionId());
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sendingRef = useRef(false); // ref-based guard prevents race conditions on rapid Enter/click

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const data = await chatBot(botId, text, sessionId.current);
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'bot', text: data.reply }]);
      } else {
        setError(data.error || 'No reply received.');
      }
    } catch {
      setError('Connection error — is the bot running?');
    } finally {
      sendingRef.current = false;
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function clearChat() {
    sessionId.current = makeSessionId();
    setMessages([
      { role: 'bot', text: `Chat cleared. Fresh session started — ask me anything! 👋` },
    ]);
    setError(null);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Test Chat</h2>
          <p className="text-slate-400 text-sm mt-1">
            Chat with <span className="text-green-400 font-medium">{botName}</span> directly — no WhatsApp needed. Tests live KB and personality.
          </p>
        </div>
        <button
          onClick={clearChat}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-sm font-medium transition border border-slate-700"
        >
          🗑 Clear Chat
        </button>
      </div>

      {/* Chat window */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 flex flex-col" style={{ height: '60vh' }}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center pb-8">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-slate-400 text-sm">Type a message below to start chatting with <span className="text-green-400 font-medium">{botName}</span></p>
              <p className="text-slate-600 text-xs mt-1">Same engine as WhatsApp — live KB &amp; personality</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-green-500 text-white rounded-br-sm'
                    : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-2 h-2 bg-slate-400 rounded-full inline-block"
                    style={{ animation: `bounce 0.9s ${i * 0.15}s infinite` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex justify-center">
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-4 py-2 rounded-lg max-w-sm text-center">
                ⚠️ {error}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-slate-800 p-4 flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Type a message and press Enter..."
            disabled={loading}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-green-500 transition disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-default text-white rounded-xl text-sm font-medium transition"
          >
            Send
          </button>
        </div>
      </div>

      {/* Info footer */}
      <div className="mt-4 flex gap-6 text-xs text-slate-500">
        <span>💡 Each "Clear Chat" starts a fresh session — previous context is wiped</span>
        <span>📡 Messages go directly to the bot — same engine as WhatsApp</span>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
