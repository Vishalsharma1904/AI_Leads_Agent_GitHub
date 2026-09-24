(function () {
  'use strict';
  const tokenKey = 'skylark_session_token';
  const base = () => `${window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000'}/api/v1/google-sheets`;
  const auth = () => {
    const token = sessionStorage.getItem(tokenKey);
    if (!token) throw new Error('Sign in before connecting Google Sheets');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };
  const status = async () => { const r = await fetch(`${base()}/status`, { headers: auth() }); return r.json(); };
  const connect = async () => {
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('nexus_google_pkce_verifier', verifier);
    const clientId = window.SKYLARK_CONFIG?.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Google OAuth is not configured');
    const redirect = `${location.origin}/oauth/google/callback`;
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/spreadsheets')}&code_challenge=${challenge}&code_challenge_method=S256&access_type=offline&prompt=consent`;
  };
  const sync = async (spreadsheetId, rows, range = 'Sheet1!A1') => {
    const r = await fetch(`${base()}/sync`, { method: 'POST', headers: auth(), body: JSON.stringify({ spreadsheet_id: spreadsheetId, range, rows }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || 'Google Sheets sync failed');
    return data;
  };
  async function handleCallback() {
    if (!location.pathname.endsWith('/oauth/google/callback')) return;
    const code = new URLSearchParams(location.search).get('code');
    const verifier = sessionStorage.getItem('nexus_google_pkce_verifier');
    if (!code || !verifier) return;
    try {
      const r = await fetch(`${base()}/connect`, { method: 'POST', headers: auth(), body: JSON.stringify({ code, code_verifier: verifier }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Google Sheets connection failed');
      sessionStorage.removeItem('nexus_google_pkce_verifier');
      history.replaceState({}, '', '/');
      window.showToast?.('success', 'Google Sheets connected', 'Your Sheets access is securely linked.');
    } catch (err) { window.showToast?.('error', 'Google Sheets unavailable', err.message); }
  }
  window.NexusGoogleSheets = { status, connect, sync };
  window.addEventListener('DOMContentLoaded', handleCallback);
})();
