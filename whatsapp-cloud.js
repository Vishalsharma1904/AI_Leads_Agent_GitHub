/* Official Meta Cloud API; credentials and delivery state belong to the backend. */
'use strict';
window.WhatsAppCloud = (() => {
  const $ = id => document.getElementById(`wa-cloud-${id}`);
  let generation = 0, templates = [], recipients = [], connection = null, busy = false, attempt = null, signup = null, sdkLoading = null;
  const requests = new Set();
  const identity = () => window.SupabaseAuth?.getUser?.()?.id || '';
  function text(id, value) { if ($(id)) $(id).textContent = value; }
  function reset() {
    generation++; templates = []; recipients = []; connection = null; busy = false; attempt = null; signup = null;
    for (const controller of requests) controller.abort(); requests.clear();
    $('connect-form')?.reset(); if ($('pin')) $('pin').value = ''; if ($('coexist')) $('coexist').checked = false; $('consent').checked = false;
    $('template').replaceChildren(); $('recipient').replaceChildren(); $('params').replaceChildren(); $('history').replaceChildren();
    $('send').disabled = true; $('disconnect').hidden = true; $('embedded').hidden = true;
    $('embedded-setup').hidden = true; $('embedded-setup').open = false;
    text('quota', ''); text('preview', ''); text('status', 'Sign in to connect your company WhatsApp number.');
  }
  async function request(path, method = 'GET', body) {
    const owner = identity(), epoch = generation, token = window.SupabaseAuth?.getAccessToken?.();
    if (!owner || !token) throw new Error('Sign in to use your company WhatsApp connection.');
    const base = location.port === '8000' ? '' : String(window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const controller = new AbortController(); requests.add(controller);
    const deadline = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 35000);
    try {
      const response = await fetch(`${base}/api/v1/whatsapp${path}`, { method, signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json().catch(() => ({}));
      if (epoch !== generation || owner !== identity()) throw new DOMException('Account changed', 'AbortError');
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `WhatsApp request failed (${response.status}).`);
      return result;
    } catch (error) {
      if (epoch !== generation || owner !== identity()) throw new DOMException('Account changed', 'AbortError');
      if (controller.signal.reason?.name === 'TimeoutError' || error.name === 'TypeError') throw new Error('Could not confirm the server response. Refresh history before retrying a send; retrying the same message reuses its request ID.');
      throw error;
    } finally { clearTimeout(deadline); requests.delete(controller); }
  }
  function leads() {
    const source = window.crmSelectedLead ? [window.crmSelectedLead] : window.crmAudience?.length ? window.crmAudience : window.UserStorage?.getJSON?.('allLeads', window.allLeads || []) || window.allLeads || [];
    const seen = new Set();
    return (Array.isArray(source) ? source : []).filter(lead => {
      const phone = String(lead.phone || '').replace(/\D/g, '');
      if (lead.phoneOptOut || phone.length < 10 || phone.length > 15 || seen.has(phone)) return false;
      seen.add(phone); return true;
    });
  }
  function refreshRecipients() {
    recipients = leads(); $('recipient').replaceChildren(new Option('Choose a recipient', ''));
    recipients.forEach((lead, index) => $('recipient').append(new Option(`${lead.company || lead.name || 'Lead'} · ${lead.phone}`, String(index))));
    $('consent').checked = false; preview();
  }
  function selectedTemplate() { return templates.find(item => `${item.name}:${item.language}` === $('template').value); }
  function selectedLead() { return $('recipient').value === '' ? null : recipients[Number($('recipient').value)]; }
  function bodyText(template) { return template?.components?.find(part => part.type === 'BODY')?.text || ''; }
  function supported(template) {
    return !template?.components?.some(part => part.type === 'BUTTONS' || part.type === 'HEADER' && (part.format !== 'TEXT' || /\{\{/.test(part.text || ''))) && !/\{\{\s*[a-z_]/i.test(bodyText(template));
  }
  function parameters() {
    const template = selectedTemplate(); $('params').replaceChildren(); $('consent').checked = false;
    const numbers = [...bodyText(template).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]));
    const count = numbers.length ? Math.max(...numbers) : 0;
    for (let index = 1; index <= Math.min(count, 30); index++) {
      const label = document.createElement('label'), input = document.createElement('input');
      label.textContent = `Value {{${index}}}`; input.id = `wa-cloud-param-${index}`; input.required = true;
      input.placeholder = '{Company}, {City}, {Name} or plain text'; input.addEventListener('input', preview); label.append(input); $('params').append(label);
    }
    preview();
  }
  function values(lead) {
    return [...$('params').querySelectorAll('input')].map(input => input.value.replace(/\{(Company|City|Name)\}/gi, (_, field) => String(({ company: lead?.company, city: lead?.city, name: lead?.name || lead?.contactName })[field.toLowerCase()] || '')).trim());
  }
  function preview() {
    const template = selectedTemplate(), lead = selectedLead(), params = values(lead);
    text('preview', bodyText(template).replace(/\{\{\s*(\d+)\s*\}\}/g, (match, number) => params[Number(number) - 1] || match));
    const allowed = template && supported(template);
    text('template-note', template && !allowed ? 'Choose a template with numbered text body values. Media, buttons and named variables are not supported here yet.' : 'Only Meta-approved templates. Values can use {Company}, {City} and {Name}.');
    $('send').disabled = busy || !connection?.connected || !lead || !allowed || !$('consent').checked || params.some(value => !value) || connection.quota?.left === 0;
  }
  async function refresh() {
    if (!identity()) { reset(); return; }
    const epoch = generation;
    try {
      const status = await request('/connection'); if (epoch !== generation) return; connection = status;
      text('status', status.connected ? `Connected · ${status.display_phone_number || status.phone_number_id}` : 'Connect an authorized company WhatsApp Business number.');
      if (status.connected && status.onboarding_status && status.onboarding_status !== 'cloud_ready') {
        const sync = { sync_pending: 'Business App synchronization is pending.', sync_requested: 'Business App synchronization was requested; imported history is not confirmed.', sync_attention: 'Business App synchronization needs operator attention. Refresh before retrying setup.' };
        text('status', `Connected · ${status.display_phone_number || status.phone_number_id} · ${sync[status.onboarding_status] || status.onboarding_status}`);
      }
      text('quota', status.quota ? `App daily allowance: ${status.quota.used} / ${status.quota.limit} used · ${status.quota.left} left. Meta charges and limits apply separately.` : '');
      $('disconnect').hidden = !status.connected; $('embedded').hidden = !status.embedded_signup?.enabled;
      $('embedded-setup').hidden = !status.embedded_signup?.enabled;
      if (status.embedded_signup?.enabled) loadSdk(status.embedded_signup, epoch);
      if (status.connected) {
        const [approved, history] = await Promise.all([request('/templates'), request('/messages')]);
        if (epoch !== generation) return;
        templates = (approved.templates || []).filter(item => item.status === 'APPROVED');
        $('template').replaceChildren(new Option('Choose an approved template', ''));
        templates.forEach(item => $('template').append(new Option(`${item.name} · ${item.language}`, `${item.name}:${item.language}`)));
        $('history').replaceChildren();
        (history.messages || []).slice(0, 20).forEach(item => {
          const row = document.createElement('li'); row.textContent = `${item.to} · ${item.template} · ${item.status}${item.detail ? ` · ${item.detail}` : ''} · ${item.created_at || ''}`; $('history').append(row);
        });
      } else { templates = []; $('template').replaceChildren(); $('history').replaceChildren(); }
      refreshRecipients(); parameters();
      if (status.connected && !templates.length) text('template-note', 'No approved templates found. Create and submit one in Meta WhatsApp Manager, then refresh.');
    } catch (error) { if (error.name !== 'AbortError' && epoch === generation) text('status', error.message); }
  }
  async function action(callback) {
    if (busy) return;
    const epoch = generation; busy = true; preview();
    try { await callback(); } catch (error) { if (error.name !== 'AbortError' && epoch === generation) text('status', error.message); }
    finally { if (epoch === generation) { busy = false; preview(); } }
  }
  function connect(event) {
    event.preventDefault();
    return action(async () => {
      const body = { access_token: $('token').value.trim(), waba_id: $('waba').value.trim(), phone_number_id: $('phone').value.trim() };
      if ($('manual-pin').value) { if (!/^\d{6}$/.test($('manual-pin').value)) throw new Error('Registration PIN must contain exactly six digits.'); body.registration_pin = $('manual-pin').value; }
      $('token').value = ''; $('manual-pin').value = '';
      await request('/connection', 'PUT', body); $('connect-form').reset(); await refresh();
    });
  }
  function loadSdk(config, epoch) {
    $('embedded').disabled = true;
    if (!sdkLoading) sdkLoading = new Promise((resolve, reject) => {
      if (window.FB) return resolve();
      const script = document.createElement('script'); script.src = 'https://connect.facebook.net/en_US/sdk.js'; script.async = true;
      script.onload = resolve; script.onerror = () => reject(new Error('Meta sign-in could not load. Use authorized business credentials or try again.'));
      document.head.append(script);
    });
    sdkLoading.then(() => {
      if (epoch !== generation || !connection?.embedded_signup?.enabled) return;
      window.FB.init({ appId: config.app_id, version: config.graph_version || 'v26.0', autoLogAppEvents: false, xfbml: false }); $('embedded').disabled = false;
    }).catch(error => { sdkLoading = null; if (epoch === generation) text('status', error.message); });
  }
  async function exchangeSignup() {
    if (!signup || signup.exchanging || !signup.code || !signup.waba_id || !signup.phone_number_id) return;
    const current = signup;
    if (current.epoch !== generation || current.owner !== identity()) { signup = null; return; }
    current.exchanging = true;
    await action(async () => {
      await request('/embedded-signup/exchange', 'POST', { code: current.code, waba_id: current.waba_id, phone_number_id: current.phone_number_id, ...(current.pin ? { registration_pin: current.pin } : {}) });
      signup = null; await refresh();
    });
    if (signup === current) { current.code = ''; signup = null; }
  }
  function embedded() {
    const config = connection?.embedded_signup;
    if (busy || !identity() || !window.FB || !config?.enabled || !config.app_id || !config.config_id) return;
    if ($('pin').value && !/^\d{6}$/.test($('pin').value)) { text('status', 'Registration PIN must contain exactly six digits.'); return; }
    signup = { epoch: generation, owner: identity(), pin: $('pin').value }; $('pin').value = ''; const current = signup;
    window.FB.login(response => {
      if (signup !== current || current.epoch !== generation || current.owner !== identity()) return;
      if (!response.authResponse?.code) { signup = null; text('status', 'Meta connection was cancelled or no authorization code was returned.'); return; }
      current.code = response.authResponse.code;
      exchangeSignup();
      setTimeout(() => {
        if (signup === current && !current.exchanging) { signup = null; text('status', 'Meta did not return a complete phone connection. Restart Connect with Meta.'); }
      }, 25000);
    }, { config_id: config.config_id, response_type: 'code', override_default_response_type: true, extras: { setup: {}, ...($('coexist').checked ? { featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } : {}) } });
  }
  function signupMessage(event) {
    let origin; try { origin = new URL(event.origin); } catch (_) { return; }
    if (origin.protocol !== 'https:' || !(origin.hostname === 'facebook.com' || origin.hostname.endsWith('.facebook.com')) || !signup || signup.epoch !== generation || signup.owner !== identity()) return;
    let data; try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (_) { return; }
    if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
    if (data.event === 'FINISH' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
      if (!/^\d+$/.test(data.data?.waba_id || '') || !/^\d+$/.test(data.data?.phone_number_id || '')) {
        signup = null; text('status', 'Meta did not return a phone number ID. Use authorized business credentials for this account.'); return;
      }
      Object.assign(signup, { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id }); exchangeSignup();
    } else if (['CANCEL', 'ERROR', 'FINISH_ONLY_WABA'].includes(data.event)) {
      signup = null; text('status', 'Meta sign-in did not complete a phone connection. Try again or use authorized business credentials.');
    }
  }
  function send() {
    if ($('send').disabled) return;
    const lead = selectedLead(), template = selectedTemplate();
    if (!lead || lead.phoneOptOut || !$('consent').checked || !supported(template)) return;
    const digits = String(lead.phone || '').replace(/\D/g, '');
    const payload = { to: digits.length === 10 ? `91${digits}` : digits, template: template.name, language: template.language, body_params: values(lead), opt_in: true };
    const fingerprint = JSON.stringify(payload);
    if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
    return action(async () => {
      const result = await request('/messages/template', 'POST', { ...payload, idempotency_key: attempt.key });
      $('consent').checked = false;
      await refresh();
      text('status', `Message ${result.status || 'accepted'} · delivery is confirmed only by Meta webhook status. Refresh history for updates.`);
    });
  }
  function init() {
    if (!$('connect-form')) return;
    $('connect-form').addEventListener('submit', connect); $('refresh').addEventListener('click', () => action(refresh));
    $('disconnect').addEventListener('click', () => action(async () => { await request('/connection', 'DELETE'); reset(); await refresh(); }));
    $('recipient').addEventListener('change', () => { $('consent').checked = false; preview(); });
    $('template').addEventListener('change', parameters); $('consent').addEventListener('change', preview); $('send').addEventListener('click', send);
    $('embedded').addEventListener('click', embedded); window.addEventListener('message', signupMessage);
    window.addEventListener('rudra:auth-state', () => { reset(); if (location.hash === '#whatsapp') refresh(); });
    window.addEventListener('hashchange', () => { if (location.hash === '#whatsapp') refresh(); });
    document.addEventListener('nexus:leadsupdated', refreshRecipients);
    reset(); if (location.hash === '#whatsapp') refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { refresh, _selfTest: { request, reset, supported, leads, signupMessage } };
})();
