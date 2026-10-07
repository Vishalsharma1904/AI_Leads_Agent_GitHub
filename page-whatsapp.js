/**
 * page-whatsapp.js
 * WhatsApp Automation & Direct Reachout Controller (macOS / Anthropic UX)
 * Manages message composition, click-to-chat queue, variable insertion, batch processing, and status sync.
 */
'use strict';

const WhatsAppCtrl = {
  queue: [],
  currentIndex: 0,
  isBatchRunning: false,

  init() {
    this.refreshQueue();
    this.bindEvents();
    this.loadTemplate();
  },

  bindEvents() {
    const msgInputs = [
      document.getElementById('whatsapp-body'),
      document.getElementById('whatsapp-message-text')
    ].filter(Boolean);

    msgInputs.forEach(inp => {
      inp.addEventListener('input', () => {
        this.updatePreview();
        this.saveTemplate();
      });
    });

    const batchRange = document.getElementById('wa-batch-size');
    const batchVal = document.getElementById('wa-batch-val');
    if (batchRange && batchVal) {
      batchRange.addEventListener('input', (e) => {
        batchVal.textContent = e.target.value;
      });
    }
  },

  // ── Variable Injection ──
  insertVariable(token) {
    const textarea = document.getElementById('whatsapp-body') || document.getElementById('whatsapp-message-text');
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const val = textarea.value;

    textarea.value = val.substring(0, start) + token + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + token.length;
    textarea.focus();

    this.updatePreview();
    this.saveTemplate();
  },

  // ── Queue Management ──
  refreshQueue() {
    let leads = [];
    try {
      leads = JSON.parse(localStorage.getItem('allLeads') || '[]');
    } catch(e) {}

    // Filter leads with valid phone number
    let validLeads = leads.filter(l => {
      if (!l.phone) return false;
      const clean = l.phone.replace(/[^0-9]/g, '');
      return clean.length >= 10;
    });

    // Uncontacted first
    validLeads.sort((a, b) => {
      const aNew = (!a.status || a.status.toLowerCase() === 'new') ? 1 : 0;
      const bNew = (!b.status || b.status.toLowerCase() === 'new') ? 1 : 0;
      return bNew - aNew;
    });

    this.queue = validLeads;
    this.currentIndex = 0;

    const eligibleEl = document.getElementById('wa-eligible-count');
    const totalEl = document.getElementById('wa-total-count');

    if (eligibleEl) eligibleEl.textContent = validLeads.filter(l => !l.whatsappSent && (!l.status || l.status.toLowerCase() === 'new')).length;
    if (totalEl) totalEl.textContent = `${this.queue.length} Leads in Queue`;

    this.updatePreview();
  },

  // ── Real-Time Preview ──
  updatePreview() {
    const rawTemplate = document.getElementById('whatsapp-body')?.value || document.getElementById('whatsapp-message-text')?.value || '';
    const previewBox = document.getElementById('whatsapp-preview-box');
    const brochureUrl = localStorage.getItem('skylark_whatsapp_brochure_url') || '';

    if (previewBox) {
      if (this.queue.length === 0) {
        previewBox.innerHTML = '<span style="color:var(--do-t3); font-style:italic;">No valid leads found in queue.</span>';
        return;
      }
      const lead = this.queue[this.currentIndex] || this.queue[0];
      const rendered = rawTemplate
        .replace(/\{Company\}/gi, `*${lead.company || 'your facility'}*`)
        .replace(/\{City\}/gi, lead.city || 'your area')
        .replace(/\{JobTitle\}/gi, lead.jobTitle || 'Security & Housekeeping Staff')
        .replace(/\{Phone\}/gi, lead.phone || '')
        .replace(/\{Brochure\}/gi, brochureUrl);

      const formattedHtml = rendered
        .replace(/\*(.*?)\*/g, '<b>$1</b>')
        .replace(/_(.*?)_/g, '<i>$1</i>')
        .replace(/~(.*?)~/g, '<strike>$1</strike>')
        .replace(/\n/g, '<br>');

      previewBox.innerHTML = formattedHtml;
    }
  },

  // ── Template & Brochure Persistence ──
  saveTemplate() {
    const textarea = document.getElementById('whatsapp-body') || document.getElementById('whatsapp-message-text');
    if (textarea) {
      localStorage.setItem('skylark_whatsapp_template', textarea.value);
    }
  },

  loadTemplate() {
    const saved = localStorage.getItem('skylark_whatsapp_template');
    const textarea = document.getElementById('whatsapp-body') || document.getElementById('whatsapp-message-text');
    if (textarea) {
      if (saved) {
        textarea.value = saved;
      } else if (!textarea.value.trim()) {
        const me = window.UserProfileManager?.getProfile?.() || {};
        const brand = me.company || me.name || 'our team';
        textarea.value = `Namaste {Company} Team,\n\nI'm reaching out from ${brand}. We help teams in {City} with {JobTitle}.\n\nWould a short call about your current needs be useful?\n\nBest regards,\n${brand}`;
      }
    }
    this.loadBrochure();
  },

  loadBrochure() {
    const brochureInput = document.getElementById('whatsapp-brochure-url');
    const brochureStatus = document.getElementById('whatsapp-brochure-status');
    const savedUrl = localStorage.getItem('skylark_whatsapp_brochure_url');
    const savedName = localStorage.getItem('skylark_whatsapp_brochure_name');

    if (brochureInput && savedUrl) brochureInput.value = savedUrl;
    if (brochureStatus) {
      if (savedUrl) {
        brochureStatus.innerHTML = `✓ Active Brochure: <a href="${savedUrl}" target="_blank" style="color:#128c7e; font-weight:600; text-decoration:underline;">${savedName || savedUrl}</a>`;
      } else {
        brochureStatus.textContent = 'Ready: No brochure link specified yet.';
      }
    }
  },

  saveBrochure(url, name) {
    const brochureInput = document.getElementById('whatsapp-brochure-url');
    const targetUrl = url || brochureInput?.value?.trim();
    if (!targetUrl) {
      if (window.showToast) window.showToast('Please enter or upload a brochure link.', 'warning');
      return;
    }
    localStorage.setItem('skylark_whatsapp_brochure_url', targetUrl);
    if (name) localStorage.setItem('skylark_whatsapp_brochure_name', name);

    this.loadBrochure();
    this.updatePreview();
    if (window.showToast) window.showToast('Company Brochure attached to WhatsApp campaigns!', 'success');
  },

};

// Global Bridges
window.WhatsAppCtrl = WhatsAppCtrl;
window.saveWhatsappTemplate = () => {
  WhatsAppCtrl.saveTemplate();
  window.showToast?.('success', 'Template saved', 'Your WhatsApp message is saved on this device.');
};
window.saveWhatsappBrochure = () => WhatsAppCtrl.saveBrochure();
window.openWhatsappWeb = () => window.open('https://web.whatsapp.com', '_blank');
window.startWhatsappBatch = () => WhatsAppCtrl.startBatch();
window.processWhatsappQueueNext = () => WhatsAppCtrl.openCurrent();
window.stopWhatsappQueue = () => WhatsAppCtrl.stopBatch();
window.updateWhatsappPreview = () => WhatsAppCtrl.updatePreview();

document.addEventListener('DOMContentLoaded', () => {
  WhatsAppCtrl.init();
});

// The browser cannot tell whether a message was sent in WhatsApp Web. Keep
// this as a deliberate review queue and record a send only after confirmation.
Object.assign(WhatsAppCtrl, {
  initialized: false,
  reviewed: [],
  getStorage() {
    return window.UserStorage || {
      getJSON: (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; } },
      setJSON: (key, value) => localStorage.setItem(key, JSON.stringify(value))
    };
  },
  init() {
    if (!this.initialized) {
      this.initialized = true;
      document.getElementById('whatsapp-body')?.addEventListener('input', () => { this.saveTemplate(); this.updatePreview(); });
      document.getElementById('wa-batch-size')?.addEventListener('input', event => {
        document.getElementById('wa-batch-val').textContent = event.target.value;
      });
      document.getElementById('wa-consent-confirm')?.addEventListener('change', event => {
        const open = document.getElementById('wa-open-btn');
        if (open) open.disabled = !event.target.checked;
      });
      document.addEventListener('nexus:leadsupdated', () => this.refreshQueue());
      this.loadTemplate();
    }
    this.refreshQueue();
  },
  refreshQueue() {
    const selected = window.crmSelectedLead;
    const audience = window.crmAudience;
    const leads = selected ? [selected] : Array.isArray(audience) && audience.length ? audience :
      this.getStorage().getJSON('allLeads', window.allLeads || []);
    const seen = new Set();
    const eligible = (Array.isArray(leads) ? leads : []).filter(lead => {
      const phone = String(lead?.phone || '').replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 15 || seen.has(phone) || lead.phoneOptOut || (!selected && lead.whatsappSent)) return false;
      seen.add(phone);
      return true;
    });
    if (!this.isBatchRunning) this.queue = eligible;
    const count = document.getElementById('wa-eligible-count');
    if (count) count.textContent = String(eligible.length);
    this.updatePreview();
  },
  renderMessage(lead) {
    const brochure = localStorage.getItem('skylark_whatsapp_brochure_url') || '';
    return String(document.getElementById('whatsapp-body')?.value || '')
      .replace(/\{Company\}/gi, lead.company || 'your team')
      .replace(/\{City\}/gi, lead.city || '')
      .replace(/\{JobTitle\}/gi, lead.jobTitle || 'services')
      .replace(/\{Phone\}/gi, lead.phone || '')
      .replace(/\{Brochure\}/gi, brochure);
  },
  updatePreview() {
    const box = document.getElementById('whatsapp-preview-box');
    if (!box) return;
    const lead = this.queue[this.currentIndex] || this.queue[0];
    box.textContent = lead ? this.renderMessage(lead) : 'Leads with valid phone numbers will appear here.';
    box.style.whiteSpace = 'pre-wrap';
  },
  saveBrochure(url, name) {
    const target = String(url || document.getElementById('whatsapp-brochure-url')?.value || '').trim();
    if (target && !/^https:\/\/[^\s]+$/i.test(target)) {
      window.showToast?.('warning', 'Public link needed', 'Paste an HTTPS brochure link that recipients can open.');
      return;
    }
    localStorage.setItem('skylark_whatsapp_brochure_url', target);
    localStorage.setItem('skylark_whatsapp_brochure_name', name || 'Brochure link');
    this.loadBrochure();
    this.updatePreview();
  },
  loadBrochure() {
    const url = localStorage.getItem('skylark_whatsapp_brochure_url') || '';
    const input = document.getElementById('whatsapp-brochure-url');
    const status = document.getElementById('whatsapp-brochure-status');
    if (input) input.value = url;
    if (status) status.textContent = url ? `Brochure link ready: ${url}` : 'Optional: paste a public HTTPS brochure link.';
  },
  startBatch() {
    this.refreshQueue();
    const size = Math.max(1, Math.min(50, Number(document.getElementById('wa-batch-size')?.value) || 10));
    this.queue = this.queue.slice(0, size);
    if (!this.queue.length) return window.showToast?.('warning', 'No eligible leads', 'Add leads with phone numbers first.');
    if (!document.getElementById('whatsapp-body')?.value.trim()) return window.showToast?.('warning', 'Message required', 'Write a message before reviewing the batch.');
    this.currentIndex = 0;
    this.reviewed = [];
    this.isBatchRunning = true;
    document.getElementById('wa-queue-ui').style.display = 'block';
    document.getElementById('wa-start-batch-btn').style.display = 'none';
    this.renderCurrent();
  },
  renderCurrent() {
    const lead = this.queue[this.currentIndex];
    if (!lead) return this.finishBatch();
    const status = document.getElementById('wa-queue-status');
    const current = document.getElementById('wa-queue-current-lead');
    if (status) status.textContent = `Review ${this.currentIndex + 1} of ${this.queue.length} · ${this.reviewed.filter(x => x === 'confirmed').length} confirmed`;
    if (current) current.textContent = `${lead.company || 'Lead'} · ${lead.phone || ''} · ${lead.city || ''}`;
    document.getElementById('wa-progress-bar').style.width = `${Math.round(this.currentIndex / this.queue.length * 100)}%`;
    const consent = document.getElementById('wa-consent-confirm');
    if (consent) consent.checked = Boolean(lead.whatsappOptIn);
    const open = document.getElementById('wa-open-btn');
    if (open) open.disabled = !consent?.checked;
    const confirm = document.getElementById('wa-confirm-btn');
    if (confirm) confirm.disabled = !this.chatOpened;
    this.updatePreview();
  },
  openCurrent() {
    if (!this.isBatchRunning) return;
    if (!document.getElementById('wa-consent-confirm')?.checked) {
      return window.showToast?.('warning', 'Consent needed', 'Only open chats for leads who opted in to WhatsApp messages.');
    }
    const lead = this.queue[this.currentIndex];
    if (lead.phoneOptOut) return window.showToast?.('warning', 'Phone opt-out', 'This lead opted out of phone outreach.');
    const digits = String(lead.phone || '').replace(/\D/g, '');
    const phone = digits.length === 10 ? `91${digits}` : digits;
    const tab = window.open(`https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(this.renderMessage(lead))}`, '_blank');
    if (!tab) return window.showToast?.('warning', 'Popup blocked', 'Allow popups, then open this chat again.');
    try { tab.opener = null; } catch (_) {}
    this.chatOpened = true;
    document.getElementById('wa-confirm-btn').disabled = false;
  },
  async confirmCurrent() {
    if (!this.isBatchRunning || !this.chatOpened || this.confirming) return;
    const lead = this.queue[this.currentIndex];
    if (lead.phoneOptOut) return window.showToast?.('warning', 'Phone opt-out', 'This lead opted out of phone outreach.');
    this.confirming = true;
    document.getElementById('wa-confirm-btn').disabled = true;
    try {
      await window.CRMBridge?.logWhatsApp?.(lead);
    } catch (error) {
      window.showToast?.('warning', 'CRM not updated', `${error.message || 'Could not save this confirmation.'} The message was confirmed by you; do not resend.`);
    }
    const storage = this.getStorage();
    const leads = storage.getJSON('allLeads', window.allLeads || []);
    const phone = String(lead.phone || '').replace(/\D/g, '');
    const matches = leads.filter(item => lead.id ? item.id === lead.id : String(item.phone || '').replace(/\D/g, '') === phone);
    if (matches.length) {
      for (const match of matches) {
        match.whatsappOptIn = true;
        match.whatsappSent = true;
        match.whatsappContactedAt = new Date().toISOString();
        const stage = window.CRMBridge?.getStage?.(match.id);
        if (stage) match.status = window.CRMBridge.stageLabel(stage);
        else if (!match.status || /^(new|contacted|attempted)$/i.test(match.status)) match.status = 'Attempted';
        try { await window.MemoryEngine?.updateLead?.(match.id, {
          whatsappOptIn: true, whatsappSent: true, whatsappContactedAt: match.whatsappContactedAt, status: match.status
        }); } catch (_) {}
      }
      storage.setJSON('allLeads', leads);
      window.allLeads = leads;
      document.dispatchEvent(new CustomEvent('nexus:leadsupdated', { detail: { source: 'whatsapp-confirmed' } }));
    }
    this.reviewed.push('confirmed');
    this.confirming = false;
    window.CRMBridge?.notifyLeads?.();
    this.advance();
  },
  skipCurrent() {
    if (!this.isBatchRunning) return;
    this.reviewed.push('skipped');
    this.advance();
  },
  advance() {
    this.currentIndex++;
    this.chatOpened = false;
    this.renderCurrent();
  },
  finishBatch() {
    const count = this.reviewed.filter(x => x === 'confirmed').length;
    this.stopBatch();
    window.showToast?.('success', 'Review complete', `${count} sends confirmed by you; ${this.reviewed.length - count} skipped.`);
  },
  stopBatch() {
    this.isBatchRunning = false;
    this.chatOpened = false;
    document.getElementById('wa-queue-ui').style.display = 'none';
    document.getElementById('wa-start-batch-btn').style.display = 'flex';
    this.refreshQueue();
  }
});
window.handleWhatsappBrochureFile = () => window.showToast?.('info', 'Use a public link', 'Upload your brochure to a shareable HTTPS location, then paste its link.');
