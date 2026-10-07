'use strict';

const VoiceAI = (() => {
  const backend = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const api = `${location.port === '8000' ? '' : backend}/api/v1/toughtongue`;
  const vault = `${location.port === '8000' ? '' : backend}/api/credentials`;
  let selectedId = '';
  const $ = id => document.getElementById(id);
  const form = () => $('tt-form');
  const field = name => form().elements.namedItem(name);

  function status(message, error = false) {
    $('tt-status').textContent = message;
    $('tt-status').dataset.error = String(error);
  }

  async function request(url, options = {}) {
    const token = window.SupabaseAuth?.getAccessToken?.();
    if (!token) throw new Error('Sign in to connect a business voice agent. Local guest mode cannot store business credentials.');
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
    return data;
  }

  function jsonObject(value, label) {
    if (!value.trim()) return {};
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON.`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
    return parsed;
  }

  function configFromForm() {
    const extra = jsonObject(field('advanced').value, 'Advanced fields');
    const analysis = { ...(extra.session_analysis || {}), is_auto_analysis: field('is_auto_analysis').checked };
    return {
      ...extra,
      name: field('name').value.trim(),
      user_friendly_description: field('user_friendly_description').value.trim(),
      ai_instructions: field('ai_instructions').value.trim(),
      rubrik: field('rubrik').value.trim(),
      appearance: { ...(extra.appearance || {}), voice: field('voice').value.trim(), language_code: field('language_code').value.trim() },
      is_public: extra.is_public ?? false,
      is_recording: field('is_recording').checked,
      session_analysis: analysis
    };
  }

  function fillForm(config = {}) {
    form().reset();
    for (const name of ['name', 'user_friendly_description', 'ai_instructions', 'rubrik']) field(name).value = config[name] || '';
    field('voice').value = config.appearance?.voice || 'Aoede';
    field('language_code').value = config.appearance?.language_code || 'hi-IN';
    field('is_recording').checked = !!config.is_recording;
    field('is_auto_analysis').checked = Object.keys(config).length ? !!config.session_analysis?.is_auto_analysis : true;
    const extra = { ...config };
    for (const key of ['name', 'user_friendly_description', 'ai_instructions', 'rubrik', 'is_recording', 'appearance']) delete extra[key];
    if (extra.session_analysis) {
      extra.session_analysis = { ...extra.session_analysis };
      delete extra.session_analysis.is_auto_analysis;
      if (!Object.keys(extra.session_analysis).length) delete extra.session_analysis;
    }
    field('advanced').value = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
  }

  async function loadAgents() {
    const data = await request(`${api}/scenarios`);
    const list = $('tt-agents');
    list.replaceChildren();
    if (!data.scenarios.length) { list.textContent = 'No agents yet. Create your first agent.'; return; }
    for (const agent of data.scenarios) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = agent.name;
      button.setAttribute('aria-current', String(agent.id === selectedId));
      button.addEventListener('click', () => openAgent(agent.id));
      list.append(button);
    }
  }

  async function loadTrunks() {
    const select = $('tt-call-form').elements.namedItem('sip_trunk_id');
    select.replaceChildren(new Option('Choose SIP trunk', ''));
    const data = await request(`${api}/trunks`);
    const trunks = Array.isArray(data) ? data : data.trunks || data.data?.trunks || data.data || data.results || [];
    if (!Array.isArray(trunks)) throw new Error('Tough Tongue returned an unexpected SIP trunk list.');
    for (const trunk of trunks) {
      const id = trunk.sip_trunk_id || trunk.id || trunk._id;
      if (id) select.add(new Option(trunk.name || trunk.label || id, id));
    }
    if (select.options.length === 1) select.options[0].textContent = 'No SIP trunk configured';
  }

  async function openAgent(id) {
    try {
      const data = await request(`${api}/scenarios/${encodeURIComponent(id)}`);
      selectedId = id;
      fillForm(data.config);
      $('tt-save-state').textContent = 'Saved agent';
      closePreview();
      await loadAgents();
      await loadCalls();
      status('Agent loaded. Edit any field, then save your changes.');
    } catch (error) { status(error.message, true); }
  }

  async function connect() {
    const input = $('tt-key');
    const key = input.value.trim();
    if (!key) return status('Enter your Tough Tongue API key.', true);
    try {
      status('Connecting account…');
      await request(vault, { method: 'PUT', body: JSON.stringify({ provider: 'toughtongue', secret: key }) });
      input.value = '';
      await request(`${api}/trunks`); // Validates the saved key before claiming success.
      await loadAgents();
      await loadTrunks();
      status('Tough Tongue connected. You can create or edit an agent.');
    } catch (error) { input.value = ''; status(error.message, true); }
  }

  async function signIn() {
    try {
      const result = await window.SupabaseAuth?.signInWithGoogle?.();
      if (!result?.success) throw new Error(result?.error || 'Sign-in is unavailable. Configure Supabase on the backend.');
    } catch (error) { status(error.message, true); }
  }

  function newAgent() {
    selectedId = '';
    fillForm();
    $('tt-save-state').textContent = 'New agent';
    closePreview();
    $('tt-calls').textContent = 'Save an agent to view its calls.';
    loadAgents().catch(error => status(error.message, true));
    form().scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function importAgent() {
    const id = prompt('Paste your existing Tough Tongue scenario ID:')?.trim();
    if (!id) return;
    try {
      await request(`${api}/scenarios/${encodeURIComponent(id)}/import`, { method: 'POST' });
      await openAgent(id);
    } catch (error) { status(error.message, true); }
  }

  async function generate() {
    const context = $('tt-brief').value.trim();
    const name = field('name').value.trim() || 'Business voice agent';
    if (context.length < 10) return status('Describe your business and calling goal first.', true);
    const button = document.querySelector('#tt-brief + button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      status('Drafting agent instructions…');
      const data = await request(`${api}/generate`, { method: 'POST', body: JSON.stringify({ name, context }) });
      field('name').value = data.name;
      field('ai_instructions').value = data.ai_instructions;
      field('user_friendly_description').value = data.user_friendly_description;
      if (data.user_instructions) {
        const extra = jsonObject(field('advanced').value, 'Advanced fields');
        extra.user_instructions = data.user_instructions;
        field('advanced').value = JSON.stringify(extra, null, 2);
      }
      $('tt-save-state').textContent = 'Unsaved draft';
      status('Draft ready. Review and adjust the instructions before saving.');
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; }
  }

  async function save(event) {
    event.preventDefault();
    try {
      const config = configFromForm();
      status('Saving agent…');
      const result = await request(selectedId ? `${api}/scenarios/${selectedId}` : `${api}/scenarios`, {
        method: selectedId ? 'PUT' : 'POST', body: JSON.stringify({ config })
      });
      selectedId = result.id;
      $('tt-save-state').textContent = 'Saved agent';
      await loadAgents();
      status('Agent saved to Tough Tongue. Test it here before placing calls.');
    } catch (error) { status(error.message, true); }
  }

  async function preview() {
    if (!selectedId) return status('Save the agent before testing.', true);
    if ($('tt-save-state').textContent !== 'Saved agent') return status('Save your changes before testing.', true);
    try {
      status('Opening voice preview…');
      const data = await request(`${api}/scenarios/${selectedId}/preview`, { method: 'POST' });
      $('tt-frame').src = data.iframe_src;
      $('tt-preview').hidden = false;
      status('Voice preview ready. Allow microphone access when asked.');
    } catch (error) { status(error.message, true); }
  }

  function closePreview() {
    $('tt-frame').removeAttribute('src');
    $('tt-preview').hidden = true;
  }

  async function placeCall(event) {
    event.preventDefault();
    if (!selectedId) return status('Save and test an agent before placing a call.', true);
    const values = event.currentTarget.elements;
    const result = $('tt-call-result');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const dynamic_vars = jsonObject(values.namedItem('dynamic_vars').value, 'Call variables');
      if (Object.values(dynamic_vars).some(value => typeof value !== 'string')) throw new Error('Call variables must have text values.');
      result.textContent = 'Placing call…';
      const data = await request(`${api}/calls`, { method: 'POST', body: JSON.stringify({
        scenario_id: selectedId,
        sip_trunk_id: values.namedItem('sip_trunk_id').value,
        phone_number: values.namedItem('phone_number').value.trim(),
        user_name: values.namedItem('user_name').value.trim(), dynamic_vars
      }) });
      result.textContent = `Call requested. ID: ${data.call_id || 'pending'}. Check Tough Tongue call status before retrying.`;
      status('Call request accepted by Tough Tongue.');
      await loadCalls();
    } catch (error) { result.textContent = ''; status(error.message, true); }
    finally { button.disabled = false; }
  }

  async function loadCalls() {
    if (!selectedId) return;
    const list = $('tt-calls');
    list.textContent = 'Loading calls…';
    try {
      const data = await request(`${api}/scenarios/${selectedId}/calls`);
      const calls = Array.isArray(data) ? data : data.calls || data.data?.calls || data.data || data.results || [];
      if (!Array.isArray(calls)) throw new Error('Unexpected call list from Tough Tongue.');
      list.replaceChildren();
      if (!calls.length) { list.textContent = 'No calls for this agent yet.'; return; }
      for (const call of calls) {
        const item = document.createElement('div');
        item.className = 'tt-call-item';
        item.textContent = `${call.phone_number || call.to_number || 'Call'} · ${call.status || 'Unknown'} · ${call.call_id || call.id || ''}`;
        list.append(item);
      }
    } catch (error) { list.textContent = error.message; }
  }

  async function init() {
    form().addEventListener('submit', save);
    form().addEventListener('input', () => { $('tt-save-state').textContent = selectedId ? 'Unsaved changes' : 'Unsaved draft'; });
    $('tt-call-form').addEventListener('submit', placeCall);
    fillForm();
    for (let i = 0; i < 20 && !window.SupabaseAuth?.isInitialized?.(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    $('tt-signin').hidden = !!window.SupabaseAuth?.getAccessToken?.();
    try {
      const state = await request(`${api}/status`);
      if (!state.connected) return status('Connect your Tough Tongue account to start.');
      await loadAgents();
      await loadTrunks();
      status('Tough Tongue connected. Select an agent or create a new one.');
    } catch (error) { status(error.message, true); }
  }

  document.addEventListener('DOMContentLoaded', init);
  return { connect, signIn, newAgent, importAgent, generate, preview, closePreview, loadCalls };
})();
