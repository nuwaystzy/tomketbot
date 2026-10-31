'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const password = new FormData(event.currentTarget).get('password');
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (response.ok) window.location.assign('/admin');
    else {
      setError('Password salah atau dashboard belum dikonfigurasi.');
      setBusy(false);
    }
  }

  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">TOMKET</p><h1>Admin workspace</h1><p>Review garapan, bersihin list, lalu kirim recap.</p>
    <label>Password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy}>{busy ? 'Masuk...' : 'Masuk dashboard'}</button>
  </form></main>;
}
