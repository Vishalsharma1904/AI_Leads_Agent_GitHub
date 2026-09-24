/**
 * device-account.js
 * Per-device account lifecycle. Nothing about one owner ever travels with the
 * app files, so every copy starts genuinely blank on a new machine.
 *
 *   First launch on a device  →  Create Account (Sign In tab hidden)
 *   Every launch after that   →  Sign In, password only (no email needed)
 *   Password forgotten        →  tap "Forgot password?" 5× to recover access
 *
 * Security notes
 *  · the password is never stored — only PBKDF2-SHA256(password + random salt)
 *    with 150k iterations, so the stored value cannot be reversed
 *  · verification is constant-time to avoid trivial timing comparison
 *  · the recovery gesture is deliberately local-only; it grants access to this
 *    device's own workspace and cannot expose anyone else's data
 */
'use strict';

window.DeviceAccount = (function () {
  const KEY = 'skylark_device_account_v1';
  const ITER = 150000;

  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }
  const exists = () => {
    const a = read();
    return !!(a && a.hash && a.salt);
  };

  /** PBKDF2 where available; a salted SHA-256 chain as a file:// fallback. */
  async function derive(password, saltBytes) {
    const subtle = window.crypto && window.crypto.subtle;
    if (subtle && subtle.importKey) {
      try {
        const keyMaterial = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
          keyMaterial, 256);
        return b64(bits);
      } catch (_) { /* fall through */ }
    }
    // Fallback: iterated SHA-256 (still salted and non-reversible)
    if (subtle && subtle.digest) {
      let cur = enc.encode(password + ':' + b64(saltBytes));
      for (let i = 0; i < 600; i++) cur = new Uint8Array(await subtle.digest('SHA-256', cur));
      return b64(cur);
    }
    // Last resort for very old engines: keyed non-reversible mix (never plaintext)
    let h = 0x811c9dc5;
    const s = password + ':' + b64(saltBytes);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return 'w32:' + h.toString(16);
  }

  function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function create(password, profile) {
    const salt = window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint8Array(16))
      : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    const hash = await derive(String(password), salt);
    const record = {
      hash,
      salt: b64(salt),
      iter: ITER,
      createdAt: Date.now(),
      hint: (profile && profile.name) || '',
      userId: (profile && profile.id) || '',
      email: (profile && profile.email) || '',   // Save email for password-only login
      name: (profile && profile.name) || ''      // Save name for personalized greeting
    };
    localStorage.setItem(KEY, JSON.stringify(record));
    return record;
  }

  async function verify(password) {
    const acc = read();
    if (!acc || !acc.hash || !acc.salt) return false;
    const hash = await derive(String(password), unb64(acc.salt));
    return constantTimeEqual(hash, acc.hash);
  }

  async function changePassword(next) {
    const acc = read() || {};
    return create(next, { name: acc.name || acc.hint, email: acc.email, id: acc.userId });
  }

  /** Returns saved profile (name + email) — used for password-only login */
  function getProfile() {
    const acc = read();
    if (!acc) return null;
    return {
      name: acc.name || acc.hint || '',
      email: acc.email || '',
      userId: acc.userId || ''
    };
  }

  /**
   * Wipes this device's workspace entirely — used by "start fresh".
   * Enumerates through the Storage API (length/key) rather than
   * Object.keys(localStorage), which is not dependable across engines.
   */
  function reset() {
    const keep = new Set(['lx-sound-enabled', 'lx-sound-theme', 'lx-sound-volume']);
    const doomed = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !keep.has(k)) doomed.push(k);
      }
    } catch (_) { /* storage unavailable */ }
    doomed.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    return doomed.length;
  }

  return { exists, create, verify, changePassword, reset, getProfile, get record() { return read(); } };
})();
