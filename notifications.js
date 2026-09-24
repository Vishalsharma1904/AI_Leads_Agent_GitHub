/**
 * DesktopNotificationSystem
 * 
 * Enterprise-grade desktop notification engine inspired by macOS, Linear, and Raycast.
 * Replaces basic toasts with structured, tactile notification cards supporting:
 * - Semantic types: info, success, warning, error, task
 * - Actionable buttons: Undo, Mark as Done, Snooze, Remind Me Later, Custom callbacks
 * - Stacking with physical depth & tactile expand on hover
 * - Safe top-right positioning (never obstructs composer, navigation, or primary tools)
 * - Notification history persistence
 * - 100% backward-compatible drop-in replacement for showToast()
 */
'use strict';

(() => {
  class DesktopNotificationManager {
    constructor() {
      this.container = null;
      this.activeNotifications = [];
      this.history = [];
      this.maxVisible = 4;
      this.historyLimit = 40;
      this.recent = new Map();
      this.dedupeWindowMs = 5000;
      this.loadHistory();
      this.initDOM();
    }

    initDOM() {
      if (typeof document === 'undefined') return;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.ensureContainer());
      } else {
        this.ensureContainer();
      }
    }

    ensureContainer() {
      let el = document.getElementById('desktop-notification-container');
      if (!el) {
        el = document.createElement('div');
        el.id = 'desktop-notification-container';
        el.className = 'desktop-notification-container';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(el);
      }
      this.container = el;

      // Keep legacy #toast-container as hidden or alias so old code doesn't fail
      const legacy = document.getElementById('toast-container');
      if (legacy && legacy !== el) {
        legacy.style.display = 'none';
        legacy.setAttribute('aria-hidden', 'true');
      }
    }

    loadHistory() {
      try {
        const raw = localStorage.getItem('clavis_notification_history');
        if (raw) this.history = JSON.parse(raw);
      } catch (_) {
        this.history = [];
      }
    }

    saveHistory() {
      try {
        localStorage.setItem('clavis_notification_history', JSON.stringify(this.history.slice(0, this.historyLimit)));
      } catch (_) {}
    }

    getSemanticIcon(type) {
      switch (type) {
        case 'success':
          return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
        case 'error':
          return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
        case 'warning':
          return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        case 'task':
          return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`;
        default:
          return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      }
    }

    normalizeArgs(a, b, c) {
      const validTypes = ['info', 'success', 'warning', 'error', 'task'];
      let opts = {};

      if (a && typeof a === 'object') {
        opts = { ...a };
        opts.type = validTypes.includes(String(opts.type || '').toLowerCase()) ? String(opts.type).toLowerCase() : 'info';
        opts.title = opts.title || (opts.type === 'task' ? 'Task' : opts.type.charAt(0).toUpperCase() + opts.type.slice(1));
        opts.message = opts.message || '';
      } else if (c !== undefined) {
        // (type, title, message)
        const rawType = String(a || '').toLowerCase();
        opts.type = validTypes.includes(rawType) ? rawType : 'info';
        opts.title = String(b || '');
        opts.message = String(c || '');
      } else if (b !== undefined) {
        // (type, message) or (message, type) or (title, message)
        const bLower = String(b).toLowerCase();
        const aLower = String(a).toLowerCase();
        if (validTypes.includes(bLower)) {
          opts.type = bLower;
          opts.title = opts.type.charAt(0).toUpperCase() + opts.type.slice(1);
          opts.message = String(a || '');
        } else if (validTypes.includes(aLower)) {
          opts.type = aLower;
          opts.title = opts.type.charAt(0).toUpperCase() + opts.type.slice(1);
          opts.message = String(b || '');
        } else {
          opts.type = 'info';
          opts.title = String(a || 'Notification');
          opts.message = String(b || '');
        }
      } else if (a !== undefined) {
        opts.type = 'info';
        opts.title = 'Notification';
        opts.message = String(a || '');
      }

      opts.id = opts.id || 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      opts.timestamp = opts.timestamp || new Date();
      opts.actions = Array.isArray(opts.actions) ? opts.actions.filter(Boolean) : [];

      if (!Number.isFinite(opts.timeoutMs)) {
        if (opts.type === 'error' || opts.actions.length > 0 || opts.persistent) {
          opts.timeoutMs = 0; // manual dismiss or actionable
        } else {
          opts.timeoutMs = 4500;
        }
      }

      return opts;
    }

    notify(a, b, c) {
      this.ensureContainer();
      if (!this.container) return null;

      const opts = this.normalizeArgs(a, b, c);

      // A reconnecting mic/provider can report the same condition several
      // times in one second. Reusing the existing card prevents notification
      // churn, repeated sound effects, and needless DOM/layout work.
      const fingerprint = `${opts.type}|${opts.title}|${opts.message}|${opts.detail || ''}`;
      const now = Date.now();
      const previous = this.recent.get(fingerprint);
      if (previous && now - previous.at < this.dedupeWindowMs) return previous.id;
      this.recent.set(fingerprint, { at: now, id: opts.id });
      if (this.recent.size > 80) {
        for (const [key, item] of this.recent) {
          if (now - item.at >= this.dedupeWindowMs) this.recent.delete(key);
        }
      }

      // One failure = one card. Identical cards within 12 s are dropped, and
      // error cards are capped at one per 12 s (a failing call can fire three
      // listeners at once — that was the stack of red cards).
      const sig = [opts.type, opts.title, String(opts.message || '').replace(/[\d.]+/g, '#')].join('|');
      this._recent = (this._recent || []).filter((r) => now - r.t < 12000);
      if (this._recent.some((r) => r.sig === sig)) return null;
      if (opts.type === 'error' && this._recent.some((r) => r.type === 'error')) return null;
      this._recent.push({ sig, t: now, type: opts.type });

      // Play audio feedback if sound engine available
      try {
        if (window.SoundFX) {
          if (opts.type === 'success' && typeof window.SoundFX.playSuccess === 'function') window.SoundFX.playSuccess();
          else if (opts.type === 'error' && typeof window.SoundFX.playError === 'function') window.SoundFX.playError();
        }
      } catch (_) {}

      // Save to notification history
      this.history.unshift({
        id: opts.id,
        type: opts.type,
        title: opts.title,
        message: opts.message,
        detail: opts.detail || '',
        timestamp: Date.now()
      });
      this.saveHistory();

      // Create card element
      const card = document.createElement('div');
      card.className = `desktop-notification-card notif-${opts.type}`;
      card.id = opts.id;
      card.setAttribute('role', opts.type === 'error' || opts.type === 'warning' ? 'alert' : 'status');

      const timeFormatted = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).format(opts.timestamp);

      let actionsHtml = '';
      if (opts.actions.length > 0) {
        actionsHtml = `<div class="desktop-notif-actions">` + opts.actions.map((act, idx) => {
          const isPrimary = act.primary || idx === 0;
          const btnClass = isPrimary ? 'desktop-notif-btn desktop-notif-btn--primary' : 'desktop-notif-btn desktop-notif-btn--secondary';
          return `<button type="button" class="${btnClass}" data-action-idx="${idx}">${this.escapeHtml(act.label || 'Action')}</button>`;
        }).join('') + `</div>`;
      }

      let progressHtml = '';
      if (Number.isFinite(opts.progress)) {
        progressHtml = `<div class="desktop-notif-progress"><div class="desktop-notif-progress-bar" style="width:${Math.max(0, Math.min(100, opts.progress))}%"></div></div>`;
      }

      card.innerHTML = `
        <div class="desktop-notif-main">
          <div class="desktop-notif-icon-col">${this.getSemanticIcon(opts.type)}</div>
          <div class="desktop-notif-content-col">
            <div class="desktop-notif-header-row">
              <span class="desktop-notif-title">${this.escapeHtml(opts.title)}</span>
              <span class="desktop-notif-time">${timeFormatted}</span>
              <button type="button" class="desktop-notif-close-btn" aria-label="Dismiss">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            ${opts.message ? `<div class="desktop-notif-body">${this.escapeHtml(opts.message)}</div>` : ''}
            ${opts.detail ? `<div class="desktop-notif-detail">${this.escapeHtml(opts.detail)}</div>` : ''}
            ${progressHtml}
            ${actionsHtml}
          </div>
        </div>
      `;

      // Wire close button
      const closeBtn = card.querySelector('.desktop-notif-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismiss(opts.id);
        });
      }

      // Wire action buttons
      const actionBtns = card.querySelectorAll('.desktop-notif-btn');
      actionBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-action-idx'), 10);
          const action = opts.actions[idx];
          if (action && typeof action.run === 'function') {
            try { action.run(); } catch (err) { console.error(err); }
          }
          if (action?.dismiss !== false) {
            this.dismiss(opts.id);
          }
        });
      });

      // Auto dismiss timer
      let timer = null;
      if (opts.timeoutMs > 0) {
        timer = setTimeout(() => this.dismiss(opts.id), opts.timeoutMs);
        // Pause timer on hover
        card.addEventListener('mouseenter', () => {
          if (timer) clearTimeout(timer);
        });
        card.addEventListener('mouseleave', () => {
          timer = setTimeout(() => this.dismiss(opts.id), 2500);
        });
      }

      // Keep the live stack bounded even when different errors arrive in a
      // burst. History remains available, but the viewport never accumulates
      // an unbounded set of animated cards.
      while (this.activeNotifications.length >= this.maxVisible) {
        const oldest = this.activeNotifications[this.activeNotifications.length - 1];
        if (!oldest) break;
        this.dismiss(oldest.id);
        break;
      }

      // Register active
      this.activeNotifications.unshift({ id: opts.id, card, timer });

      // Append to container
      this.container.prepend(card);

      // Apply stacked depth styling
      this.updateStackPositions();

      return opts.id;
    }

    dismiss(id) {
      const idx = this.activeNotifications.findIndex(n => n.id === id);
      if (idx === -1) return;

      const item = this.activeNotifications[idx];
      if (item.timer) clearTimeout(item.timer);

      item.card.classList.add('desktop-notif-exit');
      setTimeout(() => {
        if (item.card.parentNode) item.card.parentNode.removeChild(item.card);
        this.activeNotifications = this.activeNotifications.filter(n => n.id !== id);
        this.updateStackPositions();
      }, 190);   // macOS: matches 180ms CSS exit animation
    }

    dismissAll() {
      const copy = [...this.activeNotifications];
      copy.forEach(n => this.dismiss(n.id));
    }

    updateStackPositions() {
      // Linear / macOS physical depth stacking using CSS custom properties
      this.activeNotifications.forEach((item, i) => {
        if (!item.card) return;
        if (item.card.classList.contains('desktop-notif-exit')) return;
        item.card.style.zIndex = `${1000 - i}`;
        if (i === 0) {
          item.card.style.setProperty('--stack-y', '0px');
          item.card.style.setProperty('--stack-scale', '1');
          item.card.style.opacity = '1';
        } else if (i < this.maxVisible) {
          const yOffset = i * 4;
          const scale = 1 - (i * 0.03);
          item.card.style.setProperty('--stack-y', `-${yOffset}px`);
          item.card.style.setProperty('--stack-scale', `${scale}`);
          item.card.style.opacity = `${1 - (i * 0.12)}`;
        } else {
          item.card.style.display = 'none';
        }
      });
    }

    escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    getHistory() {
      return [...this.history];
    }

    clearHistory() {
      this.history = [];
      this.saveHistory();
    }
  }

  const manager = new DesktopNotificationManager();
  window.DesktopNotifications = manager;

  // Seamless backwards-compatible alias for showToast
  window.showToast = function(a, b, c) {
    return manager.notify(a, b, c);
  };
})();
