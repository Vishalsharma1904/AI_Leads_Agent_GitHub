/**
 * luxury-ui.js v3.0
 * Clean, focused, no duplicate logic.
 * Sidebar spring toggle · Nav glow · Card glow · Cursor glow · Haptics
 */
'use strict';

(function LuxuryUI() {

  // ── 1. SPRING SIDEBAR TOGGLE ────────────────────────────────
  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const root = document.documentElement;
    const resizer = document.getElementById('sidebar-resizer');
    if (!sidebar) return;

    const desktop = matchMedia('(min-width: 769px)');
    const clamp = value => {
      const parsed = Number.parseInt(value, 10);
      if (!parsed || parsed > 240 || parsed < 180) return 220;
      return Math.max(210, Math.min(230, parsed));
    };
    const savedWidth = () => {
      const raw = localStorage.getItem('do-sidebar-width');
      if (raw && Number.parseInt(raw, 10) > 240) {
        localStorage.setItem('do-sidebar-width', '220');
        return 220;
      }
      return clamp(raw || 220);
    };

    // Old controllers wrote inline geometry. CSS variables are now the only source.
    sidebar.style.removeProperty('width');
    sidebar.style.removeProperty('min-width');
    sidebar.style.removeProperty('max-width');
    document.getElementById('main-content')?.style.removeProperty('margin-left');

    function applyExpandedWidth(value, persist = true) {
      const width = clamp(value);
      root.style.setProperty('--sidebar-expanded', `${width}px`);
      root.style.setProperty('--sidebar-width', `${width}px`);
      root.style.setProperty('--sidebar-current', `${width}px`);
      if (persist) localStorage.setItem('do-sidebar-width', String(width));
      document.getElementById('sm-sidebar-w-val')?.replaceChildren(String(width));
      return width;
    }

    function setCollapsed(collapsed, animate = true) {
      if (!desktop.matches) {
        if (animate) sidebar.classList.toggle('mobile-open');
        else sidebar.classList.remove('mobile-open');
        root.dataset.sidebarState = 'mobile';
        return;
      }
      root.classList.toggle('sidebar-animating', animate);
      sidebar.classList.toggle('collapsed', collapsed);
      sidebar.classList.remove('mobile-open');
      root.dataset.sidebarState = collapsed ? 'collapsed' : 'expanded';
      // Explicitly sync CSS variable so main-content margin-left transitions correctly
      const targetWidth = collapsed ? '64px' : (root.style.getPropertyValue('--sidebar-expanded') || '220px');
      root.style.setProperty('--sidebar-current', targetWidth);
      root.style.setProperty('--main-left', targetWidth);
      localStorage.setItem('lx-sidebar-collapsed', String(collapsed));
      document.dispatchEvent(new CustomEvent('nexus:sidebarchange', { detail: { collapsed } }));
      setTimeout(() => root.classList.remove('sidebar-animating'), 340);
    }

    function toggle() { setCollapsed(!sidebar.classList.contains('collapsed')); }
    applyExpandedWidth(savedWidth(), false);
    // Collapsed by default — the rail opens on demand, giving the app more room.
    const storedCollapsed = localStorage.getItem('lx-sidebar-collapsed');
    setCollapsed(storedCollapsed === null ? true : storedCollapsed === 'true', false);

    document.querySelector('.mac-close')?.addEventListener('click', toggle);
    document.querySelector('.mac-minimize')?.addEventListener('click', () => setCollapsed(true));
    document.querySelector('.mac-maximize')?.addEventListener('click', () => setCollapsed(false));
    window.luxSidebarToggle = toggle;
    window.toggleSidebarCollapse = toggle;
    window.SidebarController = { toggle, collapse: () => setCollapsed(true), expand: () => setCollapsed(false), setWidth: applyExpandedWidth };

    desktop.addEventListener('change', event => {
      sidebar.classList.remove('mobile-open');
      if (event.matches) {
        const sc = localStorage.getItem('lx-sidebar-collapsed');
        setCollapsed(sc === null ? true : sc === 'true', false);
      }
      else root.dataset.sidebarState = 'mobile';
    });

    if (resizer) {
      let dragging = false;
      const move = event => {
        if (!dragging || !desktop.matches) return;
        root.classList.add('sidebar-resizing');
        applyExpandedWidth(event.clientX, false);
      };
      resizer.addEventListener('pointerdown', event => {
        if (!desktop.matches || sidebar.classList.contains('collapsed')) return;
        dragging = true;
        resizer.setPointerCapture?.(event.pointerId);
        document.body.classList.add('sidebar-dragging');
        event.preventDefault();
      });
      resizer.addEventListener('pointermove', move, { passive: true });
      resizer.addEventListener('pointerup', event => {
        if (!dragging) return;
        dragging = false;
        resizer.releasePointerCapture?.(event.pointerId);
        document.body.classList.remove('sidebar-dragging');
        root.classList.remove('sidebar-resizing');
        applyExpandedWidth(getComputedStyle(root).getPropertyValue('--sidebar-expanded'));
      });
    }
  }

  // ── 2. NAV ITEM MOUSE-TRACK GLOW (sidebar + settings) ──────
  function initNavGlow() {
    const track = (root) => {
      if (!root) return;
      let frame = 0;
      root.addEventListener('mousemove', e => {
        const item = e.target.closest('.nav-item, .nav-sub-item, .smodal-nav-item');
        if (!item) return;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const r = item.getBoundingClientRect();
          item.style.setProperty('--nx', ((e.clientX - r.left) / r.width  * 100) + '%');
          item.style.setProperty('--ny', ((e.clientY - r.top)  / r.height * 100) + '%');
        });
      }, { passive: true });
    };
    track(document.getElementById('sidebar'));
    track(document.getElementById('settings-modal'));
    track(document);   // fallback for any late-mounted panels
  }

  // ── 3. CARD MOUSE-TRACK GLOW ────────────────────────────────
  // Each card gets a single `.lx-card-glow` div injected as first child.
  // We update CSS vars `--gx/--gy` directly on that div using
  // `element.getBoundingClientRect()` — no transform-coordinate confusion.
  // The div is shown/hidden with a CSS class — no style.opacity writes.
  function initCardGlow() {
    document.querySelectorAll('.pfx-card-glow, .lx-card-glow').forEach(el => el.remove());
  }

  // ── 4. CURSOR AMBIENT GLOW (Disabled for clean Apple HIG) ──
  function initCursorGlow() {
    document.getElementById('pfx-cursor-glow')?.remove();
    document.getElementById('lx-cursor-glow')?.remove();
  }

  // ── 5. BUTTON PRESS HAPTIC ──────────────────────────────────
  function initHaptic() {
    const SEL = '.btn-primary,.btn-secondary,.generate-btn,.smodal-btn-primary,.smodal-btn-secondary,.smodal-btn-danger,.ag-btn-submit,.ag-bypass-pill,.claude-send-btn';
    document.addEventListener('mousedown', e => {
      const btn = e.target.closest(SEL);
      if (!btn) return;
      btn.style.transform = 'scale(0.95)';
      btn.style.transition = 'transform 0.1s ease';
      const up = () => { btn.style.transform = ''; document.removeEventListener('mouseup', up); };
      document.addEventListener('mouseup', up);
    }, { passive: true });
  }

  // ── 6. THEME TOGGLE PATCH (pulse on click) ──────────────────
  function patchThemeToggle() {
    const button = document.getElementById('mark-bennett-theme-btn');
    button?.setAttribute('aria-checked', String(document.documentElement.getAttribute('data-theme') === 'dark'));
    document.addEventListener('nexus:themechange', event => {
      button?.setAttribute('aria-checked', String(event.detail.theme === 'dark'));
      if (window.__themeTransitioning) {
        document.addEventListener('nexus:themechange:settled', () => {
          window.DashboardCtrl?.renderDonut?.();
          window.AnalyticsCtrl?.init?.();
        }, { once: true });
      } else {
        window.DashboardCtrl?.renderDonut?.();
        window.AnalyticsCtrl?.init?.();
      }
    });
  }

  // ── 7. ANIMATE-UI HOVER GHOST HIGHLIGHT ─────────────────────
  //  Retired in favour of ultra-smooth, velocity-adaptive .lx-nav-pill in clavis-luxe.js
  function initNavIndicator() {
    return;
  }

  // ── INIT ────────────────────────────────────────────────────
  function init() {
    initSidebar();
    initNavGlow();
    initCardGlow();
    initCursorGlow();
    initHaptic();
    patchThemeToggle();
    initNavIndicator();
    console.info('[LuxuryUI v3] ✨ Initialized');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();


// ══════════════════════════════════════════════════════════════
//  LUXURY PALETTE — Dynamic accent color switcher
// ══════════════════════════════════════════════════════════════
(function LuxuryPaletteInit() {
  const ACCENTS = ['purple','blue','emerald','rose','amber','cyan','crimson','graphite'];
  const stored = localStorage.getItem('lx-accent') || 'purple';

  function apply(name) {
    if (!ACCENTS.includes(name)) name = 'purple';
    document.documentElement.setAttribute('data-accent', name);
    localStorage.setItem('lx-accent', name);
  }

  function set(name, btnEl) {
    apply(name);
    document.querySelectorAll('.lx-palette-swatch').forEach(s => s.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    else document.querySelector(`.lx-palette-swatch[data-accent="${name}"]`)?.classList.add('active');

    // Small pulse on active swatch
    if (btnEl) {
      btnEl.style.animation = 'none';
      requestAnimationFrame(() => {
        btnEl.style.animation = 'lx-swatch-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)';
      });
    }

    if (typeof window.showToast === 'function') {
      window.showToast('success', '🎨 Accent Updated', `Theme now uses "${name.charAt(0).toUpperCase() + name.slice(1)}" accent.`);
    }
  }

  // Apply saved accent immediately (before DOM ready if possible)
  apply(stored);

  // Sync UI when settings opens
  document.addEventListener('DOMContentLoaded', () => {
    const cur = localStorage.getItem('lx-accent') || 'purple';
    document.querySelectorAll('.lx-palette-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.accent === cur);
    });
  });

  window.LuxuryPalette = { apply, set };
})();

/* Swatch pop keyframe (inject once) */
(function injectSwatchPopKeyframes() {
  if (document.getElementById('lx-swatch-pop-kf')) return;
  const style = document.createElement('style');
  style.id = 'lx-swatch-pop-kf';
  style.textContent = `
    @keyframes lx-swatch-pop {
      0%   { transform: translateY(-2px) scale(1.06); }
      40%  { transform: translateY(-4px) scale(1.15); }
      100% { transform: translateY(-2px) scale(1.06); }
    }
  `;
  document.head.appendChild(style);
})();

// ══════════════════════════════════════════════════════════════
//  CHATBOX CARET BEAM — Beam originates at the blinking caret
//  Uses mirror-div technique to measure precise caret x,y in px.
// ══════════════════════════════════════════════════════════════
(function ChatboxCaretBeam() {

  // Every property that can affect where a glyph lands must be mirrored, or the
  // measurement drifts. The previous list omitted kerning + font-feature/
  // variation settings; the chat textarea uses Inter with optical kerning, so
  // the mirror rendered the text WIDER than reality and the caret light crept
  // rightward, the error growing with each character (the "expanding gap").
  const MIRROR_PROPS = [
    'boxSizing','overflowX','overflowY',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderStyle',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'fontStyle','fontVariant','fontVariantLigatures','fontVariantNumeric',
    'fontWeight','fontStretch','fontSize','fontSizeAdjust','fontFamily',
    'fontKerning','fontFeatureSettings','fontVariationSettings','fontOpticalSizing',
    'lineHeight','textAlign','textTransform','textIndent','textDecoration',
    'letterSpacing','wordSpacing','textRendering',
    'tabSize','MozTabSize',
    'whiteSpace','wordWrap','wordBreak','overflowWrap'
  ];

  function getCaretCoords(textarea) {
    let mirror = textarea.__lxMirror;
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      document.body.appendChild(mirror);
      textarea.__lxMirror = mirror;
    }

    const cs = window.getComputedStyle(textarea);

    // Reset the base layout each call so a reused mirror can't carry stale state
    const st = mirror.style;
    st.cssText = '';
    st.position = 'absolute';
    st.visibility = 'hidden';
    st.top = '0';
    st.left = '-9999px';
    st.whiteSpace = 'pre-wrap';
    st.wordWrap = 'break-word';
    st.overflow = 'hidden';
    st.pointerEvents = 'none';
    st.zIndex = '-9999';
    st.webkitFontSmoothing = cs.webkitFontSmoothing || '';

    MIRROR_PROPS.forEach(p => { try { st[p] = cs[p]; } catch (_) {} });

    // Match wrapping exactly: content-box sized to the textarea's *content* width
    st.boxSizing = 'content-box';
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentW = Math.max(0, textarea.clientWidth - padL - padR);
    st.width = contentW + 'px';
    st.height = 'auto';

    const caretPos = textarea.selectionStart;
    mirror.textContent = textarea.value.slice(0, caretPos);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';               // zero-width space at the caret
    mirror.appendChild(marker);

    // offsetLeft/Top are relative to the mirror's padding edge and are unaffected
    // by sub-pixel rect rounding, so they track the caret cleanly.
    const lineH = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 14) * 1.4;
    const x = marker.offsetLeft;                 // = paddingLeft + text width
    const y = marker.offsetTop + lineH * 0.5;    // vertical middle of the line
    return { x, y, padL, contentW, lineH };
  }

  function updateBeam(box, textarea) {
    const ta = textarea.getBoundingClientRect();
    const cb = box.getBoundingClientRect();
    const cs = window.getComputedStyle(textarea);
    const borderL = parseFloat(cs.borderLeftWidth) || 0;
    const borderT = parseFloat(cs.borderTopWidth)  || 0;
    const padT    = parseFloat(cs.paddingTop)       || 0;
    // Distance from container's edge to textarea's content origin
    const offsetX = (ta.left - cb.left) + borderL;
    const offsetY = (ta.top  - cb.top)  + borderT;

    try {
      const c = getCaretCoords(textarea);
      let finalX = offsetX + c.x - textarea.scrollLeft;
      // mirror uses content-box sizing (no padding inside), so add padT
      // to convert mirror-relative Y into textarea-relative Y
      let finalY = offsetY + padT + c.y - textarea.scrollTop;

      // Defensive clamp: beam can't sit past the textarea's right content edge
      const maxX = offsetX + c.padL + c.contentW + 2;
      if (finalX > maxX) finalX = maxX;
      if (finalX < offsetX) finalX = offsetX;

      box.style.setProperty('--caret-x', finalX.toFixed(1) + 'px');
      box.style.setProperty('--caret-y', finalY.toFixed(1) + 'px');
    } catch (e) {
      box.style.setProperty('--caret-x', (offsetX + 4) + 'px');
      box.style.setProperty('--caret-y', (offsetY + (ta.height / 2)) + 'px');
    }
  }

  // Auto-grow the textarea smoothly to fit content
  function autoGrow(textarea, box) {
    const cs = window.getComputedStyle(textarea);
    const min = parseFloat(cs.minHeight) || 42;
    const max = parseFloat(cs.maxHeight) || 260;
    const prevH = textarea.offsetHeight;

    // Reset to measure natural content height accurately
    textarea.style.height = 'auto';
    const contentH = textarea.scrollHeight;
    const nextH = Math.max(min, Math.min(max, contentH));
    textarea.style.height = nextH + 'px';

    // Detect meaningful growth → pulse the container border
    if (nextH - prevH > 5 && box) {
      box.classList.remove('lx-grew');
      // Force reflow so animation re-triggers
      void box.offsetWidth;
      box.classList.add('lx-grew');
    }
  }

  // Inject a hover-glow layer div into each box (for mouse-tracking)
  function ensureHoverGlow(box) {
    if (!box.querySelector('.lx-hover-glow')) {
      const layer = document.createElement('div');
      layer.className = 'lx-hover-glow';
      box.insertBefore(layer, box.firstChild);
    }
    // Clean up any previously injected revolving border ring
    box.querySelector('.lx-border-ring')?.remove();
    ensureCaretDust(box);
  }

  // A handful of faint embers that drift off the caret light. Deliberately
  // few (7) and tiny, so it reads as dust catching the light rather than a
  // particle effect. Each gets randomised drift/size/timing so no two loop
  // in step. The whole layer is skipped when motion is reduced/off.
  const DUST_COUNT = 7;
  function ensureCaretDust(box) {
    if (box.__lxDust) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.documentElement.getAttribute('data-motion') === 'off') return;

    const dust = document.createElement('div');
    dust.className = 'lx-caret-dust';
    dust.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < DUST_COUNT; i++) {
      const p = document.createElement('span');
      p.className = 'lx-dust';
      // Scatter forward (rightward) with a little vertical wander
      const dx = 26 + Math.random() * 46;              // px travelled forward
      const dy = (Math.random() - 0.5) * 22;           // slight up/down
      const sz = 1.2 + Math.random() * 1.6;            // 1.2–2.8px
      const dur = 2.2 + Math.random() * 2.4;           // 2.2–4.6s
      const delay = -Math.random() * dur;              // desync the loop
      p.style.setProperty('--dx', dx.toFixed(1) + 'px');
      p.style.setProperty('--dy', dy.toFixed(1) + 'px');
      p.style.setProperty('--sz', sz.toFixed(2) + 'px');
      p.style.setProperty('--dur', dur.toFixed(2) + 's');
      p.style.setProperty('--delay', delay.toFixed(2) + 's');
      dust.appendChild(p);
    }
    box.insertBefore(dust, box.firstChild);
    box.__lxDust = dust;
  }

  function attachToBox(box) {
    if (box.__lxCaretBound) return;
    const textarea = box.querySelector('textarea, [contenteditable]');
    if (!textarea) return;
    box.__lxCaretBound = true;

    ensureHoverGlow(box);

    // Mouse-hover glow — tracks cursor position for ambient light
    let frame = 0;
    box.addEventListener('mousemove', (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = box.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width)  * 100;
        const y = ((e.clientY - r.top)  / r.height) * 100;
        box.style.setProperty('--hover-x', x + '%');
        box.style.setProperty('--hover-y', y + '%');
      });
    }, { passive: true });

    // Skip caret math for contenteditable — mirror technique is textarea-specific
    if (textarea.tagName !== 'TEXTAREA') {
      textarea.addEventListener('focus', () => box.classList.add('lx-scattered'));
      textarea.addEventListener('blur',  () => setTimeout(() => box.classList.remove('lx-scattered'), 400));
      return;
    }

    const refresh = () => updateBeam(box, textarea);
    const grow    = () => autoGrow(textarea, box);

    ['input','click','keyup','keydown','select','focus','scroll','mouseup'].forEach(ev => {
      textarea.addEventListener(ev, () => requestAnimationFrame(refresh), { passive: true });
    });

    // Auto-grow: run on every input event
    textarea.addEventListener('input', () => {
      grow();
      requestAnimationFrame(refresh);
    });

    textarea.addEventListener('focus', () => {
      box.classList.add('lx-scattered');
      grow();
      requestAnimationFrame(refresh);
    });
    textarea.addEventListener('blur', () => {
      setTimeout(() => box.classList.remove('lx-scattered'), 400);
    });

    // Recompute on window resize (wrap width changes)
    window.addEventListener('resize', () => {
      grow();
      if (document.activeElement === textarea) requestAnimationFrame(refresh);
    }, { passive: true });

    // Initial grow + position
    grow();
    requestAnimationFrame(refresh);
  }

  function scan() {
    document.querySelectorAll('.claude-input-container').forEach(attachToBox);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
  // Re-scan on DOM changes
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();


// ══════════════════════════════════════════════════════════════
//  CHATBOX ENHANCEMENTS
//  1. Custom dropdown click-to-open + item selection
//  2. Drag & drop file upload with folder icon
//  3. Single-line default height with smooth auto-grow
//  Applied uniformly to every .claude-input-container
// ══════════════════════════════════════════════════════════════
(function ChatboxEnhancer() {

  // Beautiful folder SVG (matching reference — blue folder w/ tab on top)
  const FOLDER_SVG = `
    <svg class="lx-icon-folder" viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7.5C3 6.4 3.9 5.5 5 5.5H9.5L11.3 7.3C11.7 7.7 12.2 8 12.7 8H19C20.1 8 21 8.9 21 10V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V7.5Z"
            fill="currentColor" opacity="0.95"/>
      <rect x="6" y="4" width="8" height="3.5" rx="0.8" fill="currentColor" opacity="0.55"/>
    </svg>`;

  const DROP_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7.5C3 6.4 3.9 5.5 5 5.5H9.5L11.3 7.3C11.7 7.7 12.2 8 12.7 8H19C20.1 8 21 8.9 21 10V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V7.5Z" fill="currentColor" opacity="0.15"/>
      <path d="M12 12v6M9 15l3-3 3 3" stroke-width="2.2"/>
    </svg>`;

  const CLOSE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // ── 1. Custom dropdown behaviour ────────────────────────
  function initDropdown(dropdown) {
    if (dropdown.__lxDropdownBound) return;
    dropdown.__lxDropdownBound = true;

    const header = dropdown.querySelector('.custom-dropdown-header');
    const list   = dropdown.querySelector('.custom-dropdown-list');
    const hidden = dropdown.querySelector('input[type="hidden"]');
    const label  = dropdown.querySelector('.custom-dropdown-text');
    if (!header || !list) return;

    // Portal the list to <body> while open so an ancestor's overflow:hidden
    // (the chat input container) can never clip or truncate the model list.
    const anchor = document.createComment('lx-dropdown-anchor');
    list.parentNode.insertBefore(anchor, list);

    function position() {
      const r = header.getBoundingClientRect();
      const width = Math.max(r.width, 300);
      list.style.position = 'fixed';
      list.style.minWidth = `${width}px`;
      list.style.left = 'auto';
      list.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
      list.style.bottom = `${window.innerHeight - r.top + 10}px`;
      list.style.top = 'auto';
    }

    function open() {
      document.querySelectorAll('.custom-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      document.body.appendChild(list);
      list.classList.add('lx-portal');
      position();
      dropdown.classList.add('open');
    }
    function close() {
      if (!dropdown.classList.contains('open')) return;
      dropdown.classList.remove('open');
      list.classList.remove('lx-portal');
      list.style.cssText = '';
      anchor.parentNode.insertBefore(list, anchor.nextSibling);
    }

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('open')) close();
      else open();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !list.contains(e.target)) close();
    });
    window.addEventListener('resize', () => { if (dropdown.classList.contains('open')) position(); }, { passive: true });
    document.getElementById('main-scroll-area')?.addEventListener('scroll', () => { if (dropdown.classList.contains('open')) position(); }, { passive: true });
    dropdown.__lxClose = close;

    // Item selection
    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        list.querySelectorAll('li').forEach(x => x.classList.remove('active'));
        li.classList.add('active');
        const value = li.dataset.value || '';
        if (hidden) {
          hidden.value = value;
          hidden.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (label) {
          // Get text without the badge span
          const textOnly = Array.from(li.childNodes)
            .filter(n => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains('flagship-badge')))
            .map(n => n.textContent).join('').trim();
          // Remove parenthetical provider (e.g., " (Groq)") for cleaner label
          label.textContent = textOnly.replace(/\s*\([^)]*\)\s*/, '').trim();
        }
        close();
      });
    });

    // Keyboard: Escape closes
    dropdown.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  // ── 2. Drag & drop + folder icon ─────────────────────────
  function initDragDrop(box) {
    if (box.__lxDragBound) return;
    box.__lxDragBound = true;

    // Locate the existing upload button and its file input
    let fileBtn = null;
    let fileInput = null;
    box.querySelectorAll('.claude-icon-btn').forEach(btn => {
      // Heuristic: button that opens a file picker via onclick or wraps a file input nearby
      const onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes('file-upload') || onclick.includes('.click()')) {
        fileBtn = btn;
      }
    });
    // Resolve an input owned by this chatbox only. Never share a global input
    // between multiple composers: that made file chips update the wrong box.
    fileInput = box.querySelector('input[type="file"]');
    if (!fileInput && fileBtn) {
      const controlId = fileBtn.getAttribute('aria-controls') ||
        (fileBtn.getAttribute('onclick') || '').match(/getElementById\(['"]([^'"]+)['"]\)/)?.[1];
      const candidate = controlId ? document.getElementById(controlId) : null;
      if (candidate?.type === 'file' && !candidate.__lxOwner) fileInput = candidate;
    }
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.hidden = true;
      fileInput.className = 'lx-chat-file-input';
      box.appendChild(fileInput);
    }
    fileInput.__lxOwner = box;
    if (fileBtn) {
      fileBtn.removeAttribute('onclick');
      fileBtn.setAttribute('aria-controls', fileInput.id || (fileInput.id = `lx-upload-${Math.random().toString(36).slice(2, 9)}`));
      fileBtn.addEventListener('click', event => { event.preventDefault(); fileInput.click(); });
    }

    // Convert upload button: add folder icon markup + class
    if (fileBtn && !fileBtn.__lxFolderReady) {
      fileBtn.__lxFolderReady = true;
      fileBtn.classList.add('lx-upload-btn');
      // Wrap existing svg with default class
      const existing = fileBtn.querySelector('svg');
      if (existing && !existing.classList.contains('lx-icon-default')) {
        existing.classList.add('lx-icon-default');
      }
      // Append folder icon (initially hidden via CSS)
      fileBtn.insertAdjacentHTML('beforeend', FOLDER_SVG);
    }

    // Inject drop overlay + file chip
    if (!box.querySelector('.lx-drop-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'lx-drop-overlay';
      overlay.innerHTML = `${DROP_ICON_SVG}<span>Drop file to attach</span>`;
      box.appendChild(overlay);
    }

    let fileChip = box.querySelector('.lx-file-chip');
    if (!fileChip) {
      fileChip = document.createElement('div');
      fileChip.className = 'lx-file-chip';
      fileChip.innerHTML = `
        ${FOLDER_SVG.replace('class="lx-icon-folder"', 'width="15" height="15"')}
        <span class="lx-chip-name">file</span>
        <button class="lx-chip-remove" type="button" aria-label="Remove file">${CLOSE_SVG}</button>
      `;
      // Insert AFTER the container so it appears below (visually near it)
      box.parentNode.insertBefore(fileChip, box.nextSibling);
    }

    function showFile(file) {
      if (!fileBtn || !fileChip) return;
      fileBtn.classList.add('lx-has-file');
      const nameEl = fileChip.querySelector('.lx-chip-name');
      if (nameEl) nameEl.textContent = file.name;
      fileChip.classList.add('show');
      box.__lxFile = file;
    }

    function clearFile() {
      if (fileBtn) fileBtn.classList.remove('lx-has-file');
      if (fileChip) fileChip.classList.remove('show');
      if (fileInput) { try { fileInput.value = ''; } catch(e) {} }
      box.__lxFile = null;
    }

    // Wire remove button
    fileChip.querySelector('.lx-chip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      clearFile();
    });

    // Listen for standard file input change (click-to-upload)
    if (fileInput && !fileInput.__lxWatchBound) {
      fileInput.__lxWatchBound = true;
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) showFile(fileInput.files[0]);
      });
    }

    // Drag & drop events
    ['dragenter','dragover'].forEach(ev => {
      box.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        box.classList.add('lx-dragover');
      });
    });
    ['dragleave','dragend'].forEach(ev => {
      box.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        // Only remove if we actually left the box (not entering a child)
        if (!box.contains(e.relatedTarget)) box.classList.remove('lx-dragover');
      });
    });
    box.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      box.classList.remove('lx-dragover');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) {
        showFile(files[0]);
        // Propagate to hidden input if compatible
        if (fileInput) {
          try {
            const dt = new DataTransfer();
            dt.items.add(files[0]);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          } catch(err) { /* fallback: keep only in-memory */ }
        }
      }
    });
  }

  // ── Scan / apply ─────────────────────────────────────────
  function scan() {
    document.querySelectorAll('.claude-input-container').forEach(box => {
      // Dropdowns inside
      box.querySelectorAll('.custom-dropdown').forEach(initDropdown);
      // Drag drop + folder icon
      initDragDrop(box);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();


// ══════════════════════════════════════════════════════════════
//  HOVER GLOW INTENSITY — adjustable via Settings slider
//  Writes --lx-glow (0..2) onto <html>; all glow layers scale off it.
// ══════════════════════════════════════════════════════════════
(function GlowIntensity() {
  const KEY = 'lx-glow-intensity';

  function apply(pct) {
    const p = Math.max(0, Math.min(200, parseInt(pct, 10) || 0));
    document.documentElement.style.setProperty('--lx-glow', (p / 100).toFixed(2));
    const label = document.getElementById('lx-glow-val');
    if (label) label.textContent = p;
    return p;
  }

  window.lxSetGlow = function (pct) {
    const p = apply(pct);
    localStorage.setItem(KEY, String(p));
  };

  window.lxGetGlow = function () {
    const v = parseInt(localStorage.getItem(KEY), 10);
    return Number.isFinite(v) ? v : 100;
  };

  // Apply saved value immediately (before first paint where possible)
  apply(window.lxGetGlow());

  // Keep the slider in sync whenever Settings opens
  function syncSlider() {
    const el = document.getElementById('lx-glow-intensity');
    if (el) {
      el.value = window.lxGetGlow();
      const label = document.getElementById('lx-glow-val');
      if (label) label.textContent = el.value;
    }
  }
  document.addEventListener('DOMContentLoaded', syncSlider);
  const overlay = () => document.getElementById('settings-overlay');
  const bind = () => {
    const ov = overlay();
    if (!ov) return;
    new MutationObserver(() => {
      if (ov.classList.contains('open')) syncSlider();
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();


// Centralized live appearance preferences.
(function LuxuryAppearanceSettings() {
  const KEY = 'lx-appearance-v1';
  const defaults = { uiScale: 100, density: 'comfortable', motion: 'full', radius: 14, shadow: 55, glowRadius: 320, blackLevel: 96, sidebarWidth: Number.parseInt(localStorage.getItem('do-sidebar-width'), 10) || 215 };
  const read = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { return { ...defaults }; } };
  let state = read();

  function apply() {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(state.uiScale / 100));
    root.style.setProperty('--lx-radius', `${state.radius}px`);
    root.style.setProperty('--lx-shadow-strength', String(state.shadow / 100));
    root.style.setProperty('--lx-card-shadow', `0 18px 46px -20px rgba(0,0,0,${(state.shadow / 100).toFixed(2)})`);
    root.style.setProperty('--lx-glow-radius', `${state.glowRadius}px`);
    root.style.setProperty('--lx-black-level', String(state.blackLevel / 100));
    const darkChannel = Math.round((100 - state.blackLevel) * 1.5);
    root.style.setProperty('--lx-dark-bg', `rgb(${darkChannel} ${darkChannel} ${darkChannel})`);
    root.dataset.density = state.density;
    root.dataset.motion = state.motion;
    window.SidebarController?.setWidth(state.sidebarWidth, false);
  }

  function sync() {
    const values = { 'sm-ui-scale': state.uiScale, 'sm-density': state.density, 'sm-motion': state.motion, 'sm-radius': state.radius, 'sm-shadow': state.shadow, 'sm-glow-radius': state.glowRadius, 'sm-black-level': state.blackLevel, 'sm-sidebar-width': state.sidebarWidth };
    Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
    ['ui-scale','radius','shadow','glow-radius','black-level','sidebar-w'].forEach(name => {
      const label = document.getElementById(`sm-${name}-val`);
      const source = document.getElementById(name === 'sidebar-w' ? 'sm-sidebar-width' : `sm-${name}`);
      if (label && source) label.textContent = source.value;
    });
  }

  window.lxSetAppearance = (key, value) => {
    if (!(key in defaults)) return;
    state[key] = typeof defaults[key] === 'number' ? Number(value) : value;
    localStorage.setItem(KEY, JSON.stringify(state));
    apply();
    sync();
    document.dispatchEvent(new CustomEvent('nexus:appearancechange', { detail: { ...state } }));
  };
  window.lxResetAppearance = () => { state = { ...defaults }; localStorage.setItem(KEY, JSON.stringify(state)); apply(); sync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { apply(); sync(); });
  else { apply(); sync(); }
  document.addEventListener('settingsOpened', sync);
})();


// Quiet, deduplicated reliability boundary for reversible UI failures.
(function LuxuryReliabilityBoundary() {
  const seen = new Map();

  const stripSecrets = value => String(value)
    .replace(/(api[_-]?key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 220);

  // For error reporting: an empty error still needs *some* text.
  const redact = value => stripSecrets(value || 'Unexpected application error');

  // For toast fields: an empty title or message is legitimate and must stay
  // empty. Passing it through `redact` would substitute the error fallback and
  // print "Unexpected application error" under a success toast.
  const redactField = value => (value === undefined || value === null || value === '')
    ? ''
    : stripSecrets(value);

  // Toasts are how the app tells the user an action succeeded or failed, so this
  // wrapper must never silently swallow one. An earlier version only let a toast
  // through when its text matched a keyword whitelist, which meant confirmations
  // like "Webhook Saved", "Settings Saved" and "Status Updated" were dropped and
  // every such button looked broken.
  //
  // What this wrapper still does:
  //   - normalises an unknown type to 'info' so styling never breaks
  //   - redacts anything that looks like a key/token before it reaches the screen
  //   - collapses an identical toast repeated within DEDUPE_MS (double-click guard)
  const DEDUPE_MS = 1200;
  const recentToasts = new Map();
  const VALID_TOAST_TYPES = new Set(['success', 'error', 'warning', 'info']);

  function installToastPolicy() {
    const original = window.showToast;
    if (typeof original !== 'function' || original.__lxPolicy) return;
    const filtered = function(a, b, c) {
      let fingerprint, callArgs;
      // Object form: showToast({ type, title, message, detail, actions, ... }).
      // Must be passed through intact — flattening it here was dropping the title,
      // message, detail and actions, leaving an empty "Notification" toast.
      if (a && typeof a === 'object') {
        const obj = { ...a };
        if ('title' in obj) obj.title = redactField(obj.title);
        if ('message' in obj) obj.message = redactField(obj.message);
        if ('detail' in obj) obj.detail = redactField(obj.detail);
        fingerprint = `obj|${obj.type}|${obj.title}|${obj.message}`;
        callArgs = [obj];
      } else {
        // Positional form — preserve the original arg count so its
        // (type,title,message) / legacy signature detection keeps working.
        // Only the 3-arg form treats `a` unambiguously as the type (2-arg and
        // 1-arg forms let `a` be a message instead), so normalise it there —
        // same rule app.js's own showToast already applies internally.
        let type0 = a;
        if (c !== undefined && !VALID_TOAST_TYPES.has(String(a).toLowerCase())) type0 = 'info';
        callArgs = [type0];
        if (b !== undefined) callArgs.push(redactField(b));
        if (c !== undefined) callArgs.push(redactField(c));
        fingerprint = callArgs.join('|');
      }

      const now = Date.now();
      if (now - (recentToasts.get(fingerprint) || 0) < DEDUPE_MS) return;
      recentToasts.set(fingerprint, now);
      if (recentToasts.size > 40) {
        for (const [key, at] of recentToasts) {
          if (now - at > DEDUPE_MS) recentToasts.delete(key);
        }
      }

      return original.apply(this, callArgs);
    };
    filtered.__lxPolicy = true;
    window.showToast = filtered;
  }

  function report(error) {
    installToastPolicy();
    const raw = error?.message || (typeof error === 'string' ? error : '');
    if (!raw) return;
    const message = redact(raw);
    if (/script error|resizeobserver|abort|cancel|networkerror|fetch|speech|speechrecognition/i.test(message)) return;
    const now = Date.now();
    if (now - (seen.get(message) || 0) < 10000) return;
    seen.set(message, now);
    console.warn('[App] Runtime info:', message);
  }

  function healLayout() {
    const activeViews = [...document.querySelectorAll('.view.active')];
    if (!activeViews.length) document.querySelector('#view-dashboard, #view-chat, .view')?.classList.add('active');
    activeViews.slice(1).forEach(view => view.classList.remove('active'));
    if (matchMedia('(min-width: 769px)').matches) document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      if (!modal.children.length) modal.remove();
    });
  }

  window.addEventListener('error', event => report(event.error || event.message));
  window.addEventListener('unhandledrejection', event => report(event.reason));
  document.addEventListener('DOMContentLoaded', () => { installToastPolicy(); healLayout(); });
  window.addEventListener('hashchange', () => setTimeout(healLayout, 0));
})();


// Premium live AI status indicator for chat surfaces (thinking → processing → …)
(function LuxeAiStatus() {
  const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;

  function mount(containerId = 'chat-messages') {
    const container = document.getElementById(containerId);
    if (!container) return null;
    document.getElementById('typing-indicator')?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'chat-message assistant lx-status-row';
    wrap.id = 'typing-indicator';
    wrap.innerHTML = `
      <div class="chat-avatar lx-status-avatar">${ICON}</div>
      <div class="lx-ai-status" role="status" aria-live="polite">
        <div class="lx-ai-status-glow"></div>
        <div class="lx-ai-status-main">
          <span class="lx-ai-status-dots"><i></i><i></i><i></i></span>
          <span class="lx-ai-status-text">Thinking</span>
        </div>
        <div class="lx-ai-status-track"><div class="lx-ai-status-bar"></div></div>
      </div>`;
    container.appendChild(wrap);
    const scroll = document.getElementById('main-scroll-area');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;

    const textEl = wrap.querySelector('.lx-ai-status-text');
    const barEl = wrap.querySelector('.lx-ai-status-bar');
    return {
      set(label, pct) {
        if (label && textEl && textEl.textContent !== label) {
          textEl.classList.remove('lx-flip');
          void textEl.offsetWidth;
          textEl.textContent = label;
          textEl.classList.add('lx-flip');
        }
        if (typeof pct === 'number' && barEl) {
          barEl.style.width = `${Math.max(6, Math.min(100, pct))}%`;
          barEl.classList.remove('lx-indeterminate');
        } else if (barEl) {
          barEl.classList.add('lx-indeterminate');
        }
      },
      remove() { wrap.remove(); }
    };
  }

  window.LuxeStatus = { mount };
})();


/**
 * ══════════════════════════════════════════════════════════════
 *  LUXE GLOW ZONES — one pointer engine, three different lights.
 *
 *  The same cursor produces a deliberately different response
 *  depending on where it is, because each surface has a different
 *  material in the design language:
 *
 *   · CONTENT  a wide, warm ambient bloom that pools under the cursor
 *   · SIDEBAR  a tall vertical "aurora ribbon" hugging the rail — cooler,
 *              dimmer, tracks Y strongly and X barely (it is a narrow strip)
 *   · COMPOSER a tight, warm lamp pool, like light falling on paper
 *
 *  All three are additive light (plus-lighter where supported) with
 *  heavily feathered multi-stop falloffs and a mask, so there are no
 *  hard circular edges anywhere.
 * ══════════════════════════════════════════════════════════════
 */
(function LuxeGlowZones() {
  'use strict';

  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.motion === 'off';
  const coarse = () => matchMedia('(pointer: coarse)').matches;
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  let sidebarGlow = null;
  let contentGlow = null;
  let raf = 0;

  // Targets and eased values, so light lags the cursor slightly like real light
  const P = { x: 0, y: 0, sx: 0, sy: 0, cx: 0, cy: 0, zone: 'none' };

  // Both glow layers live on <body> as fixed overlays that are merely *aligned*
  // to the sidebar / content rects. Injecting them as children displaced the
  // sidebar's flex layout, so they must never touch the app's own boxes.
  function ensureLayers() {
    let created = false;
    if (!sidebarGlow) {
      sidebarGlow = document.createElement('div');
      sidebarGlow.className = 'lx-sidebar-glow';
      document.body.appendChild(sidebarGlow);
      created = true;
    }
    if (!contentGlow) {
      contentGlow = document.createElement('div');
      contentGlow.className = 'lx-content-glow';
      document.body.appendChild(contentGlow);
      created = true;
    }
    if (created) align();
  }

  // Cached rects — the RAF loop must never call getBoundingClientRect, or it
  // forces a synchronous layout every frame (that was the scroll stutter).
  const RECT = { sb: null, mc: null };

  function align() {
    const sb = document.getElementById('sidebar');
    if (sidebarGlow && sb) {
      const r = sb.getBoundingClientRect();
      RECT.sb = r;
      sidebarGlow.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      sidebarGlow.style.width = r.width + 'px';
      sidebarGlow.style.height = r.height + 'px';
    }
    const mc = document.getElementById('main-content');
    if (contentGlow && mc) {
      const r = mc.getBoundingClientRect();
      RECT.mc = r;
      contentGlow.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
      contentGlow.style.width = r.width + 'px';
      contentGlow.style.height = r.height + 'px';
    }
  }
  // Geometry changes are animated (sidebar collapse), so resettle briefly after
  let settle = 0;
  function resettle() {
    clearInterval(settle);
    let n = 0;
    settle = setInterval(() => { align(); if (++n > 8) clearInterval(settle); }, 60);
  }

  function zoneFor(target, x, y) {
    if (!target || !target.closest) return 'none';
    if (target.closest('.claude-input-container')) return 'composer';
    if (target.closest('#sidebar, .sidebar')) return 'sidebar';
    if (target.closest('#settings-overlay, .settings-modal')) return 'none';
    if (target.closest('#main-content')) return 'content';
    return 'none';
  }

  let pendingMove = false;
  function onMove(e) {
    if (reduce() || coarse()) return;
    P.x = e.clientX; P.y = e.clientY;
    if (!pendingMove) {
      pendingMove = true;
      requestAnimationFrame(() => {
        pendingMove = false;
        if (!sidebarGlow || !contentGlow) ensureLayers();
        const z = zoneFor(e.target, P.x, P.y);
        if (z !== P.zone) {
          P.zone = z;
          if (sidebarGlow) sidebarGlow.classList.toggle('on', z === 'sidebar' && isDark());
          if (contentGlow) contentGlow.classList.toggle('on', z === 'content' && isDark());
        }
        if (!raf) raf = requestAnimationFrame(tick);
      });
    }
  }

  function tick() {
    raf = 0;
    if (!isDark()) return;

    // Sidebar ribbon: follows Y closely, X only a touch (it is a narrow rail)
    if (sidebarGlow && P.zone === 'sidebar' && RECT.sb) {
      const r = RECT.sb;
      const ty = P.y - r.top, tx = P.x - r.left;
      P.sy += (ty - P.sy) * 0.16;
      P.sx += (tx - P.sx) * 0.10;
      sidebarGlow.style.setProperty('--sy', P.sy.toFixed(1) + 'px');
      sidebarGlow.style.setProperty('--sx', P.sx.toFixed(1) + 'px');
      if (Math.abs(ty - P.sy) > 0.4) raf = requestAnimationFrame(tick);
    }

    // Content bloom: slower, wider, lags more — it reads as ambient light
    if (contentGlow && P.zone === 'content' && RECT.mc) {
      const r = RECT.mc;
      const tx = P.x - r.left, ty = P.y - r.top;
      P.cx += (tx - P.cx) * 0.085;
      P.cy += (ty - P.cy) * 0.085;
      contentGlow.style.setProperty('--cgx', P.cx.toFixed(1) + 'px');
      contentGlow.style.setProperty('--cgy', P.cy.toFixed(1) + 'px');
      if (Math.abs(tx - P.cx) + Math.abs(ty - P.cy) > 0.8) raf = requestAnimationFrame(tick);
    }
  }

  function hideAll() {
    sidebarGlow?.classList.remove('on');
    contentGlow?.classList.remove('on');
    P.zone = 'none';
    document.documentElement.dataset.glowZone = 'none';
  }

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseleave', hideAll);
  // Realign only when geometry can actually change. A scroll listener here
  // caused two getBoundingClientRect reads per scroll event, which thrashed
  // layout and made the sidebar stutter while scrolling.
  window.addEventListener('resize', align, { passive: true });
  document.addEventListener('nexus:sidebarchange', resettle);
  document.addEventListener('nexus:themechange', (e) => {
    if (e.detail?.theme !== 'dark') hideAll();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureLayers);
  else ensureLayers();
  new MutationObserver(ensureLayers).observe(document.body, { childList: true, subtree: true });
})();