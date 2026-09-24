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
        textarea.value = `Namaste {Company} Team,\n\nWe provide certified *Security Guards*, professional *Housekeeping Staff* and *Pantry Boys* for commercial facilities in {City}.\n\n📄 *Company Brochure & Catalog:* {Brochure}\n\nCan we schedule a 5-minute call?\n\nBest regards,\n${brand}`;
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

  isPaused: false,
  autoTimer: null,

  togglePause() {
    this.isPaused = !this.isPaused;
    const pauseBtn = document.getElementById('wa-pause-btn');
    if (pauseBtn) {
      pauseBtn.textContent = this.isPaused ? '▶️ Resume' : '⏸️ Pause';
    }
    if (!this.isPaused && this.isBatchRunning) {
      this.runNextStep();
    }
  },

  // ── Start WhatsApp Single-Tab Auto Batch ──
  startBatch() {
    this.refreshQueue();
    const batchLimit = parseInt(document.getElementById('wa-batch-size')?.value, 10) || 10;
    const audience = this.queue.slice(0, batchLimit);

    if (audience.length === 0) {
      if (window.showToast) window.showToast('No leads with valid phone numbers available.', 'warning');
      else alert('No valid phone numbers available.');
      return;
    }

    this.isBatchRunning = true;
    this.isPaused = false;
    this.currentIndex = 0;

    const queueUI = document.getElementById('wa-queue-ui');
    const startBtn = document.getElementById('wa-start-batch-btn');
    const pauseBtn = document.getElementById('wa-pause-btn');

    if (queueUI) queueUI.style.display = 'block';
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.textContent = '⏸️ Pause';

    this.runNextStep();
  },

  runNextStep() {
    clearTimeout(this.autoTimer);
    if (!this.isBatchRunning || this.isPaused) return;

    const batchLimit = parseInt(document.getElementById('wa-batch-size')?.value, 10) || 10;
    const totalLeads = Math.min(batchLimit, this.queue.length);

    if (this.currentIndex >= totalLeads) {
      this.stopBatch();
      if (window.showToast) window.showToast('WhatsApp anti-ban campaign completed safely!', 'success');
      return;
    }

    const lead = this.queue[this.currentIndex];
    const rawTemplate = document.getElementById('whatsapp-body')?.value || document.getElementById('whatsapp-message-text')?.value || '';
    const brochureUrl = localStorage.getItem('skylark_whatsapp_brochure_url') || '';

    // Anti-Ban Greeting Variation (Spintax Jitter to make body hash unique)
    const GREETINGS = ['Namaste', 'Hello', 'Hi', 'Good day'];
    const randomGreeting = GREETINGS[this.currentIndex % GREETINGS.length];

    let rendered = rawTemplate
      .replace(/^Namaste|^Hello|^Hi|^Good day/gi, randomGreeting)
      .replace(/\{Company\}/gi, lead.company || 'your facility')
      .replace(/\{City\}/gi, lead.city || 'your area')
      .replace(/\{JobTitle\}/gi, lead.jobTitle || 'Security & Housekeeping')
      .replace(/\{Phone\}/gi, lead.phone || '')
      .replace(/\{Brochure\}/gi, brochureUrl);

    if (brochureUrl && !rendered.includes(brochureUrl) && !rendered.toLowerCase().includes('brochure')) {
      rendered += `\n\n📄 *Company Brochure:* ${brochureUrl}`;
    }

    let phone = (lead.phone || '').replace(/[^0-9]/g, '');
    if (phone.length === 10) phone = '91' + phone;

    // Error-free tab dispatch
    try {
      // Single Recycled Window Target ('skylark_wa_automation_tab')
      // Re-uses exact same tab to prevent tab clutter & PC RAM load!
      const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(rendered)}`;
      window.open(url, 'skylark_wa_automation_tab');
    } catch (err) {
      console.warn('[WhatsApp Auto] Tab dispatch notice:', err);
    }

    // Update lead status in storage
    lead.whatsappSent = true;
    lead.status = 'Contacted';
    try {
      let allLeads = JSON.parse(localStorage.getItem('allLeads') || '[]');
      const match = allLeads.find(l => l.id === lead.id || l.phone === lead.phone);
      if (match) {
        match.whatsappSent = true;
        match.status = 'Contacted';
        localStorage.setItem('allLeads', JSON.stringify(allLeads));
      }
    } catch(e) {}

    this.currentIndex++;

    // Update Progress Bar & UI
    const statusEl = document.getElementById('wa-queue-status');
    const currentLeadEl = document.getElementById('wa-queue-current-lead');
    const progressBar = document.getElementById('wa-progress-bar');
    const timerBadge = document.getElementById('wa-queue-timer');

    const pct = Math.round((this.currentIndex / totalLeads) * 100);
    if (progressBar) progressBar.style.width = pct + '%';
    if (statusEl) statusEl.innerHTML = `<span>Sent: ${this.currentIndex} / ${totalLeads}</span>`;

    if (this.currentIndex < totalLeads) {
      const nextLead = this.queue[this.currentIndex];
      if (currentLeadEl) currentLeadEl.innerHTML = `Next: <b>${nextLead.company}</b> (${nextLead.phone} • ${nextLead.city})`;
    } else {
      if (currentLeadEl) currentLeadEl.textContent = 'All messages dispatched safely!';
    }

    if (window.LeadsCtrl) window.LeadsCtrl.init();
    if (window.DashboardCtrl) window.DashboardCtrl.init();

    // 🛡️ ANTI-BAN HUMAN JITTER & SMART REST PAUSE:
    // 1. Every 5 messages, take a 12s human rest break
    // 2. Add +1.5s to +3.5s randomized human typing delay
    const baseDelaySec = parseInt(document.getElementById('wa-delay-size')?.value, 10) || 6;
    const isRestStep = (this.currentIndex % 5 === 0 && this.currentIndex < totalLeads);
    const extraJitterSec = Math.floor(Math.random() * 3) + 1;
    let delaySec = isRestStep ? (12 + extraJitterSec) : (baseDelaySec + extraJitterSec);

    let remaining = delaySec;

    const countdown = () => {
      if (!this.isBatchRunning || this.isPaused) return;
      if (remaining <= 0) {
        this.runNextStep();
      } else {
        if (timerBadge) {
          timerBadge.textContent = isRestStep ? `🛡️ Rest ${remaining}s` : `⏱️ Next in ${remaining}s`;
        }
        if (isRestStep && currentLeadEl) {
          currentLeadEl.innerHTML = `<span style="color:#d97706; font-weight:700;">🛡️ Smart Human Rest Pause (${remaining}s) — Protecting WhatsApp Number</span>`;
        }
        remaining--;
        this.autoTimer = setTimeout(countdown, 1000);
      }
    };
    countdown();
  },

  stopBatch() {
    this.isBatchRunning = false;
    this.isPaused = false;
    clearTimeout(this.autoTimer);

    const queueUI = document.getElementById('wa-queue-ui');
    const startBtn = document.getElementById('wa-start-batch-btn');

    if (queueUI) queueUI.style.display = 'none';
    if (startBtn) startBtn.style.display = 'flex';

    this.refreshQueue();
    if (window.showToast) window.showToast('WhatsApp batch queue stopped.', 'info');
  }
};

// Global Bridges
window.WhatsAppCtrl = WhatsAppCtrl;
window.saveWhatsappTemplate = () => {
  WhatsAppCtrl.saveTemplate();
  if (window.showToast) window.showToast('WhatsApp template saved successfully!', 'success');
};
window.saveWhatsappBrochure = () => WhatsAppCtrl.saveBrochure();
window.handleWhatsappBrochureFile = (e) => {
  const file = e.target?.files?.[0];
  if (!file) return;
  const fakeUrl = URL.createObjectURL(file);
  WhatsAppCtrl.saveBrochure(fakeUrl, file.name);
};
window.openWhatsappWeb = () => window.open('https://web.whatsapp.com', '_blank');
window.startWhatsappBatch = () => WhatsAppCtrl.startBatch();
window.processWhatsappQueueNext = () => WhatsAppCtrl.processNext();
window.stopWhatsappQueue = () => WhatsAppCtrl.stopBatch();
window.updateWhatsappPreview = () => WhatsAppCtrl.updatePreview();

document.addEventListener('DOMContentLoaded', () => {
  WhatsAppCtrl.init();
});
