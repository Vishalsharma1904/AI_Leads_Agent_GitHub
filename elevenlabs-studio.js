/* ElevenLabs calling studio. Secrets use the tenant vault; preview uses a signed URL. */
'use strict';

window.ElevenLabsStudio = (() => {
  const base = () => location.port === '8000' ? '' : (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const $ = id => document.getElementById(id);
  const state = { selected: '', dirty: true, tab: 'agent', epoch: 0, session: null, requests: new Set(), knowledge: new Set(), savedKnowledge: new Set(), tools: new Set(), savedTools: new Set(), sourceRows: [], toolRows: [], sourceType: 'text', previewSerial: 0, audioUrls: new Set(), batchRequestId: '' };
  const form = () => $('el-agent-form');
  const field = name => form()?.elements.namedItem(name);
  const token = () => window.SupabaseAuth?.getAccessToken?.() || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  function businessContext() {
    let company = '', service = '';
    try { company = String(window.AuthSystem?.getProfile?.()?.company || '').trim(); } catch (_) {}
    try { service = String(window.ClavisBusiness?.profile?.()?.service || '').trim(); } catch (_) {}
    return { company: company.slice(0, 120), service: service.slice(0, 500) };
  }
  function defaultInstructions() {
    const { company, service } = businessContext();
    return `You are the calling assistant for ${company || 'the business'}${service ? `, which provides ${service}` : ''}. Speak in natural Hindi, English or Hinglish, matching the caller. Sound like a helpful Indian business representative: warm and confident, respectful but not stiff, friendly but not overfamiliar. Use short spoken sentences and pauses. Say clearly that you are an AI calling assistant. Ask permission to take a minute, explain the relevant service in one or two simple lines, then ask one useful question at a time. Listen before responding; handle concerns calmly and never pressure someone who is not interested. Use only the business details and knowledge provided. Never invent prices, clients, results, availability or commitments. If a fact is missing, say you will confirm it. Offer a clear next step only when it fits, then thank the person and end politely.`;
  }
  function defaultGreeting() {
    const { company } = businessContext();
    return `Namaste, main ${company || 'aapki company'} ka AI calling assistant hoon. Kya abhi ek minute baat karna theek rahega?`;
  }

  function say(message, bad = false) {
    const el = $('el-status');
    if (el) { el.textContent = message; el.dataset.error = String(bad); }
  }

  async function request(path, options = {}) {
    const auth = token(), epoch = state.epoch;
    if (!auth) throw new Error('Sign in to connect your ElevenLabs calling account.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    state.requests.add(controller);
    // Every button on this panel runs through guarded(), which disables it for
    // the length of the request. Without a deadline a backend that accepts the
    // connection and then never answers (asleep, cold start, dropped by a
    // firewall) leaves that button disabled for good — which is what "the
    // buttons stop clicking" actually was. Nothing may hang forever.
    const deadline = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), Math.min(options.timeout || 35000, 35000));
    try {
      const response = await fetch(base() + path, { ...options, signal: controller.signal,
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...options.headers } });
      if (epoch !== state.epoch || auth !== token()) throw new DOMException('Account changed', 'AbortError');
      if (options.binary && response.ok) {
        const blob = await response.blob();
        if (epoch !== state.epoch || auth !== token()) throw new DOMException('Account changed', 'AbortError');
        return blob;
      }
      const data = await response.json().catch(() => ({}));
      if (epoch !== state.epoch || auth !== token()) throw new DOMException('Account changed', 'AbortError');
      if (!response.ok) { const error = new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || `Request failed (${response.status}).`); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      // An abort carries no useful message of its own, and TimeoutError must not
      // be swallowed as a cancellation the way a real AbortError is.
      if (error?.name === 'TimeoutError' || controller.signal.reason?.name === 'TimeoutError') {
        throw new Error('This request took too long. Check that the backend is running and refresh before trying again.');
      }
      if (error?.name === 'TypeError') throw new Error('Could not reach the server. Check the backend connection, then try again.');
      throw error;
    } finally { clearTimeout(deadline); state.requests.delete(controller); options.signal?.removeEventListener('abort', abort); }
  }
  const api = (path, options) => request('/api/v1/elevenlabs' + path, options);
  const post = body => ({ method: 'POST', body: JSON.stringify(body) });

  function input(name, label, value = '', type = 'text', attrs = '') {
    return `<label class="el-field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  }
  function select(name, label, options) {
    return `<label class="el-field"><span>${label}</span><select name="${name}">${options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
  }
  function check(name, label, checked = false, attrs = '') { return `<label class="el-check"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''} ${attrs}><span>${label}</span></label>`; }

  function mount() {
    const host = $('vp-elevenlabs');
    if (!host || $('el-agent-form')) return;
    host.innerHTML = `
      <div class="el-intro"><div><span class="el-eyebrow">ELEVENLABS + GROQ</span><h2>Your calling agent</h2><p>Ready-made Indian call style. Review the business details, choose a voice and save.</p></div><a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">Get API key ↗</a></div>
      <p id="el-status" class="el-status" role="status" aria-live="polite">Connect your ElevenLabs account to begin.</p>
      <div class="el-layout">
        <aside class="el-panel el-rail" aria-label="ElevenLabs account and agents">
          <h3>Connect account</h3><p class="el-note">Your API key stays encrypted on the server.</p>
          <form id="el-connect-form"><label class="el-field"><span>ElevenLabs API key</span><input id="el-key" type="password" autocomplete="off" placeholder="sk_…" required></label><button type="submit" class="el-btn">Check &amp; save</button></form>
          <p id="el-account" class="el-note">Plan and remaining credits appear after connection.</p>
          <div class="el-actions"><button type="button" class="el-btn" data-action="refresh">Refresh</button><button type="button" class="el-btn" data-action="new">New agent</button></div>
          <h3 class="el-spaced">Your agents</h3><div id="el-agents" class="el-agent-list">No saved agents.</div>
          <details class="el-spaced"><summary>Use an existing agent</summary><label class="el-field"><span>ElevenLabs agent ID</span><input id="el-import-id" autocomplete="off"></label><button type="button" class="el-btn" data-action="import">Link agent</button></details>
        </aside>
        <div class="el-panel el-workspace">
          <div class="el-tabs" role="tablist" aria-label="Voice agent setup">${[['agent', 'Agent'], ['knowledge', 'Knowledge'], ['tools', 'Tools']].map(([id, label], i) => `<button type="button" role="tab" id="el-tab-${id}" aria-controls="el-pane-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${id}">${label}</button>`).join('')}</div>
          <section id="el-pane-agent" role="tabpanel" aria-labelledby="el-tab-agent">
            <div class="el-row"><h3>Agent details</h3><span id="el-save-state" class="el-note">New agent</span></div>
            <form id="el-agent-form">
              ${input('name', 'Agent name', 'Rudra business assistant', 'text', 'required maxlength="120"')}
              <label class="el-field"><span>Call style and instructions</span><textarea name="instructions" rows="6" required minlength="10" maxlength="30000">${esc(defaultInstructions())}</textarea></label>
              <label class="el-field"><span>First message</span><textarea name="first_message" rows="2" maxlength="2000">${esc(defaultGreeting())}</textarea></label>
              <div class="el-fields">${select('language', 'Conversation language', [['hi', 'Hindi / Hinglish'], ['en', 'English'], ['ta', 'Tamil'], ['te', 'Telugu'], ['bn', 'Bengali'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese']])}${select('voice_id', 'ElevenLabs voice', [['', 'Connect account to load voices']])}</div>
              ${check('hinglish_mode', 'Natural Hindi + English conversation', true)}
              <details class="el-advanced"><summary>Voice and conversation settings</summary>
                <div class="el-fields">${select('tts_model', 'Voice model', [['eleven_flash_v2_5', 'Flash v2.5 · fast'], ['eleven_turbo_v2_5', 'Turbo v2.5'], ['eleven_multilingual_v2', 'Multilingual v2'], ['eleven_v3_conversational', 'v3 conversational']])}${select('groq_model', 'Groq intelligence', [['openai/gpt-oss-120b', 'GPT OSS 120B · reasoning'], ['openai/gpt-oss-20b', 'GPT OSS 20B · fast reasoning'], ['llama-3.3-70b-versatile', 'Llama 3.3 70B · balanced'], ['llama-3.1-8b-instant', 'Llama 3.1 8B · fastest']])}
                ${select('reasoning_effort', 'Thinking effort (GPT OSS)', [['low', 'Low · faster replies'], ['medium', 'Medium'], ['high', 'High · more thinking']])}${input('speed', 'Speaking speed', 1, 'number', 'min="0.7" max="1.2" step="0.05"')}${input('stability', 'Voice stability', 0.5, 'number', 'min="0" max="1" step="0.05"')}${input('similarity_boost', 'Voice similarity', 0.8, 'number', 'min="0" max="1" step="0.05"')}${input('temperature', 'Response creativity', 0.4, 'number', 'min="0" max="1" step="0.1"')}${input('max_tokens', 'Maximum reply tokens', 350, 'number', 'min="50" max="2000" step="50"')}${select('turn_eagerness', 'Response timing', [['normal', 'Balanced'], ['eager', 'Quick response'], ['patient', 'Patient listening']])}${input('turn_timeout', 'Wait before asking again (seconds)', 10, 'number', 'min="3" max="60"')}${input('silence_end_call_timeout', 'End after silence (seconds)', 45, 'number', 'min="10" max="300"')}${input('max_duration_seconds', 'Maximum call length (seconds)', 600, 'number', 'min="60" max="3600"')}${input('keywords', 'Names and words to recognise', '', 'text', 'placeholder="Rudra, Gurugram, housekeeping" maxlength="3000"')}</div>
                ${check('disable_first_message_interruptions', 'Finish the greeting before interruptions')}${check('speculative_turn', 'Start thinking early during pauses (may use more Groq tokens)')}
              </details>
              <details class="el-advanced"><summary>Privacy and call analysis</summary>${check('record_voice', 'Record conversations (tell your callers)')}${check('delete_transcript_and_pii', 'Delete transcript and personal data after retention')}${input('retention_days', 'Retention period (days)', 7, 'number', 'min="1" max="90"')}<label class="el-field"><span>What should a successful call achieve?</span><textarea name="evaluation_goal" rows="3" maxlength="3000" placeholder="For example: understand the staffing need and agree a useful next step."></textarea></label><p class="el-note">Recording, retention and analysis depend on your ElevenLabs plan. Review each setting before calling.</p></details>
              <div class="el-actions el-save-actions"><button type="submit" class="el-btn el-primary">Save agent</button><button type="button" class="el-btn" data-action="preview" id="el-preview-start">Talk to agent</button><button type="button" class="el-btn" data-action="stop" id="el-preview-stop" hidden>End test</button></div>
            </form>
            <div id="el-preview" class="el-preview" hidden><p class="el-note">Browser conversation · uses your ElevenLabs allowance</p><div id="el-live-log" class="el-transcript" role="log" aria-live="polite" aria-label="Live test transcript"></div></div>
          </section>
          <section id="el-pane-calls" hidden>
            <h3>Place a phone call</h3><p class="el-note">Save and test your agent, then connect your existing Exotel, Twilio or SIP number. Phone provider charges are separate; an ElevenLabs key alone does not provide a phone line.</p>
            <form id="el-call-form"><label class="el-field"><span>Call from</span><select name="phone_number_id" required><option value="">No connected phone numbers</option></select></label>${input('to_number', 'Destination phone number', '', 'tel', 'required pattern="\\+[1-9][0-9]{7,14}" placeholder="+919876543210" autocomplete="tel"')}
              <div class="el-fields">${input('user_name', 'Contact name (optional)', '', 'text', 'maxlength="120"')}${input('company', 'Company (optional)', '', 'text', 'maxlength="120"')}</div>
              <div id="el-lead-queue" class="el-agent-list"></div>${check('confirmed', 'I have checked this number and want to place this call.')}
              <div class="el-actions"><button type="submit" class="el-btn el-primary">Place call</button><button type="button" class="el-btn" data-action="phones">Refresh numbers</button><button type="button" class="el-btn" data-action="assign">Assign this agent to number</button></div>
            </form><p id="el-call-result" class="el-note" role="status"></p>
            <details class="el-advanced"><summary>Connect a phone number</summary><p class="el-note">Import a number you already own. Your provider must support ElevenLabs calling; importing alone does not provision a phone line.</p>
              <form id="el-phone-form">${select('provider', 'Phone provider', [['exotel', 'Exotel · India'], ['sip_trunk', 'SIP trunk'], ['twilio', 'Twilio']])}<div class="el-fields">${input('phone_number', 'Your provider number', '', 'tel', 'required placeholder="+919876543210"')}${input('label', 'Number label', 'Business line', 'text', 'required maxlength="120"')}</div>${check('supports_inbound', 'Also receive incoming calls on this number')}
                <div data-phone="exotel"><div class="el-fields">${input('account_sid', 'Exotel account SID')}${input('api_key', 'Exotel API key', '', 'password', 'autocomplete="off"')}${input('api_token', 'Exotel API token', '', 'password', 'autocomplete="off"')}${input('app_id', 'Exotel app ID')}${select('api_subdomain', 'Exotel region', [['api.in.exotel.com', 'India (api.in.exotel.com)'], ['api.exotel.com', 'Singapore (api.exotel.com)']])}</div></div>
                <div data-phone="sip_trunk" hidden><div class="el-fields">${input('address', 'Outbound SIP hostname', '', 'text', 'placeholder="sip.your-provider.com"')}${select('transport', 'SIP transport', [['tls', 'TLS · encrypted'], ['tcp', 'TCP'], ['udp', 'UDP'], ['auto', 'Automatic']])}${select('media_encryption', 'Audio encryption', [['allowed', 'Allow SRTP'], ['required', 'Require SRTP'], ['disabled', 'Unencrypted']])}${input('username', 'SIP username')}${input('password', 'SIP password', '', 'password', 'autocomplete="off"')}${input('inbound_allowed_addresses', 'Incoming provider IP addresses (if enabled)', '', 'text', 'placeholder="203.0.113.10, 203.0.113.0/24" maxlength="2000"')}</div><p class="el-note">For inbound routing, use the IP ranges supplied by your provider and send calls to sip.rtc.elevenlabs.io using your E.164 number.</p></div>
                <div data-phone="twilio" hidden><div class="el-fields">${input('sid', 'Twilio account SID')}${input('token', 'Twilio auth token', '', 'password', 'autocomplete="off"')}</div></div>
                <button type="submit" class="el-btn">Connect number</button>
              </form>
            </details>
            <div class="el-row el-spaced"><h3>Recent conversations</h3><button type="button" class="el-btn" data-action="conversations">Refresh</button></div><div id="el-conversations" class="el-call-list">Select a saved agent to view conversations.</div><button type="button" id="el-more-calls" class="el-btn" data-action="more-calls" hidden>Load more</button><div id="el-conversation-detail" hidden></div>
          </section>
          <section id="el-pane-knowledge" role="tabpanel" aria-labelledby="el-tab-knowledge" hidden>
            <div class="el-section-heading"><h3>Business knowledge</h3><p class="el-note">Give your agent the facts it needs. Choose which sources this agent can use.</p></div>
            <div class="el-knowledge-layout">
              <div><div class="el-row"><h4>Your sources</h4><button type="button" class="el-btn" data-action="knowledge-refresh">Refresh</button></div><div id="el-knowledge-list" class="el-knowledge-list" aria-label="Knowledge sources"><p class="el-empty">Connect your account to load sources.</p></div></div>
              <div class="el-source-editor"><h4>Add a source</h4><div class="el-source-switch" role="group" aria-label="Source type"><button type="button" data-source-type="text" aria-pressed="true">Text</button><button type="button" data-source-type="url" aria-pressed="false">Website</button></div>
                <form id="el-knowledge-form">${input('name', 'Source name', '', 'text', 'required maxlength="120" placeholder="Services and service areas"')}
                  <div data-source-editor="text"><label class="el-field"><span>Business information</span><textarea name="text" rows="6" required maxlength="100000" placeholder="Services, service areas, prices, FAQs and contact details."></textarea></label></div>
                  <div data-source-editor="url" hidden>${input('url', 'Website URL', '', 'url', 'disabled placeholder="https://your-company.com/services" maxlength="2000"')}<p class="el-note">Use a public page with the information your agent should know.</p></div>
                  <button type="submit" class="el-btn">Add source</button><p id="el-knowledge-status" class="el-note" role="status" aria-live="polite"></p>
                </form>
              </div>
            </div>
            <div class="el-resource-footer"><p id="el-source-selection" class="el-note" role="status">No sources selected.</p><button type="button" class="el-btn el-primary" data-action="save-sources">Save sources to agent</button></div>
          </section>
          <section id="el-pane-tools" role="tabpanel" aria-labelledby="el-tab-tools" hidden><div class="el-section-heading"><h3>Tools and actions</h3><p class="el-note">Let your agent take useful actions. Choose what it can do, then save your changes.</p></div>
            <div class="el-tool-basics">${check('end_call', 'End the call when the conversation is complete', true, 'form="el-agent-form"')}${check('language_detection', 'Follow the caller’s language', true, 'form="el-agent-form"')}</div>
            <div id="el-tools-list" class="el-resource-list"><p class="el-empty">Connect your account to load actions.</p></div><div class="el-actions"><button type="button" class="el-btn" data-action="app-tool" id="el-app-tool">Add app navigation</button></div><p class="el-note">App navigation opens a page during browser conversations. Phone calls use call controls and connected services.</p>
            <details class="el-advanced"><summary>Connect a service · advanced</summary><form id="el-tool-form">${input('name', 'Action name', '', 'text', 'required pattern="[A-Za-z_][A-Za-z0-9_]*" maxlength="64" placeholder="lookup_service_availability"')}<label class="el-field"><span>When should the agent use it?</span><textarea name="description" rows="3" required minlength="10" maxlength="2000"></textarea></label>${input('url', 'Service URL (HTTPS, GET)', '', 'url', 'required placeholder="https://your-service.com/availability"')}<button type="submit" class="el-btn">Add action</button></form><p class="el-note">Use a read-only endpoint. Authenticated services, transfers and workflows can also be configured in <a href="https://elevenlabs.io/app/agents" target="_blank" rel="noopener noreferrer">ElevenLabs ↗</a>.</p></details>
            <div class="el-resource-footer"><p id="el-tool-selection" class="el-note" role="status">No custom actions selected.</p><button type="button" class="el-btn el-primary" data-action="save-tools">Save actions to agent</button></div>
          </section>
        </div>
      </div>
      <section id="el-phone-settings" class="el-panel el-phone-settings"><h3>Phone number setup</h3><p class="el-note">Connect and assign your outbound line here. Call controls and conversations live in Calling Agent.</p></section>
      <dialog id="el-source-preview" class="el-source-preview" aria-labelledby="el-source-preview-name"><div class="el-row"><h3 id="el-source-preview-name">Source</h3><button type="button" class="el-btn" data-action="close-source" aria-label="Close source preview">Close</button></div><p id="el-source-preview-meta" class="el-source-meta"></p><p id="el-source-preview-status" class="el-note" role="status"></p><pre id="el-source-preview-text"></pre></dialog>`;
    const phoneDetails = $('el-pane-calls')?.querySelector('details');
    if (phoneDetails) $('el-phone-settings').append(phoneDetails);
    document.addEventListener('click', event => {
      if (!event.target.closest('#vp-elevenlabs, #el-calling-host')) return;
      const tab = event.target.closest('[data-tab]');
      if (tab) setTab(tab.dataset.tab);
      const sourceType = event.target.closest('[data-source-type]')?.dataset.sourceType;
      if (sourceType) sourceMode(sourceType);
      const action = event.target.closest('[data-action]')?.dataset.action;
      const actions = { refresh, new: newAgent, import: linkAgent, preview: startPreview, stop, phones: loadPhones, assign: assignPhone,
        conversations: () => loadConversations(), 'more-calls': () => loadConversations(state.cursor), save: save, 'save-sources': save, 'save-tools': save,
        'knowledge-refresh': loadKnowledge, 'close-source': closeSource,
        'app-tool': () => addTool({ type: 'open_page' }) };
      if (actions[action]) guarded(event.target.closest('button'), actions[action]);
    });
    host.querySelector('.el-tabs').addEventListener('keydown', event => {
      const tabs = [...host.querySelectorAll('[role="tab"]')], index = tabs.indexOf(document.activeElement);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[next].dataset.tab); tabs[next].focus();
    });
    const handlers = { 'el-connect-form': connect, 'el-agent-form': save, 'el-call-form': placeCall, 'el-phone-form': importPhone, 'el-knowledge-form': addKnowledge,
      'el-tool-form': () => addTool({ type: 'webhook', ...Object.fromEntries(new FormData($('el-tool-form'))) }) };
    for (const [id, handler] of Object.entries(handlers)) $(id).addEventListener('submit', event => { event.preventDefault(); guarded(event.currentTarget.querySelector('button[type="submit"]'), handler, id === 'el-knowledge-form' ? 'el-knowledge-status' : ''); });
    host.addEventListener('input', event => { if (event.target.form === form()) markDirty(); });
    $('el-source-preview').addEventListener('close', () => {
      state.previewSerial++; state.previewController?.abort(); state.previewController = null;
      const trigger = state.previewTrigger?.isConnected ? state.previewTrigger : $('el-knowledge-list')?.querySelector(`[data-source-id="${state.previewId || ''}"] button`);
      trigger?.focus();
    });
    $('el-phone-form').elements.provider.addEventListener('change', phoneFields);
    phoneFields(); sourceMode('text'); selectionState();
  }

  async function guarded(button, action, errorTarget = '') {
    if (button?.disabled) return;
    // aria-busy so the button visibly says "working" instead of just going
    // dead, and a hard restore in finally so it always comes back.
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try { await action(); } catch (error) { if (error.name !== 'AbortError') { say(error.message, true); if (errorTarget) inlineStatus(errorTarget, error.message, true); } }
    finally { if (button) { button.disabled = button.dataset.locked === 'true'; button.removeAttribute('aria-busy'); } }
  }
  function inlineStatus(id, text, bad = false) { const element = $(id); if (element) { element.textContent = text; element.dataset.error = String(bad); } }
  function markDirty() { state.dirty = true; state.revision = (state.revision || 0) + 1; if ($('el-save-state')) $('el-save-state').textContent = 'Unsaved changes'; selectionState(); }
  function differs(a, b) { return a.size !== b.size || [...a].some(id => !b.has(id)); }
  function selectionState() {
    const sourceCount = state.knowledge.size, toolCount = state.tools.size;
    inlineStatus('el-source-selection', `${sourceCount} source${sourceCount === 1 ? '' : 's'} selected${differs(state.knowledge, state.savedKnowledge) ? ' · unsaved changes' : state.selected ? ' · saved to agent' : ''}.`);
    inlineStatus('el-tool-selection', `${toolCount} custom action${toolCount === 1 ? '' : 's'} selected${differs(state.tools, state.savedTools) ? ' · unsaved changes' : state.selected ? ' · saved to agent' : ''}.`);
  }
  function sourceMode(type) {
    if (!['text', 'url'].includes(type)) return;
    state.sourceType = type;
    $('vp-elevenlabs')?.querySelectorAll('[data-source-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sourceType === type)));
    $('el-knowledge-form')?.querySelectorAll('[data-source-editor]').forEach(panel => {
      panel.hidden = panel.dataset.sourceEditor !== type;
      panel.querySelectorAll('input,textarea').forEach(control => { control.disabled = panel.hidden; control.required = !panel.hidden; });
    });
    inlineStatus('el-knowledge-status', '');
  }
  function sourcePayload(type, values) {
    const name = String(values.name || '').trim();
    if (!name) throw new Error('Give your source a name.');
    if (type === 'text') {
      const text = String(values.text || '').trim(); if (!text) throw new Error('Add the business information your agent should know.');
      return { name, text };
    }
    if (type !== 'url') throw new Error('Choose Text or Website for this source.');
    const url = String(values.url || '').trim(); let parsed;
    try { parsed = new URL(url); } catch (_) { throw new Error('Enter a complete website URL, such as https://your-company.com/services.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Use a public HTTPS website URL without a password or fragment.');
    return { name, url };
  }
  function chooseSource(id, selected) { selected ? state.knowledge.add(id) : state.knowledge.delete(id); markDirty(); }
  function setTab(tab) {
    if (!['agent', 'knowledge', 'tools'].includes(tab)) tab = 'agent';
    state.tab = tab;
    $('vp-elevenlabs')?.querySelectorAll('[role="tab"]').forEach(button => { const active = button.dataset.tab === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    for (const name of ['agent', 'knowledge', 'tools']) if ($(`el-pane-${name}`)) $(`el-pane-${name}`).hidden = name !== tab;
  }
  function selectedAgentKey() {
    const userId = window.SupabaseAuth?.getUser?.()?.id;
    return userId ? `rudra.elevenlabs.agent.${userId}` : '';
  }
  function rememberAgent(id) {
    const key = selectedAgentKey();
    if (!key) return;
    try { id ? localStorage.setItem(key, id) : localStorage.removeItem(key); } catch (_) {}
  }
  function phoneFields() {
    const phoneForm = $('el-phone-form');
    phoneForm?.querySelectorAll('[data-phone]').forEach(panel => { panel.hidden = panel.dataset.phone !== phoneForm.elements.provider.value;
      panel.querySelectorAll('input,select').forEach(control => { control.disabled = panel.hidden; }); });
  }
  function newAgent() {
    state.agentLoadSerial = (state.agentLoadSerial || 0) + 1; state.revision = (state.revision || 0) + 1;
    stop(); closeSource(); state.selected = ''; rememberAgent(''); state.knowledge.clear(); state.savedKnowledge.clear(); state.tools.clear(); state.savedTools.clear(); state.dirty = true;
    form()?.reset(); $('el-save-state').textContent = 'New agent'; setTab('agent');
    refreshLocalLists().catch(error => say(error.message, true));
  }

  async function connect() {
    const key = $('el-key');
    const secret = key.value.trim();
    if (!secret) throw new Error('Enter your ElevenLabs API key.');
    say('Checking your ElevenLabs account…');
    try { await request('/api/credentials', { method: 'PUT', body: JSON.stringify({ provider: 'elevenlabs', secret }) }); }
    finally { key.value = ''; }
    await refresh();
  }
  async function refresh() {
    mount();
    if (!$('el-agent-form')) return;
    if (!token()) return say('Sign in to connect ElevenLabs and Groq for your business.');
    const data = await api('/status');
    if (!data.connected) return say('Connect your ElevenLabs API key to begin.');
    const account = data.account || {}, used = account.character_count, limit = account.character_limit;
    $('el-account').textContent = `${account.tier || 'Connected'}${typeof used === 'number' && typeof limit === 'number' ? ` · ${Math.max(0, limit - used).toLocaleString()} of ${limit.toLocaleString()} credits remaining` : ''}. Allowance comes from your account; phone charges are separate.`;
    const loaded = await Promise.allSettled([loadVoices(), loadPhones(), refreshLocalLists()]);
    const errors = loaded.filter(result => result.status === 'rejected' && result.reason?.name !== 'AbortError');
    say(errors.length ? `Account connected. ${errors.map(result => result.reason.message).join(' ')}` : data.groq_connected ? 'ElevenLabs connected. Save an agent, then test a conversation.' : 'ElevenLabs connected. Add your Groq key in Rudra AI Setup before saving an agent.', errors.length > 0);
  }
  async function loadVoices() {
    const revision = state.revision, agentId = state.selected;
    const data = await api('/voices'), selected = field('voice_id').value;
    const picker = field('voice_id'); picker.replaceChildren(new Option('Choose a voice', ''));
    for (const voice of data.voices || []) picker.add(new Option(`${voice.name}${voice.labels?.language ? ` · ${voice.labels.language}` : ''}`, voice.voice_id));
    if (selected && ![...picker.options].some(option => option.value === selected)) picker.add(new Option('Current agent voice', selected));
    picker.value = selected || (revision === state.revision && agentId === state.selected ? data.voices?.[0]?.voice_id : '') || '';
  }
  async function refreshLocalLists() {
    const epoch = state.epoch;
    const [agentsResult] = await Promise.allSettled([api('/agents'), loadKnowledge(), loadTools()]);
    if (epoch !== state.epoch) return;
    const list = $('el-agents'); list.replaceChildren();
    if (agentsResult.status === 'rejected') { if (agentsResult.reason.name !== 'AbortError') emptyState(list, 'Your agents could not be loaded. Refresh to try again.'); return; }
    const agents = agentsResult.value;
    for (const agent of agents.agents) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = agent.name;
      button.setAttribute('aria-current', String(agent.agent_id === state.selected));
      button.addEventListener('click', () => guarded(button, () => openAgent(agent.agent_id))); list.append(button);
    }
    if (!agents.agents.length) emptyState(list, 'Create your first agent to get started.');
    if (!state.selected) {
      const saved = selectedAgentKey() ? (() => { try { return localStorage.getItem(selectedAgentKey()) || ''; } catch (_) { return ''; } })() : '';
      if (saved && agents.agents.some(agent => agent.agent_id === saved)) { await openAgent(saved); return; }
    }
    selectionState();
  }
  function emptyState(list, message) { if (!list) return; list.replaceChildren(); const note = document.createElement('p'); note.className = 'el-empty'; note.textContent = message; list.append(note); }
  async function loadKnowledge() {
    const list = $('el-knowledge-list'); list.setAttribute('aria-busy', 'true');
    if (!state.sourceRows.length) emptyState(list, 'Loading your sources…');
    try { const data = await api('/knowledge'); state.sourceRows = data.documents || []; renderSources(); }
    catch (error) { if (error.name === 'AbortError') return; emptyState(list, 'Your sources could not be loaded. Use Refresh to try again.'); inlineStatus('el-knowledge-status', error.message, true); }
    finally { list.setAttribute('aria-busy', 'false'); selectionState(); }
  }
  function sourceMeta(source) {
    const type = source.type === 'url' ? 'Website' : source.type === 'file' ? 'File' : 'Text';
    let host = '';
    if (source.url) { try { host = new URL(source.url).hostname; } catch (_) {} }
    return [type, Number.isFinite(source.characters) ? `${source.characters.toLocaleString()} characters` : host || 'Ready to view'].filter(Boolean).join(' · ');
  }
  function renderSources() {
    const list = $('el-knowledge-list'); list.replaceChildren();
    if (!state.sourceRows.length) { emptyState(list, 'No sources yet. Add your services, FAQs or a website page.'); return; }
    for (const source of state.sourceRows) {
      const row = document.createElement('div'); row.className = 'el-source-row'; row.dataset.sourceId = source.id;
      const label = document.createElement('label'); label.className = 'el-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.knowledge.has(source.id);
      checkbox.setAttribute('aria-label', `Use ${source.name} for this agent`);
      checkbox.addEventListener('change', () => chooseSource(source.id, checkbox.checked));
      const text = document.createElement('span'); text.textContent = source.name;
      const metadata = document.createElement('span'); metadata.className = 'el-source-meta'; metadata.textContent = sourceMeta(source); text.append(metadata);
      label.append(checkbox, text);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'el-btn'; button.textContent = 'View source';
      button.setAttribute('aria-label', `View source ${source.name}`);
      button.addEventListener('click', () => guarded(button, () => previewSource(source)));
      row.append(label, button); list.append(row);
    }
    selectionState();
  }
  async function previewSource(source) {
    const dialog = $('el-source-preview'), serial = ++state.previewSerial;
    state.previewController?.abort(); state.previewController = new AbortController();
    state.previewTrigger = document.activeElement; state.previewId = source.id;
    $('el-source-preview-name').textContent = source.name;
    $('el-source-preview-meta').textContent = sourceMeta(source);
    $('el-source-preview-text').textContent = '';
    inlineStatus('el-source-preview-status', 'Loading source…');
    if (!dialog.open) dialog.showModal();
    try {
      const data = await api(`/knowledge/${encodeURIComponent(source.id)}/content`, { signal: state.previewController.signal });
      if (serial !== state.previewSerial || !dialog.open) return;
      $('el-source-preview-name').textContent = data.name;
      $('el-source-preview-meta').textContent = [sourceMeta(data), data.url].filter(Boolean).join(' · ');
      $('el-source-preview-text').textContent = data.text || '';
      inlineStatus('el-source-preview-status', !data.ready ? 'This source is still being processed. Close and refresh it in a moment.' : data.truncated ? 'Showing a preview of this source. Your agent can use the full saved source.' : '');
      state.sourceRows = state.sourceRows.map(row => row.id === data.id ? { ...row, ...data, text: undefined } : row); renderSources();
    } catch (error) { if (serial === state.previewSerial && error.name !== 'AbortError') inlineStatus('el-source-preview-status', error.message, true); }
  }
  function closeSource() { state.previewSerial++; state.previewController?.abort(); state.previewController = null; $('el-source-preview')?.close?.(); }
  async function loadTools() {
    try { const data = await api('/tools'); state.toolRows = data.tools || []; resourceList('el-tools-list', state.toolRows, state.tools); }
    catch (error) { if (error.name !== 'AbortError') emptyState($('el-tools-list'), 'Your actions could not be loaded. Refresh your account to try again.'); }
    const button = $('el-app-tool');
    if (button) { const exists = state.toolRows.some(tool => tool.type === 'open_page'); button.textContent = exists ? 'App navigation added' : 'Add app navigation'; button.dataset.locked = String(exists); button.disabled = exists; }
    selectionState();
  }
  function resourceList(id, rows, selected) {
    const list = $(id); list.replaceChildren();
    if (!rows.length) { emptyState(list, 'No custom actions yet. Add app navigation or connect a service below.'); return; }
    for (const row of rows) {
      const label = document.createElement('label'); label.className = 'el-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id);
      checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(row.id) : selected.delete(row.id); markDirty(); });
      const text = document.createElement('span'); text.textContent = row.type === 'open_page' ? 'App navigation · browser conversations' : row.name; label.append(checkbox, text); list.append(label);
    }
  }
  async function linkAgent() {
    const id = $('el-import-id').value.trim(); if (!id) throw new Error('Enter your ElevenLabs agent ID.');
    await api(`/agents/${encodeURIComponent(id)}/import`, post({})); $('el-import-id').value = ''; await openAgent(id);
    markDirty(); say('Agent linked. Review its settings and save to use Groq and secure browser testing.');
  }
  async function openAgent(id) {
    const serial = state.agentLoadSerial = (state.agentLoadSerial || 0) + 1;
    const data = await api(`/agents/${encodeURIComponent(id)}`);
    if (serial !== state.agentLoadSerial) return;
    stop(); closeSource(); state.selected = id; rememberAgent(id); form().reset();
    for (const [name, value] of Object.entries(data.config)) {
      const control = field(name); if (!control) continue;
      if (control.type === 'checkbox') control.checked = !!value;
      else {
        const text = name === 'keywords' ? (value || []).join(', ') : String(value ?? '');
        if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === text)) control.add(new Option(text || 'Choose an option', text));
        control.value = text;
      }
    }
    state.knowledge = new Set(data.config.knowledge_ids || []); state.savedKnowledge = new Set(state.knowledge); state.tools = new Set(data.config.tool_ids || []); state.savedTools = new Set(state.tools);
    state.dirty = false; $('el-save-state').textContent = 'Saved agent';
    await refreshLocalLists(); await loadConversations(); say('Agent loaded. Save any edits before testing or calling.');
  }
  function config() {
    const values = Object.fromEntries(new FormData(form()));
    for (const control of form().elements) {
      if (!control.name) continue;
      if (control.type === 'checkbox') values[control.name] = control.checked;
      if (control.type === 'number') values[control.name] = Number(control.value);
    }
    values.keywords = values.keywords.split(',').map(word => word.trim()).filter(Boolean);
    values.knowledge_ids = [...state.knowledge]; values.tool_ids = [...state.tools];
    return values;
  }
  async function save() {
    if (state.saving) return;
    if (!form().checkValidity()) { setTab('agent'); form().reportValidity(); return; }
    const payload = config(), revision = state.revision, agentId = state.selected, loadSerial = state.agentLoadSerial;
    const buttons = [...$('vp-elevenlabs').querySelectorAll('[data-action="save"], [data-action="save-sources"], [data-action="save-tools"], #el-agent-form button[type="submit"]')];
    state.saving = true; buttons.forEach(button => { button.disabled = true; }); say('Saving your agent…');
    try {
      const result = await api(state.selected ? `/agents/${encodeURIComponent(state.selected)}` : '/agents',
        { method: state.selected ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (agentId !== state.selected || loadSerial !== state.agentLoadSerial) return;
      state.selected = result.agent_id; rememberAgent(state.selected); state.savedKnowledge = new Set(payload.knowledge_ids); state.savedTools = new Set(payload.tool_ids);
      state.dirty = state.revision !== revision; $('el-save-state').textContent = state.dirty ? 'Unsaved changes' : 'Saved agent';
      inlineStatus('el-knowledge-status', differs(state.knowledge, state.savedKnowledge) ? 'Your latest source selections still need saving.' : 'Source selections saved to this agent.');
      await refreshLocalLists(); selectionState();
      say(state.dirty ? 'Agent saved. Your latest edits still need saving.' : state.tab === 'knowledge' ? 'Sources saved to this agent.' : state.tab === 'tools' ? 'Actions saved to this agent.' : 'Agent saved. Talk to it here before placing a phone call.');
    } finally { state.saving = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  function savedAgent() {
    if (!state.selected || state.dirty) throw new Error('Save your agent and its latest changes first.');
    return encodeURIComponent(state.selected);
  }
  async function loadPhones() {
    const data = await api('/phones'), picker = $('el-call-form').elements.phone_number_id, selected = picker.value;
    picker.replaceChildren(new Option('Choose a connected number', ''));
    for (const number of data.phone_numbers) if (number.supports_outbound) picker.add(new Option(`${number.label || number.phone_number} · ${number.phone_number} · ${number.provider}`, number.phone_number_id));
    picker.value = selected || data.phone_numbers.find(number => number.supports_outbound)?.phone_number_id || '';
    if (picker.options.length === 1) picker.options[0].textContent = 'Connect an outbound number below';
  }
  async function importPhone() {
    const phoneForm = $('el-phone-form'), values = Object.fromEntries(new FormData(phoneForm));
    values.supports_inbound = phoneForm.elements.supports_inbound.checked;
    if ('inbound_allowed_addresses' in values) values.inbound_allowed_addresses = values.inbound_allowed_addresses.split(',').map(value => value.trim()).filter(Boolean);
    if (state.selected) values.agent_id = state.selected;
    try { await api('/phones', post(values)); }
    finally { phoneForm.querySelectorAll('input[type="password"]').forEach(control => { control.value = ''; }); }
    await loadPhones(); say('Number imported. Check its provider routing before placing a call.');
  }
  async function assignPhone() {
    savedAgent(); const id = $('el-call-form').elements.phone_number_id.value;
    if (!id) throw new Error('Choose a connected phone number.');
    await api(`/phones/${encodeURIComponent(id)}/assign`, { method: 'PATCH', body: JSON.stringify({ agent_id: state.selected }) });
    say('This number is assigned to the selected agent.');
  }
  async function placeCall() {
    savedAgent(); const callForm = $('el-call-form');
    if (!callForm.reportValidity()) return;
    if (!callForm.elements.confirmed.checked) throw new Error('Check the destination and confirm this call first.');
    const dynamic_variables = {};
    for (const name of ['user_name', 'company']) if (callForm.elements[name].value.trim()) dynamic_variables[name] = callForm.elements[name].value.trim();
    $('el-call-result').textContent = 'Sending your call request…';
    try {
      const data = await api('/calls', post({ agent_id: state.selected, phone_number_id: callForm.elements.phone_number_id.value,
        to_number: callForm.elements.to_number.value.trim(), dynamic_variables, confirmed: true }));
      const id = data.conversation_id || data.callSid || data.sip_call_id || data.call_id;
      $('el-call-result').textContent = data.success === false ? (data.message || 'ElevenLabs did not accept the call.') : `Call request accepted${id ? ` · ${id}` : ''}. Check the conversation status to see whether it connected.`;
      callForm.elements.confirmed.checked = false; await loadConversations();
    } catch (error) { $('el-call-result').textContent = 'The call outcome is unconfirmed. Refresh conversations before retrying.'; throw error; }
  }
  async function addKnowledge() {
    const knowledgeForm = $('el-knowledge-form');
    if (!knowledgeForm.reportValidity()) return;
    const values = sourcePayload(state.sourceType, Object.fromEntries(new FormData(knowledgeForm)));
    inlineStatus('el-knowledge-status', state.sourceType === 'url' ? 'Importing website…' : 'Adding source…');
    const result = await api('/knowledge', post(values)); chooseSource(result.id, true); knowledgeForm.reset(); sourceMode(state.sourceType);
    await loadKnowledge(); inlineStatus('el-knowledge-status', 'Source added and selected. Save sources to use it in this agent.');
    say('Source added. Save it to your agent when ready.');
  }
  async function addTool(values) {
    const result = await api('/tools', post(values)); state.tools.add(result.id); markDirty();
    $('el-tool-form').reset(); await loadTools(); say('Action added and selected. Save actions to use it in this agent.');
  }
  async function loadConversations(cursor = '') {
    if (!state.selected) { emptyState($('el-conversations'), 'Save and select an agent to view its conversations.'); return; }
    const agentId = state.selected;
    const data = await api(`/agents/${encodeURIComponent(agentId)}/conversations${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`);
    if (agentId !== state.selected) return;
    const list = $('el-conversations'); if (!cursor) list.replaceChildren();
    if (!data.conversations.length && !cursor) list.textContent = 'No conversations yet. Try your agent in the Agent tab.';
    for (const row of data.conversations) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'el-conversation';
      const date = row.start_time_unix_secs ? new Date(row.start_time_unix_secs * 1000).toLocaleString() : '';
      button.textContent = `${row.call_summary_title || 'Conversation'} · ${row.status || 'pending'} · ${date}${row.call_duration_secs != null ? ` · ${row.call_duration_secs}s` : ''}`;
      button.addEventListener('click', () => guarded(button, () => openConversation(row.conversation_id))); list.append(button);
    }
    state.cursor = data.next_cursor; $('el-more-calls').hidden = !data.has_more || !state.cursor;
  }
  async function callingStatus() {
    if (!state.selected) return 'ElevenLabs connected calling studio: select a saved agent to see its calls.';
    const data = await api(`/agents/${encodeURIComponent(state.selected)}/conversations`);
    const counts = {};
    for (const row of data.conversations) counts[row.status || 'pending'] = (counts[row.status || 'pending'] || 0) + 1;
    return `${data.conversations.length} recent ElevenLabs conversations${data.has_more ? ' (more available)' : ''}${Object.keys(counts).length ? ': ' + Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ') : '. No calls recorded for this agent yet.'}`;
  }
  function batchConfiguration() {
    const callForm = $('el-call-form');
    return { agentReady: Boolean(state.selected && !state.dirty), agentName: $('el-agents')?.querySelector(`[aria-current="true"]`)?.textContent || '',
      phoneNumberId: callForm?.elements.phone_number_id.value || '' };
  }
  async function submitBatch(leads) {
    const agent_id = savedAgent(), callForm = $('el-call-form');
    if (!callForm) throw new Error('Calling Agent page open karke phir batch submit karein.');
    if (!callForm.elements.phone_number_id.value) throw new Error('Voice AI Setup me outbound phone number connect karke Calling Agent me select karein.');
    if (!Array.isArray(leads) || !leads.length || leads.length > 200) throw new Error('Batch me 1 se 200 selected leads honi chahiye.');
    const recipients = leads.map(lead => {
      const phone_number = window.SarvamCalling?.normalizePhone?.(lead.phone || lead.mobile || lead.contactNumber) || '';
      if (!phone_number) throw new Error('Har selected lead ka valid international phone number hona chahiye.');
      const dynamic_variables = {};
      for (const [name, value] of Object.entries({ user_name: lead.contactName || lead.contact_name, company: lead.company || lead.name, city: lead.city })) {
        if (value) dynamic_variables[name] = String(value).slice(0, 1000);
      }
      return { phone_number, dynamic_variables };
    });
    const request_id = state.batchRequestId || (crypto.randomUUID?.() || `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    state.batchRequestId = request_id;
    let result;
    try {
      result = await api('/batch-calls', post({ request_id, agent_id: decodeURIComponent(agent_id), phone_number_id: callForm.elements.phone_number_id.value,
        call_name: `Rudra lead batch ${new Date().toLocaleDateString('en-CA')}`, recipients, confirmed: true }));
    } catch (error) {
      if (error.status >= 400 && error.status < 500) state.batchRequestId = '';
      throw error;
    }
    if (!result.uncertain) state.batchRequestId = '';
    return result;
  }
  const loadBatchCalls = () => api('/batch-calls');
  async function refreshBatchCall(id) {
    const job = await api(`/batch-calls/${encodeURIComponent(id)}`);
    if (job?.batch_id && !job.uncertain && state.batchRequestId === id) state.batchRequestId = '';
    return job;
  }
  const cancelBatchCall = id => api(`/batch-calls/${encodeURIComponent(id)}/cancel`, post({}));
  async function openConversation(id, panel = $('el-conversation-detail')) {
    const data = await api(`/conversations/${encodeURIComponent(id)}`);
    if (!panel?.isConnected && panel !== $('el-conversation-detail')) return;
    panel.querySelector('audio')?.pause();
    for (const url of state.audioUrls) URL.revokeObjectURL(url); state.audioUrls.clear();
    panel.replaceChildren(); panel.hidden = false;
    const title = document.createElement('h3'); title.textContent = `Conversation · ${data.status || 'pending'}`; panel.append(title);
    const summary = document.createElement('p'); summary.className = 'el-note'; summary.textContent = data.analysis?.transcript_summary || 'Analysis will appear when ElevenLabs has completed processing.'; panel.append(summary);
    if (data.analysis?.evaluation_criteria_results) for (const item of Object.values(data.analysis.evaluation_criteria_results)) {
      const result = document.createElement('p'); result.className = 'el-note'; result.textContent = `${item.criteria_id || 'Goal'}: ${item.result || 'pending'}${item.rationale ? ' · ' + item.rationale : ''}`; panel.append(result);
    }
    const log = document.createElement('div'); log.className = 'el-transcript';
    for (const turn of data.transcript || []) { const line = document.createElement('p'); line.textContent = `${turn.role === 'agent' ? 'Agent' : 'Caller'}: ${turn.message || ''}`; log.append(line); }
    panel.append(log);
    if (data.has_audio) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'el-btn'; button.textContent = 'Load recording';
      button.addEventListener('click', () => guarded(button, async () => {
        const blob = await api(`/conversations/${encodeURIComponent(id)}/audio`, { binary: true });
        const url = URL.createObjectURL(blob); state.audioUrls.add(url);
        const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.setAttribute('aria-label', 'Conversation recording'); button.replaceWith(audio);
      })); panel.append(button);
    }
  }

  function log(role, message) {
    const list = $('el-live-log'); if (!list || !message) return;
    const line = document.createElement('p'); line.dataset.role = role; line.textContent = `${role === 'agent' ? 'Agent' : 'You'}: ${message}`; list.append(line);
    while (list.children.length > 100) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }
  function pcmBase64(audio) {
    const samples = new Float32Array(audio), pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 32768 : 32767);
    const bytes = new Uint8Array(pcm.buffer); let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function decodePcm(value) {
    const binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length % 2) throw new Error('Unexpected voice audio format.');
    return bytes.buffer;
  }
  function stop() {
    const session = state.session; state.session = null;
    if (session) {
      clearTimeout(session.timeout); session.reject?.(new DOMException('Test ended', 'AbortError'));
      session.socket?.close(); session.player?.port.postMessage({ type: 'stop' });
      session.mic?.disconnect(); session.source?.disconnect(); session.player?.disconnect();
      session.stream?.getTracks().forEach(track => track.stop());
      session.input?.close().catch(() => {}); session.output?.close().catch(() => {});
    }
    if ($('el-preview-start')) $('el-preview-start').hidden = false;
    if ($('el-preview-stop')) $('el-preview-stop').hidden = true;
  }
  async function startPreview() {
    const id = savedAgent(); if (state.session) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !Audio || !window.AudioWorkletNode || !window.ClavisWorklet?.add) throw new Error('Voice testing requires HTTPS or localhost and an AudioWorklet-capable browser.');
    // Stop the existing app microphone before taking ownership of this test.
    window.stopJarvisSpeech?.(); window.ClavisLive?.stop?.(); window.ClavisElevenSTT?.stop?.(); window.LocalSpeechEngine?.stopInput?.();
    const session = { ready: false, lastInterrupted: -1, toolCalls: new Set() }; state.session = session;
    const alive = () => state.session === session;
    const assertAlive = () => { if (!alive()) throw new DOMException('Test ended', 'AbortError'); };
    $('el-preview-start').hidden = true; $('el-preview-stop').hidden = false; $('el-preview').hidden = false; $('el-live-log').replaceChildren(); say('Preparing microphone…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); assertAlive(); }
      session.stream = stream;
      session.input = new Audio({ sampleRate: 16000 }); session.output = new Audio({ sampleRate: 16000 });
      await Promise.all([session.input.resume(), session.output.resume()]); assertAlive();
      if (session.output.sampleRate !== 16000) throw new Error('This browser cannot play 16 kHz live audio. Use a current Chromium browser.');
      await Promise.all([window.ClavisWorklet.add(session.input, 'clavis-mic-capture-worklet.js?v=2'), window.ClavisWorklet.add(session.output, 'clavis-pcm-player-worklet.js?v=3')]); assertAlive();
      session.player = new AudioWorkletNode(session.output, 'clavis-pcm-player', { outputChannelCount: [1] }); session.player.connect(session.output.destination);
      session.mic = new AudioWorkletNode(session.input, 'clavis-mic-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      session.source = session.input.createMediaStreamSource(stream); session.source.connect(session.mic); session.mic.connect(session.input.destination);
      session.mic.port.onmessage = event => {
        if (!alive() || !session.ready || event.data?.type !== 'pcm' || session.socket?.readyState !== WebSocket.OPEN) return;
        if (session.socket.bufferedAmount > 256000) { say('Connection is too slow for live voice. Test ended; try again on a stable connection.', true); stop(); return; }
        session.socket.send(JSON.stringify({ user_audio_chunk: pcmBase64(event.data.audio) }));
      };
      const data = await api(`/agents/${id}/preview`, post({})); assertAlive();
      const socket = new WebSocket(data.signed_url); session.socket = socket;
      await new Promise((resolve, reject) => {
        session.reject = reject;
        session.timeout = setTimeout(() => reject(new Error('The voice connection timed out. Check your ElevenLabs allowance and agent.')), 20000);
        socket.onopen = () => { if (alive()) socket.send(JSON.stringify({ type: 'conversation_initiation_client_data', custom_llm_extra_body: data.custom_llm_extra_body || {}, conversation_config_override: data.conversation_config_override || {} })); };
        socket.onmessage = event => {
          if (!alive()) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'conversation_initiation_metadata') {
              const metadata = message.conversation_initiation_metadata_event;
              if (metadata.user_input_audio_format !== 'pcm_16000' || metadata.agent_output_audio_format !== 'pcm_16000') throw new Error('Save this agent with the current voice settings before testing.');
              session.ready = true; clearTimeout(session.timeout); session.reject = null; resolve(); say('Live conversation connected. Speak naturally; you can interrupt the agent.');
            } else if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong', event_id: message.ping_event.event_id }));
            else if (message.type === 'audio' && (message.audio_event.event_id ?? 0) > session.lastInterrupted) {
              const audio = decodePcm(message.audio_event.audio_base_64); session.player.port.postMessage({ type: 'chunk', audio }, [audio]);
            } else if (message.type === 'interruption') {
              session.lastInterrupted = Math.max(session.lastInterrupted, message.interruption_event?.event_id ?? -1); session.player.port.postMessage({ type: 'stop' });
            } else if (message.type === 'user_transcript') log('user', message.user_transcription_event.user_transcript);
            else if (message.type === 'agent_response') log('agent', message.agent_response_event.agent_response);
            else if (message.type === 'agent_response_correction') {
              const last = [...$('el-live-log').children].reverse().find(line => line.dataset.role === 'agent');
              if (last) last.textContent = 'Agent: ' + message.agent_response_correction_event.corrected_agent_response;
            } else if (message.type === 'client_tool_call') handleTool(session, message.client_tool_call);
            else if (message.type === 'client_error') throw new Error('ElevenLabs reported a conversation error. Check the saved agent and account allowance.');
          } catch (error) { reject(error); say(error.message, true); stop(); }
        };
        socket.onerror = () => { reject(new Error('Voice connection failed. Check network access to ElevenLabs.')); if (alive()) { say('Voice connection failed.', true); stop(); } };
        socket.onclose = () => { reject(new Error('The voice connection closed. Check the agent configuration and provider allowance.')); if (alive()) { say(session.ready ? 'Conversation ended. Refresh recent conversations to review it.' : 'The voice connection closed before it was ready. Check your agent and allowance.', !session.ready); stop(); } };
      });
    } catch (error) { if (alive()) stop(); if (error.name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow it in your browser settings, then retry.'); throw error; }
  }
  function handleTool(session, call) {
    if (session.toolCalls.has(call.tool_call_id)) return;
    session.toolCalls.add(call.tool_call_id);
    let result, is_error = false;
    const page = call.parameters?.page;
    if (call.tool_name === 'open_page' && ['leads', 'crm', 'jarvis', 'calling', 'settings'].includes(page) && typeof window.showView === 'function') {
      result = `Opening ${page}. The browser voice test will end when navigating away.`;
      session.socket.send(JSON.stringify({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result, is_error }));
      window.showView(page); stop(); return;
    }
    result = 'This browser tool is unavailable.'; is_error = true;
    session.socket.send(JSON.stringify({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result, is_error }));
  }
  function resetAccount() {
    state.epoch++; for (const controller of state.requests) controller.abort(); stop();
    closeSource(); state.agentLoadSerial = (state.agentLoadSerial || 0) + 1;
    $('el-conversation-detail')?.querySelector('audio')?.pause();
    for (const url of state.audioUrls) URL.revokeObjectURL(url); state.audioUrls.clear();
    state.selected = ''; state.batchRequestId = ''; state.knowledge.clear(); state.savedKnowledge.clear(); state.tools.clear(); state.savedTools.clear(); state.sourceRows = []; state.toolRows = []; state.leads = []; state.cursor = '';
    if (form()) { form().reset(); for (const id of ['el-agents', 'el-conversations', 'el-knowledge-list', 'el-tools-list', 'el-lead-queue']) $(id).replaceChildren();
      $('el-account').textContent = 'Connect your account to see allowance.'; $('el-conversation-detail').replaceChildren(); $('el-conversation-detail').hidden = true; $('el-preview').hidden = true;
      $('el-key').value = ''; field('voice_id').replaceChildren(new Option('Connect account to load voices', '')); $('el-call-form').reset(); $('el-phone-form').reset(); $('el-knowledge-form').reset(); $('el-tool-form').reset(); phoneFields(); sourceMode('text'); $('el-call-form').elements.phone_number_id.replaceChildren(new Option('Connect an outbound number', '')); state.dirty = true;
      emptyState($('el-knowledge-list'), 'Connect your account to load sources.'); emptyState($('el-tools-list'), 'Connect your account to load actions.'); const appTool = $('el-app-tool'); appTool.dataset.locked = 'false'; appTool.disabled = false; appTool.textContent = 'Add app navigation'; selectionState();
      for (const id of ['el-source-preview-name', 'el-source-preview-meta', 'el-source-preview-status', 'el-source-preview-text']) $(id).textContent = ''; state.previewId = ''; state.previewTrigger = null; }
    say('Sign in to connect your ElevenLabs calling account.');
  }
  function mountCalling(host = $('el-calling-host')) {
    mount();
    const pane = $('el-pane-calls');
    if (!host || !pane) return false;
    pane.hidden = false;
    if (pane.parentElement !== host) host.append(pane);
    if (state.selected) { loadPhones().catch(error => say(error.message, true)); loadConversations().catch(error => say(error.message, true)); }
    return true;
  }
  function openCalling(leads = null) {
    window.VoiceProvider?.select?.('elevenlabs');
    if (location.hash !== '#calling') location.hash = '#calling';
    window.showView?.('calling'); window.SarvamCallingUI?.mount?.(); mountCalling();
    if (Array.isArray(leads)) return window.sendLeadsToCallingAgent?.(leads) || { added: 0, skipped: leads.length, provider: 'elevenlabs' };
    return { provider: 'elevenlabs' };
  }
  function attachForView() {
    mount();
    if ($('view-calling')?.classList.contains('active')) mountCalling();
  }
  function boot() { mount(); attachForView(); if (window.VoiceProvider?.current?.() === 'elevenlabs') guarded(null, refresh); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
  window.addEventListener('rudra:auth-state', () => {
    resetAccount();
    if (token()) guarded(null, refresh);
  });
  window.addEventListener('hashchange', () => { attachForView(); if (!['#voice-ai', '#calling'].includes(location.hash)) stop(); });
  window.addEventListener('clavis:workspace-change', () => { attachForView(); if (!$('view-calling')?.classList.contains('active') && !$('view-voice-ai')?.classList.contains('active')) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.session && !$('el-source-preview')?.open) { stop(); say('Browser test ended.'); $('el-preview-start')?.focus(); } });
  return { refresh: () => guarded(null, refresh), stop, request: api, reviewConversation: openConversation,
    open: () => { if (location.hash !== '#voice-ai') location.hash = '#voice-ai'; window.showView?.('voice-ai'); window.VoiceProvider?.select?.('elevenlabs'); attachForView(); }, openCalling, attachForView, mountCalling,
    submitBatch, loadBatchCalls, refreshBatchCall, cancelBatchCall, batchConfiguration, lastBatchRequest: () => state.batchRequestId,
    callingStatus,
    _selfTest: { pcmBase64, decodePcm, resetAccount, state, startPreview, handleTool, sourcePayload, chooseSource, differs, sourceMode, phoneFields, openAgent, loadVoices, previewSource, closeSource, request } };
})();
