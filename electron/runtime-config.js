'use strict';

function backendOrigin(value, allowLocal = false) {
  const url = new URL(String(value || '').trim());
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = ['localhost', '::1', '127.0.0.1'].includes(host);
  const privateHost = local || host.endsWith('.localhost') || host.endsWith('.local') ||
    /^(0\.|10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^(::|f[cd][0-9a-f]{2}:|fe80:|::ffff:)/.test(host) || !host.includes('.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the server origin, without a path, credentials or query.');
  }
  if (allowLocal && local && ['http:', 'https:'].includes(url.protocol)) return url.origin;
  if (url.protocol !== 'https:' || privateHost) throw new Error('Use a public HTTPS server address.');
  return url.origin;
}

module.exports = { backendOrigin };
