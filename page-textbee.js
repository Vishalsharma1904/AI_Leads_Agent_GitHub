/* Lead-only campaigns through the user's configured self-hosted Android gateway. */
window.TextBeeCtrl = (() => {
  let owner = '', serial = 0, running = false, listeners = null, canCreate = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const root = () => document.getElementById('view-sms');
  const uid = () => window.SupabaseAuth?.getUser?.()?.id || '';
  const states = ['queued','sent','delivered','failed','unknown'];
  async function request(path, options = {}) {
    const expected = uid(), token = window.SupabaseAuth?.getAccessToken?.();
    if (!expected || !token) throw new Error('Sign in to use text messages.');
    const base = String(window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const response = await fetch(base + '/api/textbee' + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (expected !== uid()) throw new DOMException('Account changed', 'AbortError');
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
    return data;
  }
  function note(text) { const el = root().querySelector('[data-sms-status]'); if (el) el.textContent = text; }
  async function load() {
    const stamp = ++serial;
    try {
      const [status, audience, history] = await Promise.all([request('/status'), request('/audience'), request('/campaigns')]);
      if (stamp !== serial || owner !== uid()) return;
      root().querySelector('[data-sms-connection]').textContent = !status.configured ? 'Setup needed: configure your Android gateway below.' : status.reachable ? `Gateway reachable · ${status.usedToday}/${status.dailyLimit} daily dispatches reserved. Android/carrier reports confirm delivery.` : `${status.error} ${status.usedToday}/${status.dailyLimit} dispatches reserved today.`;
      root().querySelector('[data-sms-audience]').textContent = `${audience.total} eligible unique lead numbers. Previously attempted numbers and phone opt-outs are excluded. Pending/uncertain sends from earlier days reserve today's capacity too.`;
      root().querySelector('[data-sms-history]').innerHTML = history.campaigns.map(c => `<article class="crm-deal"><h2>${esc(c.name)}</h2><p>${esc(c.message)}</p><p>${c.total} lead numbers · ${c.remaining} not attempted</p><p>${states.map(s => `${s}: ${c.counts[s] || 0}`).join(' · ')}</p><button type="button" data-sms-run="${esc(c.id)}" ${!status.reachable || !c.remaining || running ? 'disabled' : ''}>Run remaining today</button><details><summary>Recipient history</summary>${c.dispatches.map(r => `<p>${esc(r.phone)} · ${esc(r.status)}${r.error ? ` · ${esc(r.error)}` : ''}</p>`).join('')}</details></article>`).join('') || '<p>No campaigns yet.</p>';
      canCreate = Boolean(status.reachable && audience.total);
      root().querySelector('[data-sms-create]').disabled = !canCreate;
    } catch (error) { note(error.message); }
  }
  function init() {
    if (owner !== uid()) { owner = uid(); serial++; running = false; root().replaceChildren(); }
    if (!root().children.length) {
      listeners?.abort(); listeners = new AbortController();
      root().innerHTML = `<div class="crm-page"><header class="crm-heading"><div><p class="crm-eyebrow">Android gateway</p><h1>Text messages</h1><p>Your own SIM. A quiet, lead-only outreach queue.</p></div><button type="button" data-sms-refresh>Refresh status</button></header><p data-sms-connection></p><p data-sms-status role="status" aria-live="polite"></p><details><summary>Connect self-hosted TextBee</summary><form data-sms-settings class="crm-form"><p>Set TEXTBEE_BASE_URL on the backend to your own instance. Register Android there, then enter its device ID and API key. The key stays encrypted on the backend.</p><label>Device ID<input name="deviceId" required autocomplete="off"></label><label>API key<input type="password" name="apiKey" required autocomplete="new-password"></label><label>Daily dispatch limit<input type="number" name="dailyLimit" value="20" min="20" max="50" required></label><button>Save connection</button></form></details><section class="crm-section"><h2>New campaign</h2><p data-sms-audience></p><form data-sms-campaign class="crm-form"><label>Campaign name<input name="name" required maxlength="200"></label><label>Message<textarea name="message" required maxlength="160" rows="3" placeholder="Write a short message for your leads"></textarea></label><p class="crm-muted">One SMS segment: 160 GSM units or 70 Unicode units. Your SIM plan determines carrier charges.</p><button data-sms-create disabled>Create campaign for eligible leads</button></form></section><section class="crm-section"><h2>Campaigns</h2><button type="button" data-sms-stop hidden>Stop after current dispatch</button><div data-sms-history></div></section></div>`;
      root().addEventListener('submit', async event => {
        event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
        const values = Object.fromEntries(new FormData(form));
        try {
          if (form.matches('[data-sms-settings]')) { values.dailyLimit = Number(values.dailyLimit); await request('/settings', { method: 'PUT', body: JSON.stringify(values) }); form.elements.apiKey.value = ''; note('Connection saved.'); }
          else { await window.CRMBridge?.ensureBootstrap?.(); await request('/campaigns', { method: 'POST', body: JSON.stringify(values) }); form.reset(); note('Campaign ready. Review the message, then run it.'); }
          await load();
        } catch (error) { note(error.message); } finally { button.disabled = form.matches('[data-sms-campaign]') ? !canCreate : false; }
      }, { signal: listeners.signal });
      root().addEventListener('click', async event => {
        if (event.target.closest('[data-sms-stop]')) { running = false; return; }
        if (event.target.closest('[data-sms-refresh]')) { try { await request('/refresh', { method:'POST' }); note('Gateway reports refreshed.'); } catch(error) { note(error.message); } await load(); }
        const button = event.target.closest('[data-sms-run]'); if (!button || running) return;
        running = true; const expected = owner; root().querySelector('[data-sms-stop]').hidden = false;
        try {
          while (running && uid() === expected) {
            const result = await request(`/campaigns/${encodeURIComponent(button.dataset.smsRun)}/run`, { method: 'POST' });
            if (result.done) break;
            note(`${result.phone}: ${result.status}. ${result.error || ''}`);
            await load();
            if (result.status === 'unknown') break;
          }
        } catch (error) { note(error.message); }
        finally { running = false; const stop = root()?.querySelector('[data-sms-stop]'); if (stop) stop.hidden = true; if (expected === uid()) await load(); }
      }, { signal: listeners.signal });
    }
    load();
  }
  window.addEventListener('clavis:workspace-change', () => { if (owner !== uid()) { running = false; serial++; owner = uid(); root()?.replaceChildren(); } });
  return { init };
})();
