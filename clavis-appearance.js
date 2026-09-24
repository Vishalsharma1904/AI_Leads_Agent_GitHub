/* ============================================================
 * clavis-appearance.js · make the UI yours
 * ------------------------------------------------------------
 * Settings → Appearance gains what ChatGPT/Claude offer and a bit more:
 *   · themes     Clavis (untouched default), Claude-warm, Sage,
 *                Midnight, Graphite, Paper (minimal)
 *   · accent     swatches + a free colour picker (buttons, send, focus)
 *   · surfaces   sidebar/top bar, background sheet and text colours,
 *                picked per light/dark theme
 *   · font       type pairings from fonts the app already loads
 *   · minimal    flatter surfaces, fewer shadows, no decoration
 *
 * Nothing is overridden until he picks something: every rule is
 * generated only for values that are set, so the stock theme stays
 * exactly as designed. Voice: "accent blue karo", "claude wala theme",
 * "minimal mode on". Stored in localStorage clavis_appearance_v1.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisAppearance) return;

  const KEY = 'clavis_appearance_v1';
  const THEMES = {
    clavis: { name: 'Clavis', light: {}, dark: {} },
    claude: { name: 'Claude warm', light: { shell: '#F0EEE6', sheet: '#FAF9F5', ink: '#141413', accent: '#C96442' }, dark: { shell: '#1F1E1D', sheet: '#262624', ink: '#F5F4EE', accent: '#D97757' }, font: 'anthropic' },
    sage: { name: 'Sage', light: { shell: '#EEF1EA', sheet: '#FBFCF8', ink: '#1E2A1E', accent: '#2F5233' }, dark: { shell: '#131914', sheet: '#1A211B', ink: '#EEF2EA', accent: '#6C9D72' } },
    midnight: { name: 'Midnight', light: { shell: '#E9EDF5', sheet: '#FFFFFF', ink: '#141B2D', accent: '#2F4B8C' }, dark: { shell: '#0D121E', sheet: '#141A2A', ink: '#E8ECF5', accent: '#7D9BE0' } },
    graphite: { name: 'Graphite', light: { shell: '#ECECEC', sheet: '#FFFFFF', ink: '#1A1A1A', accent: '#2B2B2B' }, dark: { shell: '#141414', sheet: '#1C1C1C', ink: '#EDEDED', accent: '#D6D6D6' } },
    paper: { name: 'Paper', light: { shell: '#FFFFFF', sheet: '#FFFFFF', ink: '#111111', accent: '#111111' }, dark: { shell: '#0B0B0B', sheet: '#0F0F0F', ink: '#F2F2F2', accent: '#F2F2F2' }, minimal: true },
  };
  const ACCENTS = [['Olive', '#2F5233'], ['Blue', '#2563EB'], ['Green', '#15803D'], ['Yellow', '#CA8A04'], ['Pink', '#DB2777'], ['Orange', '#EA580C'], ['Purple', '#7C3AED'], ['Clay', '#C96442'], ['Graphite', '#262626']];
  const FONTS = {
    clavis: { name: 'Clavis (default)' },
    anthropic: { name: 'Anthropic-style (Inter + Source Serif)', sans: "'Inter', system-ui, sans-serif", serif: "'Source Serif 4', 'Newsreader', Georgia, serif", load: 'Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700' },
    editorial: { name: 'Editorial (Figtree + Instrument Serif)', sans: "'Figtree', system-ui, sans-serif", serif: "'Instrument Serif', Georgia, serif" },
    jakarta: { name: 'Modern (Plus Jakarta Sans)', sans: "'Plus Jakarta Sans', system-ui, sans-serif", serif: "'Newsreader', Georgia, serif" },
    system: { name: 'System (fastest)', sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif" },
  };

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  const themeNow = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

  /* ── colour maths ──────────────────────────────────────────── */
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }
  const hsl = (h, s, l) => `hsl(${h.toFixed(1)} ${Math.max(0, Math.min(100, s)).toFixed(1)}% ${Math.max(0, Math.min(100, l)).toFixed(1)}%)`;
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function mix(hex, amt) {   // lighten (+) / darken (-) toward white/black
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    return `rgb(${f(n >> 16 & 255)}, ${f(n >> 8 & 255)}, ${f(n & 255)})`;
  }

  /* ── the effective settings for the current theme ──────────── */
  function effective() {
    const st = read();
    const t = themeNow();
    const base = (THEMES[st.theme] || THEMES.clavis)[t] || {};
    const custom = (st.custom && st.custom[t]) || {};
    return {
      shell: custom.shell || base.shell || null,
      sheet: custom.sheet || base.sheet || null,
      ink: custom.ink || base.ink || null,
      accent: st.accent || base.accent || null,
      font: st.font || (THEMES[st.theme] || {}).font || 'clavis',
      minimal: st.minimal != null ? !!st.minimal : !!(THEMES[st.theme] || {}).minimal,
    };
  }

  function css(e) {
    const H = 'html.cx-ap';
    const out = [];
    if (isHex(e.shell)) {
      out.push(`${H} body, ${H} #sidebar, ${H} .sidebar, ${H} .topbar { background: ${e.shell} !important; background-image: none !important; }`);
      out.push(`${H} { --shell-canvas: ${e.shell}; }`);
    }
    if (isHex(e.sheet)) {
      out.push(`${H} .views-container, ${H} #main-scroll-area, ${H} .main-content { background: ${e.sheet} !important; background-image: none !important; }`);
      out.push(`${H} { --shell-panel: ${e.sheet}; --background: ${e.sheet}; }`);
    }
    if (isHex(e.ink)) {
      const soft = luminance(e.ink) > 0.5 ? 'rgba(255,255,255,0.66)' : 'rgba(0,0,0,0.62)';
      out.push(`${H} { --foreground: ${e.ink}; --do-t1: ${e.ink}; --do-t2: ${soft}; }`);
      out.push(`${H} body, ${H} .views-container, ${H} .view, ${H} #sidebar .nav-item, ${H} .topbar { color: ${e.ink} !important; }`);
    }
    if (isHex(e.accent)) {
      const [h, s, l] = hexToHsl(e.accent);
      const light = luminance(e.accent) > 0.42;
      const on = light ? '#111111' : '#F7F3E8';
      out.push(`${H} { --olive-950: ${hsl(h, s, l - 18)}; --olive-900: ${hsl(h, s, l - 12)}; --olive-800: ${hsl(h, s, l - 6)}; --olive-700: ${e.accent}; --olive-600: ${hsl(h, s, l + 6)}; --olive-500: ${hsl(h, s, l + 13)}; --olive-400: ${hsl(h, s * 0.9, l + 24)}; --olive-100: ${mix(e.accent, 0.88)}; --cream: ${on}; --cream-hi: ${on}; --ap-accent: ${e.accent}; }`);
      out.push(`${H} :focus-visible { outline-color: ${e.accent} !important; }`);
      out.push(`${H} #sidebar .nav-item.active { box-shadow: inset 2px 0 0 ${e.accent} !important; }`);
      out.push(`${H} ::selection { background: ${mix(e.accent, 0.72)}; }`);
    }
    const f = FONTS[e.font];
    if (f && f.sans) {
      out.push(`${H} { --flow-sans: ${f.sans}; }`);
      out.push(`${H} body, ${H} button, ${H} input, ${H} textarea, ${H} select, ${H} .nav-item, ${H} .smodal { font-family: ${f.sans} !important; }`);
      out.push(`${H} h1, ${H} h2, ${H} .jarvis-greeting, ${H} .do-dash-greeting-title, ${H} .smodal-section-title, ${H} .cts-title { font-family: ${f.serif} !important; letter-spacing: -0.01em; }`);
    }
    if (e.minimal) {
      out.push(`${H} .do-card, ${H} [class*="do-chart"], ${H} .stat-card, ${H} .card, ${H} .glass, ${H} .lx-card { box-shadow: none !important; }`);
      out.push(`${H} .do-card, ${H} [class*="do-chart"], ${H} .stat-card, ${H} .card { border-color: rgba(127,127,127,0.16) !important; }`);
      out.push(`${H} #sidebar, ${H} .topbar, ${H} .views-container { box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`);
      out.push(`${H} .jarvis-hud-glow, ${H} .energy-field, ${H} .hex-pattern, ${H} [class*="particle"], ${H} [class*="sparkle"] { display: none !important; }`);
    }
    return out.join('\n');
  }

  function ensureFont(e) {
    const f = FONTS[e.font];
    if (!f || !f.load || document.getElementById('cx-ap-font')) return;
    const l = document.createElement('link');
    l.id = 'cx-ap-font';
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${f.load}&display=swap`;
    document.head.appendChild(l);
  }

  function apply() {
    const e = effective();
    let el = document.getElementById('cx-ap-style');
    if (!el) { el = document.createElement('style'); el.id = 'cx-ap-style'; document.head.appendChild(el); }
    const text = css(e);
    el.textContent = text;
    document.documentElement.classList.toggle('cx-ap', !!text);
    document.documentElement.toggleAttribute('data-minimal', !!e.minimal);
    ensureFont(e);
    sync();
  }

  function set(patch) {
    const st = read();
    Object.assign(st, patch);
    write(st);
    apply();
    return effective();
  }
  function setCustom(which, color) {
    const st = read();
    const t = themeNow();
    st.custom = st.custom || {};
    st.custom[t] = st.custom[t] || {};
    if (color) st.custom[t][which] = color; else delete st.custom[t][which];
    write(st);
    apply();
  }
  function reset() { write({}); apply(); }

  /* ── Settings → Appearance ─────────────────────────────────── */
  function row(label, hint, control) {
    return `<div class="smodal-field cx-ap-row"><div class="smodal-field-left"><label class="smodal-label">${label}</label><span class="smodal-hint">${hint}</span></div><div class="cx-ap-ctl">${control}</div></div>`;
  }
  function mount() {
    const sec = document.getElementById('smsc-appearance');
    if (!sec || document.getElementById('cx-ap-panel')) return;
    const head = sec.querySelector('.smodal-section-header');
    const box = document.createElement('div');
    box.id = 'cx-ap-panel';
    box.innerHTML =
      row('Theme', 'Pure colour sets — Clavis keeps the original look',
        `<div class="cx-ap-themes">${Object.entries(THEMES).map(([id, t]) => {
          const l = t.light, d = t.dark;
          return `<button type="button" class="cx-ap-theme" data-theme-id="${id}" title="${t.name}"><span class="cx-ap-sw" style="background:linear-gradient(135deg, ${l.shell || '#FAF7F1'} 0 50%, ${d.shell || '#171717'} 50% 100%)"><i style="background:${l.accent || '#2F5233'}"></i></span><em>${t.name}</em></button>`;
        }).join('')}</div>`) +
      row('Accent', 'Buttons, send, focus and highlights',
        `<div class="cx-ap-accents">${ACCENTS.map(([n, c]) => `<button type="button" class="cx-ap-dot" data-accent="${c}" title="${n}" style="background:${c}"></button>`).join('')}<label class="cx-ap-pick" title="Any colour"><input type="color" id="cx-ap-accent"></label></div>`) +
      row('Sidebar &amp; top bar', 'Picked for the current light/dark mode', `<input type="color" data-custom="shell" class="cx-ap-color"><button type="button" class="cx-ap-clear" data-clear="shell">Reset</button>`) +
      row('Background', 'The main sheet behind every page', `<input type="color" data-custom="sheet" class="cx-ap-color"><button type="button" class="cx-ap-clear" data-clear="sheet">Reset</button>`) +
      row('Text', 'Main text colour', `<input type="color" data-custom="ink" class="cx-ap-color"><button type="button" class="cx-ap-clear" data-clear="ink">Reset</button>`) +
      row('Font', 'Type pairing for the whole app',
        `<select id="cx-ap-font-sel" class="smodal-select">${Object.entries(FONTS).map(([id, f]) => `<option value="${id}">${f.name}</option>`).join('')}</select>`) +
      row('Minimal', 'Flatter surfaces, no shadows or decoration',
        `<label class="smodal-switch"><input type="checkbox" id="cx-ap-minimal"><span class="smodal-switch-track"><span class="smodal-switch-thumb"></span></span></label>`) +
      row('Reset', 'Back to the original Clavis look', `<button type="button" class="cx-ap-clear" id="cx-ap-reset">Reset appearance</button>`);
    if (head && head.nextSibling) sec.insertBefore(box, head.nextSibling); else sec.appendChild(box);

    box.addEventListener('click', (ev) => {
      const th = ev.target.closest('[data-theme-id]');
      if (th) { const st = read(); st.theme = th.dataset.themeId; delete st.accent; delete st.custom; delete st.minimal; delete st.font; write(st); apply(); return; }
      const dot = ev.target.closest('[data-accent]');
      if (dot) { set({ accent: dot.dataset.accent }); return; }
      const clr = ev.target.closest('[data-clear]');
      if (clr) { setCustom(clr.dataset.clear, null); return; }
      if (ev.target.id === 'cx-ap-reset') reset();
    });
    box.querySelector('#cx-ap-accent').addEventListener('input', (ev) => set({ accent: ev.target.value }));
    box.querySelectorAll('[data-custom]').forEach((inp) => inp.addEventListener('input', () => setCustom(inp.dataset.custom, inp.value)));
    box.querySelector('#cx-ap-font-sel').addEventListener('change', (ev) => set({ font: ev.target.value }));
    box.querySelector('#cx-ap-minimal').addEventListener('change', (ev) => set({ minimal: ev.target.checked }));

    const style = document.createElement('style');
    style.textContent = `
      #cx-ap-panel .cx-ap-ctl { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
      #cx-ap-panel .cx-ap-themes { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
      #cx-ap-panel .cx-ap-theme { display:flex; flex-direction:column; align-items:center; gap:5px; background:none; border:0; padding:2px; cursor:pointer; color:inherit; }
      #cx-ap-panel .cx-ap-theme em { font-style:normal; font-size:11px; opacity:.72; }
      #cx-ap-panel .cx-ap-sw { position:relative; width:38px; height:38px; border-radius:12px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.25); transition: transform .32s cubic-bezier(.22,1,.36,1), box-shadow .32s; }
      #cx-ap-panel .cx-ap-sw i { position:absolute; right:5px; bottom:5px; width:10px; height:10px; border-radius:50%; }
      #cx-ap-panel .cx-ap-theme:hover .cx-ap-sw { transform: translateY(-1px); }
      #cx-ap-panel .cx-ap-theme.is-on .cx-ap-sw { box-shadow: inset 0 0 0 1px rgba(127,127,127,.25), 0 0 0 2px var(--olive-700, #2F5233); }
      #cx-ap-panel .cx-ap-accents { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
      #cx-ap-panel .cx-ap-dot { width:22px; height:22px; border-radius:50%; border:0; cursor:pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); transition: transform .28s cubic-bezier(.22,1,.36,1); }
      #cx-ap-panel .cx-ap-dot:hover { transform: scale(1.12); }
      #cx-ap-panel .cx-ap-dot.is-on { box-shadow: 0 0 0 2px var(--shell-panel, #fff), 0 0 0 4px currentColor; color: var(--foreground, #111); }
      #cx-ap-panel .cx-ap-pick { width:24px; height:24px; border-radius:50%; overflow:hidden; background: conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e); cursor:pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
      #cx-ap-panel .cx-ap-pick input { opacity:0; width:100%; height:100%; cursor:pointer; }
      #cx-ap-panel .cx-ap-color { width:34px; height:26px; padding:0; border:0; background:none; cursor:pointer; }
      #cx-ap-panel .cx-ap-clear { font:500 12px/1 inherit; padding:7px 11px; border-radius:999px; border:1px solid rgba(127,127,127,.25); background:none; color:inherit; cursor:pointer; }
    `;
    box.appendChild(style);
    sync();
  }
  function sync() {
    const box = document.getElementById('cx-ap-panel');
    if (!box) return;
    const st = read();
    const e = effective();
    box.querySelectorAll('[data-theme-id]').forEach((b) => b.classList.toggle('is-on', (st.theme || 'clavis') === b.dataset.themeId));
    box.querySelectorAll('[data-accent]').forEach((b) => b.classList.toggle('is-on', (e.accent || '').toLowerCase() === b.dataset.accent.toLowerCase()));
    const cs = getComputedStyle(document.body);
    const toHex = (rgb) => { const m = String(rgb).match(/\d+/g); return m ? '#' + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('') : '#000000'; };
    const set = (sel, v) => { const i = box.querySelector(sel); if (i) i.value = v; };
    set('[data-custom="shell"]', e.shell || toHex(getComputedStyle(document.getElementById('sidebar') || document.body).backgroundColor));
    set('[data-custom="sheet"]', e.sheet || toHex(getComputedStyle(document.querySelector('.views-container') || document.body).backgroundColor));
    set('[data-custom="ink"]', e.ink || toHex(cs.color));
    set('#cx-ap-accent', e.accent || '#2F5233');
    set('#cx-ap-font-sel', e.font || 'clavis');
    const m = box.querySelector('#cx-ap-minimal'); if (m) m.checked = !!e.minimal;
  }

  /* ── voice: "accent blue karo", "claude wala theme", "minimal mode on" ── */
  const NAMES = { olive: '#2F5233', blue: '#2563EB', neela: '#2563EB', green: '#15803D', hara: '#15803D', yellow: '#CA8A04', peela: '#CA8A04', pink: '#DB2777', gulabi: '#DB2777', orange: '#EA580C', narangi: '#EA580C', purple: '#7C3AED', baingani: '#7C3AED', red: '#DC2626', laal: '#DC2626', black: '#1A1A1A', kaala: '#1A1A1A', clay: '#C96442' };
  function command(text) {
    const t = String(text || '').toLowerCase();
    if (!/\b(accent|colou?r|rang|theme|thim|font|minimal|appearance)\b/.test(t)) return null;
    const color = Object.keys(NAMES).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    if (color && /\b(accent|colou?r|rang|button)\b/.test(t)) { set({ accent: NAMES[color] }); return `Accent ${color} kar diya, sir.`; }
    const theme = Object.keys(THEMES).find((k) => t.includes(k));
    if (theme && /\btheme|thim|look\b/.test(t)) { const st = read(); st.theme = theme; delete st.accent; delete st.custom; write(st); apply(); return `${THEMES[theme].name} theme laga diya.`; }
    if (/\bminimal\b/.test(t)) { const on = !/\b(off|band|hatao|nahi)\b/.test(t); set({ minimal: on }); return on ? 'Minimal mode on — sab saaf aur shaant.' : 'Minimal mode band kar diya.'; }
    if (/\b(reset|default|original|pehle jaisa)\b/.test(t)) { reset(); return 'Appearance pehle jaisa kar diya.'; }
    return null;
  }

  // Theme switches (light/dark) change which custom set applies.
  new MutationObserver(() => apply()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  apply();
  document.addEventListener('click', () => setTimeout(mount, 80), { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else setTimeout(mount, 0);

  window.ClavisAppearance = { set, setCustom, reset, apply, effective, command, themes: () => ({ ...THEMES }), accents: () => ACCENTS.slice(), fonts: () => ({ ...FONTS }) };
})();
