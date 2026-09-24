/* ============================================================
 * clavis-business.js · who the owner SELLS to
 * ------------------------------------------------------------
 * Clavis was written for one seller: a security & housekeeping
 * agency. Whoever gets this app may sell something else — IT
 * services, marketing, catering, solar, HVAC… — so the three things
 * that assumed "security" now ask this module instead:
 *
 *   1. which businesses to search when he says "leads do" with no
 *      industry (real-scraper.js: "ALL")
 *   2. which businesses are COMPETITORS and must never be a lead
 *   3. how the AI describes his business in its prompts
 *
 * Plus a fit score on every lead for non-security profiles, and a
 * "Your business" picker in Settings. The default profile is exactly
 * the old behaviour, so nothing changes until he picks another.
 *
 * API: window.ClavisBusiness
 *   profile(), set(id, {service, buyers}), presets(), describe(),
 *   buyerQueries(), competitorRegex(), label(), detect(text), fit(lead)
 * localStorage: clavis_business_profile
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisBusiness) return;

  const KEY = 'clavis_business_profile';
  const P = (label, service, buyers, competitors, detect) => ({ label, service, buyers, competitors, detect });
  const PRESETS = {
    security: P('Security & Housekeeping', 'security guards, housekeeping and manpower staffing',
      ['Corporate Offices', 'IT Companies', 'Hotels', 'Hospitals', 'Manufacturing Companies', 'Shopping Malls', 'Warehouses & Logistics'],
      'security\\s+(agency|agencies|service|services|solutions|guard|guards|guarding)|guarding|man\\s*power|manpower|housekeeping\\s+services?|facility\\s+management|facilities\\s+management|integrated\\s+facilit|staffing|placement\\s+(agency|agencies|services?)|recruit(ment)?\\s+(agency|agencies|services?|consultan)|cleaning\\s+services?|janitorial|pest\\s+control|detective|surveillance\\s+service|bouncer',
      /\b(security|guard|housekeeping|manpower)\b/),
    facility: P('Facility Management', 'facility management, cleaning and maintenance',
      ['Corporate Offices', 'IT Parks', 'Hospitals', 'Hotels', 'Shopping Malls', 'Residential Societies', 'Schools'],
      'facility\\s+management|facilities\\s+management|housekeeping\\s+services?|cleaning\\s+services?|janitorial|integrated\\s+facilit',
      /\b(facility|facilities|cleaning|maintenance)\b/),
    it: P('IT Services & Software', 'software development, websites, apps and IT support',
      ['Startups', 'Manufacturing Companies', 'Retail Chains', 'Hospitals', 'Schools', 'Real Estate Developers', 'CA Firms', 'Logistics Companies'],
      'software\\s+(company|development|solutions)|it\\s+(services|solutions|company)|web\\s*(design|development)|app\\s+development|digital\\s+agency|infotech|technologies\\s+pvt',
      /\b(software|it services|website|web development|app development|it support|saas)\b/),
    marketing: P('Digital Marketing', 'digital marketing, SEO, ads and social media',
      ['Restaurants', 'Clinics', 'Real Estate Developers', 'Coaching Institutes', 'Gyms', 'Showrooms', 'Salons', 'Hotels'],
      'digital\\s+marketing|seo\\s+(company|agency|services)|advertising\\s+agency|social\\s+media\\s+(agency|marketing)|marketing\\s+agency|branding\\s+agency',
      /\b(marketing|seo|social media|ads|advertising|branding)\b/),
    catering: P('Catering & Food Services', 'corporate catering, cafeteria and food services',
      ['Corporate Offices', 'IT Companies', 'Schools', 'Hospitals', 'Manufacturing Companies', 'Banquet Halls'],
      'caterers?|catering|tiffin\\s+service|food\\s+services|cloud\\s+kitchen',
      /\b(catering|caterer|food service|tiffin|cafeteria|canteen)\b/),
    maintenance: P('HVAC, Electrical & AMC', 'HVAC, electrical, plumbing and annual maintenance contracts',
      ['Corporate Offices', 'Hotels', 'Hospitals', 'Shopping Malls', 'Manufacturing Companies', 'Residential Societies', 'Data Centers'],
      'hvac|air\\s+condition(ing|er)\\s+(service|contractor|dealer)|ac\\s+repair|electrical\\s+contractor|plumbing\\s+(service|contractor)|amc\\s+service',
      /\b(hvac|ac repair|air condition\w*|electrical|plumbing|amc|maintenance contract)\b/),
    solar: P('Solar & Energy', 'rooftop solar and energy solutions',
      ['Manufacturing Companies', 'Warehouses', 'Schools', 'Hospitals', 'Residential Societies', 'Hotels', 'Cold Storages'],
      'solar|renewable\\s+energy|energy\\s+solutions',
      /\b(solar|renewable|energy)\b/),
    staffing: P('Staffing & Recruitment', 'recruitment, staffing and payroll outsourcing',
      ['Manufacturing Companies', 'Warehouses', 'IT Companies', 'Hospitals', 'Hotels', 'Retail Chains', 'BPOs'],
      'placement\\s+(agency|agencies|services?|consultants?)|recruit(ment)?\\s+(agency|agencies|services?|consultan)|staffing|man\\s*power|hr\\s+consultan',
      /\b(recruitment|staffing|placement|hiring agency|hr consult\w*|payroll)\b/),
    logistics: P('Logistics & Courier', 'courier, transport and warehousing',
      ['Manufacturers', 'E-commerce Sellers', 'Distributors', 'Wholesalers', 'Exporters', 'Pharma Companies'],
      'courier|logistics|transport(ers?)?\\b|packers\\s+and\\s+movers|freight',
      /\b(logistics|courier|transport|freight|delivery)\b/),
    supplies: P('Office & Industrial Supplies', 'office, stationery and industrial supplies',
      ['Corporate Offices', 'Schools', 'Hospitals', 'Banks', 'CA Firms', 'Manufacturing Companies'],
      'stationery\\s+(supplier|shop|store)|office\\s+supplies|industrial\\s+supplies|wholesale\\s+stationery',
      /\b(stationery|office supplies|industrial supplies|supplies)\b/),
    interiors: P('Interiors & Construction', 'interior design, fit-outs and construction',
      ['Corporate Offices', 'Restaurants', 'Showrooms', 'Hotels', 'Clinics', 'Real Estate Developers'],
      'interior\\s+design(ers?)?|interiors|civil\\s+contractor|construction\\s+company|fit\\s*-?\\s*outs?',
      /\b(interior|interiors|construction|fit.?out|civil work)\b/),
    finance: P('Insurance & Finance', 'insurance, loans and financial services',
      ['Small Businesses', 'Manufacturers', 'Clinics', 'Retail Shops', 'Transporters', 'Traders'],
      'insurance\\s+(agent|agency|advisor|company)|loan\\s+(agent|consultant)|financial\\s+services|finance\\s+company',
      /\b(insurance|loan|loans|finance|financial services|mutual fund)\b/),
  };

  const lsGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };

  function profile() {
    const saved = lsGet() || {};
    const id = PRESETS[saved.id] ? saved.id : (saved.id === 'custom' ? 'custom' : 'security');
    const base = PRESETS[id] || { label: 'Custom', service: '', buyers: [], competitors: '' };
    const buyers = Array.isArray(saved.buyers) && saved.buyers.length ? saved.buyers : base.buyers;
    return {
      id,
      label: saved.label || base.label,
      service: saved.service || base.service || 'business services',
      buyers: buyers.map(String).filter(Boolean).slice(0, 12),
      competitors: saved.competitors || base.competitors || '',
    };
  }

  function set(id, extra = {}) {
    if (!PRESETS[id] && id !== 'custom') return false;
    const v = { id };
    if (extra.service) v.service = String(extra.service).slice(0, 160);
    if (extra.label) v.label = String(extra.label).slice(0, 60);
    if (Array.isArray(extra.buyers)) v.buyers = extra.buyers.map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
    if (id === 'custom' && extra.service && !v.competitors) v.competitors = String(extra.service).split(/[,/&]| and /).map((s) => s.trim()).filter((s) => s.length > 3).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('clavis:business', { detail: profile() })); } catch (_) {}
    applyCopy();
    return profile();
  }

  function competitorRegex() {
    const c = profile().competitors;
    if (!c) return null;
    try { return new RegExp(`\\b(${c})`, 'i'); } catch (_) { return null; }
  }
  const buyerQueries = () => profile().buyers.slice();
  const label = () => profile().label;
  function describe() {
    const p = profile();
    return `His business sells ${p.service} (${p.label}). His leads are the businesses that BUY that — e.g. ${p.buyers.slice(0, 6).join(', ')} — never other ${p.label.toLowerCase()} providers, who are his competitors.`;
  }

  // "main IT services provide karta hoon" / "hum solar lagate hain" → a preset.
  function detect(text) {
    const t = String(text || '').toLowerCase();
    let best = null;
    Object.entries(PRESETS).forEach(([id, p]) => { if (!best && p.detect.test(t)) best = id; });
    return best;
  }

  // For non-security sellers the security/housekeeping % mean nothing:
  // a plain "fit" from whether the lead is a buyer type he targets plus
  // how reachable it is.
  function fit(lead) {
    const p = profile();
    const hay = `${lead?.industry || ''} ${lead?.category || ''} ${lead?.company || ''} ${lead?.searchQuery || ''}`.toLowerCase();
    const buyerHit = p.buyers.some((b) => b.toLowerCase().split(/\s+|&/).filter((w) => w.length > 3).some((w) => hay.includes(w.replace(/s$/, ''))));
    let s = buyerHit ? 62 : 45;
    if (lead?.phone) s += 12;
    if (lead?.email) s += 12;
    if (lead?.website) s += 8;
    if (Number(lead?.rating) >= 4) s += 4;
    return Math.max(20, Math.min(98, s));
  }

  // Wrap the scorer once: non-security profiles get a fit score and a
  // reason in their own words; the security profile is untouched.
  function wrapScoring() {
    const E = window.AIScoringEngine;
    if (!E?.scoreCompanyLead || E.scoreCompanyLead.__business) return;
    const orig = E.scoreCompanyLead;
    const wrapped = function (lead) {
      const r = orig.apply(this, arguments);
      const p = profile();
      if (p.id === 'security' || !r) return r;
      const f = fit(lead);
      r.fitScore = f;
      r.leadScore = Math.round((r.leadScore || f) * 0.35 + f * 0.65);
      r.overallOpportunityScore = r.leadScore;
      r.scoreReasons = [`Fit for ${p.service}: ${f}%`].concat((r.scoreReasons || []).filter((x) => !/security|housekeep|guard/i.test(String(x)))).slice(0, 4);
      return r;
    };
    wrapped.__business = true;
    E.scoreCompanyLead = wrapped;
  }

  // Page copy that still says "Security Guards and Housekeeping Staff".
  function applyCopy() {
    const p = profile();
    if (p.id === 'security') return;
    document.querySelectorAll('.view-subtitle, .page-subtitle, #view-agent p, .agent-hero-sub').forEach((el) => {
      if (/security guards?.*housekeeping/i.test(el.textContent || '') && el.children.length === 0) {
        el.textContent = `Target & discover real public companies that need ${p.service}`;
      }
    });
  }

  // Settings: "Your business" picker in the System Settings modal.
  function mountPicker() {
    if (document.getElementById('sm-business-profile')) return;
    const anchor = document.getElementById('sm-gemini-voice')?.closest('.smodal-field');
    if (!anchor) return;
    const p = profile();
    const row = document.createElement('div');
    row.className = 'smodal-field';
    row.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-business-profile">Your business</label>
      <span class="smodal-hint">What you sell — leads, competitor filtering and Clavis's advice follow it.</span></div>
      <select id="sm-business-profile" class="smodal-select">${Object.entries(PRESETS).map(([id, x]) => `<option value="${id}">${x.label}</option>`).join('')}<option value="custom">Custom…</option></select>`;
    // Put it at the top of the section the voice picker lives in.
    const section = anchor.parentElement;
    section.insertBefore(row, section.firstElementChild);
    const sel = row.querySelector('select');
    sel.value = p.id;
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') {
        const service = window.prompt('Aap kya service bechte hain? (e.g. "CCTV installation")', p.id === 'custom' ? p.service : '');
        if (!service) { sel.value = profile().id; return; }
        const buyers = window.prompt('Aapke customers kaun hain? Comma se likhiye (e.g. "Schools, Hospitals, Warehouses")', profile().buyers.join(', '));
        set('custom', { service, label: service.slice(0, 40), buyers: String(buyers || '').split(',') });
      } else set(sel.value);
      try { window.showToast?.('success', 'Business updated', `Leads ab ${profile().label} ke customers ke liye.`); } catch (_) {}
    });
  }

  function boot() { wrapScoring(); applyCopy(); mountPicker(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else setTimeout(boot, 0);
  // The settings modal may render later.
  document.addEventListener('click', () => setTimeout(mountPicker, 60), { passive: true });

  window.ClavisBusiness = { profile, set, presets: () => ({ ...PRESETS }), describe, buyerQueries, competitorRegex, label, detect, fit };
})();
