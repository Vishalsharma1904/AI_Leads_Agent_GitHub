/* ============================================================
 * clavis-browser.js · Browser action manager & verification
 * ------------------------------------------------------------
 * Handles browser-level operations with structured lifecycle:
 *   REQUESTED → RESOLVING → OPENING → VERIFYING → SUCCESS / FAILED
 *
 * Enforces:
 *   1. Exact entity resolution (e.g., "Rudra24 Secure" -> https://rudra24secure.com)
 *   2. Tab reuse: Reuses and focuses existing opened tabs for the same target
 *   3. Navigation verification: Checks window handles and popup blocker status
 *      instead of blindly hallucinating success.
 *   4. Honest reporting: Tells the user if a popup was blocked or failed.
 * ============================================================ */
(function (root) {
  'use strict';
  if (root.BrowserActionManager) return;

  const tabRegistry = new Map(); // domain/key -> windowProxy or metadata

  const ENTITY_DOMAINS = {
    'rudra24 secure': 'https://rudra24secure.com',
    'rudra24secure': 'https://rudra24secure.com',
    'rudra 24 secure': 'https://rudra24secure.com',
    'rudra24': 'https://rudra24secure.com',
    'rudra 24': 'https://rudra24secure.com',
    'rudra24 jobs': 'https://rudra24jobs.com',
    'rudra24jobs': 'https://rudra24jobs.com',
    'rudra 24 jobs': 'https://rudra24jobs.com',
    'youtube': 'https://youtube.com',
    'gmail': 'https://mail.google.com',
    'google': 'https://google.com',
    'maps': 'https://maps.google.com',
    'whatsapp': 'https://web.whatsapp.com',
    'chatgpt': 'https://chatgpt.com',
    'chatgpt app': 'https://chatgpt.com',
    'chat gpt': 'https://chatgpt.com',
    'claude': 'https://claude.ai',
    'claude ai': 'https://claude.ai',
    'cloud ai': 'https://claude.ai',
    'claude.ai': 'https://claude.ai',
    'google ai studio': 'https://aistudio.google.com',
    'ai studio': 'https://aistudio.google.com',
    'google drive': 'https://drive.google.com',
    'drive': 'https://drive.google.com',
    'gemini': 'https://gemini.google.com',
    'github': 'https://github.com',
    'linkedin': 'https://linkedin.com',
    'spotify': 'https://open.spotify.com'
  };

  function normalizeEntityName(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/^(?:the|open|launch|visit|go to|chalo|kholo|dikhao)\s+/gi, '')
      .replace(/\s+(?:website|web site|site|portal|page|kholo|kar do|kardo|please)$/gi, '')
      .replace(/[.!?,।]+/g, '')
      .trim();
  }

  function resolveUrl(target) {
    const raw = String(target || '').trim();
    if (!raw) return { url: null, entity: '', resolved: false };

    if (/^https?:\/\//i.test(raw)) {
      return { url: raw, entity: raw, resolved: true };
    }

    const norm = normalizeEntityName(raw);

    // Exact entity match
    if (ENTITY_DOMAINS[norm]) {
      return { url: ENTITY_DOMAINS[norm], entity: norm, resolved: true };
    }

    // Substring match for Rudra24 Secure brand
    if (/rudra\s*24\s*jobs/i.test(norm)) {
      return { url: 'https://rudra24jobs.com', entity: 'Rudra24 Jobs', resolved: true };
    }
    if (/rudra\s*24\s*secure/i.test(norm) || /rudra\s*24/i.test(norm)) {
      return { url: 'https://rudra24secure.com', entity: 'Rudra24 Secure', resolved: true };
    }

    // Check PC site aliases if available
    try {
      if (root.ClavisPC?.resolveWebTarget) {
        const u = root.ClavisPC.resolveWebTarget(norm);
        if (u) return { url: u, entity: norm, resolved: true };
      }
    } catch (_) {}

    // Domain format match (e.g. example.com)
    if (/^[\w-]+(?:\.[\w-]+)+(\/.*)?$/i.test(norm)) {
      return { url: `https://${norm}`, entity: norm, resolved: true };
    }

    return { url: null, entity: norm, resolved: false };
  }

  function getDomainKey(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (_) {
      return String(url).toLowerCase();
    }
  }

  const BrowserActionManager = {
    lifecycle: 'IDLE', // REQUESTED, RESOLVING, OPENING, VERIFYING, SUCCESS, FAILED
    lastAction: null,

    resolve(target) {
      this.lifecycle = 'RESOLVING';
      const res = resolveUrl(target);
      return res;
    },

    async openWebsite(target, opts = {}) {
      this.lifecycle = 'REQUESTED';
      const requestedEntity = String(target || '').trim();
      const meta = {
        action: 'OPEN_WEBSITE',
        requestedEntity,
        resolvedUrl: null,
        actualUrl: null,
        verified: false,
        success: false,
        tabReused: false,
        error: null,
        timestamp: Date.now()
      };

      const resolved = this.resolve(requestedEntity);
      if (!resolved.url) {
        // If it cannot be resolved as a direct domain or alias, fallback query
        this.lifecycle = 'FAILED';
        meta.error = `Could not resolve website target for: ${requestedEntity}`;
        this.lastAction = meta;
        return meta;
      }

      meta.resolvedUrl = resolved.url;
      const domainKey = getDomainKey(resolved.url);

      // Check if tab reuse is requested and already open
      const reuse = opts.reuseTab !== false;
      if (reuse && tabRegistry.has(domainKey)) {
        const existing = tabRegistry.get(domainKey);
        if (existing?.win && !existing.win.closed) {
          try {
            existing.win.focus();
            this.lifecycle = 'SUCCESS';
            meta.actualUrl = resolved.url;
            meta.verified = true;
            meta.success = true;
            meta.tabReused = true;
            this.lastAction = meta;
            return meta;
          } catch (_) {
            tabRegistry.delete(domainKey);
          }
        } else {
          tabRegistry.delete(domainKey);
        }
      }

      // Check if native PC bridge is available
      try {
        if (root.ClavisPC?.available?.()) {
          this.lifecycle = 'OPENING';
          const r = await root.ClavisPC.open(resolved.url);
          this.lifecycle = 'VERIFYING';
          if (r && r.ok !== false) {
            this.lifecycle = 'SUCCESS';
            meta.actualUrl = resolved.url;
            meta.verified = true;
            meta.success = true;
            meta.native = true;
            this.lastAction = meta;
            return meta;
          }
        }
      } catch (_) {}

      // Browser-mode open
      this.lifecycle = 'OPENING';
      const tabName = `clavis_tab_${domainKey.replace(/[^a-z0-9]/gi, '_')}`;
      let winProxy = null;
      try {
        winProxy = root.open(resolved.url, tabName);
      } catch (err) {
        this.lifecycle = 'FAILED';
        meta.error = `Navigation error: ${err.message}`;
        this.lastAction = meta;
        return meta;
      }

      this.lifecycle = 'VERIFYING';
      // If window.open returns null or undefined, popup was blocked
      if (!winProxy) {
        this.lifecycle = 'FAILED';
        meta.verified = true;
        meta.success = false;
        meta.error = 'Popup blocker prevented opening the website. Please allow popups for this page.';
        this.lastAction = meta;
        return meta;
      }

      // Sever opener if permitted without dropping the window proxy reference
      try {
        if (winProxy && !winProxy.closed && typeof winProxy.opener !== 'undefined') {
          winProxy.opener = null;
        }
      } catch (_) {}

      // Track open tab for tab-reuse
      tabRegistry.set(domainKey, { win: winProxy, url: resolved.url, openedAt: Date.now() });

      this.lifecycle = 'SUCCESS';
      meta.actualUrl = resolved.url;
      meta.verified = true;
      meta.success = true;
      meta.tabReused = false;
      this.lastAction = meta;
      return meta;
    },

    getLastAction() {
      return this.lastAction;
    },

    clearRegistry() {
      tabRegistry.clear();
    }
  };

  root.BrowserActionManager = BrowserActionManager;
  root.ClavisBrowser = BrowserActionManager;
})(typeof window !== 'undefined' ? window : globalThis);
