/* OmniDimension workspace. Provider key never enters localStorage or page logs. */
window.OmniStudio = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let connected = false, selected = null, originalSections = [], voices = [], session = null, contract = [], identity = '', epoch = 0, busy = false, muted = false, uncertain = false, voiceEpoch = 0;
  const STYLE_TITLE = 'Natural Hindi / Hinglish conversation';
  const STYLE = `You are the company's female AI voice assistant. Be warm and attentive, using feminine Hindi grammar (kar sakti hoon, samajh gayi). Introduce yourself as an AI assistant; never pretend to be human.
Respond to the caller's actual words, not a fixed script. Follow the business instructions without reading them aloud. Use one or two short sentences per turn, ask only one question, then wait. Acknowledge their answer before the next question. Match their Hindi, Hinglish or English naturally. Use polite aap and everyday Indian words. Use achha, ji or samajh gayi only when they fit; never repeat fillers mechanically or force slang.
Write Hindi speech in Devanagari with familiar English terms where natural. Use normal punctuation and short clauses for pauses. No stage directions, markdown, emojis, fake laughter or spelled-out punctuation. Do not repeat the greeting or name each turn. Let the caller finish. If interrupted, address their point instead of restarting the script. Ask when unclear, never invent business facts, and respect a request to end the call.`;
  const token = () => window.SupabaseAuth?.getAccessToken?.() || '';
  const uid = () => window.SupabaseAuth?.getUser?.()?.id || token();
  function say(message, bad = false) { for (const id of ['om-status','om-connect-message']) { const el=$(id); if(el){el.textContent=message;el.dataset.error=String(bad);} } }
  function checkSession() { if (!token()) throw new Error('Sign in first to connect your OmniDimension account.'); }
  async function request(payload, method = 'POST') {
    if(!token()) await window.SupabaseAuth?.init?.();
    checkSession(); const generation = epoch;
    const response = await fetch('/api/omnidimension', { method, credentials: 'same-origin', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(payload) : undefined });
    const data = await response.json().catch(() => ({}));
    if (generation !== epoch) throw new Error('The account changed. Reload this workspace.');
    if (!response.ok) { if (response.status === 504 && payload?.path === '/calls/dispatch') uncertain = true; throw new Error(data.detail || `Connection failed (${response.status}). This deployment needs the OmniDimension API function.`); }
    return data;
  }
  const api = (method, path, body, query, confirmed = false) => request({ method, path, body, query, confirmed });
  async function run(action) {
    if (busy) return;
    busy = true; $('vp-omnidimension').setAttribute('aria-busy', 'true');
    $('vp-omnidimension').querySelectorAll('[data-om-action],button[type=submit]').forEach(b => b.disabled = true);
    try { await action(); } catch (error) { say(error.message || 'The operation failed.', true); }
    finally { busy = false; $('vp-omnidimension').removeAttribute('aria-busy'); $('vp-omnidimension').querySelectorAll('[data-om-action],button[type=submit]').forEach(b => b.disabled = false); }
  }
  const field = (name, title, extra = '') => `<label>${title}<input name="${name}" ${extra}></label>`;
  function mount() {
    const host = $('vp-omnidimension'); if (!host || host.childElementCount) return;
    host.innerHTML = `<div class="om-heading"><div><span class="om-eyebrow">OMNIDIMENSION</span><h2>Your voice agents, in one place</h2><p>Create an agent, test a conversation, then connect your calling number.</p></div><button type="button" class="btn-secondary" data-om-action="refresh">Refresh account</button></div>
      <p id="om-status" role="status" aria-live="polite">Connect your account to begin.</p>
      <details id="om-connect" class="om-connect" open><summary>Account connection <span id="om-connected">Not connected</span></summary><div class="om-connect-body"><div class="om-row"><p>Sign in to Rudra24 before connecting your calling account.</p><button type="button" data-om-action="signin" id="om-signin">Sign in with Google</button></div><label for="om-key">OmniDimension API key</label><div class="om-row"><input id="om-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your API key"><button type="button" class="btn-primary" data-om-action="connect">Connect securely</button><button type="button" class="btn-secondary" data-om-action="disconnect">Disconnect</button></div><p>The key is encrypted by the server and hidden from page scripts. Connection lasts for this browser session, up to 8 hours.</p><p id="om-connect-message" role="status">Paste the key from OmniDimension → API → API Access.</p><p>Get your key from <a href="https://omnidim.io/api-management" target="_blank" rel="noopener noreferrer">OmniDimension API Access</a>. Number KYC and billing may still require their verification.</p></div></details>
      <div id="om-wallet" class="om-wallet">Connect to see your actual balance, available minutes and call concurrency.</div>
      <div class="om-steps"><div><span>01</span><strong>Connect account</strong><small>Your key stays encrypted</small></div><div><span>02</span><strong>Design the conversation</strong><small>Instructions, voice & pace</small></div><div><span>03</span><strong>Listen, then call</strong><small>Browser test before phone calls</small></div></div><div class="om-tabs" aria-label="Voice workspace sections">${[['agents','Agents'],['test','Test & calls'],['numbers','Phone numbers'],['files','Knowledge files'],['campaigns','Campaigns'],['more','More controls']].map(([id,name]) => `<button type="button" data-om-tab="${id}" aria-pressed="${id==='agents'}">${name}</button>`).join('')}</div>
      <section data-om-panel="agents"><div class="om-grid"><aside class="om-card"><div class="om-row"><h3>Your agents</h3><button type="button" class="btn-secondary" data-om-action="new">New agent</button></div><label for="om-search">Find an agent</label><input id="om-search" placeholder="Search by name"><button type="button" class="btn-secondary" data-om-action="agents">Search / refresh</button><div id="om-agents" class="om-list">Connect your account to load agents.</div><div class="om-row"><button type="button" data-om-action="agents-prev">Previous</button><span id="om-agent-page">Page 1</span><button type="button" data-om-action="agents-next">Next</button></div></aside>
      <div class="om-card"><div class="om-row"><h3>Build your calling agent</h3><span id="om-agent-id">New agent</span></div><form id="om-agent-form"><div class="om-fields">${field('name','Agent name','required maxlength="120" placeholder="Rudra sales assistant"')}${field('welcome_message','First spoken message','required maxlength="3000" placeholder="Namaste, main Rudra24 ka AI assistant hoon…"')}<label class="om-wide">Custom instructions<textarea name="instructions" required rows="8" maxlength="30000" placeholder="Your business, calling goal, questions, handling objections, and when to hand over to a person."></textarea></label>
      <label>Calling direction<select name="call_type"><option value="Outgoing">Outgoing calls</option><option value="Incoming">Incoming calls</option></select></label>${field('languages','Languages (comma separated)','value="Hindi, English (India)" placeholder="Hindi, English (India)"')}
      <fieldset class="om-wide om-sound"><legend>Voice & conversation</legend><p>Choose a voice, listen to its sample, then fine-tune the conversation.</p><div class="om-row"><button type="button" class="btn-primary" data-om-action="natural">Natural female · Hinglish</button><button type="button" data-om-action="fast">Faster replies</button><button type="button" data-om-action="steady">Fewer cut-offs</button></div><div class="om-fields"><label>AI model<select name="model"><option value="">Provider default / keep current</option></select></label><label>Voice provider<select name="voice_provider"><option value="">Provider default / keep current</option><option value="sarvam">Sarvam</option><option value="eleven_labs">ElevenLabs</option><option value="cartesia">Cartesia</option><option value="google">Google</option></select></label>
      <label>Voice preference<select name="voice_gender"><option value="female">Female</option><option value="">All voices</option></select></label><label>Voice<select name="voice_id"><option value="">Choose a voice after loading catalog</option></select></label><button type="button" class="btn-secondary" data-om-action="voices">Load available voices</button>
      <div class="om-wide"><audio id="om-voice-sample" controls preload="none" hidden></audio><p id="om-voice-note">Load voices to listen to real provider samples. Nothing plays automatically.</p></div><label>Speech speed<input name="speed" type="number" min="0.5" max="2" step="0.05" value="1"></label><label>Reply creativity<input name="temperature" type="number" min="0" max="1" step="0.05" value="0.35"></label><label class="om-check"><input name="interrupt" type="checkbox" checked>Allow the caller to interrupt</label><label class="om-check om-wide"><input name="natural_style" type="checkbox" checked>Natural Hindi / Hinglish conversation style</label><label class="om-check"><input name="dynamic_greeting" type="checkbox">Adapt greeting to each caller</label><label class="om-check om-wide"><input name="tune_audio" type="checkbox" checked>Apply the listening settings below when saving</label><label>Speech recognition<select name="stt"><option value="sarvam">Sarvam · Indian languages</option><option value="soniox">Soniox · multilingual</option><option value="deepgram_stream">Deepgram</option><option value="cartesia">Cartesia</option><option value="azure_stream">Azure</option></select></label><label>Recognition language<input name="stt_language" value="hi-IN" placeholder="hi-IN, hi or multi"></label><label>Wait after the caller stops (ms)<input name="silence" type="number" min="200" max="2000" step="50" value="300"></label><label>Words needed to interrupt<input name="interrupt_words" type="number" min="1" max="10" step="1" value="3"></label><label class="om-check"><input name="noise" type="checkbox" checked>Reduce background noise</label><label class="om-check"><input name="greeting_interrupt" type="checkbox" checked>Allow interruption of the greeting</label></div><p>Speed 1× is normal. A longer wait avoids cutting off pauses; a shorter wait replies sooner. Start with 300 ms and 3 words. Phone networks and the selected voice also affect sound quality.</p><a href="https://docs.omnidim.io/docs/dashboard-guides/voices-and-languages" target="_blank" rel="noopener noreferrer">Provider tuning guide</a></fieldset></div>
      <details><summary>Call behavior & integrations</summary><div class="om-fields">${field('timezone','Timezone','value="Asia/Kolkata"')}${field('max_duration','Maximum call seconds','type="number" min="30" max="3600" value="180"')}<label>End-call instruction<textarea name="end_condition" rows="2" placeholder="End when the next step is agreed."></textarea></label>${field('end_message','Closing message','placeholder="Dhanyavaad, aapka din achha rahe."')}<label class="om-wide">Dynamic variables (JSON)<textarea name="variables" rows="3" spellcheck="false" placeholder='{"customer_name":"Demo user"}'></textarea></label><label class="om-wide">Extra API settings (JSON)<textarea name="advanced" rows="5" spellcheck="false" placeholder='{"transcriber":{"provider":"deepgram_stream","model":"nova-3","language":"hi"},"web_search":{"enabled":true,"provider":"DuckDuckGo"}}'></textarea></label></div><p>Extra settings support transfers, voicemail, post-call email/webhooks, background sound, STT and context sections. Existing settings are preserved when omitted.</p></details><div class="om-row"><button class="btn-primary" type="submit">Save agent</button><button type="button" class="btn-secondary" data-om-action="test-tab">Test this agent</button><button type="button" data-om-action="delete-agent">Delete agent</button></div></form></div></div></section>
      <section data-om-panel="test" hidden><div class="om-grid"><div class="om-card"><h3>Test in your browser</h3><p id="om-selected">Save or select an agent first.</p><p>Uses your OmniDimension balance. No phone number needed. Microphone starts only when you press Start conversation.</p><div class="om-row"><button type="button" class="btn-primary" data-om-action="web-start">Start conversation</button><button type="button" class="btn-secondary" data-om-action="web-mute" id="om-mute">Mute</button><button type="button" class="btn-secondary" data-om-action="web-stop">End conversation</button></div><p id="om-web-state" role="status">Microphone is off.</p><div id="om-transcript" class="om-transcript" role="log" aria-label="Conversation transcript"></div></div>
      <div class="om-card"><h3>Place a phone test call</h3><p>Select your purchased number, enter your own test phone number and confirm. Dispatch means queued; logs show whether it connected.</p><form id="om-call-form"><label>Call from<select id="om-from"><option value="">Platform default (if available)</option></select></label><label>Call to<input id="om-to" required type="tel" pattern="\\+[1-9][0-9]{7,14}" placeholder="+919876543210"></label><label>Call context (JSON)<textarea id="om-context" rows="3" placeholder='{"customer_name":"Your name"}'></textarea></label><label class="om-check"><input id="om-call-consent" type="checkbox" required>I am authorized to call this number and accept provider call charges.</label><button type="submit" class="btn-primary">Confirm & place test call</button></form><p id="om-call-result" role="status"></p></div></div><div class="om-card"><div class="om-row"><h3>Call logs & analytics</h3><button type="button" class="btn-secondary" data-om-action="logs">Refresh logs</button><label>Status<select id="om-log-filter"><option value="">All statuses</option><option>completed</option><option>busy</option><option>failed</option><option>no-answer</option></select></label></div><div id="om-logs">No call logs loaded.</div><div class="om-row"><button type="button" data-om-action="logs-prev">Previous</button><span id="om-log-page">Page 1</span><button type="button" data-om-action="logs-next">Next</button></div><div id="om-call-detail"></div></div></section>
      <section data-om-panel="numbers" hidden><div class="om-card"><div class="om-row"><h3>Your calling numbers</h3><button type="button" class="btn-secondary" data-om-action="numbers">Refresh numbers</button></div><p>Attach your number to the selected agent for incoming calls. Outgoing tests can use a number selected in Test & calls.</p><div id="om-numbers">Connect to load purchased or imported numbers.</div></div><div class="om-card"><h3>Find a number to purchase</h3><form id="om-shop-form"><div class="om-fields"><label>Country<select name="region"><option value="IN">India</option><option value="US">United States</option></select></label>${field('carrier','Carrier','required value="carrier-1"')}${field('pattern','Number contains','placeholder="Optional digits"')}<button type="submit" class="btn-secondary">Search available numbers</button></div></form><p>Rental, telephony charges and KYC depend on the carrier. Purchase only after reviewing the returned price.</p><div id="om-shop"></div></div></section>
      <section data-om-panel="files" hidden><div class="om-card"><div class="om-row"><h3>Business knowledge</h3><button type="button" class="btn-secondary" data-om-action="files">Refresh files</button></div><p>Upload a PDF, then attach it to the selected agent so it can answer from your business information.</p><form id="om-file-form"><label>PDF file (up to 2 MB)<input id="om-file" type="file" accept="application/pdf,.pdf" required></label><button type="submit" class="btn-primary">Upload PDF</button></form><div id="om-files"></div></div></section>
      <section data-om-panel="campaigns" hidden><div class="om-card"><h3>Bulk calling campaign</h3><p>Create a draft first, review contacts, then start it. Draft creation does not start dialing.</p><form id="om-campaign-form"><div class="om-fields">${field('name','Campaign name','required maxlength="120"')}<label>Calling number<select name="number" id="om-campaign-number" required><option value="">Choose your number</option></select></label><label class="om-wide">Contacts — one number per line<textarea name="contacts" required rows="5" placeholder="+919876543210"></textarea></label>${field('concurrency','Simultaneous calls','type="number" min="1" max="3" value="1"')}<button type="submit" class="btn-primary">Save draft campaign</button></div></form><div class="om-row"><h3>Your campaigns</h3><button type="button" class="btn-secondary" data-om-action="campaigns">Refresh campaigns</button></div><div id="om-campaigns"></div></div></section>
      <section data-om-panel="more" hidden><div class="om-card"><h3>More OmniDimension controls</h3><p>Version history, simulations, number imports, transfer/webhook settings, schedules, retries and rotation. These are the provider's published API controls; reseller administration is excluded.</p><label for="om-operation">Choose an operation</label><select id="om-operation"><option value="">Load controls…</option></select><form id="om-operation-form"><div id="om-operation-fields" class="om-fields"></div><button type="submit" class="btn-primary">Run selected operation</button></form><pre id="om-operation-result" class="om-result" tabindex="0" aria-label="Operation result"></pre></div></section>`;
    host.addEventListener('click', event => {
      const tab = event.target.closest('[data-om-tab]'); if (tab) return showTab(tab.dataset.omTab);
      const button = event.target.closest('[data-om-action]'); if (button) {
        if (button.dataset.omAction === 'web-stop') return stop();
        if (button.dataset.omAction === 'web-mute') { muted = !muted; session?.mute(muted); $('om-mute').textContent = muted ? 'Unmute' : 'Mute'; return; }
        run(() => action(button.dataset.omAction, button.dataset.id, button));
      }
    });
    $('om-agent-form').addEventListener('submit', e => { e.preventDefault(); run(save); });
    $('om-call-form').addEventListener('submit', e => { e.preventDefault(); run(call); });
    $('om-shop-form').addEventListener('submit', e => { e.preventDefault(); run(shop); });
    $('om-file-form').addEventListener('submit', e => { e.preventDefault(); run(upload); });
    $('om-campaign-form').addEventListener('submit', e => { e.preventDefault(); run(createCampaign); });
    $('om-operation-form').addEventListener('submit', e => { e.preventDefault(); run(control); });
    $('om-operation').addEventListener('change', operationFields);
    const f=$('om-agent-form');
    f.elements.voice_provider.addEventListener('change',()=>{voices=[];f.elements.voice_id.innerHTML='<option value="">Load voices for this provider</option>';voiceSample();});
    f.elements.voice_id.addEventListener('change',voiceSample);
    f.elements.voice_gender.addEventListener('change',()=>{voices=[];f.elements.voice_id.innerHTML='<option value="">Load voices for this preference</option>';voiceSample();});
    f.elements.stt.addEventListener('change',()=>{f.elements.stt_language.value=f.elements.stt.value==='deepgram_stream'?'hi':f.elements.stt.value==='soniox'?'multi':'hi-IN';});
  }
  function showTab(name) { $('vp-omnidimension').querySelectorAll('[data-om-panel]').forEach(p => p.hidden = p.dataset.omPanel !== name); $('vp-omnidimension').querySelectorAll('[data-om-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.omTab === name))); }
  function object(text, label = 'JSON') { if (!text?.trim()) return {}; let out; try { out = JSON.parse(text); } catch (_) { throw new Error(`${label}: enter valid JSON.`); } if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error(`${label}: use a JSON object.`); return out; }
  function requireAgent() { checkSession(); if (!selected) throw new Error('Save or select an agent first.'); return selected; }
  function rows(data, key) { return Array.isArray(data?.[key]) ? data[key] : []; }
  function wallet(data) { const b=data.balance || {}; $('om-wallet').textContent = `Balance: ${b.amount ?? '—'} ${b.currency || ''} · Estimated AI minutes: ${data.estimated_minutes_remaining ?? '—'} · Available concurrent calls: ${data.concurrency?.available ?? '—'} · Plan: ${data.plan?.name || '—'}`; }
  let agentPage=1, logPage=1, agentTotal=0, logTotal=0;
  async function agents() {
    const data = await api('GET','/agents',null,{pageno:agentPage,pagesize:20,...($('om-search').value.trim()?{name:$('om-search').value.trim()}:{})});
    agentTotal = data.total_records || 0; $('om-agent-page').textContent=`Page ${agentPage}`;
    $('om-agents').innerHTML = rows(data,'bots').map(a=>`<button type="button" class="om-agent" data-om-action="edit" data-id="${Number(a.id)}" aria-pressed="${Number(a.id)===selected}"><strong>${esc(a.name)}</strong><span>Agent ${Number(a.id)} · ${esc(a.status || 'Available')}</span></button>`).join('') || 'No agents yet. Create your first agent.';
  }
  function agentLabel() { $('om-agent-id').textContent=selected?`Agent ${selected}`:'New agent'; $('om-selected').textContent=selected?`${$('om-agent-form').elements.name.value} · Agent ${selected}`:'Save or select an agent first.'; }
  function newAgent() { stop(); selected=null; originalSections=[]; $('om-agent-form').reset(); agentLabel(); }
  async function edit(id) {
    const data=await api('GET',`/agents/${Number(id)}`); selected=Number(id); const f=$('om-agent-form'); f.reset();
    originalSections=(data.context_breakdown || []).map(s=>({title:s.context_title ?? s.title ?? 'Instructions',body:s.context_body ?? s.body ?? '',is_enabled:s.is_enabled!==false}));
    f.elements.name.value=data.name || ''; f.elements.welcome_message.value=data.welcome_message || '';
    f.elements.natural_style.checked=originalSections.some(s=>s.title===STYLE_TITLE && s.is_enabled);
    f.elements.instructions.value=originalSections.find(s=>s.title!==STYLE_TITLE)?.body || data.context || '';
    f.elements.tune_audio.checked=false;
    f.elements.stt.value=data.asr_service || 'sarvam';
    f.elements.silence.value=data.silence_timeout || 300; f.elements.interrupt_words.value=data.interruption_min_words || 3;
    f.elements.greeting_interrupt.checked=data.is_welcome_message_interruption!==false;
    voiceSample();
    f.elements.languages.value=(data.languages || []).map(l=>typeof l==='string'?l:l.label || l.value).join(', ') || 'Hindi, English (India)';
    f.elements.call_type.value=data.bot_call_type || 'Outgoing'; f.elements.timezone.value=data.timezone || 'Asia/Kolkata';
    f.elements.interrupt.checked=data.is_interruption_allowed!==false; f.elements.dynamic_greeting.checked=!!data.is_welcome_message_dynamic;
    f.elements.temperature.value=data.llm_temperature ?? 0.5; f.elements.speed.value=data.speech_speed || 1;
    option(f.elements.model,data.llm_service?.name || data.llm_service || '',data.llm_service?.name || data.llm_service || '');
    f.elements.voice_provider.value=data.voice_provider?.name || data.voice_provider || '';
    option(f.elements.voice_id,data.voice_external_id || '',data.voice_name || data.voice_external_id || '');
    // Do not flatten/discard the other prompt sections on edit.
    f.elements.variables.value=JSON.stringify(data.dynamic_variables || {},null,2);
    f.elements.max_duration.value=data.max_call_duration_in_sec || 180; f.elements.end_condition.value=data.end_call_condition || ''; f.elements.end_message.value=data.end_call_message || '';
    agentLabel(); showTab('agents'); say('Agent loaded. Other context sections and omitted provider settings are preserved.');
  }
  function option(select,value,label) { if (!value) return; if (![...select.options].some(o=>o.value===String(value))) select.add(new Option(String(label),String(value))); select.value=String(value); }
  async function catalogs() { const current=$('om-agent-form').elements.model.value; const data=await api('GET','/providers/llms'); rows(data,'llms').forEach(m=>option($('om-agent-form').elements.model,m.name,m.name)); $('om-agent-form').elements.model.value=current; }
  function voiceSample() {
    const f=$('om-agent-form'),item=voices.find(v=>(v.name || v.external_id)===f.elements.voice_id.value),audio=$('om-voice-sample');
    audio.pause(); audio.removeAttribute('src'); audio.hidden=true;
    if(item?.sample_url && /^https:\/\//.test(item.sample_url)){audio.src=item.sample_url;audio.hidden=false;}
    $('om-voice-note').textContent=item?`${item.display_name || item.name} · ${item.description || (audio.hidden?'No sample supplied by provider. Test in the browser.':'Press play to preview this voice.')}`:'Load voices to listen to real provider samples. Nothing plays automatically.';
  }
  async function loadVoices() {
    const f=$('om-agent-form'),provider=f.elements.voice_provider.value,female=f.elements.voice_gender.value==='female';
    const data=await api('GET','/providers/voices',null,{page:1,page_size:100,...(provider?{provider}:{}),...(provider==='eleven_labs'&&female?{gender:'female',language:'hi'}:{})});
    voices=rows(data,'voices').filter(v=>['sarvam','eleven_labs','cartesia','google'].includes(v.service) && (!provider || v.service===provider));
    if(female && provider!=='eleven_labs')voices=voices.filter(v=>/\bfemale\b/i.test([...(v.tags || []),v.description || ''].join(' ')));
    const current=f.elements.voice_id.value; f.elements.voice_id.innerHTML='<option value="">Choose a voice</option>';
    voices.forEach(v=>{const external=v.name || v.external_id;if(external)f.elements.voice_id.add(new Option(`${v.display_name || v.name} · ${v.service}`,String(external)));});
    if(voices.some(v=>(v.name || v.external_id)===current))f.elements.voice_id.value=current;
    voiceSample();say(voices.length?`Loaded ${voices.length} matching voices. Choose one and listen to its sample.`:'No voices match this preference in the first 100. Try ElevenLabs for the female/Hindi filter, or choose All voices.');
  }
  async function preset(name) {
    const f=$('om-agent-form');f.elements.tune_audio.checked=true;f.elements.noise.checked=true;f.elements.interrupt_words.value=3;
    f.elements.silence.value=name==='fast'?200:name==='steady'?650:300;
    if(name==='natural'){
      f.elements.natural_style.checked=true;f.elements.speed.value=1;f.elements.temperature.value=0.35;f.elements.interrupt.checked=true;
      f.elements.greeting_interrupt.checked=true;f.elements.languages.value='Hindi, English (India)';f.elements.stt.value='sarvam';f.elements.stt_language.value='hi-IN';
      option(f.elements.model,'gpt-4.1-mini','GPT-4.1 Mini');
      f.elements.voice_provider.value='eleven_labs';f.elements.voice_provider.dispatchEvent(new Event('change',{bubbles:true}));f.elements.voice_gender.value='female';
      if(!f.elements.welcome_message.value)f.elements.welcome_message.value='नमस्ते, मैं Rudra24 की AI असिस्टेंट हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?';
      if(connected){await loadVoices();if(voices.length)f.elements.voice_id.value=voices[0].name || voices[0].external_id;voiceSample();}
    }
    say('Draft settings updated. '+(name==='natural'&&!connected?'Connect your account and load a female voice, then ':'Review the voice and ')+ 'Save agent to apply.');
  }
  async function save() {
    const f=$('om-agent-form'),v=name=>f.elements[name].value.trim();
    const sections=originalSections.filter(s=>s.title!==STYLE_TITLE).map(s=>({...s}));
    if(!sections.length)sections.push({title:'Custom instructions',body:'',is_enabled:true});
    sections[0].body=v('instructions');
    if(f.elements.natural_style.checked)sections.push({title:STYLE_TITLE,body:STYLE,is_enabled:true});
    const extra=object(v('advanced'),'Extra API settings');
    if(extra.context_breakdown && f.elements.natural_style.checked)extra.context_breakdown=[...extra.context_breakdown.filter(s=>s.title!==STYLE_TITLE),{title:STYLE_TITLE,body:STYLE,is_enabled:true}];
    const payload={...extra,name:v('name'),welcome_message:v('welcome_message'),context_breakdown:extra.context_breakdown || sections,call_type:v('call_type'),timezone:v('timezone'),languages:v('languages').split(',').map(x=>x.trim()).filter(Boolean),is_interruption_allowed:f.elements.interrupt.checked,is_welcome_message_dynamic:f.elements.dynamic_greeting.checked};
    if(v('variables')) payload.dynamic_variables=object(v('variables'),'Dynamic variables');
    payload.model={...(extra.model || {}),...(v('model')?{model:v('model')}:{ }),temperature:Number(v('temperature'))};
    payload.voice={...(extra.voice || {}),speech_speed:Number(v('speed'))}; const voice=v('voice_id'),provider=v('voice_provider');
    if(voice) { const item=voices.find(x=>(x.name || x.external_id)===voice); if(!provider&&!item?.service) throw new Error('Choose the voice provider for this voice.'); payload.voice={...(extra.voice || {}),provider:provider || item.service,voice_id:voice,speech_speed:Number(v('speed'))}; }
    else if(provider && !selected)throw new Error('Load available voices and select one before saving this voice provider.');
    if(v('end_condition') || v('end_message')) payload.end_call={enabled:true,...(extra.end_call || {}),...(v('end_condition')?{condition:v('end_condition')}:{ }),...(v('end_message')?{message:v('end_message')}:{ })};
    // Only send transcriber on explicit configuration; never silently replace
    // an imported agent's provider/model with guessed defaults.
    payload.transcriber={...(extra.transcriber || {}),max_call_duration_in_sec:Number(v('max_duration'))};
    if(f.elements.tune_audio.checked){
      payload.transcriber={...payload.transcriber,provider:v('stt'),language:v('stt_language'),silence_timeout_ms:Number(v('silence')),interruption_min_words:Number(v('interrupt_words')),should_apply_noise_reduction:f.elements.noise.checked};
      if(v('stt')==='deepgram_stream')payload.transcriber.model='nova-3';else delete payload.transcriber.model;
      payload.is_welcome_message_interruption=f.elements.greeting_interrupt.checked;
    }
    const result=await api(selected?'PUT':'POST',selected?`/agents/${selected}`:'/agents/create',payload);
    if(!Number.isSafeInteger(Number(result.id)) || Number(result.id)<1) throw new Error('Provider did not return an agent ID. Refresh agents before retrying.');
    selected=Number(result.id); originalSections=sections; agentLabel(); await agents(); say(`Agent ${selected} saved in OmniDimension. You can test it now.`);
  }
  async function numbers() {
    const data=await api('GET','/phone_number/list',null,{pageno:1,pagesize:100}); const list=rows(data,'phone_numbers');
    $('om-numbers').innerHTML=list.map(n=>`<div class="om-item"><div><strong>${esc(n.phone_number || n.exotel_phone_number || n.name)}</strong><span>Agent ${esc(n.active_bot_id?.id || n.active_bot_id || 'not attached')} · ${esc(n.number_provider || '')}</span></div><button type="button" data-om-action="attach-number" data-id="${Number(n.id)}">Attach to selected agent</button><button type="button" data-om-action="detach-number" data-id="${Number(n.id)}">Detach</button></div>`).join('') || 'No numbers found. Browser testing is available before purchasing a number.';
    for(const [id,placeholder] of [['om-from','Platform default (if available)'],['om-campaign-number','Choose your number']]) { const select=$(id),current=select.value; select.innerHTML=`<option value="">${placeholder}</option>`; list.forEach(n=>select.add(new Option(n.phone_number || n.exotel_phone_number || n.name,String(n.id)))); select.value=current; }
  }
  async function start() {
    const agent=requireAgent(), started=++voiceEpoch; if(session) throw new Error('End the current conversation first.');
    if(!confirm('Start a voice test with this agent? This uses your OmniDimension balance and microphone.')) return;
    if(!window.OmnidimensionClient) await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/omnidimension/client-0.1.0.js';script.onload=resolve;script.onerror=()=>reject(new Error('Voice SDK could not load.'));document.head.appendChild(script);});
    const data=await api('POST','/sessions/create',{agent_id:agent,type:'voice',custom_variables:object($('om-context').value,'Call context')},null,true);
    if(started!==voiceEpoch || !token() || $('vp-omnidimension').hidden || !$('view-voice-ai').classList.contains('active')) return;
    $('om-transcript').replaceChildren(); muted=false; $('om-mute').textContent='Mute';
    const current=new window.OmnidimensionClient.WebSession(); session=current;
    let turn=null;
    current.on('status',s=>{ if(session!==current)return; $('om-web-state').textContent=typeof s==='string'?`Conversation: ${s}`:`Conversation ended: ${s.reason || s.state}`; if(s?.state==='ended') {current.stop();session=null;} });
    current.on('error',()=>{if(session===current) say('Voice connection had an error. Check microphone permission and account balance.',true);});
    current.on('transcript',t=>{if(session!==current)return; if(!turn || turn.dataset.role!==t.role || turn.dataset.final==='true') {turn=document.createElement('p');turn.dataset.role=t.role;$('om-transcript').append(turn);} turn.textContent=`${t.role==='agent'?'Agent':'You'}: ${t.text}`; turn.dataset.final=String(t.final);turn.scrollIntoView({block:'nearest'});});
    try { await current.start({wsUrl:data.ws_url}); if(session!==current || started!==voiceEpoch) current.stop(); } catch(_) { stop(); throw new Error('Voice test could not start. Allow microphone access and check your balance.'); }
  }
  function stop() { $('om-voice-sample')?.pause(); voiceEpoch++; const old=session; session=null; old?.stop(); if($('om-web-state')) $('om-web-state').textContent='Conversation ended. Microphone is off.'; }
  async function call() {
    const id=requireAgent(); if(uncertain) throw new Error('The last request was not confirmed. Refresh logs and check the provider request before placing another call.');
    if(!$('om-call-consent').checked) throw new Error('Confirm calling authorization first.');
    const to=$('om-to').value.trim(); if(!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('Enter an international phone number, e.g. +919876543210.');
    if(!confirm(`Place a real call to ${to} with agent ${id}? Provider AI and telephony charges apply.`)) return;
    const body={agent_id:id,to_number:to,call_context:object($('om-context').value,'Call context')}; if($('om-from').value)body.from_number_id=Number($('om-from').value);
    const data=await api('POST','/calls/dispatch',body,null,true); $('om-call-result').textContent=`Request ${data.requestId ?? data.request_id ?? 'accepted'}: ${data.status || 'dispatched'}. Queued by provider; refresh logs to check connection.`; $('om-call-consent').checked=false; say('Call request accepted. It has not yet been confirmed connected.');
  }
  async function logs() {
    const data=await api('GET','/calls/logs',null,{pageno:logPage,pagesize:20,...(selected?{agentid:selected}:{}),...($('om-log-filter').value?{call_status:$('om-log-filter').value}:{})}); logTotal=data.total_records || 0;
    $('om-log-page').textContent=`Page ${logPage}`; $('om-logs').innerHTML=rows(data,'call_log_data').map(c=>`<button type="button" class="om-item om-log" data-om-action="call-detail" data-id="${Number(c.id)}"><strong>${esc(c.to_number)} · ${esc(c.bot_name)}</strong><span>${esc(c.call_status)} · ${esc(c.call_duration)} · ${esc(c.time_of_call)}</span></button>`).join('') || 'No calls on this page.';
    if(uncertain) say('Logs refreshed. An unconfirmed request can still be processing; reconnect only after checking it.');
  }
  async function callDetail(id) {
    const data=await api('GET',`/calls/logs/${Number(id)}`); const c=rows(data,'call_log_data')[0] || data;
    const host=$('om-call-detail'); host.replaceChildren(); const p=document.createElement('p'); p.textContent=`Status: ${c.call_status || '—'} · Sentiment: ${c.sentiment_score || '—'} · Estimated cost: ${c.aggregated_estimated_cost ?? '—'} · Duration: ${c.call_duration || '—'}`;host.append(p);
    if(c.call_conversation) {const transcript=document.createElement('pre');transcript.className='om-result';transcript.textContent=String(c.call_conversation).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');host.append(transcript);}
    if(c.extracted_variables) {const extracted=document.createElement('pre');extracted.className='om-result';extracted.textContent=JSON.stringify(c.extracted_variables,null,2);host.append(extracted);}
    const recording=c.recording_url || c.internal_recording_url; if(typeof recording==='string' && /^https:\/\//.test(recording)) {const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=recording;host.append(audio);}
  }
  async function shop() {
    const f=$('om-shop-form'),region=f.elements.region.value,carrier=f.elements.carrier.value.trim();
    const data=await api('GET','/phone_number/search',null,{region,carrier,pattern:f.elements.pattern.value.trim(),page:1,limit:20});
    $('om-shop').replaceChildren(); for(const n of rows(data,'numbers')) { const row=document.createElement('div');row.className='om-item';const label=document.createElement('span');label.textContent=`${n.phone_number} · $${n.monthly_rental_usd ?? 'price not provided'} / ${n.validity_days || 30} days · ${n.kyc_required?'KYC required':'Check verification'}`;row.append(label);const b=document.createElement('button');b.type='button';b.textContent='Review & purchase';b.addEventListener('click',()=>run(async()=>{if(n.monthly_rental_usd==null)throw new Error('Price is unavailable; review the carrier price before purchasing.');if(!confirm(`Purchase ${n.phone_number} for $${n.monthly_rental_usd} rental for ${n.validity_days || 30} days? Extra call charges and carrier terms apply. KYC may be required.`))return;await api('POST','/phone_number/purchase',{region:data.region || region,carrier:data.carrier || carrier,phone_number:n.phone_number},null,true);await numbers();say('Purchase request completed. Check your number and KYC status.');}));row.append(b);$('om-shop').append(row); }
    if(!rows(data,'numbers').length) $('om-shop').textContent='No numbers available for this search.';
  }
  async function files() { const data=await api('GET','/knowledge_base/list'); const list=rows(data,'files'); $('om-files').innerHTML=list.map(f=>`<div class="om-item"><span>${esc(f.original_filename || f.name)} · ${esc(f.upload_status || '')}</span><button type="button" data-om-action="attach-file" data-id="${Number(f.id)}">Attach to agent</button><button type="button" data-om-action="detach-file" data-id="${Number(f.id)}">Detach</button><button type="button" data-om-action="delete-file" data-id="${Number(f.id)}">Delete file</button></div>`).join('') || 'No knowledge files found.'; }
  async function upload() {
    const file=$('om-file').files[0]; if(!file || file.size>2*1024*1024 || !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file up to 2 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new Error('The file is not a PDF.');
    await api('POST','/knowledge_base/can_upload',{file_size:file.size,file_type:'pdf'});
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read PDF.'));reader.readAsDataURL(file);});
    await api('POST','/knowledge_base/create',{file:encoded,filename:file.name});$('om-file').value='';await files();say('PDF uploaded. Wait for processing, then attach it to your agent.');
  }
  async function campaigns() { const data=await api('GET','/calls/bulk_call',null,{pageno:1,pagesize:20}); $('om-campaigns').innerHTML=rows(data,'records').map(c=>`<div class="om-item"><span>${esc(c.name)} · ${esc(c.status)} · ${c.completed_calls || 0}/${c.total_calls || 0} calls</span>${['start','pause','resume','results','cancel'].map(a=>`<button type="button" data-om-action="campaign-${a}" data-id="${Number(c.id)}">${a[0].toUpperCase()+a.slice(1)}</button>`).join('')}</div>`).join('') || 'No campaigns on the first page. More controls provides full pagination.'; }
  async function createCampaign() {
    const agent=requireAgent(), f=$('om-campaign-form');const contacts=f.elements.contacts.value.split(/\r?\n/).map(n=>n.trim()).filter(Boolean);
    if(contacts.length>1000 || contacts.some(n=>!/^\+[1-9]\d{7,14}$/.test(n))) throw new Error('Use up to 1,000 international phone numbers, one per line.');
    const data=await api('POST','/calls/bulk_call/create',{name:f.elements.name.value.trim(),phone_number_id:f.elements.number.value,bot_id:agent,contact_list:contacts.map(phone_number=>({phone_number})),concurrent_call_limit:Number(f.elements.concurrency.value),timezone:'Asia/Kolkata',save_as_draft:true});await campaigns();say(`Campaign ${data.id} saved as a draft. No calls started.`);
  }
  async function loadControls() {if(contract.length)return; const res=await fetch('/omnidimension-contract.json');if(!res.ok)throw new Error('API controls could not load.');contract=await res.json();$('om-operation').innerHTML='<option value="">Choose an operation</option>'+contract.map((o,i)=>`<option value="${i}">${esc(o.name)} (${o.method})</option>`).join('');}
  function operationFields() {
    const op=contract[Number($('om-operation').value)]; const host=$('om-operation-fields');host.replaceChildren();if($('om-operation').value===''||!op)return;
    const label=(key,text,type='text',value='',required=false)=>{const l=document.createElement('label');l.textContent=text;const input=document.createElement(type==='json'?'textarea':'input');input.name=key;if(type==='json'){input.rows=5;input.spellcheck=false;input.value=value;}else{input.type=type;input.value=value;}input.required=required;l.append(input);host.append(l);};
    for(const match of op.path.matchAll(/\{([^}]+)\}/g))label('path:'+match[1],match[1].replaceAll('_',' '),'number',match[1]==='agent_id'&&selected?selected:'',true);
    for(const [key,spec] of Object.entries(op.query))label('query:'+key,key.replaceAll('_',' '),spec.schema.type==='integer'?'number':'text','',spec.required);
    const props=op.schema.properties || op.schema.allOf?.flatMap(x=>Object.entries(x.properties || {}));
    if(op.method!=='GET' && op.method!=='DELETE' && (props || op.schema.required))label('payload','Request settings (JSON)','json',JSON.stringify(Object.keys(op.example || {}).length?op.example:defaultsFor(op.schema),null,2));
    $('om-operation-result').textContent='';
  }
  function defaultsFor(schema) {
    if(schema.allOf)return Object.assign({},...schema.allOf.map(defaultsFor));
    const out={}; for(const [key,v] of Object.entries(schema.properties || {})) if((schema.required || []).includes(key)) out[key]=key==='agent_id'&&selected?selected:v.enum?.[0] ?? (v.type==='integer'?1:v.type==='boolean'?false:v.type==='array'?[]:v.type==='object'?{}:'');return out;
  }
  async function control() {
    const op=contract[Number($('om-operation').value)];if($('om-operation').value===''||!op)throw new Error('Choose an operation first.');const f=$('om-operation-form');let path=op.path;const query={};
    for(const input of f.elements) {if(input.name?.startsWith('path:'))path=path.replace('{'+input.name.slice(5)+'}',String(Number(input.value)));if(input.name?.startsWith('query:')&&input.value) {const key=input.name.slice(6),type=op.query[key].schema.type;query[key]=type==='integer'?Number(input.value):type==='boolean'?input.value==='true':input.value;}}
    const body=f.elements.payload?object(f.elements.payload.value,'Request settings'):{};
    if(op.method!=='GET'&&!confirm(`Run “${op.name}”? This changes your provider account. Calls, simulations and purchases may incur charges. Review all request settings before continuing.`))return;
    const data=await api(op.method,path,body,query,op.method!=='GET');$('om-operation-result').textContent=JSON.stringify(data,null,2);say(`${op.name}: provider response received.`);
  }
  async function action(name,id) {
    if(name==='signin'){say('Opening secure Google sign-in…');const result=await window.SupabaseAuth.signInWithGoogle();if(!result.success)throw new Error(result.error);return;}
    if(['natural','fast','steady'].includes(name))return preset(name);
    if(name==='refresh')return refresh(true);
    if(name==='new'){newAgent();return;}
    if(name==='test-tab'){requireAgent();showTab('test');return;}
    if(name==='connect'){const key=$('om-key').value.trim();if(!key)throw new Error('Paste your OmniDimension API key first.');stop();say('Checking your key with OmniDimension…'); const data=await request({action:'connect',secret:key});reset();connected=true;wallet(data.account);await refresh(true);return;}
    if(name==='disconnect'){await request(null,'DELETE');reset();say('Account disconnected. Provider agents remain in your OmniDimension account.');return;}
    if(name==='edit')return edit(id);
    if(name==='agents'){agentPage=1;return agents();}
    if(name==='agents-prev'){agentPage=Math.max(1,agentPage-1);return agents();}
    if(name==='agents-next'){if(agentPage*20<agentTotal)agentPage++;return agents();}
    if(name==='voices')return loadVoices();
    if(name==='numbers')return numbers();
    if(name==='web-start')return start();
    if(name==='logs')return logs();
    if(name==='logs-prev'){logPage=Math.max(1,logPage-1);return logs();}
    if(name==='logs-next'){if(logPage*20<logTotal)logPage++;return logs();}
    if(name==='call-detail')return callDetail(id);
    if(name==='files')return files();
    if(name==='campaigns')return campaigns();
    if(name==='delete-agent'){const agent=requireAgent();if(!confirm(`Permanently delete agent ${agent}? Attached calling flows may stop working.`))return;await api('DELETE',`/agents/${agent}`,{},null,true);newAgent();await agents();say('Agent deleted.');return;}
    if(name==='attach-number'){const agent=requireAgent();if(!confirm(`Attach number ${id} to agent ${agent}? Incoming callers will reach this agent.`))return;await api('POST','/phone_number/attach',{phone_number_id:Number(id),agent_id:agent});await numbers();say('Number attached.');return;}
    if(name==='detach-number'){if(!confirm('Detach this number from its incoming agent?'))return;await api('POST','/phone_number/detach',{phone_number_id:Number(id)},null,true);await numbers();return;}
    if(name==='attach-file'||name==='detach-file'){await api('POST',name==='attach-file'?'/knowledge_base/attach':'/knowledge_base/detach',{file_ids:[Number(id)],agent_id:requireAgent()});say(name==='attach-file'?'File attached to agent.':'File detached.');return;}
    if(name==='delete-file'){if(!confirm('Permanently delete this knowledge file?'))return;await api('POST','/knowledge_base/delete',{file_id:Number(id)},null,true);await files();return;}
    if(name.startsWith('campaign-')) {const which=name.slice(9),path=`/calls/bulk_call/${Number(id)}`;if(which==='results'){const data=await api('GET',path+'/lines',null,{pagesize:20});$('om-operation-result').textContent=JSON.stringify(data,null,2);showTab('more');return;}if(!confirm(`${which} campaign ${id}? Starting or resuming places real calls and uses your balance.`))return;await api(which==='cancel'?'DELETE':which==='start'?'POST':'PUT',which==='start'?path+'/start':path,which==='pause'||which==='resume'?{action:which}:{},null,true);await campaigns();}
  }
  function reset() {
    epoch++; connected=false; identity=''; uncertain=false; newAgent(); agentPage=logPage=1; voices=[];
    for(const id of ['om-agents','om-logs','om-call-detail','om-numbers','om-files','om-shop','om-campaigns','om-operation-result','om-transcript']) $(id)?.replaceChildren();
    $('om-key').value='';$('om-file').value='';$('om-shop-form').reset();$('om-to').value='';$('om-context').value='';$('om-connected').textContent='Not connected';$('om-wallet').textContent='Connect to see your actual balance and minutes.';
    for(const id of ['om-from','om-campaign-number'])$(id).innerHTML='<option value="">Choose a number</option>';
    $('om-campaign-form').reset();$('om-operation-fields').replaceChildren();$('om-operation').value='';
  }
  async function refresh() {
    mount(); if(!$('om-status'))return;
    if(!token())await window.SupabaseAuth?.init?.();
    $('om-signin').hidden=!!token();
    if(!token()){if(connected||identity)reset();say('Sign in with Google above, then paste your OmniDimension API key.');return;}
    const now=uid();if(identity&&identity!==now)reset();identity=now;
    try {
      const status=await request(null,'GET');connected=status.connected;$('om-connected').textContent=connected?'Connected for this session':'Not connected';
      if(!connected){$('om-connect').open=true;say('Connect your API key. You can test in the browser before buying a phone number.');await loadControls();return;}
      say('Connected. Loading your account…');
      const loaded=await Promise.allSettled([api('GET','/account/balance').then(wallet),agents(),numbers(),catalogs(),loadControls()]);
      const problems=loaded.filter(r=>r.status==='rejected').map(r=>r.reason.message);
      if(problems.length){say('Account connected. '+problems.join(' '),true);return;}
      $('om-connect').open=false; say('Ready. Select an agent or create your own, then open Test & calls.');
    } catch(error){say(error.message,true);}
  }
  document.addEventListener('DOMContentLoaded',mount);
  window.addEventListener('rudra:auth-state',()=>{mount(); if(!token() || identity && uid()!==identity){reset();say('Account changed. Microphone stopped and account data cleared.');fetch('/api/omnidimension',{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'}}).catch(()=>{});}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',stop);
  // Stop audio when navigating away from the Voice Agent Studio.
  const view=$('view-voice-ai');if(view)new MutationObserver(()=>{if(!view.classList.contains('active'))stop();}).observe(view,{attributes:true,attributeFilter:['class']});
  return {refresh,stop};
})();
