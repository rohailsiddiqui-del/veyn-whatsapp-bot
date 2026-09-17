'use client';
import { useState, useEffect, useRef } from 'react';
import { getKBSources, uploadKBFiles, deleteSource } from '../lib/api';
import { getToken } from '../lib/auth';

export default function BotKBPanel({ botId }) {
  const [sources, setSources] = useState([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestLog, setIngestLog] = useState([]);
  const [uploadMsg, setUploadMsg] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlIngesting, setUrlIngesting] = useState(false);
  const [urlLog, setUrlLog] = useState([]);
  const fileRef = useRef();
  const logRef = useRef();
  const urlLogRef = useRef();

  async function refresh() {
    const data = await getKBSources(botId);
    setSources(data.sources || []);
    setTotalChunks(data.totalChunks || 0);
  }

  useEffect(() => { refresh(); }, [botId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [ingestLog]);

  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadMsg('');
    const r = await uploadKBFiles(botId, files);
    setUploading(false);
    if (r.ok) {
      setUploadMsg(`Uploaded: ${r.files.join(', ')}`);
      fileRef.current.value = '';
    } else {
      setUploadMsg(r.error || 'Upload failed');
    }
  }

  function handleIngest() {
    if (ingesting) return;
    setIngesting(true);
    setIngestLog(['Starting ingest...']);

    const token = getToken() || '';
    const es = new EventSource(`/api/bots/${botId}/kb/ingest?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      if (e.data === '__DONE__') {
        setIngesting(false);
        es.close();
        refresh();
        setIngestLog(prev => [...prev, '--- Done ---']);
      } else {
        setIngestLog(prev => [...prev, e.data]);
      }
    };

    es.onerror = () => {
      setIngesting(false);
      es.close();
      setIngestLog(prev => [...prev, 'Error: connection lost']);
    };
  }

  function handleUrlIngest() {
    if (urlIngesting || !urlInput.trim()) return;
    setUrlIngesting(true);
    setUrlLog(['Fetching and scraping URL...']);

    const token = getToken() || '';
    fetch(`/api/bots/${botId}/kb/ingest-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-portal-token': token },
      body: JSON.stringify({ url: urlInput.trim() }),
    }).then(async (res) => {
      // Response is SSE — read it as a stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const msg = line.slice(6).trim();
            if (msg === '__DONE__') {
              setUrlIngesting(false);
              setUrlInput('');
              refresh();
              setUrlLog(prev => [...prev, '--- Done ---']);
            } else if (msg === '__ERROR__') {
              setUrlIngesting(false);
              setUrlLog(prev => [...prev, '--- Failed ---']);
            } else if (msg) {
              setUrlLog(prev => [...prev, msg]);
            }
          }
        }
      }
    }).catch(e => {
      setUrlIngesting(false);
      setUrlLog(prev => [...prev, 'Error: ' + e.message]);
    });
  }

  async function handleDelete(name) {
    if (!confirm(`Remove "${name}" from KB?`)) return;
    await deleteSource(botId, name);
    refresh();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">Knowledge Base</h2>

      {/* Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Upload Files</h3>
        <p className="text-slate-500 text-xs mb-3">Supported: PDF, Word (.docx), TXT, CSV, MD — max 20MB each</p>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.csv,.md"
            onChange={handleUpload}
            disabled={uploading}
            className="text-slate-400 text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600 disabled:opacity-50"
          />
          {uploading && <span className="text-slate-400 text-sm">Uploading...</span>}
        </div>
        {uploadMsg && (
          <p className={`text-sm mt-2 ${uploadMsg.includes('failed') || uploadMsg.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
            {uploadMsg}
          </p>
        )}
      </div>

      {/* URL Scraper */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">🌐 Add Website URL</h3>
        <p className="text-slate-500 text-xs mb-4">
          Paste any webpage URL — the bot will scrape its text content and add it to the knowledge base automatically.
        </p>
        <div className="flex gap-3">
          <input
            type="url"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlIngest()}
            placeholder="https://yourwebsite.com/about"
            disabled={urlIngesting}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-green-500 disabled:opacity-50"
          />
          <button
            onClick={handleUrlIngest}
            disabled={urlIngesting || !urlInput.trim()}
            className="bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white font-semibold px-5 py-2.5 rounded-lg transition text-sm whitespace-nowrap"
          >
            {urlIngesting ? 'Scraping...' : 'Add URL'}
          </button>
        </div>
        {urlLog.length > 0 && (
          <div
            ref={urlLogRef}
            className="mt-4 bg-slate-950 rounded-lg p-4 text-xs text-slate-400 font-mono h-24 overflow-y-auto"
          >
            {urlLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {/* Ingest */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Ingest KB</h3>
        <p className="text-slate-500 text-xs mb-4">
          Process uploaded files and build the vector store. Do this after uploading new files.
        </p>
        <button
          onClick={handleIngest}
          disabled={ingesting}
          className="bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition"
        >
          {ingesting ? 'Ingesting...' : 'Run Ingest'}
        </button>
        {ingestLog.length > 0 && (
          <div
            ref={logRef}
            className="mt-4 bg-slate-950 rounded-lg p-4 text-xs text-slate-400 font-mono h-40 overflow-y-auto"
          >
            {ingestLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {/* Sources */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300">Knowledge Base Sources</h3>
          <span className="text-slate-500 text-xs">{totalChunks} total chunks</span>
        </div>
        {sources.length === 0 ? (
          <p className="text-slate-500 text-sm">No sources ingested yet. Upload files and run ingest.</p>
        ) : (
          <div className="space-y-2">
            {sources.map(s => (
              <div key={s.source} className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3">
                <div>
                  <p className="text-white text-sm truncate max-w-xs">{s.source}</p>
                  <p className="text-slate-500 text-xs">{s.chunks} chunks</p>
                </div>
                <button
                  onClick={() => handleDelete(s.source)}
                  className="text-slate-500 hover:text-red-400 text-xs transition ml-4"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
