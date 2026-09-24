/**
 * page-email.js — Email Automation Controller (v4 — Production Grade)
 *
 * KEY ARCHITECTURAL CHANGE:
 *   - Uses fetch with mode:'cors' so we can READ the GAS response
 *   - Actual success/failure is determined by response.status === 'success'
 *   - CC/BCC fields are properly read and passed to GAS webhook
 *   - Sender name is passed from user profile
 *   - Reply-To is passed from the account email
 *   - Quota check before batch starts (via GET /webhook)
 *   - Full sent log with real status (not optimistic)
 *   - Retry failed emails with one click
 *   - Test Email: sends a single email to yourself before bulk send
 *   - Webhook health check (ping button)
 */
'use strict';

const EmailCtrl = {
  attachments: [],
  isSending: false,
  cancelRequested: false,
  currentTab: 'compose',
  sentLog: [],
  initialized: false,
  draftLoaded: false,
  draftDirty: false,
  signatureDirty: false,
  draftSaveTimer: null,
  signatureSaveTimer: null,
  SIGNATURE_KEY: 'email_signature_v2',

  init() {
    if (this.initialized) {
      this.onShow();
      return;
    }
    this.initialized = true;
    this.sentLog = this._loadSentLog();
    this.bindEvents();
    this.loadDraft();
    this.updateAudienceStats();
    this._updateSentBadge();
    this.syncWebhookInput();
    this.enhanceResizableMedia(document.getElementById('view-email'));
  },

  onShow() {
    this.updateAudienceStats();
    this._updateSentBadge();
    this.syncWebhookInput();
    this.enhanceResizableMedia(document.getElementById('view-email'));
    if (this.currentTab === 'sent') this.renderSentTab();
  },

  bindEvents() {
    const audienceSelects = [
      document.getElementById('email-target'),
      document.getElementById('email-audience-select')
    ].filter(Boolean);
    audienceSelects.forEach(sel => {
      if (!sel.hasAttribute('onchange')) sel.addEventListener('change', () => this.updateAudienceStats());
    });

    const batchInputs = [
      document.getElementById('email-batch-size'),
      document.getElementById('email-batch-limit')
    ].filter(Boolean);
    batchInputs.forEach(inp => {
      if (!inp.hasAttribute('oninput')) inp.addEventListener('input', () => this.updateAudienceStats());
    });

    ['email-body-rich', 'email-subject', 'email-cc', 'email-bcc'].forEach(id => {
      const field = document.getElementById(id);
      field?.addEventListener('input', () => this.queueDraftSave());
    });

    const signature = document.getElementById('email-signature-rich');
    signature?.addEventListener('input', () => {
      this.signatureDirty = true;
      this.enhanceResizableMedia(signature);
      this.queueSignatureSave();
    });

    [document.getElementById('email-body-rich'), signature].filter(Boolean).forEach(editor => {
      editor.addEventListener('paste', () => {
        setTimeout(() => {
          this.removeUnsafeEditorContent(editor);
          this.enhanceResizableMedia(editor);
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }, 0);
      });
    });

    const emailView = document.getElementById('view-email');
    emailView?.addEventListener('pointerdown', event => this.beginMediaResize(event));
    emailView?.addEventListener('click', event => this.selectMedia(event));
    emailView?.addEventListener('keydown', event => this.handleMediaDelete(event));
    window.addEventListener('beforeunload', () => this.flushPendingSaves());
  },

  queueDraftSave() {
    this.draftDirty = true;
    clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = setTimeout(() => this.saveDraft(), 450);
  },

  queueSignatureSave() {
    clearTimeout(this.signatureSaveTimer);
    this.signatureSaveTimer = setTimeout(() => this.saveSignature(false), 450);
    this.setSignatureStatus('Saving…');
  },

  flushPendingSaves() {
    clearTimeout(this.draftSaveTimer);
    clearTimeout(this.signatureSaveTimer);
    if (this.draftDirty) this.saveDraft();
    if (this.signatureDirty) this.saveSignature(false);
  },

  setSignatureStatus(text, tone = 'neutral') {
    const status = document.getElementById('email-signature-save-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  },

  // ─── Tab Switching ───────────────────────────────────────────
  showTab(tab) {
    this.currentTab = tab;
    const composeEl = document.getElementById('email-compose-panel');
    const sentEl    = document.getElementById('email-sent-panel');
    const tabBtns   = document.querySelectorAll('.email-tab-btn');

    if (composeEl) composeEl.style.display = (tab === 'compose') ? '' : 'none';
    if (sentEl)    sentEl.style.display    = (tab === 'sent')    ? '' : 'none';

    tabBtns.forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('email-tab-active', isActive);
      btn.style.background = isActive ? 'var(--do-blue,#0b57d0)' : 'transparent';
      btn.style.color      = isActive ? '#fff' : 'var(--do-t2,#64748b)';
    });

    if (tab === 'sent') this.renderSentTab();
  },

  // ─── Variable Injection ──────────────────────────────────────
  insertVariable(token) {
    const bodyRich = document.getElementById('email-body-rich');
    const active   = document.activeElement;
    if (active && active.id === 'email-subject') {
      const start = active.selectionStart || 0;
      const end   = active.selectionEnd   || 0;
      active.value = active.value.substring(0, start) + token + active.value.substring(end);
      active.selectionStart = active.selectionEnd = start + token.length;
      active.focus();
    } else if (bodyRich) {
      bodyRich.focus();
      document.execCommand('insertText', false, token);
    }
    this.saveDraft();
  },

  // ─── Rich Text Toolbar ───────────────────────────────────────
  formatText(cmd, val = null) {
    this.formatEditor('email-body-rich', cmd, val);
  },

  toggleFormatting() {
    const bar = document.getElementById('gmail-formatting-bar');
    if (bar) bar.style.display = (bar.style.display === 'none' || !bar.style.display) ? 'flex' : 'none';
  },

  toggleCcBcc() {
    const cc  = document.getElementById('gmail-cc-row');
    const bcc = document.getElementById('gmail-bcc-row');
    if (cc && bcc) {
      const isHidden = cc.style.display === 'none' || !cc.style.display;
      cc.style.display  = isHidden ? 'flex' : 'none';
      bcc.style.display = isHidden ? 'flex' : 'none';
    }
  },

  // ─── Attachments ─────────────────────────────────────────────
  handleFileUpload(e) {
    const fileList = Array.from(e.target?.files || []);
    const promises = fileList.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => resolve({
        name: file.name,
        type: file.type,
        size: (file.size / 1024).toFixed(1) + ' KB',
        // base64 data (strip the data URL prefix)
        data: ev.target.result.split(',')[1]
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(promises).then(results => {
      this.attachments.push(...results);
      this.renderAttachments();
    });
  },

  renderAttachments() {
    const container = document.getElementById('gmail-attachments-preview') || document.getElementById('email-attachments-list');
    if (!container) return;
    if (this.attachments.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = this.attachments.map((att, idx) => `
      <div class="attachment-pill" style="display:inline-flex;align-items:center;gap:6px;background:#f1f3f4;border:1px solid #dadce0;border-radius:16px;padding:4px 10px;font-size:12px;margin:4px;">
        <span>📎</span>
        <span style="font-weight:500;color:#3c4043;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${att.name}</span>
        <span style="opacity:.6;font-size:11px;">(${att.size})</span>
        <button type="button" style="background:none;border:none;cursor:pointer;color:#70757a;font-size:12px;margin-left:4px;" onclick="EmailCtrl.removeAttachment(${idx})">✕</button>
      </div>`).join('');
  },

  removeAttachment(idx) {
    this.attachments.splice(idx, 1);
    this.renderAttachments();
  },

  // ─── Storage Helper ──────────────────────────────────────────
  getStorage() {
    return window.UserStorage || {
      getJSON:    (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || fb; } catch(_) { return fb; } },
      setJSON:    (k, v)  => localStorage.setItem(k, JSON.stringify(v)),
      getItem:    (k, fb) => localStorage.getItem(k) || fb,
      setItem:    (k, v)  => localStorage.setItem(k, v)
    };
  },

  // ─── Webhook Resolution & Setup ────────────────────────────────
  syncWebhookInput() {
    const emailInput = document.getElementById('email-sender-address-input');
    if (emailInput) {
      emailInput.value = localStorage.getItem('email_sender_address') || 
                         window.AccountsCtrl?.getActiveAccount?.()?.email || '';
    }
    const webhookInput = document.getElementById('email-sender-webhook-input');
    if (webhookInput) {
      webhookInput.value = this._getWebhookUrl();
    }
  },

  saveSenderAddressFromPage() {
    const input = document.getElementById('email-sender-address-input');
    if (!input) return;
    const email = input.value.trim();
    if (email && (!email.includes('@') || !email.includes('.'))) {
      if (window.showToast) window.showToast('warning', 'Invalid Email', 'Please enter a valid Gmail address (e.g. name@gmail.com)');
      return;
    }
    localStorage.setItem('email_sender_address', email);
    const activeAcc = window.AccountsCtrl?.getActiveAccount?.();
    if (activeAcc) {
      activeAcc.email = email;
    }
    if (window.showToast) window.showToast('success', 'Sender Email Saved 💾', email ? `Sending emails as ${email}` : 'Sender email cleared.');
    this.pingWebhook();
  },

  saveWebhookFromPage() {
    const input = document.getElementById('email-sender-webhook-input');
    if (!input) return;
    const url = input.value.trim();
    if (url && !url.startsWith('https://script.google.com/')) {
      if (window.showToast) window.showToast('warning', 'Invalid Webhook URL', 'Google Apps Script Webhook URLs start with https://script.google.com/');
      return;
    }
    // Webhook URLs are backend-managed; never persist them in this browser.
    url = '';
    if (window.showToast) window.showToast('success', 'Sender Setup Saved 💾', url ? 'Gmail Webhook connected successfully!' : 'Webhook URL cleared.');
    this.pingWebhook();
  },

  copyGasScriptCode() {
    const scriptCode = `/**
 * NEXUS AI EMAIL AUTOMATION — Google Apps Script (GAS) Webhook v4
 *
 * SETUP INSTRUCTIONS (~2 minutes, one-time):
 * 1. Open https://script.google.com/ → click "New Project"
 * 2. Delete default code → paste this entire script
 * 3. Click "Deploy" → "New deployment" → type: "Web app"
 * 4. Execute as: "Me"  |  Who has access: "Anyone"
 * 5. Click "Deploy" → Authorize → Copy the Web app URL
 * 6. Paste the URL into the app → Accounts → Gmail Webhook → Save
 *
 * Emails sent will appear in your Gmail SENT folder automatically.
 *
 * NOTE: This script accepts Content-Type: text/plain with a JSON body
 * (used when the app runs from file:// where CORS is blocked).
 * e.postData.contents always contains the raw body string regardless.
 */

// ── CONFIG ─────────────────────────────────────────────────────────
var CONFIG = {
  MAX_RECIPIENTS_PER_REQUEST: 1,
  SENDER_NAME: '',   // leave blank to use your Google profile name
  REPLY_TO: ''
};

// ── CORS Headers ────────────────────────────────────────────────────
function addCORSHeaders(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    .setHeader('Access-Control-Max-Age', '86400');
}

// ── GET: Health check ───────────────────────────────────────────────
function doGet(e) {
  return addCORSHeaders(
    ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      service: 'Nexus AI Email Webhook v4',
      senderEmail: Session.getActiveUser().getEmail(),
      dailyQuotaRemaining: MailApp.getRemainingDailyQuota(),
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON)
  );
}

// ── OPTIONS: Preflight ──────────────────────────────────────────────
function doOptions(e) {
  return addCORSHeaders(ContentService.createTextOutput(""));
}

// ── POST: Send Email ────────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return errorResponse('No POST data received');
    }
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (parseErr) { return errorResponse('Invalid JSON: ' + parseErr.toString()); }

    var toAddress = (data.to      || '').trim();
    var subject   = (data.subject || '').trim();
    var htmlBody  = data.htmlBody || data.body || '';

    if (!toAddress) return errorResponse('Missing: to');
    if (!subject)   return errorResponse('Missing: subject');
    if (!htmlBody)  return errorResponse('Missing: htmlBody');
    if (!toAddress.includes('@')) return errorResponse('Invalid email: ' + toAddress);

    var quota = MailApp.getRemainingDailyQuota();
    if (quota <= 0) return errorResponse('Daily quota exhausted. Resets at midnight PT.');

    var senderName = CONFIG.SENDER_NAME || data.senderName ||
                     Session.getActiveUser().getEmail().split('@')[0];

    var opts = {
      to: toAddress, subject: subject, htmlBody: htmlBody, name: senderName,
      body: htmlBody.replace(/<[^>]*>/g, '').replace(/\\s+/g, ' ').trim()
    };
    if (data.cc  && data.cc.trim())  opts.cc  = data.cc.trim();
    if (data.bcc && data.bcc.trim()) opts.bcc = data.bcc.trim();
    var replyTo = CONFIG.REPLY_TO || data.replyTo || '';
    if (replyTo) opts.replyTo = replyTo;

    var atts = [];
    (data.attachments || []).forEach(function(a) {
      if (a.data && a.name && a.type)
        atts.push(Utilities.newBlob(Utilities.base64Decode(a.data), a.type, a.name));
    });
    if (atts.length) opts.attachments = atts;

    MailApp.sendEmail(opts);

    return addCORSHeaders(
      ContentService.createTextOutput(JSON.stringify({
        status: 'success', message: 'Email sent successfully',
        to: toAddress, subject: subject,
        quotaRemaining: MailApp.getRemainingDailyQuota(),
        sentAt: new Date().toISOString()
      })).setMimeType(ContentService.MimeType.JSON)
    );
  } catch (err) {
    return errorResponse(err.toString());
  }
}

function errorResponse(msg) {
  return addCORSHeaders(
    ContentService.createTextOutput(JSON.stringify({ status: 'error', message: msg }))
      .setMimeType(ContentService.MimeType.JSON)
  );
}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(scriptCode).then(() => {
        if (window.showToast) window.showToast('success', 'Code Copied! 📋', 'Paste into script.google.com -> Deploy as Web App -> Anyone.');
      }).catch(() => {
        this._fallbackCopyText(scriptCode);
      });
    } else {
      this._fallbackCopyText(scriptCode);
    }
  },

  _fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (window.showToast) window.showToast('success', 'Code Copied! 📋', 'Paste into script.google.com -> Deploy as Web App -> Anyone.');
  },

  _getWebhookUrl() {
    const storage   = this.getStorage();
    const activeAcc = window.AccountsCtrl?.getActiveAccount?.();
    return activeAcc?.webhookUrl ||
           '';
  },

  // ─── Webhook Health Check / Ping ─────────────────────────────
  /**
   * Tests the configured Apps Script webhook.
   *
   * ALWAYS returns a result object so callers can react honestly:
   *   { ok: true,  degraded?: boolean, message: string }
   *   { ok: false, reason: string,     message: string }
   *
   * It previously returned undefined on every path, success and failure alike,
   * so a caller had no way to tell a working webhook from a dead one.
   */
  async pingWebhook() {
    const url = this._getWebhookUrl();
    if (!url || !url.startsWith('https://script.google.com/')) {
      if (window.showToast) window.showToast('warning', 'No Webhook URL',
        'Paste your Google Apps Script Web App URL in the Accounts tab → Gmail Webhook field.');
      return { ok: false, reason: 'no-url', message: 'No webhook URL is configured.' };
    }
    const pingBtn = document.getElementById('email-ping-btn');
    if (pingBtn) { pingBtn.disabled = true; pingBtn.textContent = 'Checking…'; }

    // ── Strategy 1: CORS mode (works when GAS is deployed with "Anyone" access) ──
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch(url, {
        method:  'GET',
        mode:    'cors',
        signal:  controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        // HTTP error from GAS (e.g. 401 Unauthorized — script not deployed for "Anyone")
        const detail = res.status === 401
          ? 'Re-deploy the GAS script and set "Who has access" → Anyone.'
          : `Server returned ${res.status}. Re-deploy your GAS script.`;
        if (window.showToast) window.showToast('error', `Webhook Error (HTTP ${res.status})`, detail);
        if (pingBtn) { pingBtn.disabled = false; pingBtn.textContent = '🔌 Test Connection'; }
        return { ok: false, reason: `http-${res.status}`, message: detail };
      }

      const json = await res.json();
      if (pingBtn) { pingBtn.disabled = false; pingBtn.textContent = '🔌 Test Connection'; }

      if (json.status === 'ok') {
        const detail = `Sender: ${json.senderEmail || '?'} · Quota today: ${json.dailyQuotaRemaining ?? '?'} emails left`;
        if (window.showToast) window.showToast('success', '✅ Webhook Connected', detail);
        return { ok: true, message: detail };
      }

      const errMsg = json.message || 'Unknown error from GAS';
      if (window.showToast) window.showToast('error', 'Webhook Error', errMsg);
      return { ok: false, reason: 'gas-error', message: errMsg };

    } catch (corsErr) {
      // ── Strategy 2: CORS blocked (common when running from file:// or http://localhost) ──
      // Fall back: try no-cors ping just to confirm the URL is reachable at all.
      const isCorsBlock = corsErr.name === 'TypeError' ||
                          (corsErr.message || '').toLowerCase().includes('failed to fetch') ||
                          (corsErr.message || '').toLowerCase().includes('cors') ||
                          corsErr.name === 'AbortError';

      if (pingBtn) { pingBtn.disabled = false; pingBtn.textContent = '🔌 Test Connection'; }

      if (isCorsBlock) {
        // no-cors fetch — we cannot read the body but no throw means the URL is live
        try {
          await fetch(url, { method: 'GET', mode: 'no-cors' });
          const detail = 'GAS script URL is live. CORS headers are blocked by your browser in local mode — ' +
            'emails will still send normally. For full status, serve the app over HTTPS.';
          if (window.showToast) window.showToast('success', '✅ Webhook Reachable', detail);
          // degraded: reachable, but the response body could not be verified.
          return { ok: true, degraded: true, message: 'Reachable (response body blocked by CORS in local mode).' };
        } catch (noCorsErr) {
          const detail = 'The GAS script URL is not responding. Steps to fix:\n' +
            '1. Open script.google.com\n' +
            '2. Click Deploy → Manage deployments\n' +
            '3. Edit → set "Who has access" → Anyone\n' +
            '4. Click Deploy → copy new URL → paste here';
          if (window.showToast) window.showToast('error', '❌ Cannot Reach Webhook', detail);
          return { ok: false, reason: 'unreachable', message: 'The webhook URL is not responding.' };
        }
      }

      // Unexpected error
      const detail = `Unexpected error: ${corsErr.message || corsErr}. ` +
        'Try re-deploying the GAS script as a Web App with "Anyone" access.';
      if (window.showToast) window.showToast('error', 'Connection Failed', detail);
      return { ok: false, reason: 'unexpected', message: String(corsErr.message || corsErr) };
    }
  },

  // Convert editor data-URL images/GIFs to CID payloads. Gmail and many mail
  // clients block data: URLs inside HTML, while CID inline images render reliably.
  prepareInlineMedia(htmlBody) {
    const host = document.createElement('div');
    host.innerHTML = htmlBody || '';
    const inlineImages = [];
    const seen = new Map();
    host.querySelectorAll('img[src^="data:image/"]').forEach((img, index) => {
      const src = img.getAttribute('src') || '';
      let cid = seen.get(src);
      if (!cid) {
        const match = src.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
        if (!match) { img.remove(); return; }
        cid = `nexus_inline_${seen.size + 1}`;
        seen.set(src, cid);
        const extension = (match[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
        inlineImages.push({ cid, name: `${cid}.${extension}`, type: match[1], data: match[2] });
      }
      img.setAttribute('src', `cid:${cid}`);
    });
    return { htmlBody: host.innerHTML, inlineImages };
  },

  // ─── Single Email Sender (core) ──────────────────────────────
  /**
   * Sends ONE email via the Google Apps Script Webhook.
   * Perfect for file:// executions because it automatically handles CORS.
   */
  async _sendOne({ to, subject, htmlBody, cc, bcc, replyTo, senderName, attachments }) {
    const prepared = this.prepareInlineMedia(htmlBody);
    const payload = {
      to,
      subject,
      htmlBody: prepared.htmlBody,
      inlineImages: prepared.inlineImages,
      cc: cc || '',
      bcc: bcc || '',
      replyTo: replyTo || '',
      senderName: senderName || '',
      attachments: attachments || []
    };

    const webhookUrl = this._getWebhookUrl();
    if (!webhookUrl) {
      return { success: false, error: 'No webhook URL configured. Go to Accounts tab to set it up.' };
    }

    try {
      // If we are on http/https, we can try CORS mode to get a real response.
      // If we are on file://, CORS mode will throw immediately.
      const isFileUrl = window.location.protocol === 'file:';
      
      if (!isFileUrl) {
        try {
          const ctrl = new AbortController();
          const tid  = setTimeout(() => ctrl.abort(), 8000);
          const res  = await fetch(webhookUrl, {
            method:  'POST',
            mode:    'cors',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
            signal:  ctrl.signal
          });
          clearTimeout(tid);

          if (res.ok) {
            const json = await res.json();
            if (json.status === 'success') return { success: true, quotaRemaining: json.quotaRemaining, source: 'gas-cors' };
            return { success: false, error: json.message || 'GAS error', source: 'gas-cors' };
          }
        } catch(e) {
          console.warn('CORS request failed, falling back to no-cors mode', e);
        }
      }

      // STRATEGY: no-cors + text/plain
      // Works flawlessly on file:// because text/plain is a simple header (no preflight needed).
      // We cannot read the response, so we optimistically assume success if the network request goes through.
      await fetch(webhookUrl, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify(payload)
      });
      return { success: true, corsBlind: true, source: 'gas-nocors' };

    } catch (err) {
      return { success: false, error: err?.message || 'Network error', source: 'gas' };
    }
  },


  // ─── Test Email (single, to yourself) ────────────────────────
  async sendTestEmail() {
    const profile = window.UserProfileManager?.getProfile?.();
    const testTo  = profile?.email || '';

    if (!testTo || !testTo.includes('@')) {
      if (window.showToast) window.showToast('warning', 'No Email Found',
        'Add your email in Settings > Profile first so we know where to send the test.');
      return;
    }

    this.flushPendingSaves();
    const subject = document.getElementById('email-subject')?.value || '(Test) Email';
    const body = this.getCleanEditorHtml('email-body-rich') || '<p>Test email</p>';
    const sig = this.getCleanEditorHtml('email-signature-rich');
    const signatureBlock = sig
      ? `<div style="margin-top:20px;border-top:1px solid #e0e0e0;padding-top:10px;">${sig}</div>`
      : '';
    const fullHtml = `
      <div style="font-family:Arial,sans-serif;color:#202124;line-height:1.6;">
        ${body}
        ${signatureBlock}
      </div>`;

    const testBtn = document.getElementById('email-test-btn');
    if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Sending…'; }

    const result = await this._sendOne({
      to:         testTo,
      subject:    `[TEST] ${subject}`,
      htmlBody:   fullHtml,
      senderName: profile?.name || ''
    });

    if (testBtn) { testBtn.disabled = false; testBtn.textContent = '🧪 Send Test Email'; }

    if (result.success) {
      if (window.showToast) window.showToast('success', 'Test Email Sent!',
        `Test email delivered to ${testTo}. Check your inbox.${result.corsBlind ? ' (GAS v1 script — upgrade for accurate status)' : ''}`);
    } else {
      if (window.showToast) window.showToast('error', 'Test Failed', result.error || 'Unknown error. Check webhook URL.');
    }
  },

  // ─── Audience Filter ─────────────────────────────────────────
  getFilteredAudience() {
    let leads = [];
    try {
      const storage = this.getStorage();
      leads = storage.getJSON('allLeads', window.allLeads || []);
    } catch(e) {}

    const targetType = document.getElementById('email-target')?.value ||
                       document.getElementById('email-audience-select')?.value || 'uncontacted';
    const limit = parseInt(
      document.getElementById('email-batch-size')?.value ||
      document.getElementById('email-batch-limit')?.value, 10) || 10;

    let filtered = (Array.isArray(leads) ? leads : []).filter(l => l && l.email && l.email.includes('@'));

    if (targetType === 'uncontacted') {
      filtered = filtered.filter(l =>
        !l.status ||
        l.status.toLowerCase() === 'new' ||
        l.status.toLowerCase() === 'uncontacted'
      );
    }

    return filtered.slice(0, limit);
  },

  updateAudienceStats() {
    const audience = this.getFilteredAudience();
    const countEls = [
      document.getElementById('email-target-count'),
      document.getElementById('email-to-recipients')
    ].filter(Boolean);

    countEls.forEach(el => {
      if (el.tagName === 'INPUT') {
        el.value = audience.length > 0
          ? `${audience.length} Recipients Selected`
          : 'No valid emails found in filter';
      } else {
        el.textContent = `${audience.length} recipients selected`;
      }
    });

    const previewList = document.getElementById('email-preview-list') || document.getElementById('email-recipient-preview');
    if (previewList) {
      if (audience.length === 0) {
        previewList.innerHTML = '<div style="padding:8px;color:var(--do-t3);font-style:italic;">No uncontacted leads with valid emails found.</div>';
      } else {
        previewList.innerHTML = audience.map(l => `
          <div style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;color:var(--do-t1,#202124);font-size:12px;">${l.company || 'Lead'}</span>
            <span style="font-family:monospace;color:var(--do-blue,#0b57d0);font-size:11px;">${l.email}</span>
          </div>`).join('');
      }
    }
  },

  // ─── Rich signature + inline media ───────────────────────────
  loadSignature(draft = null) {
    const editor = document.getElementById('email-signature-rich');
    if (!editor) return;
    const storage = this.getStorage();
    let saved = storage.getItem(this.SIGNATURE_KEY, null);

    // One-time migration: an explicitly saved legacy signature wins over old
    // draft/default content, then becomes user-scoped from this point onward.
    if (saved === null || saved === undefined) {
      const rawSaved = localStorage.getItem('skylark_email_signature');
      let legacyTemplate = null;
      try { legacyTemplate = JSON.parse(localStorage.getItem('skylark_email_template') || 'null'); } catch (_) {}
      if (rawSaved !== null) saved = rawSaved;
      else if (draft && Object.prototype.hasOwnProperty.call(draft, 'signature')) saved = draft.signature;
      else if (legacyTemplate && Object.prototype.hasOwnProperty.call(legacyTemplate, 'signature')) saved = legacyTemplate.signature;
      else saved = editor.innerHTML;
      try { storage.setItem(this.SIGNATURE_KEY, saved); } catch (_) {}
    }

    // Empty is a valid custom signature; never replace it with a default.
    editor.innerHTML = saved == null ? '' : String(saved);
    this.removeUnsafeEditorContent(editor);
    this.enhanceResizableMedia(editor);
    this.signatureDirty = false;
    this.setSignatureStatus('Saved', 'saved');
  },

  saveSignature(notify = false) {
    const editor = document.getElementById('email-signature-rich');
    if (!editor) return false;
    this.removeUnsafeEditorContent(editor);
    try {
      this.getStorage().setItem(this.SIGNATURE_KEY, editor.innerHTML);
      this.signatureDirty = false;
      clearTimeout(this.signatureSaveTimer);
      this.setSignatureStatus('Saved', 'saved');
      if (notify) window.showToast?.('success', 'Signature Saved', 'Your custom signature, images and sizes are saved.');
      return true;
    } catch (error) {
      this.setSignatureStatus('Could not save', 'error');
      window.showToast?.('error', 'Signature Too Large', 'The image/GIF is too large for browser storage. Use a smaller file.');
      return false;
    }
  },

  removeUnsafeEditorContent(editor) {
    if (!editor) return;
    editor.querySelectorAll('script,style,iframe,object,embed,form,input,button:not(.mail-resize-handle)').forEach(node => node.remove());
    editor.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) node.removeAttribute(attr.name);
      });
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (href && !/^(https?:|mailto:|tel:)/i.test(href)) node.removeAttribute('href');
        else if (href) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
      }
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (!/^(data:image\/|https?:\/\/)/i.test(src)) node.remove();
      }
    });
  },

  resizableMediaHtml(src, name = 'signature-media') {
    const safeName = String(name).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    return `<span class="mail-resizable-media" contenteditable="false" tabindex="0" style="width:180px" title="Click, then drag the blue corner to resize"><img src="${src}" alt="${safeName}"><span class="mail-resize-handle" aria-hidden="true"></span></span>`;
  },

  enhanceResizableMedia(root) {
    if (!root) return;
    root.querySelectorAll('img').forEach(img => {
      let wrapper = img.closest('.mail-resizable-media');
      if (!wrapper) {
        wrapper = document.createElement('span');
        wrapper.className = 'mail-resizable-media';
        wrapper.contentEditable = 'false';
        wrapper.tabIndex = 0;
        wrapper.style.width = `${Math.max(80, Math.min(240, img.getBoundingClientRect().width || img.naturalWidth || 180))}px`;
        img.parentNode?.insertBefore(wrapper, img);
        wrapper.appendChild(img);
      }
      wrapper.contentEditable = 'false';
      wrapper.tabIndex = 0;
      if (!wrapper.style.width) wrapper.style.width = '180px';
      if (!wrapper.querySelector('.mail-resize-handle')) {
        const handle = document.createElement('span');
        handle.className = 'mail-resize-handle';
        handle.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(handle);
      }
    });
  },

  async addInlineMedia(editorId, file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.showToast?.('warning', 'Image / GIF Required', 'Choose an image or animated GIF file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.showToast?.('warning', 'File Too Large', 'Use an image or GIF smaller than 2 MB so the signature stays fast and saves reliably.');
      return;
    }
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const editor = document.getElementById(editorId);
    if (!editor) return;
    editor.focus();
    document.execCommand('insertHTML', false, this.resizableMediaHtml(src, file.name));
    this.enhanceResizableMedia(editor);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (editorId === 'email-signature-rich') this.saveSignature(false);
  },

  selectMedia(event) {
    const view = document.getElementById('view-email');
    const selected = event.target.closest?.('.mail-resizable-media');
    view?.querySelectorAll('.mail-resizable-media.is-selected').forEach(node => {
      if (node !== selected) node.classList.remove('is-selected');
    });
    if (selected) selected.classList.add('is-selected');
  },

  beginMediaResize(event) {
    const handle = event.target.closest?.('.mail-resize-handle');
    if (!handle) return;
    const wrapper = handle.closest('.mail-resizable-media');
    const editor = wrapper?.closest('[contenteditable="true"]');
    if (!wrapper || !editor) return;
    event.preventDefault();
    event.stopPropagation();
    wrapper.classList.add('is-selected', 'is-resizing');
    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    let frame = 0;
    let latestX = startX;

    const apply = () => {
      frame = 0;
      const maxWidth = Math.max(80, editor.clientWidth - 20);
      const next = Math.max(60, Math.min(maxWidth, startWidth + latestX - startX));
      wrapper.style.width = `${Math.round(next)}px`;
    };
    const move = moveEvent => {
      latestX = moveEvent.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const finish = () => {
      if (frame) { cancelAnimationFrame(frame); apply(); }
      wrapper.classList.remove('is-resizing');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      if (editor.id === 'email-signature-rich') this.saveSignature(false);
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', finish, { once: true });
    document.addEventListener('pointercancel', finish, { once: true });
  },

  handleMediaDelete(event) {
    if (!['Delete', 'Backspace'].includes(event.key)) return;
    const selected = document.querySelector('#view-email .mail-resizable-media.is-selected');
    if (!selected) return;
    const editor = selected.closest('[contenteditable="true"]');
    event.preventDefault();
    selected.remove();
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
  },

  getCleanEditorHtml(editorId) {
    const editor = document.getElementById(editorId);
    if (!editor) return '';
    const clone = editor.cloneNode(true);
    this.removeUnsafeEditorContent(clone);
    clone.querySelectorAll('.mail-resizable-media').forEach(wrapper => {
      const img = wrapper.querySelector('img');
      if (!img) { wrapper.remove(); return; }
      const width = Math.round(parseFloat(wrapper.style.width) || wrapper.getBoundingClientRect?.().width || 180);
      img.setAttribute('width', String(width));
      img.style.width = `${width}px`;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
      wrapper.replaceWith(img);
    });
    clone.querySelectorAll('.mail-resize-handle').forEach(node => node.remove());
    return clone.innerHTML;
  },

  formatEditor(editorId, command, value = null) {
    const editor = document.getElementById(editorId);
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  },

  insertEditorLink(editorId) {
    const url = prompt('Enter link URL (https://…):');
    if (url && /^https?:\/\//i.test(url.trim())) this.formatEditor(editorId, 'createLink', url.trim());
  },

  // ─── Draft ───────────────────────────────────────────────────
  saveDraft() {
    const bodyRich = document.getElementById('email-body-rich');
    const subj     = document.getElementById('email-subject');
    const cc       = document.getElementById('email-cc');
    const bcc      = document.getElementById('email-bcc');
    try {
      this.getStorage().setJSON('skylark_email_draft', {
        version: 2,
        subject: subj ? subj.value : '',
        body: bodyRich ? bodyRich.innerHTML : '',
        cc: cc ? cc.value : '',
        bcc: bcc ? bcc.value : '',
        updatedAt: Date.now()
      });
      this.draftDirty = false;
      clearTimeout(this.draftSaveTimer);
    } catch (error) {
      window.showToast?.('error', 'Draft Not Saved', 'Browser storage is full. Remove large inline media or attachments.');
    }
  },

  loadDraft() {
    if (this.draftLoaded || this.draftDirty || this.signatureDirty) return;
    try {
      let draft = this.getStorage().getJSON('skylark_email_draft', null);
      if (!draft) {
        try { draft = JSON.parse(localStorage.getItem('skylark_email_template') || 'null'); } catch (_) {}
      }
      const subj     = document.getElementById('email-subject');
      const bodyRich = document.getElementById('email-body-rich');
      const cc       = document.getElementById('email-cc');
      const bcc      = document.getElementById('email-bcc');
      if (draft) {
        if (subj && Object.prototype.hasOwnProperty.call(draft, 'subject')) subj.value = draft.subject || '';
        if (bodyRich && Object.prototype.hasOwnProperty.call(draft, 'body')) bodyRich.innerHTML = draft.body || '';
        if (cc && Object.prototype.hasOwnProperty.call(draft, 'cc')) cc.value = draft.cc || '';
        if (bcc && Object.prototype.hasOwnProperty.call(draft, 'bcc')) bcc.value = draft.bcc || '';
        if ((draft.cc || draft.bcc)) {
          const ccRow = document.getElementById('gmail-cc-row');
          const bccRow = document.getElementById('gmail-bcc-row');
          if (ccRow) ccRow.style.display = 'flex';
          if (bccRow) bccRow.style.display = 'flex';
        }
      }
      this.loadSignature(draft);
      this.removeUnsafeEditorContent(bodyRich);
      this.enhanceResizableMedia(bodyRich);
      this.draftLoaded = true;
      this.draftDirty = false;
    } catch (error) {
      console.warn('Email draft could not be restored:', error);
      this.loadSignature(null);
      this.draftLoaded = true;
    }
  },

  discardDraft() {
    if (!confirm('Reset the email composer? Unsaved changes will be lost.')) return;
    const bodyRich = document.getElementById('email-body-rich');
    const subj     = document.getElementById('email-subject');
    const cc       = document.getElementById('email-cc');
    const bcc      = document.getElementById('email-bcc');
    if (subj)     subj.value = '';
    if (bodyRich) bodyRich.innerHTML = '<p>Hi {Name},</p><p><br></p><p>We are <b>{MyCompany}</b>, providing professional Security &amp; Housekeeping staff.<br><br>We believe <b>{Company}</b> in {City} could benefit from our services.</p><p><br></p><p>Could we connect briefly to discuss your requirements?</p>';
    if (cc)       cc.value  = '';
    if (bcc)      bcc.value = '';
    this.getStorage().setJSON('skylark_email_draft', null);
    if (window.showToast) window.showToast('info', 'Draft Discarded', 'Composer has been reset.');
  },

  // ─── Gender-aware personalization ───────────────────────────
  _getHonorific(lead) {
    const g = (lead.gender || '').toLowerCase();
    if (g === 'female' || g === 'f') return 'Ms.';
    if (g === 'male'   || g === 'm') return 'Mr.';
    return '';
  },

  _personalize(template, lead) {
    const honorific   = this._getHonorific(lead);
    const contactName = lead.contactName || lead.name || '';
    const salutation  = honorific
      ? `${honorific} ${contactName}`.trim()
      : (contactName || lead.company || 'Sir/Ma\'am');

    // The SENDER's own company, taken from their profile. This keeps outbound
    // templates generic per user instead of hardcoding one agency name.
    // Note: /\{Company\}/ cannot match inside "{MyCompany}" because it requires
    // a literal "{" immediately before "Company", so the two are unambiguous.
    const myCompany = (window.UserProfileManager?.getProfile?.()?.company || '').trim();

    return template
      .replace(/\{MyCompany\}/gi,   myCompany      || 'our company')
      .replace(/\{Company\}/gi,     lead.company   || 'your facility')
      .replace(/\{City\}/gi,        lead.city       || '')
      .replace(/\{JobTitle\}/gi,    lead.jobTitle   || 'Facility Services')
      .replace(/\{Phone\}/gi,       lead.phone      || '')
      .replace(/\{Industry\}/gi,    lead.industry   || '')
      .replace(/\{Name\}/gi,        salutation)
      .replace(/\{ContactName\}/gi, contactName     || lead.company || '')
      .replace(/\{Honorific\}/gi,   honorific        || '')
      .replace(/\{Email\}/gi,       lead.email       || '');
  },

  // ─── Sent Log ────────────────────────────────────────────────
  _loadSentLog() {
    try { return this.getStorage().getJSON('skylark_email_sent_log', []) || []; }
    catch(_) { return []; }
  },

  _saveSentLog() {
    if (this.sentLog.length > 200) this.sentLog = this.sentLog.slice(0, 200);
    this.getStorage().setJSON('skylark_email_sent_log', this.sentLog);
  },

  _logEmail(entry) {
    this.sentLog.unshift(entry);
    this._saveSentLog();
    this._updateSentBadge();
  },

  _updateSentBadge() {
    const badge = document.getElementById('email-sent-badge');
    if (badge) {
      const count = this.sentLog.length;
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  },

  clearSentLog() {
    if (!confirm('Clear all sent email history?')) return;
    this.sentLog = [];
    this._saveSentLog();
    this.renderSentTab();
    if (window.showToast) window.showToast('info', 'Cleared', 'Sent email log cleared.');
  },

  // ─── Retry Failed Email ──────────────────────────────────────
  async retryEmail(idx) {
    const entry = this.sentLog[idx];
    if (!entry || entry.status === 'sent') return;

    const result = await this._sendOne({
      to:         entry.email,
      subject:    entry.subject,
      htmlBody:   entry.htmlBody || `<p>Re: ${entry.subject}</p>`,
      cc:         entry.cc  || '',
      bcc:        entry.bcc || '',
      senderName: entry.senderName || ''
    });

    this.sentLog[idx].status = result.success ? 'sent' : 'failed';
    this.sentLog[idx].error  = result.success ? null : result.error;
    this.sentLog[idx].retried = new Date().toISOString();
    this._saveSentLog();
    this.renderSentTab();

    if (window.showToast) window.showToast(
      result.success ? 'success' : 'error',
      result.success ? 'Retry Succeeded ✅' : 'Retry Failed ❌',
      result.success ? `Email to ${entry.email} sent!` : result.error
    );
  },

  renderSentTab() {
    const container = document.getElementById('email-sent-log');
    if (!container) return;

    if (this.sentLog.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:48px 20px;color:var(--do-t3,#94a3b8);">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:.35;margin-bottom:14px;"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px;">No sent emails yet</div>
          <div style="font-size:13px;">Send your first batch — emails will appear here with real delivery status.</div>
        </div>`;
      return;
    }

    const sentCount  = this.sentLog.filter(e => e.status === 'sent').length;
    const failCount  = this.sentLog.filter(e => e.status !== 'sent').length;

    container.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--do-border,rgba(255,255,255,.08));background:rgba(255,255,255,.02);display:flex;gap:20px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;color:#16a34a;">✅ ${sentCount} Sent</span>
        <span style="font-size:12px;font-weight:600;color:#dc2626;">❌ ${failCount} Failed</span>
        <span style="font-size:12px;color:var(--do-t3,#94a3b8);">Total: ${this.sentLog.length} emails</span>
      </div>
      ${this.sentLog.map((entry, i) => {
        const isSent = entry.status === 'sent';
        const statusIcon  = isSent ? '✅' : '❌';
        const statusColor = isSent ? '#16a34a' : '#dc2626';
        const time = entry.sentAt ? new Date(entry.sentAt).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '—';
        const sourceLabel = entry.source === 'smtp'
          ? ' <span style="font-size:10px;background:rgba(22,163,74,.15);color:#16a34a;padding:1px 5px;border-radius:4px;font-weight:600;">Gmail SMTP ✓</span>'
          : entry.source === 'gas-cors'
          ? ' <span style="font-size:10px;background:rgba(59,130,246,.12);color:#3b82f6;padding:1px 5px;border-radius:4px;font-weight:600;">GAS ✓</span>'
          : entry.corsBlind
          ? ' <span style="font-size:10px;opacity:.55;">unconfirmed</span>'
          : '';

        return `
          <div style="border-bottom:1px solid var(--do-border,rgba(255,255,255,.06));padding:10px 16px;display:flex;gap:10px;align-items:flex-start;transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background=''">
            <span style="font-size:18px;line-height:1.2;">${statusIcon}</span>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                <span style="font-weight:700;font-size:13px;color:var(--do-t1,#f1f5f9);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;">${entry.company || 'Lead'}</span>
                <span style="font-size:11px;color:var(--do-t3,#64748b);white-space:nowrap;">${time}</span>
              </div>
              <div style="font-size:12px;color:${statusColor};font-weight:600;margin-bottom:2px;">${isSent ? 'Delivered' + sourceLabel : '⚠ ' + (entry.error || 'Failed')}</div>
              <div style="font-size:11px;color:var(--do-t2,#94a3b8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.email || ''}</div>
              ${entry.subject ? `<div style="font-size:11px;color:var(--do-t3,#64748b);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Subject: ${entry.subject}</div>` : ''}
              ${entry.cc ? `<div style="font-size:10px;color:var(--do-t3,#64748b);margin-top:1px;">CC: ${entry.cc}</div>` : ''}
            </div>
            ${!isSent ? `<button onclick="EmailCtrl.retryEmail(${i})" style="flex-shrink:0;font-size:11px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);color:#dc2626;padding:3px 10px;border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap;" title="Retry sending">↺ Retry</button>` : ''}
          </div>`;
      }).join('')}`;
  },

  // ─── Cancel ──────────────────────────────────────────────────
  cancelAutomation() {
    this.cancelRequested = true;
    const cancelBtn = document.getElementById('email-cancel-btn');
    if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '⏹ Stopping…'; }
    if (window.showToast) window.showToast('warning', 'Cancelling…', 'Completing current email then stopping batch.');
  },

  // ─── Main Batch Sender ───────────────────────────────────────
  async startAutomation() {
    if (this.isSending) return;

    // Validate inputs
    const subject = document.getElementById('email-subject')?.value?.trim() || '';
    if (!subject) {
      if (window.showToast) window.showToast('warning', 'Subject Required', 'Please add a subject line before sending.');
      document.getElementById('email-subject')?.focus();
      return;
    }

    const audience = this.getFilteredAudience();
    if (audience.length === 0) {
      if (window.showToast) window.showToast('warning', 'No Recipients', 'No uncontacted leads with valid emails found.');
      return;
    }

    // Allow sending if either backend or webhook is configured
    // (_sendOne handles the waterfall internally)
    const webhookUrl = this._getWebhookUrl();
    // Note: backend availability is checked inside _sendOne; we only warn here
    // if BOTH backend AND webhook are missing (user has configured nothing at all)


    // ── Confirm before large batches ──
    if (audience.length > 20) {
      if (!confirm(`You are about to send ${audience.length} emails. This will use ${audience.length} of your daily Gmail quota.\n\nProceed?`)) return;
    }

    this.isSending       = true;
    this.cancelRequested = false;

    // ── Read CC / BCC (shared across all batch emails) ──
    const cc  = document.getElementById('email-cc')?.value?.trim()  || '';
    const bcc = document.getElementById('email-bcc')?.value?.trim() || '';

    // ── Get all template values. Empty signature is intentional and valid. ──
    this.flushPendingSaves();
    const subjectTemplate = subject;
    const bodyTemplate = this.getCleanEditorHtml('email-body-rich') || '<p>Hi {Name},</p>';
    const profile = window.UserProfileManager?.getProfile?.();
    const senderName = profile?.name || '';
    const replyTo = profile?.email || '';
    const sigTemplate = this.getCleanEditorHtml('email-signature-rich');

    const delayMs = parseInt(document.getElementById('email-delay-slider')?.value || '1000', 10);

    // ── UI State ──
    const progressContainer = document.getElementById('email-progress-container');
    const progressBar       = document.getElementById('email-progress-bar');
    const progressText      = document.getElementById('email-progress-text');
    const sendBtn           = document.getElementById('email-send-btn');
    const cancelBtn         = document.getElementById('email-cancel-btn');

    if (progressContainer) progressContainer.style.display = 'block';
    if (sendBtn)           { sendBtn.disabled = true; sendBtn.textContent = '⌛ Sending…'; }
    if (cancelBtn)         { cancelBtn.style.display = 'inline-flex'; cancelBtn.disabled = false; cancelBtn.textContent = '⏹ Cancel Batch'; }

    let sentCount = 0;
    let failCount = 0;
    let allLeads  = this.getStorage().getJSON('allLeads', window.allLeads || []);

    for (let i = 0; i < audience.length; i++) {
      if (this.cancelRequested) break;

      const lead              = audience[i];
      const personalizedSubj = this._personalize(subjectTemplate, lead);
      const personalizedBody = this._personalize(bodyTemplate, lead);

      const signatureBlock = sigTemplate
        ? `<div style="margin-top:24px;border-top:1px solid #e8eaed;padding-top:14px;">${sigTemplate}</div>`
        : '';
      const fullHtml = `<div style="font-family:Arial,sans-serif;color:#202124;line-height:1.65;font-size:14px;">
        ${personalizedBody}
        ${signatureBlock}
      </div>`;

      // Update progress text to show current lead
      if (progressText) progressText.textContent =
        `Sending to ${lead.company || lead.email} (${i + 1}/${audience.length})…`;

      const result = await this._sendOne({
        to:         lead.email,
        subject:    personalizedSubj,
        htmlBody:   fullHtml,
        cc,
        bcc,
        replyTo,
        senderName,
        attachments: this.attachments
      });

      // Log to sent history
      this._logEmail({
        company:    lead.company || lead.email,
        email:      lead.email,
        subject:    personalizedSubj,
        htmlBody:   result.success ? null : fullHtml, // retry payload only for failures
        cc:         cc  || null,
        bcc:        bcc || null,
        senderName,
        status:     result.success ? 'sent' : 'failed',
        error:      result.success ? null : result.error,
        corsBlind:  result.corsBlind || false,
        source:     result.source   || null,
        sentAt:     new Date().toISOString()
      });

      if (result.success) {
        sentCount++;
        // Mark lead as Contacted
        const target = allLeads.find(l =>
          l.id === lead.id || (l.company === lead.company && l.email === lead.email)
        );
        if (target) {
          target.status           = 'Contacted';
          target.emailContactedAt = new Date().toISOString();
          if (window.MemoryEngine?.updateLead) {
            try { await window.MemoryEngine.updateLead(target); } catch(_) {}
          }
        }
      } else {
        failCount++;
      }

      // Update progress bar
      const pct = Math.round(((i + 1) / audience.length) * 100);
      if (progressBar)  progressBar.style.width  = `${pct}%`;
      if (progressText) progressText.textContent = `${i + 1} / ${audience.length} — ✅ ${sentCount} Sent  ❌ ${failCount} Failed`;

      // Delay (skip on last email)
      if (i < audience.length - 1 && !this.cancelRequested) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // ── Cleanup ──
    this.getStorage().setJSON('allLeads', allLeads);
    window.allLeads = allLeads;

    this.isSending = false;
    if (sendBtn)   { sendBtn.disabled = false; sendBtn.textContent = '▶ Start Sending Emails'; }
    if (cancelBtn) { cancelBtn.style.display = 'none'; }

    this.updateAudienceStats();
    document.dispatchEvent(new CustomEvent('nexus:leadsupdated', { detail: { source: 'email-batch' } }));

    const wasCancelled = this.cancelRequested;
    this.cancelRequested = false;

    // Auto-switch to Sent tab
    setTimeout(() => this.showTab('sent'), 300);

    const toast = wasCancelled
      ? `Stopped. ${sentCount} sent, ${failCount} failed.`
      : failCount > 0
        ? `${sentCount} sent, ${failCount} failed. Check Sent tab for details.`
        : `All ${sentCount} emails sent successfully! 🎉`;

    if (window.showToast) window.showToast(
      failCount > 0 || wasCancelled ? 'warning' : 'success',
      wasCancelled ? 'Batch Cancelled' : '📬 Batch Complete',
      toast
    );
  }
};

// ── Global Bridges ──────────────────────────────────────────────────
window.EmailCtrl              = EmailCtrl;
window.loadEmailTemplate      = ()    => EmailCtrl.onShow();
window.updateEmailPreview     = ()    => EmailCtrl.updateAudienceStats();
window.toggleCcBccFields      = ()    => EmailCtrl.toggleCcBcc();
window.formatEmailText        = (cmd, value = null) => EmailCtrl.formatText(cmd, value);
window.toggleFormattingBar    = ()    => EmailCtrl.toggleFormatting();
window.handleEmailAttachments = (e)   => EmailCtrl.handleFileUpload(e);
window.startEmailAutomation   = ()    => EmailCtrl.startAutomation();
window.cancelEmailAutomation  = ()    => EmailCtrl.cancelAutomation();
window.discardEmailDraft      = ()    => EmailCtrl.discardDraft();
window.clearEmailSentLog      = ()    => EmailCtrl.clearSentLog();
window.showEmailTab           = (tab) => EmailCtrl.showTab(tab);
window.insertEmailVariable    = (tok) => EmailCtrl.insertVariable(tok);
window.pingEmailWebhook       = ()    => EmailCtrl.pingWebhook();
window.sendTestEmail          = ()    => EmailCtrl.sendTestEmail();

window.formatEmailLink = () => EmailCtrl.insertEditorLink('email-body-rich');

window.handleBodyImage = async (event) => {
  const file = event.target?.files?.[0];
  if (file) await EmailCtrl.addInlineMedia('email-body-rich', file);
  if (event.target) event.target.value = '';
};

window.handleSignatureImage = async (event) => {
  const file = event.target?.files?.[0];
  if (file) await EmailCtrl.addInlineMedia('email-signature-rich', file);
  if (event.target) event.target.value = '';
};

window.saveEmailSignatureFromPage = () => EmailCtrl.saveSignature(true);

window.saveEmailTemplate = () => {
  EmailCtrl.flushPendingSaves();
  EmailCtrl.saveDraft();
  EmailCtrl.saveSignature(false);
  window.showToast?.('success', 'Template Saved', 'Your email body and custom signature are saved.');
};

document.addEventListener('DOMContentLoaded', () => { EmailCtrl.init(); });
