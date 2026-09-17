'use client';
import { useState, useEffect } from 'react';
import { getToken, clearToken } from '../lib/auth';
import Login from '../components/Login';
import BotsPage from '../components/BotsPage';

export default function Home() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!getToken());
  }, []);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <BotsPage onLogout={() => { clearToken(); setAuthed(false); }} />;
}
