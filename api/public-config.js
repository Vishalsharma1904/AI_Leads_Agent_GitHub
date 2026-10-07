'use strict';

// Only browser-safe authentication settings belong here. The Python backend
// still owns provider credentials, data access and calling.
const defaults = require('../public-auth-config.json');

module.exports = function publicConfig(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ detail: 'Method not allowed' });
  }
  const url = (process.env.SUPABASE_URL || defaults.supabase_url || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || defaults.supabase_publishable_key || '';
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; }
    catch (_) { publicKey = false; }
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !publicKey) {
    return res.status(503).json({ detail: 'Public sign-in configuration is unavailable' });
  }
  return res.status(200).json({
    supabase_url: url,
    supabase_publishable_key: key,
    // The browser chooses its own origin, including approved preview origins.
    supabase_redirect_url: '',
    google_client_id: ''
  });
};
