'use strict';

/* Email provider workspace. Gmail remains owned by EmailCtrl; Outlook is kept
 * isolated so neither provider can change the other's credentials or history. */
const OutlookEmailCtrl = {
  token: null,
  account: null,
  running: false,
  paused: false,
  stopRequested: false,
  logs: JSON.parse(localStorage.getItem('outlook_email_logs') || '[]'),
  sentKeys: JSON.parse(localStorage.getItem('outlook_email_sent_keys') || '{}'),

  init() {
    this.buildWorkspace();
    const clientId = localStorage.getItem('outlook_client_id') || window.SKYLARK_CONFIG?.OUTLOOK_CLIENT_ID || '';
    this.el('outlook-client-id').value = clientId;
    this.el('outlook-campaign').value = localStorage.getItem('outlook_campaign') || 'outlook-default';
    this.el('outlook-signature').innerHTML = localStorage.getItem('outlook_signature') || this.el('outlook-signature').innerHTML;
    this.bind();
    this.renderLogs();
    this.updatePreview();
    this.handleOAuthCallback();
  },

  el(id) { return document.getElementById(id); },

  buildWorkspace() {
    const compose = this.el('email-compose-panel');
    const gmail = compose?.querySelector('.email-layout');
    const outlook = this.el('outlook-setup-section');
    if (!compose || !gmail || !outlook || this.el('email-provider-switch')) return;

    gmail.id = 'gmail-provider-panel';
    gmail.classList.add('email-provider-panel', 'is-active');
    outlook.classList.add('email-provider-panel');
    compose.appendChild(outlook);

    const switcher = document.createElement('div');
    switcher.id = 'email-provider-switch';
    switcher.className = 'email-provider-switch';
    switcher.innerHTML = `
      <button type="button" class="email-provider-tab is-active" data-provider="gmail">
        <span class="email-provider-icon gmail">G</span><span><strong>Gmail</strong><small>GAS / SMTP campaign sender</small></span>
      </button>
      <button type="button" class="email-provider-tab" data-provider="outlook">
        <span class="email-provider-icon outlook">O</span><span><strong>Outlook</strong><small>Graph or Classic desktop</small></span>
      </button>`;
    compose.insertBefore(switcher, gmail);
    switcher.addEventListener('click', event => {
      const button = event.target.closest('[data-provider]');
      if (button) this.showProvider(button.dataset.provider);
    });
  },

  showProvider(provider) {
    const gmail = this.el('gmail-provider-panel');
    const outlook = this.el('outlook-setup-section');
    const isGmail = provider === 'gmail';
    gmail.classList.toggle('is-active', isGmail);
    outlook.classList.toggle('is-active', !isGmail);
    document.querySelectorAll('.email-provider-tab').forEach(button => button.classList.toggle('is-active', button.dataset.provider === provider));
    if (isGmail) window.EmailCtrl?.updateAudienceStats?.();
    else this.updatePreview();
  },

  bind() {
    this.el('outlook-mode').addEventListener('change', () => this.updateMode());
    this.el('outlook-client-id').addEventListener('change', event => localStorage.setItem('outlook_client_id', event.target.value.trim()));
    ['outlook-subject', 'outlook-body', 'outlook-signature', 'outlook-campaign'].forEach(id => {
      this.el(id).addEventListener('input', () => {
        if (id === 'outlook-campaign') localStorage.setItem('outlook_campaign', this.el(id).value.trim());
        if (id === 'outlook-signature') localStorage.setItem('outlook_signature', this.el(id).innerHTML);
        this.updatePreview();
      });
    });
    this.el('outlook-connect-btn').onclick = () => this.connect();
    this.el('outlook-test-connection-btn').onclick = () => this.testConnection();
    this.el('outlook-disconnect-btn').onclick = () => this.disconnect();
    this.el('outlook-send-btn').onclick = () => this.start();
    this.el('outlook-send-test-btn').onclick = () => this.sendTest();
    this.el('outlook-pause-btn').onclick = () => { this.paused = true; this.setButtons(); this.log('paused', 'Queue paused after the current email.'); };
    this.el('outlook-resume-btn').onclick = () => { this.paused = false; this.setButtons(); this.log('resumed', 'Queue resumed.'); };
    this.el('outlook-stop-btn').onclick = () => { this.stopRequested = true; this.paused = false; this.log('stopped', 'Stop requested; no new email will be sent.'); };
    this.el('outlook-retry-btn').onclick = () => this.retryFailed();

    document.querySelectorAll('[data-outlook-format]').forEach(button => {
      button.onclick = () => this.formatEditor('outlook-signature', button.dataset.outlookFormat, button.dataset.value || null);
    });
    document.querySelectorAll('[data-outlook-token]').forEach(button => {
      button.onclick = () => this.insertToken('outlook-body', button.dataset.outlookToken);
    });
    this.el('outlook-signature-image').onchange = event => this.addImage('outlook-signature', event.target.files?.[0]);
    const outlookToolbar = document.querySelector('.outlook-editor-tools');
    if (outlookToolbar && !outlookToolbar.querySelector('[data-outlook-extra]')) {
      outlookToolbar.insertAdjacentHTML('beforeend', '<button type="button" data-outlook-extra="left">Left</button><button type="button" data-outlook-extra="right">Right</button><select data-outlook-extra="size" title="Font size"><option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">XL</option></select><input data-outlook-extra="color" type="color" title="Text color">');
      outlookToolbar.querySelector('[data-outlook-extra="left"]').onclick = () => this.formatEditor('outlook-signature', 'justifyLeft');
      outlookToolbar.querySelector('[data-outlook-extra="right"]').onclick = () => this.formatEditor('outlook-signature', 'justifyRight');
      outlookToolbar.querySelector('[data-outlook-extra="size"]').onchange = event => { if (event.target.value) this.formatEditor('outlook-signature', 'fontSize', event.target.value); event.target.value = ''; };
      outlookToolbar.querySelector('[data-outlook-extra="color"]').onchange = event => this.formatEditor('outlook-signature', 'foreColor', event.target.value);
    }
    const bodyRow = this.el('outlook-body').closest('.outlook-field-row');
    if (bodyRow && !this.el('outlook-body-toolbar')) {
      const bodyToolbar = document.createElement('div');
      bodyToolbar.id = 'outlook-body-toolbar';
      bodyToolbar.className = 'outlook-editor-tools outlook-body-tools';
      bodyToolbar.innerHTML = '<button data-command="bold"><b>B</b></button><button data-command="italic"><i>I</i></button><button data-command="underline"><u>U</u></button><button data-command="insertUnorderedList">List</button><button data-command="justifyLeft">Left</button><button data-command="justifyCenter">Center</button><select data-command="fontSize"><option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">XL</option></select><input data-command="foreColor" type="color" title="Text color"><button data-command="link">Link</button><label class="outlook-upload">Image / GIF<input type="file" accept="image/*"></label>';
      bodyRow.insertAdjacentElement('afterend', bodyToolbar);
      bodyToolbar.querySelectorAll('button[data-command]').forEach(button => button.onclick = () => {
        if (button.dataset.command === 'link') { const url = prompt('Paste the link URL:'); if (url) this.formatEditor('outlook-body', 'createLink', url); }
        else this.formatEditor('outlook-body', button.dataset.command);
      });
      bodyToolbar.querySelector('select').onchange = event => { if (event.target.value) this.formatEditor('outlook-body', 'fontSize', event.target.value); event.target.value = ''; };
      bodyToolbar.querySelector('input[type="color"]').onchange = event => this.formatEditor('outlook-body', 'foreColor', event.target.value);
      bodyToolbar.querySelector('input[type="file"]').onchange = event => { this.addImage('outlook-body', event.target.files?.[0]); event.target.value = ''; };
    }
    this.updateMode();

    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin || event.data?.type !== 'outlook-oauth-complete') return;
      this.token = event.data.token;
      this.testConnection();
    });
  },

  updateMode() {
    const isGraph = this.el('outlook-mode').value === 'graph';
    this.el('outlook-client-row').hidden = !isGraph;
    this.el('outlook-connection-help').innerHTML = isGraph
      ? 'Run the app at <code>http://localhost:3000</code>, then use an Entra SPA app with delegated <code>User.Read</code> and <code>Mail.Send</code>.'
      : 'Requires Windows, Classic Outlook, and the local backend. No screen-clicking or UI automation is used.';
    this.setStatus(this.account ? 'Connected' : 'Not connected', Boolean(this.account));
  },

  formatEditor(id, command, value = null) {
    const editor = this.el(id);
    editor.focus();
    document.execCommand(command, false, value);
    editor.dispatchEvent(new Event('input'));
  },

  insertToken(id, token) {
    const editor = this.el(id);
    editor.focus();
    document.execCommand('insertText', false, token);
    editor.dispatchEvent(new Event('input'));
  },

  async addImage(editorId, file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return this.fail('Inline signature media must be an image or GIF. Use Gmail attachments for documents and other files.');
    const src = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const editor = this.el(editorId);
    editor.focus();
    document.execCommand('insertHTML', false, this.resizableMediaHtml(src, file.name));
    editor.dispatchEvent(new Event('input'));
  },

  resizableMediaHtml(src, name = 'media') {
    return `<span class="mail-resizable-media" contenteditable="false" title="Drag the lower-right corner to resize"><img src="${src}" alt="${String(name).replace(/"/g, '&quot;')}"></span>`;
  },

  setStatus(text, connected, error = false) {
    const badge = this.el('outlook-connection-badge');
    badge.textContent = text;
    badge.className = `outlook-status-badge${connected ? ' connected' : ''}${error ? ' error' : ''}`;
    this.el('outlook-disconnect-btn').hidden = !connected;
  },

  redirectUri() {
    return window.location.protocol === 'file:' ? '' : `${window.location.origin}${window.location.pathname}`;
  },

  async connect() {
    if (this.el('outlook-mode').value === 'classic') return this.testConnection();
    const clientId = this.el('outlook-client-id').value.trim();
    if (!clientId) return this.fail('Paste your Microsoft Entra application (client) ID first.');
    if (!this.redirectUri()) return this.fail('This app is opened from a file. Launch it through Launch_App.bat so it opens at http://localhost:3000, then connect Outlook.');

    localStorage.setItem('outlook_client_id', clientId);
    const verifier = this.random(64);
    const state = this.random(32);
    sessionStorage.setItem('outlook_pkce_verifier', verifier);
    sessionStorage.setItem('outlook_oauth_state', state);
    const challenge = await this.sha256(verifier);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      response_mode: 'query',
      scope: 'openid profile email User.Read Mail.Send',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    const popup = window.open(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`, 'outlookOAuth', 'width=560,height=720');
    if (!popup) this.fail('Your browser blocked the Outlook sign-in popup. Allow popups for this app and try again.');
  },

  async handleOAuthCallback() {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');
    if (!code) return;
    const state = query.get('state');
    if (state !== sessionStorage.getItem('outlook_oauth_state')) return this.fail('Outlook sign-in state did not match. Please reconnect.');
    const clientId = this.el('outlook-client-id').value.trim();
    try {
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri(),
          code_verifier: sessionStorage.getItem('outlook_pkce_verifier') || '',
          scope: 'openid profile email User.Read Mail.Send'
        })
      });
      const data = await response.json();
      if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Microsoft token exchange failed.');
      sessionStorage.removeItem('outlook_pkce_verifier');
      sessionStorage.removeItem('outlook_oauth_state');
      history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      if (window.opener) {
        window.opener.postMessage({ type: 'outlook-oauth-complete', token: data.access_token }, window.location.origin);
        window.close();
      } else {
        this.token = data.access_token;
        await this.testConnection();
      }
    } catch (error) {
      this.fail(this.readError(error, 'Microsoft sign-in could not be completed.'));
    }
  },

  async testConnection() {
    try {
      if (this.el('outlook-mode').value === 'classic') {
        const data = await this.fetchLocal('/api/outlook/status');
        if (!data.available) throw new Error(data.message || 'Classic Outlook is unavailable.');
        this.account = { email: data.senderEmail || 'Classic Outlook', name: 'Classic Outlook' };
        this.el('outlook-account').textContent = `Classic Outlook · ${this.account.email}`;
      } else {
        if (!this.token) throw new Error('Connect Microsoft Graph first.');
        const response = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${this.token}` } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message || 'Microsoft Graph connection failed.');
        this.account = { email: data.mail || data.userPrincipalName, name: data.displayName || 'Outlook' };
        this.el('outlook-account').textContent = `${this.account.name} · ${this.account.email}`;
      }
      this.setStatus('Connected', true);
      this.log('connected', `Connected as ${this.account.email}`);
      return true;
    } catch (error) {
      this.fail(this.readError(error, 'Outlook connection failed.'));
      return false;
    }
  },

  disconnect() {
    this.token = null;
    this.account = null;
    sessionStorage.removeItem('outlook_pkce_verifier');
    sessionStorage.removeItem('outlook_oauth_state');
    this.el('outlook-account').textContent = 'No Outlook account connected.';
    this.setStatus('Not connected', false);
  },

  getLeads() {
    let leads = window.UserStorage?.getJSON?.('allLeads', window.allLeads || []) || window.allLeads || [];
    if (!Array.isArray(leads)) leads = [];
    const chosen = this.el('outlook-batch-size').value;
    leads = leads.filter(lead => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(lead.email || '').trim()));
    return chosen === 'available' ? leads : leads.slice(0, Number(chosen));
  },

  personalize(value, lead) {
    const name = lead.contactName || lead.name || lead.company || 'there';
    return String(value || '')
      .replace(/\{Name\}/gi, name)
      .replace(/\{Company\}/gi, lead.company || 'your company')
      .replace(/\{City\}/gi, lead.city || '')
      .replace(/\{Industry\}/gi, lead.industry || '')
      .replace(/\{Email\}/gi, lead.email || '');
  },

  updatePreview() {
    const lead = this.getLeads()[0] || { name: 'Aarav', company: 'Example Company', city: 'Delhi', industry: 'Services' };
    const body = this.personalize(this.el('outlook-body').innerHTML, lead);
    const signature = this.personalize(this.el('outlook-signature').innerHTML, lead);
    this.el('outlook-preview').innerHTML = `<div class="outlook-preview-subject">${this.personalize(this.el('outlook-subject').value, lead)}</div>${body}<hr>${signature}`;
  },

  key(campaign, lead) { return `${campaign}|${String(lead.id || lead.email).toLowerCase()}`; },

  async start(items = this.getLeads()) {
    if (this.running) return;
    const mode = this.el('outlook-mode').value;
    const campaign = this.el('outlook-campaign').value.trim() || 'outlook-default';
    if (!items.length) return this.fail('No valid lead email is available in this batch.');
    if (mode === 'graph' && !this.token) return this.fail('Connect Microsoft Graph before sending.');
    if (mode === 'classic' && !(await this.testConnection())) return;

    this.running = true;
    this.paused = false;
    this.stopRequested = false;
    this.setButtons();
    this.log('queued', `${items.length} lead(s) queued for campaign “${campaign}”.`);
    let sent = 0, failed = 0, skipped = 0;

    for (const lead of items) {
      if (this.stopRequested) break;
      while (this.paused && !this.stopRequested) await this.sleep(250);
      if (this.stopRequested) break;
      const duplicateKey = this.key(campaign, lead);
      if (this.sentKeys[duplicateKey]) {
        skipped += 1;
        this.log('skipped', `Duplicate prevented: ${lead.email}`);
        this.progress(items.length, sent, failed, skipped);
        continue;
      }
      const subject = this.personalize(this.el('outlook-subject').value, lead);
      const htmlBody = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124">${this.personalize(this.el('outlook-body').innerHTML, lead)}<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb">${this.personalize(this.el('outlook-signature').innerHTML, lead)}</div></div>`;
      try {
        await this.sendOne({ to: lead.email, subject, htmlBody, mode });
        this.sentKeys[duplicateKey] = new Date().toISOString();
        localStorage.setItem('outlook_email_sent_keys', JSON.stringify(this.sentKeys));
        sent += 1;
        this.log('sent', `Sent to ${lead.email}`);
      } catch (error) {
        failed += 1;
        this.log('failed', `${lead.email}: ${this.readError(error, 'Send failed.')}`);
      }
      this.progress(items.length, sent, failed, skipped);
      if (!this.stopRequested) await this.waitThrottle();
    }
    this.running = false;
    this.setButtons();
    this.log('complete', `Run complete: ${sent} sent, ${failed} failed, ${skipped} skipped.`);
  },

  async sendOne({ to, subject, htmlBody, mode }) {
    if (mode === 'classic') {
      const data = await this.fetchLocal('/api/outlook/send', { method: 'POST', body: JSON.stringify({ to, subject, htmlBody }) });
      if (data.status !== 'success') throw new Error(data.message || 'Classic Outlook could not send the message.');
      return;
    }
    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: htmlBody }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `Microsoft Graph returned ${response.status}.`);
    }
  },

  async sendTest() {
    if (!this.account?.email) return this.fail('Connect Outlook before sending a test.');
    try {
      await this.sendOne({ to: this.account.email, subject: 'Outlook connection test', htmlBody: '<p>This is a test email from your lead agent.</p>', mode: this.el('outlook-mode').value });
      this.log('sent', `Test email sent to ${this.account.email}`);
    } catch (error) {
      this.fail(this.readError(error, 'Test email failed.'));
    }
  },

  async retryFailed() {
    const failedAddresses = new Set(this.logs.filter(row => row.type === 'failed').map(row => row.email).filter(Boolean));
    const leads = this.getLeads().filter(lead => failedAddresses.has(lead.email));
    if (!leads.length) return this.fail('No failed recipient exists in the selected batch.');
    await this.start(leads);
  },

  async fetchLocal(path, options = {}) {
    try {
      const response = await fetch(this.api(path), { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Local service returned ${response.status}.`);
      return data;
    } catch (error) {
      if (error instanceof TypeError) throw new Error('Local Outlook service is not running. Close this window and open the app with Launch_App.bat; it must run at http://localhost:3000.');
      throw error;
    }
  },

  api(path) { return `${window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000'}${path}`; },
  waitThrottle() { const base = Number(this.el('outlook-throttle').value) || 5000; return this.sleep(Math.round(base * (0.8 + Math.random() * 0.4))); },
  sleep(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); },
  progress(total, sent, failed, skipped) { const done = sent + failed + skipped; this.el('outlook-progress-bar').style.width = `${Math.round((done / total) * 100)}%`; this.el('outlook-progress-text').textContent = `${total - done} queued · ${sent} sent · ${failed} failed · ${skipped} skipped`; },
  setButtons() { this.el('outlook-send-btn').disabled = this.running; this.el('outlook-pause-btn').disabled = !this.running || this.paused; this.el('outlook-resume-btn').disabled = !this.running || !this.paused; this.el('outlook-stop-btn').disabled = !this.running; },
  log(type, text) { this.logs.unshift({ type, text, email: (text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) || [])[0] || '', at: new Date().toISOString() }); this.logs = this.logs.slice(0, 300); localStorage.setItem('outlook_email_logs', JSON.stringify(this.logs)); this.renderLogs(); },
  renderLogs() { this.el('outlook-log').innerHTML = this.logs.length ? this.logs.map(row => `<div class="outlook-log-row ${row.type}"><strong>${row.type}</strong><span>${row.text}</span><time>${new Date(row.at).toLocaleTimeString()}</time></div>`).join('') : '<div class="outlook-empty">No Outlook queue activity yet.</div>'; },
  fail(message) { this.setStatus('Action needed', false, true); this.log('error', message); if (window.showToast) window.showToast('error', 'Outlook', message); },
  readError(error, fallback) { return error?.message || fallback; },
  random(length) { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '').slice(0, length); },
  async sha256(value) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
};

const EmailComposerTools = {
  format(id, command, value = null) { const editor = document.getElementById(id); if (!editor) return; editor.focus(); document.execCommand(command, false, value); editor.dispatchEvent(new Event('input')); },
  async addMedia(id, file) { if (!file) return; if (!file.type.startsWith('image/')) return window.showToast?.('warning', 'Inline media', 'Please choose an image or GIF for the signature.'); const src = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }); const editor = document.getElementById(id); editor.focus(); document.execCommand('insertHTML', false, OutlookEmailCtrl.resizableMediaHtml(src, file.name)); editor.dispatchEvent(new Event('input')); }
};

window.OutlookEmailCtrl = OutlookEmailCtrl;
window.EmailComposerTools = EmailComposerTools;
document.addEventListener('DOMContentLoaded', () => OutlookEmailCtrl.init());
