/**
 * page-accounts.js — Webhook Setup Wizard (GAS)
 * Single-method approach: Google Apps Script Webhook.
 * Perfect for zero-backend setups running directly from file://
 */
'use strict';

const AccountsCtrl = {
  accounts: [],
  activeAccount: null,

  init() {
    this.loadAccounts();
    this.renderWizard();
  },

  getStorage() {
    return window.UserStorage || {
      getJSON:    (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || fb; } catch(_) { return fb; } },
      setJSON:    (k, v)  => localStorage.setItem(k, JSON.stringify(v)),
      getItem:    (k, fb) => localStorage.getItem(k) || fb || '',
      setItem:    (k, v)  => localStorage.setItem(k, v),
      removeItem: (k)     => localStorage.removeItem(k)
    };
  },

  getDefaultWebhookUrl() {
    return (window.SKYLARK_CONFIG?.EMAIL_WEBHOOK_URL) ||
           (window.CONFIG?.EMAIL_WEBHOOK_URL) || '';
  },

  loadAccounts() {
    const s = this.getStorage();
    try {
      const saved = s.getJSON('connected_accounts', null);
      if (Array.isArray(saved) && saved.length > 0) {
        this.accounts = saved;
      } else {
        const email   = s.getItem('account_email', '');
        const webhook = s.getItem('email_webhook_url', '') || this.getDefaultWebhookUrl();
        if (email) {
          this.accounts = [{ id: 'acc_' + Date.now(), email, webhookUrl: webhook, isDefault: true, addedAt: new Date().toISOString() }];
          s.setJSON('connected_accounts', this.accounts);
        } else {
          this.accounts = [];
        }
      }
    } catch(_) { this.accounts = []; }
    this.activeAccount = this.accounts.find(a => a.isDefault) || this.accounts[0] || null;
  },

  // ── Main wizard renderer ──────────────────────────────────────────
  renderWizard() {
    const container = document.getElementById('view-accounts');
    if (!container) return;

    const acc = this.activeAccount;
    const defaultWebhook = this.getDefaultWebhookUrl();
    const currentWebhook = acc?.webhookUrl || defaultWebhook || '';

    container.innerHTML = `
<div style="max-width:780px;margin:0 auto;padding:24px 20px 40px;font-family:inherit;">

  <!-- Header -->
  <div style="margin-bottom:28px;">
    <h2 style="font-size:22px;font-weight:800;margin:0 0 6px;background:linear-gradient(135deg,#3b82f6,#2563eb);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🔗 Accounts & Integrations</h2>
    <p style="color:var(--do-t2,#94a3b8);margin:0;font-size:13px;">Manage email delivery and connect Google Sheets securely through the backend.</p>
    <button type="button" onclick="NexusGoogleSheets?.connect?.()" style="margin-top:12px;padding:10px 14px;border-radius:10px;border:1px solid rgba(59,130,246,.35);background:rgba(59,130,246,.1);color:#60a5fa;font-weight:700;cursor:pointer;">Connect Google Sheets</button>
  </div>

  <!-- Active Account Banner -->
  ${acc ? `
  <div style="background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(16,185,129,.08));border:1px solid rgba(34,197,94,.25);border-radius:14px;padding:14px 18px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:24px;">✅</span>
    <div>
      <div style="font-weight:700;color:#22c55e;font-size:13px;">Active Account</div>
      <div style="font-size:15px;font-weight:600;color:var(--do-t1,#f1f5f9);">${acc.email}</div>
      <div style="font-size:11px;color:#93c5fd;margin-top:2px;">🔗 Webhook connected successfully</div>
    </div>
    <button onclick="AccountsCtrl.removeAccount()" style="margin-left:auto;font-size:11px;padding:5px 12px;border-radius:8px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#f87171;cursor:pointer;">Disconnect</button>
  </div>` : ''}

  <!-- Setup Wizard -->
  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:20px;">

    <!-- How it works -->
    <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:12px;padding:14px;">
      <div style="font-weight:700;color:#60a5fa;margin-bottom:6px;font-size:13px;">ℹ️ How this Works</div>
      <div style="font-size:12px;color:var(--do-t2,#94a3b8);line-height:1.7;">
        You will create a tiny Google Apps Script (a mini-server inside Google). It runs safely as <strong style="color:#f1f5f9;">your Gmail account</strong> and sends emails on your behalf — so they appear in your Gmail Sent folder.<br>
        <strong style="color:#22c55e;">Validity:</strong> This URL <strong>never expires</strong>. It works forever unless you manually delete it from your Google account.
      </div>
    </div>

    <!-- Steps -->
    <div>
      <div style="font-size:13px;font-weight:700;color:#60a5fa;margin-bottom:14px;">Setup Steps (Takes ~2 minutes, do this once):</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${[
          ['1', 'Open Google Apps Script', 'script.google.com', 'https://script.google.com/'],
          ['2', 'Click "New Project" on the top left', null, null],
          ['3', 'Delete any existing code there, and paste our script below', null, null],
          ['4', 'Click "Deploy" (top right) → "New deployment"', null, null],
          ['5', 'Select "Web App" (gear icon) → Execute as: Me → Who has access: Anyone', null, null],
          ['6', 'Click Deploy, Authorize access, and copy the Web App URL!', null, null]
        ].map(([num, text, link, href]) => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:rgba(255,255,255,.03);border-radius:10px;">
            <span style="width:22px;height:22px;background:#3b82f6;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">${num}</span>
            <div style="font-size:12px;color:var(--do-t2,#94a3b8);">${text}${link ? ` → <a href="${href}" target="_blank" style="color:#60a5fa;text-decoration:none;">${link}</a>` : ''}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Copy Script -->
    <div>
      <button onclick="EmailCtrl?.copyGasScriptCode?.()"
        style="width:100%;padding:14px;border-radius:10px;border:1px dashed rgba(96,165,250,.4);background:rgba(59,130,246,.06);color:#60a5fa;font-weight:700;font-size:13px;cursor:pointer;transition:all .2s;">
        📋 CLICK HERE TO COPY THE SCRIPT CODE
      </button>
    </div>

    <!-- Webhook URL input -->
    <div style="margin-top:10px;">
      <label style="font-size:11px;color:var(--do-t3,#64748b);font-weight:600;display:block;margin-bottom:5px;">1. Your Gmail Address</label>
      <input id="account-email" type="email" value="${acc?.email || ''}"
        placeholder="yourname@gmail.com"
        style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--do-t1,#f1f5f9);font-size:14px;outline:none;box-sizing:border-box;margin-bottom:15px;">

      <label style="font-size:11px;color:var(--do-t3,#64748b);font-weight:600;display:block;margin-bottom:5px;">2. Paste the Web App URL here</label>
      <input id="email-webhook-url" type="url" value="${currentWebhook}"
        placeholder="https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
        style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--do-t1,#f1f5f9);font-size:13px;outline:none;box-sizing:border-box;">
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;">
      <button onclick="AccountsCtrl.saveAccount(event)"
        style="flex:1;min-width:160px;padding:12px 20px;border-radius:12px;border:none;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-weight:700;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
        ✅ Save Webhook
      </button>
      <button onclick="AccountsCtrl.testConnection(event)"
        style="padding:12px 20px;border-radius:12px;border:1px solid rgba(59,130,246,.3);background:rgba(59,130,246,.08);color:#60a5fa;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
        🔌 Test Connection
      </button>
    </div>

    <!-- Persistent, readable result line. The toast disappears; this does not,
         so the user can still see what happened after looking away. -->
    <div id="account-save-status" role="status" aria-live="polite"
      style="margin-top:12px;font-size:12.5px;line-height:1.5;min-height:18px;"></div>
  </div>
</div>`;
  },

  // ── Inline status line helper ─────────────────────────────────────
  // Writes a result the user can still read after the toast has gone.
  _setStatus(kind, text) {
    const el = document.getElementById('account-save-status');
    if (!el) return;
    const palette = {
      success: { color: '#10b981', icon: '✓' },
      error:   { color: '#ef4444', icon: '✕' },
      warning: { color: '#f59e0b', icon: '!' },
      info:    { color: 'var(--do-t3,#94a3b8)', icon: 'ℹ' }
    };
    const tone = palette[kind] || palette.info;
    const stamp = new Date().toLocaleTimeString();
    el.innerHTML =
      `<span style="color:${tone.color};font-weight:700;">${tone.icon} ${this._escape(text)}</span>` +
      `<span style="color:var(--do-t3,#94a3b8);"> · ${stamp}</span>`;
  },

  _escape(value) {
    return String(value).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  },

  // ── Save GAS account ──────────────────────────────────────────────
  // Every exit path now reports something: a toast, an inline status line, and
  // the button itself. Previously an invalid URL or a silent success both left
  // the screen unchanged, which read as "the button does nothing".
  saveAccount(event) {
    const btn = event?.currentTarget || null;
    const emailInput = document.getElementById('account-email');
    const webhookInput = document.getElementById('email-webhook-url');

    const email = emailInput?.value.trim() || '';
    const webhook = webhookInput?.value.trim() || '';
    const finalWebhook = webhook || this.getDefaultWebhookUrl();

    const fail = (title, message, focusEl) => {
      window.showToast?.('warning', title, message);
      this._setStatus('warning', message);
      if (btn && window.ButtonFeedback) window.ButtonFeedback.busy(btn, 'Checking…').warn(title);
      focusEl?.focus();
    };

    if (!email || !email.includes('@')) {
      fail('Gmail address needed', 'Enter the Gmail address you deployed the script with.', emailInput);
      return false;
    }
    if (!finalWebhook) {
      fail('Webhook URL needed', 'Paste the Web App URL you copied after clicking Deploy.', webhookInput);
      return false;
    }
    if (!finalWebhook.startsWith('https://script.google.com/')) {
      fail('That does not look like a Web App URL', 'It must start with https://script.google.com/ — re-copy it from the Deploy dialog.', webhookInput);
      return false;
    }

    try {
      this._saveAccountLocally(email, finalWebhook);
    } catch (err) {
      console.error('[Accounts] save failed:', err);
      window.showToast?.('error', 'Could not save', 'Saving to this browser failed. Check that storage is not full or blocked.');
      this._setStatus('error', 'Not saved — browser storage rejected the write.');
      if (btn && window.ButtonFeedback) window.ButtonFeedback.busy(btn, 'Saving…').error('Not saved');
      return false;
    }

    // Read back what was actually persisted, so success is proven, not assumed.
    const persisted = this.accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!persisted || persisted.webhookUrl !== finalWebhook) {
      window.showToast?.('error', 'Save could not be verified', 'The value did not read back correctly. Please try again.');
      this._setStatus('error', 'Save could not be verified — please try again.');
      if (btn && window.ButtonFeedback) window.ButtonFeedback.busy(btn, 'Saving…').error('Not verified');
      return false;
    }

    window.showToast?.('success', '🔗 Webhook Saved', `${email} is now connected.`);
    this._setStatus('success', `Saved. ${email} is connected. Use Test Connection to confirm it responds.`);
    if (btn && window.ButtonFeedback) window.ButtonFeedback.busy(btn, 'Saving…').success('Saved');

    setTimeout(() => this.renderWizard(), 1400);
    return true;
  },

  // ── Test the saved webhook actually responds ───────────────────────
  // Save only proves the URL was stored. This proves the endpoint answers.
  async testConnection(event) {
    const btn = event?.currentTarget || null;

    if (typeof window.EmailCtrl?.pingWebhook !== 'function') {
      window.showToast?.('error', 'Test unavailable', 'The email module has not loaded yet. Reload the page and try again.');
      this._setStatus('error', 'Test unavailable — email module not loaded.');
      if (btn && window.ButtonFeedback) window.ButtonFeedback.busy(btn, 'Testing…').error('Unavailable');
      return false;
    }

    const handle = window.ButtonFeedback
      ? window.ButtonFeedback.busy(btn, 'Testing…')
      : { success() {}, error() {}, warn() {} };

    this._setStatus('info', 'Contacting your Apps Script deployment…');

    try {
      // pingWebhook returns { ok, degraded?, reason?, message } and raises its
      // own toast with the provider detail. We only translate that into the
      // button state and the persistent status line.
      const result = await window.EmailCtrl.pingWebhook();

      if (!result || result.ok !== true) {
        handle.error('No response');
        this._setStatus('error', result?.message || 'The webhook did not respond.');
        return false;
      }

      if (result.degraded) {
        handle.warn('Reachable');
        this._setStatus('warning', result.message);
        return true;
      }

      handle.success('Connected');
      this._setStatus('success', result.message || 'Webhook responded. Email sending is ready.');
      return true;
    } catch (err) {
      console.error('[Accounts] webhook test failed:', err);
      handle.error('Failed');
      this._setStatus('error', 'Test failed — check the URL and your internet connection.');
      return false;
    }
  },

  _saveAccountLocally(email, webhookUrl) {
    const s = this.getStorage();
    let existing = this.accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      existing.webhookUrl = webhookUrl; existing.updatedAt = new Date().toISOString();
      this.accounts.forEach(a => a.isDefault = (a.id === existing.id));
    } else {
      this.accounts.forEach(a => a.isDefault = false);
      existing = { id: 'acc_' + Date.now(), email, webhookUrl, isDefault: true, addedAt: new Date().toISOString() };
      this.accounts.push(existing);
    }
    this.activeAccount = existing;
    s.setJSON('connected_accounts', this.accounts);
    s.setItem('email_webhook_url', webhookUrl);
    s.setItem('account_email', email);
  },

  removeAccount() {
    if (!this.activeAccount) return;
    if (!confirm(`Disconnect ${this.activeAccount.email}?`)) return;
    const s = this.getStorage();
    this.accounts = this.accounts.filter(a => a.id !== this.activeAccount.id);
    this.activeAccount = this.accounts[0] || null;
    if (this.activeAccount) this.activeAccount.isDefault = true;
    s.setJSON('connected_accounts', this.accounts);
    s.setItem('email_webhook_url', this.activeAccount?.webhookUrl || '');
    s.setItem('account_email', this.activeAccount?.email || '');
    this.renderWizard();
    window.showToast?.('info', 'Disconnected', 'Account removed.');
  },

  getActiveAccount() {
    if (!this.activeAccount) this.loadAccounts();
    return this.activeAccount;
  },

  // Legacy compat
  renderUI() { this.renderWizard(); },
  switchAccount(id) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return;
    const s = this.getStorage();
    this.accounts.forEach(a => a.isDefault = (a.id === id));
    this.activeAccount = acc;
    s.setJSON('connected_accounts', this.accounts);
    s.setItem('email_webhook_url', acc.webhookUrl || '');
    s.setItem('account_email', acc.email);
    this.renderWizard();
  }
};

// ── Global bridges ──────────────────────────────────────────────────
window.AccountsCtrl    = AccountsCtrl;
window.saveEmailWebhook = () => AccountsCtrl.saveAccount();
window.switchSavedEmail = (v) => AccountsCtrl.switchAccount(v);
window.removeSavedEmail = () => AccountsCtrl.removeAccount();
window.renderAccountsUI = () => AccountsCtrl.renderWizard();

document.addEventListener('DOMContentLoaded', () => AccountsCtrl.init());
