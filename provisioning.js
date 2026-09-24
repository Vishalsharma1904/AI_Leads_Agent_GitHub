/**
 * provisioning.js  —  DEVELOPER-ONLY customer provisioning
 *
 * THE PROBLEM THIS SOLVES
 *   Dev-mode settings live in localStorage, which is tied to one browser on one
 *   machine. It does NOT travel inside the project folder. So "type the keys in
 *   dev mode, copy the folder, share it" would arrive completely empty for the
 *   customer.
 *
 * SECURITY NOTE
 *   Customer/provider credentials must never be embedded in a downloaded
 *   frontend file. Provisioning now exposes metadata only; provider keys are
 *   configured in the authenticated backend vault.
 */
'use strict';

window.Provisioning = (function () {

  const el = (id) => document.getElementById(id);
  const val = (id) => (el(id)?.value || '').trim();
  const lines = (id) => val(id).split(/[\s,;\n]+/).map(s => s.trim()).filter(Boolean);

  /** Everything currently loaded, so the panel can show the live state. */
  function current() {
    const p = window.SKYLARK_PROVISION || {};
    return {
      client: p.client || '',
      company: p.company || '',
      licenseId: p.licenseId || '',
      issued: p.issued || '',
      expires: p.expires || '',
      apify: [], groq: [], gemini: [], openrouter: []
    };
  }

  function newLicenseId() {
    const rnd = (n) => Array.from({ length: n }, () =>
      '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 32)]).join('');
    return `${rnd(4)}-${rnd(4)}-${rnd(4)}`;
  }

  /** Builds metadata only. It intentionally contains no provider credentials. */
  function buildFile(data) {
    return JSON.stringify({
      client: data.client || '', company: data.company || '',
      licenseId: data.licenseId, issued: data.issued,
      expires: data.expires || '', lockCompany: !!data.lockCompany,
      note: 'Configure provider credentials in the authenticated backend vault.'
    }, null, 2);
  }

  function collect() {
    return {
      client: val('prov-client'),
      company: val('prov-company'),
      licenseId: val('prov-license') || newLicenseId(),
      issued: new Date().toISOString().slice(0, 10),
      expires: val('prov-expires'),
      lockCompany: !!el('prov-lock')?.checked,
      apify: [], groq: [], gemini: [], openrouter: []
    };
  }

  function preview() {
    const out = el('prov-preview');
    if (out) out.value = 'Provider keys are backend-only. Use the authenticated server provisioning flow.';
  }

  function download() {
    window.showToast?.('warning', 'Backend provisioning required', 'Provider credentials cannot be downloaded into a frontend file.');
  }

  async function copyToClipboard() {
    window.showToast?.('warning', 'Backend provisioning required', 'Provider credentials cannot be copied from the frontend.');
  }

  /** Loads whatever this copy is currently provisioned with. */
  function load() {
    const c = current();
    const set = (id, v) => { if (el(id)) el(id).value = v; };
    set('prov-client', c.client);
    set('prov-company', c.company);
    set('prov-license', c.licenseId || newLicenseId());
    set('prov-expires', c.expires);
    set('prov-apify', c.apify.join('\n'));
    set('prov-groq', c.groq.join('\n'));
    set('prov-gemini', c.gemini.join('\n'));
    set('prov-openrouter', c.openrouter.join('\n'));
    if (el('prov-lock')) el('prov-lock').checked = !!(window.SKYLARK_PROVISION || {}).lockCompany;
    const badge = el('prov-current');
    if (badge) {
      badge.textContent = c.company
        ? `This copy is licensed to ${c.company}${c.licenseId ? ' · ' + c.licenseId : ''}`
        : 'This is your development master — safe to generate customer copies from.';
    }
    preview();
    syncReady();
    renderRoster();
  }

  /* ═══════════════════════════════════════════════════════════════
     THE SIMPLE PATH
     The full form is still there under "Advanced", but the everyday job
     is two fields and one button. Everything else is derived.
     ═══════════════════════════════════════════════════════════════ */

  const ROSTER_KEY = 'skylark_customer_roster_v1';

  function roster() {
    try { return JSON.parse(localStorage.getItem(ROSTER_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function remember(data) {
    const list = roster().filter(r => r.licenseId !== data.licenseId);
    list.unshift({
      company: data.company,
      client: data.client,
      licenseId: data.licenseId,
      issued: data.issued,
      expires: data.expires || '',
      keys: data.apify.length
    });
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(list.slice(0, 40))); } catch (_) {}
  }

  function renderRoster() {
    const box = el('prov-roster');
    if (!box) return;
    const list = roster();
    if (!list.length) {
      box.innerHTML = '<div class="prov-roster-empty">No customer copies created yet.</div>';
      return;
    }
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = list.map(r => `
      <div class="prov-roster-row">
        <span class="prov-roster-co">${esc(r.company)}</span>
        <span class="prov-roster-lic">${esc(r.licenseId)}</span>
        <span class="prov-roster-date">${esc(r.issued)}${r.expires ? ' → ' + esc(r.expires) : ''}</span>
      </div>`).join('');
  }

  /** Pull the keys this master copy is already running on. One click. */
  function useMyKeys() {
    window.showToast?.('warning', 'Backend provisioning required', 'Provider credentials are never copied into this browser panel.');
  }

  /** Enables/disables the one big button and mirrors the quick fields. */
  function syncReady() {
    const company = val('prov-company');
    const keys = lines('prov-apify').length;
    const btn = el('prov-create');
    if (btn) btn.disabled = !(company && keys);
    const hint = el('prov-ready-hint');
    if (hint) {
      hint.textContent = !company ? 'Enter the customer’s company name'
        : !keys ? 'Paste at least one lead-engine key'
        : `Ready — will issue a licence to ${company}`;
      hint.dataset.ok = (company && keys) ? '1' : '0';
    }
  }

  /**
   * One action instead of five: mint the licence, hand over the file, log the
   * customer and show a short, checkable list of what to do with the download.
   */
  function quickCreate() {
    window.showToast?.('warning', 'Backend provisioning required', 'Create customer access from the authenticated backend/admin flow.');
  }

  function showDone(data) {
    const box = el('prov-done');
    if (!box) return;
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.hidden = false;
    box.innerHTML = `
      <div class="prov-done-head">Licence <b>${esc(data.licenseId)}</b> issued to <b>${esc(data.company)}</b></div>
      <ol class="prov-done-list">
        <li>Customer metadata is ready for the authenticated backend provisioning workflow.</li>
        <li>Keep provider credentials on the server; never copy them into an app folder.</li>
        <li>Create a separate least-privilege backend account for <code>${esc(data.company)}</code>.</li>
        <li>Verify the customer can sign in and that their requests use only their own server-side data.</li>
      </ol>
      <div class="prov-done-actions">
        <button type="button" class="smodal-btn-secondary" onclick="Provisioning.lockDevNow()">Lock developer mode now</button>
        <button type="button" class="smodal-btn-secondary" onclick="Provisioning.startAnother()">Create another customer</button>
      </div>`;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function lockDevNow() {
    window.DevMode?.set?.(false);
    window.showToast?.('success', 'Developer mode locked', 'Credential sections are hidden again.');
  }

  /** Clears the customer-specific fields but keeps the keys you just pasted. */
  function startAnother() {
    ['prov-company', 'prov-client', 'prov-expires'].forEach(id => { if (el(id)) el(id).value = ''; });
    if (el('prov-license')) el('prov-license').value = newLicenseId();
    if (el('prov-lock')) el('prov-lock').checked = false;
    if (el('prov-done')) { el('prov-done').hidden = true; el('prov-done').innerHTML = ''; }
    preview();
    syncReady();
    el('prov-company')?.focus();
  }

  return {
    load, preview, download, copyToClipboard, newLicenseId, buildFile, current,
    quickCreate, useMyKeys, syncReady, lockDevNow, startAnother, showDone, renderRoster, roster
  };
})();


/**
 * Customer-side behaviour: if this copy was provisioned, adopt the branding
 * automatically and never mention the upstream vendors to the end user.
 */
(function ApplyProvisioning() {
  'use strict';

  function apply() {
    const p = window.SKYLARK_PROVISION;
    if (!p || !p.company) return;

    // Pre-fill signup so the customer never types their own company wrong
    const company = document.getElementById('ag-input-company');
    if (company && !company.value) {
      company.value = p.company;
      if (p.lockCompany) { company.readOnly = true; company.title = 'Set by your licence'; }
    }
    const name = document.getElementById('ag-input-name');
    if (name && !name.value && p.client) name.value = p.client;

    // Adopt branding immediately, even before signup completes
    const brand = document.getElementById('logo-brand-text');
    if (brand && (!brand.textContent || /Your Workspace/i.test(brand.textContent))) brand.textContent = p.company;

    // If a profile already exists but has no company, inherit the licensed one
    try {
      const upm = window.UserProfileManager;
      if (upm) {
        const cur = upm.getProfile();
        if (!cur.company) upm.saveProfile({ company: p.company });
      }
    } catch (_) {}

    // Soft licence expiry notice — informative, never a crash or a lockout
    if (p.expires) {
      const end = new Date(p.expires + 'T23:59:59');
      if (!isNaN(end)) {
        const days = Math.ceil((end - Date.now()) / 86400000);
        if (days < 0) {
          window.showToast?.('warning', 'Licence expired',
            'Please contact your provider to renew this deployment.');
        } else if (days <= 14) {
          window.showToast?.('info', 'Licence renewal',
            `Your licence expires in ${days} day${days === 1 ? '' : 's'}.`);
        }
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(apply, 120));
  else setTimeout(apply, 120);
})();
