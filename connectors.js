(function () {
  'use strict';

  const APPS = [
    { id: 'gmail', name: 'Gmail', group: 'Google Workspace', provider: 'google_workspace', scope: 'https://www.googleapis.com/auth/gmail.send', readScope: 'https://www.googleapis.com/auth/gmail.readonly', icon: 'gmail.png', description: 'Send from your Gmail account and read selected inbox messages.', setup: 'The app owner enables Gmail API and configures Google OAuth once. Each user then signs in and approves Gmail send and read access.', docs: 'https://developers.google.com/workspace/gmail/api/auth/scopes' },
    { id: 'sheets', name: 'Google Sheets', group: 'Google Workspace', provider: 'google_workspace', scope: 'https://www.googleapis.com/auth/spreadsheets', icon: 'sheets.png', description: 'Sync leads to spreadsheets using the existing Sheets workflow.', setup: 'Enable Google Sheets API and add the OAuth callback URL.' },
    { id: 'calendar', name: 'Google Calendar', group: 'Google Workspace', provider: 'google_workspace', scope: 'https://www.googleapis.com/auth/calendar.events', icon: 'calendar.png', description: 'Authorize calendar event access for future workflows.', setup: 'Enable Google Calendar API in Google Cloud.' },
    { id: 'drive', name: 'Google Drive', group: 'Google Workspace', provider: 'google_workspace', scope: 'https://www.googleapis.com/auth/drive.file', icon: 'drive.png', description: 'Authorize access to files created or selected in this app.', setup: 'Enable Google Drive API in Google Cloud.' },
    { id: 'slack', name: 'Slack', group: 'Team', provider: 'slack', icon: 'slack.svg', description: 'Post scheduled updates to a channel where your bot is a member.', setup: 'Create a Slack app with chat:write and add the OAuth callback URL.', docs: 'https://docs.slack.dev/authentication/installing-with-oauth/' },
    { id: 'github', name: 'GitHub', group: 'Team', provider: 'github', icon: 'github.svg', description: 'Create issues in public repositories from scheduled actions.', setup: 'Create a GitHub OAuth App and set its callback URL.', docs: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app' },
    { id: 'telegram', name: 'Telegram', group: 'Social', provider: 'telegram', icon: 'telegram.svg', description: 'Post through your bot to a channel or chat you manage.', setup: 'Create a bot with @BotFather, add it to a channel, and copy its token and chat ID.' },
    { id: 'instagram', name: 'Instagram', group: 'Social', provider: 'meta', icon: 'instagram.svg', description: 'Publish photos to a linked Professional account after Meta approval.', setup: 'Use an Instagram Professional account linked to a Facebook Page. Request instagram_content_publish in a Meta Business app.', docs: 'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api' },
    { id: 'facebook', name: 'Facebook Pages', group: 'Social', provider: 'meta', icon: 'facebook.svg', description: 'Publish text posts to Pages you manage after Meta approval.', setup: 'Create a Meta Business app, connect a Page, and request pages_manage_posts.', docs: 'https://developers.facebook.com/docs/pages-api/posts/' },
    { id: 'whatsapp', name: 'WhatsApp Business', group: 'Social', icon: 'whatsapp.svg', description: 'Business messaging needs an approved Meta WhatsApp account.', setup: 'Set up WhatsApp Cloud API, a business number, and approved templates.', docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api/' },
    { id: 'youtube', name: 'YouTube', group: 'Social', icon: 'youtube.svg', description: 'Video upload needs YouTube API setup and Google verification.', setup: 'Enable YouTube Data API and request upload permission.', docs: 'https://developers.google.com/youtube/v3/guides/uploading_a_video' },
  ];

  const state = { connections: {}, configured: {}, online: false, filter: 'all', query: '', jobs: [], pendingKey: '' };
  let bound = false;
  let pollTimer = null;
  const byId = id => document.getElementById(id);
  const base = () => (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');

  async function request(path, options = {}) {
    const token = window.SupabaseAuth?.getAccessToken?.();
    if (!token) throw new Error('Sign in before connecting apps.');
    const response = await fetch(`${base()}/api/v1/connectors${path}`, {
      ...options,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Connector request failed (${response.status})`);
    return data;
  }

  function notice(message, tone = '') {
    const el = byId('cx-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
  }

  function connection(app) {
    const workspace = state.connections.google_workspace;
    if (app.id === 'sheets' && (!workspace || !String(workspace.scopes || '').split(' ').includes(app.scope)) && state.connections.google_sheets) return state.connections.google_sheets;
    if (!app.provider) return null;
    const connected = state.connections[app.provider];
    if (connected && connected.connected === false) return null;
    if (app.id === 'instagram' && !connected?.pages?.some(page => page.instagram_id)) return null;
    if (app.id === 'facebook' && !connected?.pages?.length) return null;
    if (app.scope && connected && !String(connected.scopes || '').split(' ').includes(app.scope)) return null;
    if (app.readScope && connected && !String(connected.scopes || '').split(' ').includes(app.readScope)) return null;
    return connected || null;
  }

  function makeCard(app) {
    const card = document.createElement('article');
    card.className = 'cx-card';
    const top = document.createElement('div');
    top.className = 'cx-card-top';
    const iconBox = document.createElement('div');
    iconBox.className = 'cx-card-icon';
    const icon = document.createElement('img');
    icon.src = `assets/connectors/${app.icon}`;
    icon.alt = '';
    icon.width = icon.height = 28;
    iconBox.append(icon);
    const heading = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = app.name;
    const group = document.createElement('span');
    group.className = 'cx-card-category';
    group.textContent = app.group;
    heading.append(title, group);
    top.append(iconBox, heading);
    const desc = document.createElement('p');
    desc.className = 'cx-card-desc';
    desc.textContent = app.description;
    const foot = document.createElement('div');
    foot.className = 'cx-card-foot';
    const status = document.createElement('span');
    status.className = 'cx-card-state';
    const linked = connection(app);
    const configured = app.provider && state.configured[app.provider];
    if (linked) {
      status.dataset.state = 'connected';
      const account = app.id === 'instagram' ? linked.pages?.find(page => page.instagram_id)?.instagram_username :
        app.id === 'facebook' ? linked.pages?.[0]?.name : linked.account;
      status.textContent = account ? `Connected: ${account}` : 'Connected';
    } else if (!state.online) {
      status.textContent = 'Backend offline';
    } else if (!app.provider) {
      status.dataset.state = 'setup';
      status.textContent = 'Provider setup required';
    } else if (!configured) {
      status.dataset.state = 'setup';
      status.textContent = 'Developer setup required';
    } else if (app.scope && state.connections[app.provider]) {
      status.dataset.state = 'setup';
      status.textContent = 'Permission not granted';
    } else {
      status.textContent = 'Not connected';
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cx-button ' + (linked ? 'cx-button-secondary' : configured ? 'cx-button-primary' : 'cx-button-secondary');
    button.textContent = linked ? 'Manage' : configured ? 'Connect' : 'Setup';
    button.addEventListener('click', () => linked ? manage(app) : configured ? connect(app) : setup(app));
    foot.append(status, button);
    card.append(top, desc, foot);
    return card;
  }

  function render() {
    const grid = byId('cx-grid');
    if (!grid) return;
    grid.replaceChildren();
    const visible = APPS.filter(app => {
      if (state.filter === 'connected' && !connection(app)) return false;
      if (state.filter === 'setup' && connection(app)) return false;
      return !state.query || `${app.name} ${app.group}`.toLowerCase().includes(state.query);
    });
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'cx-empty';
      empty.textContent = 'No connectors match this filter.';
      grid.append(empty);
      return;
    }
    visible.forEach(app => grid.append(makeCard(app)));
  }

  async function refresh() {
    try {
      const [status, jobs] = await Promise.all([request('/status'), request('/jobs')]);
      state.connections = status.connections || {};
      state.configured = status.configured || {};
      state.jobs = jobs.jobs || [];
      state.online = true;
      notice('Connections are up to date.', 'success');
    } catch (error) {
      state.online = false;
      state.connections = {};
      state.configured = {};
      notice(error.message === 'Failed to fetch' ? 'Backend unavailable. Start or deploy the Rudra24 API to connect apps.' : error.message, 'error');
    }
    render();
    renderJobs();
  }

  function showLink(url) {
    const el = byId('cx-status');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = ' Open authorization';
    el.append(link);
  }

  async function connect(app) {
    if (app.provider === 'telegram') return telegramDialog();
    notice(`Preparing ${app.name} authorization...`);
    const popup = window.open('about:blank', '_blank');
    if (!popup) return notice('Allow popups, then try connecting again.', 'error');
    popup.opener = null;
    try {
      const suffix = app.id === 'gmail' ? '?purpose=gmail' : '';
      const previousUpdate = Number(state.connections?.[app.provider]?.updated_at || 0);
      const data = await request(`/oauth/${app.provider}/start${suffix}`, { method: 'POST' });
      popup.location.href = data.authorization_url;
      notice('Complete authorization in your browser, then return here.');
      showLink(data.authorization_url);
      clearInterval(pollTimer);
      let attempts = 0;
      pollTimer = setInterval(async () => {
        if (++attempts > 30) return clearInterval(pollTimer);
        try {
          const result = await request('/status');
          const linked = result.connections?.[app.provider];
          const scopeReady = app.id !== 'gmail' || (String(linked?.scopes || '').split(' ').includes('https://www.googleapis.com/auth/gmail.readonly') && String(linked?.scopes || '').split(' ').includes('https://www.googleapis.com/auth/gmail.send'));
          if (linked && scopeReady && (app.id !== 'gmail' || Number(linked.updated_at || 0) > previousUpdate)) {
            clearInterval(pollTimer);
            await refresh();
          }
        } catch (_) { /* Keep the page usable while authorization is open. */ }
      }, 4000);
    } catch (error) { popup.close(); notice(error.message, 'error'); }
  }

  function setup(app) {
    if (app.provider === 'telegram') return telegramDialog();
    const dialog = byId('cx-setup-dialog');
    byId('cx-connector-setup-title').textContent = `${app.name} setup`;
    byId('cx-setup-text').textContent = app.setup;
    const link = byId('cx-setup-link');
    link.hidden = !app.docs;
    if (app.docs) link.href = app.docs;
    dialog.showModal();
  }

  function manage(app) {
    const provider = app.id === 'sheets' && !state.connections.google_workspace ? 'google_sheets' : app.provider;
    if (provider === 'google_sheets') {
      notice('This is your existing Sheets connection. Manage it from Connect Sheets.');
      return;
    }
    const name = provider === 'google_workspace' ? 'Google Workspace (Gmail, Sheets, Calendar and Drive)' :
      provider === 'meta' ? 'Meta (Facebook Pages and Instagram)' : app.name;
    if (!window.confirm(`Disconnect ${name} from Rudra24 AI?`)) return;
    request(`/${provider}`, { method: 'DELETE' }).then(refresh).catch(error => notice(error.message, 'error'));
  }

  function telegramDialog() {
    const dialog = byId('cx-telegram-dialog');
    byId('cx-telegram-token').value = '';
    dialog.showModal();
  }

  async function saveTelegram(event) {
    event.preventDefault();
    const button = byId('cx-telegram-save');
    button.disabled = true;
    try {
      await request('/telegram', { method: 'POST', body: JSON.stringify({
        token: byId('cx-telegram-token').value.trim(), chat_id: byId('cx-telegram-chat').value.trim(),
      }) });
      byId('cx-telegram-token').value = '';
      byId('cx-telegram-dialog').close();
      await refresh();
    } catch (error) { byId('cx-telegram-error').textContent = error.message; }
    finally { button.disabled = false; }
  }

  function updateActionFields() {
    const provider = byId('cx-action-provider').value;
    const target = byId('cx-action-target');
    const subject = byId('cx-action-subject');
    const subjectField = document.querySelector('#cx-action-form .cx-subject-field');
    const mediaField = document.querySelector('#cx-action-form .cx-media-field');
    const labels = { telegram: 'Chat ID (blank uses saved chat)', slack: 'Channel ID, e.g. C123...', gmail: 'Recipient email', github: 'owner/repository', facebook: 'Page ID (blank uses first Page)', instagram: 'Instagram ID (blank uses first account)' };
    target.placeholder = labels[provider] || 'Destination';
    target.required = !['telegram', 'facebook', 'instagram'].includes(provider);
    subjectField.hidden = provider !== 'gmail' && provider !== 'github';
    subject.required = !subjectField.hidden;
    mediaField.hidden = provider !== 'instagram';
    byId('cx-action-media').required = provider === 'instagram';
    byId('cx-action-submit').textContent = byId('cx-action-time').value ? 'Schedule' : 'Run now';
  }

  async function submitAction(event) {
    event.preventDefault();
    const button = byId('cx-action-submit');
    const status = byId('cx-action-status');
    const provider = byId('cx-action-provider').value;
    const needed = provider === 'gmail' ? 'google_workspace' : ['facebook', 'instagram'].includes(provider) ? 'meta' : provider;
    if (!state.connections[needed]?.connected) { status.textContent = 'Connect this app first.'; status.dataset.tone = 'error'; return; }
    const localTime = byId('cx-action-time').value;
    state.pendingKey ||= crypto.randomUUID();
    button.disabled = true;
    try {
      const job = await request('/jobs', { method: 'POST', body: JSON.stringify({
        provider, target: byId('cx-action-target').value.trim(), subject: byId('cx-action-subject').value.trim(),
        message: byId('cx-action-message').value.trim(), media_url: byId('cx-action-media').value.trim(),
        run_at: localTime ? new Date(localTime).toISOString() : null,
        idempotency_key: state.pendingKey,
      }) });
      state.pendingKey = '';
      status.textContent = job.status === 'queued' ? 'Action scheduled.' : job.status === 'succeeded' ? 'Action completed.' : job.error || 'Action failed. Check the connection and try again.';
      status.dataset.tone = job.status === 'failed' ? 'error' : 'success';
      document.dispatchEvent(new CustomEvent('connector:result', { detail: { id: job.id, provider, status: job.status, error: job.error } }));
      await refresh();
    } catch (error) { status.textContent = error.message; status.dataset.tone = 'error'; }
    finally { button.disabled = false; }
  }

  function renderJobs() {
    const list = byId('cx-jobs');
    if (!list) return;
    list.replaceChildren();
    if (!state.jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'cx-empty';
      empty.textContent = 'No actions yet.';
      list.append(empty);
      return;
    }
    state.jobs.forEach(job => {
      const row = document.createElement('div');
      row.className = 'cx-job';
      const name = document.createElement('strong');
      name.textContent = job.provider === 'gmail' ? 'Gmail' : job.provider[0].toUpperCase() + job.provider.slice(1);
      const target = document.createElement('span');
      target.className = 'cx-job-target';
      target.textContent = job.target || 'Saved Telegram chat';
      const time = document.createElement('time');
      time.dateTime = new Date(job.run_at * 1000).toISOString();
      time.textContent = new Date(job.run_at * 1000).toLocaleString();
      const status = document.createElement('span');
      status.className = 'cx-job-status';
      status.dataset.status = job.status;
      status.textContent = job.status;
      if (job.error) status.title = job.error;
      if (job.status === 'queued') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cx-job-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => request(`/jobs/${job.id}`, { method: 'DELETE' }).then(refresh).catch(error => notice(error.message, 'error')));
        status.append(' ', cancel);
      }
      row.append(name, target, time, status);
      list.append(row);
    });
  }

  function dialogs() {
    const setup = document.createElement('dialog');
    setup.id = 'cx-setup-dialog';
    setup.className = 'cx-dialog';
    setup.innerHTML = '<h2 id="cx-connector-setup-title"></h2><p id="cx-setup-text"></p><a id="cx-setup-link" target="_blank" rel="noopener noreferrer">Provider documentation</a><div class="cx-dialog-actions"><button type="button" class="cx-button cx-button-secondary" id="cx-setup-close">Close</button></div>';
    document.body.append(setup);
    byId('cx-setup-close').addEventListener('click', () => setup.close());

    const telegram = document.createElement('dialog');
    telegram.id = 'cx-telegram-dialog';
    telegram.className = 'cx-dialog';
    telegram.innerHTML = '<form id="cx-telegram-form"><h2>Connect Telegram bot</h2><p>Create a bot with @BotFather, add it to your channel as an admin, then enter its token and channel username or chat ID. The token is encrypted on the backend.</p><label>Bot token<input type="password" id="cx-telegram-token" autocomplete="off" required minlength="20"></label><label>Channel username or chat ID<input id="cx-telegram-chat" placeholder="@yourchannel or -100..." required></label><p id="cx-telegram-error" class="cx-status" role="alert"></p><div class="cx-dialog-actions"><button type="button" class="cx-button cx-button-secondary" id="cx-telegram-close">Cancel</button><button type="submit" class="cx-button cx-button-primary" id="cx-telegram-save">Connect bot</button></div></form>';
    document.body.append(telegram);
    byId('cx-telegram-close').addEventListener('click', () => telegram.close());
    byId('cx-telegram-form').addEventListener('submit', saveTelegram);
  }

  function init() {
    if (!bound) {
      bound = true;
      dialogs();
      byId('cx-refresh')?.addEventListener('click', refresh);
      byId('cx-search')?.addEventListener('input', event => { state.query = event.target.value.trim().toLowerCase(); render(); });
      document.querySelectorAll('.cx-filter').forEach(button => button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        document.querySelectorAll('.cx-filter').forEach(filter => {
          filter.classList.toggle('active', filter === button);
          filter.setAttribute('aria-pressed', String(filter === button));
        });
        render();
      }));
      byId('cx-action-provider')?.addEventListener('change', updateActionFields);
      byId('cx-action-time')?.addEventListener('change', updateActionFields);
      byId('cx-action-form')?.addEventListener('submit', submitAction);
      byId('cx-action-form')?.addEventListener('input', () => { state.pendingKey = ''; });
      window.addEventListener('focus', () => {
        if (document.getElementById('view-connectors')?.classList.contains('active')) refresh();
      });
      updateActionFields();
    }
    render();
    refresh();
  }

  window.ConnectorsPage = { init, refresh };
})();
