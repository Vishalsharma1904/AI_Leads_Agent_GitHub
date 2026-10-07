/* ============================================================
 * clavis-setup.js  ·  "Rudra24 AI ko setup karein" — first-run popup
 * ------------------------------------------------------------
 * One popup, four small steps, everything free:
 *   1. Google AI Studio key  (recommended — real voice + brain + live talk)
 *   2. Groq key              (optional — fast replies + voice typing)
 *   3. OpenRouter key        (optional — backup free models)
 *   4. Mic permission
 *
 * Key flow: "Free key banaiye ↗" opens the provider's key page. When the
 * window gets focus back, the clipboard is read once (if the browser
 * allows) and a freshly copied key is FILLED in. Pasting does the same.
 * Nothing is saved until "Check & Save" (or Enter).
 *
 * Check & Save: list-models call (free) → invalid = not saved; otherwise
 * saved, then (Gemini) one 1-token generateContent tells working / quota
 * gone / invalid honestly. Keys go into ClavisKeyVault (encrypted) plus a
 * best-effort copy to the local backend; only masks like AIza…9xQ2 shown.
 *
 * API:  window.ClavisSetup = { open(opts), close(), maybeAutoOpen(), status(), saveKey(provider, key) }
 *   open({ reason: 'voice' | 'refuel' | 'manual', provider: 'gemini' | 'groq' | 'openrouter', prefill })
 *   saveKey → Promise<{ saved, status: 'ok'|'quota'|'invalid'|'unknown', message, mask }>
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisSetup) return;

  var doc = document;
  var LS = {
    snooze: 'clavis_setup_snooze_until',
    refuelAt: 'clavis_setup_refuel_opened_at',
    spent: 'clavis_live_spent',
    fallback: 'clavis_provider_keys',
    mic: 'clavis_mic_permission_granted'
  };
  var SNOOZE_MS = 24 * 3600e3;
  var REFUEL_GAP_MS = 30 * 60e3;
  var CHECK_TIMEOUT_MS = 9000;

  var PROVIDERS = {
    gemini: {
      label: 'Google AI Studio',
      title: 'Google AI Studio key',
      tag: 'Recommended',
      desc: 'Natural voice and live conversations.',
      link: 'https://aistudio.google.com/apikey',
      linkText: 'Create a free key',
      prefix: 'AIza',
      /* AI Studio now hands out two shapes: the classic "AIza…" and the
         newer "AQ.…". Both are valid keys — accept either. */
      prefixes: ['AIza', 'AQ.'],
      rx: /AIza[0-9A-Za-z_\-]{30,}|AQ\.[0-9A-Za-z_\-.]{20,}/,
      steps: ['Select “Create API key”', 'Copy the key', 'Paste it here'],
      placeholder: 'Paste AIza… or AQ.… key here',
      icon: 'spark'
    },
    groq: {
      label: 'Groq',
      title: 'Groq key',
      tag: 'Recommended',
      desc: 'Rudra thinks and hears with this one.',
      link: 'https://console.groq.com/keys',
      linkText: 'Create a Groq key',
      prefix: 'gsk_',
      rx: /gsk_[0-9A-Za-z]{20,}/,
      steps: ['Select “Create API Key”', 'Copy the key', 'Paste it here'],
      placeholder: 'Paste gsk_… key here',
      icon: 'bolt'
    },
    openrouter: {
      label: 'OpenRouter',
      title: 'OpenRouter key',
      tag: 'Optional',
      desc: 'Backup models if another key reaches its limit.',
      link: 'https://openrouter.ai/keys',
      linkText: 'Create an OpenRouter key',
      prefix: 'sk-or-',
      rx: /sk-or-[0-9A-Za-z_\-]{20,}/,
      steps: ['Select “Create Key”', 'Copy the key', 'Paste it here'],
      placeholder: 'Paste sk-or-… key here',
      icon: 'route'
    }
  };
  PROVIDERS.cartesia = {
    label: 'Cartesia', title: 'Voice key', tag: 'Voice',
    desc: "Rudra's speaking voice — Hindi and English, with feeling.",
    link: 'https://play.cartesia.ai/keys', linkText: 'Create a Cartesia key',
    prefix: 'sk_car_', rx: /[^\s]{20,}/,
    steps: ['Create an API key', 'Copy the key', 'Check & Save'],
    placeholder: 'Paste the Cartesia key here', icon: 'bolt'
  };
  PROVIDERS.apify = {
    label: 'Apify', title: 'Apify lead sourcing key', tag: 'Faster sourcing',
    desc: 'Faster Maps leads. Public search works without a token.',
    link: 'https://console.apify.com/settings/integrations', linkText: 'Create an Apify token',
    prefix: 'apify_api_', rx: /apify_api_[0-9A-Za-z_\-]{20,}/,
    steps: ['Create an API token', 'Copy the token', 'Check & Save'], placeholder: 'apify_api_…', icon: 'route'
  };
  PROVIDERS.sarvam = { label: 'Sarvam', title: 'Sarvam API key', tag: 'Calling', desc: 'Voice key for the calling agent.', link: 'https://dashboard.sarvam.ai/', linkText: 'Sarvam dashboard', prefix: '', rx: /[^\s]{20,}/, steps: ['Create an API key', 'Copy the key', 'Check & Save'], placeholder: 'Sarvam API key', icon: 'route' };
  /* Three keys do the work now: Groq thinks, Cartesia speaks, Apify
     sources. They stay open on the page. Google AI Studio is gone from the
     list entirely — billing made it mandatory-paid and it is switched off
     app-wide, so a card asking for it was asking for an error. Everything
     else, including the spare LLM providers, folds into the drawer. */
  var ORDER = ['groq', 'cartesia', 'apify', 'openrouter', 'sarvam'];
  // What he actually needs, open on the page. Everything added below this
  // line is a spare LLM provider and lives in a folded drawer — fourteen
  // identical full-size cards was the "sab bada bada hai" problem.
  var PRIMARY = ['groq', 'cartesia', 'apify'];
  [
    ['openai', 'OpenAI', 'https://platform.openai.com/api-keys'],
    ['deepseek', 'DeepSeek', 'https://platform.deepseek.com/api_keys'],
    ['mistral', 'Mistral', 'https://console.mistral.ai/'],
    ['together', 'Together', 'https://api.together.ai/'],
    ['fireworks', 'Fireworks', 'https://fireworks.ai/'],
    ['xai', 'xAI', 'https://console.x.ai/'],
    ['cerebras', 'Cerebras', 'https://cloud.cerebras.ai/'],
    ['perplexity', 'Perplexity', 'https://www.perplexity.ai/settings/api'],
    ['toughtongue', 'Tough Tongue', 'https://app.toughtongueai.com/']
  ].forEach(function (entry) {
    PROVIDERS[entry[0]] = { label: entry[1], title: entry[1] + ' API key', tag: 'Optional',
      desc: 'Save the account key in the secure vault.', link: entry[2], linkText: 'Provider dashboard',
      prefix: '', rx: /[^\s]{20,}/, steps: ['Create an API key', 'Copy the key', 'Check & Save'], placeholder: 'API key', icon: 'route' };
    ORDER.push(entry[0]);
  });
  var EXTRA = ORDER.filter(function (p) { return PRIMARY.indexOf(p) === -1; });

  var S = {
    root: null, dialog: null, isOpen: false, lastFocus: null, closeTimer: 0,
    linkClicked: {}, busy: {}, lastClip: '', clipTimer: 0,
    mic: 'unknown', micPerm: null,
    autoTries: 0, pillTimer: 0
  };

  /* ── tiny helpers ──────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }
  function fire(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail: detail })); } catch (_) {}
  }

  /** "AIzaSy…9xQ2" style mask — the secret itself is never rendered. */
  function mask(key, provider) {
    var s = String(key || '');
    if (!s) return '';
    var info = PROVIDERS[provider];
    var pres = info ? (info.prefixes || (info.prefix ? [info.prefix] : [])) : [];
    var pre = s.slice(0, 4);
    for (var i = 0; i < pres.length; i++) { if (s.indexOf(pres[i]) === 0) { pre = pres[i]; break; } }
    return pre + '…' + s.slice(-4);
  }
  function tidyVaultMask(m) { return String(m || '').replace(/•+/g, '…'); }

  function icon(name, size) {
    // Minimal look: sirf kaam ke glyphs (close, chevron, eye). Decorative icons nahi.
    if (!/^(x|chev|eye|eyeOff)$/.test(name)) return '';
    size = size || 18;
    var featherName = { x: 'x', chev: 'chevron-down', eye: 'eye', eyeOff: 'eye-off' }[name];
    if (window.ClavisIcons && featherName) {
      return window.ClavisIcons.svg(featherName).replace('class="fi"', 'class="cx-setup-svg" width="' + size + '" height="' + size + '"');
    }
    var P = {
      spark: '<path d="M12 3.5l1.7 4.6a2 2 0 0 0 1.2 1.2l4.6 1.7-4.6 1.7a2 2 0 0 0-1.2 1.2L12 18.5l-1.7-4.6a2 2 0 0 0-1.2-1.2L4.5 11l4.6-1.7a2 2 0 0 0 1.2-1.2z"/><path d="M19 3v3M17.5 4.5h3"/>',
      bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
      route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
      mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
      out: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
      eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
      eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.4 6.9A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4.1-.9"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2"/>',
      x: '<path d="M6 6l12 12M18 6 6 18"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      chev: '<path d="M6 9l6 6 6-6"/>',
      warn: '<path d="M12 8.5v4.5M12 16.5h.01"/><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>'
    };
    return '<svg class="cx-setup-svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (P[name] || '') + '</svg>';
  }
  var DRAWN_CHECK = '';
  var DRAWN_CHECK_OLD = '<svg class="cx-setup-drawn" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle class="cx-setup-drawn-ring" cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path class="cx-setup-drawn-tick" d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ── what is already connected ─────────────────────────────── */
  function vault() { return window.ClavisKeyVault; }
  function vaultStatus() { try { return vault() && vault().status ? vault().status() : null; } catch (_) { return null; } }

  function providerState(provider) {
    // Apify lives in this browser, not the server vault — so it reports
    // connected whether or not a backend is up or he is signed in.
    if (provider === 'apify' && window.ApifyLeads) {
      var on = window.ApifyLeads.hasToken();
      return { connected: on, state: on ? 'live' : 'empty', mask: on ? window.ApifyLeads.mask() : '', count: on ? 1 : 0 };
    }
    if (!window.SupabaseAuth?.getAccessToken?.()) return { connected: false, state: 'empty', mask: '', count: 0 };
    var vs = vaultStatus();
    var p = vs && vs.providers && vs.providers[provider];
    if (p && p.count > 0) {
      return { connected: true, state: p.state === 'spent' ? 'spent' : 'live', mask: tidyVaultMask(p.masks && p.masks[0]), count: p.count };
    }
    return { connected: false, state: 'empty', mask: '', count: 0 };
  }

  function status() {
    var out = {};
    ORDER.forEach(function (p) { out[p] = providerState(p); });
    out.mic = micState();
    out.ready = out.groq.connected;   // Groq is the brain now
    out.anyKey = ORDER.some(function (p) { return out[p].connected; });
    out.snoozedUntil = Number(lsGet(LS.snooze)) || 0;
    out.open = S.isOpen;
    return out;
  }

  function micState() {
    if (S.mic === 'granted' || S.mic === 'denied') return S.mic;
    if (lsGet(LS.mic) === 'true') return 'granted';
    return S.mic === 'prompt' ? 'prompt' : 'unknown';
  }
  function watchMicPermission() {
    if (S.micPerm || !navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: 'microphone' }).then(function (perm) {
      S.micPerm = perm;
      S.mic = perm.state;
      if (perm.state === 'granted') lsSet(LS.mic, 'true');
      perm.onchange = function () { S.mic = perm.state; if (perm.state === 'granted') lsSet(LS.mic, 'true'); render(); };
      render();
    }).catch(function () {});
  }

  /* ── verification ──────────────────────────────────────────── */
  function fetchWithTimeout(url, init, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { try { ctl && ctl.abort(); } catch (_) {} }, ms || CHECK_TIMEOUT_MS);
    init = init || {};
    if (ctl) init.signal = ctl.signal;
    return fetch(url, init).finally(function () { clearTimeout(t); });
  }
  function saveKey(provider, raw) {
    if (!PROVIDERS[provider]) return Promise.resolve({ saved: false, status: 'invalid', message: 'Unknown provider.' });
    var info = PROVIDERS[provider];
    var key = extractKey(provider, raw);
    if (!key || !info.rx.test(key) || key.length < 20) {
      /* Says WHAT is in the field, so a truncated paste or a browser-autofilled
         password is obvious instead of looking like a rejected key. */
      var pres = info.prefixes || (info.prefix ? [info.prefix] : []);
      var wrongPrefix = pres.length && !pres.some(function (x) { return key.indexOf(x) === 0; });
      var why = !key ? 'the field is empty'
        : wrongPrefix
          ? 'it starts with "' + key.slice(0, 4) + '…" instead of "' + pres.join('" or "') + '"'
          : 'only ' + key.length + ' characters came through';
      return Promise.resolve({ saved: false, status: 'invalid',
        message: 'That does not look like a complete ' + info.label + ' API key — ' + why + '. Clear the field (eye icon to see it) and paste the key again.' });
    }

    /* Apify is the one key the BROWSER itself has to use: api.apify.com is
       called straight from this page, so the server vault — which never
       hands a secret back — cannot supply it. It is checked against Apify
       and kept in this browser, and still mirrored to the vault when a
       backend happens to be up. */
    if (provider === 'apify' && window.ApifyLeads) {
      return window.ApifyLeads.verify(key).then(function (v) {
        if (!v.ok) {
          return { saved: false, status: 'invalid',
            message: v.reason === 'unauthorized'
              ? 'Apify rejected this token. Copy a new one from the console.'
              : 'Could not reach Apify. Check your connection and retry.' };
        }
        window.ApifyLeads.setToken(key);
        try { window.ClavisKeyVault && window.ClavisKeyVault.add('apify', key).catch(function () {}); } catch (_) {}
        fire('clavis:keys-ready', { provider: 'apify', status: 'ok' });
        return { saved: true, status: 'ok', mask: window.ApifyLeads.mask(),
          message: 'Apify connected' + (v.username ? ' (' + v.username + ')' : '') + '. Leads can now use Apify.' };
      });
    }

    if (!window.ClavisKeyVault) return Promise.resolve({ saved: false, status: 'unknown', message: 'Key vault is not ready yet.' });
    return window.ClavisKeyVault.add(provider, key).then(function () {
      fire('clavis:keys-ready', { provider: provider, status: 'ok' });
      return { saved: true, status: 'ok', message: info.label + ' saved in your encrypted server vault.', mask: 'Server vault' };
    }).catch(function (error) {
      return { saved: false, status: 'unknown', message: error.message || 'Could not save the key.' };
    });
  }

  /* ── check + save, with inline states ──────────────────────── */
  function extractKey(provider, raw) {
    var s = String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '');
    var m = s.match(PROVIDERS[provider].rx);
    return m ? m[0] : s.replace(/\s+/g, '');
  }

  function setMsg(provider, tone, html) {
    var el = S.root && S.root.querySelector('[data-msg="' + provider + '"]');
    if (!el) return;
    el.setAttribute('data-tone', tone || '');
    el.innerHTML = html || '';
    el.hidden = !html;
  }

  function setBusy(provider, on) {
    S.busy[provider] = !!on;
    var card = S.root && S.root.querySelector('[data-card="' + provider + '"]');
    if (!card) return;
    card.classList.toggle('is-busy', !!on);
    var btn = card.querySelector('[data-act="save"]');
    if (btn) { btn.disabled = !!on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
  }

  /** A copied provider key fills this one field; validation still runs before saving. */
  function fillKey(provider, raw) {
    var input = S.root && S.root.querySelector('[data-input="' + provider + '"]');
    var m = String(raw || '').match(PROVIDERS[provider].rx);
    if (!input || !m) return false;
    input.value = m[0];
    setMsg(provider, 'info', icon('info', 15) + '<span>Key found. Checking…</span>');
    return true;
  }

  function checkAndSave(provider) {
    if (S.busy[provider]) return Promise.resolve(false);
    var info = PROVIDERS[provider];
    var input = S.root && S.root.querySelector('[data-input="' + provider + '"]');
    var raw = input ? input.value : '';
    if (!extractKey(provider, raw)) {
      setMsg(provider, 'bad', icon('info', 15) + '<span>Paste a key first.</span>');
      input && input.focus();
      return Promise.resolve(false);
    }
    // No "already linked, do nothing" shortcut — re-applying the same key
    // (say, after its quota resets) must re-check it and clear "Quota khatam".
    setBusy(provider, true);
    setMsg(provider, 'busy', '<span class="cx-setup-spin" aria-hidden="true"></span><span>Checking ' + esc(info.label) + '…</span>');

    return saveKey(provider, raw).then(function (r) {
      if (!r.saved) {
        setMsg(provider, 'bad', icon('warn', 15) + '<span>' + esc(r.message) + '</span>');
        var card = S.root && S.root.querySelector('[data-card="' + provider + '"]');
        if (card && !reducedMotion()) { card.classList.remove('is-shake'); void card.offsetWidth; card.classList.add('is-shake'); }
        return false;
      }
      if (input) {
        input.value = '';
        input.type = 'password';
        syncEye(provider);   // render() below shows the saved mask as the placeholder
      }
      render();
      setMsg(provider, r.status === 'ok' ? 'ok' : 'warn', (r.status === 'ok' ? DRAWN_CHECK : icon('info', 15)) + '<span>' + esc(r.message) + '</span>');
      S.linkClicked[provider] = false;
      return true;
    }).catch(function () {
      setMsg(provider, 'bad', icon('warn', 15) + '<span>Could not save the key. Please retry.</span>');
      return false;
    }).then(function (ok) { setBusy(provider, false); return ok; });
  }

  /* ── clipboard pickup when he comes back from the key page ─── */
  function onReturn() {
    if (!S.isOpen || doc.visibilityState === 'hidden') return;
    if (!ORDER.some(function (p) { return S.linkClicked[p]; })) return;
    clearTimeout(S.clipTimer);
    S.clipTimer = setTimeout(pickupClipboard, 260);
  }
  function pickupClipboard() {
    if (!S.isOpen || !navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(function (text) {
      text = String(text || '').trim();
      if (!text || text === S.lastClip) return;
      for (var i = 0; i < ORDER.length; i++) {
        var p = ORDER[i];
        if (!S.linkClicked[p] || S.busy[p]) continue;
        var m = text.match(PROVIDERS[p].rx);
        if (!m) continue;
        S.lastClip = text;
        expand(p, true);
        if (fillKey(p, m[0])) checkAndSave(p);
        return;
      }
    }).catch(function () { /* permission denied / not focused — he can paste by hand */ });
  }

  /* ── mic ───────────────────────────────────────────────────── */
  function askMic() {
    var btn = S.root && S.root.querySelector('[data-act="mic"]');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg('mic', 'bad', icon('warn', 15) + '<span>Microphone needs localhost or HTTPS.</span>');
      return Promise.resolve(false);
    }
    if (btn) btn.disabled = true;
    setMsg('mic', 'busy', '<span class="cx-setup-spin" aria-hidden="true"></span><span>Browser pooch raha hai — “Allow” dabaiye…</span>');
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
      S.mic = 'granted';
      lsSet(LS.mic, 'true');
      fire('clavis:mic-granted');
      render();
      setMsg('mic', 'ok', DRAWN_CHECK + '<span>Microphone ready. You can talk now.</span>');
      return true;
    }).catch(function (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        S.mic = 'denied';
        var micHelp = location.port === '3210'
          ? 'Enable desktop app microphone access in Windows Settings, then try again.'
          : 'Allow microphone in site settings, reload the page, then try again.';
        setMsg('mic', 'bad', icon('warn', 15) + '<span>' + micHelp + '</span>');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setMsg('mic', 'bad', icon('warn', 15) + '<span>No microphone found. Connect one and retry.</span>');
      } else if (name === 'NotReadableError') {
        setMsg('mic', 'bad', icon('warn', 15) + '<span>Another app is using the microphone. Close it and retry.</span>');
      } else {
        setMsg('mic', 'bad', icon('warn', 15) + '<span>Could not access the microphone. Please retry.</span>');
      }
      render();
      return false;
    }).then(function (ok) { if (btn) btn.disabled = false; return ok; });
  }

  /* ── markup ────────────────────────────────────────────────── */
  function keyCard(p, idx) {
    var info = PROVIDERS[p];
    var bodyId = 'cx-setup-body-' + p;
    var steps = info.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '' +
      '<section class="cx-setup-card" data-card="' + p + '" style="--cx-i:' + idx + '">' +
        '<button type="button" class="cx-setup-head" data-act="toggle" data-p="' + p + '" aria-expanded="false" aria-controls="' + bodyId + '">' +
          '<span class="cx-setup-titles">' +
            '<span class="cx-setup-name">' + esc(info.title) +
              '<span class="cx-setup-tag' + (p === 'groq' ? ' is-rec' : '') + '">' + esc(info.tag) + '</span></span>' +
            '<span class="cx-setup-desc" data-desc="' + p + '">' + esc(info.desc) + '</span>' +
          '</span>' +
          '<span class="cx-setup-chip" data-chip="' + p + '" data-tone="idle">Not set</span>' +
          '<span class="cx-setup-chev">' + icon('chev', 16) + '</span>' +
        '</button>' +
        '<div class="cx-setup-body" id="' + bodyId + '" data-body="' + p + '" hidden>' +
          '<div class="cx-setup-body-in">' +
            '<div class="cx-setup-get">' +
              '<button type="button" class="cx-setup-btn cx-setup-btn--link" data-act="link" data-p="' + p + '">' +
                esc(info.linkText) + ' <span aria-hidden="true">↗</span></button>' +
              '<ol class="cx-setup-mini" aria-label="How to connect">' + steps + '</ol>' +
            '</div>' +
            '<div class="cx-setup-field">' +
              '<div class="cx-setup-inwrap">' +
                '<input class="cx-setup-input" data-input="' + p + '" type="password" inputmode="text" autocomplete="new-password" name="cx-setup-' + p + '-key" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
                'data-lpignore="true" data-1p-ignore aria-label="Paste ' + esc(info.title) + '" placeholder="' + esc(info.placeholder) + '">' +
                '<button type="button" class="cx-setup-eye" data-act="eye" data-p="' + p + '" aria-label="Show key" aria-pressed="false">' + icon('eye', 17) + '</button>' +
              '</div>' +
              '<button type="button" class="cx-setup-btn cx-setup-btn--primary" data-act="save" data-p="' + p + '">' +
                '<span class="cx-setup-btn-spin" aria-hidden="true"></span><span class="cx-setup-btn-label">Check &amp; Save</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="cx-setup-msg" data-msg="' + p + '" role="status" aria-live="polite" hidden></p>' +
      '</section>';
  }

  function build() {
    if (S.root) return S.root;
    var root = doc.createElement('div');
    root.id = 'cx-setup-root';
    root.className = 'cx-setup-root';
    root.hidden = true;
    root.innerHTML = '' +
      '<div class="cx-setup-backdrop" data-act="backdrop"></div>' +
      '<div class="cx-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="cx-setup-title" aria-describedby="cx-setup-sub" tabindex="-1">' +
        '<header class="cx-setup-top">' +
          '<div class="cx-setup-heading">' +
            '<h2 id="cx-setup-title">Set up Rudra24 AI</h2>' +
            '<p id="cx-setup-sub">AI and lead sourcing keys in one place.</p>' +
          '</div>' +
          '<button type="button" class="cx-setup-x" data-act="close" aria-label="Close">' + icon('x', 18) + '</button>' +
        '</header>' +
        '<div class="cx-setup-scroll">' +
          '<div class="cx-setup-banner" data-banner hidden></div>' +
          PRIMARY.map(keyCard).join('') +
          '<section class="cx-setup-card cx-setup-card--mic" data-card="mic" style="--cx-i:3">' +
            '<div class="cx-setup-head cx-setup-head--static">' +
              '<span class="cx-setup-titles">' +
                '<span class="cx-setup-name">Microphone access</span>' +
                '<span class="cx-setup-desc">Talk to Rudra24 AI using your voice.</span>' +
              '</span>' +
              '<span class="cx-setup-chip" data-chip="mic" data-tone="idle">Not set</span>' +
            '</div>' +
            '<div class="cx-setup-microw">' +
              '<button type="button" class="cx-setup-btn cx-setup-btn--soft" data-act="mic">' + icon('mic', 15) + '<span data-mic-label>Allow microphone</span></button>' +
            '</div>' +
            '<p class="cx-setup-msg" data-msg="mic" role="status" aria-live="polite" hidden></p>' +
          '</section>' +
          (EXTRA.length
            ? '<div class="cx-setup-group">' +
                '<button type="button" class="cx-setup-grouphead" data-act="group" aria-expanded="false" aria-controls="cx-setup-extra">' +
                  '<span class="cx-setup-groupname">More AI providers</span>' +
                  '<span class="cx-setup-groupn" data-groupn>' + EXTRA.length + '</span>' +
                  '<span class="cx-setup-chev">' + icon('chev', 16) + '</span>' +
                '</button>' +
                '<div class="cx-setup-grouplist" id="cx-setup-extra" data-grouplist hidden>' +
                  '<div class="cx-setup-grouplist-in">' + EXTRA.map(keyCard).join('') + '</div>' +
                '</div>' +
              '</div>'
            : '') +
        '</div>' +
        '<footer class="cx-setup-foot">' +
          '<p class="cx-setup-hint">Say <b>“Rudra”</b>, <b>“Hey Buddy”</b> or <b>“Hey Clay”</b> to start talking.</p>' +
          '<div class="cx-setup-actions">' +
            '<button type="button" class="cx-setup-btn cx-setup-btn--ghost" data-act="purge-legacy">Remove old device keys</button>' +
            '<button type="button" class="cx-setup-btn cx-setup-btn--ghost" data-act="later">Later</button>' +
            '<button type="button" class="cx-setup-btn cx-setup-btn--primary cx-setup-btn--done" data-act="done">Done</button>' +
          '</div>' +
        '</footer>' +
      '</div>';
    doc.body.appendChild(root);
    S.root = root;
    S.dialog = root.querySelector('.cx-setup-dialog');
    wire(root);
    return root;
  }

  function wire(root) {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      var act = t.getAttribute('data-act');
      var p = t.getAttribute('data-p');
      if (act === 'purge-legacy') {
        if (!window.confirm('Remove legacy API keys from this browser? Keys saved on the backend will remain. Any key not saved there must be entered again.')) return;
        t.disabled = true;
        return window.ClavisKeyVault.purgeLegacy().then(function () { t.textContent = 'Old device keys removed'; })
          .catch(function (error) { window.alert(error.message); }).finally(function () { t.disabled = false; });
      }
      if (act === 'backdrop' || act === 'close' || act === 'done') return close();
      if (act === 'later') { lsSet(LS.snooze, String(Date.now() + SNOOZE_MS)); return close(); }
      if (act === 'toggle') {
        var opening = t.getAttribute('aria-expanded') !== 'true';
        // Accordion: one card open at a time. Fourteen cards all unfolded
        // is the wall of boxes, not a settings screen.
        if (opening) {
          ORDER.forEach(function (other) { if (other !== p) expand(other, false); });
        }
        return expand(p, opening);
      }
      if (act === 'group') return expandGroup(t.getAttribute('aria-expanded') !== 'true');
      if (act === 'link') {
        S.linkClicked[p] = true;
        S.lastClip = '';
        try { window.open(PROVIDERS[p].link, '_blank', 'noopener,noreferrer'); } catch (_) {}
        setMsg(p, 'info', icon('info', 15) + '<span>Copy your key, then return here and paste it.</span>');
        return;
      }
      if (act === 'eye') {
        var input = root.querySelector('[data-input="' + p + '"]');
        if (input) { input.type = input.type === 'password' ? 'text' : 'password'; syncEye(p); input.focus(); }
        return;
      }
      if (act === 'save') return checkAndSave(p);
      if (act === 'mic') return askMic();
    });
    root.addEventListener('paste', function (e) {
      var input = e.target.closest && e.target.closest('[data-input]');
      if (!input) return;
      var p = input.getAttribute('data-input');
      setTimeout(function () { if (fillKey(p, input.value)) checkAndSave(p); }, 0);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var input = e.target.closest && e.target.closest('[data-input]');
        if (input) { e.preventDefault(); checkAndSave(input.getAttribute('data-input')); }
      }
    });
    root.addEventListener('input', function (e) {
      var input = e.target.closest && e.target.closest('[data-input]');
      if (input) {
        var p = input.getAttribute('data-input');
        var msg = root.querySelector('[data-msg="' + p + '"]');
        if (msg && msg.getAttribute('data-tone') === 'bad') setMsg(p, '', '');
      }
    });
    root.addEventListener('animationend', function (e) {
      if (e.animationName === 'cx-setup-shake') e.target.classList.remove('is-shake');
    });
  }

  function syncEye(p) {
    var input = S.root && S.root.querySelector('[data-input="' + p + '"]');
    var eye = S.root && S.root.querySelector('[data-act="eye"][data-p="' + p + '"]');
    if (!input || !eye) return;
    var shown = input.type === 'text';
    eye.setAttribute('aria-pressed', shown ? 'true' : 'false');
    eye.setAttribute('aria-label', shown ? 'Hide key' : 'Show key');
    eye.innerHTML = icon(shown ? 'eyeOff' : 'eye', 17);
  }

  /* ── one smooth slide, used by every disclosure in this dialog ──
     The old version flipped `hidden`, so a card snapped open with a
     jolt that moved every card below it. This lays the body out once
     and animates its height + a short lift on the content, with a
     quicker exit than entrance — the same asymmetry the floating
     window uses, which is what reads as calm instead of sluggish. */
  var SLIDE_EASE = 'cubic-bezier(.16, 1, .3, 1)';
  function slide(box, on, instant) {
    if (!box) return;
    if (box._slide) { try { box._slide.cancel(); } catch (_) {} box._slide = null; }
    if (instant || reducedMotion() || !box.animate) {
      box.hidden = !on; box.style.removeProperty('overflow'); return;
    }
    if (on) {
      if (!box.hidden && !box._slideClosing) { box.hidden = false; return; }
      box.hidden = false;
      box.style.overflow = 'hidden';
      var h = box.scrollHeight;
      var inner = box.firstElementChild;
      var a = box.animate(
        [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }],
        { duration: 380, easing: SLIDE_EASE, fill: 'both' });
      if (inner) {
        try {
          inner.animate([{ transform: 'translateY(-6px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 420, delay: 60, easing: SLIDE_EASE, fill: 'backwards' });
        } catch (_) {}
      }
      box._slide = a; box._slideClosing = false;
      a.onfinish = function () {
        if (box._slide !== a) return;
        box._slide = null; box.style.removeProperty('overflow');
        try { a.cancel(); } catch (_) {}
      };
    } else {
      if (box.hidden) return;
      box.style.overflow = 'hidden';
      var h0 = box.scrollHeight;
      var b = box.animate(
        [{ height: h0 + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'both' });
      box._slide = b; box._slideClosing = true;
      b.onfinish = function () {
        if (box._slide !== b) return;
        box._slide = null; box._slideClosing = false;
        box.hidden = true; box.style.removeProperty('overflow');
        try { b.cancel(); } catch (_) {}
      };
    }
  }

  function expand(p, on, instant) {
    if (!S.root || !PROVIDERS[p]) return;
    var head = S.root.querySelector('[data-act="toggle"][data-p="' + p + '"]');
    var body = S.root.querySelector('[data-body="' + p + '"]');
    var card = S.root.querySelector('[data-card="' + p + '"]');
    if (!head || !body) return;
    head.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (card) card.classList.toggle('is-open', !!on);
    slide(body, !!on, instant);
    // Opening a card inside the folded "more providers" drawer is useless
    // if the drawer itself is shut.
    if (on) {
      var group = card && card.closest('[data-grouplist]');
      if (group && group.hidden) expandGroup(true, instant);
    }
  }

  function expandGroup(on, instant) {
    if (!S.root) return;
    var head = S.root.querySelector('[data-act="group"]');
    var list = S.root.querySelector('[data-grouplist]');
    if (!head || !list) return;
    head.setAttribute('aria-expanded', on ? 'true' : 'false');
    slide(list, !!on, instant);
  }

  /* ── state → UI ────────────────────────────────────────────── */
  function render() {
    updatePill();
    if (!S.root) return;
    var st = status();
    var done = 0;
    ORDER.forEach(function (p) {
      var s = st[p];
      var chip = S.root.querySelector('[data-chip="' + p + '"]');
      var desc = S.root.querySelector('[data-desc="' + p + '"]');
      var card = S.root.querySelector('[data-card="' + p + '"]');
      if (s.connected && s.state !== 'spent') done++;
      if (chip) {
        if (!s.connected) { chip.textContent = 'Not set'; chip.setAttribute('data-tone', 'idle'); }
        else if (s.state === 'spent') { chip.textContent = 'Limit reached'; chip.setAttribute('data-tone', 'warn'); }
        else { chip.textContent = 'Connected'; chip.setAttribute('data-tone', 'ok'); }
      }
      if (desc) {
        desc.textContent = s.connected && s.mask
          ? (s.count > 1 ? s.mask + '  ·  ' + s.count + ' keys' : s.mask)
          : PROVIDERS[p].desc;
        desc.classList.toggle('is-mask', !!(s.connected && s.mask));
      }
      if (card) card.setAttribute('data-state', s.connected ? s.state : 'empty');
      var input = S.root.querySelector('[data-input="' + p + '"]');
      var ph = s.connected && s.mask ? 'Saved: ' + s.mask + ' — paste a new key to replace it' : PROVIDERS[p].placeholder;
      if (input && input.placeholder !== ph) input.placeholder = ph;
    });
    var mic = st.mic;
    var micChip = S.root.querySelector('[data-chip="mic"]');
    var micCard = S.root.querySelector('[data-card="mic"]');
    var micLabel = S.root.querySelector('[data-mic-label]');
    if (mic === 'granted') done++;
    if (micChip) {
      micChip.textContent = mic === 'granted' ? 'Allowed' : mic === 'denied' ? 'Blocked' : 'Not set';
      micChip.setAttribute('data-tone', mic === 'granted' ? 'ok' : mic === 'denied' ? 'bad' : 'idle');
    }
    if (micCard) micCard.setAttribute('data-state', mic);
    if (micLabel) micLabel.textContent = mic === 'denied' ? 'Check permission again' : mic === 'granted' ? 'Check microphone again' : 'Allow microphone';
    var bars = S.root.querySelectorAll('.cx-setup-progress span');
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('is-on', i < done);

    var groupN = S.root.querySelector('[data-groupn]');
    if (groupN) {
      var on = EXTRA.filter(function (p) { return st[p] && st[p].connected; }).length;
      groupN.textContent = on ? on + ' connected' : String(EXTRA.length);
      groupN.setAttribute('data-tone', on ? 'ok' : 'idle');
    }

    var sub = S.root.querySelector('#cx-setup-sub');
    if (sub) {
      sub.textContent = st.groq.connected && st.apify.connected && mic === 'granted'
        ? 'All set for conversation and lead sourcing.'
        : st.groq.connected && mic === 'granted'
          ? 'Conversation is ready. An Apify token speeds up lead search.'
          : 'AI and lead sourcing keys in one place.';
    }
  }

  /* ── open / close ──────────────────────────────────────────── */
  function focusables() {
    if (!S.dialog) return [];
    return Array.prototype.filter.call(
      S.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === doc.activeElement; }
    );
  }
  function onKey(e) {
    if (!S.isOpen || e.target.closest?.('.rudra-select-menu')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) { e.preventDefault(); S.dialog.focus(); return; }
    var first = f[0], last = f[f.length - 1];
    var inside = S.dialog.contains(doc.activeElement);
    if (e.shiftKey && (doc.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (doc.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }

  function open(opts) {
    if (!window.SupabaseAuth?.getSession?.()?.user || authShowing()) return false;
    opts = opts || {};
    build();
    watchMicPermission();
    var root = S.root;
    clearTimeout(S.closeTimer);
    S.motionGeneration = (S.motionGeneration || 0) + 1;
    if (S.motion) S.motion.cancel();

    var reason = opts.reason || 'manual';
    S.reason = reason;
    var focusP = PROVIDERS[opts.provider] ? opts.provider : null;
    var banner = root.querySelector('[data-banner]');
    var text = '', tone = 'info';
    if (reason === 'voice') text = 'Add a free key for live voice.';
    else if (reason === 'refuel') { text = 'Key limit reached — add another free key.'; tone = 'warn'; }
    else if (opts.message) text = String(opts.message);
    banner.hidden = !text;
    banner.setAttribute('data-tone', tone);
    banner.innerHTML = text ? icon(tone === 'warn' ? 'warn' : 'spark', 16) + '<span>' + esc(text) + '</span>' : '';

    render();
    // Open the card that needs him: the one asked for, else AI Studio if it
    window.ClavisKeyVault?.refresh?.();
    // isn't connected (or needs a refuel). Optional ones stay folded.
    var st = status();
    // The one card that needs him opens; the rest fold. This runs before
    // the dialog is visible, so it is instant — animating fourteen cards
    // nobody has seen yet is the stutter on open.
    var auto = focusP ||
      (reason === 'refuel' || reason === 'voice' || !st.groq.connected || st.groq.state === 'spent' ? 'groq'
        : (!st.apify.connected ? 'apify' : null));
    ORDER.forEach(function (p) { expand(p, p === auto, true); });
    expandGroup(!!(auto && EXTRA.indexOf(auto) !== -1), true);

    if (!S.isOpen) {
      S.lastFocus = doc.activeElement;
      S.isOpen = true;
      root.hidden = false;
      root.classList.remove('is-open');
      if (!window.RudraMotionUI) void root.offsetWidth;
      root.classList.add('is-open');
      if (window.RudraMotionUI) S.motion = window.RudraMotionUI.surface(S.dialog, true, .8);
      doc.addEventListener('keydown', onKey, true);
      doc.documentElement.classList.add('cx-setup-lock');
    }
    if (opts.prefill && focusP) {
      expand(focusP, true);
      if (fillKey(focusP, opts.prefill) && reason === 'refuel') checkAndSave(focusP);
    }
    var target = (focusP || (st.groq.connected && reason !== 'refuel' ? null : 'groq'));
    setTimeout(function () {
      var input = target && root.querySelector('[data-input="' + target + '"]');
      var el = input && input.offsetParent ? input : root.querySelector('[data-act="done"]');
      try { (el || S.dialog).focus({ preventScroll: true }); } catch (_) {}
    }, reducedMotion() ? 0 : 120);
    return true;
  }

  function close() {
    if (!S.root || !S.isOpen) return false;
    S.isOpen = false;
    if (!window.RudraMotionUI) S.root.classList.remove('is-open');
    doc.removeEventListener('keydown', onKey, true);
    doc.documentElement.classList.remove('cx-setup-lock');
    clearTimeout(S.clipTimer);
    var ticket = ++S.motionGeneration;
    var finish = function () {
      if (S.isOpen || ticket !== S.motionGeneration) return;
      S.root.classList.remove('is-open');
      S.root.hidden = true;
      ORDER.forEach(function (p) { setMsg(p, '', ''); var i = S.root.querySelector('[data-input="' + p + '"]'); if (i) { i.value = ''; i.type = 'password'; syncEye(p); } });
      setMsg('mic', '', '');
    };
    if (window.RudraMotionUI) {
      if (S.motion) S.motion.cancel();
      S.motion = window.RudraMotionUI.surface(S.dialog, false, .52);
      if (S.motion) S.motion.finished.then(finish, finish);
      else finish();
    } else S.closeTimer = setTimeout(finish, reducedMotion() ? 0 : 260);
    var back = S.lastFocus;
    S.lastFocus = null;
    if (back && typeof back.focus === 'function' && doc.contains(back)) { try { back.focus({ preventScroll: true }); } catch (_) {} }
    return true;
  }

  /* ── persistent entry point: "Setup ✦" pill ────────────────── */
  function updatePill() {
    var pill = doc.getElementById('cx-setup-pill');
    if (!window.SupabaseAuth?.getSession?.()?.user || authShowing()) {
      if (pill) pill.hidden = true;
      return;
    }
    if (!pill) {
      pill = doc.createElement('button');
      pill.type = 'button';
      pill.id = 'cx-setup-pill';
      pill.className = 'cx-setup-pill';
      pill.title = 'Rudra24 AI setup — free keys + mic';
      pill.setAttribute('aria-label', 'Rudra24 AI setup kholiye');
      pill.textContent = 'Setup';
      pill.addEventListener('click', function () { open({ reason: 'manual' }); });
    }
    var anchor = doc.querySelector('#view-jarvis .jarvis-hero-actions');
    if (anchor) {
      if (pill.parentNode !== anchor) {
        pill.classList.remove('is-floating');
        anchor.insertBefore(pill, anchor.querySelector('.jarvis-actions-sep'));
      }
    } else if (pill.parentNode !== doc.body) {
      pill.classList.add('is-floating');
      doc.body.appendChild(pill);
    }
    pill.hidden = false;
  }

  /* ── auto-open on first run ────────────────────────────────── */
  function visible(el) {
    if (!el || el.hidden) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function authShowing() {
    var list = doc.querySelectorAll('#auth-screen, .ag-auth-screen, [id*="auth"][class*="screen"], [id*="auth"][class*="overlay"], [id^="auth"], [id*="login"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && el.closest('#cx-setup-root')) continue;
      if (!visible(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width * r.height > window.innerWidth * window.innerHeight * 0.35) return true;
    }
    return false;
  }
  function otherModalShowing() {
    var list = doc.querySelectorAll('#clavis-voiceid-sheet, [aria-modal="true"], .kv-backdrop.is-open, .settings-overlay.active, .settings-overlay.open');
    for (var i = 0; i < list.length; i++) {
      if (list[i].closest('#cx-setup-root')) continue;
      if (list[i].getAttribute('aria-hidden') === 'true') continue;
      if (visible(list[i])) return true;
    }
    return false;
  }

  function maybeAutoOpen() {
    if (!window.SupabaseAuth?.getSession?.()?.user || authShowing()) return Promise.resolve(false);
    if (S.isOpen) return Promise.resolve(false);
    if ((Number(lsGet(LS.snooze)) || 0) > Date.now()) return Promise.resolve(false);
    var v = vault();
    var ready = (v && typeof v.ready === 'function') ? Promise.race([Promise.resolve(v.ready()).catch(function () {}), sleep(3000)]) : Promise.resolve();
    return ready.then(function () { return sleep(450); }).then(function () {
      render();
      if (S.isOpen) return false;
      if ((Number(lsGet(LS.snooze)) || 0) > Date.now()) return false;
      var st = status();
      if (st.groq.connected || st.cartesia.connected || st.openrouter.connected) return false;
      if (authShowing() || otherModalShowing()) {
        // Wait politely for the login / permission sheet to finish.
        if (S.autoTries++ < 40) setTimeout(maybeAutoOpen, 3000);
        return false;
      }
      return open({ reason: 'first' });
    });
  }

  /* ── wiring to the rest of the app ─────────────────────────── */
  window.addEventListener('focus', onReturn);
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible') onReturn(); });
  window.addEventListener('clavis:vault-changed', function () { render(); });
  window.addEventListener('rudra:auth-state', function () {
    S.lastClip = '';
    S.linkClicked = {};
    if (S.root) S.root.querySelectorAll('[data-input]').forEach(function (input) { input.value = ''; input.type = 'password'; });
    close();
  });
  window.addEventListener('clavis:mic-granted', function () {
    S.mic = 'granted';
    render();
    // A microphone grant completes the microphone-only setup action.
    if (S.isOpen && S.reason === 'voice') close();
  });
  window.addEventListener('clavis:refuel-needed', function (e) {
    var d = (e && e.detail) || {};
    var last = Number(lsGet(LS.refuelAt)) || 0;
    if (Date.now() - last < REFUEL_GAP_MS) return;
    lsSet(LS.refuelAt, String(Date.now()));
    open({ reason: 'refuel', provider: PROVIDERS[d.provider] ? d.provider : 'groq' });
  });

  function boot() {
    render();
    setTimeout(function () { maybeAutoOpen().catch(function () {}); }, 2500);
    // Keep the manual setup entry beside voice controls after a key connects.
    S.pillTimer = setInterval(function () {
      if (doc.visibilityState !== 'visible') return;
      updatePill();
    }, 5000);
    var v = vault();
    if (v && typeof v.ready === 'function') Promise.resolve(v.ready()).then(render, function () {});
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  window.ClavisSetup = {
    open: open,
    close: close,
    maybeAutoOpen: maybeAutoOpen,
    status: status,
    saveKey: saveKey
  };
})();
