/* Account voice metadata and compact Rudra settings. No provider secrets. */
(function () {
  'use strict';
  let voices = [], models = [], epoch = 0, pending = null, mounted = false;
  const $ = id => document.getElementById(id);
  const get = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } };
  const put = (key, value) => localStorage.setItem(key, String(value));
  const owner = () => window.SupabaseAuth?.getUser?.()?.id || '';
  const mappings = {
    'sm-elevenlabs-voice': ['clavis_elevenlabs_voice', 'auto'],
    'clavis-elevenlabs-voice': ['clavis_elevenlabs_voice', 'auto'],
    'sm-elevenlabs-model': ['clavis_elevenlabs_model', 'eleven_flash_v2_5'],
    'sm-elevenlabs-gender': ['clavis_elevenlabs_gender', 'male'],
    'sm-elevenlabs-stability': ['clavis_elevenlabs_stability', '.5'],
    'sm-elevenlabs-similarity': ['clavis_elevenlabs_similarity', '.75'],
    'sm-elevenlabs-style': ['clavis_elevenlabs_style', '0'],
    'sm-elevenlabs-speaker-boost': ['clavis_elevenlabs_speaker_boost', 'false'],
    'sm-cartesia-voice': ['clavis_cartesia_voice', ''],
    'sm-stt-provider': ['clavis_stt_provider', 'elevenlabs'],
  };
  const preferenceKeys = [...new Set(Object.values(mappings).map(x => x[0]).concat(['clavis_voice_engine', 'skylark-speech-speed', 'clavis_elevenlabs_voice_manual']))];
  function savePreferences() {
    if (!owner()) return;
    const saved = {}; for (const key of preferenceKeys) saved[key] = get(key, '');
    put('rudra_voice_preferences:' + owner(), JSON.stringify(saved));
  }
  const legacyVoice = 'JBFqnCBsd6RMkjVDRZzb';
  function selectedVoice() {
    const saved = get('clavis_elevenlabs_voice', 'auto');
    return saved === legacyVoice && get('clavis_elevenlabs_voice_manual', '') !== 'true' ? 'auto' : saved;
  }
  function hindiScore(voice) {
    const labels = voice.labels || {}, language = String(labels.language || '').toLowerCase();
    const verified = Array.isArray(voice.verified_languages) && voice.verified_languages.some(item => /^(hi|hindi)(-|$)/i.test(String(item.language || item.locale || '')));
    // A verified language indicates support, not a native accent.
    return (/^(hi|hindi)(-|$)/.test(language) ? 100 : /hindi|indian/i.test(String(labels.accent || '')) ? 90 : verified ? 30 : 0)
      + (labels.gender === get('clavis_elevenlabs_gender', 'male') ? 1 : 0);
  }
  function resolveVoice() {
    const selected = selectedVoice();
    if (selected !== 'auto') return voices.find(v => v.voice_id === selected) || {voice_id:selected};
    const ranked = voices.slice().sort((a,b) => hindiScore(b) - hindiScore(a));
    if (ranked.length && hindiScore(ranked[0]) >= 50) return ranked[0];
    return voices.find(v => v.voice_id === legacyVoice) || voices[0] || {voice_id:legacyVoice};
  }
  function voiceOptions() {
    return [{value:'auto',name:'Auto · natural Hindi / English'}, ...voices.map(v => ({value:v.voice_id,name:v.name + (hindiScore(v) >= 50 ? ' · Hindi / Indian' : '')}))];
  }
  let accountOwner = owner();
  function clearMetadata(accountChanged = false) {
    if (accountChanged) {
      const next = owner();
      if (accountOwner) {
        const saved = {}; for (const key of preferenceKeys) saved[key] = get(key, '');
        put('rudra_voice_preferences:' + accountOwner, JSON.stringify(saved));
      }
      let restored = {};
      try { restored = JSON.parse(get('rudra_voice_preferences:' + next, '{}')); } catch (_) {}
      for (const [, [key, fallback]] of Object.entries(mappings)) put(key, restored[key] || fallback);
      put('clavis_voice_engine', restored.clavis_voice_engine || 'auto');
      put('skylark-speech-speed', restored['skylark-speech-speed'] || '1');
      put('clavis_elevenlabs_voice_manual', restored.clavis_elevenlabs_voice_manual || 'false');
      accountOwner = next;
      for (const [id, [key, fallback]] of Object.entries(mappings)) {
        const el = $(id); if (!el) continue;
        if (el.type === 'checkbox') el.checked = get(key, fallback) === 'true';
        else if (el.tagName !== 'SELECT' || Array.from(el.options).some(x => x.value === get(key, fallback))) el.value = get(key, fallback);
        if (el.type === 'range') { const out = $('ev-' + id.split('-').pop() + '-value'); if (out) out.textContent = el.value; }
      }
      if ($('sm-tts-model')) $('sm-tts-model').value = get('clavis_voice_engine', 'auto');
    }
    epoch++; pending = null; voices = []; models = [];
    const chosen = selectedVoice();
    for (const id of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice']) options($(id), voiceOptions(), chosen);
    options($('sm-elevenlabs-model'), [
      {value:'eleven_flash_v2_5',name:'Flash v2.5 · fastest'},
      {value:'eleven_turbo_v2_5',name:'Turbo v2.5 · balanced'},
      {value:'eleven_multilingual_v2',name:'Multilingual v2 · expressive'}
    ], get('clavis_elevenlabs_model', 'eleven_flash_v2_5'));
    if ($('sm-elevenlabs-style')) $('sm-elevenlabs-style').disabled = true;
    if ($('sm-elevenlabs-speaker-boost')) $('sm-elevenlabs-speaker-boost').disabled = true;
    if ($('sm-elevenlabs-custom-voice')) $('sm-elevenlabs-custom-voice').value = '';
  }
  function status(message) {
    const el = $('sm-elevenlabs-status');
    if (el) el.textContent = message;
  }
  function options(select, values, chosen) {
    if (!select) return;
    select.replaceChildren();
    const list = values.slice();
    if (!list.some(x => x.value === chosen)) list.unshift({ value: chosen, name: 'Saved account voice' });
    for (const item of list) {
      const option = document.createElement('option');
      option.value = item.value; option.textContent = item.name; select.append(option);
    }
    select.value = chosen;
    // Inventory refresh is not a user selection and must not overwrite preferences.
  }
  function capabilities() {
    const id = get('clavis_elevenlabs_model', 'eleven_flash_v2_5');
    const chosen = models.find(m => m.model_id === id);
    const minimal = ['eleven_v3', 'eleven_v4', 'eleven_v4_turbo'].includes(id);
    if ($('sm-elevenlabs-style')) $('sm-elevenlabs-style').disabled = minimal || chosen?.can_use_style === false;
    if ($('sm-elevenlabs-speaker-boost')) $('sm-elevenlabs-speaker-boost').disabled = minimal || chosen?.can_use_speaker_boost === false;
    if ($('sm-elevenlabs-similarity')) $('sm-elevenlabs-similarity').disabled = id === 'eleven_v3';
    if ($('sm-speech-speed')) $('sm-speech-speed').disabled = minimal;
  }
  function save() {
    for (const [id, [key]] of Object.entries(mappings)) {
      const el = $(id);
      if (el) put(key, el.type === 'checkbox' ? el.checked : el.value);
    }
    const custom = $('sm-elevenlabs-custom-voice')?.value.trim();
    if (custom) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(custom)) { status('Enter a valid voice ID from your ElevenLabs account.'); return false; }
      put('clavis_elevenlabs_voice', custom);
      put('clavis_elevenlabs_voice_manual', 'true');
      ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice'].forEach(id => options($(id), voiceOptions(), custom));
      $('sm-elevenlabs-custom-voice').value = '';
    }
    window.ClavisVoice?.resetQuota?.(); capabilities();
    savePreferences();
    status('Voice settings saved. Hear a sample to check the voice; it uses account credits.');
    return true;
  }
  async function refresh() {
    mount();
    if (pending) return pending;
    const revision = epoch, account = owner();
    pending = (async () => {
      const token = await window.SupabaseAuth?.getAccessToken?.();
      if (!token) { status('Sign in, then connect ElevenLabs in Setup.'); return null; }
      status('Loading account voices and allowance…');
      const base = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
      const response = await fetch(base + '/api/speech/elevenlabs-config', {
        cache: 'no-store', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(18000),
      });
      const data = await response.json().catch(() => ({}));
      if (revision !== epoch || account !== owner()) return null;
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Connect ElevenLabs in Setup, then retry.');
      if (!data.configured) { status('Connect ElevenLabs in Setup, then refresh your account voices.'); return data; }
      voices = Array.isArray(data.voices) ? data.voices : [];
      models = (Array.isArray(data.models) ? data.models : []).filter(m => m.can_do_text_to_speech !== false);
      const voiceId = selectedVoice();
      for (const id of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice']) options($(id), voiceOptions(), voiceId);
      let modelNotice = '';
      if (models.length) {
        let selected = get('clavis_elevenlabs_model', 'eleven_flash_v2_5');
        if (!models.some(m => m.model_id === selected)) {
          const supported = models.find(m => m.model_id === 'eleven_flash_v2_5') || models.find(m => !m.requires_alpha_access) || models[0];
          selected = supported.model_id; put('clavis_elevenlabs_model', selected);
          modelNotice = ` Switched to ${supported.name || selected}, an available speech model.`;
        }
        options($('sm-elevenlabs-model'), models.map(m => ({ value: m.model_id, name: m.name })), selected);
      }
      capabilities();
      const sub = data.subscription;
      const allowance = sub?.character_limit != null
        ? `${sub.tier || 'Account'} · ${Number(sub.remaining_characters ?? Math.max(0, sub.character_limit - (sub.character_count || 0))).toLocaleString()} credits remaining. Calling and STT also consume account credits.`
        : `Loaded ${voices.length} account voices. ${data.errors?.subscription ? 'Allow User read access to see your allowance.' : 'Usage depends on your account plan.'}`;
      const unavailable = ['voices', 'models'].filter(resource => data.errors?.[resource]).map(resource =>
        `${resource === 'voices' ? 'Voice list' : 'Speech model list'}: ${data.errors[resource].message || 'could not load; check key permissions.'}`);
      const naturalVoice = selectedVoice() === 'auto'
        ? (hindiScore(resolveVoice()) >= 50 ? ` Auto selected ${resolveVoice().name}.` : ' No Hindi-native account voice is available yet; add a Hindi voice to your ElevenLabs account, then refresh.') : '';
      status([allowance + modelNotice + naturalVoice, ...unavailable].join(' '));
      return data;
    })().catch(error => { if (revision === epoch) status(error.message || 'Could not load account voices.'); return null; })
      .finally(() => { if (revision === epoch) pending = null; });
    return pending;
  }
  function mount() {
    if (mounted || !$('sm-elevenlabs-voice')) return;
    mounted = true;
    clearMetadata();
    // A one-time migration makes the newly requested provider primary; later
    // explicit ElevenLabs/Cartesia selections are always respected.
    if (get('clavis_elevenlabs_setup_version', '') !== '1') {
      put('clavis_voice_engine', 'auto'); put('clavis_tts_provider', 'elevenlabs');
      put('clavis_stt_provider', 'elevenlabs'); put('clavis_elevenlabs_setup_version', '1');
    }
    for (const [id, [key, fallback]] of Object.entries(mappings)) {
      const el = $(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = get(key, fallback) === 'true';
      else if (el.tagName !== 'SELECT' || Array.from(el.options).some(x => x.value === get(key, fallback))) el.value = get(key, fallback);
      el.addEventListener('change', () => {
        put(key, el.type === 'checkbox' ? el.checked : el.value);
        if (key === 'clavis_elevenlabs_voice') {
          put('clavis_elevenlabs_voice_manual', el.value !== 'auto');
          const voice = voices.find(v => v.voice_id === el.value), gender = voice?.labels?.gender;
          if (gender === 'male' || gender === 'female') { put('clavis_elevenlabs_gender', gender); if ($('sm-elevenlabs-gender')) $('sm-elevenlabs-gender').value = gender; }
          for (const twin of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice']) if ($(twin) && $(twin) !== el) {
            const other = $(twin);
            if (!Array.from(other.options).some(x => x.value === el.value)) { const opt = document.createElement('option'); opt.value = el.value; opt.textContent = el.selectedOptions[0]?.textContent || 'Saved voice'; other.append(opt); }
            other.value = el.value;
          }
        }
        // The live-session listener (jarvis_ui / clavis-elevenlabs-stt) needs
        // this event; without it a provider change only applied on next wake.
        if (key === 'clavis_stt_provider') window.dispatchEvent(new CustomEvent('clavis:voice-settings-changed', { detail: { kind: 'stt' } }));
        savePreferences(); capabilities(); window.ClavisVoice?.resetQuota?.();
      });
      if (el.type === 'range') el.addEventListener('input', () => {
        const out = $('ev-' + id.split('-').pop() + '-value'); if (out) out.textContent = el.value;
        put(key, el.value);
        savePreferences();
      });
    }
    if ($('sm-tts-model')) $('sm-tts-model').value = get('clavis_voice_engine', 'auto');
  }
  window.ClavisElevenVoiceSettings = { mount, refresh, save, resolveVoice, voices: () => voices.slice(), model: id => models.find(m => m.model_id === id) };
  window.addEventListener('rudra:auth-state', () => {
    if (accountOwner !== owner()) { clearMetadata(true); status('Connect your account key in Setup, then refresh voices.'); }
  });
  window.addEventListener('clavis:vault-changed', () => {
    if (window.ClavisKeyVault?.status?.().providers.elevenlabs?.count) refresh();
    else { clearMetadata(); status('Connect ElevenLabs in Setup.'); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
