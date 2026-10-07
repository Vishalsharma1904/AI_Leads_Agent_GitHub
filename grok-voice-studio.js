/* Grok live voice, using the public xAI realtime API and existing PCM worklets. */
window.GrokStudio = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = () => window.SupabaseAuth?.getAccessToken?.() || '';
  const uid = () => window.SupabaseAuth?.getUser?.()?.id || '';
  const STYLE = 'You are a warm, professional female AI assistant. Introduce yourself honestly as an AI assistant. Speak natural everyday Hindi mixed with familiar English terms; use feminine Hindi grammar. Match the caller’s language. Keep each turn to one or two short sentences, ask one question and wait. Listen to their actual answer. Use ji or achha only when appropriate. Never repeat fillers, read a script, force slang, invent business facts or use stage directions. Respect interruptions and requests to stop. Hindi words should have a natural Indian Hindi accent. Explain uncertainty and offer a human handoff when needed.';
  const initial = () => ({ id: '', name: 'Ishita · Rudra24', instructions: 'Help callers understand our security and housekeeping services. Ask about their location, requirements and preferred callback time. Do not invent prices or availability.', greeting: 'नमस्ते, मैं इशिता, Rudra24 की AI assistant हूँ। मैं आपकी कैसे मदद कर सकती हूँ?', style: STYLE, voice: 'eve', language: 'hi', speed: 1.1, reasoning: 'none', follow: true, silence: 5, end: true, reminders: 2, duration: 180, keyterms: 'Rudra24\nDelhi NCR', pronunciation: 'Rudra24 = रुद्र ट्वेंटी फोर', collection: '', search: false });
  let owner = '', profiles = [], history = [], connected = false, epoch = 0, session = null, busy = false;
  function say(text, bad = false) { const e = $('gr-status'); if (e) { e.textContent = text; e.dataset.error = String(bad); } }
  function storage(name) { return 'rudra_grok_' + name + ':' + owner; }
  function read(name) { try { const value = JSON.parse(localStorage.getItem(storage(name)) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } }
  function persist(name, value) { localStorage.setItem(storage(name), JSON.stringify(value)); }
  function identify() {
    const next = uid();
    if (next !== owner) { stop(); epoch++; owner = next; connected = false; profiles = owner ? read('profiles').slice(0, 50) : []; history = owner ? read('history').slice(0, 20) : []; fill(initial()); list(); conversations(); }
  }
  async function request(input, method = 'POST') {
    if (!token()) await window.SupabaseAuth?.init?.();
    identify();
    if (!token() || !owner) throw new Error('Sign in with Google first, then connect your xAI API key.');
    const generation = epoch;
    const response = await fetch('/api/grok-voice', { method, credentials: 'same-origin', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(input) : undefined });
    const data = await response.json().catch(() => ({}));
    if (generation !== epoch) throw new Error('The account changed. Reconnect Grok.');
    if (!response.ok) throw new Error(data.detail || `Grok request failed (${response.status}).`);
    return data;
  }
  const field = (name, title, extra = '') => `<label>${title}<input name="${name}" ${extra}></label>`;
  function mount() {
    const host = $('vp-grok'); if (!host || host.childElementCount) return;
    host.innerHTML = `<div class="om-heading"><div><span class="om-eyebrow">GROK · xAI VOICE</span><h2>A voice that listens, naturally</h2><p>Build your assistant here. Choose its voice, teach it your business, then talk to it live.</p></div><button data-gr-action="refresh" type="button">Refresh connection</button></div>
      <div class="om-steps"><div><span>01</span><strong>Connect xAI</strong><small>Your key stays encrypted on the server.</small></div><div><span>02</span><strong>Make it yours</strong><small>Instructions, Hindi, voice and speaking style.</small></div><div><span>03</span><strong>Try a conversation</strong><small>Browser testing needs no phone number.</small></div></div>
      <details class="om-connect" id="gr-connect" open><summary>Account connection</summary><div class="om-connect-body"><p id="gr-connected">Not connected</p><button id="gr-signin" data-gr-action="signin" type="button">Sign in with Google</button><label>xAI API key<div class="om-row"><input id="gr-key" type="password" autocomplete="off" placeholder="Paste your xAI API key"><button class="btn-primary" data-gr-action="connect" type="button">Connect securely</button><button data-gr-action="disconnect" type="button">Disconnect</button></div></label><p>Get your key from <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer">xAI Console → API Keys</a>. Use an xAI API key, not an OmniDimension or Sarvam key. Connection lasts this browser session, up to 8 hours.</p></div></details>
      <p id="gr-status" class="gr-status" role="status" aria-live="polite">Choose your settings below; connect xAI when you are ready to test.</p>
      <nav class="om-tabs" aria-label="Grok setup"><button type="button" data-gr-tab="configuration" aria-pressed="true">Configuration</button><button type="button" data-gr-tab="speech" aria-pressed="false">Speech</button><button type="button" data-gr-tab="test" aria-pressed="false">Try it live</button><button type="button" data-gr-tab="deployment" aria-pressed="false">Deployment</button><button type="button" data-gr-tab="conversations" aria-pressed="false">Conversations & insights</button></nav>
      <form id="gr-form" novalidate><section data-gr-panel="configuration"><div class="om-grid"><aside class="om-card"><h3>Your agent profiles</h3><p>Saved for this account in this browser. These are app profiles; they do not publish or import xAI Console agents.</p><button type="button" data-gr-action="new">New agent</button><div id="gr-profiles" class="om-list"></div></aside><div class="om-card"><h3>Give your agent a purpose</h3><input type="hidden" name="id">${field('name','Agent name','required maxlength="100"')}<label>Business instructions<textarea name="instructions" rows="8" maxlength="16000" required></textarea></label><label>First spoken message<textarea name="greeting" rows="2" maxlength="1000"></textarea></label><details><summary>Conversation style</summary><textarea name="style" aria-label="Conversation style" rows="5" maxlength="4000"></textarea><button type="button" data-gr-action="natural">Use natural Hindi / Hinglish</button></details><p>Speak briefly, listen first, and stay honest about being an AI assistant.</p></div></div></section>
      <section data-gr-panel="speech" hidden><div class="om-card"><h3>Voice & conversation rhythm</h3><div class="om-fields"><label>Voice<select name="voice" id="gr-voice"><option value="eve">Eve · warm female voice</option><option value="ara">Ara</option><option value="rex">Rex</option><option value="sal">Sal</option><option value="leo">Leo</option></select></label>${field('customVoice','Or your existing custom voice ID','maxlength="160" placeholder="Leave blank for the selected voice"')}<label>Language<select name="language"><option value="hi">Hindi / Hinglish</option><option value="en">English</option><option value="auto">Detect automatically</option><option value="bn">Bengali</option></select></label>${field('speed','Speaking speed','type="number" min="0.7" max="1.5" step="0.05" required')}<label>Response mode<select name="reasoning"><option value="none">Quick replies · lower thinking delay</option><option value="high">Think more · complex questions</option></select></label>${field('silence','Follow up after silence (seconds)','type="number" min="3" max="60" required')}<label class="om-check"><input name="follow" type="checkbox">Gently follow up when the caller goes quiet</label><label class="om-check"><input name="end" type="checkbox">End browser test after unanswered reminders</label>${field('reminders','Maximum unanswered reminders','type="number" min="1" max="5" required')}${field('duration','Maximum test duration (seconds)','type="number" min="30" max="600" required')}<label class="om-wide">Pronunciation · one word = pronunciation per line<textarea name="pronunciation" rows="3" maxlength="4000"></textarea></label><label class="om-wide">Keyterms · one brand or phrase per line<textarea name="keyterms" rows="3" maxlength="5000"></textarea></label></div><p>Eve and 1.1× are a starting point. Voice quality also depends on your microphone and network; testing cannot guarantee zero delay.</p></div></section>
      <div class="om-row" id="gr-save-row"><button class="btn-primary" type="submit">Save agent profile</button><span id="gr-save-note"></span></div></form>
      <section data-gr-panel="test" hidden><div class="om-card"><h3>Talk to your agent</h3><p>Uses the settings currently in the form. Your microphone starts only after you press Start. xAI API usage is billed to your account.</p><label class="om-check"><input type="checkbox" id="gr-charge">I agree to xAI usage charges for this browser test.</label><div class="om-row"><button type="button" data-gr-action="start" class="btn-primary">Start live test</button><button type="button" data-gr-action="stop">End test</button><button type="button" data-gr-action="mute" id="gr-mute">Mute microphone</button></div><p id="gr-call-status" role="status">Microphone off</p><div class="om-transcript" id="gr-transcript" aria-label="Live conversation"></div><p>Echo cancellation and noise suppression are enabled. Wear headphones if the agent hears its own voice.</p></div></section>
      <section data-gr-panel="deployment" hidden><div class="om-card"><h3>Knowledge & supported tools</h3><p>Optional tools use xAI’s server-side search and can add charges. Paste an existing xAI Collection ID to use its knowledge.</p><label>Collection ID<input id="gr-collection" maxlength="160" placeholder="Existing xAI collection ID"></label><label class="om-check"><input id="gr-search" type="checkbox">Enable web search during live tests</label><button type="button" data-gr-action="save">Save these settings with my agent</button></div><div class="om-card"><h3>Phone calls & SIP</h3><p>Browser testing is available here. Phone calling is not connected by entering an API key alone: you need a telephony provider’s number, SIP routing and a continuously running call server.</p><button type="button" data-gr-action="numbers">Show my xAI phone numbers</button><div id="gr-numbers" class="om-list"></div><p>Existing mobile SIM numbers cannot be attached by typing them here. Ask your number provider whether it supports SIP/BYOC for India. This Vercel app does not currently run the persistent SIP call server.</p><a href="https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip" target="_blank" rel="noopener noreferrer">Official xAI SIP setup guide</a></div></section>
      <section data-gr-panel="conversations" hidden><div class="om-card"><h3>Your browser tests</h3><p>Recent transcripts and session usage stay in this account’s browser. This is not xAI Console’s complete call history. Exact billing is shown by xAI.</p><div id="gr-history"></div><button type="button" data-gr-action="export">Export test history</button><button type="button" data-gr-action="clear">Clear browser history</button></div></section>`;
    fill(initial());
    host.addEventListener('click', e => {
      const tab = e.target.closest('[data-gr-tab]'); if (tab) return show(tab.dataset.grTab);
      const profile = e.target.closest('[data-gr-profile]'); if (profile) { const p = profiles.find(p => p.id === profile.dataset.grProfile); if (p) { fill(p); say('Agent loaded. Save changes or open Try it live.'); } return; }
      const b = e.target.closest('[data-gr-action]'); if (b) action(b.dataset.grAction);
    });
    $('gr-form').addEventListener('submit', e => { e.preventDefault(); action('save'); });
    const view = $('view-voice-ai');
    if (view) new MutationObserver(() => { if (!view.classList.contains('active')) stop(); }).observe(view, { attributes: true, attributeFilter: ['class'] });
  }
  function show(name) {
    $('vp-grok').querySelectorAll('[data-gr-panel]').forEach(p => p.hidden = p.dataset.grPanel !== name);
    $('vp-grok').querySelectorAll('[data-gr-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.grTab === name)));
    $('gr-save-row').hidden = !['configuration', 'speech'].includes(name);
  }
  function fill(p) {
    const f = $('gr-form'); if (!f) return;
    for (const [key, value] of Object.entries(p)) { const el = f.elements.namedItem(key); if (el) { if (el.type === 'checkbox') el.checked = !!value; else el.value = value; } }
    const voice = f.elements.namedItem('voice');
    if (!voice.value) { const o = new Option(p.voice, p.voice); voice.add(o); voice.value = p.voice; }
    f.elements.namedItem('customVoice').value = '';
    $('gr-collection').value = p.collection || ''; $('gr-search').checked = !!p.search;
  }
  function config() {
    const f = $('gr-form');
    if (!f.checkValidity()) { const invalid = f.querySelector(':invalid'); const panel = invalid?.closest('[data-gr-panel]'); if (panel) show(panel.dataset.grPanel); f.reportValidity(); throw new Error('Check the highlighted settings first.'); }
    const p = {};
    for (const el of f.elements) if (el.name) p[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    for (const key of ['speed','silence','reminders','duration']) p[key] = Number(p[key]);
    p.voice = p.customVoice.trim() || p.voice; delete p.customVoice;
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(p.voice)) throw new Error('Use a valid xAI voice ID.');
    p.collection = $('gr-collection').value.trim(); p.search = $('gr-search').checked;
    if (p.collection && !/^[A-Za-z0-9_-]{1,160}$/.test(p.collection)) throw new Error('Check the Collection ID.');
    settings(p); return p;
  }
  function settings(p) {
    const terms = p.keyterms.split('\n').map(s => s.trim()).filter(Boolean);
    if (![p.speed, p.silence, p.reminders, p.duration].every(Number.isFinite) || p.speed < .7 || p.speed > 1.5 || p.silence < 3 || p.silence > 60 || !Number.isInteger(p.reminders) || p.reminders < 1 || p.reminders > 5 || p.duration < 30 || p.duration > 600) throw new Error('Check speaking speed, silence and test limits.');
    if (terms.length > 100 || terms.some(s => s.length > 50)) throw new Error('Use up to 100 keyterms, each at most 50 characters.');
    const replace = Object.create(null);
    for (const line of p.pronunciation.split('\n').filter(s => s.trim())) {
      const at = line.indexOf('='); if (at < 1 || !line.slice(at + 1).trim()) throw new Error('Write pronunciation as word = pronunciation, one per line.');
      replace[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    const transcription = { keyterms: terms }; if (p.language !== 'auto') transcription.language_hint = p.language;
    const tools = []; if (p.search) tools.push({ type: 'web_search' }); if (p.collection) tools.push({ type: 'file_search', vector_store_ids: [p.collection], max_num_results: 5 });
    return { type: 'session.update', session: { voice: p.voice, instructions: [p.instructions, p.style, p.language === 'hi' ? 'Prefer conversational Hindi/Hinglish.' : p.language === 'en' ? 'Prefer English.' : '', `Begin with this welcome, then listen: ${p.greeting}`, p.follow ? 'If the caller is silent, ask a brief friendly check-in. Do not restart the greeting.' : ''].join('\n\n'), reasoning: { effort: p.reasoning }, turn_detection: { type: 'server_vad', ...(p.follow ? { idle_timeout_ms: p.silence * 1000 } : {}) }, audio: { input: { format: { type: 'audio/pcm', rate: 16000 }, transcription }, output: { format: { type: 'audio/pcm', rate: 24000 }, speed: p.speed } }, replace, tools } };
  }
  function list() { if ($('gr-profiles')) $('gr-profiles').innerHTML = profiles.map(p => `<button class="om-agent" type="button" data-gr-profile="${esc(p.id)}"><strong>${esc(p.name)}</strong><span>${esc(p.voice)} · ${esc(p.speed)}×</span></button>`).join('') || '<p>No saved profiles yet.</p>'; }
  function conversations() { if ($('gr-history')) $('gr-history').innerHTML = history.map(h => `<details><summary>${esc(h.name)} · ${esc(new Date(h.at).toLocaleString())} · ${h.seconds}s</summary><pre class="om-result">${esc(h.transcript.map(t => t.role + ': ' + t.text).join('\n\n'))}</pre><pre class="om-result">${esc(h.usage ? JSON.stringify(h.usage, null, 2) : 'No usage report received.')}</pre></details>`).join('') || '<p>No completed browser tests yet.</p>'; }
  function catalogs(data) {
    const select = $('gr-voice'), selected = select.value;
    for (const v of data.voices || []) if (/^[A-Za-z0-9._-]+$/.test(v.voice_id) && !Array.from(select.options).some(o => o.value === v.voice_id)) select.add(new Option(v.name || v.voice_id, v.voice_id));
    select.value = selected;
  }
  async function refresh() {
    mount(); if (!token()) await window.SupabaseAuth?.init?.(); identify();
    $('gr-signin').hidden = !!token();
    if (!token()) return say('Sign in with Google, then paste your xAI API key above.');
    try { const data = await request(null, 'GET'); connected = data.connected; $('gr-connected').textContent = connected ? 'Connected for this session' : 'Not connected'; if (connected) { catalogs(await request({ action: 'voices' })); $('gr-connect').open = false; } say(connected ? 'Grok connected. Configure your agent and start a live test.' : 'Paste an xAI API key to connect.'); } catch (e) { say(e.message, true); }
  }
  async function action(name) {
    if (name === 'stop') { stop(); say('Test ended. Microphone off.'); return; }
    if (name === 'mute' && session) { session.muted = !session.muted; session.stream?.getAudioTracks().forEach(t => t.enabled = !session.muted); $('gr-mute').textContent = session.muted ? 'Unmute microphone' : 'Mute microphone'; return; }
    if (busy) return; busy = true;
    try {
      if (name === 'signin') await window.SupabaseAuth.signInWithGoogle();
      else if (name === 'refresh') await refresh();
      else if (name === 'new') { fill(initial()); show('configuration'); say('New agent. Enter your business instructions, then save.'); }
      else if (name === 'natural') { $('gr-form').elements.style.value = STYLE; say('Natural Hindi style applied. Business instructions kept.'); }
      else if (name === 'save') { identify(); if (!owner) throw new Error('Sign in before saving an agent profile.'); const p = config(); if (!p.id) p.id = crypto.randomUUID(); const index = profiles.findIndex(v => v.id === p.id); if (index >= 0) profiles[index] = p; else { if (profiles.length >= 50) throw new Error('Maximum 50 browser profiles.'); profiles.push(p); } persist('profiles', profiles); fill(p); list(); say('Agent saved for this account in this browser.'); }
      else if (name === 'connect') { const key = $('gr-key').value.trim(); if (!key) throw new Error('Paste your xAI API key first.'); say('Checking your key with xAI…'); const data = await request({ action: 'connect', secret: key }); $('gr-key').value = ''; connected = true; catalogs(data); $('gr-connected').textContent = 'Connected for this session'; $('gr-connect').open = false; say('Connected. Open Try it live to test your agent.'); }
      else if (name === 'disconnect') { stop(); await request(null, 'DELETE'); connected = false; $('gr-key').value = ''; $('gr-connected').textContent = 'Not connected'; $('gr-connect').open = true; say('Grok disconnected.'); }
      else if (name === 'start') await start();
      else if (name === 'numbers') { const data = await request({ action: 'numbers' }); $('gr-numbers').textContent = data.numbers.map(n => `${n.name || 'Number'} · ${n.phone_number || n.id}`).join('\n') || 'No phone numbers returned for this xAI account.'; say('Number list loaded. This does not connect a SIP call server.'); }
      else if (name === 'clear') { if (confirm('Clear this account’s browser test history?')) { history = []; persist('history', history); conversations(); } }
      else if (name === 'export') { const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'grok-browser-tests.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (e) { say(e.message || 'Grok operation failed.', true); }
    finally { busy = false; }
  }
  async function start() {
    if (session) throw new Error('End the current test before starting another.');
    if (!connected) throw new Error('Connect your xAI API key first.');
    if (!$('gr-charge').checked) throw new Error('Confirm xAI usage charges before starting.');
    const p = config(), message = settings(p), generation = epoch;
    const s = session = { owner, p, transcript: [], usage: null, started: 0, stream: null, context: null, ws: null, ready: false, muted: false, reminders: 0, item: '', audioStart: 0, audioMs: 0, timer: null, deadline: null };
    const current = () => session === s && generation === epoch && uid() === s.owner && !$('vp-grok').hidden;
    const send = value => { if (current() && s.ws?.readyState === 1) s.ws.send(JSON.stringify(value)); };
    try {
      $('gr-call-status').textContent = 'Requesting microphone permission…';
      s.context = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      await s.context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { stream.getTracks().forEach(t => t.stop()); return; } s.stream = stream;
      await Promise.all([window.ClavisWorklet.add(s.context, 'clavis-mic-capture-worklet.js'), window.ClavisWorklet.add(s.context, 'clavis-pcm-player-worklet.js?v=3')]);
      if (!current()) return;
      message.session.audio.output.format.rate = s.context.sampleRate;
      s.player = new AudioWorkletNode(s.context, 'clavis-pcm-player', { outputChannelCount: [1] }); s.player.connect(s.context.destination);
      s.player.port.onmessage = e => { if (e.data.type === 'position' && e.data.item_id) send({ type: 'conversation.item.truncate', item_id: e.data.item_id, content_index: 0, audio_end_ms: Math.floor(e.data.played / s.context.sampleRate * 1000) }); };
      s.capture = new AudioWorkletNode(s.context, 'clavis-mic-capture', { outputChannelCount: [1] });
      s.context.createMediaStreamSource(stream).connect(s.capture).connect(s.context.destination);
      s.capture.port.onmessage = e => {
        if (!s.ready || !current() || s.muted || e.data.type !== 'pcm') return;
        if (s.ws.bufferedAmount > 256000) { stop(); say('Network too slow for live audio. Test stopped; retry on a stable connection.', true); return; }
        const float = new Float32Array(e.data.audio), pcm = new DataView(new ArrayBuffer(float.length * 2));
        for (let i = 0; i < float.length; i++) pcm.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, float[i])) * 32767), true);
        const bytes = new Uint8Array(pcm.buffer); let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
        send({ type: 'input_audio_buffer.append', audio: btoa(binary) });
      };
      const ephemeral = await request({ action: 'token', confirmed: true }); if (!current()) return;
      s.ws = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', [`xai-client-secret.${ephemeral.value}`]);
      s.deadline = setTimeout(() => { if (current() && !s.ready) { stop(); say('Grok did not start within 20 seconds. Check voice access and credits.', true); } }, 20000);
      s.ws.onopen = () => send(message);
      s.ws.onmessage = event => {
        if (!current()) return;
        let e; try { e = JSON.parse(event.data); } catch (_) { return; }
        if (e.type === 'session.updated' && !s.ready) { s.ready = true; s.started = Date.now(); clearTimeout(s.deadline); s.timer = setTimeout(() => { stop(); say('Test duration limit reached. Microphone off.'); }, p.duration * 1000); $('gr-call-status').textContent = 'Connected · listening'; send({ type: 'response.create' }); }
        if (e.type === 'response.output_item.added' && e.item?.role === 'assistant') { s.item = e.item.id; s.audioStart = 0; s.audioMs = 0; s.player.port.postMessage({ type: 'reset-position' }); }
        if (['response.output_audio.delta','response.audio.delta'].includes(e.type) && e.delta) {
          if (e.response_id && e.response_id === s.interruptedResponse) return;
          s.responseId = e.response_id;
          const binary = atob(e.delta), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
          if (bytes.length % 2) return;
          if (!s.audioStart) s.audioStart = s.context.currentTime;
          s.audioMs += bytes.length / 2 / s.context.sampleRate * 1000;
          s.player.port.postMessage({ type: 'chunk', audio: bytes.buffer }, [bytes.buffer]); $('gr-call-status').textContent = 'Agent speaking · you can interrupt';
        }
        if (e.type === 'input_audio_buffer.speech_started') { s.interruptedResponse = s.responseId; if (s.item && s.audioMs) s.player.port.postMessage({ type: 'position', item_id: s.item }); s.player.port.postMessage({ type: 'stop' }); s.audioMs = 0; s.reminders = 0; $('gr-call-status').textContent = 'Listening to you…'; }
        if (['response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type)) transcript(s, 'Agent', e.transcript, e.item_id);
        if (e.type === 'conversation.item.input_audio_transcription.completed') transcript(s, 'You', e.transcript, e.item_id);
        if (e.type === 'input_audio_buffer.timeout_triggered') { s.reminders++; if (p.end && s.reminders > p.reminders) { stop(); say('Test ended after unanswered reminders. Microphone off.'); return; } }
        if (e.type === 'response.done') { if (e.response?.usage) { s.usage ||= []; s.usage.push(e.response.usage); } }
        if (e.type === 'error') { stop(); say('Grok rejected the live session. Check voice, key permissions, credits and settings in xAI.', true); }
      };
      s.ws.onerror = () => { if (current()) { stop(); say('Grok live connection failed. Check your network, xAI credits and voice access.', true); } };
      s.ws.onclose = () => { if (current()) { stop(); say('Grok disconnected. Microphone off.'); } };
      stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (current()) stop(); }));
    } catch (e) { if (current()) { stop(); throw e; } }
    finally { if (!current()) { s.stream?.getTracks().forEach(t => t.stop()); s.ws?.close(); if (s.context?.state !== 'closed') s.context?.close().catch(() => {}); } }
  }
  function transcript(s, role, text, id) {
    if (!text) return;
    const old = s.transcript.find(t => t.id === id && t.role === role); if (old) old.text = String(text).slice(0, 6000); else s.transcript.push({ id, role, text: String(text).slice(0, 6000) });
    s.transcript = s.transcript.slice(-100);
    $('gr-transcript').innerHTML = s.transcript.map(t => `<p><strong>${esc(t.role)}</strong><br>${esc(t.text)}</p>`).join(''); $('gr-transcript').scrollTop = $('gr-transcript').scrollHeight;
  }
  function stop() {
    const s = session; session = null; if (!s) return;
    clearTimeout(s.timer); clearTimeout(s.deadline);
    s.ws?.close(); s.stream?.getTracks().forEach(t => t.stop()); s.capture?.disconnect(); s.player?.disconnect(); if (s.context?.state !== 'closed') s.context?.close().catch(() => {});
    if (s.started && owner === s.owner) { history.unshift({ name: s.p.name, at: s.started, seconds: Math.round((Date.now() - s.started) / 1000), transcript: s.transcript, usage: s.usage }); history = history.slice(0, 20); try { persist('history', history); } catch (_) { say('Browser storage is full. Export this test before leaving.', true); } conversations(); }
    if ($('gr-call-status')) $('gr-call-status').textContent = 'Microphone off'; if ($('gr-mute')) $('gr-mute').textContent = 'Mute microphone';
  }
  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('rudra:auth-state', () => { mount(); if (uid() !== owner || !token()) { stop(); epoch++; connected = false; $('gr-key').value = ''; identify(); $('gr-connected').textContent = 'Not connected'; $('gr-transcript').replaceChildren(); $('gr-numbers').replaceChildren(); fetch('/api/grok-voice', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }).catch(() => {}); } });
  return { refresh, stop, settings };
})();
