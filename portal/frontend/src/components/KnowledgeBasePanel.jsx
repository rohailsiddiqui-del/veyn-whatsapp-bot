'use client';
import { useState, useEffect, useRef } from 'react';
import { getKBSources, uploadKBFiles, deleteSource } from '../lib/api';

export default function KnowledgeBasePanel() {
  const [sources, setSources] = useState([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();
  const logRef = useRef();

  async function loadSources() {
    const r = await getKBSources();
    setSources(r.sources || []);
    setTotalChunks(r.totalChunks || 0);
  }

  useEffect(() => { loadSources(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setMsg('');
    const r = await uploadKBFiles(files);
    setUploading(false);
    if (r.ok) {
      setMsg(`Uploaded: ${r.files.join(', ')}. Now click Ingest.`);
    } else {
      setMsg(`Upload failed: ${r.error}`);
    }
    fileRef.current.value = '';
  }

  async function handleIngest() {
    setIngesting(true);
    setLog([]);
    setMsg('');
    const res = await fetch('/api/kb/ingest', {
      headers: { 'x-portal-token': localStorage.getItem('veyn_portal_token') || '' }
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.replace('data: ', '').trim();
        if (data === '__DONE__') { setIngesting(false); loadSources(); setMsg('Ingestion complete. Restart the bot to apply.'); return; }
        if (data) setLog(l => [...l, data]);
      }
    }
    setIngesting(false);
    loadSources();
  }

  async function handleDelete(source) {
    if (!confirm(`Remove "${source}" from the knowledge base?`)) return;
    await deleteSource(source);
    loadSources();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Knowledge Base</h2>

      <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-sm">Sources</p>
          <p className="text-2xl font-bold text-white">{sources.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-sm">Total Chunks</p>
          <p className="text-2xl font-bold text-white">{totalChunks}</p>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <label className={`cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-5 py-2.5 rounded-lg transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? 'Uploading...' : '📎 Upload Files'}
          <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.docx,.md" className="hidden" onChange={handleUpload} />
        </label>
        <button
          onClick={handleIngest}
          disabled={ingesting}
          className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {ingesting ? 'Ingesting...' : '⚡ Ingest KB'}
        </button>
      </div>

      {msg && <p className={`text-sm mb-4 ${msg.includes('failed') ? 'text-red-400' : 'text-yellow-400'}`}>{msg}</p>}

      {log.length > 0 && (
        <div ref={logRef} className="bg-slate-950 border border-slate-800 rounded-lg p-4 mb-6 h-40 overflow-auto font-mono text-xs text-slate-300 space-y-1">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      <div className="space-y-2">
        {sources.length === 0 && <p className="text-slate-500 text-sm">No sources ingested yet.</p>}
        {sources.map(s => (
          <div key={s.source} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
            <div>
              <p className="text-white text-sm font-medium">{s.source}</p>
              <p className="text-slate-500 text-xs">{s.chunks} chunks</p>
            </div>
            <button
              onClick={() => handleDelete(s.source)}
              className="text-slate-500 hover:text-red-400 transition text-sm"
            >
              🗑 Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
