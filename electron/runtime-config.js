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
  if (allowLocal && local && ['http:', 'https:'].includes(url.protocol)) {
    // The development API binds IPv4. Windows can resolve localhost to ::1.
    if (host === 'localhost') url.hostname = '127.0.0.1';
    return url.origin;
  }
  if (url.protocol !== 'https:' || privateHost) throw new Error('Use a public HTTPS server address.');
  return url.origin;
}

function serviceConfigURL(value) {
  const url = new URL(String(value || '').trim());
  backendOrigin(url.origin);
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.json')) {
    throw Error('Use a public HTTPS JSON connection file without credentials or query parameters.');
  }
  return url.href;
}

async function discoverWorkspace(value, fetcher = fetch) {
  const response = await fetcher(serviceConfigURL(value), {
    signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store', headers: {Accept:'application/json'}
  });
  if (!response.ok) throw Error('The workspace connection has not been published yet.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 16384) throw Error('Invalid workspace connection file.');
    chunks.push(Buffer.from(chunk));
  }
  const config = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (config?.schema !== 1) throw Error('Unsupported workspace connection file.');
  return backendOrigin(config.backendUrl);
}

module.exports = { backendOrigin, serviceConfigURL, discoverWorkspace };
